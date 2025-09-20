import { Meeting, TranscriptChunk, CalendarEvent } from '../../shared/types';
import { SettingsService } from './SettingsService';
import { v4 as uuidv4 } from 'uuid';
import matter from 'gray-matter';
import path from 'path';
import fs from 'fs/promises';
import { format } from 'date-fns';
import { app } from 'electron';

export class StorageService {
  private meetingsCache: Map<string, Meeting> = new Map();
  private settingsService: SettingsService;
  private storagePath: string;
  private cacheFilePath: string;

  constructor(settingsService: SettingsService) {
    this.settingsService = settingsService;
    this.storagePath = settingsService.getSettings().storagePath;
    // Store cache in app data directory for fast loading
    const appDataPath = app.getPath('userData');
    this.cacheFilePath = path.join(appDataPath, 'meetings-cache.json');
  }

  async initialize(): Promise<void> {
    // First load from cache for instant display
    await this.loadCacheFromDisk();

    // Clean up any stuck "recording" states from previous app crashes
    await this.cleanupStuckRecordings();

    // Scan for and adopt any prep notes
    await this.scanAndAdoptPrepNotes();

    // Then load actual meeting files in background to update cache
    this.loadAllMeetings().then(() => this.saveCacheToDisk());
  }

  private async scanAndAdoptPrepNotes(): Promise<void> {
    const storagePath = this.settingsService.getSettings().storagePath;

    try {
      // Ensure storage path exists
      await fs.mkdir(storagePath, { recursive: true });

      const files = await fs.readdir(storagePath);
      const mdFiles = files.filter(f => f.endsWith('.md'));

      console.log(`[PREP-NOTES] Scanning ${mdFiles.length} markdown files for prep notes`);

      // Process files sequentially to avoid race conditions
      for (const file of mdFiles) {
        const filePath = path.join(storagePath, file);
        try {
          await this.attemptPrepNoteAdoption(filePath);
        } catch (error) {
          console.error(`[PREP-NOTES] Failed to process ${file}:`, error);
          // Continue with other files even if one fails
        }
      }
    } catch (error) {
      console.error('[PREP-NOTES] Failed to scan for prep notes:', error);
    }
  }

  private async attemptPrepNoteAdoption(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const { data: frontmatter } = matter(content);

      // Skip if already has an ID (already adopted)
      if (frontmatter.id) {
        return;
      }

      console.log(`[PREP-NOTES] Found orphan prep note: ${path.basename(filePath)}`);

      // Parse filename for matching info
      const filename = path.basename(filePath, '.md');
      const filenameParts = this.parseFilename(filename);

      if (!filenameParts) {
        console.log(`[PREP-NOTES] Could not parse filename: ${filename}`);
        return;
      }

      // Try to match with a calendar event
      const matchedMeeting = await this.matchPrepNoteToMeeting(filenameParts, content);

      if (matchedMeeting) {
        console.log(`[PREP-NOTES] Matched to meeting: ${matchedMeeting.title}`);
        await this.adoptPrepNote(filePath, matchedMeeting, content);
      } else {
        console.log(`[PREP-NOTES] No match found, will be adopted when meeting is created`);
      }
    } catch (error) {
      console.error(`[PREP-NOTES] Failed to process ${filePath}:`, error);
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
      // Ensure directory exists
      await fs.mkdir(storagePath, { recursive: true });

      const files = await fs.readdir(storagePath);
      const mdFiles = files.filter(f => f.endsWith('.md'));

      // Track best match in case no perfect match is found
      let bestMatch: { score: number; content: string; filePath: string } | null = null;

      for (const file of mdFiles) {
        const filePath = path.join(storagePath, file);

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
          console.error(`[PREP-NOTES] Error reading ${file}:`, fileError);
          // Continue with other files
        }
      }

      // Use best match if score is high enough
      if (bestMatch && bestMatch.score > 0.5) {
        console.log(`[PREP-NOTES] Found prep note for event: ${event.title} (score: ${bestMatch.score.toFixed(2)})`);

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
          console.error('[PREP-NOTES] Failed to mark prep note:', markError);
        }

        return bestMatch.content;
      }
    } catch (error) {
      console.error('[PREP-NOTES] Error checking for prep notes:', error);
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
            console.log(`[PREP-NOTES] Renamed ${path.basename(filePath)} to ${newFileName}`);
          } catch (unlinkError) {
            console.error(`[PREP-NOTES] Failed to remove old file ${filePath}:`, unlinkError);
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

      console.log(`[PREP-NOTES] Successfully adopted prep note for meeting: ${meeting.title}`);
    } catch (error) {
      console.error(`[PREP-NOTES] Failed to adopt prep note for meeting ${meeting.title}:`, error);
      throw error;
    }
  }

  private async cleanupStuckRecordings(): Promise<void> {
    console.log('Cleaning up stuck recordings...');
    let cleanupCount = 0;

    for (const [id, meeting] of this.meetingsCache.entries()) {
      if (meeting.status === 'recording' || meeting.status === 'active') {
        // Update status to completed if it was stuck in recording
        meeting.status = 'completed';
        this.meetingsCache.set(id, meeting);

        // Update the file if it exists
        if (meeting.filePath) {
          try {
            await this.saveMeetingToFile(meeting);
            cleanupCount++;
          } catch (error) {
            console.error(`Failed to update stuck meeting ${id}:`, error);
          }
        }
      }
    }

    if (cleanupCount > 0) {
      console.log(`Cleaned up ${cleanupCount} stuck recordings`);
      await this.saveCacheToDisk();
    }
  }

  private async loadAllMeetings(): Promise<void> {
    const storagePath = this.settingsService.getSettings().storagePath;
    
    try {
      const files = await fs.readdir(storagePath);
      const mdFiles = files.filter(f => f.endsWith('.md'));
      
      for (const file of mdFiles) {
        const filePath = path.join(storagePath, file);
        const meeting = await this.loadMeetingFromFile(filePath);
        if (meeting) {
          this.meetingsCache.set(meeting.id, meeting);
        }
      }
    } catch (error) {
      console.error('Failed to load meetings:', error);
    }
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
        status: data.status || 'completed',
        notes,
        transcript,
        filePath,
        createdAt: new Date(data.created_at || Date.now()),
        updatedAt: new Date(data.updated_at || Date.now()),
      };

      return meeting;
    } catch (error) {
      console.error(`Failed to load meeting from ${filePath}:`, error);
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

    const content = `# Meeting Notes

${meeting.notes || ''}

---

# Transcript

${meeting.transcript || ''}`;

    return matter.stringify(content, frontmatter);
  }

  private generateFileName(meeting: Meeting): string {
    // Format: YYYY-MM-DD-HH-mm-[eventId]-title-slug.md
    const date = new Date(meeting.date);
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

    return `${dateStr}-${eventIdPart}${titleSlug}.md`;
  }

  async createMeeting(data: Partial<Meeting>): Promise<Meeting> {
    console.log('[JOURNEY-STORAGE-1] Creating new meeting', {
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

    console.log('[JOURNEY-STORAGE-2] Meeting object created', {
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
      const markdown = this.formatMeetingToMarkdown(meeting);
      await fs.writeFile(meeting.filePath, markdown, 'utf-8');
      console.log('[JOURNEY-STORAGE-3] Meeting file created immediately (has content)', {
        id: meeting.id,
        hasNotes,
        hasTranscript,
        filePath: meeting.filePath
      });
    } else {
      console.log('[JOURNEY-STORAGE-3] Meeting file NOT created (no content yet)', {
        id: meeting.id,
        filePath: meeting.filePath
      });
    }

    this.meetingsCache.set(meeting.id, meeting);
    console.log('[JOURNEY-STORAGE-4] Meeting added to cache', {
      id: meeting.id,
      cacheSize: this.meetingsCache.size
    });

    await this.saveCacheToDisk(); // Save cache after creating meeting
    console.log('[JOURNEY-STORAGE-5] Cache saved to disk', {
      id: meeting.id
    });

    return meeting;
  }

  async updateMeeting(id: string, updates: Partial<Meeting>): Promise<Meeting> {
    console.log('[JOURNEY-STORAGE-UPDATE-1] Updating meeting', {
      id,
      updates: Object.keys(updates),
      newStatus: updates.status,
      timestamp: new Date().toISOString()
    });

    const meeting = this.meetingsCache.get(id);
    if (!meeting) {
      console.error('[JOURNEY-STORAGE-UPDATE-ERROR] Meeting not found', { id });
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
      // If title or date changed AND file exists, rename file
      if ((updates.title || updates.date) && fileExists) {
        const oldPath = meeting.filePath!;
        const newFileName = this.generateFileName(updatedMeeting);
        const storagePath = this.settingsService.getSettings().storagePath;
        const newPath = path.join(storagePath, newFileName);

        if (oldPath !== newPath) {
          await fs.rename(oldPath, newPath);
          updatedMeeting.filePath = newPath;
        }
      }

      const markdown = this.formatMeetingToMarkdown(updatedMeeting);
      await fs.writeFile(updatedMeeting.filePath!, markdown, 'utf-8');

      console.log('[JOURNEY-STORAGE-UPDATE] File ' + (shouldCreateFile ? 'created' : 'updated'), {
        id: updatedMeeting.id,
        filePath: updatedMeeting.filePath,
        wasCreated: shouldCreateFile,
        hasNotes: hasSignificantNotes,
        hasTranscript: hasSignificantTranscript
      });
    } else {
      console.log('[JOURNEY-STORAGE-UPDATE] No file operation needed', {
        id: meeting.id,
        fileExists,
        hasContent: hasSignificantNotes || hasSignificantTranscript
      });
    }

    this.meetingsCache.set(id, updatedMeeting);
    console.log('[JOURNEY-STORAGE-UPDATE-2] Meeting updated in cache', {
      id,
      title: updatedMeeting.title,
      status: updatedMeeting.status
    });

    await this.saveCacheToDisk(); // Save cache after updating meeting
    console.log('[JOURNEY-STORAGE-UPDATE-3] Updated meeting saved to disk');

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
        console.error(`Failed to delete meeting file: ${error}`);
      }
    }

    this.meetingsCache.delete(id);
    await this.saveCacheToDisk(); // Save cache after deleting meeting
  }

  async getMeeting(id: string): Promise<Meeting | undefined> {
    const meeting = this.meetingsCache.get(id);
    console.log('[JOURNEY-STORAGE-GET] Getting meeting from cache', {
      id,
      found: !!meeting,
      title: meeting?.title,
      status: meeting?.status
    });
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
      .find(m => m.calendarEventId === calendarId);
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
      console.log(`Smart sync: Processing ${calendarEvents.length} calendar events`);

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
              // Touched meeting: update date/time/title but preserve user data
              console.log(`Updating touched meeting: ${existingMeeting.title}`);
              await this.updateMeeting(existingMeeting.id, {
                title: event.title,
                date: event.start,
                startTime: event.start,
                endTime: event.end,
                attendees: event.attendees,
                updatedAt: new Date()
              });
            } else {
              // Untouched meeting: full update
              console.log(`Updating untouched meeting: ${existingMeeting.title}`);
              await this.updateMeeting(existingMeeting.id, {
                title: event.title,
                date: event.start,
                startTime: event.start,
                endTime: event.end,
                attendees: event.attendees,
                updatedAt: new Date()
              });
            }
            result.updated++;
          } else {
            // New meeting - check for prep notes first
            console.log(`Adding new meeting: ${event.title}`);

            // Check for existing prep note
            const prepNoteContent = await this.checkForPrepNote(event);

            const newMeeting: Partial<Meeting> = {
              title: event.title,
              date: event.start,
              startTime: event.start,
              endTime: event.end,
              attendees: event.attendees,
              calendarEventId: event.id,
              status: 'scheduled',
              notes: prepNoteContent || event.description || '', // Use prep note > event description > empty
              transcript: '',
              platform: 'googlemeet' // Default assumption
            };

            await this.createMeeting(newMeeting);
            result.added++;
          }
        } catch (error: any) {
          console.error(`Error processing calendar event ${event.id}:`, error);
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
              console.log(`Marking touched meeting as deleted: ${meeting.title}`);
              await this.updateMeeting(meeting.id, {
                title: `[DELETED] ${meeting.title}`,
                updatedAt: new Date()
              });
            } else {
              console.log(`Meeting already marked as deleted: ${meeting.title}`);
            }
          } else {
            // Untouched meeting: safe to remove
            console.log(`Removing untouched deleted meeting: ${meeting.title}`);
            await this.deleteMeeting(meeting.id);
          }
          result.deleted++;
        }
      }

      console.log(`Smart sync completed: ${result.added} added, ${result.updated} updated, ${result.deleted} deleted`);
      return result;

    } catch (error: any) {
      console.error('Smart sync failed:', error);
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

      console.log(`Loaded ${this.meetingsCache.size} meetings from cache (last 6 months + future + active)`);
    } catch (error) {
      // Cache doesn't exist yet, that's ok
      console.log('No cache file found, starting fresh');
    }
  }

  private async saveCacheToDisk(): Promise<void> {
    try {
      const meetings = Array.from(this.meetingsCache.values());
      await fs.writeFile(
        this.cacheFilePath, 
        JSON.stringify(meetings, null, 2),
        'utf-8'
      );
      console.log(`Saved ${meetings.length} meetings to cache`);
    } catch (error) {
      console.error('Failed to save cache:', error);
    }
  }

  async appendTranscript(meetingId: string, chunk: TranscriptChunk): Promise<void> {
    console.log('[JOURNEY-TRANSCRIPT-APPEND] Appending transcript chunk', {
      meetingId,
      speaker: chunk.speaker,
      textLength: chunk.text?.length,
      timestamp: chunk.timestamp
    });

    const meeting = this.meetingsCache.get(meetingId);
    if (!meeting) {
      console.error('[JOURNEY-TRANSCRIPT-ERROR] Meeting not found for transcript', { meetingId });
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

    const timer = setInterval(async () => {
      const meeting = this.meetingsCache.get(meetingId);
      if (meeting) {
        const markdown = this.formatMeetingToMarkdown(meeting);
        await fs.writeFile(meeting.filePath!, markdown, 'utf-8');
      }
    }, interval);

    this.autoSaveTimers.set(meetingId, timer);
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
    const markdown = this.formatMeetingToMarkdown(meeting);
    await fs.writeFile(filePath, markdown, 'utf-8');

    return filePath;
  }

  // Alias for compatibility
  async saveMeetingToFile(meeting: Meeting): Promise<string> {
    return this.saveMeeting(meeting);
  }
}