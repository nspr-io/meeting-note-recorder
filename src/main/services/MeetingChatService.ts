import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';
import { BaseAnthropicService } from './BaseAnthropicService';
import { StorageService } from './StorageService';
import { Meeting, MeetingChatMessage } from '../../shared/types';
import { extractNoteSections } from '../../renderer/components/noteSectionUtils';

const MAX_NOTES_CHARS = 6000;
const MAX_TRANSCRIPT_CHARS = 8000;
const MAX_HISTORY_MESSAGES = 20;

export class MeetingChatService extends BaseAnthropicService {
  constructor(private storageService: StorageService) {
    super('MeetingChatService');
  }

  async getHistory(meetingId: string): Promise<MeetingChatMessage[]> {
    return this.storageService.getMeetingChatHistory(meetingId);
  }

  async clearHistory(meetingId: string): Promise<void> {
    await this.storageService.clearMeetingChatHistory(meetingId);
  }

  async sendMessage(meetingId: string, rawContent: string): Promise<{
    userMessage: MeetingChatMessage;
    assistantMessage: MeetingChatMessage;
    history: MeetingChatMessage[];
  }> {
    const content = rawContent?.trim();
    if (!content) {
      throw new Error('Message content cannot be empty');
    }

    if (!this.anthropic) {
      throw new Error('Meeting chat service not available');
    }

    const meeting = await this.storageService.getMeeting(meetingId);
    if (!meeting) {
      throw new Error('Meeting not found');
    }

    const userMessage: MeetingChatMessage = {
      id: uuidv4(),
      role: 'user',
      content,
      createdAt: new Date().toISOString()
    };

    const existingHistory = await this.storageService.getMeetingChatHistory(meetingId);
    const trimmedHistory = existingHistory.slice(-MAX_HISTORY_MESSAGES);

    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      temperature: 0.2,
      system: this.buildSystemPrompt(meeting),
      messages: [
        ...trimmedHistory.map((entry) => ({
          role: entry.role,
          content: entry.content
        })),
        { role: 'user', content }
      ]
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    const replyContent = typeof textBlock?.text === 'string' ? textBlock.text.trim() : '';
    if (!replyContent) {
      throw new Error('Received an empty response from Anthropic');
    }

    const assistantMessage: MeetingChatMessage = {
      id: uuidv4(),
      role: 'assistant',
      content: replyContent,
      createdAt: new Date().toISOString()
    };

    const history = [...existingHistory, userMessage, assistantMessage];
    await this.storageService.saveMeetingChatHistory(meetingId, history);

    return { userMessage, assistantMessage, history };
  }

  private buildSystemPrompt(meeting: Meeting): string {
    const meetingDate = this.formatMeetingDate(meeting);
    const attendees = this.formatAttendees(meeting);
    const sections = extractNoteSections(meeting.notes || '');

    const calendarInfo = sections.calendarInfo?.trim() || 'No calendar context provided.';
    const prepNotes = sections.prepNotes?.trim() || 'No prep notes provided.';
    const meetingNotes = sections.meetingNotes?.trim() || 'No meeting notes captured yet.';
    const transcriptExcerpt = this.buildTranscriptExcerpt(meeting.transcript || '');

    const instructions = `You are Meeting Chat, an assistant that answers questions using the context from a specific meeting.
Always ground responses in the provided notes, transcript, and calendar details. If the information is not present, state that you do not have enough data.
Keep answers concise, actionable, and reference the source (notes or transcript) when relevant.`;

    const context = [
      `Meeting Title: ${meeting.title || 'Untitled meeting'}`,
      `Date: ${meetingDate}`,
      `Attendees: ${attendees}`,
      `Calendar Context:\n${this.truncate(calendarInfo, MAX_NOTES_CHARS)}`,
      `Prep Notes:\n${this.truncate(prepNotes, MAX_NOTES_CHARS)}`,
      `Meeting Notes:\n${this.truncate(meetingNotes, MAX_NOTES_CHARS)}`,
      `Transcript Excerpt:\n${transcriptExcerpt}`
    ].join('\n\n');

    return `${instructions}\n\n${context}`;
  }

  private truncate(value: string, maxLength: number): string {
    if (!value) {
      return '';
    }
    if (value.length <= maxLength) {
      return value;
    }
    return `${value.slice(0, maxLength)}…`;
  }

  private buildTranscriptExcerpt(transcript: string): string {
    if (!transcript?.trim()) {
      return 'No transcript available.';
    }

    const trimmed = transcript.trim();
    if (trimmed.length <= MAX_TRANSCRIPT_CHARS) {
      return trimmed;
    }

    const start = trimmed.slice(0, Math.round(MAX_TRANSCRIPT_CHARS / 2));
    const end = trimmed.slice(trimmed.length - Math.round(MAX_TRANSCRIPT_CHARS / 2));
    return `${start}\n…\n${end}`;
  }

  private formatMeetingDate(meeting: Meeting): string {
    try {
      const date = new Date(meeting.date);
      if (Number.isNaN(date.getTime())) {
        return 'Unknown date';
      }
      return format(date, 'PPP p');
    } catch (error) {
      this.logger.warn('[CHAT] Failed to format meeting date', {
        meetingId: meeting.id,
        error: error instanceof Error ? error.message : error
      });
      return 'Unknown date';
    }
  }

  private formatAttendees(meeting: Meeting): string {
    if (!Array.isArray(meeting.attendees) || meeting.attendees.length === 0) {
      return 'No attendees recorded.';
    }

    const names = meeting.attendees.map((attendee) => {
      if (typeof attendee === 'string') {
        return attendee;
      }
      if (attendee?.name) {
        return attendee.email ? `${attendee.name} <${attendee.email}>` : attendee.name;
      }
      return attendee?.email || 'Unknown attendee';
    });

    return names.join(', ');
  }
}
