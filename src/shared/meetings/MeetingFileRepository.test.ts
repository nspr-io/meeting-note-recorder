import fs from 'fs/promises';
import { mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';

import { MeetingFileRepository } from './MeetingFileRepository';
import { serializeMeetingToMarkdown, generateMeetingFileName } from './MeetingFileSerializer';
import { sanitizeCalendarEventIdForFileName } from './calendarEventIdUtils';
import { Meeting } from '../types';

describe('MeetingFileRepository.savePrepSection', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'meeting-repo-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('updates prep notes for meetings where the filename contains a sanitized calendar event ID', async () => {
    const longCalendarEventId = 'pearson-event-' + 'x'.repeat(120);
    const repository = new MeetingFileRepository(tempDir);

    const meeting: Meeting = {
      id: 'existing-meeting',
      title: 'Pearson Interview',
      date: new Date('2025-11-04T13:30:00Z'),
      attendees: ['joshua@mindstone.com'],
      status: 'scheduled',
      notes: '',
      transcript: '',
      calendarEventId: longCalendarEventId,
      meetingUrl: 'https://example.com',
      createdAt: new Date('2025-10-20T09:00:00Z'),
      updatedAt: new Date('2025-10-20T09:00:00Z')
    };

    const sections = {
      calendarInfo: '',
      prepNotes: 'Old prep',
      meetingNotes: ''
    };

    const relativePath = generateMeetingFileName(meeting);
    const absolutePath = path.join(tempDir, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, serializeMeetingToMarkdown(meeting, sections));

    const updated = await repository.savePrepSection({
      calendarEventId: longCalendarEventId,
      prepContent: 'Updated prep notes'
    });

    expect(updated.sections.prepNotes).toBe('Updated prep notes');
    expect(updated.filePath).toContain(sanitizeCalendarEventIdForFileName(longCalendarEventId));
  });

  it('throws when the meeting is missing and allowCreate is false', async () => {
    const repository = new MeetingFileRepository(tempDir);

    await expect(
      repository.savePrepSection({
        calendarEventId: 'non-existent-event',
        prepContent: 'New prep without meeting'
      })
    ).rejects.toThrow('allowCreate');
  });

  it('creates a new meeting when allowCreate is true and metadata is provided', async () => {
    const repository = new MeetingFileRepository(tempDir);
    const calendarEventId = 'julie-meeting-' + 'y'.repeat(40);

    const result = await repository.savePrepSection({
      calendarEventId,
      meetingTitle: 'Julie McKeen Intro',
      meetingDate: '2025-11-05T15:30:00Z',
      meetingStart: '2025-11-05T15:30:00Z',
      meetingEnd: '2025-11-05T16:15:00Z',
      attendees: ['joshua@mindstone.com', 'julie@odgers.com'],
      meetingUrl: 'https://wework.com/rooms/123',
      calendarInviteUrl: 'https://calendar.google.com/event?eid=example',
      prepContent: 'Initial prep',
      allowCreate: true
    });

    expect(result.meeting.title).toBe('Julie McKeen Intro');
    expect(result.sections.prepNotes).toBe('Initial prep');
    expect(result.meeting.startTime).toBeInstanceOf(Date);
    expect(result.meeting.endTime).toBeInstanceOf(Date);
    expect(result.meeting.calendarInviteUrl).toBe('https://calendar.google.com/event?eid=example');
    expect(result.filePath).toContain(sanitizeCalendarEventIdForFileName(calendarEventId));

    const savedContent = await fs.readFile(result.filePath, 'utf-8');
    expect(savedContent).toContain('calendar_event_id');
    expect(savedContent).toContain('Julie McKeen Intro');
    expect(savedContent).toContain('Initial prep');
  });
});
