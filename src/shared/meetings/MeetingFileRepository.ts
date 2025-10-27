import fs from 'fs/promises';
import { existsSync, Dirent } from 'fs';
import path from 'path';
import os from 'os';
import matter from 'gray-matter';
import { format } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';
import YAML from 'yaml';

import { Meeting } from '../types';
import {
  extractNoteSections,
  combineNoteSections,
  NoteSections
} from '../../renderer/components/noteSectionUtils';

export interface MeetingFileData {
  meeting: Meeting;
  sections: NoteSections;
  filePath: string;
}

export interface PrepSectionSaveOptions {
  calendarEventId: string;
  meetingTitle?: string;
  meetingDate?: string;
  attendees?: string[];
  meetingUrl?: string;
  prepContent: string;
}

export class MeetingFileRepository {
  constructor(private readonly storagePath: string) {}

  getStoragePath(): string {
    return this.storagePath;
  }

  async findFileByCalendarId(calendarEventId: string): Promise<string | null> {
    const baseId = calendarEventId.split('_')[0];
    const monthDirs = await this.listMonthDirectories();

    for (const dir of monthDirs) {
      let entries: string[] = [];
      try {
        entries = await fs.readdir(dir);
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.endsWith('.md') || entry.includes('-deleted-')) {
          continue;
        }

        if (entry.includes(`[${calendarEventId}]`) || entry.includes(`[${baseId}]`)) {
          return path.join(dir, entry);
        }
      }
    }

    return null;
  }

  async loadByCalendarId(calendarEventId: string): Promise<MeetingFileData | null> {
    const filePath = await this.findFileByCalendarId(calendarEventId);
    if (!filePath) {
      return null;
    }

    const meetingData = await this.loadByFilePath(filePath);
    return meetingData;
  }

  async loadByFilePath(filePath: string): Promise<MeetingFileData | null> {
    try {
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const { data, content: bodyContent } = matter(fileContent);

      const { notesContent, transcriptContent } = this.extractStructuredSections(bodyContent);
      const sections = this.parseSections(notesContent);
      const meeting = this.composeMeetingFromFrontmatter(data, sections, transcriptContent, filePath);

      return {
        meeting,
        sections,
        filePath
      };
    } catch (error) {
      console.error(`[MeetingFileRepository] Failed to load file ${filePath}:`, error);
      return null;
    }
  }

  async listMeetings(options?: { monthsBack?: number; monthsForward?: number }): Promise<MeetingFileData[]> {
    const monthsBack = options?.monthsBack ?? 12;
    const monthsForward = options?.monthsForward ?? 1;

    const files = await this.collectMarkdownFilesWithinRange(monthsBack, monthsForward);
    const meetings: MeetingFileData[] = [];

    for (const file of files) {
      const meeting = await this.loadByFilePath(file);
      if (meeting) {
        meetings.push(meeting);
      }
    }

    return meetings;
  }

  async savePrepSection(options: PrepSectionSaveOptions): Promise<MeetingFileData> {
    const {
      calendarEventId,
      meetingTitle,
      meetingDate,
      attendees = [],
      meetingUrl,
      prepContent
    } = options;

    if (!prepContent || !prepContent.trim()) {
      throw new Error('prepContent is required');
    }

    let existing = await this.loadByCalendarId(calendarEventId);

    if (!existing) {
      if (!meetingTitle || !meetingDate) {
        throw new Error('meetingTitle and meetingDate are required when creating a new file');
      }

      const filePath = await this.createMeetingFile({
        calendarEventId,
        meetingTitle,
        meetingDate,
        attendees,
        meetingUrl,
        prepContent
      });

      existing = await this.loadByFilePath(filePath);
      if (!existing) {
        throw new Error('Failed to create new meeting file');
      }

      return existing;
    }

    const updatedSections: NoteSections = {
      calendarInfo: existing.sections.calendarInfo,
      prepNotes: prepContent,
      meetingNotes: existing.sections.meetingNotes
    };

    await this.writeMeetingContent(existing.meeting, updatedSections, existing.filePath);

    const refreshed = await this.loadByFilePath(existing.filePath);
    if (!refreshed) {
      throw new Error('Failed to reload meeting after update');
    }

    return refreshed;
  }

  private async createMeetingFile(params: {
    calendarEventId: string;
    meetingTitle: string;
    meetingDate: string;
    attendees: string[];
    meetingUrl?: string;
    prepContent: string;
  }): Promise<string> {
    const {
      calendarEventId,
      meetingTitle,
      meetingDate,
      attendees,
      meetingUrl,
      prepContent
    } = params;

    const meeting: Meeting = {
      id: uuidv4(),
      title: meetingTitle,
      date: new Date(meetingDate),
      attendees: attendees ?? [],
      status: 'scheduled',
      notes: '',
      transcript: '',
      calendarEventId,
      meetingUrl,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const sections: NoteSections = {
      calendarInfo: '',
      prepNotes: prepContent,
      meetingNotes: ''
    };

    const relativeFilePath = this.generateFileName(meeting);
    const absolutePath = path.join(this.storagePath, relativeFilePath);

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await this.writeMeetingContent(meeting, sections, absolutePath);

    return absolutePath;
  }

  private async writeMeetingContent(meeting: Meeting, sections: NoteSections, filePath: string): Promise<void> {
    const sanitizedMeeting = this.sanitizeMeetingForFrontmatter(meeting);
    sanitizedMeeting.updatedAt = new Date();

    const frontmatter = this.buildFrontmatter(sanitizedMeeting);
    const notesBody = combineNoteSections(sections);

    const content = `${frontmatter}
# Meeting Notes

${notesBody ? `${notesBody}

` : ''}---

# Transcript

${sanitizedMeeting.transcript || ''}
`;

    await fs.writeFile(filePath, content, 'utf-8');
  }

  private sanitizeMeetingForFrontmatter(meeting: Meeting): Meeting {
    const normalized: Meeting = {
      ...meeting,
      attendees: Array.isArray(meeting.attendees) ? meeting.attendees : [],
      status: meeting.status ?? 'scheduled',
      notes: meeting.notes ?? '',
      transcript: meeting.transcript ?? '',
      createdAt: meeting.createdAt ?? new Date(),
      updatedAt: meeting.updatedAt ?? new Date()
    };

    if (typeof normalized.date === 'string') {
      normalized.date = new Date(normalized.date);
    }

    return normalized;
  }

  private buildFrontmatter(meeting: Meeting): string {
    const yaml: Record<string, unknown> = {
      id: meeting.id,
      title: meeting.title,
      date: (meeting.date instanceof Date ? meeting.date : new Date(meeting.date)).toISOString(),
      attendees: meeting.attendees,
      status: meeting.status,
      created_at: meeting.createdAt instanceof Date ? meeting.createdAt.toISOString() : meeting.createdAt,
      updated_at: meeting.updatedAt instanceof Date ? meeting.updatedAt.toISOString() : meeting.updatedAt,
      calendar_event_id: meeting.calendarEventId,
      meeting_url: meeting.meetingUrl,
      duration: meeting.duration,
      recall_recording_id: (meeting as any).recallRecordingId,
      recall_video_url: (meeting as any).recallVideoUrl,
      recall_audio_url: (meeting as any).recallAudioUrl,
      calendar_invite_url: (meeting as any).calendarInviteUrl,
      notion_shared_at: meeting.notionSharedAt instanceof Date ? meeting.notionSharedAt.toISOString() : meeting.notionSharedAt,
      notion_page_id: meeting.notionPageId,
      insights_file: (meeting as any).insightsFilePath,
      action_item_sync_status: (meeting as any).actionItemSyncStatus
    };

    Object.keys(yaml).forEach((key) => {
      const value = (yaml as Record<string, unknown>)[key];
      if (value === undefined || value === null) {
        delete (yaml as Record<string, unknown>)[key];
      }
    });

    const yamlContent = YAML.stringify(yaml);

    return `---\n${yamlContent}---`;
  }

  private extractStructuredSections(bodyContent: string): { notesContent: string; transcriptContent: string } {
    const normalized = bodyContent.replace(/\r\n/g, '\n');
    const sections = normalized.split('\n---\n');
    const notesSection = sections.find((section) => section.includes('# Meeting Notes')) ?? '';
    const transcriptSection = sections.find((section) => section.includes('# Transcript')) ?? '';

    const notesContent = notesSection.replace(/# Meeting Notes\s*/i, '').trim();
    const transcriptContent = transcriptSection.replace(/# Transcript\s*/i, '').trim();

    return { notesContent, transcriptContent };
  }

  private parseSections(notesContent: string): NoteSections {
    const sections = extractNoteSections(notesContent);
    return sections;
  }

  private composeMeetingFromFrontmatter(data: any, sections: NoteSections, transcript: string, filePath: string): Meeting {
    let parsedDate: Date | null = null;
    if (data.date) {
      const candidate = new Date(data.date);
      if (!Number.isNaN(candidate.getTime())) {
        parsedDate = candidate;
      }
    }

    const inferredDate =
      parsedDate ??
      this.inferDateFromFilename(path.basename(filePath)) ??
      this.inferDateFromDirectory(filePath) ??
      new Date();

    const meeting: Meeting = {
      id: data.id ?? uuidv4(),
      title: data.title ?? 'Untitled Meeting',
      date: inferredDate,
      attendees: Array.isArray(data.attendees) ? data.attendees : [],
      duration: data.duration,
      status: data.status ?? 'completed',
      notes: combineNoteSections(sections),
      transcript,
      calendarEventId: data.calendar_event_id,
      meetingUrl: data.meeting_url,
      calendarInviteUrl: data.calendar_invite_url,
      createdAt: data.created_at ? new Date(data.created_at) : new Date(),
      updatedAt: data.updated_at ? new Date(data.updated_at) : new Date(),
      notionSharedAt: data.notion_shared_at ? new Date(data.notion_shared_at) : null,
      notionPageId: data.notion_page_id ?? null,
      insights: data.insights,
      insightsFilePath: data.insights_file,
      filePath
    };
    return meeting;
  }

  private async collectMarkdownFilesWithinRange(monthsBack: number, monthsForward: number): Promise<string[]> {
    const results: string[] = [];
    const now = new Date();

    const minDate = new Date(now);
    minDate.setMonth(minDate.getMonth() - monthsBack);

    const maxDate = new Date(now);
    maxDate.setMonth(maxDate.getMonth() + monthsForward);

    const yearDirs = await this.listYearDirectories();

    for (const yearDir of yearDirs) {
      let yearEntries: Dirent[] = [];
      try {
        yearEntries = await fs.readdir(yearDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of yearEntries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const monthDir = path.join(yearDir, entry.name);

        const files = await this.collectMarkdownFiles(monthDir);
        for (const file of files) {
          const inferredDate = await this.inferDateForFile(file);
          if (!inferredDate) {
            results.push(file);
            continue;
          }

          if (inferredDate >= minDate && inferredDate <= maxDate) {
            results.push(file);
          }
        }
      }
    }

    return results;
  }

  private async collectMarkdownFiles(directory: string): Promise<string[]> {
    const files: string[] = [];

    if (!existsSync(directory)) {
      return files;
    }

    let entries: Dirent[] = [];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return files;
    }

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        const nested = await this.collectMarkdownFiles(fullPath);
        files.push(...nested);
      } else if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.includes('-deleted-')) {
        files.push(fullPath);
      }
    }

    return files;
  }

  private inferDateFromFilename(filename: string): Date | null {
    const match = filename.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/);
    if (!match) {
      return null;
    }

    const [_, year, month, day, hours, minutes] = match;
    const date = new Date(`${year}-${month}-${day}T${hours}:${minutes}:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private inferDateFromDirectory(filePath: string): Date | null {
    const parentDir = path.basename(path.dirname(filePath));
    const weekMatch = parentDir.match(/^Week_(\d{4})-(\d{2})-(\d{2})_to_(\d{4})-(\d{2})-(\d{2})$/);
    if (weekMatch) {
      const [_, year, month, day] = weekMatch;
      const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
      if (!Number.isNaN(date.getTime())) {
        return date;
      }
    }

    const simpleMatch = parentDir.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (simpleMatch) {
      const [_, year, month, day] = simpleMatch;
      const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
      if (!Number.isNaN(date.getTime())) {
        return date;
      }
    }

    return null;
  }

  private async inferDateForFile(filePath: string): Promise<Date | null> {
    const fromFilename = this.inferDateFromFilename(path.basename(filePath));
    if (fromFilename) {
      return fromFilename;
    }

    const fromDirectory = this.inferDateFromDirectory(filePath);
    if (fromDirectory) {
      return fromDirectory;
    }

    try {
      const stats = await fs.stat(filePath);
      return stats.mtime;
    } catch (error) {
      console.warn(`[MeetingFileRepository] Failed to stat file for date inference: ${filePath}`, error);
      return null;
    }
  }

  private async listYearDirectories(): Promise<string[]> {
    let entries: Dirent[] = [];
    try {
      entries = await fs.readdir(this.storagePath, { withFileTypes: true });
    } catch {
      return [];
    }

    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(this.storagePath, entry.name));
  }

  private async listMonthDirectories(): Promise<string[]> {
    const yearDirs = await this.listYearDirectories();
    const result: string[] = [];

    for (const yearDir of yearDirs) {
      let entries: Dirent[] = [];
      try {
        entries = await fs.readdir(yearDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (entry.isDirectory()) {
          result.push(path.join(yearDir, entry.name));
        }
      }
    }

    return result;
  }

  private generateFileName(meeting: Meeting): string {
    const date = meeting.date instanceof Date ? meeting.date : new Date(meeting.date);
    const year = format(date, 'yyyy');
    const month = format(date, 'MM');
    const timestamp = format(date, 'yyyy-MM-dd-HH-mm');

    const eventIdPart = meeting.calendarEventId
      ? `[${meeting.calendarEventId.replace(/[^a-zA-Z0-9-_]/g, '').substring(0, 50)}]-`
      : '';

    const titleSlug = (meeting.title || 'untitled')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 100);

    return path.join(year, month, `${timestamp}-${eventIdPart}${titleSlug}.md`);
  }
}

export function resolveDefaultStoragePath(): string {
  const home = os.homedir();

  switch (process.platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'meeting-note-recorder');
    case 'win32':
      return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'meeting-note-recorder');
    default:
      return path.join(home, '.config', 'meeting-note-recorder');
  }
}
