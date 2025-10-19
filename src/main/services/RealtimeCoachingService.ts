import { CoachConfig, CoachingType, CoachingFeedback, TranscriptChunk } from '../../shared/types';
import { PromptService } from './PromptService';
import { BaseAnthropicService } from './BaseAnthropicService';
import { SettingsService } from './SettingsService';

const ANALYSIS_INTERVAL_MS = 60000; // 60 seconds (1 minute)
const TRANSCRIPT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

export class RealtimeCoachingService extends BaseAnthropicService {
  private promptService: PromptService | null;
  private isActive: boolean = false;
  private coachingType: CoachingType | null = null;
  private meetingId: string | null = null;
  private intervalId: NodeJS.Timeout | null = null;
  private transcriptHistory: TranscriptChunk[] = [];
  private feedbackHistory: CoachingFeedback[] = [];
  private currentMeetingNotes: string = '';
  private settingsService: SettingsService;

  constructor(promptService: PromptService | null, settingsService: SettingsService) {
    super('RealtimeCoachingService');
    this.promptService = promptService;
    this.settingsService = settingsService;
  }

  /**
   * Start real-time coaching for a meeting
   */
  async startCoaching(meetingId: string, coachingType: CoachingType): Promise<void> {
    if (!this.anthropic || !this.promptService) {
      throw new Error('Real-time coaching not available');
    }

    const coachConfig = this.getCoachConfig(coachingType);
    if (!coachConfig || !coachConfig.enabled) {
      throw new Error('Selected coach is disabled');
    }

    if (this.isActive) {
      this.logger.warn('Coaching already active, stopping previous session');
      this.stopCoaching();
    }

    this.logger.info(`Starting real-time coaching for meeting ${meetingId} with type ${coachingType}`);

    this.isActive = true;
    this.coachingType = coachingType;
    this.meetingId = meetingId;
    this.transcriptHistory = [];
    this.feedbackHistory = [];

    // Start periodic analysis
    this.intervalId = setInterval(() => {
      this.analyzeFeedback().catch(error => {
        this.logger.error('Error during coaching analysis:', error);
        this.emit('coaching-error', { meetingId, error: error instanceof Error ? error.message : String(error) });
      });
    }, ANALYSIS_INTERVAL_MS);

    // Do first analysis immediately
    setTimeout(() => {
      this.analyzeFeedback().catch(error => {
        this.logger.error('Error during initial coaching analysis:', error);
        this.emit('coaching-error', { meetingId, error: error instanceof Error ? error.message : String(error) });
      });
    }, 5000); // Wait 5 seconds for some transcript to accumulate
  }

  /**
   * Stop coaching session
   */
  stopCoaching(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.logger.info(`Stopping real-time coaching for meeting ${this.meetingId}`);

    this.isActive = false;
    this.coachingType = null;
    this.meetingId = null;
    this.transcriptHistory = [];
    this.feedbackHistory = [];
    this.currentMeetingNotes = '';
  }

  /**
   * Add transcript chunk to history
   */
  addTranscriptChunk(chunk: TranscriptChunk): void {
    if (!this.isActive) return;

    this.transcriptHistory.push(chunk);

    // Keep only last 10 minutes of transcript (2x our analysis window for safety)
    const cutoffTime = new Date(Date.now() - (TRANSCRIPT_WINDOW_MS * 2));
    this.transcriptHistory = this.transcriptHistory.filter(
      c => new Date(c.timestamp) > cutoffTime
    );
  }

  /**
   * Update current meeting notes for coaching context
   */
  updateMeetingNotes(notes: string): void {
    if (!this.isActive) return;

    this.currentMeetingNotes = notes;
    this.logger.debug('Updated meeting notes for coaching', {
      notesLength: notes.length
    });
  }

  /**
   * Analyze transcript and provide coaching feedback
   */
  private async analyzeFeedback(): Promise<void> {
    // Check if coaching is still active (prevent race condition)
    if (!this.isActive || !this.anthropic || !this.promptService || !this.coachingType || !this.meetingId) {
      return;
    }

    // Get last 5 minutes of transcript
    const recentTranscript = this.getRecentTranscript();

    if (!recentTranscript || recentTranscript.trim().length < 50) {
      this.logger.debug('Not enough transcript content for coaching analysis');
      return;
    }

    this.logger.info('Analyzing transcript for coaching feedback');

    // Store meetingId to avoid null reference if stopped during analysis
    const currentMeetingId = this.meetingId;

    try {
      // Build context from previous feedback
      const previousFeedback = this.buildPreviousFeedbackContext();

      // Get the coaching prompt template
      const promptTemplate = await this.promptService.getPrompt(this.coachingType);

      // Interpolate variables
      const prompt = promptTemplate
        .replace('{{previousFeedback}}', previousFeedback)
        .replace('{{recentTranscript}}', recentTranscript)
        .replace('{{meetingNotes}}', this.currentMeetingNotes || 'No notes yet');

      // Call Claude
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 2048,
        temperature: 0.5,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      // Check if still active after async operation
      if (!this.isActive) {
        this.logger.debug('Coaching stopped during analysis, discarding results');
        return;
      }

      if (response.content[0].type === 'text') {
        const feedbackJson = response.content[0].text.trim();

        // Parse JSON response with better error handling
        let parsed: any;
        try {
          parsed = JSON.parse(feedbackJson);
        } catch (parseError) {
          this.logger.error('Failed to parse coaching feedback JSON:', parseError);
          this.logger.error('Raw response:', feedbackJson);
          this.emit('coaching-error', {
            meetingId: currentMeetingId,
            error: 'Invalid feedback format from AI'
          });
          return;
        }

        const feedback: CoachingFeedback = {
          timestamp: new Date(),
          alerts: Array.isArray(parsed.alerts) ? parsed.alerts : [],
          observations: Array.isArray(parsed.observations) ? parsed.observations : [],
          suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : []
        };

        // Store in history (keep last 5 feedback items for context)
        this.feedbackHistory.push(feedback);
        if (this.feedbackHistory.length > 5) {
          this.feedbackHistory.shift();
        }

        // Emit feedback to UI
        this.emit('coaching-feedback', {
          meetingId: currentMeetingId,
          feedback
        });

        this.logger.info('Coaching feedback generated and emitted');
      }
    } catch (error) {
      this.logger.error('Failed to generate coaching feedback:', error);
      this.emit('coaching-error', {
        meetingId: currentMeetingId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get last 5 minutes of transcript formatted for coaching
   */
  private getRecentTranscript(): string {
    const cutoffTime = new Date(Date.now() - TRANSCRIPT_WINDOW_MS);
    const recentChunks = this.transcriptHistory.filter(
      c => new Date(c.timestamp) > cutoffTime
    );

    if (recentChunks.length === 0) {
      return '';
    }

    return recentChunks
      .map(chunk => {
        const time = new Date(chunk.timestamp).toLocaleTimeString('en-US', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
        return `[${time}] ${chunk.speaker || 'Unknown'}: ${chunk.text}`;
      })
      .join('\n');
  }

  /**
   * Build summary of previous feedback to maintain context
   */
  private buildPreviousFeedbackContext(): string {
    if (this.feedbackHistory.length === 0) {
      return 'No previous feedback yet (this is the first analysis).';
    }

    const summaries = this.feedbackHistory.map((fb, idx) => {
      const num = idx + 1;
      const parts: string[] = [];

      if (fb.alerts.length > 0) {
        parts.push(`Alerts: ${fb.alerts.join('; ')}`);
      }
      if (fb.observations.length > 0) {
        parts.push(`Observations: ${fb.observations.join('; ')}`);
      }
      if (fb.suggestions.length > 0) {
        parts.push(`Suggestions: ${fb.suggestions.join('; ')}`);
      }

      return `Feedback #${num}: ${parts.join(' | ')}`;
    });

    return `Previous feedback provided:\n${summaries.join('\n\n')}`;
  }

  /**
   * Check if coaching is currently active
   */
  isCoachingActive(): boolean {
    return this.isActive;
  }

  /**
   * Get current coaching state
   */
  getCoachingState(): { isActive: boolean; coachingType: CoachingType | null; meetingId: string | null } {
    return {
      isActive: this.isActive,
      coachingType: this.coachingType,
      meetingId: this.meetingId
    };
  }

  private getCoachConfig(coachingType: CoachingType): CoachConfig | undefined {
    return this.settingsService.getCoaches().find(coach => coach.id === coachingType);
  }
}
