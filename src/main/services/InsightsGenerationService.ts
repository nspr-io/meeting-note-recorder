import Anthropic from '@anthropic-ai/sdk';
import { getLogger } from './LoggingService';
import { EventEmitter } from 'events';
import { Meeting } from '../../shared/types';

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
  async generateInsights(meeting: Meeting): Promise<string> {
    if (!this.anthropic) {
      logger.info('Insights generation skipped - no Anthropic API key configured');
      throw new Error('Insights generation not available');
    }

    logger.info(`Starting insights generation for meeting ${meeting.id}`);
    this.emit('insights-started', { meetingId: meeting.id });

    try {
      const prompt = this.buildPrompt(meeting);

      const response = await this.anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        temperature: 0.3,
        system: this.getSystemPrompt(),
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

  private getSystemPrompt(): string {
    return `You are an expert meeting analyst who creates actionable insights from meeting content.

Your task is to analyze the meeting and produce structured insights that help participants understand what happened and what needs to be done next.

IMPORTANT RULES:
1. Base your analysis primarily on the personal notes if they exist
2. Use the transcript to fill in gaps and provide additional context
3. Be concise and actionable
4. Focus on decisions, action items, and key points
5. If notes and transcript seem to disagree, prioritize the notes (they represent what the user thought was important)

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
  }

  private buildPrompt(meeting: Meeting): string {
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

Based on the above meeting content, create a comprehensive summary with action items, key decisions, and follow-ups. Return ONLY valid JSON as specified.`;

    return prompt;
  }

  /**
   * Check if insights service is available
   */
  isAvailable(): boolean {
    return this.anthropic !== null;
  }
}