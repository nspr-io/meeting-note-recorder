import Anthropic from '@anthropic-ai/sdk';
import { getLogger } from './LoggingService';
import { EventEmitter } from 'events';
import { Meeting, UserProfile } from '../../shared/types';

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

  constructor() {
    super();
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
      const prompt = this.buildPrompt(meeting, userProfile);

      const response = await this.anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        temperature: 0.3,
        system: this.getSystemPrompt(userProfile),
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

  private getSystemPrompt(userProfile?: UserProfile | null): string {
    let systemPrompt = `You are an experienced Executive Assistant with 20+ years of expertise in analyzing meetings, extracting actionable insights, and preparing executive-level summaries. You excel at understanding context, identifying what matters most, and presenting information in a clear, actionable format.

`;

    if (userProfile) {
      systemPrompt += `USER CONTEXT:
You are preparing these insights for ${userProfile.name}, ${userProfile.title} at ${userProfile.company}.

About them: ${userProfile.aboutMe}

Their preferences for meeting insights: ${userProfile.preferences}

Tailor your insights to match their role, responsibilities, and preferences. Consider their position and what would be most valuable for them to track and action.

`;
    }

    systemPrompt += `YOUR TASK:
Analyze the meeting content and produce structured insights that are immediately actionable and valuable.

CRITICAL GUIDELINES:
1. Personal notes are the PRIMARY source - they reflect what the user considered important
2. Use the transcript to provide context and fill gaps, but NEVER contradict the notes
3. Be concise but comprehensive - every word should add value
4. Focus on outcomes: decisions made, actions required, and strategic implications
5. Write action items that are specific, measurable, and assignable
6. Highlight strategic insights and patterns that an exec would care about
7. If something seems important but unclear, mark it for follow-up rather than guessing

You must return ONLY valid JSON in this exact format:
{
  "summary": "2-3 paragraph executive summary of the meeting",
  "actionItems": [
    {
      "owner": "Person's name or 'Unassigned'",
      "task": "Clear description of what needs to be done",
      "due": "Date if mentioned, otherwise null"
    }
  ],
  "keyDecisions": [
    "Decision 1 that was made",
    "Decision 2 that was made"
  ],
  "followUps": [
    "Question or topic that needs follow-up",
    "Unresolved issue that was discussed"
  ],
  "notesHighlights": [
    "Important point from the personal notes",
    "Key insight captured in notes"
  ]
}`;

    return systemPrompt;
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