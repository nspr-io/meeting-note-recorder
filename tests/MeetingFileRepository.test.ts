import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { MeetingFileRepository } from '../src/shared/meetings/MeetingFileRepository';

describe('MeetingFileRepository', () => {
  let tempDir: string;
  let repository: MeetingFileRepository;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'meeting-repo-test-'));
    repository = new MeetingFileRepository(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('locates meeting files using sanitized calendar event ids', async () => {
    const calendarEventId = 'abc123@google.com';

    await repository.savePrepSection({
      calendarEventId,
      meetingTitle: 'Sanitization Test',
      meetingDate: '2024-11-02T10:00:00Z',
      attendees: [],
      prepContent: 'Initial prep'
    });

    const filePath = await repository.findFileByCalendarId(calendarEventId);
    expect(filePath).not.toBeNull();
    expect(filePath).toContain('[abc123googlecom]');

    const loaded = await repository.loadByCalendarId(calendarEventId);
    expect(loaded?.meeting.calendarEventId).toBe(calendarEventId);
  });

  it('creates a new file instead of reusing a different recurring instance', async () => {
    await repository.savePrepSection({
      calendarEventId: 'recurring123_1',
      meetingTitle: 'Recurring Original',
      meetingDate: '2024-10-29T09:00:00Z',
      attendees: [],
      prepContent: 'Original prep'
    });

    const filePath = await repository.findFileByCalendarId('recurring123_2');
    expect(filePath).toBeNull();
  });

  it('parses flexible meeting date formats when creating new files', async () => {
    const calendarEventId = 'date-test';
    await repository.savePrepSection({
      calendarEventId,
      meetingTitle: 'Date Parsing',
      meetingDate: '2024-11-03 11:30',
      attendees: [],
      prepContent: 'Prep notes'
    });

    const loaded = await repository.loadByCalendarId(calendarEventId);
    expect(loaded).not.toBeNull();

    const meetingDate = loaded!.meeting.date instanceof Date
      ? loaded!.meeting.date
      : new Date(loaded!.meeting.date as string);

    expect(meetingDate.getFullYear()).toBe(2024);
    expect(meetingDate.getMonth()).toBe(10); // November (0-indexed)
    expect(meetingDate.getDate()).toBe(3);
    expect(meetingDate.getHours()).toBe(11);
    expect(meetingDate.getMinutes()).toBe(30);
  });
});
