#!/usr/bin/env node

process.env.ELECTRON_RUN_AS_NODE = process.env.ELECTRON_RUN_AS_NODE || '1';

import path from 'path';
import os from 'os';
import { existsSync, mkdirSync } from 'fs';
import chokidar from 'chokidar';

import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import ElectronStore from 'electron-store';

import { Meeting } from '../shared/types';
import { SearchService, SearchResult } from '../main/services/SearchService';
import {
  MeetingFileRepository,
  MeetingFileData,
  PrepSectionSaveOptions
} from '../shared/meetings/MeetingFileRepository';

interface IndexedMeeting {
  meeting: Meeting;
  filePath: string;
  fileName: string;
  hasPrep: boolean;
  hasTranscript: boolean;
  prepSnippet: string | null;
  transcriptSnippet: string | null;
  sections: MeetingFileData['sections'];
}

interface ToolResponsePayload {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResponsePayload>;

function parseDateBoundary(value: unknown, options: { endOfDay?: boolean } = {}): Date | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  if (options.endOfDay) {
    date.setHours(23, 59, 59, 999);
  } else {
    date.setHours(0, 0, 0, 0);
  }

  return date;
}

class MeetingNoteRecorderMcpServer {
  private readonly server: McpServer;
  private readonly repository: MeetingFileRepository;
  private readonly searchService: SearchService;
  private readonly indexedMeetings = new Map<string, IndexedMeeting>();
  private indexBuilt = false;
  private watcher: chokidar.FSWatcher | null = null;

  constructor(storagePath: string) {
    log('[INIT] Starting Meeting Note Recorder MCP server');
    log(`[INIT] Using storage path: ${storagePath}`);
    this.server = new McpServer(
      {
        name: 'meeting-note-recorder-mcp',
        version: '1.0.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );

    this.repository = new MeetingFileRepository(storagePath);
    this.searchService = new SearchService();

    this.registerHandlers();
  }

  private registerHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'check_prep_exists',
          description: 'Check if prep notes already exist for a meeting.',
          inputSchema: {
            type: 'object',
            properties: {
              calendar_event_id: {
                type: 'string',
                description: 'Calendar event ID (supports recurring instances).'
              }
            },
            required: ['calendar_event_id']
          }
        },
        {
          name: 'get_prep_section',
          description: 'Return prep notes for a meeting if available.',
          inputSchema: {
            type: 'object',
            properties: {
              calendar_event_id: {
                type: 'string',
                description: 'Calendar event ID to look up.'
              }
            },
            required: ['calendar_event_id']
          }
        },
        {
          name: 'save_prep_section',
          description: 'Create or update the prep notes section for a meeting.',
          inputSchema: {
            type: 'object',
            properties: {
              calendar_event_id: {
                type: 'string'
              },
              meeting_title: {
                type: 'string'
              },
              meeting_date: {
                type: 'string',
                description: 'ISO 8601 date string. Required when creating a new file.'
              },
              attendees: {
                type: 'array',
                items: { type: 'string' }
              },
              meeting_url: {
                type: 'string'
              },
              prep_content: {
                type: 'string'
              }
            },
            required: ['calendar_event_id', 'prep_content']
          }
        },
        {
          name: 'search_meetings',
          description: 'Fuzzy search meetings by title, attendees, prep, transcript, and insights.',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              attendees: {
                type: 'array',
                items: { type: 'string' }
              },
              date_from: { type: 'string' },
              date_to: { type: 'string' },
              status: {
                type: 'array',
                items: { type: 'string' }
              },
              has_prep: { type: 'boolean' },
              has_transcript: { type: 'boolean' },
              limit: { type: 'number' }
            }
          }
        },
        {
          name: 'list_recent_meetings',
          description: 'Return meetings sorted by date (newest first).',
          inputSchema: {
            type: 'object',
            properties: {
              limit: { type: 'number' },
              status: {
                type: 'array',
                items: { type: 'string' }
              },
              date_from: { type: 'string' }
            }
          }
        },
        {
          name: 'get_meeting_by_id',
          description: 'Load a meeting by UUID or calendar event ID.',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              calendar_event_id: { type: 'string' },
              include_full_content: { type: 'boolean' }
            }
          }
        }
      ]
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request: any): Promise<any> => {
      const { name, arguments: args } = request.params;

      const handler = this.toolHandlers[name as keyof typeof this.toolHandlers];
      if (!handler) {
        return this.errorResponse(`Unknown tool: ${name}`) as any;
      }

      try {
        if (!this.indexBuilt && this.requiresIndex(name)) {
          await this.buildIndex();
        }

        return (await handler.call(this, args ?? {})) as any;
      } catch (error) {
        return this.errorResponse(error instanceof Error ? error.message : String(error)) as any;
      }
    });
  }

  private requiresIndex(toolName: string): boolean {
    return ['search_meetings', 'list_recent_meetings', 'get_meeting_by_id'].includes(toolName);
  }

  private readonly toolHandlers: Record<string, ToolHandler> = {
    async check_prep_exists(this: MeetingNoteRecorderMcpServer, args) {
      const calendarEventId = String(args.calendar_event_id || '');
      if (!calendarEventId.trim()) {
        return this.errorResponse('calendar_event_id is required');
      }

      const meeting = await this.repository.loadByCalendarId(calendarEventId);
      if (!meeting) {
        return this.textResponse({
          exists: false,
          has_prep: false,
          action: 'CREATE',
          message: 'No file found. Provide meeting_title and meeting_date to create a new meeting file.'
        });
      }

      const hasPrep = Boolean(meeting.sections.prepNotes?.trim());
      return this.textResponse({
        exists: true,
        has_prep: hasPrep,
        has_calendar_info: Boolean(meeting.sections.calendarInfo?.trim()),
        file_path: meeting.filePath,
        action: hasPrep ? 'SKIP' : 'ADD_PREP'
      });
    },

    async get_prep_section(this: MeetingNoteRecorderMcpServer, args) {
      const calendarEventId = String(args.calendar_event_id || '');
      if (!calendarEventId.trim()) {
        return this.errorResponse('calendar_event_id is required');
      }

      const meeting = await this.repository.loadByCalendarId(calendarEventId);
      if (!meeting) {
        return this.textResponse({
          exists: false,
          prep_content: null,
          message: `No meeting file found for event ID: ${calendarEventId}`
        });
      }

      const prep = meeting.sections.prepNotes?.trim() || null;
      return this.textResponse({
        exists: true,
        has_prep: Boolean(prep),
        prep_content: prep,
        file_path: meeting.filePath
      });
    },

    async save_prep_section(this: MeetingNoteRecorderMcpServer, args) {
      const payload: PrepSectionSaveOptions = {
        calendarEventId: String(args.calendar_event_id || ''),
        meetingTitle: args.meeting_title ? String(args.meeting_title) : undefined,
        meetingDate: args.meeting_date ? String(args.meeting_date) : undefined,
        attendees: Array.isArray(args.attendees) ? args.attendees.map(String) : [],
        meetingUrl: args.meeting_url ? String(args.meeting_url) : undefined,
        prepContent: String(args.prep_content || '')
      };

      if (!payload.calendarEventId.trim()) {
        return this.errorResponse('calendar_event_id is required');
      }

      try {
        const updated = await this.repository.savePrepSection(payload);
        await this.refreshIndexWithMeeting(updated);

        return this.textResponse({
          success: true,
          file_path: updated.filePath,
          has_prep: Boolean(updated.sections.prepNotes?.trim())
        });
      } catch (error) {
        return this.errorResponse(error instanceof Error ? error.message : String(error));
      }
    },

    async search_meetings(this: MeetingNoteRecorderMcpServer, args) {
      const query = typeof args.query === 'string' ? args.query : '';
      const attendees = Array.isArray(args.attendees) ? args.attendees.map(String) : [];
      const status = Array.isArray(args.status) ? args.status.map(String) : undefined;
      const limit = args.limit ? Number(args.limit) : undefined;

      const dateFrom = parseDateBoundary(args.date_from, { endOfDay: false });
      const dateTo = parseDateBoundary(args.date_to, { endOfDay: true });

      const results = this.searchService.search({
        query,
        filters: {
          attendees,
          status: status as Meeting['status'][] | undefined,
          dateFrom,
          dateTo
        },
        limit
      });

      const filtered = this.applyResultFilters(results, {
        hasPrep: typeof args.has_prep === 'boolean' ? args.has_prep : undefined,
        hasTranscript: typeof args.has_transcript === 'boolean' ? args.has_transcript : undefined
      });

      return this.textResponse({
        results: filtered.map((result) => this.toSearchResultPayload(result)),
        total: filtered.length,
        query,
        filters_applied: {
          attendees,
          date_from: args.date_from || null,
          date_to: args.date_to || null,
          status,
          has_prep: args.has_prep ?? null,
          has_transcript: args.has_transcript ?? null
        }
      });
    },

    async list_recent_meetings(this: MeetingNoteRecorderMcpServer, args) {
      const limit = args.limit ? Number(args.limit) : undefined;
      const status = Array.isArray(args.status) ? args.status.map(String) : undefined;
      const dateFrom = parseDateBoundary(args.date_from, { endOfDay: false });

      const recent = this.searchService.getRecentMeetings(limit ?? 10);
      const filtered = recent.filter((meeting) => {
        if (status && status.length > 0 && !status.includes(meeting.status)) {
          return false;
        }

        if (dateFrom) {
          const meetingDate = new Date(meeting.date);
          if (meetingDate < dateFrom) {
            return false;
          }
        }

        return true;
      });

      return this.textResponse({
        results: filtered.map((meeting) => this.toMeetingSummaryPayload(meeting)),
        total: filtered.length
      });
    },

    async get_meeting_by_id(this: MeetingNoteRecorderMcpServer, args) {
      const id = typeof args.id === 'string' ? args.id : undefined;
      const calendarEventId = typeof args.calendar_event_id === 'string' ? args.calendar_event_id : undefined;
      const includeFullContent = Boolean(args.include_full_content);

      let indexed: IndexedMeeting | undefined;

      if (id) {
        indexed = this.indexedMeetings.get(id);
      } else if (calendarEventId) {
        indexed = [...this.indexedMeetings.values()].find((item) => item.meeting.calendarEventId === calendarEventId);
      }

      if (!indexed) {
        return this.textResponse({
          exists: false,
          message: 'Meeting not found',
          searched_id: id || null,
          searched_calendar_event_id: calendarEventId || null
        });
      }

      const response = {
        exists: true,
        meeting: {
          id: indexed.meeting.id,
          title: indexed.meeting.title,
          date: indexed.meeting.date,
          attendees: indexed.meeting.attendees,
          status: indexed.meeting.status,
          calendar_event_id: indexed.meeting.calendarEventId,
          meeting_url: indexed.meeting.meetingUrl,
          duration: indexed.meeting.duration,
          file_path: indexed.filePath,
          file_name: indexed.fileName,
          has_prep: indexed.hasPrep,
          has_transcript: indexed.hasTranscript,
          prep_notes: includeFullContent ? indexed.sections.prepNotes : indexed.prepSnippet,
          transcript: includeFullContent ? indexed.meeting.transcript : indexed.transcriptSnippet
        }
      };

      return this.textResponse(response);
    }
  };

  private applyResultFilters(results: SearchResult[], options: { hasPrep?: boolean; hasTranscript?: boolean }): SearchResult[] {
    return results.filter((result) => {
      const indexed = this.indexedMeetings.get(result.meeting.id);
      if (!indexed) {
        return false;
      }

      if (typeof options.hasPrep === 'boolean') {
        if (options.hasPrep !== indexed.hasPrep) {
          return false;
        }
      }

      if (typeof options.hasTranscript === 'boolean') {
        if (options.hasTranscript !== indexed.hasTranscript) {
          return false;
        }
      }

      return true;
    });
  }

  private toSearchResultPayload(result: SearchResult) {
    const indexed = this.indexedMeetings.get(result.meeting.id);
    return {
      id: result.meeting.id,
      title: result.meeting.title,
      date: result.meeting.date,
      attendees: result.meeting.attendees,
      status: result.meeting.status,
      file_path: indexed?.filePath || null,
      file_name: indexed?.fileName || null,
      has_prep: indexed?.hasPrep ?? false,
      has_transcript: indexed?.hasTranscript ?? false,
      score: result.score,
      matched_fields: result.matches.map((match) => match.field),
      prep_snippet: indexed?.prepSnippet,
      calendar_event_id: result.meeting.calendarEventId ?? null
    };
  }

  private toMeetingSummaryPayload(meeting: Meeting) {
    const indexed = this.indexedMeetings.get(meeting.id);
    return {
      id: meeting.id,
      title: meeting.title,
      date: meeting.date,
      attendees: meeting.attendees,
      status: meeting.status,
      file_path: indexed?.filePath ?? null,
      file_name: indexed?.fileName ?? null,
      has_prep: indexed?.hasPrep ?? false,
      has_transcript: indexed?.hasTranscript ?? false,
      calendar_event_id: meeting.calendarEventId ?? null,
      meeting_url: meeting.meetingUrl ?? null,
      duration: meeting.duration ?? null
    };
  }

  private async refreshIndexWithMeeting(data: MeetingFileData): Promise<void> {
    const meeting = data.meeting;
    const indexed: IndexedMeeting = {
      meeting,
      filePath: data.filePath,
      fileName: path.basename(data.filePath),
      hasPrep: Boolean(data.sections.prepNotes?.trim()),
      hasTranscript: Boolean(meeting.transcript?.trim()),
      prepSnippet: data.sections.prepNotes ? data.sections.prepNotes.slice(0, 200).trim() : null,
      transcriptSnippet: meeting.transcript ? meeting.transcript.slice(0, 500).trim() : null,
      sections: data.sections
    };

    this.indexedMeetings.set(meeting.id, indexed);

    this.searchService.updateIndex(Array.from(this.indexedMeetings.values()).map((item) => item.meeting));
  }

  private async buildIndex(): Promise<void> {
    const storagePath = this.repository.getStoragePath();
    if (!storagePath || !existsSync(storagePath)) {
      log('[INDEX] Storage path missing', { storagePath });
      throw new Error(`MEETINGS_DIR not found: ${storagePath}. Set MEETINGS_DIR or update Meeting Note Recorder storage path.`);
    }

    log('[INDEX] Building meeting index from disk');
    let meetings: MeetingFileData[] = [];
    try {
      meetings = await this.repository.listMeetings({ monthsBack: 12, monthsForward: 2 });
    } catch (error) {
      log('[INDEX] Failed to list meetings', { error: formatError(error) });
      throw error;
    }
    this.indexedMeetings.clear();

    meetings.forEach((data) => {
      const indexed: IndexedMeeting = {
        meeting: data.meeting,
        filePath: data.filePath,
        fileName: path.basename(data.filePath),
        hasPrep: Boolean(data.sections.prepNotes?.trim()),
        hasTranscript: Boolean(data.meeting.transcript?.trim()),
        prepSnippet: data.sections.prepNotes ? data.sections.prepNotes.slice(0, 200).trim() : null,
        transcriptSnippet: data.meeting.transcript ? data.meeting.transcript.slice(0, 500).trim() : null,
        sections: data.sections
      };

      this.indexedMeetings.set(data.meeting.id, indexed);
    });

    this.searchService.updateIndex(Array.from(this.indexedMeetings.values()).map((item) => item.meeting));
    this.indexBuilt = true;
    log('[INDEX] Completed', { indexedCount: this.indexedMeetings.size });
  }

  private errorResponse(message: string): ToolResponsePayload {
    log('[ERROR] Tool invocation failed', { message });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ success: false, error: message }, null, 2)
        }
      ],
      isError: true
    } as any;
  }

  private textResponse(payload: unknown): ToolResponsePayload {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(payload, null, 2)
        }
      ]
    } as any;
  }

  async run(): Promise<void> {
    await this.buildIndex();
    this.startWatching();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    log('Meeting Note Recorder MCP server running');
  }

  private startWatching(): void {
    const storagePath = this.repository.getStoragePath();
    if (!storagePath || !existsSync(storagePath)) {
      log('[WATCH] Storage path missing, skipping watcher', { storagePath });
      return;
    }

    if (this.watcher) {
      this.watcher.close().catch((error) => log('[WATCH] Failed to close previous watcher', { error: formatError(error) }));
    }

    this.watcher = chokidar.watch(storagePath, {
      persistent: true,
      ignoreInitial: true,
      ignored: (targetPath) => !targetPath.endsWith('.md') || targetPath.includes('-deleted-')
    });

    const rebuild = async (event: string, targetPath: string) => {
      log('[WATCH] Change detected', { event, targetPath });
      try {
        await this.buildIndex();
      } catch (error) {
        log('[WATCH] Failed to rebuild index after change', { error: formatError(error) });
      }
    };

    this.watcher
      .on('add', (path) => void rebuild('add', path))
      .on('change', (path) => void rebuild('change', path))
      .on('unlink', (path) => void rebuild('unlink', path))
      .on('error', (error) => log('[WATCH] Error', { error: formatError(error) }));

    log('[WATCH] Watching for meeting file changes');
  }
}

async function resolveStoragePath(): Promise<string> {
  const envOverride = process.env.MEETING_RECORDER_STORAGE_PATH || process.env.MEETINGS_DIR;
  if (envOverride && envOverride.trim()) {
    log('[CONFIG] Using storage path from environment');
    return envOverride;
  }

  try {
    const store = new (ElectronStore as any)({
      encryptionKey: 'meeting-recorder-secret-key',
      projectName: process.env.MEETING_RECORDER_PROJECT_NAME || 'meeting-note-recorder',
      name: 'config'
    });
    const storedPath = typeof store.get === 'function' ? store.get('storagePath') : undefined;
    if (typeof storedPath === 'string' && storedPath.trim()) {
      log('[CONFIG] Using storage path from electron-store');
      return storedPath;
    }
  } catch (error) {
    log('[CONFIG] Failed to read storagePath from electron-store', { error: formatError(error) });
  }

  const defaultPath = path.join(os.homedir(), 'Documents', 'MeetingRecordings');
  try {
    if (!existsSync(defaultPath)) {
      mkdirSync(defaultPath, { recursive: true });
    }
    log('[CONFIG] Using default storage path', { path: defaultPath });
    return defaultPath;
  } catch (error) {
    log('[CONFIG] Failed to prepare default storage path', {
      error: formatError(error),
      path: defaultPath
    });
  }

  throw new Error(
    'Meeting storage path not configured. Open the Meeting Note Recorder app to set a storage directory, or set MEETING_RECORDER_STORAGE_PATH before launching the MCP server.'
  );
}

async function main(): Promise<void> {
  try {
    const storagePath = await resolveStoragePath();
    const server = new MeetingNoteRecorderMcpServer(storagePath);
    await server.run();
  } catch (error) {
    log('[MCP] Failed to start server', { error: formatError(error) });
    process.exit(1);
  }
}

void main();

function log(message: string, context?: Record<string, unknown>): void {
  if (context) {
    console.error(`[MCP] ${message}`, JSON.stringify(context));
  } else {
    console.error(`[MCP] ${message}`);
  }
}

function formatError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}
