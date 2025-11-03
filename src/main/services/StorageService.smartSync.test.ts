import { StorageService } from './StorageService';
import type { Meeting, CalendarEvent } from '../../shared/types';
import type { SettingsService } from './SettingsService';
import * as MeetingFileSerializer from '../../shared/meetings/MeetingFileSerializer';

jest.mock('./DescriptionProcessingService', () => ({
  DescriptionProcessingService: jest.fn().mockImplementation(() => ({
    initialize: jest.fn(),
    processDescription: jest.fn().mockResolvedValue({ notes: '', platform: undefined })
  }))
}));

jest.mock('fs/promises', () => ({
  writeFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockResolvedValue(''),
  readdir: jest.fn().mockResolvedValue([]),
  mkdir: jest.fn().mockResolvedValue(undefined),
  rename: jest.fn().mockResolvedValue(undefined),
  stat: jest.fn().mockResolvedValue({ mtime: new Date() }),
  access: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid')
}));

jest.mock('chokidar', () => ({
  watch: jest.fn(() => ({
    on: jest.fn(),
    close: jest.fn(),
  })),
}));

const diskMeetingsByPath = new Map<string, Meeting>();
const deserializeMeetingMarkdownSpy = jest.spyOn(MeetingFileSerializer, 'deserializeMeetingMarkdown');

beforeEach(() => {
  jest.clearAllMocks();
  diskMeetingsByPath.clear();
  deserializeMeetingMarkdownSpy.mockImplementation(async (_content, options) => {
    const filePath = options?.filePath ?? '';
    const diskMeeting = diskMeetingsByPath.get(filePath);
    const meetingFromDisk = diskMeeting
      ? { ...diskMeeting }
      : buildTouchedMeeting({ filePath });

    // Ensure the meeting retains the file path reference for downstream logic
    meetingFromDisk.filePath = filePath;

    return {
      meeting: meetingFromDisk,
      sections: {
        calendarInfo: '',
        prepNotes: '',
        meetingNotes: meetingFromDisk.notes ?? ''
      },
      transcript: meetingFromDisk.transcript ?? ''
    };
  });
});

const createStorageService = () => {
  const settingsService = {
    getSettings: jest.fn().mockReturnValue({
      storagePath: '/tmp/meeting-storage',
      anthropicApiKey: null
    })
  } as unknown as SettingsService;

  const notifyMeetingsUpdated = jest.fn();
  const service = new StorageService(settingsService, notifyMeetingsUpdated);

  (service as any).meetingsCache.clear();

  return {
    service,
    notifyMeetingsUpdated
  };
};

const buildTouchedMeeting = (overrides: Partial<Meeting> = {}): Meeting => {
  const now = new Date();
  return {
    id: 'meeting-1',
    title: 'Weekly Sync',
    date: new Date('2025-10-25T09:00:00Z'),
    startTime: new Date('2025-10-25T09:00:00Z'),
    endTime: new Date('2025-10-25T10:00:00Z'),
    attendees: ['teammate@example.com'],
    status: 'scheduled',
    notes: '<!-- CALENDAR_INFO -->\nPrep content\n<!-- /CALENDAR_INFO -->',
    transcript: '',
    createdAt: now,
    updatedAt: now,
    calendarEventId: 'abc123_20251025T090000Z',
    meetingUrl: 'https://meet.google.com/abc-defg-hij',
    calendarInviteUrl: 'https://calendar.google.com/event?eid=abc',
    ...overrides
  } as Meeting;
};

const buildCalendarEvent = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'abc123_20251027T090000Z',
  title: 'Weekly Sync',
  start: new Date('2025-10-27T09:00:00Z'),
  end: new Date('2025-10-27T10:00:00Z'),
  attendees: ['teammate@example.com'],
  calendarId: 'primary',
  meetingUrl: 'https://meet.google.com/abc-defg-hij',
  htmlLink: 'https://calendar.google.com/event?eid=abc-new',
  ...overrides
});

describe('StorageService.updateMeeting tag persistence', () => {
  it('writes markdown and deduplicates when tags change', async () => {
    const { service } = createStorageService();
    const meeting = buildTouchedMeeting({
      tags: ['existing'],
      filePath: '/tmp/meeting-storage/2025/10/meeting.md'
    });
    (service as any).meetingsCache.set(meeting.id, meeting);
    diskMeetingsByPath.set(meeting.filePath!, { ...meeting });

    await service.updateMeeting(meeting.id, { tags: ['sales', 'sales', 'internal', 'support', 'customer'] });

    const fsPromises = require('fs/promises') as { writeFile: jest.Mock };
    const markdownCall = fsPromises.writeFile.mock.calls.find(([target]) => String(target).endsWith('.md'));
    expect(markdownCall).toBeDefined();

    const [, content] = markdownCall!;
    expect(content).toMatch(/"?tags"?:/);
    expect((content.match(/- "?sales"?/g) || []).length).toBe(1);
    expect(content).toMatch(/- "?internal"?/);
    expect(content).toMatch(/- "?support"?/);
    expect(content).not.toMatch(/- "?customer"?/);

    const updated = (service as any).meetingsCache.get(meeting.id) as Meeting;
    expect(updated.tags).toEqual(['sales', 'internal', 'support']);
  });

  it('persists manual status updates', async () => {
    const { service } = createStorageService();
    const meeting = buildTouchedMeeting({
      status: 'completed',
      filePath: '/tmp/meeting-storage/2025/10/manual-status.md'
    });
    (service as any).meetingsCache.set(meeting.id, meeting);
    diskMeetingsByPath.set(meeting.filePath!, { ...meeting });

    const updated = await service.updateMeeting(meeting.id, { status: 'scheduled' });

    expect(updated.status).toBe('scheduled');
    const cached = (service as any).meetingsCache.get(meeting.id) as Meeting;
    expect(cached.status).toBe('scheduled');

    const fsPromises = require('fs/promises') as { writeFile: jest.Mock };
    const markdownCall = fsPromises.writeFile.mock.calls.find(([target]) => String(target).endsWith('.md'));
    expect(markdownCall).toBeDefined();
    expect(markdownCall?.[1]).toMatch(/"?status"?: "?scheduled"?/);
  });

  it('preserves recording status when disk copy reports completed during transcript updates', async () => {
    const { service } = createStorageService();
    const filePath = '/tmp/meeting-storage/2025/11/recording-meeting.md';
    const meeting = buildTouchedMeeting({
      status: 'recording',
      transcript: 'existing line',
      filePath
    });
    (service as any).meetingsCache.set(meeting.id, meeting);

    diskMeetingsByPath.set(filePath, {
      ...meeting,
      status: 'completed'
    });

    const updated = await service.updateMeeting(meeting.id, { transcript: 'existing line\nnew line' });

    expect(updated.status).toBe('recording');
    const cached = (service as any).meetingsCache.get(meeting.id) as Meeting;
    expect(cached.status).toBe('recording');

    const fsPromises = require('fs/promises') as { writeFile: jest.Mock };
    const markdownCall = fsPromises.writeFile.mock.calls.find(([target]) => String(target).endsWith('.md'));
    expect(markdownCall).toBeDefined();
    expect(markdownCall?.[1]).toMatch(/"?status"?: "?recording"?/);
  });

  it('preserves prep notes closing marker when cached notes are stale', async () => {
    const { service } = createStorageService();
    const filePath = '/tmp/meeting-storage/2025/11/mindstone-x-mvpr-weekly-call.md';
    const cachedMeeting = buildTouchedMeeting({
      title: 'Mindstone x MVPR weekly call',
      calendarEventId: 'mvpr-event',
      filePath,
      notes: '<!-- PREP_NOTES -->\nCached prep content without closing marker'
    });
    (service as any).meetingsCache.set(cachedMeeting.id, cachedMeeting);

    diskMeetingsByPath.set(filePath, {
      ...cachedMeeting,
      notes: '<!-- PREP_NOTES -->\nCached prep content without closing marker\n<!-- /PREP_NOTES -->'
    });

    await service.updateMeeting(cachedMeeting.id, {
      date: new Date('2025-11-10T08:45:00Z')
    });

    const fsPromises = require('fs/promises') as { writeFile: jest.Mock };
    const prepWriteCall = fsPromises.writeFile.mock.calls.find(([, content]) =>
      typeof content === 'string' && content.includes('<!-- PREP_NOTES -->')
    );
    expect(prepWriteCall).toBeDefined();
    expect(prepWriteCall?.[1]).toContain('<!-- /PREP_NOTES -->');

    const updatedMeeting = (service as any).meetingsCache.get(cachedMeeting.id) as Meeting;
    expect(updatedMeeting.notes).toContain('<!-- /PREP_NOTES -->');
  });
});

describe('StorageService.smartSyncCalendarEvents - moved meetings', () => {
  it('re-associates touched recurring meeting when the instance is rescheduled', async () => {
    const { service } = createStorageService();
    const meeting = buildTouchedMeeting();
    (service as any).meetingsCache.set(meeting.id, meeting);

    const updateMeetingMock = jest
      .spyOn(service, 'updateMeeting')
      .mockImplementation(async (id, updates) => {
        const current = (service as any).meetingsCache.get(id) as Meeting;
        const updated: Meeting = { ...current, ...updates, calendarEventId: updates.calendarEventId ?? current.calendarEventId } as Meeting;
        (service as any).meetingsCache.set(id, updated);
        return updated;
      });

    const deleteMeetingMock = jest.spyOn(service, 'deleteMeeting').mockResolvedValue();

    const event = buildCalendarEvent();
    const result = await service.smartSyncCalendarEvents([event]);

    expect(updateMeetingMock).toHaveBeenCalledTimes(1);
    expect(updateMeetingMock).toHaveBeenCalledWith(
      meeting.id,
      expect.objectContaining({
        calendarEventId: event.id,
        date: event.start,
        startTime: event.start,
        endTime: event.end,
        meetingUrl: event.meetingUrl
      })
    );
    expect(result).toEqual(expect.objectContaining({ added: 0, updated: 1, deleted: 0 }));
    const updatedMeeting = (service as any).meetingsCache.get(meeting.id) as Meeting;
    expect(updatedMeeting.calendarEventId).toBe(event.id);
    expect(updatedMeeting.title.startsWith('[DELETED]')).toBe(false);
    expect(deleteMeetingMock).not.toHaveBeenCalled();
  });

  it('creates a new meeting when a completed instance is moved to a future date', async () => {
    const { service } = createStorageService();
    const meeting = buildTouchedMeeting({
      status: 'completed',
      endTime: new Date('2025-10-25T10:00:00Z'),
      transcript: 'Call transcript'
    });
    (service as any).meetingsCache.set(meeting.id, meeting);

    const updateMeetingMock = jest.spyOn(service, 'updateMeeting');

    const createMeetingMock = jest
      .spyOn(service, 'createMeeting')
      .mockImplementation(async (data) => {
        const now = new Date();
        const created: Meeting = {
          id: 'new-meeting-completed-reschedule',
          title: data.title ?? 'Untitled',
          date: data.date ?? now,
          startTime: data.startTime ?? data.date ?? now,
          endTime: data.endTime ?? now,
          attendees: data.attendees ?? [],
          status: data.status ?? 'scheduled',
          notes: data.notes ?? '',
          transcript: data.transcript ?? '',
          createdAt: now,
          updatedAt: now,
          calendarEventId: data.calendarEventId ?? 'new-id',
          meetingUrl: data.meetingUrl,
          calendarInviteUrl: data.calendarInviteUrl
        } as Meeting;
        return created;
      });

    const futureStart = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const futureEnd = new Date(futureStart.getTime() + 60 * 60 * 1000);

    const event = buildCalendarEvent({
      id: 'abc123_futureInstance',
      start: futureStart,
      end: futureEnd
    });

    const result = await service.smartSyncCalendarEvents([event]);

    expect(updateMeetingMock).not.toHaveBeenCalled();
    expect(createMeetingMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({ added: 1, updated: 0 }));

    const cachedMeeting = (service as any).meetingsCache.get(meeting.id) as Meeting;
    expect(cachedMeeting.calendarEventId).toBe('abc123_20251025T090000Z');
    expect(cachedMeeting.status).toBe('completed');
  });

  it('keeps touched meeting intact when only the base calendar event id matches', async () => {
    const { service } = createStorageService();
    const meeting = buildTouchedMeeting();
    (service as any).meetingsCache.set(meeting.id, meeting);

    const updateMeetingMock = jest
      .spyOn(service, 'updateMeeting')
      .mockImplementation(async (id, updates) => {
        const current = (service as any).meetingsCache.get(id) as Meeting;
        const updated: Meeting = { ...current, ...updates, calendarEventId: updates.calendarEventId ?? current.calendarEventId } as Meeting;
        (service as any).meetingsCache.set(id, updated);
        return updated;
      });

    const deleteMeetingMock = jest.spyOn(service, 'deleteMeeting').mockResolvedValue();

    const createMeetingMock = jest.spyOn(service, 'createMeeting').mockImplementation(async (data) => {
      const now = new Date();
      const created: Meeting = {
        id: 'new-meeting',
        title: data.title ?? 'Untitled',
        date: data.date ?? now,
        startTime: data.startTime ?? data.date ?? now,
        endTime: data.endTime ?? now,
        attendees: data.attendees ?? [],
        status: data.status ?? 'scheduled',
        notes: data.notes ?? '',
        transcript: data.transcript ?? '',
        createdAt: now,
        updatedAt: now,
        calendarEventId: data.calendarEventId ?? 'new-id',
        meetingUrl: data.meetingUrl,
        calendarInviteUrl: data.calendarInviteUrl
      } as Meeting;
      return created;
    });

    const farFutureEvent = buildCalendarEvent({
      id: 'abc123_20260115T090000Z',
      start: new Date('2026-01-15T09:00:00Z'),
      end: new Date('2026-01-15T10:00:00Z')
    });

    const result = await service.smartSyncCalendarEvents([farFutureEvent]);

    expect(createMeetingMock).toHaveBeenCalledTimes(1);
    expect(updateMeetingMock).not.toHaveBeenCalledWith(
      meeting.id,
      expect.objectContaining({ title: expect.stringMatching(/^\[DELETED]/) })
    );
    const cachedMeeting = (service as any).meetingsCache.get(meeting.id) as Meeting;
    expect(cachedMeeting.title).toBe(meeting.title);
    expect(result.deleted).toBe(0);
    expect(deleteMeetingMock).not.toHaveBeenCalled();
  });
});
