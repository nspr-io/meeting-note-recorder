import Anthropic from '@anthropic-ai/sdk';
import { getLogger } from './LoggingService';
import { EventEmitter } from 'events';
import { Meeting, UserProfile } from '../../shared/types';
import { PromptService } from './PromptService';

const logger = getLogger();

interface MeetingInsights {
  summary: string;
  actionItems: Array<{
    owner: string;
    task: string;
    due?: string;
  }>;
  keyDecisions: string[];
  followUps: string[];
  notesHighlights: string[];
}

export class InsightsGenerationService extends EventEmitter {
  private anthropic: Anthropic | null = null;
  private promptService: PromptService | null;

  constructor(promptService: PromptService | null) {
    super();
    this.promptService = promptService;
  }

  initialize(apiKey: string | undefined): void {
    if (!apiKey) {
      logger.warn('No Anthropic API key provided - insights generation disabled');
      return;
    }

    try {
      this.anthropic = new Anthropic({
        apiKey: apiKey
      });
      logger.info('InsightsGenerationService initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Anthropic client:', error);
      this.anthropic = null;
    }
  }

  /**
   * Generate insights from meeting notes and transcript
   */
  async generateInsights(meeting: Meeting, userProfile?: UserProfile | null): Promise<string> {
    if (!this.anthropic) {
      logger.info('Insights generation skipped - no Anthropic API key configured');
      throw new Error('Insights generation not available');
    }

    logger.info(`Starting insights generation for meeting ${meeting.id}`);
    this.emit('insights-started', { meetingId: meeting.id });

    try {
      const systemPrompt = await this.getSystemPrompt(meeting, userProfile);
      const prompt = this.buildPrompt(meeting, userProfile);

      const response = await this.anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        temperature: 0.3,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      if (response.content[0].type === 'text') {
        const insightsJson = response.content[0].text.trim();

        // Validate it's proper JSON
        try {
          JSON.parse(insightsJson);
        } catch (e) {
          logger.error('Invalid JSON response from AI:', e);
          throw new Error('Invalid response format from AI');
        }

        logger.info(`Insights generation completed for meeting ${meeting.id}`);
        this.emit('insights-completed', { meetingId: meeting.id });

        return insightsJson;
      }

      throw new Error('Unexpected response format from AI');

    } catch (error) {
      logger.error('Failed to generate insights:', error);
      this.emit('insights-failed', { meetingId: meeting.id, error });
      throw error;
    }
  }

  private async getSystemPrompt(meeting: Meeting, userProfile?: UserProfile | null): Promise<string> {
    try {
      if (!this.promptService) {
        logger.warn('PromptService not available, using fallback prompt');
        throw new Error('PromptService not initialized');
      }
      return await this.promptService.getInterpolatedPrompt('insights-generation', {
        userProfile,
        meeting,
        transcript: meeting.transcript,
        notes: meeting.notes
      });
    } catch (error) {
      logger.error('Failed to load insights generation prompt, using fallback:', error);
      // Fallback to a basic prompt if the service fails
      return 'You are an experienced Executive Assistant. Analyze the meeting content and produce structured insights in JSON format with summary, actionItems, keyDecisions, followUps, and notesHighlights.';
    }
  }

  private buildPrompt(meeting: Meeting, userProfile?: UserProfile | null): string {
    const attendeesList = Array.isArray(meeting.attendees)
      ? meeting.attendees.map(a => typeof a === 'string' ? a : a.name).join(', ')
      : 'Unknown';

    let prompt = `MEETING CONTEXT:
Title: ${meeting.title}
Date: ${meeting.date}
Attendees: ${attendeesList}

`;

    if (meeting.notes && meeting.notes.trim()) {
      prompt += `PERSONAL NOTES TAKEN DURING MEETING:
${meeting.notes}

`;
    } else {
      prompt += `PERSONAL NOTES: None taken

`;
    }

    if (meeting.transcript && meeting.transcript.trim()) {
      // Limit transcript to reasonable length to avoid token limits
      const transcriptLines = meeting.transcript.split('\n');
      const maxLines = 500; // Roughly 10-15k tokens
      const truncatedTranscript = transcriptLines.slice(0, maxLines).join('\n');

      prompt += `MEETING TRANSCRIPT:
${truncatedTranscript}`;

      if (transcriptLines.length > maxLines) {
        prompt += `\n[Transcript truncated - ${transcriptLines.length - maxLines} lines omitted]`;
      }
    } else {
      prompt += `TRANSCRIPT: Not available`;
    }

    prompt += `

Analyze this meeting and create insights that an experienced Executive Assistant would prepare. Consider the strategic importance, required actions, and follow-ups needed.

Return ONLY valid JSON as specified - no additional text or explanation.`;

    return prompt;
  }

  /**
   * Check if insights service is available
   */
  isAvailable(): boolean {
    return this.anthropic !== null;
  }
}