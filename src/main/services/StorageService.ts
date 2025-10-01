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

    // Scan for and adopt any prep notes
    await this.scanAndAdoptPrepNotes();

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

  private async scanAndAdoptPrepNotes(): Promise<void> {
    const storagePath = this.settingsService.getSettings().storagePath;

    try {
      // Ensure storage path exists
      await fs.mkdir(storagePath, { recursive: true });

      // Only scan current and next month for prep notes
      const now = new Date();
      const currentYear = format(now, 'yyyy');
      const currentMonth = format(now, 'MM');

      const nextMonth = new Date(now);
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      const nextYear = format(nextMonth, 'yyyy');
      const nextMonthStr = format(nextMonth, 'MM');

      const dirsToScan = [
        storagePath, // Root for legacy files
        path.join(storagePath, currentYear, currentMonth),
        path.join(storagePath, nextYear, nextMonthStr)
      ];

      for (const dir of dirsToScan) {
        try {
          const files = await fs.readdir(dir);
          const mdFiles = files.filter(f => f.endsWith('.md'));

          logger.info(`[PREP-NOTES] Scanning ${mdFiles.length} files in ${dir}`);

          for (const file of mdFiles) {
            const filePath = path.join(dir, file);
            try {
              await this.attemptPrepNoteAdoption(filePath);
            } catch (error) {
              logger.error(`[PREP-NOTES] Failed to process ${file}:`, error);
            }
          }
        } catch (error) {
          // Directory might not exist yet, that's OK
          logger.debug(`[PREP-NOTES] Directory ${dir} not accessible:`, error);
        }
      }
    } catch (error) {
      logger.error('[PREP-NOTES] Failed to scan for prep notes:', error);
    }
  }

  private async attemptPrepNoteAdoption(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const { data: frontmatter } = matter(content);

      // Skip if already adopted by checking for app-specific fields
      // Prep notes may have 'id' but won't have 'created_at' in ISO format with app structure
      if (frontmatter.id && frontmatter.created_at && this.meetingsCache.has(frontmatter.id)) {
        // This is already an adopted meeting file
        return;
      }

      logger.info(`[PREP-NOTES] Found orphan prep note: ${path.basename(filePath)}`);

      // Parse filename for matching info
      const filename = path.basename(filePath, '.md');
      const filenameParts = this.parseFilename(filename);

      if (!filenameParts) {
        logger.info(`[PREP-NOTES] Could not parse filename: ${filename}`);
        return;
      }

      // Try to match with a calendar event
      const matchedMeeting = await this.matchPrepNoteToMeeting(filenameParts, content);

      if (matchedMeeting) {
        logger.info(`[PREP-NOTES] Matched to meeting: ${matchedMeeting.title}`);
        await this.adoptPrepNote(filePath, matchedMeeting, content);
      } else {
        logger.info(`[PREP-NOTES] No match found, will be adopted when meeting is created`);
      }
    } catch (error) {
      logger.error(`[PREP-NOTES] Failed to process ${filePath}:`, error);
    }
  }

  private parseFilename(filename: string): {
    date: Date;
    calendarEventId?: string;
    titleKeywords: string[];
  } | null {
    // Expected format: YYYY-MM-DD-HH-mm-[eventId]-title-slug
    const match = filename.match(/^(\d{4}-\d{2}-\d{2}-\d{2}-\d{2})(?:-\[([^\]]+)\])?-?(.*)$/);

    if (!match) {
      return null;
    }

    const [_, dateStr, eventId, titleSlug] = match;

    // Parse date
    const dateParts = dateStr.split('-');
    const date = new Date(
      parseInt(dateParts[0]), // year
      parseInt(dateParts[1]) - 1, // month (0-indexed)
      parseInt(dateParts[2]), // day
      parseInt(dateParts[3]), // hour
      parseInt(dateParts[4]) // minute
    );

    // Extract title keywords
    const titleKeywords = titleSlug
      ? titleSlug.split('-').filter(k => k.length > 0)
      : [];

    return {
      date,
      calendarEventId: eventId || undefined,
      titleKeywords
    };
  }

  private async matchPrepNoteToMeeting(
    filenameParts: { date: Date; calendarEventId?: string; titleKeywords: string[] },
    content: string
  ): Promise<Meeting | null> {
    // First try exact calendar ID match
    if (filenameParts.calendarEventId) {
      for (const [_, meeting] of this.meetingsCache) {
        if (meeting.calendarEventId === filenameParts.calendarEventId) {
          return meeting;
        }
      }
    }

    // Then try fuzzy matching by date and title
    const dateWindow = 30 * 60 * 1000; // 30 minutes
    const targetTime = filenameParts.date.getTime();

    let bestMatch: Meeting | null = null;
    let bestScore = 0;

    for (const [_, meeting] of this.meetingsCache) {
      const meetingTime = new Date(meeting.date).getTime();

      // Check if within time window
      if (Math.abs(meetingTime - targetTime) > dateWindow) {
        continue;
      }

      // Calculate title match score
      const meetingTitleLower = meeting.title.toLowerCase();
      let score = 0;

      for (const keyword of filenameParts.titleKeywords) {
        if (meetingTitleLower.includes(keyword.toLowerCase())) {
          score++;
        }
      }

      // Weight by time proximity
      const timeDiff = Math.abs(meetingTime - targetTime);
      const timeScore = 1 - (timeDiff / dateWindow);
      score += timeScore;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = meeting;
      }
    }

    // Require minimum score for match
    return bestScore > 0.5 ? bestMatch : null;
  }

  private async checkForPrepNote(event: CalendarEvent): Promise<string | null> {
    const storagePath = this.settingsService.getSettings().storagePath;

    try {
      // Scan root (legacy), current month, and next month for prep notes
      const now = new Date();
      const currentYear = format(now, 'yyyy');
      const currentMonth = format(now, 'MM');

      const nextMonth = new Date(now);
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      const nextYear = format(nextMonth, 'yyyy');
      const nextMonthStr = format(nextMonth, 'MM');

      const dirsToScan = [
        storagePath, // Root for legacy prep notes
        path.join(storagePath, currentYear, currentMonth),
        path.join(storagePath, nextYear, nextMonthStr)
      ];

      // Track best match in case no perfect match is found
      let bestMatch: { score: number; content: string; filePath: string } | null = null;

      for (const dir of dirsToScan) {
        try {
          const files = await fs.readdir(dir);
          const mdFiles = files.filter(f => f.endsWith('.md'));

          for (const file of mdFiles) {
            const filePath = path.join(dir, file);

            try {
              const content = await fs.readFile(filePath, 'utf-8');
              const { data: frontmatter, content: bodyContent } = matter(content);

              // Skip if already has an ID (already adopted) or marked as pending
              if (frontmatter.id || frontmatter.calendar_event_id_pending === event.id) {
                continue;
              }

              // Parse filename for matching
              const filename = path.basename(filePath, '.md');
              const filenameParts = this.parseFilename(filename);

              if (!filenameParts) {
                continue;
              }

              let matchScore = 0;

              // 1. Try exact calendar ID match (highest priority)
              if (filenameParts.calendarEventId && filenameParts.calendarEventId === event.id) {
                matchScore = 10; // Perfect match
              } else {
                // 2. Try date/time match with title keywords
                const eventTime = new Date(event.start).getTime();
                const fileTime = filenameParts.date.getTime();
                const timeDiff = Math.abs(eventTime - fileTime);

                // Within 30 minutes
                if (timeDiff < 30 * 60 * 1000) {
                  // Base score for time match
                  matchScore = 1 - (timeDiff / (30 * 60 * 1000));

                  // Check title keywords match
                  const eventTitleLower = event.title.toLowerCase();
                  let keywordMatches = 0;
                  for (const keyword of filenameParts.titleKeywords) {
                    if (eventTitleLower.includes(keyword.toLowerCase())) {
                      keywordMatches++;
                    }
                  }

                  // Add score for keyword matches
                  if (filenameParts.titleKeywords.length > 0) {
                    matchScore += (keywordMatches / filenameParts.titleKeywords.length) * 2;
                  }
                }
              }

              if (matchScore > 0 && (!bestMatch || matchScore > bestMatch.score)) {
                bestMatch = { score: matchScore, content: bodyContent.trim(), filePath };
              }
            } catch (fileError) {
              logger.error(`[PREP-NOTES] Error reading ${file}:`, fileError);
              // Continue with other files
            }
          }
        } catch (dirError) {
          // Directory might not exist yet, that's OK
          logger.debug(`[PREP-NOTES] Directory not accessible: ${dir}`);
        }
      }

      // Use best match if score is high enough
      if (bestMatch && bestMatch.score > 0.5) {
        logger.info(`[PREP-NOTES] Found prep note for event: ${event.title} (score: ${bestMatch.score.toFixed(2)})`);

        try {
          // Mark the file for later adoption by updating it with the calendar ID
          const content = await fs.readFile(bestMatch.filePath, 'utf-8');
          const { data: frontmatter, content: bodyContent } = matter(content);
          const updatedContent = matter.stringify(bodyContent, {
            ...frontmatter,
            calendar_event_id_pending: event.id
          });
          await fs.writeFile(bestMatch.filePath, updatedContent, 'utf-8');
        } catch (markError) {
          logger.error('[PREP-NOTES] Failed to mark prep note:', markError);
        }

        return bestMatch.content;
      }
    } catch (error) {
      logger.error('[PREP-NOTES] Error checking for prep notes:', error);
    }

    return null;
  }

  private async adoptPrepNote(filePath: string, meeting: Meeting, content: string): Promise<void> {
    try {
      // Read the existing content
      const { content: bodyContent } = matter(content);

      // Use the prep note content as the meeting notes
      meeting.notes = bodyContent.trim() || meeting.notes;

      // Generate the standard filename
      const newFileName = this.generateFileName(meeting);
      const storagePath = this.settingsService.getSettings().storagePath;
      const newFilePath = path.join(storagePath, newFileName);

      // If the file paths are different, we need to rename
      if (filePath !== newFilePath) {
        // Write to new location first (atomic operation)
        const markdown = this.formatMeetingToMarkdown(meeting);
        const tempPath = `${newFilePath}.tmp`;

        try {
          // Write to temp file first
          await fs.writeFile(tempPath, markdown, 'utf-8');

          // Rename temp file to final name (atomic on most filesystems)
          await fs.rename(tempPath, newFilePath);

          // Only delete old file after successful write
          try {
            await fs.unlink(filePath);
            logger.info(`[PREP-NOTES] Renamed ${path.basename(filePath)} to ${newFileName}`);
          } catch (unlinkError) {
            logger.error(`[PREP-NOTES] Failed to remove old file ${filePath}:`, unlinkError);
            // Non-critical error - continue
          }
        } catch (writeError) {
          // Clean up temp file if it exists
          try {
            await fs.unlink(tempPath);
          } catch {}
          throw writeError;
        }
      } else {
        // Same file path - just update content
        const markdown = this.formatMeetingToMarkdown(meeting);
        await fs.writeFile(newFilePath, markdown, 'utf-8');
      }

      // Update the meeting file path
      meeting.filePath = newFilePath;

      // Update the cache
      this.meetingsCache.set(meeting.id, meeting);
      await this.saveCacheToDisk();

      logger.info(`[PREP-NOTES] Successfully adopted prep note for meeting: ${meeting.title}`);
    } catch (error) {
      logger.error(`[PREP-NOTES] Failed to adopt prep note for meeting ${meeting.title}:`, error);
      throw error;
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

    // Include calendar event ID if available (sanitized for filesystem)
    const eventIdPart = meeting.calendarEventId
      ? `[${meeting.calendarEventId.replace(/[^a-zA-Z0-9-_]/g, '')}]-`
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
    const shouldUpdateFile = fileExists && (notesChanged || transcriptChanged || updates.title || updates.date);

    if (shouldCreateFile || shouldUpdateFile) {
      // If file exists, re-read it to get latest notes before updating
      // This prevents overwriting user edits made outside the app
      if (fileExists && meeting.filePath) {
        try {
          const fileContent = await fs.readFile(meeting.filePath, 'utf-8');
          const matter = require('gray-matter');
          const { content: bodyContent } = matter(fileContent);

          // Extract notes and transcript from file content
          const notesMatch = bodyContent.match(/# Meeting Notes\s+([\s\S]*?)(?=\n---\n|# Transcript|$)/);
          const transcriptMatch = bodyContent.match(/# Transcript\s+([\s\S]*?)$/);

          if (notesMatch && notesMatch[1].trim()) {
            // Only update if cache is stale (file has content that cache doesn't)
            if (!updatedMeeting.notes || updatedMeeting.notes.trim().length < notesMatch[1].trim().length) {
              updatedMeeting.notes = notesMatch[1].trim();
              logger.info('[FILE-SYNC] Preserved notes from file (longer than cache)', {
                fileLength: notesMatch[1].trim().length,
                cacheLength: (updatedMeeting.notes || '').trim().length
              });
            }
          }

          if (transcriptMatch && transcriptMatch[1].trim()) {
            if (!updatedMeeting.transcript || updatedMeeting.transcript.trim().length < transcriptMatch[1].trim().length) {
              updatedMeeting.transcript = transcriptMatch[1].trim();
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
   * Check if a prep note exists for a specific meeting and adopt it if found
   * This is called on-demand when viewing a meeting without a file
   */
  async checkPrepNoteForMeeting(meetingId: string): Promise<Meeting | null> {
    const meeting = await this.getMeeting(meetingId);

    if (!meeting) {
      logger.warn(`[PREP-NOTE-CHECK] Meeting not found: ${meetingId}`);
      return null;
    }

    // If meeting already has a file, nothing to do
    if (meeting.filePath) {
      logger.debug(`[PREP-NOTE-CHECK] Meeting already has file: ${meeting.title}`);
      return meeting;
    }

    logger.info(`[PREP-NOTE-CHECK] Searching for prep note for meeting: ${meeting.title}`);

    const storagePath = this.settingsService.getSettings().storagePath;
    const meetingDate = new Date(meeting.date);
    const year = format(meetingDate, 'yyyy');
    const month = format(meetingDate, 'MM');

    // Check current month, previous month, and next month
    const prevMonth = new Date(meetingDate);
    prevMonth.setMonth(prevMonth.getMonth() - 1);
    const nextMonth = new Date(meetingDate);
    nextMonth.setMonth(nextMonth.getMonth() + 1);

    const dirsToScan = [
      storagePath, // Root for legacy
      path.join(storagePath, year, month),
      path.join(storagePath, format(prevMonth, 'yyyy'), format(prevMonth, 'MM')),
      path.join(storagePath, format(nextMonth, 'yyyy'), format(nextMonth, 'MM'))
    ];

    for (const dir of dirsToScan) {
      try {
        const files = await fs.readdir(dir);
        const mdFiles = files.filter(f => f.endsWith('.md'));

        for (const file of mdFiles) {
          const filePath = path.join(dir, file);

          try {
            const content = await fs.readFile(filePath, 'utf-8');
            const { data: frontmatter } = matter(content);

            // Skip if already adopted by checking for app-specific fields
            // Prep notes may have 'id' but won't have meetingsCache entry
            if (frontmatter.id && frontmatter.created_at && this.meetingsCache.has(frontmatter.id)) {
              continue;
            }

            // Parse filename for matching
            const filename = path.basename(filePath, '.md');
            const filenameParts = this.parseFilename(filename);

            if (!filenameParts) {
              continue;
            }

            // Try to match this prep note with our meeting
            const isMatch = this.doesPrepNoteMatchMeeting(filenameParts, meeting);

            if (isMatch) {
              logger.info(`[PREP-NOTE-CHECK] Found matching prep note: ${file}`);
              await this.adoptPrepNote(filePath, meeting, content);
              // Return the updated meeting from cache
              const updatedMeeting = await this.getMeeting(meetingId);
              return updatedMeeting || null;
            }
          } catch (error) {
            logger.debug(`[PREP-NOTE-CHECK] Error checking file ${file}:`, error);
          }
        }
      } catch (error) {
        // Directory might not exist, that's OK
        logger.debug(`[PREP-NOTE-CHECK] Directory not accessible: ${dir}`);
      }
    }

    logger.info(`[PREP-NOTE-CHECK] No prep note found for: ${meeting.title}`);
    return meeting;
  }

  /**
   * Helper to check if a prep note matches a specific meeting
   */
  private doesPrepNoteMatchMeeting(
    filenameParts: { date: Date; calendarEventId?: string; titleKeywords: string[] },
    meeting: Meeting
  ): boolean {
    // 1. Try exact calendar ID match (highest priority)
    if (filenameParts.calendarEventId && meeting.calendarEventId) {
      if (filenameParts.calendarEventId === meeting.calendarEventId) {
        return true;
      }
    }

    // 2. Check time window (±30 minutes)
    const dateWindow = 30 * 60 * 1000;
    const targetTime = filenameParts.date.getTime();
    const meetingTime = new Date(meeting.date).getTime();

    if (Math.abs(meetingTime - targetTime) > dateWindow) {
      return false;
    }

    // 3. Calculate title match score
    const meetingTitleLower = meeting.title.toLowerCase();
    let matchCount = 0;

    for (const keyword of filenameParts.titleKeywords) {
      if (meetingTitleLower.includes(keyword.toLowerCase())) {
        matchCount++;
      }
    }

    // Require at least 50% keyword match
    const matchRatio = filenameParts.titleKeywords.length > 0
      ? matchCount / filenameParts.titleKeywords.length
      : 0;

    return matchRatio >= 0.5;
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
    // Extract base ID (for recurring events, Google adds _timestamp suffix)
    const baseCalendarId = calendarId.split('_')[0];

    return Array.from(this.meetingsCache.values())
      .find(m => {
        if (!m.calendarEventId) return false;
        // Exact match or base ID match (for recurring events)
        const baseStoredId = m.calendarEventId.split('_')[0];
        return m.calendarEventId === calendarId || baseStoredId === baseCalendarId;
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
      // Scan for prep notes before syncing - picks up any notes created since startup
      await this.scanAndAdoptPrepNotes();

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
              // Touched meeting: only update calendar metadata, preserve notes/transcript/status
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
            // New meeting - check for prep notes first
            logger.info(`Adding new meeting: ${event.title}`);

            // Check for existing prep note
            const prepNoteContent = await this.checkForPrepNote(event);

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
              notes: processedNotes,
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

    // Generate filename
    const date = format(meeting.date || new Date(), 'yyyy-MM-dd');
    const sanitizedTitle = meeting.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const filename = `${date}_${sanitizedTitle}.md`;
    const filePath = path.join(this.storagePath, filename);

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