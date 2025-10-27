#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
process.env.ELECTRON_RUN_AS_NODE = process.env.ELECTRON_RUN_AS_NODE || '1';
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const fs_1 = require("fs");
const chokidar_1 = __importDefault(require("chokidar"));
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const electron_store_1 = __importDefault(require("electron-store"));
const SearchService_1 = require("../main/services/SearchService");
const MeetingFileRepository_1 = require("../shared/meetings/MeetingFileRepository");
function parseDateBoundary(value, options = {}) {
    if (!value) {
        return undefined;
    }
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) {
        return undefined;
    }
    if (options.endOfDay) {
        date.setHours(23, 59, 59, 999);
    }
    else {
        date.setHours(0, 0, 0, 0);
    }
    return date;
}
class MeetingNoteRecorderMcpServer {
    constructor(storagePath) {
        this.indexedMeetings = new Map();
        this.indexBuilt = false;
        this.watcher = null;
        this.toolHandlers = {
            async check_prep_exists(args) {
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
            async get_prep_section(args) {
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
            async save_prep_section(args) {
                const payload = {
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
                }
                catch (error) {
                    return this.errorResponse(error instanceof Error ? error.message : String(error));
                }
            },
            async search_meetings(args) {
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
                        status: status,
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
            async list_recent_meetings(args) {
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
            async get_meeting_by_id(args) {
                const id = typeof args.id === 'string' ? args.id : undefined;
                const calendarEventId = typeof args.calendar_event_id === 'string' ? args.calendar_event_id : undefined;
                const includeFullContent = Boolean(args.include_full_content);
                let indexed;
                if (id) {
                    indexed = this.indexedMeetings.get(id);
                }
                else if (calendarEventId) {
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
        log('[INIT] Starting Meeting Note Recorder MCP server');
        log(`[INIT] Using storage path: ${storagePath}`);
        this.server = new index_js_1.Server({
            name: 'meeting-note-recorder-mcp',
            version: '1.0.0'
        }, {
            capabilities: {
                tools: {}
            }
        });
        this.repository = new MeetingFileRepository_1.MeetingFileRepository(storagePath);
        this.searchService = new SearchService_1.SearchService();
        this.registerHandlers();
    }
    registerHandlers() {
        this.server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => ({
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
        this.server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            const handler = this.toolHandlers[name];
            if (!handler) {
                return this.errorResponse(`Unknown tool: ${name}`);
            }
            try {
                if (!this.indexBuilt && this.requiresIndex(name)) {
                    await this.buildIndex();
                }
                return (await handler.call(this, args ?? {}));
            }
            catch (error) {
                return this.errorResponse(error instanceof Error ? error.message : String(error));
            }
        });
    }
    requiresIndex(toolName) {
        return ['search_meetings', 'list_recent_meetings', 'get_meeting_by_id'].includes(toolName);
    }
    applyResultFilters(results, options) {
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
    toSearchResultPayload(result) {
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
    toMeetingSummaryPayload(meeting) {
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
    async refreshIndexWithMeeting(data) {
        const meeting = data.meeting;
        const indexed = {
            meeting,
            filePath: data.filePath,
            fileName: path_1.default.basename(data.filePath),
            hasPrep: Boolean(data.sections.prepNotes?.trim()),
            hasTranscript: Boolean(meeting.transcript?.trim()),
            prepSnippet: data.sections.prepNotes ? data.sections.prepNotes.slice(0, 200).trim() : null,
            transcriptSnippet: meeting.transcript ? meeting.transcript.slice(0, 500).trim() : null,
            sections: data.sections
        };
        this.indexedMeetings.set(meeting.id, indexed);
        this.searchService.updateIndex(Array.from(this.indexedMeetings.values()).map((item) => item.meeting));
    }
    async buildIndex() {
        const storagePath = this.repository.getStoragePath();
        if (!storagePath || !(0, fs_1.existsSync)(storagePath)) {
            log('[INDEX] Storage path missing', { storagePath });
            throw new Error(`MEETINGS_DIR not found: ${storagePath}. Set MEETINGS_DIR or update Meeting Note Recorder storage path.`);
        }
        log('[INDEX] Building meeting index from disk');
        let meetings = [];
        try {
            meetings = await this.repository.listMeetings({ monthsBack: 12, monthsForward: 2 });
        }
        catch (error) {
            log('[INDEX] Failed to list meetings', { error: formatError(error) });
            throw error;
        }
        this.indexedMeetings.clear();
        meetings.forEach((data) => {
            const indexed = {
                meeting: data.meeting,
                filePath: data.filePath,
                fileName: path_1.default.basename(data.filePath),
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
    errorResponse(message) {
        log('[ERROR] Tool invocation failed', { message });
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({ success: false, error: message }, null, 2)
                }
            ],
            isError: true
        };
    }
    textResponse(payload) {
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(payload, null, 2)
                }
            ]
        };
    }
    async run() {
        await this.buildIndex();
        this.startWatching();
        const transport = new stdio_js_1.StdioServerTransport();
        await this.server.connect(transport);
        log('Meeting Note Recorder MCP server running');
    }
    startWatching() {
        const storagePath = this.repository.getStoragePath();
        if (!storagePath || !(0, fs_1.existsSync)(storagePath)) {
            log('[WATCH] Storage path missing, skipping watcher', { storagePath });
            return;
        }
        if (this.watcher) {
            this.watcher.close().catch((error) => log('[WATCH] Failed to close previous watcher', { error: formatError(error) }));
        }
        this.watcher = chokidar_1.default.watch(storagePath, {
            persistent: true,
            ignoreInitial: true,
            ignored: (targetPath) => !targetPath.endsWith('.md') || targetPath.includes('-deleted-')
        });
        const rebuild = async (event, targetPath) => {
            log('[WATCH] Change detected', { event, targetPath });
            try {
                await this.buildIndex();
            }
            catch (error) {
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
async function resolveStoragePath() {
    const envOverride = process.env.MEETING_RECORDER_STORAGE_PATH || process.env.MEETINGS_DIR;
    if (envOverride && envOverride.trim()) {
        log('[CONFIG] Using storage path from environment');
        return envOverride;
    }
    try {
        const store = new electron_store_1.default({
            encryptionKey: 'meeting-recorder-secret-key',
            projectName: process.env.MEETING_RECORDER_PROJECT_NAME || 'meeting-note-recorder',
            name: 'config'
        });
        const storedPath = typeof store.get === 'function' ? store.get('storagePath') : undefined;
        if (typeof storedPath === 'string' && storedPath.trim()) {
            log('[CONFIG] Using storage path from electron-store');
            return storedPath;
        }
    }
    catch (error) {
        log('[CONFIG] Failed to read storagePath from electron-store', { error: formatError(error) });
    }
    const defaultPath = path_1.default.join(os_1.default.homedir(), 'Documents', 'MeetingRecordings');
    try {
        if (!(0, fs_1.existsSync)(defaultPath)) {
            (0, fs_1.mkdirSync)(defaultPath, { recursive: true });
        }
        log('[CONFIG] Using default storage path', { path: defaultPath });
        return defaultPath;
    }
    catch (error) {
        log('[CONFIG] Failed to prepare default storage path', {
            error: formatError(error),
            path: defaultPath
        });
    }
    throw new Error('Meeting storage path not configured. Open the Meeting Note Recorder app to set a storage directory, or set MEETING_RECORDER_STORAGE_PATH before launching the MCP server.');
}
async function main() {
    try {
        const storagePath = await resolveStoragePath();
        const server = new MeetingNoteRecorderMcpServer(storagePath);
        await server.run();
    }
    catch (error) {
        log('[MCP] Failed to start server', { error: formatError(error) });
        process.exit(1);
    }
}
void main();
function log(message, context) {
    if (context) {
        console.error(`[MCP] ${message}`, JSON.stringify(context));
    }
    else {
        console.error(`[MCP] ${message}`);
    }
}
function formatError(error) {
    if (error instanceof Error) {
        return { message: error.message, stack: error.stack };
    }
    return { message: String(error) };
}
