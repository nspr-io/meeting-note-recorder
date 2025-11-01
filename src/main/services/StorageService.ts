import { Meeting, TranscriptChunk, CalendarEvent, MeetingChatMessage } from '../../shared/types';
import { SettingsService } from './SettingsService';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import type { FSWatcher } from 'chokidar';
import { format } from 'date-fns';
import { app } from 'electron';
import { DescriptionProcessingService } from './DescriptionProcessingService';
import { detectPlatform } from '../../shared/utils/PlatformDetector';
import { getLogger } from './LoggingService';
import { notifyMeetingsUpdated } from '../index';
import {
  deserializeMeetingMarkdown,
  serializeMeetingToMarkdown,
  generateMeetingFileName
} from '../../shared/meetings/MeetingFileSerializer';
import {
  extractNoteSections,
  combineNoteSections,
  NoteSections
} from '../../renderer/components/noteSectionUtils';

const logger = getLogger();

logger.info('[FILE-WATCHER] StorageService module loaded', {
  platform: process.platform,
  isPackaged: app.isPackaged,
  env: {
    CHOKIDAR_USEPOLLING: process.env.CHOKIDAR_USEPOLLING,
    CHOKIDAR_INTERVAL: process.env.CHOKIDAR_INTERVAL,
  },
});

let chokidarModule: typeof import('chokidar') | null = null;
const getChokidar = (): typeof import('chokidar') => {
  if (!chokidarModule) {
    logger.info('[FILE-WATCHER] Loading chokidar module', {
      isPackaged: app.isPackaged,
      env: {
        CHOKIDAR_USEPOLLING: process.env.CHOKIDAR_USEPOLLING,
        CHOKIDAR_INTERVAL: process.env.CHOKIDAR_INTERVAL,
      },
    });
    chokidarModule = require('chokidar');
  }

  return chokidarModule!;
};

const isFsEventsWatchSupported = (() => {
  if (process.platform !== 'darwin') {
    return false;
  }

  if (app.isPackaged) {
    if (!process.env.CHOKIDAR_USEPOLLING) {
      process.env.CHOKIDAR_USEPOLLING = 'true';
      process.env.CHOKIDAR_INTERVAL = process.env.CHOKIDAR_INTERVAL || '300';
    }

    logger.info('[FILE-WATCHER] Disabling fsevents in packaged build, using fs.watch fallback');
    return false;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const fsevents = require('fsevents');
    const supported = Boolean(fsevents && typeof fsevents.watch === 'function');

    if (!supported) {
      logger.info('[FILE-WATCHER] fsevents module loaded without watch(), using fs.watch fallback');
      if (!process.env.CHOKIDAR_USEPOLLING) {
        process.env.CHOKIDAR_USEPOLLING = 'true';
        process.env.CHOKIDAR_INTERVAL = process.env.CHOKIDAR_INTERVAL || '300';
      }
    }

    return supported;
  } catch (error) {
    logger.info('[FILE-WATCHER] fsevents module unavailable, using fs.watch fallback', {
      error: error instanceof Error ? error.message : error
    });
    if (!process.env.CHOKIDAR_USEPOLLING) {
      process.env.CHOKIDAR_USEPOLLING = 'true';
      process.env.CHOKIDAR_INTERVAL = process.env.CHOKIDAR_INTERVAL || '300';
    }
    return false;
  }
})();

logger.info('[FILE-WATCHER] fsevents support evaluation complete', {
  isPackaged: app.isPackaged,
  supported: isFsEventsWatchSupported,
  env: {
    CHOKIDAR_USEPOLLING: process.env.CHOKIDAR_USEPOLLING,
    CHOKIDAR_INTERVAL: process.env.CHOKIDAR_INTERVAL,
  },
});

export class StorageService {
  private meetingsCache: Map<string, Meeting> = new Map();
  private fileWatchers: Map<string, { watcher: FSWatcher; debounceTimer?: NodeJS.Timeout }> = new Map();
  private readonly watcherDebounceMs = 300;
  private settingsService: SettingsService;
  private storagePath: string;
  private cacheFilePath: string;
  private descriptionProcessor: DescriptionProcessingService;
  private notifyMeetingsUpdated: () => void;
  private fullRefreshPromise: Promise<void> | null = null;
  private lastCacheSaveTimestamp = 0;
  private chatHistoryCache: Map<string, MeetingChatMessage[]> = new Map();
  private chatHistoryDir: string;

  constructor(settingsService: SettingsService, notifyMeetingsUpdated: () => void) {
    this.settingsService = settingsService;
    this.notifyMeetingsUpdated = notifyMeetingsUpdated;
    this.storagePath = settingsService.getSettings().storagePath;
    // Store cache in app data directory for fast loading
    const appDataPath = app.getPath('userData');
    this.cacheFilePath = path.join(appDataPath, 'meetings-cache.json');
    this.chatHistoryDir = path.join(this.storagePath, 'chat-history');

    // Initialize description processor
    this.descriptionProcessor = new DescriptionProcessingService();
    const apiKey = settingsService.getSettings().anthropicApiKey;
    this.descriptionProcessor.initialize(apiKey);
  }

  private stripUndefinedDeep<T>(value: T): T {
    if (Array.isArray(value)) {
      return value
        .filter((item) => item !== undefined)
        .map((item) => this.stripUndefinedDeep(item)) as unknown as T;
    }

    if (value instanceof Date || value instanceof Map || value === null || value === undefined) {
      return value;
    }

    if (typeof value === 'object') {
      const result: Record<string, unknown> = {};
      Object.entries(value as Record<string, unknown>).forEach(([key, val]) => {
        if (val === undefined) {
          return;
        }
        const cleaned = this.stripUndefinedDeep(val);
        if (cleaned !== undefined) {
          result[key] = cleaned;
        }
      });
      return result as unknown as T;
    }

    return value;
  }

  private normalizeDateInput(value: unknown): Date | null {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }

    if (typeof value === 'string' || typeof value === 'number') {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    return null;
  }

  private getMeetingEndTime(meeting: Meeting): Date | null {
    const explicitEnd = this.normalizeDateInput(meeting.endTime);
    if (explicitEnd) {
      return explicitEnd;
    }

    const startCandidate = meeting.startTime ?? meeting.date;
    const start = this.normalizeDateInput(startCandidate);
    if (!start) {
      return null;
    }

    const durationMinutes = typeof meeting.duration === 'number' && meeting.duration > 0
      ? meeting.duration
      : 60;

    return new Date(start.getTime() + durationMinutes * 60 * 1000);
  }

  private shouldReuseRecurringMeetingInstance(meeting: Meeting, event: CalendarEvent, now: Date): boolean {
    const eventStart = this.normalizeDateInput(event.start);
    if (!eventStart) {
      return true;
    }

    if ((meeting.status === 'completed' || meeting.status === 'partial') && eventStart > now) {
      return false;
    }

    return true;
  }

  private normalizeAttendees(value: unknown): Meeting['attendees'] {
    if (!value) {
      return [];
    }

    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((item) => item !== undefined && item !== null)
      .map((item) => {
        if (item instanceof Date || item instanceof Map) {
          return item;
        }
        if (typeof item === 'object') {
          return this.stripUndefinedDeep(item);
        }
        return item;
      }) as Meeting['attendees'];
  }

  private isValidStatus(status: unknown): status is Meeting['status'] {
    return typeof status === 'string' && (
      status === 'scheduled' ||
      status === 'recording' ||
      status === 'completed' ||
      status === 'partial' ||
      status === 'error' ||
      status === 'active'
    );
  }

  private sanitizeMeetingInput(data?: Partial<Meeting>): Partial<Meeting> {
    if (!data) {
      return {};
    }

    const cleaned = this.stripUndefinedDeep(data) as Partial<Meeting>;
    const sanitized: Partial<Meeting> = { ...cleaned };

    if ('attendees' in sanitized) {
      sanitized.attendees = this.normalizeAttendees(sanitized.attendees);
    }

    const dateFields: (keyof Partial<Meeting>)[] = ['date', 'startTime', 'endTime', 'createdAt', 'updatedAt', 'firefliesTranscriptFetchedAt'];
    dateFields.forEach((field) => {
      if (field in sanitized) {
        const normalized = this.normalizeDateInput(sanitized[field]);
        if (normalized) {
          sanitized[field] = normalized as any;
        } else if (sanitized[field] === null) {
          // Allow explicit null for optional date fields except primary date
          if (field === 'date') {
            delete sanitized[field];
          }
        } else {
          delete sanitized[field];
        }
      }
    });

    if ('notionSharedAt' in sanitized) {
      if (sanitized.notionSharedAt === null) {
        sanitized.notionSharedAt = null;
      } else {
        const normalized = this.normalizeDateInput(sanitized.notionSharedAt);
        if (normalized) {
          sanitized.notionSharedAt = normalized;
        } else {
          delete sanitized.notionSharedAt;
        }
      }
    }

    if ('status' in sanitized && !this.isValidStatus(sanitized.status)) {
      delete sanitized.status;
    }

    if ('notes' in sanitized && typeof sanitized.notes !== 'string') {
      sanitized.notes = sanitized.notes == null ? '' : String(sanitized.notes);
    }

    if ('transcript' in sanitized && typeof sanitized.transcript !== 'string') {
      sanitized.transcript = sanitized.transcript == null ? '' : String(sanitized.transcript);
    }

    if ('firefliesTranscriptId' in sanitized && sanitized.firefliesTranscriptId != null && typeof sanitized.firefliesTranscriptId !== 'string') {
      sanitized.firefliesTranscriptId = String(sanitized.firefliesTranscriptId);
    }

    if ('actionItemSyncStatus' in sanitized && Array.isArray(sanitized.actionItemSyncStatus)) {
      sanitized.actionItemSyncStatus = sanitized.actionItemSyncStatus
        .filter((item) => item !== undefined && item !== null)
        .map((item) => this.stripUndefinedDeep(item)) as Meeting['actionItemSyncStatus'];
    }

    if ('tags' in sanitized) {
      if (Array.isArray(sanitized.tags)) {
        const cleanedTags = sanitized.tags
          .filter((tag) => typeof tag === 'string')
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0);

        const unique: string[] = [];
        const seen = new Set<string>();
        for (const tag of cleanedTags) {
          if (!seen.has(tag)) {
            seen.add(tag);
            unique.push(tag);
          }
        }

        sanitized.tags = unique.slice(0, 3);
      } else {
        sanitized.tags = undefined;
      }
    }

    return sanitized;
  }

  private watchMeetingFile(meeting: Meeting): void {
    if (!meeting.filePath || this.fileWatchers.has(meeting.id)) {
      return;
    }

    const normalizedPath = path.resolve(meeting.filePath);

    logger.info('[FILE-WATCHER] Creating watcher for meeting file', {
      meetingId: meeting.id,
      filePath: normalizedPath,
      isPackaged: app.isPackaged,
      fsEventsSupported: isFsEventsWatchSupported,
      env: {
        CHOKIDAR_USEPOLLING: process.env.CHOKIDAR_USEPOLLING,
        CHOKIDAR_INTERVAL: process.env.CHOKIDAR_INTERVAL,
      },
    });

    const watcher = getChokidar().watch(normalizedPath, {
      persistent: true,
      ignoreInitial: true,
      depth: 0,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100
      },
      useFsEvents: isFsEventsWatchSupported,
      usePolling: !isFsEventsWatchSupported,
      interval: 300,
      binaryInterval: 300
    });

    const handleChange = () => {
      const entry = this.fileWatchers.get(meeting.id);
      if (!entry) {
        return;
      }

      if (entry.debounceTimer) {
        clearTimeout(entry.debounceTimer);
      }

      entry.debounceTimer = setTimeout(async () => {
        try {
          const refreshed = await this.loadMeetingFromFile(normalizedPath);
          if (refreshed) {
            this.meetingsCache.set(meeting.id, refreshed);
            logger.info('[FILE-WATCHER] Reloaded meeting from disk', {
              meetingId: meeting.id,
              filePath: normalizedPath
            });
            this.notifyMeetingsUpdated();
          }
        } catch (error) {
          logger.warn('[FILE-WATCHER] Failed to reload meeting from disk', {
            meetingId: meeting.id,
            filePath: normalizedPath,
            error: error instanceof Error ? error.message : error
          });
        }
      }, this.watcherDebounceMs);
    };

    watcher.on('change', handleChange);
    watcher.on('error', (error: unknown) => {
      logger.warn('[FILE-WATCHER] Watcher error', {
        meetingId: meeting.id,
        filePath: normalizedPath,
        error: error instanceof Error ? error.message : error
      });
    });

    this.fileWatchers.set(meeting.id, { watcher });
  }

  private unwatchMeetingFile(meetingId: string): void {
    const entry = this.fileWatchers.get(meetingId);
    if (!entry) {
      return;
    }

    if (entry.debounceTimer) {
      clearTimeout(entry.debounceTimer);
    }

    logger.info('[FILE-WATCHER] Closing watcher for meeting file', {
      meetingId,
    });

    entry.watcher.close().catch((error) => {
      logger.warn('[FILE-WATCHER] Failed to close watcher', {
        meetingId,
        error: error instanceof Error ? error.message : error
      });
    });

    this.fileWatchers.delete(meetingId);
  }

  private unwatchAllMeetingFiles(): void {
    for (const meetingId of this.fileWatchers.keys()) {
      this.unwatchMeetingFile(meetingId);
    }
  }

  private getChatHistoryFilePath(meetingId: string): string {
    return path.join(this.chatHistoryDir, `${meetingId}.json`);
  }

  private async ensureChatHistoryDir(): Promise<void> {
    try {
      await fs.mkdir(this.chatHistoryDir, { recursive: true });
    } catch (error) {
      logger.error('[CHAT-STORAGE] Failed to ensure chat history directory', {
        dir: this.chatHistoryDir,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  }

  async initialize(options?: { awaitFullSync?: boolean }): Promise<void> {
    await this.ensureChatHistoryDir();
    await this.loadCacheFromDisk();

    // Inform listeners that cached data is available immediately
    this.notifyMeetingsUpdated();

    const runFullRefresh = async () => {
      try {
        await this.migrateExistingFilesToYearMonth();
        await this.loadAllMeetings();
        await this.ensureInsightsArtifacts();
        await this.cleanupStuckRecordings();
        await this.saveCacheToDisk();
        this.notifyMeetingsUpdated();
      } finally {
        this.fullRefreshPromise = null;
      }
    };

    const fullRefreshPromise = runFullRefresh().catch((error) => {
      logger.error('[STORAGE] Full refresh failed', {
        error: error instanceof Error ? error.message : error
      });
      throw error;
    });

    this.fullRefreshPromise = fullRefreshPromise;

    if (options?.awaitFullSync) {
      await fullRefreshPromise;
    } else {
      // Prevent unhandled rejection warnings
      fullRefreshPromise.catch(() => undefined);
    }
  }

  async waitForFullRefresh(): Promise<void> {
    if (!this.fullRefreshPromise) {
      return;
    }

    await this.fullRefreshPromise;
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
      this.unwatchAllMeetingFiles();
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
          this.watchMeetingFile(meeting);
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
      const { meeting, insightsLoadError } = await deserializeMeetingMarkdown(content, {
        filePath,
        storagePath: this.getStoragePath(),
        loadInsights: true
      });

      if (insightsLoadError) {
        logger.warn('[INSIGHTS-FILE] Failed to read insights artifact', {
          meetingId: meeting.id,
          filePath,
          error: insightsLoadError instanceof Error ? insightsLoadError.message : insightsLoadError
        });
      }

      meeting.filePath = filePath;
      return meeting;
    } catch (error) {
      logger.error(`Failed to load meeting from ${filePath}:`, error);
      return null;
    }
  }

  private formatMeetingToMarkdown(meeting: Meeting): string {
    const sanitized = this.sanitizeMeetingInput(meeting);
    const merged: Meeting = { ...meeting, ...sanitized } as Meeting;
    const safeMeeting = this.stripUndefinedDeep(merged) as Meeting;

    safeMeeting.date = this.normalizeDateInput(safeMeeting.date) ?? new Date();
    safeMeeting.attendees = this.normalizeAttendees(safeMeeting.attendees ?? []);
    safeMeeting.status = this.isValidStatus(safeMeeting.status) ? safeMeeting.status : 'scheduled';
    safeMeeting.notes = typeof safeMeeting.notes === 'string' ? safeMeeting.notes : '';
    safeMeeting.transcript = typeof safeMeeting.transcript === 'string' ? safeMeeting.transcript : '';
    safeMeeting.createdAt = this.normalizeDateInput(safeMeeting.createdAt) ?? new Date();
    safeMeeting.updatedAt = this.normalizeDateInput(safeMeeting.updatedAt) ?? new Date();

    const startTime = this.normalizeDateInput(safeMeeting.startTime);
    safeMeeting.startTime = startTime ?? undefined;

    const endTime = this.normalizeDateInput(safeMeeting.endTime);
    safeMeeting.endTime = endTime ?? undefined;

    if (meeting.notionSharedAt === null || sanitized.notionSharedAt === null) {
      safeMeeting.notionSharedAt = null;
    } else {
      const notionShared = this.normalizeDateInput(safeMeeting.notionSharedAt);
      if (notionShared) {
        safeMeeting.notionSharedAt = notionShared;
      } else if (typeof safeMeeting.notionSharedAt !== 'string') {
        delete (safeMeeting as any).notionSharedAt;
      }
    }

    const sections = extractNoteSections(safeMeeting.notes || '');
    const normalizedSections: NoteSections = {
      calendarInfo: sections.calendarInfo,
      prepNotes: sections.prepNotes,
      meetingNotes: sections.meetingNotes
    };

    safeMeeting.notes = combineNoteSections(normalizedSections);

    const updatedAt = this.normalizeDateInput(safeMeeting.updatedAt) ?? new Date();
    safeMeeting.updatedAt = updatedAt;

    return serializeMeetingToMarkdown(safeMeeting, normalizedSections, { updatedAt });
  }

  private async ensureDirectoryExists(filePath: string): Promise<void> {
    const directory = path.dirname(filePath);
    await fs.mkdir(directory, { recursive: true });
  }

  private computeInsightsPaths(meeting: Meeting): { absolute: string; relative: string } {
    const storagePath = this.settingsService.getSettings().storagePath;
    const baseFilePath = meeting.filePath && meeting.filePath.trim()
      ? meeting.filePath
      : path.join(storagePath, generateMeetingFileName(meeting));

    const parsed = path.parse(baseFilePath);
    const absolute = path.join(parsed.dir, `${parsed.name}-insights.json`);
    const relative = path.relative(storagePath, absolute);

    return { absolute, relative };
  }

  async createMeeting(data: Partial<Meeting>): Promise<Meeting> {
    logger.info('[JOURNEY-STORAGE-1] Creating new meeting', {
      title: data.title,
      status: data.status,
      timestamp: new Date().toISOString()
    });

    const sanitizedInput = this.sanitizeMeetingInput(data);
    const {
      title,
      date,
      attendees,
      status,
      notes,
      transcript,
      createdAt,
      updatedAt,
      ...rest
    } = sanitizedInput;

    const meeting: Meeting = {
      id: uuidv4(),
      title: typeof title === 'string' && title.trim() ? title : 'Untitled Meeting',
      date: date ?? new Date(),
      attendees: this.normalizeAttendees(attendees),
      status: this.isValidStatus(status) ? status : 'scheduled',
      notes: typeof notes === 'string' ? notes : '',
      transcript: typeof transcript === 'string' ? transcript : '',
      createdAt: createdAt ?? new Date(),
      updatedAt: updatedAt ?? new Date(),
      ...rest,
    };

    logger.info('[JOURNEY-STORAGE-2] Meeting object created', {
      id: meeting.id,
      title: meeting.title,
      status: meeting.status
    });

    try {
      const filePath = await this.saveMeeting(meeting);
      logger.info('[JOURNEY-STORAGE-3] Meeting file ensured on create', {
        id: meeting.id,
        filePath
      });
      this.watchMeetingFile(meeting);
    } catch (error) {
      logger.error('[JOURNEY-STORAGE-3-ERROR] Failed to persist new meeting to disk', {
        id: meeting.id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }

    return meeting;
  }

  async updateMeeting(id: string, updates: Partial<Meeting>): Promise<Meeting> {
    const sanitizedUpdates = this.sanitizeMeetingInput(updates);

    logger.info('[JOURNEY-STORAGE-UPDATE-1] Updating meeting', {
      id,
      updates: Object.keys(updates),
      sanitizedUpdates: Object.keys(sanitizedUpdates),
      newStatus: sanitizedUpdates.status,
      timestamp: new Date().toISOString()
    });

    const arraysEqual = (a?: string[], b?: string[]): boolean => {
      if (!a && !b) {
        return true;
      }

      if ((!a && b) || (a && !b)) {
        return false;
      }

      const first = a ?? [];
      const second = b ?? [];

      if (first.length !== second.length) {
        return false;
      }

      return first.every((value, index) => value === second[index]);
    };

    const meeting = this.meetingsCache.get(id);
    if (!meeting) {
      logger.error('[JOURNEY-STORAGE-UPDATE-ERROR] Meeting not found', { id });
      throw new Error(`Meeting ${id} not found`);
    }

    const originalTags = Array.isArray(meeting.tags) ? [...meeting.tags] : undefined;

    // Store original values for comparison
    const originalNotes = meeting.notes || '';
    const originalTranscript = meeting.transcript || '';
    const originalInsightsPath = meeting.insightsFilePath || undefined;

    const incomingInsights = sanitizedUpdates.insights ?? undefined;

    const updatedMeeting: Meeting = {
      ...meeting,
      ...sanitizedUpdates,
      id: meeting.id, // Ensure ID doesn't change
      updatedAt: sanitizedUpdates.updatedAt ?? new Date(),
    };

    if (updatedMeeting.startTime && !(updatedMeeting.startTime instanceof Date)) {
      updatedMeeting.startTime = new Date(updatedMeeting.startTime);
    }

    if (updatedMeeting.endTime && !(updatedMeeting.endTime instanceof Date)) {
      updatedMeeting.endTime = new Date(updatedMeeting.endTime);
    }

    if (incomingInsights === null) {
      updatedMeeting.insights = '';
    }

    const storagePath = this.settingsService.getSettings().storagePath;

    if (!updatedMeeting.filePath) {
      const fileName = generateMeetingFileName(updatedMeeting);
      updatedMeeting.filePath = path.join(storagePath, fileName);
    }

    // Check if existing markdown file is present at previous path
    const fileExists = meeting.filePath ? await fs.access(meeting.filePath).then(() => true).catch(() => false) : false;

    // If file exists, re-read it to get latest notes before updating
    // This prevents overwriting user edits made outside the app
    if (fileExists && meeting.filePath) {
      try {
        const fileContent = await fs.readFile(meeting.filePath, 'utf-8');
        const parsed = await deserializeMeetingMarkdown(fileContent, { filePath: meeting.filePath });

        const fileNotes = parsed.meeting.notes || '';
        const fileTranscript = parsed.transcript;

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

    let insightsFilePath = originalInsightsPath;

    // If title or date changed AND markdown file exists, rename file (and linked insights file)
    if ((sanitizedUpdates.title || sanitizedUpdates.date) && fileExists && meeting.filePath) {
      const oldPath = meeting.filePath;
      const newFileName = generateMeetingFileName(updatedMeeting);
      const newPath = path.join(storagePath, newFileName);

      if (oldPath !== newPath) {
        await this.ensureDirectoryExists(newPath);
        await fs.rename(oldPath, newPath);
        updatedMeeting.filePath = newPath;

        if (insightsFilePath) {
          const oldInsightsAbsolute = path.isAbsolute(insightsFilePath)
            ? insightsFilePath
            : path.join(storagePath, insightsFilePath);
          const { absolute: newInsightsAbsolute, relative: newInsightsRelative } = this.computeInsightsPaths(updatedMeeting);

          try {
            await this.ensureDirectoryExists(newInsightsAbsolute);
            await fs.rename(oldInsightsAbsolute, newInsightsAbsolute);
            insightsFilePath = newInsightsRelative;
          } catch (error) {
            logger.warn('[INSIGHTS-RENAME] Failed to rename insights artifact', {
              meetingId: id,
              oldPath: oldInsightsAbsolute,
              newPath: newInsightsAbsolute,
              error: error instanceof Error ? error.message : error
            });
          }
        }
      }
    }

    if (incomingInsights !== undefined) {
      const raw = typeof incomingInsights === 'string' ? incomingInsights : '';
      const trimmed = raw.trim();

      if (trimmed) {
        const { absolute: insightsAbsolute, relative: insightsRelative } = this.computeInsightsPaths(updatedMeeting);
        await this.ensureDirectoryExists(insightsAbsolute);

        let normalized = raw;
        try {
          normalized = JSON.stringify(JSON.parse(raw), null, 2);
        } catch (error) {
          logger.warn('[INSIGHTS-WRITE] Incoming insights are not valid JSON', {
            meetingId: id,
            error: error instanceof Error ? error.message : error
          });
        }

        await fs.writeFile(insightsAbsolute, normalized, 'utf-8');
        updatedMeeting.insights = normalized;
        insightsFilePath = insightsRelative;
      } else {
        if (insightsFilePath) {
          const absolutePath = path.isAbsolute(insightsFilePath)
            ? insightsFilePath
            : path.join(storagePath, insightsFilePath);
          try {
            await fs.unlink(absolutePath);
          } catch (error: any) {
            if (error?.code !== 'ENOENT') {
              logger.warn('[INSIGHTS-DELETE] Failed to remove insights artifact', {
                meetingId: id,
                path: absolutePath,
                error: error instanceof Error ? error.message : error
              });
            }
          }
        }
        insightsFilePath = undefined;
        updatedMeeting.insights = '';
      }
    }

    updatedMeeting.insightsFilePath = insightsFilePath;

    const updatedTags = Array.isArray(updatedMeeting.tags) ? [...updatedMeeting.tags] : undefined;
    const tagsChanged = !arraysEqual(originalTags, updatedTags);

    const hasSignificantNotes = !!(updatedMeeting.notes && updatedMeeting.notes.trim().length > 0);
    const hasSignificantTranscript = !!(updatedMeeting.transcript && updatedMeeting.transcript.trim().length > 0);
    const notesChanged = updatedMeeting.notes !== originalNotes;
    const transcriptChanged = updatedMeeting.transcript !== originalTranscript;
    const insightsPathChanged = insightsFilePath !== originalInsightsPath;
    const structuralFieldChanged = Boolean(
      sanitizedUpdates.status !== undefined ||
      sanitizedUpdates.title !== undefined ||
      sanitizedUpdates.date !== undefined ||
      sanitizedUpdates.duration !== undefined ||
      sanitizedUpdates.calendarEventId !== undefined ||
      sanitizedUpdates.meetingUrl !== undefined ||
      sanitizedUpdates.startTime !== undefined ||
      sanitizedUpdates.endTime !== undefined ||
      sanitizedUpdates.attendees !== undefined ||
      sanitizedUpdates.notes !== undefined ||
      tagsChanged ||
      sanitizedUpdates.insights !== undefined ||
      sanitizedUpdates.recallRecordingId !== undefined ||
      sanitizedUpdates.recallVideoUrl !== undefined ||
      sanitizedUpdates.recallAudioUrl !== undefined
    );

    const shouldCreateFile = !fileExists;
    const shouldUpdateFile = fileExists && (
      notesChanged ||
      transcriptChanged ||
      sanitizedUpdates.title ||
      sanitizedUpdates.date ||
      sanitizedUpdates.status ||
      sanitizedUpdates.duration ||
      tagsChanged ||
      insightsPathChanged
    );

    if (shouldCreateFile || shouldUpdateFile) {
      await this.ensureDirectoryExists(updatedMeeting.filePath!);
      const markdown = this.formatMeetingToMarkdown(updatedMeeting);
      await fs.writeFile(updatedMeeting.filePath!, markdown, 'utf-8');

      logger.info('[JOURNEY-STORAGE-UPDATE] File ' + (shouldCreateFile ? 'created' : 'updated'), {
        id: updatedMeeting.id,
        filePath: updatedMeeting.filePath,
        wasCreated: shouldCreateFile,
        hasNotes: hasSignificantNotes,
        hasTranscript: hasSignificantTranscript,
        hasTags: Array.isArray(updatedMeeting.tags) && updatedMeeting.tags.length > 0,
        hasInsights: !!insightsFilePath
      });
    } else {
      logger.info('[JOURNEY-STORAGE-UPDATE] No file operation needed', {
        id: meeting.id,
        fileExists,
        hasContent: hasSignificantNotes || hasSignificantTranscript || !!insightsFilePath
      });
    }

    this.meetingsCache.set(id, updatedMeeting);
    this.watchMeetingFile(updatedMeeting);
    logger.info('[JOURNEY-STORAGE-UPDATE-2] Meeting updated in cache', {
      id,
      title: updatedMeeting.title,
      status: updatedMeeting.status
    });

    const now = Date.now();
    const onlyTranscriptChanged = transcriptChanged && !notesChanged && !insightsPathChanged && !structuralFieldChanged;
    const shouldSaveCache = !onlyTranscriptChanged || (now - this.lastCacheSaveTimestamp) > 60000;

    if (shouldSaveCache) {
      await this.saveCacheToDisk();
      logger.info('[JOURNEY-STORAGE-UPDATE-3] Updated meeting saved to disk');
    } else {
      logger.debug('[JOURNEY-STORAGE-UPDATE-THROTTLED] Skipped cache save due to transcript-only change within throttle window', {
        id,
        throttleWindowMs: 60000
      });
    }

    return updatedMeeting;
  }

  async deleteMeeting(id: string): Promise<void> {
    const meeting = this.meetingsCache.get(id);
    if (!meeting) {
      throw new Error(`Meeting ${id} not found`);
    }

    this.unwatchMeetingFile(id);

    if (meeting.filePath) {
      try {
        await fs.unlink(meeting.filePath);
      } catch (error) {
        logger.error(`Failed to delete meeting file: ${error}`);
      }
    }

    if (meeting.insightsFilePath) {
      const storagePath = this.settingsService.getSettings().storagePath;
      const insightsPath = path.isAbsolute(meeting.insightsFilePath)
        ? meeting.insightsFilePath
        : path.join(storagePath, meeting.insightsFilePath);

      try {
        await fs.unlink(insightsPath);
      } catch (error) {
        logger.warn('[INSIGHTS-DELETE] Failed to remove insights artifact during delete', {
          meetingId: id,
          path: insightsPath,
          error: error instanceof Error ? error.message : error
        });
      }
    }

    try {
      await this.clearMeetingChatHistory(id);
    } catch (error) {
      logger.warn('[CHAT-STORAGE] Failed to clear chat history during delete', {
        meetingId: id,
        error: error instanceof Error ? error.message : error
      });
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
        this.watchMeetingFile(refreshed);
        logger.info('[REFRESH-MEETING] Refreshed meeting from disk', {
          id,
          title: refreshed.title,
          notesLength: refreshed.notes?.length || 0
        });
        return refreshed;
      }
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code === 'ENOENT') {
        logger.warn('[REFRESH-MEETING] Meeting file missing on disk, regenerating from cache', {
          id,
          filePath: meeting.filePath
        });
        try {
          await this.saveMeetingToFile(meeting);
          this.watchMeetingFile(meeting);
        } catch (saveError) {
          logger.error('[REFRESH-MEETING] Failed to recreate missing meeting file', {
            id,
            error: saveError instanceof Error ? saveError.message : saveError
          });
        }
      } else {
        logger.error('[REFRESH-MEETING] Failed to refresh from disk, using cache', { id, error });
      }
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
    const processedBaseIds = new Set<string>();
    const MOVE_ASSOCIATION_THRESHOLD_MS = 1000 * 60 * 60 * 24 * 30;

    const getMeetingStartDate = (meeting: Meeting): Date | null => {
      const candidate = (meeting.startTime ?? meeting.date) as Date | string | undefined;
      if (!candidate) {
        return null;
      }

      if (candidate instanceof Date) {
        return Number.isNaN(candidate.getTime()) ? null : candidate;
      }

      const parsed = new Date(candidate);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

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
          const baseId = event.id.split('_')[0];
          if (baseId) {
            processedBaseIds.add(baseId);
          }
          if (!event.start || Number.isNaN(new Date(event.start).getTime()) || !event.end || Number.isNaN(new Date(event.end).getTime())) {
            logger.warn(`[SMART-SYNC] Skipping event ${event.id} due to invalid start/end time`, {
              title: event.title,
              hasStart: !!event.start,
              hasEnd: !!event.end
            });
            continue;
          }
          const now = new Date();
          let existingMeeting = await this.getMeetingByCalendarId(event.id);
          let matchedByRecurringBase = false;

          if (!existingMeeting && event.id.includes('_')) {
            const fallbackBaseId = event.id.split('_')[0];
            const fallbackCandidates = existingMeetings.filter((meeting) => {
              if (!meeting.calendarEventId) {
                return false;
              }
              const meetingBaseId = meeting.calendarEventId.split('_')[0];
              return meetingBaseId === fallbackBaseId && this.isMeetingTouched(meeting);
            });

            if (fallbackCandidates.length > 0) {
              let bestCandidate: Meeting | null = null;
              let smallestDiff = Number.POSITIVE_INFINITY;
              const eventStart = event.start instanceof Date ? event.start : new Date(event.start);

              for (const candidate of fallbackCandidates) {
                const candidateStart = getMeetingStartDate(candidate);
                if (!candidateStart) {
                  continue;
                }

                const diff = Math.abs(candidateStart.getTime() - eventStart.getTime());
                if (diff < smallestDiff) {
                  smallestDiff = diff;
                  bestCandidate = candidate;
                }
              }

              if (bestCandidate && smallestDiff <= MOVE_ASSOCIATION_THRESHOLD_MS) {
                const reuseExisting = this.shouldReuseRecurringMeetingInstance(bestCandidate, event, now);

                if (reuseExisting) {
                  existingMeeting = bestCandidate;
                  matchedByRecurringBase = true;
                  if (bestCandidate.calendarEventId) {
                    processedCalendarIds.add(bestCandidate.calendarEventId);
                  }
                  logger.info(`[SMART-SYNC] Matched moved recurring meeting`, {
                    baseId: fallbackBaseId,
                    previousId: bestCandidate.calendarEventId,
                    newId: event.id,
                    meetingId: bestCandidate.id
                  });
                } else {
                  logger.info(`[SMART-SYNC] Preserving completed meeting history, creating new instance`, {
                    baseId: fallbackBaseId,
                    previousId: bestCandidate.calendarEventId,
                    newId: event.id,
                    meetingId: bestCandidate.id,
                    meetingStatus: bestCandidate.status
                  });
                }
              }
            }
          }

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
                calendarEventId: event.id,
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
                calendarEventId: event.id,
                updatedAt: new Date()
              });
            }
            result.updated++;
            if (matchedByRecurringBase && existingMeeting.calendarEventId !== event.id) {
              existingMeeting.calendarEventId = event.id;
            }
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

          const meetingBaseId = meeting.calendarEventId?.split('_')[0];
          if (meetingBaseId && processedBaseIds.has(meetingBaseId) && this.isMeetingTouched(meeting)) {
            logger.info(`[SMART-SYNC] Skipping deletion for moved meeting: ${meeting.title}`);
            continue;
          }

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
        const hydratedMeeting: Meeting = {
          ...meeting,
          date: new Date(meeting.date),
          startTime: meeting.startTime ? new Date(meeting.startTime as any) : meeting.startTime,
          endTime: meeting.endTime ? new Date(meeting.endTime as any) : meeting.endTime,
          createdAt: meeting.createdAt ? new Date(meeting.createdAt as any) : meeting.createdAt,
          updatedAt: meeting.updatedAt ? new Date(meeting.updatedAt as any) : meeting.updatedAt,
        };

        const meetingDate = hydratedMeeting.date instanceof Date ? hydratedMeeting.date : new Date(hydratedMeeting.date);
        const now = new Date();

        // Include meetings from last 6 months OR future meetings OR active/recording meetings
        if (meetingDate >= sixMonthsAgo || meetingDate > now || hydratedMeeting.status === 'active' || hydratedMeeting.status === 'recording') {
          this.meetingsCache.set(hydratedMeeting.id, hydratedMeeting);
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
      this.lastCacheSaveTimestamp = Date.now();
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

  async appendTranscript(meetingId: string, chunk: TranscriptChunk, options?: { dedupeKey?: string; replace?: boolean }): Promise<void> {
    logger.info('[JOURNEY-TRANSCRIPT-APPEND] Appending transcript chunk', {
      meetingId,
      speaker: chunk.speaker,
      textLength: chunk.text?.length,
      timestamp: chunk.timestamp,
      sequenceId: chunk.sequenceId,
      isFinal: chunk.isFinal,
      dedupeKey: options?.dedupeKey,
      replace: options?.replace
    });

    const meeting = this.meetingsCache.get(meetingId);
    if (!meeting) {
      logger.error('[JOURNEY-TRANSCRIPT-ERROR] Meeting not found for transcript', { meetingId });
      throw new Error(`Meeting ${meetingId} not found`);
    }

    const timestamp = format(new Date(chunk.timestamp), 'HH:mm:ss');
    const line = chunk.speaker 
      ? `[${timestamp}] ${chunk.speaker}: ${chunk.text}`
      : `[${timestamp}] ${chunk.text}`;

    // Deduplicate by hashed key to avoid duplicates from partial/final pairs
    const dedupeKey = options?.dedupeKey || chunk.sequenceId || chunk.hash;
    if (dedupeKey) {
      if (!meeting.__transcriptDedupeIndex) {
        Object.defineProperty(meeting, '__transcriptDedupeIndex', {
          value: new Map<string, string>(),
          enumerable: false,
          configurable: false,
          writable: false
        });
      }
      const dedupeIndex: Map<string, string> = meeting.__transcriptDedupeIndex!;
      const existingLine = dedupeIndex.get(dedupeKey);

      if (existingLine && !options?.replace) {
        logger.info('[JOURNEY-TRANSCRIPT-APPEND] Skipping duplicate transcript chunk', {
          meetingId,
          dedupeKey
        });
        return;
      }

      if (options?.replace && existingLine) {
        meeting.transcript = meeting.transcript
          ? meeting.transcript.replace(existingLine, line)
          : line;
      } else {
        meeting.transcript = meeting.transcript
          ? `${meeting.transcript}\n${line}`
          : line;
      }

      dedupeIndex.set(dedupeKey, line);
    } else {
      meeting.transcript = meeting.transcript
        ? `${meeting.transcript}\n${line}`
        : line;
    }

    await this.updateMeeting(meetingId, { transcript: meeting.transcript });
  }

  async getMeetingChatHistory(meetingId: string): Promise<MeetingChatMessage[]> {
    const cached = this.chatHistoryCache.get(meetingId);
    if (cached) {
      return cached;
    }

    const filePath = this.getChatHistoryFilePath(meetingId);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content) as MeetingChatMessage[];
      const normalized = Array.isArray(parsed)
        ? parsed.filter((entry) => entry && typeof entry.id === 'string' && typeof entry.content === 'string')
        : [];
      this.chatHistoryCache.set(meetingId, normalized);
      return normalized;
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        logger.error('[CHAT-STORAGE] Failed to read chat history', {
          meetingId,
          filePath,
          error: error instanceof Error ? error.message : error
        });
      }
      this.chatHistoryCache.set(meetingId, []);
      return [];
    }
  }

  async appendMeetingChatHistory(meetingId: string, messages: MeetingChatMessage[]): Promise<MeetingChatMessage[]> {
    if (!Array.isArray(messages) || messages.length === 0) {
      return this.getMeetingChatHistory(meetingId);
    }

    const history = [...await this.getMeetingChatHistory(meetingId), ...messages];
    await this.saveMeetingChatHistory(meetingId, history);
    return history;
  }

  async saveMeetingChatHistory(meetingId: string, history: MeetingChatMessage[]): Promise<void> {
    await this.ensureChatHistoryDir();
    const filePath = this.getChatHistoryFilePath(meetingId);
    this.chatHistoryCache.set(meetingId, history);
    await fs.writeFile(filePath, JSON.stringify(history, null, 2), 'utf-8');
  }

  async clearMeetingChatHistory(meetingId: string): Promise<void> {
    this.chatHistoryCache.delete(meetingId);
    const filePath = this.getChatHistoryFilePath(meetingId);
    try {
      await fs.unlink(filePath);
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        logger.error('[CHAT-STORAGE] Failed to remove chat history file', {
          meetingId,
          filePath,
          error: error instanceof Error ? error.message : error
        });
      }
    }
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
            const fileName = generateMeetingFileName(meeting);
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
    this.unwatchAllMeetingFiles();
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
      generateMeetingFileName(meeting)
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

  private async ensureInsightsArtifacts(): Promise<void> {
    let updatedCount = 0;

    for (const meeting of this.meetingsCache.values()) {
      const insightsString = typeof meeting.insights === 'string' ? meeting.insights.trim() : '';
      const hasStoredPath = !!meeting.insightsFilePath;

      if (!insightsString && !hasStoredPath) {
        continue;
      }

      const { absolute, relative } = this.computeInsightsPaths(meeting);

      let artifactExists = false;
      try {
        await fs.access(absolute);
        artifactExists = true;
      } catch {
        artifactExists = false;
      }

      let needsMarkdownUpdate = false;

      if (insightsString) {
        if (!artifactExists) {
          try {
            await this.ensureDirectoryExists(absolute);
            let normalized = meeting.insights as string;
            try {
              normalized = JSON.stringify(JSON.parse(normalized), null, 2);
            } catch (error) {
              logger.warn('[INSIGHTS-BACKFILL] Stored insights are not valid JSON', {
                meetingId: meeting.id,
                error: error instanceof Error ? error.message : error
              });
            }

            await fs.writeFile(absolute, normalized, 'utf-8');
            artifactExists = true;
          } catch (error) {
            logger.error('[INSIGHTS-BACKFILL] Failed to write insights artifact', {
              meetingId: meeting.id,
              path: absolute,
              error: error instanceof Error ? error.message : error
            });
            continue;
          }
        }

        if (meeting.insightsFilePath !== relative) {
          meeting.insightsFilePath = relative;
          needsMarkdownUpdate = true;
        }
      } else {
        if (artifactExists) {
          try {
            await fs.unlink(absolute);
          } catch (error) {
            logger.warn('[INSIGHTS-BACKFILL] Failed to remove stale insights artifact', {
              meetingId: meeting.id,
              path: absolute,
              error: error instanceof Error ? error.message : error
            });
          }
        }

        if (meeting.insightsFilePath) {
          meeting.insightsFilePath = undefined;
          needsMarkdownUpdate = true;
        }
      }

      if (needsMarkdownUpdate) {
        await this.saveMeetingToFile(meeting);
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      logger.info(`[INSIGHTS-BACKFILL] Updated insights linkage for ${updatedCount} meetings`);
    }
  }
}