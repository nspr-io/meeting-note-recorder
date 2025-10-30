import { BaseAnthropicService } from './BaseAnthropicService';
import { PromptService } from './PromptService';
import { Meeting, UserProfile } from '../../shared/types';

const MAX_TRANSCRIPT_CHARS = 8000;

export class MeetingTaggingService extends BaseAnthropicService {
  private promptService: PromptService | null;

  constructor(promptService: PromptService | null) {
    super('MeetingTaggingService');
    this.promptService = promptService;
  }

  async generateTags(meeting: Meeting, userProfile?: UserProfile | null): Promise<string[]> {
    if (!meeting) {
      return [];
    }

    const fallbackTags = this.deriveFallbackTags(meeting);

    if (!this.anthropic) {
      this.logger.info('[TAGGING] Anthropic unavailable, using fallback tags', { meetingId: meeting.id });
      return fallbackTags;
    }

    try {
      const systemPrompt = await this.getSystemPrompt(meeting, userProfile);
      const userPrompt = this.buildMeetingContext(meeting, userProfile);

      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 256,
        temperature: 0,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userPrompt
          }
        ]
      });

      const parsed = this.extractTagsFromResponse(response);
      if (parsed.length === 0) {
        this.logger.warn('[TAGGING] No tags returned from Anthropic response, using fallback', { meetingId: meeting.id });
        return fallbackTags;
      }

      return parsed;
    } catch (error) {
      this.logger.error('[TAGGING] Failed to generate tags via Anthropic', {
        meetingId: meeting.id,
        error: error instanceof Error ? error.message : error
      });
      return fallbackTags;
    }
  }

  private async getSystemPrompt(meeting: Meeting, userProfile?: UserProfile | null): Promise<string> {
    if (!this.promptService) {
      return 'You are an assistant that classifies meetings. Return a concise JSON payload with a "tags" array describing the meeting type (e.g., "sales", "existing-client", "internal", "support"). Use lowercase kebab-case tags. Limit to 3 tags. Never include explanations.';
    }

    try {
      return await this.promptService.getInterpolatedPrompt('meeting-tags', {
        meeting,
        userProfile
      });
    } catch (error) {
      this.logger.warn('[TAGGING] Failed to load custom tagging prompt, using fallback', {
        meetingId: meeting.id,
        error: error instanceof Error ? error.message : error
      });
      return 'You are an assistant that classifies meetings. Return a concise JSON payload with a "tags" array describing the meeting type (e.g., "sales", "existing-client", "internal", "support"). Use lowercase kebab-case tags. Limit to 3 tags. Never include explanations.';
    }
  }

  private buildMeetingContext(meeting: Meeting, userProfile?: UserProfile | null): string {
    const attendees = Array.isArray(meeting.attendees)
      ? meeting.attendees.map((attendee) => (typeof attendee === 'string' ? attendee : attendee.name || attendee.email || '')).filter(Boolean)
      : [];

    const transcript = typeof meeting.transcript === 'string' ? meeting.transcript : '';
    const truncatedTranscript = transcript.length > MAX_TRANSCRIPT_CHARS
      ? `${transcript.slice(0, MAX_TRANSCRIPT_CHARS)}\n[trimmed]`
      : transcript;

    const notes = typeof meeting.notes === 'string' ? meeting.notes : '';

    const profileSummary = userProfile
      ? `User profile: ${userProfile.name || 'Unknown'} at ${userProfile.company || 'Unknown company'} (${userProfile.title || 'Unknown title'}). Preferences: ${userProfile.preferences || 'None provided'}`
      : 'User profile: Not provided.';

    return `Classify the following meeting.

Title: ${meeting.title || 'Untitled'}
Date: ${meeting.date}
Attendees (${attendees.length}): ${attendees.join(', ') || 'Not listed'}
Status: ${meeting.status}
Meeting URL: ${meeting.meetingUrl || 'N/A'}
Existing Tags: ${(Array.isArray(meeting.tags) && meeting.tags.length > 0) ? meeting.tags.join(', ') : 'None'}

${profileSummary}

Notes:
${notes || 'None'}

Transcript:
${truncatedTranscript || 'No transcript available'}

Return JSON: {"tags": ["tag-one", "tag-two"]}`;
  }

  private extractTagsFromResponse(response: any): string[] {
    const content = Array.isArray(response?.content) ? response.content : [];
    const firstText = content.find((item: any) => item?.type === 'text');
    if (!firstText || typeof firstText.text !== 'string') {
      return [];
    }

    const raw = firstText.text.trim();
    const payload = this.parseJsonBlock(raw);
    if (!payload || !Array.isArray(payload.tags)) {
      return [];
    }

    return payload.tags
      .filter((tag: unknown): tag is string => typeof tag === 'string')
      .map((tag) => tag.trim().toLowerCase())
      .filter((tag) => tag.length > 0);
  }

  private parseJsonBlock(text: string): any | null {
    const cleaned = text.replace(/```json|```/gi, '').trim();
    try {
      return JSON.parse(cleaned);
    } catch (error) {
      this.logger.warn('[TAGGING] Failed to parse JSON response', {
        error: error instanceof Error ? error.message : error,
        preview: cleaned.slice(0, 200)
      });
      return null;
    }
  }

  private deriveFallbackTags(meeting: Meeting): string[] {
    const tags = new Set<string>();
    const title = (meeting.title || '').toLowerCase();

    if (title.includes('sales') || title.includes('demo')) {
      tags.add('sales');
    }

    if (title.includes('kickoff') || title.includes('standup') || title.includes('retro') || title.includes('internal')) {
      tags.add('internal');
    }

    if (title.includes('client') || title.includes('customer') || title.includes('account')) {
      tags.add('existing-client');
    }

    const attendeeEmails = Array.isArray(meeting.attendees)
      ? meeting.attendees
          .map((attendee) => (typeof attendee === 'string' ? attendee : attendee.email || ''))
          .filter((email) => typeof email === 'string' && email.includes('@'))
      : [];

    if (attendeeEmails.some((email) => email.toLowerCase().includes('sales'))) {
      tags.add('sales');
    }

    if (attendeeEmails.some((email) => email.toLowerCase().includes('support'))) {
      tags.add('support');
    }

    return Array.from(tags);
  }
}
