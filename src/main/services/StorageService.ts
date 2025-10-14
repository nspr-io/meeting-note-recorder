import { Meeting, TranscriptChunk, CalendarEvent } from '../../shared/types';
import { SettingsService } from './SettingsService';
import { v4 as uuidv4 } from 'uuid';
import matter from 'gray-matter';
import path from 'path';
import fs from 'fs/promises';
import { format } from 'date-fns';
import { app } from 'electron';
import { DescriptionProcessingService } from './DescriptionProcessingService';
import { detectPlatform } from '../../shared/utils/PlatformDetector';
import { getLogger } from './LoggingService';

const logger = getLogger();

export class StorageService {
  private meetingsCache: Map<string, Meeting> = new Map();
  private settingsService: SettingsService;
  private storagePath: string;
  private cacheFilePath: string;
  private descriptionProcessor: DescriptionProcessingService;

  constructor(settingsService: SettingsService) {
    this.settingsService = settingsService;
    this.storagePath = settingsService.getSettings().storagePath;
    // Store cache in app data directory for fast loading
    const appDataPath = app.getPath('userData');
    this.cacheFilePath = path.join(appDataPath, 'meetings-cache.json');

    // Initialize description processor
    this.descriptionProcessor = new DescriptionProcessingService();
    const apiKey = settingsService.getSettings().anthropicApiKey;
    this.descriptionProcessor.initialize(apiKey);
  }

  async initialize(): Promise<void> {
    // Migrate existing flat files to year/month structure (one-time operation)
    await this.migrateExistingFilesToYearMonth();

    // Load all meetings from markdown files - this is the source of truth
    await this.loadAllMeetings();

    // Clean up any stuck "recording" states from previous app crashes
    // This now runs AFTER loading files, so it can detect and fix stuck recordings
    await this.cleanupStuckRecordings();

    // Adoption logic removed - MCP handles prep notes now

    // Save the cleaned-up cache to disk
    await this.saveCacheToDisk();
  }

  private async migrateExistingFilesToYearMonth(): Promise<void> {
    const storagePath = this.settingsService.getSettings().storagePath;

    try {
      // Check if migration is needed by looking for .md files in root
      const rootEntries = await fs.readdir(storagePath, { withFileTypes: true });
      const rootMdFiles = rootEntries
        .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
        .map(entry => entry.name);

      if (rootMdFiles.length === 0) {
        logger.info('[MIGRATION] No flat files to migrate');
        return;
      }

      logger.info(`[MIGRATION] Found ${rootMdFiles.length} flat files to migrate`);

      let migratedCount = 0;
      let errorCount = 0;

      for (const filename of rootMdFiles) {
        try {
          const oldPath = path.join(storagePath, filename);

          // Parse the date from filename: YYYY-MM-DD-HH-mm-...
          const dateMatch = filename.match(/^(\d{4})-(\d{2})-\d{2}/);
          if (!dateMatch) {
            logger.warn(`[MIGRATION] Skipping ${filename} - cannot parse date`);
            continue;
          }

          const [, year, month] = dateMatch;
          const newDir = path.join(storagePath, year, month);
          const newPath = path.join(newDir, filename);

          // Create directory and move file
          await fs.mkdir(newDir, { recursive: true });
          await fs.rename(oldPath, newPath);

          migratedCount++;
          logger.info(`[MIGRATION] Moved ${filename} to ${year}/${month}/`);
        } catch (error) {
          errorCount++;
          logger.error(`[MIGRATION] Failed to migrate ${filename}:`, error);
        }
      }

      logger.info(`[MIGRATION] Complete: ${migratedCount} migrated, ${errorCount} errors`);
    } catch (error) {
      logger.error('[MIGRATION] Migration failed:', error);
    }
  }

  private async cleanupStuckRecordings(): Promise<void> {
    logger.info('Cleaning up stuck recordings...');
    let cleanupCount = 0;
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000); // 5 minute threshold (more aggressive)

    for (const [id, meeting] of this.meetingsCache.entries()) {
      if (meeting.status === 'recording' || meeting.status === 'active') {
        // Clean up recordings that started more than 5 minutes ago without activity
        // This handles cases where the app was killed during recording
        const startTime = meeting.startTime ? new Date(meeting.startTime) : meeting.date;
        if (startTime < fiveMinutesAgo) {
          logger.info(`Cleaning up stuck recording: ${meeting.title} (started ${startTime}, ${Math.round((now.getTime() - (startTime instanceof Date ? startTime.getTime() : new Date(startTime).getTime())) / 1000 / 60)} minutes ago)`);
          // Update status to completed if it was stuck in recording
          meeting.status = 'completed';
          meeting.endTime = meeting.endTime || now; // Set end time if not set
          this.meetingsCache.set(id, meeting);

          // Update the file if it exists
          if (meeting.filePath) {
            try {
              await this.saveMeetingToFile(meeting);
              cleanupCount++;
            } catch (error) {
              logger.error(`Failed to update stuck meeting ${id}:`, error);
            }
          }
        } else {
          const minutesAgo = Math.round((now.getTime() - (startTime instanceof Date ? startTime.getTime() : new Date(startTime).getTime())) / 1000 / 60);
          logger.info(`Keeping recent recording: ${meeting.title} (started ${minutesAgo} minutes ago)`);
        }
      }
    }

    if (cleanupCount > 0) {
      logger.info(`Cleaned up ${cleanupCount} stuck recordings`);
      await this.saveCacheToDisk();
    }
  }

  private async loadAllMeetings(): Promise<void> {
    const storagePath = this.settingsService.getSettings().storagePath;

    try {
      // IMPORTANT: Clear the cache first to avoid mixing old/new data
      this.meetingsCache.clear();
      logger.info('[LOAD] Cleared existing cache before loading from files');

      // Load previous month, current month, and next month
      const now = new Date();

      const previousMonth = new Date(now);
      previousMonth.setMonth(previousMonth.getMonth() - 1);
      const prevYear = format(previousMonth, 'yyyy');
      const prevMonth = format(previousMonth, 'MM');

      const currentYear = format(now, 'yyyy');
      const currentMonth = format(now, 'MM');

      const nextMonth = new Date(now);
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      const nextYear = format(nextMonth, 'yyyy');
      const nextMonthStr = format(nextMonth, 'MM');

      const monthsToScan = [
        { year: prevYear, month: prevMonth, label: 'previous' },
        { year: currentYear, month: currentMonth, label: 'current' },
        { year: nextYear, month: nextMonthStr, label: 'next' }
      ];

      logger.info(`[LOAD] Scanning previous, current, and next month directories`);

      const mdFiles: string[] = [];

      for (const { year, month, label } of monthsToScan) {
        const monthPath = path.join(storagePath, year, month);
        try {
          const files = await fs.readdir(monthPath);
          const monthMdFiles = files
            .filter(f => f.endsWith('.md'))
            .map(f => path.join(monthPath, f));
          mdFiles.push(...monthMdFiles);
          logger.info(`[LOAD] Found ${monthMdFiles.length} files in ${label} month (${year}/${month})`);
        } catch (error) {
          logger.debug(`[LOAD] ${label} month directory doesn't exist: ${monthPath}`);
        }
      }

      logger.info(`[LOAD] Found ${mdFiles.length} total markdown files to load`);

      let loadedCount = 0;
      for (const filePath of mdFiles) {
        const meeting = await this.loadMeetingFromFile(filePath);
        if (meeting) {
          this.meetingsCache.set(meeting.id, meeting);
          loadedCount++;
        }
      }

      logger.info(`[LOAD] Successfully loaded ${loadedCount} meetings into cache`);
    } catch (error) {
      logger.error('Failed to load meetings:', error);
    }
  }

  private async scanForMarkdownFiles(directory: string): Promise<string[]> {
    const mdFiles: string[] = [];

    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          // Skip known non-meeting directories
          if (['Meeting prep', 'Transcripts', 'Treated final notes', 'Treated_final_notes_BACKUP_20250915_102638'].includes(entry.name)) {
            continue;
          }
          // Recursively scan subdirectories (YYYY/MM structure)
          const subFiles = await this.scanForMarkdownFiles(fullPath);
          mdFiles.push(...subFiles);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          mdFiles.push(fullPath);
        }
      }
    } catch (error) {
      logger.error(`Failed to scan directory ${directory}:`, error);
    }

    return mdFiles;
  }

  private async loadMeetingFromFile(filePath: string): Promise<Meeting | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const { data, content: bodyContent } = matter(content);

      // Parse the body content to separate notes and transcript
      const sections = bodyContent.split('---\n');
      const notesSection = sections.find(s => s.includes('# Meeting Notes')) || '';
      const transcriptSection = sections.find(s => s.includes('# Transcript')) || '';

      const notes = notesSection
        .replace('# Meeting Notes', '')
        .trim();

      const transcript = transcriptSection
        .replace('# Transcript', '')
        .trim();

      const meeting: Meeting = {
        id: data.id || uuidv4(),
        title: data.title || 'Untitled Meeting',
        date: new Date(data.date || Date.now()),
        attendees: data.attendees || [],
        duration: data.duration,
        recallRecordingId: data.recall_recording_id,
        recallVideoUrl: data.recall_video_url,
        recallAudioUrl: data.recall_audio_url,
        calendarEventId: data.calendar_event_id,
        meetingUrl: data.meeting_url,
        calendarInviteUrl: data.calendar_invite_url,
        status: data.status || 'completed',
        notes,
        transcript,
        notionSharedAt: data.notion_shared_at ? new Date(data.notion_shared_at) : null,
        notionPageId: data.notion_page_id || null,
        filePath,
        createdAt: new Date(data.created_at || Date.now()),
        updatedAt: new Date(data.updated_at || Date.now()),
      };

      return meeting;
    } catch (error) {
      logger.error(`Failed to load meeting from ${filePath}:`, error);
      return null;
    }
  }

  private formatMeetingToMarkdown(meeting: Meeting): string {
    // Build frontmatter with only defined values
    const dateStr = typeof meeting.date === 'string'
      ? meeting.date
      : meeting.date.toISOString();

    const frontmatter: any = {
      id: meeting.id,
      title: meeting.title,
      date: dateStr,
      attendees: meeting.attendees,
      status: meeting.status,
      created_at: meeting.createdAt
        ? (meeting.createdAt instanceof Date ? meeting.createdAt.toISOString() : meeting.createdAt)
        : new Date().toISOString(),
      updated_at: meeting.updatedAt
        ? (meeting.updatedAt instanceof Date ? meeting.updatedAt.toISOString() : meeting.updatedAt)
        : new Date().toISOString(),
    };

    // Only add optional fields if they're defined
    if (meeting.duration !== undefined) frontmatter.duration = meeting.duration;
    if (meeting.recallRecordingId !== undefined) frontmatter.recall_recording_id = meeting.recallRecordingId;
    if (meeting.recallVideoUrl !== undefined) frontmatter.recall_video_url = meeting.recallVideoUrl;
    if (meeting.recallAudioUrl !== undefined) frontmatter.recall_audio_url = meeting.recallAudioUrl;
    if (meeting.calendarEventId !== undefined) frontmatter.calendar_event_id = meeting.calendarEventId;
    if (meeting.meetingUrl !== undefined) frontmatter.meeting_url = meeting.meetingUrl;
    if (meeting.calendarInviteUrl !== undefined) frontmatter.calendar_invite_url = meeting.calendarInviteUrl;
    if (meeting.notionSharedAt) {
      frontmatter.notion_shared_at = meeting.notionSharedAt instanceof Date
        ? meeting.notionSharedAt.toISOString()
        : meeting.notionSharedAt;
    }
    if (meeting.notionPageId) frontmatter.notion_page_id = meeting.notionPageId;

    const content = `# Meeting Notes

${meeting.notes || ''}

---

# Transcript

${meeting.transcript || ''}`;

    // Use yaml library directly to ensure proper quoting of all strings
    const yaml = require('yaml');

    // Create a custom stringifier that quotes all string values
    // Set global option for yaml v1.10.2 API
    yaml.scalarOptions.str.defaultType = 'QUOTE_DOUBLE';
    const yamlString = yaml.stringify(frontmatter);

    // Manually construct the markdown with frontmatter
    return `---\n${yamlString}---\n${content}`;
  }

  private async ensureDirectoryExists(filePath: string): Promise<void> {
    const directory = path.dirname(filePath);
    await fs.mkdir(directory, { recursive: true });
  }

  private generateFileName(meeting: Meeting): string {
    // Format: YYYY/MM/YYYY-MM-DD-HH-mm-[eventId]-title-slug.md
    const date = new Date(meeting.date);
    const year = format(date, 'yyyy');
    const month = format(date, 'MM');
    const dateStr = format(date, 'yyyy-MM-dd-HH-mm');

    // Include calendar event ID if available (sanitized and truncated for filesystem)
    const eventIdPart = meeting.calendarEventId
      ? `[${meeting.calendarEventId.replace(/[^a-zA-Z0-9-_]/g, '').substring(0, 50)}]-`
      : '';

    const titleSlug = meeting.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 100); // Limit length to avoid filesystem issues

    // Return path with year/month subdirectories: YYYY/MM/filename.md
    return path.join(year, month, `${dateStr}-${eventIdPart}${titleSlug}.md`);
  }

  async createMeeting(data: Partial<Meeting>): Promise<Meeting> {
    logger.info('[JOURNEY-STORAGE-1] Creating new meeting', {
      title: data.title,
      status: data.status,
      timestamp: new Date().toISOString()
    });

    const meeting: Meeting = {
      id: uuidv4(),
      title: data.title || 'Untitled Meeting',
      date: data.date || new Date(),
      attendees: data.attendees || [],
      status: data.status || 'scheduled',
      notes: data.notes || '',
      transcript: data.transcript || '',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
    };

    logger.info('[JOURNEY-STORAGE-2] Meeting object created', {
      id: meeting.id,
      title: meeting.title,
      status: meeting.status
    });

    const storagePath = this.settingsService.getSettings().storagePath;
    const fileName = this.generateFileName(meeting);
    meeting.filePath = path.join(storagePath, fileName);

    // Only create file if there's actual content (notes or transcript)
    const hasNotes = meeting.notes && meeting.notes.trim().length > 0;
    const hasTranscript = meeting.transcript && meeting.transcript.trim().length > 0;

    if (hasNotes || hasTranscript) {
      await this.ensureDirectoryExists(meeting.filePath);
      const markdown = this.formatMeetingToMarkdown(meeting);
      await fs.writeFile(meeting.filePath, markdown, 'utf-8');
      logger.info('[JOURNEY-STORAGE-3] Meeting file created immediately (has content)', {
        id: meeting.id,
        hasNotes,
        hasTranscript,
        filePath: meeting.filePath
      });
    } else {
      logger.info('[JOURNEY-STORAGE-3] Meeting file NOT created (no content yet)', {
        id: meeting.id,
        filePath: meeting.filePath
      });
    }

    this.meetingsCache.set(meeting.id, meeting);
    logger.info('[JOURNEY-STORAGE-4] Meeting added to cache', {
      id: meeting.id,
      cacheSize: this.meetingsCache.size
    });

    logger.info('[JOURNEY-STORAGE-4.5] About to save cache to disk', {
      id: meeting.id,
      cacheSize: this.meetingsCache.size
    });

    try {
      await this.saveCacheToDisk(); // Save cache after creating meeting
      logger.info('[JOURNEY-STORAGE-5] Cache saved to disk', {
        id: meeting.id
      });
    } catch (error) {
      logger.error('[JOURNEY-STORAGE-5-ERROR] Failed to save cache to disk', {
        id: meeting.id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error; // Re-throw to ensure the error propagates
    }

    return meeting;
  }

  async updateMeeting(id: string, updates: Partial<Meeting>): Promise<Meeting> {
    logger.info('[JOURNEY-STORAGE-UPDATE-1] Updating meeting', {
      id,
      updates: Object.keys(updates),
      newStatus: updates.status,
      timestamp: new Date().toISOString()
    });

    const meeting = this.meetingsCache.get(id);
    if (!meeting) {
      logger.error('[JOURNEY-STORAGE-UPDATE-ERROR] Meeting not found', { id });
      throw new Error(`Meeting ${id} not found`);
    }

    // Store original values for comparison
    const originalNotes = meeting.notes || '';
    const originalTranscript = meeting.transcript || '';

    const updatedMeeting: Meeting = {
      ...meeting,
      ...updates,
      id: meeting.id, // Ensure ID doesn't change
      updatedAt: new Date(),
    };

    // Check if file exists
    const fileExists = meeting.filePath ? await fs.access(meeting.filePath).then(() => true).catch(() => false) : false;

    // Determine if we have meaningful content
    const hasSignificantNotes = updatedMeeting.notes && updatedMeeting.notes.trim().length > 0;
    const hasSignificantTranscript = updatedMeeting.transcript && updatedMeeting.transcript.trim().length > 0;
    const notesChanged = updatedMeeting.notes !== originalNotes;
    const transcriptChanged = updatedMeeting.transcript !== originalTranscript;

    // Only create/update file if:
    // 1. File doesn't exist and we now have content
    // 2. File exists and needs updating
    const shouldCreateFile = !fileExists && (hasSignificantNotes || hasSignificantTranscript);
    const shouldUpdateFile = fileExists && (notesChanged || transcriptChanged || updates.title || updates.date || updates.status || updates.duration);

    if (shouldCreateFile || shouldUpdateFile) {
      // If file exists, re-read it to get latest notes before updating
      // This prevents overwriting user edits made outside the app
      if (fileExists && meeting.filePath) {
        try {
          const fileContent = await fs.readFile(meeting.filePath, 'utf-8');
          const matter = require('gray-matter');
          const { content: bodyContent } = matter(fileContent);

          // Use the same proven parsing logic as loadMeetingFromFile
          // This prevents capturing duplicate sections that may exist in corrupted files
          const sections = bodyContent.split('---\n');
          const notesSection = sections.find((s: string) => s.includes('# Meeting Notes')) || '';
          const transcriptSection = sections.find((s: string) => s.includes('# Transcript')) || '';

          const fileNotes = notesSection.replace('# Meeting Notes', '').trim();
          const fileTranscript = transcriptSection.replace('# Transcript', '').trim();

          if (fileNotes) {
            const cacheNotes = updatedMeeting.notes || '';

            // Log if notes content changed significantly
            if (fileNotes !== cacheNotes && Math.abs(fileNotes.length - cacheNotes.length) > 10) {
              logger.warn('[NOTES-CONTENT-CHANGED]', {
                meetingId: id,
                title: meeting.title,
                oldLength: cacheNotes.length,
                newLength: fileNotes.length,
                lengthDiff: fileNotes.length - cacheNotes.length,
                source: 'file-read',
                oldPreview: cacheNotes.substring(0, 100),
                newPreview: fileNotes.substring(0, 100)
              });
            }

            // Only update if cache is stale (file has content that cache doesn't)
            if (!updatedMeeting.notes || updatedMeeting.notes.trim().length < fileNotes.length) {
              updatedMeeting.notes = fileNotes;
              logger.info('[FILE-SYNC] Preserved notes from file (longer than cache)', {
                fileLength: fileNotes.length,
                cacheLength: cacheNotes.trim().length
              });
            }
          }

          if (fileTranscript) {
            if (!updatedMeeting.transcript || updatedMeeting.transcript.trim().length < fileTranscript.length) {
              updatedMeeting.transcript = fileTranscript;
            }
          }
        } catch (error) {
          logger.warn('[FILE-SYNC] Failed to read existing file, proceeding with cache data:', error);
        }
      }

      // If title or date changed AND file exists, rename file
      if ((updates.title || updates.date) && fileExists) {
        const oldPath = meeting.filePath!;
        const newFileName = this.generateFileName(updatedMeeting);
        const storagePath = this.settingsService.getSettings().storagePath;
        const newPath = path.join(storagePath, newFileName);

        if (oldPath !== newPath) {
          await this.ensureDirectoryExists(newPath);
          await fs.rename(oldPath, newPath);
          updatedMeeting.filePath = newPath;
        }
      }

      await this.ensureDirectoryExists(updatedMeeting.filePath!);
      const markdown = this.formatMeetingToMarkdown(updatedMeeting);
      await fs.writeFile(updatedMeeting.filePath!, markdown, 'utf-8');

      logger.info('[JOURNEY-STORAGE-UPDATE] File ' + (shouldCreateFile ? 'created' : 'updated'), {
        id: updatedMeeting.id,
        filePath: updatedMeeting.filePath,
        wasCreated: shouldCreateFile,
        hasNotes: hasSignificantNotes,
        hasTranscript: hasSignificantTranscript
      });
    } else {
      logger.info('[JOURNEY-STORAGE-UPDATE] No file operation needed', {
        id: meeting.id,
        fileExists,
        hasContent: hasSignificantNotes || hasSignificantTranscript
      });
    }

    this.meetingsCache.set(id, updatedMeeting);
    logger.info('[JOURNEY-STORAGE-UPDATE-2] Meeting updated in cache', {
      id,
      title: updatedMeeting.title,
      status: updatedMeeting.status
    });

    await this.saveCacheToDisk(); // Save cache after updating meeting
    logger.info('[JOURNEY-STORAGE-UPDATE-3] Updated meeting saved to disk');

    return updatedMeeting;
  }

  async deleteMeeting(id: string): Promise<void> {
    const meeting = this.meetingsCache.get(id);
    if (!meeting) {
      throw new Error(`Meeting ${id} not found`);
    }

    if (meeting.filePath) {
      try {
        await fs.unlink(meeting.filePath);
      } catch (error) {
        logger.error(`Failed to delete meeting file: ${error}`);
      }
    }

    this.meetingsCache.delete(id);
    await this.saveCacheToDisk(); // Save cache after deleting meeting
  }

  async getMeeting(id: string): Promise<Meeting | undefined> {
    const meeting = this.meetingsCache.get(id);
    logger.info('[JOURNEY-STORAGE-GET] Getting meeting from cache', {
      id,
      found: !!meeting,
      title: meeting?.title,
      status: meeting?.status
    });
    return meeting;
  }

  /**
   * Refresh a meeting by re-reading from disk
   * Used when viewing a meeting to ensure latest content (e.g., external prep notes)
   */
  async refreshMeetingFromDisk(id: string): Promise<Meeting | undefined> {
    const meeting = this.meetingsCache.get(id);
    if (!meeting?.filePath) {
      logger.debug('[REFRESH-MEETING] No file path, returning cached meeting', { id });
      return meeting;
    }

    try {
      const refreshed = await this.loadMeetingFromFile(meeting.filePath);
      if (refreshed) {
        this.meetingsCache.set(id, refreshed);
        logger.info('[REFRESH-MEETING] Refreshed meeting from disk', {
          id,
          title: refreshed.title,
          notesLength: refreshed.notes?.length || 0
        });
        return refreshed;
      }
    } catch (error) {
      logger.error('[REFRESH-MEETING] Failed to refresh from disk, using cache', { id, error });
    }

    return meeting;
  }

  async getAllMeetings(): Promise<Meeting[]> {
    return Array.from(this.meetingsCache.values())
      .sort((a, b) => {
        const aDate = typeof a.date === 'string' ? new Date(a.date) : a.date;
        const bDate = typeof b.date === 'string' ? new Date(b.date) : b.date;
        return bDate.getTime() - aDate.getTime();
      });
  }

  async getMeetingByCalendarId(calendarId: string): Promise<Meeting | undefined> {
    return Array.from(this.meetingsCache.values())
      .find(m => {
        if (!m.calendarEventId) return false;
        // Exact match only - each recurring instance has unique ID
        return m.calendarEventId === calendarId;
      });
  }

  // Check if a meeting has been "touched" by the user (has notes, files, or changes)
  isMeetingTouched(meeting: Meeting): boolean {
    return !!(
      meeting.filePath ||
      (meeting.notes && meeting.notes.trim().length > 0) ||
      (meeting.transcript && meeting.transcript.trim().length > 0) ||
      meeting.status === 'recording' ||
      meeting.status === 'completed' ||
      meeting.status === 'partial'
    );
  }

  // Smart sync calendar events with existing meetings
  async smartSyncCalendarEvents(calendarEvents: CalendarEvent[]): Promise<{
    added: number;
    updated: number;
    deleted: number;
    errors: string[];
  }> {
    const result = { added: 0, updated: 0, deleted: 0, errors: [] as string[] };

    try {
      // Adoption logic removed - MCP handles prep notes now
      logger.info(`Smart sync: Processing ${calendarEvents.length} calendar events`);

      // Get existing meetings with calendar IDs
      const existingMeetings = Array.from(this.meetingsCache.values())
        .filter(m => m.calendarEventId);

      const processedCalendarIds = new Set<string>();

      // Process each calendar event
      for (const event of calendarEvents) {
        try {
          processedCalendarIds.add(event.id);
          const existingMeeting = await this.getMeetingByCalendarId(event.id);

          if (existingMeeting) {
            // Meeting exists - check if we should update it
            const isTouched = this.isMeetingTouched(existingMeeting);

            if (isTouched) {
              // Touched meeting: only update calendar metadata if it actually changed
              const existingDate = existingMeeting.date instanceof Date ? existingMeeting.date : new Date(existingMeeting.date);
              const existingStartTime = existingMeeting.startTime instanceof Date ? existingMeeting.startTime : (existingMeeting.startTime ? new Date(existingMeeting.startTime) : null);
              const existingEndTime = existingMeeting.endTime instanceof Date ? existingMeeting.endTime : (existingMeeting.endTime ? new Date(existingMeeting.endTime) : null);

              const calendarDataChanged = (
                existingMeeting.title !== event.title ||
                existingDate.getTime() !== event.start.getTime() ||
                existingStartTime?.getTime() !== event.start.getTime() ||
                existingEndTime?.getTime() !== event.end.getTime() ||
                JSON.stringify(existingMeeting.attendees) !== JSON.stringify(event.attendees) ||
                existingMeeting.meetingUrl !== event.meetingUrl ||
                existingMeeting.calendarInviteUrl !== event.htmlLink
              );

              if (!calendarDataChanged) {
                logger.debug(`[SMART-SYNC] Skipping update - no calendar changes for: ${existingMeeting.title}`);
                continue; // Skip this meeting entirely
              }

              // Calendar data changed, update touched meeting while preserving notes/transcript/status
              logger.info(`Updating touched meeting (preserving user data): ${existingMeeting.title}`);
              await this.updateMeeting(existingMeeting.id, {
                title: event.title,
                date: event.start,
                startTime: event.start,
                endTime: event.end,
                attendees: event.attendees,
                meetingUrl: event.meetingUrl,
                calendarInviteUrl: event.htmlLink,
                updatedAt: new Date()
                // Explicitly NOT updating: notes, transcript, status, filePath
              });
            } else {
              // Untouched meeting: safe to do full update
              logger.info(`Updating untouched meeting: ${existingMeeting.title}`);
              await this.updateMeeting(existingMeeting.id, {
                title: event.title,
                date: event.start,
                startTime: event.start,
                endTime: event.end,
                attendees: event.attendees,
                meetingUrl: event.meetingUrl,
                calendarInviteUrl: event.htmlLink,
                updatedAt: new Date()
              });
            }
            result.updated++;
          } else {
            // New meeting
            logger.info(`Adding new meeting: ${event.title}`);

            // MCP handles prep notes now - no need to search for orphaned files
            const prepNoteContent = null;

            // Process description to extract clean notes (meeting URL now comes from calendar)
            let processedNotes = prepNoteContent || '';
            let platform: Meeting['platform'] = 'googlemeet'; // Default

            // Detect platform from the meeting URL if available
            if (event.meetingUrl) {
              platform = detectPlatform(event.meetingUrl);
            }

            if (!prepNoteContent && event.description) {
              try {
                const processed = await this.descriptionProcessor.processDescription(event.description);
                processedNotes = processed.notes;
                // Use detected platform if description processing found one
                if (processed.platform) {
                  platform = processed.platform as Meeting['platform'];
                }
              } catch (error) {
                logger.info('Description processing failed, using fallback:', error);
                processedNotes = event.description || '';
              }
            }

            const newMeeting: Partial<Meeting> = {
              title: event.title,
              date: event.start,
              startTime: event.start,
              endTime: event.end,
              attendees: event.attendees,
              calendarEventId: event.id,
              meetingUrl: event.meetingUrl,
              calendarInviteUrl: event.htmlLink,
              status: 'scheduled',
              notes: processedNotes ? `<!-- CALENDAR_INFO -->\n${processedNotes}\n<!-- /CALENDAR_INFO -->` : '',
              transcript: '',
              platform
            };

            await this.createMeeting(newMeeting);
            result.added++;
          }
        } catch (error: any) {
          logger.error(`Error processing calendar event ${event.id}:`, error);
          result.errors.push(`Failed to process event "${event.title}": ${error?.message || String(error)}`);
        }
      }

      // Handle deleted calendar events
      for (const meeting of existingMeetings) {
        if (!processedCalendarIds.has(meeting.calendarEventId!) &&
            new Date(meeting.date) > new Date()) { // Only check future meetings

          const isTouched = this.isMeetingTouched(meeting);

          if (isTouched) {
            // Touched meeting: mark as deleted but keep it (only if not already marked)
            if (!meeting.title.startsWith('[DELETED]')) {
              logger.info(`Marking touched meeting as deleted: ${meeting.title}`);
              await this.updateMeeting(meeting.id, {
                title: `[DELETED] ${meeting.title}`,
                updatedAt: new Date()
              });
            } else {
              logger.info(`Meeting already marked as deleted: ${meeting.title}`);
            }
          } else {
            // Untouched meeting: safe to remove
            logger.info(`Removing untouched deleted meeting: ${meeting.title}`);
            await this.deleteMeeting(meeting.id);
          }
          result.deleted++;
        }
      }

      logger.info(`Smart sync completed: ${result.added} added, ${result.updated} updated, ${result.deleted} deleted`);
      return result;

    } catch (error: any) {
      logger.error('Smart sync failed:', error);
      result.errors.push(`Smart sync failed: ${error?.message || String(error)}`);
      return result;
    }
  }

  private async loadCacheFromDisk(): Promise<void> {
    try {
      const cacheData = await fs.readFile(this.cacheFilePath, 'utf-8');
      const meetings = JSON.parse(cacheData) as Meeting[];
      
      // Load meetings from last 6 months plus future meetings for better coverage
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      for (const meeting of meetings) {
        const meetingDate = new Date(meeting.date);
        const now = new Date();

        // Include meetings from last 6 months OR future meetings OR active/recording meetings
        if (meetingDate >= sixMonthsAgo || meetingDate > now || meeting.status === 'active' || meeting.status === 'recording') {
          this.meetingsCache.set(meeting.id, meeting);
        }
      }

      logger.info(`Loaded ${this.meetingsCache.size} meetings from cache (last 6 months + future + active)`);
    } catch (error) {
      // Cache doesn't exist yet, that's ok
      logger.info('No cache file found, starting fresh');
    }
  }

  private async saveCacheToDisk(): Promise<void> {
    logger.info('[CACHE-SAVE-1] Starting saveCacheToDisk');
    try {
      const meetings = Array.from(this.meetingsCache.values());
      logger.info(`[CACHE-SAVE-2] Preparing to save ${meetings.length} meetings`);

      await fs.writeFile(
        this.cacheFilePath,
        JSON.stringify(meetings, null, 2),
        'utf-8'
      );

      logger.info(`[CACHE-SAVE-3] Successfully saved ${meetings.length} meetings to cache`);
    } catch (error) {
      logger.error('[CACHE-SAVE-ERROR] Failed to save cache:', error);
      logger.error('[CACHE-SAVE-ERROR] Stack trace:', error instanceof Error ? error.stack : 'No stack');
      throw error; // Re-throw to propagate the error
    }
  }

  // Public method for emergency saves from process error handlers
  async forceSave(): Promise<void> {
    logger.info('[FORCE-SAVE] Attempting emergency cache save...');
    try {
      await this.saveCacheToDisk();
      logger.info('[FORCE-SAVE] Emergency save successful');
    } catch (error) {
      logger.error('[FORCE-SAVE] Emergency save failed:', error);
      throw error;
    }
  }

  async appendTranscript(meetingId: string, chunk: TranscriptChunk): Promise<void> {
    logger.info('[JOURNEY-TRANSCRIPT-APPEND] Appending transcript chunk', {
      meetingId,
      speaker: chunk.speaker,
      textLength: chunk.text?.length,
      timestamp: chunk.timestamp
    });

    const meeting = this.meetingsCache.get(meetingId);
    if (!meeting) {
      logger.error('[JOURNEY-TRANSCRIPT-ERROR] Meeting not found for transcript', { meetingId });
      throw new Error(`Meeting ${meetingId} not found`);
    }

    const timestamp = format(chunk.timestamp, 'HH:mm:ss');
    const line = chunk.speaker 
      ? `[${timestamp}] ${chunk.speaker}: ${chunk.text}`
      : `[${timestamp}] ${chunk.text}`;

    meeting.transcript = meeting.transcript 
      ? `${meeting.transcript}\n${line}`
      : line;

    await this.updateMeeting(meetingId, { transcript: meeting.transcript });
  }

  async updateNotes(meetingId: string, notes: string): Promise<void> {
    await this.updateMeeting(meetingId, { notes });
  }

  // Auto-save functionality
  private autoSaveTimers: Map<string, NodeJS.Timeout> = new Map();

  startAutoSave(meetingId: string, interval: number = 10000): void {
    // Clear existing timer if any
    this.stopAutoSave(meetingId);

    logger.info(`[AUTO-SAVE] Starting auto-save for meeting ${meetingId} with interval ${interval}ms`);

    const timer = setInterval(async () => {
      try {
        const meeting = this.meetingsCache.get(meetingId);
        if (meeting) {
          if (!meeting.filePath) {
            // Generate file path if it doesn't exist
            const fileName = this.generateFileName(meeting);
            meeting.filePath = path.join(this.storagePath, fileName);
            logger.info(`[AUTO-SAVE] Generated file path for meeting ${meetingId}: ${meeting.filePath}`);
          }

          await this.ensureDirectoryExists(meeting.filePath);
          const markdown = this.formatMeetingToMarkdown(meeting);
          await fs.writeFile(meeting.filePath, markdown, 'utf-8');
          logger.info(`[AUTO-SAVE] Saved meeting ${meetingId} to ${meeting.filePath}`);

          // Also save cache periodically
          await this.saveCacheToDisk();
        } else {
          logger.warn(`[AUTO-SAVE] Meeting ${meetingId} not found in cache, stopping auto-save`);
          this.stopAutoSave(meetingId);
        }
      } catch (error) {
        logger.error(`[AUTO-SAVE-ERROR] Failed to auto-save meeting ${meetingId}:`, error);
        logger.error('[AUTO-SAVE-ERROR] Stack:', error instanceof Error ? error.stack : 'No stack');
      }
    }, interval);

    this.autoSaveTimers.set(meetingId, timer);
    logger.info(`[AUTO-SAVE] Auto-save timer created for meeting ${meetingId}`);
  }

  stopAutoSave(meetingId: string): void {
    const timer = this.autoSaveTimers.get(meetingId);
    if (timer) {
      clearInterval(timer);
      this.autoSaveTimers.delete(meetingId);
    }
  }

  stopAllAutoSaves(): void {
    for (const [meetingId] of this.autoSaveTimers) {
      this.stopAutoSave(meetingId);
    }
  }

  getStoragePath(): string {
    return this.storagePath;
  }

  async loadMeeting(meetingId: string): Promise<Meeting | undefined> {
    return this.getMeeting(meetingId);
  }

  async updateTranscript(meetingId: string, transcript: string): Promise<void> {
    await this.updateMeeting(meetingId, { transcript });
  }

  async saveMeeting(meeting: Meeting): Promise<string> {
    // Store in cache
    this.meetingsCache.set(meeting.id, meeting);
    await this.saveCacheToDisk(); // Save cache after saving meeting

    // Use existing filePath if available, otherwise generate proper year/month structure
    const filePath = meeting.filePath || path.join(
      this.storagePath,
      this.generateFileName(meeting)
    );

    // Save to file
    meeting.filePath = filePath;
    await this.ensureDirectoryExists(filePath);
    const markdown = this.formatMeetingToMarkdown(meeting);
    await fs.writeFile(filePath, markdown, 'utf-8');

    return filePath;
  }

  // Alias for compatibility
  async saveMeetingToFile(meeting: Meeting): Promise<string> {
    return this.saveMeeting(meeting);
  }
}