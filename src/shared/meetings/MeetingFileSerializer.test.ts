jest.mock('uuid', () => ({
  v4: () => 'mock-uuid'
}));

import { Meeting } from '../types';
import {
  deserializeMeetingMarkdown,
  generateMeetingFileName,
  serializeMeetingToMarkdown
} from './MeetingFileSerializer';
import {
  combineNoteSections,
  NoteSections
} from '../../renderer/components/noteSectionUtils';
import { format } from 'date-fns';

describe('MeetingFileSerializer', () => {
  const baseSections: NoteSections = {
    calendarInfo: 'Project: Apollo\nHost: Taylor',
    prepNotes: 'Review quarterly targets',
    meetingNotes: 'Decisions:\n- Launch in Q1'
  };

  const baseMeeting: Meeting = {
    id: 'meeting-123',
    title: 'Team Sync',
    date: new Date('2025-10-01T10:00:00Z'),
    attendees: ['alice@example.com', 'bob@example.com'],
    status: 'completed',
    notes: combineNoteSections(baseSections),
    transcript: 'Hello team, welcome to the sync.',
    tags: ['sales', 'internal'],
    createdAt: new Date('2025-10-01T09:45:00Z'),
    updatedAt: new Date('2025-10-01T10:30:00Z'),
    calendarEventId: 'event-123',
    meetingUrl: 'https://meet.example.com/abc',
    insightsFilePath: '2025/10/meeting-123-insights.json',
    firefliesTranscriptId: 'ff_tr_123456',
    firefliesTranscriptFetchedAt: new Date('2025-10-01T10:10:00Z')
  } as Meeting;

  it('serializes and deserializes meeting markdown without data loss', async () => {
    const markdown = serializeMeetingToMarkdown(baseMeeting, baseSections, {
      updatedAt: baseMeeting.updatedAt as Date
    });

    const { meeting, sections, transcript } = await deserializeMeetingMarkdown(markdown, {
      filePath: '/storage/2025/10/2025-10-01-10-00-[event-123]-team-sync.md'
    });

    expect(meeting.title).toBe(baseMeeting.title);
    expect(meeting.calendarEventId).toBe(baseMeeting.calendarEventId);
    expect(meeting.status).toBe(baseMeeting.status);
    expect(meeting.notes).toBe(baseMeeting.notes);
    expect(transcript).toBe(baseMeeting.transcript);
    expect(sections).toEqual(baseSections);
    expect(meeting.insightsFilePath).toBe(baseMeeting.insightsFilePath);
    expect(meeting.firefliesTranscriptId).toBe(baseMeeting.firefliesTranscriptId);
    const fetchedAt = meeting.firefliesTranscriptFetchedAt instanceof Date
      ? meeting.firefliesTranscriptFetchedAt.toISOString()
      : new Date(meeting.firefliesTranscriptFetchedAt as string).toISOString();
    expect(fetchedAt).toBe((baseMeeting.firefliesTranscriptFetchedAt as Date).toISOString());
    expect(meeting.tags).toEqual(baseMeeting.tags);
  });

  it('loads insights content via provided reader when requested', async () => {
    const markdown = serializeMeetingToMarkdown(baseMeeting, baseSections, {
      updatedAt: baseMeeting.updatedAt as Date
    });

    const expectedInsights = '{"summary":"from-file"}';
    const { meeting, insightsLoadError } = await deserializeMeetingMarkdown(markdown, {
      filePath: '/storage/2025/10/2025-10-01-10-00-[event-123]-team-sync.md',
      storagePath: '/storage',
      loadInsights: true,
      readInsightsFile: async () => expectedInsights
    });

    expect(insightsLoadError).toBeUndefined();
    expect(meeting.insights).toBe(expectedInsights);
  });

  it('preserves prep closing marker when prep content includes horizontal rules', async () => {
    const markdown = `---
id: prep-hr-test
title: Prep HR Test
date: 2025-11-02T15:00:00.000Z
---
# Meeting Notes

<!-- PREP_NOTES -->
Agenda item A

---

**Prepared**: Nov 2, 2025 | **Timezone**: GMT
<!-- /PREP_NOTES -->

---

# Transcript

Transcript body goes here.
`;

    const { meeting, sections } = await deserializeMeetingMarkdown(markdown, {
      filePath: '/storage/2025/11/2025-11-02-15-00-[prep-hr-test]-prep-hr-test.md'
    });

    expect(sections.prepNotes).toContain('Agenda item A');
    expect(sections.prepNotes).toContain('**Prepared**: Nov 2, 2025');
    expect(sections.meetingNotes).toBe('');
    expect(meeting.notes.trim().endsWith('<!-- /PREP_NOTES -->')).toBe(true);
  });

  it('generates deterministic filenames using meeting metadata', () => {
    const fileName = generateMeetingFileName(baseMeeting);
    const date = new Date(baseMeeting.date);
    const expected = `${format(date, 'yyyy')}/${format(date, 'MM')}/${format(date, 'yyyy-MM-dd-HH-mm')}-[event-123]-team-sync.md`;
    expect(fileName).toBe(expected);
  });
});
