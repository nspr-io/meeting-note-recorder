import path from 'path';
import fs from 'fs/promises';
import matter from 'gray-matter';
import { format } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';
import YAML from 'yaml';
import { Type as YamlAstType } from 'yaml/util';

import { Meeting } from '../types';
import {
  NoteSections,
  extractNoteSections,
  combineNoteSections
} from '../../renderer/components/noteSectionUtils';

export interface MeetingDeserializationOptions {
  filePath?: string;
  storagePath?: string;
  loadInsights?: boolean;
  readInsightsFile?: (absolutePath: string) => Promise<string>;
}

export interface MeetingDeserializationResult {
  meeting: Meeting;
  sections: NoteSections;
  transcript: string;
  frontmatter: Record<string, unknown>;
  insightsLoadError?: unknown;
}

export interface MeetingSerializationOptions {
  updatedAt?: Date;
}

const VALID_PLATFORMS: ReadonlySet<NonNullable<Meeting['platform']>> = new Set([
  'zoom',
  'googlemeet',
  'teams',
  'slack',
  'manual',
  'webex',
  'other'
]);

function normalizePlatform(value: unknown): Meeting['platform'] {
  if (typeof value === 'string' && VALID_PLATFORMS.has(value as NonNullable<Meeting['platform']>)) {
    return value as Meeting['platform'];
  }
  return undefined;
}

export function extractStructuredSections(bodyContent: string): {
  notesContent: string;
  transcriptContent: string;
} {
  const normalized = bodyContent.replace(/\r\n/g, '\n');
  const sections = normalized.split('\n---\n');
  const notesSection = sections.find((section) => section.includes('# Meeting Notes')) ?? '';
  const transcriptSection = sections.find((section) => section.includes('# Transcript')) ?? '';

  const notesContent = notesSection.replace(/# Meeting Notes\s*/i, '').trim();
  const transcriptContent = transcriptSection.replace(/# Transcript\s*/i, '').trim();

  return { notesContent, transcriptContent };
}

export async function deserializeMeetingMarkdown(
  markdown: string,
  options: MeetingDeserializationOptions = {}
): Promise<MeetingDeserializationResult> {
  const { data, content } = matter(markdown);
  const { notesContent, transcriptContent } = extractStructuredSections(content);
  const sections = extractNoteSections(notesContent);
  const meeting = composeMeetingFromFrontmatter(data, sections, transcriptContent, options.filePath);

  let insightsLoadError: unknown;

  if (options.loadInsights && meeting.insightsFilePath) {
    const storagePath = options.storagePath;
    const absolutePath = resolveInsightsAbsolutePath(meeting.insightsFilePath, {
      storagePath,
      filePath: options.filePath
    });

    if (absolutePath) {
      try {
        const reader = options.readInsightsFile ?? (async (target: string) => fs.readFile(target, 'utf-8'));
        meeting.insights = await reader(absolutePath);
      } catch (error) {
        insightsLoadError = error;
      }
    }
  }

  return {
    meeting,
    sections,
    transcript: transcriptContent,
    frontmatter: data,
    insightsLoadError
  };
}

export function serializeMeetingToMarkdown(
  meeting: Meeting,
  sections: NoteSections,
  options: MeetingSerializationOptions = {}
): string {
  const normalizedMeeting = sanitizeMeetingForFrontmatter({
    ...meeting,
    updatedAt: options.updatedAt ?? meeting.updatedAt
  });

  const frontmatter = buildFrontmatter(normalizedMeeting);
  const notesBody = combineNoteSections(sections);
  const transcriptBody = typeof normalizedMeeting.transcript === 'string' ? normalizedMeeting.transcript : '';

  return `${frontmatter}
# Meeting Notes

${notesBody ? `${notesBody}

` : ''}---

# Transcript

${transcriptBody}
`;
}

export function generateMeetingFileName(meeting: Meeting): string {
  const normalizedDate = normalizeDateInput(meeting.date) ?? new Date();
  const year = format(normalizedDate, 'yyyy');
  const month = format(normalizedDate, 'MM');
  const timestamp = format(normalizedDate, 'yyyy-MM-dd-HH-mm');

  const eventIdPart = meeting.calendarEventId
    ? `[${meeting.calendarEventId.replace(/[^a-zA-Z0-9-_]/g, '').substring(0, 50)}]-`
    : '';

  const title = typeof meeting.title === 'string' ? meeting.title : 'untitled';
  const titleSlug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 100);

  return path.join(year, month, `${timestamp}-${eventIdPart}${titleSlug}.md`);
}

export function inferDateFromFilename(filename: string): Date | null {
  const match = filename.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/);
  if (!match) {
    return null;
  }

  const [, year, month, day, hours, minutes] = match;
  const date = new Date(`${year}-${month}-${day}T${hours}:${minutes}:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function inferDateFromDirectory(filePath: string): Date | null {
  const parentDir = path.basename(path.dirname(filePath));
  const weekMatch = parentDir.match(/^Week_(\d{4})-(\d{2})-(\d{2})_to_(\d{4})-(\d{2})-(\d{2})$/);
  if (weekMatch) {
    const [, year, month, day] = weekMatch;
    const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  const simpleMatch = parentDir.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (simpleMatch) {
    const [, year, month, day] = simpleMatch;
    const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  return null;
}

function composeMeetingFromFrontmatter(
  data: Record<string, unknown>,
  sections: NoteSections,
  transcript: string,
  filePath?: string
): Meeting {
  const id = typeof data.id === 'string' && data.id.trim() ? data.id : uuidv4();
  const parsedDate = normalizeDateInput(data.date);
  const inferredDate =
    parsedDate ??
    (filePath ? inferDateFromFilename(path.basename(filePath)) : null) ??
    (filePath ? inferDateFromDirectory(filePath) : null) ??
    new Date();

  const startTime = normalizeDateInput((data as any).start_time ?? (data as any).startTime);
  const endTime = normalizeDateInput((data as any).end_time ?? (data as any).endTime);
  const firefliesFetchedAtRaw = (data as any).fireflies_transcript_fetched_at ?? (data as any).firefliesTranscriptFetchedAt;
  const firefliesFetchedAt = firefliesFetchedAtRaw === null ? null : normalizeDateInput(firefliesFetchedAtRaw);

  const meeting: Meeting = {
    id,
    title: typeof data.title === 'string' && data.title.trim() ? data.title : 'Untitled Meeting',
    date: inferredDate,
    attendees: Array.isArray(data.attendees) ? data.attendees : [],
    duration: typeof data.duration === 'number' ? data.duration : undefined,
    platform: normalizePlatform((data as any).platform),
    recallRecordingId: (data as any).recall_recording_id ?? (data as any).recallRecordingId,
    recallVideoUrl: (data as any).recall_video_url ?? (data as any).recallVideoUrl,
    recallAudioUrl: (data as any).recall_audio_url ?? (data as any).recallAudioUrl,
    calendarEventId: (data as any).calendar_event_id ?? (data as any).calendarEventId,
    meetingUrl: (data as any).meeting_url ?? (data as any).meetingUrl,
    calendarInviteUrl: (data as any).calendar_invite_url ?? (data as any).calendarInviteUrl,
    status: typeof data.status === 'string' ? (data.status as Meeting['status']) : 'completed',
    startTime: startTime ?? undefined,
    endTime: endTime ?? undefined,
    notes: combineNoteSections(sections),
    transcript,
    insights: typeof (data as any).insights === 'string' ? (data as any).insights : undefined,
    insightsFilePath: typeof (data as any).insights_file === 'string' ? (data as any).insights_file : undefined,
    actionItemSyncStatus: Array.isArray((data as any).action_item_sync_status)
      ? ((data as any).action_item_sync_status as Meeting['actionItemSyncStatus'])
      : undefined,
    tags: Array.isArray((data as any).tags)
      ? (data as any).tags.filter((tag: unknown): tag is string => typeof tag === 'string' && tag.trim().length > 0)
      : undefined,
    teamSummary: typeof (data as any).team_summary === 'string' ? (data as any).team_summary : undefined,
    slackSharedAt: normalizeDateInput((data as any).slack_shared_at) ?? undefined,
    notionSharedAt:
      (data as any).notion_shared_at === null
        ? null
        : normalizeDateInput((data as any).notion_shared_at) ?? undefined,
    notionPageId: (data as any).notion_page_id ?? null,
    filePath,
    createdAt: normalizeDateInput((data as any).created_at) ?? new Date(),
    updatedAt: normalizeDateInput((data as any).updated_at) ?? new Date(),
    autoRecordApproved: typeof (data as any).auto_record_approved === 'boolean'
      ? (data as any).auto_record_approved
      : undefined,
    firefliesTranscriptId: (data as any).fireflies_transcript_id ?? (data as any).firefliesTranscriptId,
    firefliesTranscriptFetchedAt: firefliesFetchedAt ?? (typeof firefliesFetchedAtRaw === 'string' ? firefliesFetchedAtRaw : undefined)
  };

  return meeting;
}

function buildFrontmatter(meeting: Meeting): string {
  const frontmatter: Record<string, unknown> = {
    id: meeting.id,
    title: meeting.title,
    date: (normalizeDateInput(meeting.date) ?? new Date()).toISOString(),
    attendees: meeting.attendees,
    status: meeting.status,
    created_at: (normalizeDateInput(meeting.createdAt) ?? new Date()).toISOString(),
    updated_at: (normalizeDateInput(meeting.updatedAt) ?? new Date()).toISOString()
  };

  if (typeof meeting.duration === 'number') {
    frontmatter.duration = meeting.duration;
  }

  const startTime = normalizeDateInput(meeting.startTime);
  if (startTime) {
    frontmatter.start_time = startTime.toISOString();
  }

  const endTime = normalizeDateInput(meeting.endTime);
  if (endTime) {
    frontmatter.end_time = endTime.toISOString();
  }

  if (meeting.recallRecordingId !== undefined) {
    frontmatter.recall_recording_id = meeting.recallRecordingId;
  }

  if (meeting.recallVideoUrl !== undefined) {
    frontmatter.recall_video_url = meeting.recallVideoUrl;
  }

  if (meeting.recallAudioUrl !== undefined) {
    frontmatter.recall_audio_url = meeting.recallAudioUrl;
  }

  if (meeting.calendarEventId !== undefined) {
    frontmatter.calendar_event_id = meeting.calendarEventId;
  }

  if (meeting.meetingUrl !== undefined) {
    frontmatter.meeting_url = meeting.meetingUrl;
  }

  if (meeting.calendarInviteUrl !== undefined) {
    frontmatter.calendar_invite_url = meeting.calendarInviteUrl;
  }

  if (meeting.firefliesTranscriptId) {
    frontmatter.fireflies_transcript_id = meeting.firefliesTranscriptId;
  }

  if (meeting.firefliesTranscriptFetchedAt instanceof Date) {
    frontmatter.fireflies_transcript_fetched_at = meeting.firefliesTranscriptFetchedAt.toISOString();
  } else if (typeof meeting.firefliesTranscriptFetchedAt === 'string') {
    frontmatter.fireflies_transcript_fetched_at = meeting.firefliesTranscriptFetchedAt;
  }

  if (meeting.notionSharedAt instanceof Date) {
    frontmatter.notion_shared_at = meeting.notionSharedAt.toISOString();
  } else if (typeof meeting.notionSharedAt === 'string') {
    frontmatter.notion_shared_at = meeting.notionSharedAt;
  }

  if (meeting.notionPageId) {
    frontmatter.notion_page_id = meeting.notionPageId;
  }

  if (meeting.insightsFilePath) {
    frontmatter.insights_file = meeting.insightsFilePath;
  }

  if (meeting.actionItemSyncStatus) {
    frontmatter.action_item_sync_status = meeting.actionItemSyncStatus;
  }

  if (meeting.tags && meeting.tags.length > 0) {
    frontmatter.tags = meeting.tags;
  }

  Object.keys(frontmatter).forEach((key) => {
    if (frontmatter[key] === undefined) {
      delete frontmatter[key];
    }
  });

  YAML.scalarOptions.str.defaultType = YamlAstType.QUOTE_DOUBLE;
  const yamlContent = YAML.stringify(frontmatter);

  return `---\n${yamlContent}---`;
}

function normalizeDateInput(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

function sanitizeMeetingForFrontmatter(meeting: Meeting): Meeting {
  const normalized: Meeting = {
    ...meeting,
    attendees: Array.isArray(meeting.attendees) ? meeting.attendees : [],
    status: meeting.status ?? 'scheduled',
    notes: typeof meeting.notes === 'string' ? meeting.notes : '',
    transcript: typeof meeting.transcript === 'string' ? meeting.transcript : '',
    createdAt: normalizeDateInput(meeting.createdAt) ?? new Date(),
    updatedAt: normalizeDateInput(meeting.updatedAt) ?? new Date()
  };

  const date = normalizeDateInput(meeting.date);
  normalized.date = date ?? new Date();

  const start = normalizeDateInput(meeting.startTime);
  normalized.startTime = start ?? undefined;

  const end = normalizeDateInput(meeting.endTime);
  normalized.endTime = end ?? undefined;

  if (meeting.notionSharedAt === null) {
    normalized.notionSharedAt = null;
  } else {
    const notionShared = normalizeDateInput(meeting.notionSharedAt);
    normalized.notionSharedAt = notionShared ?? (typeof meeting.notionSharedAt === 'string' ? meeting.notionSharedAt : undefined);
  }

  if (meeting.slackSharedAt) {
    const slackDate = normalizeDateInput(meeting.slackSharedAt);
    normalized.slackSharedAt = slackDate ?? meeting.slackSharedAt;
  }

  if (meeting.firefliesTranscriptFetchedAt) {
    const fetchedAt = normalizeDateInput(meeting.firefliesTranscriptFetchedAt);
    normalized.firefliesTranscriptFetchedAt = fetchedAt ?? meeting.firefliesTranscriptFetchedAt;
  }

  if (Array.isArray(meeting.tags)) {
    normalized.tags = meeting.tags
      .filter((tag) => typeof tag === 'string')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
    if (normalized.tags.length === 0) {
      delete normalized.tags;
    }
  } else {
    delete (normalized as any).tags;
  }

  return normalized;
}

function resolveInsightsAbsolutePath(
  insightsPath: string,
  options: { storagePath?: string; filePath?: string }
): string | null {
  if (!insightsPath.trim()) {
    return null;
  }

  if (path.isAbsolute(insightsPath)) {
    return insightsPath;
  }

  if (options.storagePath) {
    return path.join(options.storagePath, insightsPath);
  }

  if (options.filePath) {
    return path.join(path.dirname(options.filePath), insightsPath);
  }

  return null;
}
