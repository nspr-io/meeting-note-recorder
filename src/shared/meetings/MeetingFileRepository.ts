import fs from 'fs/promises';
import { existsSync, Dirent } from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { parse, parseISO, isValid } from 'date-fns';

import { Meeting } from '../types';
import { NoteSections } from '../../renderer/components/noteSectionUtils';
import {
  deserializeMeetingMarkdown,
  serializeMeetingToMarkdown,
  generateMeetingFileName,
  inferDateFromFilename,
  inferDateFromDirectory
} from './MeetingFileSerializer';

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
    const trimmedId = calendarEventId?.trim();
    if (!trimmedId) {
      return null;
    }

    const sanitizedId = this.sanitizeCalendarEventId(trimmedId);
    const rawBaseId = trimmedId.split('_')[0] ?? '';
    const sanitizedBaseId = rawBaseId ? this.sanitizeCalendarEventId(rawBaseId) : '';

    const searchTokens: Array<{ token: string; weight: number }> = [];
    if (sanitizedId) {
      searchTokens.push({ token: `[${sanitizedId}]`, weight: 3 });
    }
    if (sanitizedBaseId && sanitizedBaseId !== sanitizedId) {
      searchTokens.push({ token: `[${sanitizedBaseId}]`, weight: 2 });
    }
    if (rawBaseId && rawBaseId !== sanitizedBaseId) {
      searchTokens.push({ token: `[${rawBaseId}]`, weight: 1 });
    }

    if (searchTokens.length === 0) {
      return null;
    }

    const monthDirs = await this.listMonthDirectories();
    const candidates: Array<{ filePath: string; weight: number }> = [];

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

        const weight = searchTokens.reduce((acc, current) => (entry.includes(current.token) ? Math.max(acc, current.weight) : acc), 0);
        if (weight > 0) {
          candidates.push({ filePath: path.join(dir, entry), weight });
        }
      }
    }

    candidates.sort((a, b) => b.weight - a.weight);

    for (const candidate of candidates) {
      const loaded = await this.loadByFilePath(candidate.filePath);
      if (!loaded) {
        continue;
      }

      if (loaded.meeting.calendarEventId === trimmedId) {
        return candidate.filePath;
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
      const { meeting, sections } = await deserializeMeetingMarkdown(fileContent, { filePath });
      meeting.filePath = filePath;

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

    const normalizedDate = this.parseMeetingDateInput(meetingDate);
    if (!normalizedDate) {
      throw new Error('meetingDate must be an ISO 8601 string or a recognized local date/time format (e.g. "YYYY-MM-DD HH:mm")');
    }

    const meeting: Meeting = {
      id: uuidv4(),
      title: meetingTitle,
      date: normalizedDate,
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

    const relativeFilePath = generateMeetingFileName(meeting);
    const absolutePath = path.join(this.storagePath, relativeFilePath);

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await this.writeMeetingContent(meeting, sections, absolutePath);

    return absolutePath;
  }

  private async writeMeetingContent(meeting: Meeting, sections: NoteSections, filePath: string): Promise<void> {
    const updatedAt = new Date();
    const markdown = serializeMeetingToMarkdown(
      {
        ...meeting,
        updatedAt
      },
      sections,
      { updatedAt }
    );

    await fs.writeFile(filePath, markdown, 'utf-8');
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

  private async inferDateForFile(filePath: string): Promise<Date | null> {
    const fromFilename = inferDateFromFilename(path.basename(filePath));
    if (fromFilename) {
      return fromFilename;
    }

    const fromDirectory = inferDateFromDirectory(filePath);
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

  private sanitizeCalendarEventId(calendarEventId: string): string {
    return calendarEventId.replace(/[^a-zA-Z0-9-_]/g, '').substring(0, 50);
  }

  private parseMeetingDateInput(value: string): Date | null {
    if (!value) {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const isoCandidate = parseISO(trimmed);
    if (isValid(isoCandidate)) {
      return isoCandidate;
    }

    const knownFormats = [
      'yyyy-MM-dd HH:mm',
      'yyyy-MM-dd H:mm',
      'yyyy/MM/dd HH:mm',
      'yyyy/MM/dd H:mm',
      'MM/dd/yyyy HH:mm',
      'MM/dd/yyyy H:mm',
      'yyyy-MM-dd'
    ];

    for (const formatString of knownFormats) {
      const parsed = parse(trimmed, formatString, new Date());
      if (isValid(parsed)) {
        return parsed;
      }
    }

    const fallback = new Date(trimmed);
    if (!Number.isNaN(fallback.getTime())) {
      return fallback;
    }

    return null;
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
