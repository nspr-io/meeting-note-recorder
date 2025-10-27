import { StorageService } from './StorageService';
import type { Meeting, CalendarEvent } from '../../shared/types';
import type { SettingsService } from './SettingsService';

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

describe('StorageService.smartSyncCalendarEvents - moved meetings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

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
