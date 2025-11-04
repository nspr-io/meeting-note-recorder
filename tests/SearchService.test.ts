import { SearchService } from '../src/shared/search/SearchService';
import { Meeting } from '../src/shared/types';

const baseMeeting: Omit<Meeting, 'id' | 'title'> = {
  date: '2024-01-01T10:00:00.000Z',
  attendees: ['Amanda Billings'],
  duration: 60,
  platform: 'zoom',
  status: 'completed',
  notes: '',
  transcript: '',
  insights: undefined,
  tags: [],
};

const createMeeting = (overrides: Partial<Meeting>): Meeting => ({
  id: overrides.id ?? Math.random().toString(36).slice(2),
  title: overrides.title ?? 'Untitled',
  date: overrides.date ?? baseMeeting.date,
  attendees: overrides.attendees ?? baseMeeting.attendees,
  duration: overrides.duration ?? baseMeeting.duration,
  platform: overrides.platform ?? baseMeeting.platform,
  status: overrides.status ?? baseMeeting.status,
  notes: overrides.notes ?? baseMeeting.notes,
  transcript: overrides.transcript ?? baseMeeting.transcript,
  insights: overrides.insights ?? baseMeeting.insights,
  tags: overrides.tags ?? baseMeeting.tags,
  insightsFilePath: overrides.insightsFilePath,
  recallRecordingId: overrides.recallRecordingId,
  recallVideoUrl: overrides.recallVideoUrl,
  recallAudioUrl: overrides.recallAudioUrl,
  calendarEventId: overrides.calendarEventId,
  meetingUrl: overrides.meetingUrl,
  calendarInviteUrl: overrides.calendarInviteUrl,
  startTime: overrides.startTime,
  endTime: overrides.endTime,
  actionItemSyncStatus: overrides.actionItemSyncStatus,
  teamSummary: overrides.teamSummary,
  slackSharedAt: overrides.slackSharedAt,
  notionSharedAt: overrides.notionSharedAt,
  notionPageId: overrides.notionPageId,
  filePath: overrides.filePath,
  createdAt: overrides.createdAt,
  updatedAt: overrides.updatedAt,
  autoRecordApproved: overrides.autoRecordApproved,
  __transcriptDedupeIndex: overrides.__transcriptDedupeIndex,
  firefliesTranscriptId: overrides.firefliesTranscriptId,
  firefliesTranscriptFetchedAt: overrides.firefliesTranscriptFetchedAt,
});

describe('SearchService fuzzy search improvements', () => {
  let searchService: SearchService;

  beforeEach(() => {
    searchService = new SearchService();
    const meetings: Meeting[] = [
      createMeeting({ id: 'title-match', title: 'Amanda', attendees: ['Amanda'] }),
      createMeeting({
        id: 'attendee-string',
        title: 'Quarterly Business Review',
        attendees: ['Amanda Billings', 'Jordan Smith'],
      }),
      createMeeting({
        id: 'attendee-object',
        title: 'Customer Success Sync',
        attendees: [
          { name: 'Amanda Billings', email: 'amanda@example.com' },
          { name: 'Chris Roe', email: 'chris@example.com' },
        ],
      }),
    ];
    searchService.updateIndex(meetings);
  });

  it('finds meetings when the query contains extra tokens beyond the title', () => {
    const results = searchService.search({ query: 'Amanda Billings' });

    expect(results).not.toHaveLength(0);
    expect(results[0].meeting.id).toBe('title-match');
    const ids = results.map((result) => result.meeting.id);
    expect(ids).toContain('attendee-string');
  });

  it('matches meetings indexed with string attendees', () => {
    const results = searchService.search({ query: 'Billings' });

    expect(results.map((result) => result.meeting.id)).toContain('attendee-string');
  });

  it('matches meetings indexed with attendee objects', () => {
    const results = searchService.search({ query: 'amanda billings' });

    expect(results.map((result) => result.meeting.id)).toContain('attendee-object');
  });
});
