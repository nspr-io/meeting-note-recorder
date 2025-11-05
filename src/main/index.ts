import { app, BrowserWindow, ipcMain, dialog, Notification, shell, Menu } from 'electron';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();
import { MeetingDetectionService } from './services/MeetingDetectionService';
import { RecordingService } from './services/RecordingService';
import { StorageService } from './services/StorageService';
import { CalendarService } from './services/CalendarService';
import { SettingsService } from './services/SettingsService';
import { PermissionService } from './services/PermissionService';
import { getLogger } from './services/LoggingService';
import { SearchService } from '../shared/search/SearchService';
import { PromptService } from './services/PromptService';
import { RealtimeCoachingService } from './services/RealtimeCoachingService';
import { NotionTodoService } from './services/NotionTodoService';
import FirefliesTranscriptService from './services/FirefliesTranscriptService';
import { MeetingChatService } from './services/MeetingChatService';
import { ServiceError } from './services/ServiceError';
import { IpcChannels, Meeting, CalendarEvent, UserProfile, SearchOptions, CoachingType, NotionShareMode, ActionItemSyncStatus, CoachConfig, CoachWindowStatus, PermissionType } from '../shared/types';
import { generateNotificationHTML, NotificationType } from './utils/notificationTemplate';

const logger = getLogger();

// Add process-level error handlers to catch all uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('[PROCESS-ERROR] Uncaught Exception:', {
    error: error.message,
    stack: error.stack,
    name: error.name,
    timestamp: new Date().toISOString()
  });
  console.error('[PROCESS-ERROR] Uncaught Exception:', error);

  // Try to save any pending data before potential crash
  if (storageService) {
    logger.error('[PROCESS-ERROR] Attempting emergency cache save...');
    storageService.forceSave().catch(err => {
      logger.error('[PROCESS-ERROR] Emergency save failed:', err);
    });
  }
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('[PROCESS-ERROR] Unhandled Rejection at:', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
    timestamp: new Date().toISOString()
  });
  console.error('[PROCESS-ERROR] Unhandled Rejection at:', promise, 'reason:', reason);

  // Try to save any pending data
  if (storageService) {
    logger.error('[PROCESS-ERROR] Attempting cache save after unhandled rejection...');
    storageService.forceSave().catch(err => {
      logger.error('[PROCESS-ERROR] Emergency save failed:', err);
    });
  }
});

let mainWindow: BrowserWindow | null = null;
let coachWindow: BrowserWindow | null = null;
let meetingDetectionService: MeetingDetectionService;
let recordingService: RecordingService;
let storageService: StorageService;
let calendarService: CalendarService;
let settingsService: SettingsService;
let permissionService: PermissionService;
let searchService: SearchService;
let promptService: PromptService | null = null;
let coachingService: RealtimeCoachingService | null = null;
let notionTodoService: NotionTodoService;
let firefliesTranscriptService: FirefliesTranscriptService | null = null;
let meetingChatService: MeetingChatService | null = null;
let currentRecordingMeetingId: string | null = null;
let autoRecordNextMeeting = false;
const autoInsightsInFlight = new Set<string>();

let rendererDiagnosticsSetup = false;

function setupRendererDiagnostics() {
  if (rendererDiagnosticsSetup) {
    return;
  }

  rendererDiagnosticsSetup = true;

  ipcMain.on(IpcChannels.RENDERER_LOG, (_event, payload) => {
    logger.info('[RENDERER-LOG]', payload);
  });

  ipcMain.on(IpcChannels.RENDERER_ERROR, (_event, payload) => {
    logger.error('[RENDERER-ERROR]', payload);
  });
}

// UI Notification Helper Functions
function notifyUI(channel: IpcChannels, data?: any) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
  if (coachWindow && !coachWindow.isDestroyed()) {
    coachWindow.webContents.send(channel, data);
  }
}

export function notifyMeetingsUpdated() {
  notifyUI(IpcChannels.MEETINGS_UPDATED);
}

function notifyRecordingStarted(meetingId: string) {
  notifyUI(IpcChannels.RECORDING_STARTED, { meetingId });
  notifyMeetingsUpdated();
}

function buildMeetingTriggerTags(meeting: Meeting): string[] {
  const baseTags = Array.isArray(meeting.tags) ? meeting.tags : [];
  const extras = new Set<string>();

  const title = (meeting.title || '').toLowerCase();
  const notes = typeof meeting.notes === 'string' ? meeting.notes.toLowerCase() : '';
  const transcript = typeof meeting.transcript === 'string' ? meeting.transcript.toLowerCase() : '';

  const combinedText = `${title} ${notes} ${transcript}`;
  if (/interview|candidate|recruit|hiring/.test(combinedText)) {
    extras.add('interview');
  }

  const attendeeEmails = Array.isArray(meeting.attendees)
    ? meeting.attendees
        .map((attendee) => (typeof attendee === 'string' ? attendee : attendee.email || ''))
        .filter((email) => typeof email === 'string' && email.length > 0)
    : [];

  if (attendeeEmails.some((email) => /recruit|talent|hr/.test(email.toLowerCase()))) {
    extras.add('interview');
  }

  return Array.from(new Set<string>([...extras, ...baseTags]));
}

async function dispatchEndRecordingTrigger(meetingId: string): Promise<void> {
  if (!storageService) {
    logger.warn('[AUTOMATION] Skipping end recording trigger dispatch; storage unavailable');
    return;
  }

  try {
    const meeting = await storageService.getMeeting(meetingId);
    if (!meeting) {
      return;
    }

    const payload = {
      meetingId: meeting.id,
      title: meeting.title,
      status: meeting.status,
      duration: meeting.duration ?? null,
      tags: buildMeetingTriggerTags(meeting),
      meetingUrl: meeting.meetingUrl ?? null,
      endedAt: new Date().toISOString()
    };

    logger.info('[AUTOMATION] Dispatching end recording trigger', {
      meetingId: payload.meetingId,
      tags: payload.tags
    });

    notifyUI(IpcChannels.END_RECORDING_TRIGGER, payload);
    app.emit('end-recording-trigger', payload);
  } catch (error) {
    logger.warn('[AUTOMATION] Failed to dispatch end recording trigger', {
      meetingId,
      error: error instanceof Error ? error.message : error
    });
  }
}

function notifySettingsUpdated(settings: any) {
  notifyUI(IpcChannels.SETTINGS_UPDATED, settings);
}

type FirefliesErrorResponse = {
  success: false;
  error: string;
  code?: string;
  retryable?: boolean;
  details?: unknown;
};

function mapFirefliesErrorResponse(error: unknown): FirefliesErrorResponse {
  if (error instanceof ServiceError) {
    const response: FirefliesErrorResponse = {
      success: false,
      error: error.message,
      code: error.code,
      retryable: error.isRetryable,
      details: error.context
    };

    switch (error.code) {
      case 'FIREFLIES_NO_CANDIDATES':
        response.error = 'Fireflies did not return any transcripts for this meeting. Confirm Fireflies joined the call and that the meeting time is correct.';
        break;
      case 'FIREFLIES_LOW_SCORE':
        response.error = 'Fireflies transcripts were found but none matched confidently. Check the attendee list, meeting link, or title.';
        break;
      case 'FIREFLIES_EMPTY_TRANSCRIPT':
        response.error = 'Fireflies returned a transcript with no content. Try fetching again later or verify the recording exists.';
        break;
      case 'FIREFLIES_GRAPHQL_ERROR':
        response.error = 'Fireflies API returned an error. Please review your Fireflies configuration or try again later.';
        break;
      case 'FIREFLIES_NO_KEY':
      case 'AUTH_ERROR':
        response.error = 'Fireflies API key not configured. Please add it in settings.';
        break;
      case 'NETWORK_ERROR':
        response.error = 'Network error while contacting Fireflies. Check your connection and try again.';
        break;
      default:
        if (error.code?.startsWith('API_ERROR_')) {
          const status = error.statusCode ?? error.code.replace('API_ERROR_', '');
          response.error = `Fireflies API request failed (status ${status}). Please verify your API key and retry.`;
        } else if (error.code === 'FIREFLIES_UNKNOWN') {
          response.error = 'An unexpected Fireflies error occurred. See logs for more details.';
        }
        break;
    }

    return response;
  }

  const fallbackMessage = error instanceof Error
    ? error.message
    : 'Failed to fetch Fireflies transcript';

  return {
    success: false,
    error: fallbackMessage
  };
}

function scheduleNotificationCleanup(notificationId: string, delayMs: number = 30000) {
  setTimeout(() => {
    if (activeNotifications.has(notificationId)) {
      logger.info('[NOTIFICATION-CLEANUP] Removing old notification reference', {
        notificationId
      });
      activeNotifications.delete(notificationId);
    }
  }, delayMs);
}

function createApplicationMenu() {
  const isMac = process.platform === 'darwin';

  const requestAppQuit = () => {
    logger.info('[APP] Quit requested via menu');
    app.quit();
  };

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        { role: 'services' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        {
          label: 'Quit Meeting Note Recorder',
          accelerator: 'Command+Q',
          click: requestAppQuit
        }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        isMac
          ? { role: 'close' as const }
          : {
              label: 'Quit Meeting Note Recorder',
              accelerator: 'Ctrl+Q',
              click: requestAppQuit
            }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        ...(isMac ? [
          { role: 'pasteAndMatchStyle' as const },
          { role: 'delete' as const },
          { role: 'selectAll' as const }
        ] : [
          { role: 'delete' as const },
          { type: 'separator' as const },
          { role: 'selectAll' as const }
        ])
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac ? [
          { type: 'separator' as const },
          { role: 'front' as const },
          { type: 'separator' as const },
          { role: 'window' as const }
        ] : [
          { role: 'close' as const }
        ])
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  logger.info('[MAIN-WINDOW] Creating main BrowserWindow', {
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
  });

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.on('focus', () => {
    notifyUI(IpcChannels.COACH_WINDOW_STATUS, { isOpen: !!coachWindow });
  });

  if (process.env.NODE_ENV === 'development') {
    const devUrl = 'http://localhost:9000';
    logger.info('[MAIN-WINDOW] Loading development URL', { url: devUrl });
    mainWindow.loadURL(devUrl).catch((error) => {
      logger.error('[MAIN-WINDOW] Failed to load development URL', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  } else {
    const indexPath = path.join(__dirname, '../renderer/index.html');
    logger.info('[MAIN-WINDOW] Loading production index file', { indexPath });
    mainWindow.loadFile(indexPath).catch((error) => {
      logger.error('[MAIN-WINDOW] Failed to load production index file', {
        indexPath,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  const contents = mainWindow.webContents;

  contents.on('did-start-loading', () => {
    logger.info('[MAIN-WINDOW] did-start-loading');
  });

  contents.on('did-finish-load', () => {
    logger.info('[MAIN-WINDOW] did-finish-load', {
      url: contents.getURL(),
    });
  });

  contents.on('dom-ready', () => {
    logger.info('[MAIN-WINDOW] dom-ready');
  });

  contents.on('did-frame-finish-load', (_event, isMainFrame) => {
    logger.info('[MAIN-WINDOW] did-frame-finish-load', {
      isMainFrame,
    });
  });

  contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    logger.error('[MAIN-WINDOW] did-fail-load', {
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame,
    });
  });

  contents.on('did-start-navigation', (_event, url, isInPlace, isMainFrame, frameProcessId, frameRoutingId) => {
    logger.info('[MAIN-WINDOW] did-start-navigation', {
      url,
      isInPlace,
      isMainFrame,
      frameProcessId,
      frameRoutingId,
    });
  });

  contents.on('render-process-gone', (_event, details) => {
    logger.error('[MAIN-WINDOW] render-process-gone', details);
  });

  contents.on('preload-error', (_event, preloadPath, error) => {
    logger.error('[MAIN-WINDOW] preload-error', {
      preloadPath,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  contents.on('console-message', (_event, level, message, line, sourceId) => {
    logger.info('[RENDERER-CONSOLE]', {
      level,
      message,
      line,
      sourceId,
    });
  });

  mainWindow.once('ready-to-show', () => {
    logger.info('[MAIN-WINDOW] ready-to-show', {
      windowId: mainWindow?.id,
    });
  });

  mainWindow.on('unresponsive', () => {
    logger.warn('[MAIN-WINDOW] Main window became unresponsive');
  });

  mainWindow.on('responsive', () => {
    logger.info('[MAIN-WINDOW] Main window responsive again');
  });

  mainWindow.on('close', () => {
    logger.error('[MAIN-WINDOW] Main window "close" event fired!', {
      timestamp: new Date().toISOString(),
      stack: new Error().stack
    });
  });

  mainWindow.on('closed', () => {
    logger.error('[MAIN-WINDOW] Main window "closed" event fired!', {
      timestamp: new Date().toISOString()
    });
    mainWindow = null;
  });

  mainWindow.on('hide', () => {
    logger.warn('[MAIN-WINDOW] Main window "hide" event fired!', {
      timestamp: new Date().toISOString(),
      stack: new Error().stack
    });
  });

  mainWindow.on('minimize', () => {
    logger.info('[MAIN-WINDOW] Main window "minimize" event fired!', {
      timestamp: new Date().toISOString()
    });
  });
}

function setupIpcHandlers() {
  ipcMain.handle(IpcChannels.OPEN_COACH_WINDOW, async (_, meetingId: string | null) => {
    try {
      if (coachWindow && !coachWindow.isDestroyed()) {
        coachWindow.focus();
        coachWindow.webContents.send(IpcChannels.COACH_WINDOW_STATUS, { isOpen: true, meetingId });
        return { success: true };
      }

      coachWindow = new BrowserWindow({
        width: 480,
        height: 700,
        minWidth: 360,
        minHeight: 500,
        title: 'Live Coaching',
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dirname, 'preload.js'),
        },
      });

      coachWindow.on('closed', () => {
        coachWindow = null;
        notifyUI(IpcChannels.COACH_WINDOW_STATUS, { isOpen: false });
      });

      if (process.env.NODE_ENV === 'development') {
        const url = new URL('http://localhost:9000');
        url.searchParams.set('mode', 'coach-popout');
        if (meetingId) url.searchParams.set('meetingId', meetingId);
        coachWindow.loadURL(url.toString());
      } else {
        const indexPath = path.join(__dirname, '../renderer/index.html');
        coachWindow.loadFile(indexPath, { query: { mode: 'coach-popout', meetingId: meetingId || '' } });
      }

      coachWindow.once('ready-to-show', () => {
        coachWindow?.show();
        notifyUI(IpcChannels.COACH_WINDOW_STATUS, { isOpen: true, meetingId });
      });

      return { success: true };
    } catch (error) {
      logger.error('[COACH-WINDOW] Failed to open coach window', {
        error: error instanceof Error ? error.message : String(error),
      });
      coachWindow = null;
      notifyUI(IpcChannels.COACH_WINDOW_STATUS, { isOpen: false });
      return { success: false, error: error instanceof Error ? error.message : 'Failed to open coach window' };
    }
  });

  ipcMain.handle(IpcChannels.CLOSE_COACH_WINDOW, async () => {
    if (coachWindow && !coachWindow.isDestroyed()) {
      coachWindow.close();
      coachWindow = null;
    }
    notifyUI(IpcChannels.COACH_WINDOW_STATUS, { isOpen: false });
    return { success: true };
  });

  ipcMain.handle(IpcChannels.GET_COACH_WINDOW_STATUS, async (): Promise<CoachWindowStatus> => {
    return { isOpen: !!coachWindow };
  });
  // Settings
  ipcMain.handle(IpcChannels.GET_SETTINGS, async () => {
    return settingsService.getSettings();
  });

  ipcMain.handle(IpcChannels.UPDATE_SETTINGS, async (_, settings) => {
    const updated = await settingsService.updateSettings(settings);
    if (firefliesTranscriptService) {
      firefliesTranscriptService.setApiKey(updated.firefliesApiKey);
    } else {
      firefliesTranscriptService = new FirefliesTranscriptService(updated.firefliesApiKey);
    }
    if (coachingService) {
      coachingService.initialize(updated.anthropicApiKey);
    }
    if (meetingChatService) {
      meetingChatService.initialize(updated.anthropicApiKey);
    }
    notifySettingsUpdated(updated);
    return { success: true };
  });

  // Profile
  ipcMain.handle(IpcChannels.GET_PROFILE, async () => {
    return settingsService.getProfile();
  });

  ipcMain.handle(IpcChannels.UPDATE_PROFILE, async (_, profile: UserProfile) => {
    settingsService.setProfile(profile);
    return { success: true };
  });

  // System Prompts
  ipcMain.handle(IpcChannels.GET_PROMPTS, async () => {
    if (!promptService) {
      logger.error('PromptService not available - returning empty prompts');
      return {};
    }
    return promptService.getAllPrompts(settingsService.getCoaches());
  });

  ipcMain.handle(IpcChannels.GET_PROMPT, async (_, promptId) => {
    if (!promptService) {
      logger.error('PromptService not available - cannot get prompt:', promptId);
      throw new Error('PromptService not available');
    }
    return promptService.getPrompt(promptId);
  });

  ipcMain.handle(IpcChannels.UPDATE_PROMPT, async (_, { promptId, content }) => {
    if (!promptService) {
      logger.error('PromptService not available - cannot update prompt:', promptId);
      throw new Error('PromptService not available');
    }
    await promptService.updatePrompt(promptId, content);
    return { success: true };
  });

  ipcMain.handle(IpcChannels.RESET_PROMPT, async (_, promptId) => {
    if (!promptService) {
      logger.error('PromptService not available - cannot reset prompt:', promptId);
      throw new Error('PromptService not available');
    }
    await promptService.resetPrompt(promptId);
    return { success: true };
  });

  ipcMain.handle(IpcChannels.GET_COACHES, async () => {
    return settingsService.getCoaches();
  });

  ipcMain.handle(IpcChannels.UPSERT_COACH, async (_, coach: CoachConfig & { promptContent?: string }) => {
    const prev = settingsService.getCoaches().filter(c => c.id !== coach.id);
    const updatedCoach: CoachConfig = {
      id: coach.id,
      name: coach.name,
      description: coach.description,
      enabled: coach.enabled,
      isCustom: coach.isCustom ?? true,
      variables: coach.variables,
    };
    const updated = settingsService.setCoaches([...prev, updatedCoach]);

    if (promptService && coach.promptContent !== undefined) {
      await promptService.updatePrompt(coach.id, coach.promptContent);
    }

    notifySettingsUpdated(settingsService.getSettings());
    return updated;
  });

  ipcMain.handle(IpcChannels.TOGGLE_COACH, async (_, coachId: string, enabled: boolean) => {
    const updated = settingsService.setCoaches(
      settingsService.getCoaches().map(coach =>
        coach.id === coachId ? { ...coach, enabled } : coach
      )
    );
    notifySettingsUpdated(settingsService.getSettings());
    return updated;
  });

  ipcMain.handle(IpcChannels.DELETE_COACH, async (_, coachId: string) => {
    const coach = settingsService.getCoaches().find(c => c.id === coachId);
    if (!coach) {
      throw new Error('Coach not found');
    }
    if (!coach.isCustom) {
      throw new Error('Cannot delete default coach');
    }

    settingsService.setCoaches(settingsService.getCoaches().filter(c => c.id !== coachId));

    if (promptService) {
      try {
        await promptService.deletePrompt(coachId);
      } catch (error) {
        logger.error('Failed to delete coach prompt:', error);
      }
    }

    notifySettingsUpdated(settingsService.getSettings());
    return { success: true };
  });

  // Meetings
  ipcMain.handle(IpcChannels.GET_MEETINGS, async () => {
    // Only load meetings from last 30 days for initial load
    const meetings = await storageService.getAllMeetings();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentMeetings = meetings.filter(m => {
      const meetingDate = new Date(m.date);
      return meetingDate >= thirtyDaysAgo || m.status === 'recording' || m.status === 'active';
    });

    logger.info('[IPC-GET_MEETINGS] Sending meetings to renderer', {
      total: meetings.length,
      returned: recentMeetings.length,
      sampleTitles: recentMeetings.slice(0, 5).map(m => ({ id: m.id, title: m.title }))
    });
    return recentMeetings;
  });

  ipcMain.handle(IpcChannels.GET_CHAT_HISTORY, async (_event, meetingId: string) => {
    if (!meetingChatService) {
      return { success: false, error: 'Meeting chat service not initialized' };
    }

    try {
      const history = await meetingChatService.getHistory(meetingId);
      return { success: true, history };
    } catch (error: any) {
      logger.error('[CHAT] Failed to load chat history', {
        meetingId,
        error: error instanceof Error ? error.message : error
      });
      return { success: false, error: error?.message || 'Failed to load chat history' };
    }
  });

  ipcMain.handle(IpcChannels.SEND_CHAT_MESSAGE, async (_event, payload: { meetingId: string; message: string }) => {
    if (!meetingChatService) {
      return { success: false, error: 'Meeting chat service not initialized' };
    }

    if (!meetingChatService.isAvailable()) {
      return { success: false, error: 'Meeting chat service not available. Please check your Anthropic API key in settings.' };
    }

    try {
      const { userMessage, assistantMessage, history } = await meetingChatService.sendMessage(payload.meetingId, payload.message);
      return { success: true, userMessage, assistantMessage, history };
    } catch (error: any) {
      logger.error('[CHAT] Failed to send chat message', {
        meetingId: payload?.meetingId,
        error: error instanceof Error ? error.message : error
      });
      return { success: false, error: error?.message || 'Failed to send chat message' };
    }
  });

  ipcMain.handle(IpcChannels.CLEAR_CHAT_HISTORY, async (_event, meetingId: string) => {
    if (!meetingChatService) {
      return { success: false, error: 'Meeting chat service not initialized' };
    }

    try {
      await meetingChatService.clearHistory(meetingId);
      return { success: true };
    } catch (error: any) {
      logger.error('[CHAT] Failed to clear chat history', {
        meetingId,
        error: error instanceof Error ? error.message : error
      });
      return { success: false, error: error?.message || 'Failed to clear chat history' };
    }
  });

  ipcMain.handle(IpcChannels.REFRESH_MEETING, async (_, meetingId) => {
    logger.info('[IPC-REFRESH_MEETING] Refreshing meeting from disk', { meetingId });
    return await storageService.refreshMeetingFromDisk(meetingId);
  });

  ipcMain.handle(IpcChannels.GET_RECORDING_STATE, async () => {
    const state = recordingService.getRecordingState();
    let meeting = null;
    if (state.meetingId) {
      meeting = await storageService.getMeeting(state.meetingId);
    }
    return { ...state, meeting };
  });

  ipcMain.handle(IpcChannels.CREATE_MEETING, async (_, meeting: Partial<Meeting>) => {
    const newMeeting = await storageService.createMeeting(meeting);
    // Update search index
    const allMeetings = await storageService.getAllMeetings();
    searchService.updateIndex(allMeetings);
    notifyMeetingsUpdated();
    return newMeeting;
  });

  ipcMain.handle(IpcChannels.UPDATE_MEETING, async (_, id: string, updates: Partial<Meeting>) => {
    const updatedMeeting = await storageService.updateMeeting(id, updates);
    // Update search index
    const allMeetings = await storageService.getAllMeetings();
    searchService.updateIndex(allMeetings);
    if (mainWindow) {
      mainWindow.webContents.send(IpcChannels.MEETINGS_UPDATED);
    }
    return updatedMeeting;
  });

  ipcMain.handle(IpcChannels.CORRECT_TRANSCRIPT, async (_, meetingId: string) => {
    try {
      // Check if recording service is available
      if (!recordingService) {
        return { success: false, error: 'Recording service not initialized' };
      }

      // Get the meeting
      const meeting = await storageService.getMeeting(meetingId);
      if (!meeting || !meeting.transcript) {
        return { success: false, error: 'Meeting or transcript not found' };
      }

      // Check if correction service is available
      const correctionService = recordingService.getCorrectionService();
      if (!correctionService || !correctionService.isAvailable()) {
        return { success: false, error: 'Transcript correction service not available. Please check your Anthropic API key in settings.' };
      }

      // Forward progress events to renderer
      const progressHandler = (data: any) => {
        if (mainWindow) {
          mainWindow.webContents.send('correction-progress', data);
        }
      };

      const completedHandler = (data: any) => {
        if (mainWindow) {
          mainWindow.webContents.send('correction-completed', data);
        }
      };

      correctionService.on('correction-progress', progressHandler);
      correctionService.on('correction-completed', completedHandler);

      try {
        // Correct the transcript
        const correctedTranscript = await correctionService.correctTranscript(meeting);

        // Log if transcript actually changed
        const originalSample = meeting.transcript.substring(0, 200);
        const correctedSample = correctedTranscript.substring(0, 200);
        logger.info(`[CORRECTION CHECK] Original sample: "${originalSample}"`);
        logger.info(`[CORRECTION CHECK] Corrected sample: "${correctedSample}"`);
        logger.info(`[CORRECTION CHECK] Are they the same? ${originalSample === correctedSample}`);

        // Update the meeting with corrected transcript
        await storageService.updateMeeting(meetingId, { transcript: correctedTranscript });

        // Clean up listeners
        correctionService.removeListener('correction-progress', progressHandler);
        correctionService.removeListener('correction-completed', completedHandler);

        return { success: true, transcript: correctedTranscript };
      } catch (error) {
        // Clean up listeners on error
        correctionService.removeListener('correction-progress', progressHandler);
        correctionService.removeListener('correction-completed', completedHandler);
        throw error;
      }
    } catch (error: any) {
      logger.error('Failed to correct transcript:', error);
      return { success: false, error: error.message || 'Failed to correct transcript' };
    }
  });

  ipcMain.handle(IpcChannels.FETCH_FIREFLIES_TRANSCRIPT, async (_, meetingId: string) => {
    if (!firefliesTranscriptService || !firefliesTranscriptService.isConfigured()) {
      return {
        success: false,
        error: 'Fireflies integration not configured. Please add your API key in settings.',
        code: 'FIREFLIES_NO_KEY',
        retryable: false
      };
    }

    try {
      const meeting = await storageService.getMeeting(meetingId);
      if (!meeting) {
        return { success: false, error: 'Meeting not found' };
      }

      const result = await firefliesTranscriptService.fetchTranscriptForMeeting(meeting);

      const updatedMeeting = await storageService.updateMeeting(meetingId, {
        transcript: result.transcript,
        firefliesTranscriptId: result.transcriptId,
        firefliesTranscriptFetchedAt: new Date(),
        status: meeting.status === 'completed' ? meeting.status : 'completed'
      });

      const allMeetings = await storageService.getAllMeetings();
      searchService.updateIndex(allMeetings);
      notifyMeetingsUpdated();

      return { success: true, transcript: result.transcript, meeting: updatedMeeting };
    } catch (error) {
      const response = mapFirefliesErrorResponse(error);
      const logMethod = error instanceof ServiceError ? 'warn' : 'error';
      logger[logMethod]('[FIREFLIES] Failed to fetch transcript', {
        meetingId,
        error: error instanceof Error ? error.message : error,
        code: response.code,
        retryable: response.retryable,
        details: response.details
      });
      return response;
    }
  });

  ipcMain.handle(IpcChannels.DELETE_MEETING, async (_, id: string) => {
    await storageService.deleteMeeting(id);
    // Update search index
    const allMeetings = await storageService.getAllMeetings();
    searchService.updateIndex(allMeetings);
    if (mainWindow) {
      mainWindow.webContents.send(IpcChannels.MEETINGS_UPDATED);
    }
    return { success: true };
  });

  ipcMain.handle(IpcChannels.GENERATE_INSIGHTS, async (_, meetingId: string) => {
    try {
      logger.info('[Insights][IPC] Generate insights request received', { meetingId });
      // Check if recording service is available
      if (!recordingService) {
        return { success: false, error: 'Recording service not initialized' };
      }

      // Get the meeting
      const meeting = await storageService.getMeeting(meetingId);
      if (!meeting) {
        logger.warn('[Insights][IPC] Meeting not found', { meetingId });
        return { success: false, error: 'Meeting not found' };
      }

      // Check if insights service is available
      const insightsService = recordingService.getInsightsService();
      if (!insightsService || !insightsService.isAvailable()) {
        logger.warn('[Insights][IPC] Insights service unavailable');
        return { success: false, error: 'Insights generation service not available. Please check your Anthropic API key in settings.' };
      }

      try {
        // Get user profile to personalize insights
        const userProfile = settingsService.getProfile();
        logger.info('[Insights][IPC] Invoking insights service', {
          meetingId,
          hasProfile: !!userProfile,
          hasTranscript: !!meeting.transcript,
          notesLength: meeting.notes?.length || 0
        });

        // Generate insights with profile context
        const insights = await insightsService.generateInsights(meeting, userProfile);

        // Update the meeting with insights
        await storageService.updateMeeting(meetingId, { insights });

        logger.info('[Insights][IPC] Insights generated successfully', {
          meetingId,
          insightsLength: insights?.length || 0
        });

        return { success: true, insights };
      } catch (error) {
        logger.error('[Insights][IPC] Insights service threw error', {
          meetingId,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    } catch (error: any) {
      logger.error('[Insights][IPC] Failed to generate insights', {
        meetingId,
        error: error?.message || error
      });
      return { success: false, error: error.message || 'Failed to generate insights' };
    }
  });

  ipcMain.handle(IpcChannels.GENERATE_TEAM_SUMMARY, async (_, meetingId: string) => {
    try {
      // Check if recording service is available
      if (!recordingService) {
        return { success: false, error: 'Recording service not initialized' };
      }

      // Get the meeting
      const meeting = await storageService.getMeeting(meetingId);
      if (!meeting) {
        return { success: false, error: 'Meeting not found' };
      }

      // Check if insights service is available
      const insightsService = recordingService.getInsightsService();
      if (!insightsService || !insightsService.isAvailable()) {
        return { success: false, error: 'Team summary generation service not available. Please check your Anthropic API key in settings.' };
      }

      try {
        // Generate team summary
        const teamSummary = await insightsService.generateTeamSummary(meeting);

        // Update the meeting with team summary
        await storageService.updateMeeting(meetingId, { teamSummary });

        return { success: true, teamSummary };
      } catch (error) {
        throw error;
      }
    } catch (error: any) {
      logger.error('Failed to generate team summary:', error);
      return { success: false, error: error.message || 'Failed to generate team summary' };
    }
  });

  ipcMain.handle(IpcChannels.SHARE_TO_SLACK, async (_, { meetingId, content }) => {
    try {
      const settings = settingsService.getSettings();
      if (!settings.slackWebhookUrl) {
        return { success: false, error: 'No Slack webhook configured. Please add a webhook URL in settings.' };
      }

      // Check if insights service is available
      const insightsService = recordingService.getInsightsService();
      if (!insightsService) {
        return { success: false, error: 'Service not available' };
      }

      // Share to Slack
      await insightsService.shareToSlack(settings.slackWebhookUrl, content);

      // Update meeting with timestamp
      await storageService.updateMeeting(meetingId, {
        slackSharedAt: new Date()
      });

      // Notify UI of update
      if (mainWindow) {
        mainWindow.webContents.send(IpcChannels.MEETINGS_UPDATED);
      }

      return { success: true };
    } catch (error: any) {
      logger.error('Failed to share to Slack:', error);
      return { success: false, error: error.message || 'Failed to share to Slack' };
    }
  });

  ipcMain.handle(IpcChannels.SHARE_TO_NOTION, async (_, { meetingId, mode }: { meetingId: string; mode: NotionShareMode }) => {
    try {
      logger.info('Share to Notion request received', {
        meetingId,
        mode
      });

      const settings = settingsService.getSettings();
      if (!settings.notionIntegrationToken || !settings.notionDatabaseId) {
        return { success: false, error: 'Notion integration is not configured. Please add your integration token and database ID in settings.' };
      }

      const meeting = await storageService.getMeeting(meetingId);
      if (!meeting) {
        return { success: false, error: 'Meeting not found' };
      }

      const insightsService = recordingService.getInsightsService();
      if (!insightsService) {
        return { success: false, error: 'Insights service not available' };
      }

      try {
        const result = await insightsService.shareToNotion({
          meeting,
          mode,
          notionToken: settings.notionIntegrationToken,
          notionDatabaseId: settings.notionDatabaseId
        });

        await storageService.updateMeeting(meetingId, {
          notionSharedAt: new Date(),
          notionPageId: result.pageId || meeting.notionPageId || null
        });

        if (mainWindow) {
          mainWindow.webContents.send(IpcChannels.MEETINGS_UPDATED);
        }

        return { success: true, pageId: result.pageId };
      } catch (error: any) {
        logger.error('Failed to share to Notion', {
          meetingId,
          mode,
          error: error?.message || error,
          stack: error?.stack
        });
        return { success: false, error: error.message || 'Failed to share to Notion' };
      }
    } catch (error: any) {
      logger.error('Unexpected error sharing to Notion', {
        meetingId,
        mode,
        error: error?.message || error,
        stack: error?.stack
      });
      return { success: false, error: error.message || 'Failed to share to Notion' };
    }
  });

  const sendNotionActionItems = async (
    meetingId: string,
    target?: { insightIndex?: number; task?: string; owner?: string; due?: string }
  ) => {
    const settings = settingsService.getSettings();
    if (!settings.notionTodoDatabaseId) {
      throw new Error('Notion to-do integration is not configured. Add the to-do database ID in settings.');
    }

    const notionTokenForTodos = settings.notionTodoIntegrationToken || settings.notionIntegrationToken;
    if (!notionTokenForTodos) {
      throw new Error('Notion to-do integration is not configured. Provide either a dedicated to-do integration token or reuse the primary Notion token in settings.');
    }

    if (!notionTodoService) {
      throw new Error('Notion to-do service is not available');
    }

    const meeting = await storageService.getMeeting(meetingId);
    if (!meeting) {
      throw new Error('Meeting not found');
    }

    if (!meeting.insights) {
      throw new Error('Generate insights before sending action items to Notion.');
    }

    let insights: any;
    try {
      insights = JSON.parse(meeting.insights);
    } catch (error) {
      logger.error('Failed to parse meeting insights for Notion action items', {
        meetingId,
        error: error instanceof Error ? error.message : error
      });
      throw new Error('Stored insights are malformed. Regenerate insights and try again.');
    }

    const actionItems = Array.isArray(insights?.actionItems) ? insights.actionItems : [];
    if (actionItems.length === 0) {
      throw new Error('No action items available in insights to send to Notion.');
    }

    const syncStatus = Array.isArray(meeting.actionItemSyncStatus) ? meeting.actionItemSyncStatus : [];

    const normalizeString = (value: unknown): string => {
      if (typeof value !== 'string') {
        return '';
      }

      const trimmed = value.trim();
      if (!trimmed) {
        return '';
      }

      const lower = trimmed.toLowerCase();
      if (lower === 'null' || lower === 'undefined') {
        return '';
      }

      return trimmed;
    };

    const normalizeIndex = (value: unknown): number | null => {
      if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
        return value;
      }

      if (typeof value === 'string') {
        const parsed = Number.parseInt(value.trim(), 10);
        if (!Number.isNaN(parsed) && parsed >= 0) {
          return parsed;
        }
      }

      return null;
    };

    const getItemDetails = (
      source: any,
      fallback?: { task?: string; owner?: string; due?: string }
    ): { task: string; owner?: string; due?: string } => {
      const sourceTask = typeof source === 'string'
        ? source
        : typeof source?.task === 'string'
          ? source.task
          : '';
      const sourceOwner = typeof source?.owner === 'string' ? source.owner : '';
      const sourceDue = typeof source?.due === 'string' ? source.due : '';

      const fallbackTask = typeof fallback?.task === 'string' ? fallback.task : '';
      const fallbackOwner = typeof fallback?.owner === 'string' ? fallback.owner : '';
      const fallbackDue = typeof fallback?.due === 'string' ? fallback.due : '';

      const task = normalizeString(sourceTask) || normalizeString(fallbackTask) || 'Action Item';
      const owner = normalizeString(sourceOwner) || normalizeString(fallbackOwner);
      const due = normalizeString(sourceDue) || normalizeString(fallbackDue);

      return {
        task,
        owner: owner || undefined,
        due: due || undefined
      };
    };

    const findMatchingIndex = (details: { task: string; owner?: string; due?: string }): number => {
      return actionItems.findIndex((candidate: any) => {
        const normalized = getItemDetails(candidate);
        return normalized.task === details.task &&
          (normalized.owner || '') === (details.owner || '') &&
          (normalized.due || '') === (details.due || '');
      });
    };

    const buildPreparedItem = (
      details: { task: string; owner?: string; due?: string },
      matchIndex?: number
    ) => {
      const ownerKey = details.owner || '';
      const dueKey = details.due || '';
      const existing = syncStatus.find(status => {
        if (typeof matchIndex === 'number' && typeof status.insightIndex === 'number' && status.insightIndex === matchIndex) {
          return true;
        }

        return normalizeString(status.task) === details.task &&
          normalizeString(status.owner) === ownerKey &&
          normalizeString(status.due) === dueKey;
      });

      return {
        payload: {
          task: details.task,
          owner: details.owner,
          due: details.due,
          alreadySent: existing?.status === 'sent',
          insightIndex: typeof matchIndex === 'number' ? matchIndex : undefined
        },
        detail: details,
        matchIndex: typeof matchIndex === 'number' ? matchIndex : undefined
      };
    };

    const preparedItems: Array<{
      payload: {
        task: string;
        owner?: string;
        due?: string;
        alreadySent?: boolean;
        insightIndex?: number;
      };
      detail: {
        task: string;
        owner?: string;
        due?: string;
      };
      matchIndex?: number;
    }> = [];

    if (target) {
      const targetDetails = getItemDetails(target);
      let matchIndex: number | undefined;

      const normalizedIndex = normalizeIndex(target.insightIndex);
      if (normalizedIndex !== null && actionItems[normalizedIndex]) {
        matchIndex = normalizedIndex;
      } else {
        const found = findMatchingIndex(targetDetails);
        if (found >= 0) {
          matchIndex = found;
        }
      }

      const details = typeof matchIndex === 'number' && actionItems[matchIndex]
        ? getItemDetails(actionItems[matchIndex], targetDetails)
        : targetDetails;

      preparedItems.push(buildPreparedItem(details, matchIndex));
    } else {
      actionItems.forEach((item: any, index: number) => {
        const details = getItemDetails(item);
        preparedItems.push(buildPreparedItem(details, index));
      });
    }

    if (preparedItems.length === 0) {
      throw new Error('No action items available in insights to send to Notion.');
    }

    const results = await notionTodoService.createActionItems({
      notionToken: notionTokenForTodos,
      databaseId: settings.notionTodoDatabaseId,
      items: preparedItems.map(item => item.payload)
    });

    if (results.length !== preparedItems.length) {
      logger.warn('Mismatch between requested and returned Notion action items', {
        requested: preparedItems.length,
        received: results.length
      });
    }

    const updatedStatus: ActionItemSyncStatus[] = Array.isArray(syncStatus) ? [...syncStatus] : [];

    const upsertStatus = (status: ActionItemSyncStatus, matchIndex?: number) => {
      const existingIndex = updatedStatus.findIndex(entry => {
        if (typeof matchIndex === 'number') {
          if (typeof entry.insightIndex === 'number') {
            return entry.insightIndex === matchIndex;
          }
        }
        return entry.task === status.task &&
          (entry.owner || '') === (status.owner || '') &&
          (entry.due || '') === (status.due || '');
      });

      if (existingIndex >= 0) {
        updatedStatus[existingIndex] = { ...updatedStatus[existingIndex], ...status };
      } else {
        updatedStatus.push(status);
      }
    };

    preparedItems.forEach((prepared, idx) => {
      const result = results[idx] || {
        task: prepared.detail.task,
        success: false,
        error: 'Unknown result from Notion'
      };

      const matchedIndex = typeof result.insightIndex === 'number'
        ? result.insightIndex
        : (typeof prepared.matchIndex === 'number' ? prepared.matchIndex : findMatchingIndex(prepared.detail));

      const normalizedIndex = typeof matchedIndex === 'number' && matchedIndex >= 0
        ? matchedIndex
        : undefined;

      const originalDetails = normalizedIndex !== undefined && actionItems[normalizedIndex]
        ? getItemDetails(actionItems[normalizedIndex], prepared.detail)
        : prepared.detail;

      const ownerKey = originalDetails.owner || '';
      const dueKey = originalDetails.due || '';

      const previous = updatedStatus.find(status =>
        (normalizedIndex !== undefined && typeof status.insightIndex === 'number' && status.insightIndex === normalizedIndex) ||
        (normalizeString(status.task) === originalDetails.task &&
          normalizeString(status.owner) === ownerKey &&
          normalizeString(status.due) === dueKey)
      );

      if (result.skipped && previous && previous.status === 'sent') {
        if (previous.insightIndex === undefined && normalizedIndex !== undefined) {
          upsertStatus({ ...previous, insightIndex: normalizedIndex }, normalizedIndex);
        }
        return;
      }

      if (result.success) {
        const sentAt = !result.skipped ? new Date().toISOString() : previous?.sentAt;
        upsertStatus({
          task: originalDetails.task,
          owner: originalDetails.owner,
          due: originalDetails.due,
          status: 'sent',
          notionPageId: result.notionPageId || previous?.notionPageId,
          notionPageUrl: result.notionPageUrl || previous?.notionPageUrl,
          sentAt: sentAt || previous?.sentAt,
          insightIndex: normalizedIndex !== undefined ? normalizedIndex : previous?.insightIndex
        }, normalizedIndex);
      } else {
        upsertStatus({
          task: originalDetails.task,
          owner: originalDetails.owner,
          due: originalDetails.due,
          status: 'failed',
          error: result.error || 'Unknown error',
          insightIndex: normalizedIndex !== undefined ? normalizedIndex : previous?.insightIndex
        }, normalizedIndex);
      }
    });

    const sortedStatus = [...updatedStatus].sort((a, b) => {
      const aIndex = typeof a.insightIndex === 'number' ? a.insightIndex : Number.MAX_SAFE_INTEGER;
      const bIndex = typeof b.insightIndex === 'number' ? b.insightIndex : Number.MAX_SAFE_INTEGER;
      if (aIndex !== bIndex) {
        return aIndex - bIndex;
      }
      return (a.task || '').localeCompare(b.task || '');
    });

    await storageService.updateMeeting(meetingId, {
      actionItemSyncStatus: sortedStatus
    });

    return sortedStatus;
  };

  ipcMain.handle(IpcChannels.SEND_NOTION_ACTION_ITEMS, async (_event, meetingId: string) => {
    try {
      const results = await sendNotionActionItems(meetingId);
      return {
        success: true,
        results
      };
    } catch (error) {
      logger.error('Failed to send action items to Notion', {
        error: error instanceof Error ? error.message : error
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send action items to Notion'
      };
    }
  });

  ipcMain.handle(IpcChannels.SEND_SINGLE_NOTION_ACTION_ITEM, async (_event, payload: { meetingId: string; item: { insightIndex?: number; task?: string; owner?: string; due?: string } }) => {
    try {
      if (!payload?.meetingId || !payload?.item) {
        throw new Error('Invalid request to send Notion action item.');
      }

      const results = await sendNotionActionItems(payload.meetingId, payload.item);
      return {
        success: true,
        results
      };
    } catch (error) {
      logger.error('Failed to send single action item to Notion', {
        error: error instanceof Error ? error.message : error
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send action item to Notion'
      };
    }
  });

  // Recording
  ipcMain.handle(IpcChannels.START_RECORDING, async (_, meetingId: string) => {
    logger.info('[JOURNEY-IPC-1] START_RECORDING IPC handler called', {
      meetingId,
      timestamp: new Date().toISOString()
    });
    console.log('[JOURNEY] START_RECORDING handler called with meetingId:', meetingId);
    
    // Check permissions before starting recording
    const hasPermissions = await permissionService.hasRequiredPermissions();
    logger.info('Permission check result:', hasPermissions);
    
    if (!hasPermissions) {
      logger.warn('Cannot start recording - missing required permissions');
      await permissionService.showPermissionDialog();
      const error = new Error('Missing required permissions for recording');
      console.error('Permission error:', error);
      throw error;
    }
    
    try {
      logger.info('Calling recordingService.startRecording...');
      currentRecordingMeetingId = meetingId; // Set this BEFORE starting recording to prevent duplicate notifications
      await recordingService.startRecording(meetingId);
      
      // Update meeting status to recording
      await storageService.updateMeeting(meetingId, { status: 'recording' });
      
      if (mainWindow) {
        logger.info('[JOURNEY-IPC-2] Sending RECORDING_STARTED to renderer', {
          meetingId,
          timestamp: new Date().toISOString()
        });
        mainWindow.webContents.send(IpcChannels.RECORDING_STARTED, { meetingId });
        mainWindow.webContents.send(IpcChannels.MEETINGS_UPDATED);
      }
      logger.info('Recording started successfully', { meetingId });
      console.log('Recording started successfully for meeting:', meetingId);
      return { success: true };
    } catch (error: any) {
      logger.error('Failed to start recording', { 
        meetingId, 
        error: error.message,
        stack: error.stack 
      });
      console.error('Recording failed:', error);
      throw error;
    }
  });

  ipcMain.handle(IpcChannels.STOP_RECORDING, async (_, meetingIdFromUI?: string) => {
    logger.info('Stop recording requested', { meetingIdFromUI });
    try {
      const meetingId = currentRecordingMeetingId || meetingIdFromUI;
      const recordingStopped = await recordingService.stopRecording();
      currentRecordingMeetingId = null;

      // If recording service didn't stop anything but we have a meeting ID,
      // it means the meeting was stuck in recording state (e.g., after app restart)
      if (!recordingStopped && meetingId) {
        logger.info('Cleaning up stuck recording state for meeting', { meetingId });
        const meeting = await storageService.getMeeting(meetingId);
        if (meeting && meeting.status === 'recording') {
          await storageService.updateMeeting(meetingId, {
            status: 'completed',
            endTime: new Date()
          });
        }
      } else if (meetingId) {
        // Normal stop recording flow
        await storageService.updateMeeting(meetingId, {
          status: 'completed',
          endTime: new Date()
        });
      }

      if (meetingId) {
        void autoGenerateInsightsForMeeting(meetingId);
        void dispatchEndRecordingTrigger(meetingId);
      }

      if (mainWindow) {
        mainWindow.webContents.send(IpcChannels.RECORDING_STOPPED);
        mainWindow.webContents.send(IpcChannels.MEETINGS_UPDATED);
      }
      logger.info('Recording stopped successfully');
      return { success: true };
    } catch (error) {
      logger.error('Failed to stop recording', { error });
      throw error;
    }
  });

  // Calendar
  ipcMain.handle(IpcChannels.CONNECT_CALENDAR, async () => {
    try {
      await calendarService.authenticate();
      // Update settings to reflect connected status
      await settingsService.updateSettings({ googleCalendarConnected: true });
      if (mainWindow) {
        mainWindow.webContents.send(IpcChannels.SETTINGS_UPDATED, settingsService.getSettings());
      }
      return { success: true };
    } catch (error) {
      console.error('Failed to connect calendar:', error);
      throw error;
    }
  });

  ipcMain.handle(IpcChannels.DISCONNECT_CALENDAR, async () => {
    try {
      await calendarService.disconnect();
      // Update settings to reflect disconnected status
      await settingsService.updateSettings({ googleCalendarConnected: false });
      if (mainWindow) {
        mainWindow.webContents.send(IpcChannels.SETTINGS_UPDATED, settingsService.getSettings());
      }
      return { success: true };
    } catch (error) {
      console.error('Failed to disconnect calendar:', error);
      throw error;
    }
  });

  ipcMain.handle(IpcChannels.SYNC_CALENDAR, async () => {
    try {
      console.log('Starting smart calendar sync (manual)...');
      // Manual sync fetches 30 days ahead
      const events = await calendarService.fetchUpcomingMeetings(30);
      console.log(`Found ${events.length} calendar events`);

      // Use smart sync method
      const syncResult = await storageService.smartSyncCalendarEvents(events);

      console.log(`Smart sync completed:`, syncResult);
      if (mainWindow) {
        mainWindow.webContents.send(IpcChannels.MEETINGS_UPDATED);
      }
      return {
        success: true,
        eventsCount: events.length,
        ...syncResult
      };
    } catch (error) {
      console.error('Calendar sync failed:', error);
      throw error;
    }
  });

  // Storage path
  ipcMain.handle(IpcChannels.SELECT_STORAGE_PATH, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Storage Folder',
    });
    if (!result.canceled && result.filePaths[0]) {
      await settingsService.updateSettings({ storagePath: result.filePaths[0] });
      return { path: result.filePaths[0] };
    }
    return { path: null };
  });

  ipcMain.handle(IpcChannels.SELECT_FILE_PATH, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      title: 'Select File'
    });

    if (!result.canceled && result.filePaths[0]) {
      return { path: result.filePaths[0] };
    }

    return { path: null };
  });

  // Open meeting file
  ipcMain.handle(IpcChannels.OPEN_MEETING_FILE, async (_, meetingId: string) => {
    const meeting = await storageService.getMeeting(meetingId);
    if (meeting?.filePath) {
      shell.showItemInFolder(meeting.filePath);
    }
    return { success: true };
  });

  // Show in Finder
  ipcMain.handle(IpcChannels.SHOW_IN_FINDER, async (_, filePath: string) => {
    const fsPromises = require('fs').promises;
    try {
      await fsPromises.access(filePath);
      shell.showItemInFolder(filePath);
      return true;
    } catch {
      return false;
    }
  });

  // Open external URL
  ipcMain.handle(IpcChannels.OPEN_EXTERNAL, async (_, url: string) => {
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      logger.error(`Failed to open external URL: ${url}`, error);
      return { success: false, error: 'Failed to open URL' };
    }
  });

  // Join meeting with auto-record intent
  ipcMain.handle('join-meeting-with-intent', async (_, url: string) => {
    try {
      logger.info('[JOIN-INTENT] User clicked Join Meeting, setting auto-record flag', { url });

      // Set flag to auto-record the next detected meeting
      autoRecordNextMeeting = true;

      // Clear flag after 90 seconds if no meeting detected
      setTimeout(() => {
        if (autoRecordNextMeeting) {
          logger.info('[JOIN-INTENT] Auto-record flag expired (90s timeout)');
          autoRecordNextMeeting = false;
        }
      }, 90000);

      // Open the meeting URL in browser
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      logger.error('[JOIN-INTENT] Failed to open meeting URL', error);
      autoRecordNextMeeting = false; // Clear flag on error
      return { success: false, error: 'Failed to open URL' };
    }
  });

  // Get log file path (for debugging)
  ipcMain.handle('get-log-path', async () => {
    return logger.getLatestLogPath();
  });
  
  // Permission status
  ipcMain.handle('get-permission-status', async () => {
    return await permissionService.getPermissionStatus();
  });

  ipcMain.handle('check-permissions', async () => {
    return await permissionService.checkAllPermissions();
  });

  ipcMain.handle('request-permissions', async () => {
    await permissionService.showPermissionDialog();
    return { success: true };
  });

  ipcMain.handle('open-permission-settings', async (_event, permission: PermissionType) => {
    try {
      permissionService.openPermissionSettings(permission);
      return { success: true };
    } catch (error) {
      logger.error('[IPC] Failed to open permission settings', { permission, error });
      return { success: false };
    }
  });

  // Search handlers
  ipcMain.handle(IpcChannels.SEARCH_MEETINGS, async (_, options: SearchOptions) => {
    const results = searchService.search(options);
    return results;
  });

  ipcMain.handle(IpcChannels.GET_SEARCH_HISTORY, async () => {
    return searchService.getSearchHistory();
  });

  ipcMain.handle(IpcChannels.CLEAR_SEARCH_HISTORY, async () => {
    searchService.clearHistory();
    return { success: true };
  });
  ipcMain.handle(IpcChannels.GET_TRANSCRIPT_BUFFER, async (_event, meetingId: string) => {
    try {
      return recordingService.getBufferedChunks(meetingId);
    } catch (error) {
      logger.error('[IPC-GET_TRANSCRIPT_BUFFER] Failed to retrieve buffer', {
        meetingId,
        error: error instanceof Error ? error.message : error
      });
      return [];
    }
  });

  // Real-time coaching handlers
  ipcMain.handle(IpcChannels.START_COACHING, async (_, meetingId: string, coachingType: CoachingType) => {
    try {
      if (!coachingService) {
        return { success: false, error: 'Coaching service not initialized' };
      }

      await coachingService.startCoaching(meetingId, coachingType);
      return { success: true };
    } catch (error: any) {
      logger.error('Failed to start coaching:', error);
      return { success: false, error: error.message || 'Failed to start coaching' };
    }
  });

  ipcMain.handle(IpcChannels.STOP_COACHING, async () => {
    try {
      if (!coachingService) {
        return { success: false, error: 'Coaching service not initialized' };
      }

      coachingService.stopCoaching();
      return { success: true };
    } catch (error: any) {
      logger.error('Failed to stop coaching:', error);
      return { success: false, error: error.message || 'Failed to stop coaching' };
    }
  });

  ipcMain.handle(IpcChannels.UPDATE_COACHING_NOTES, async (_, meetingId: string, notes: string) => {
    try {
      if (!coachingService) {
        return { success: false, error: 'Coaching service not initialized' };
      }

      coachingService.updateMeetingNotes(meetingId, notes);
      return { success: true };
    } catch (error: any) {
      logger.error('Failed to update coaching notes:', error);
      return { success: false, error: error.message || 'Failed to update coaching notes' };
    }
  });

  ipcMain.handle(IpcChannels.GET_COACHING_STATE, async () => {
    if (!coachingService) {
      return { isActive: false, coachingType: null, meetingId: null };
    }
    return coachingService.getCoachingState();
  });

  ipcMain.handle(IpcChannels.GET_COACHING_FEEDBACK, async () => {
    if (!coachingService) {
      return [];
    }
    return coachingService.getFeedbackHistory();
  });
}

// Helper function to find scheduled meetings that match the current time
async function findMatchingScheduledMeeting(detectedTitle?: string): Promise<Meeting | null> {
  try {
    const now = new Date();
    const meetings = await storageService.getAllMeetings();

    // Look for meetings starting within the next 3 minutes OR already ongoing
    const matchingMeetings = meetings.filter((meeting: Meeting) => {
      const eligibleStatuses: Array<Meeting['status']> = ['scheduled', 'recording', 'active'];
      const status = meeting.status ?? 'scheduled';
      if (!eligibleStatuses.includes(status)) {
        return false;
      }

      const meetingStartSource = meeting.startTime ?? meeting.date;
      const meetingStartTime = new Date(meetingStartSource);
      if (Number.isNaN(meetingStartTime.getTime())) {
        return false;
      }
      const timeDiff = meetingStartTime.getTime() - now.getTime(); // Positive if meeting is in future
      const minutesDiff = timeDiff / (1000 * 60);

      // Meeting starting within next 3 minutes
      if (minutesDiff >= 0 && minutesDiff <= 3) {
        logger.info(`[MEETING-MATCH] Found meeting starting soon: ${meeting.title} (in ${minutesDiff.toFixed(1)} minutes)`);
        return true;
      }

      // Meeting already started (check if it's still ongoing)
      if (minutesDiff < 0) {
        // Assume meetings last 60 minutes if no explicit end time
        const estimatedDuration = meeting.duration || 60; // minutes
        const meetingEndTime = new Date(meetingStartTime.getTime() + (estimatedDuration * 60 * 1000));

        // Meeting is ongoing if current time is between start and end
        if (now >= meetingStartTime && now <= meetingEndTime) {
          const minutesIntoMeeting = Math.abs(minutesDiff);
          logger.info(`[MEETING-MATCH] Found ongoing meeting: ${meeting.title} (${minutesIntoMeeting.toFixed(1)} minutes in)`);
          return true;
        }
      }

      return false;
    });

    // If we have a detected title, try to find the best match
    if (detectedTitle && matchingMeetings.length > 0) {
      const titleLower = detectedTitle.toLowerCase();
      const bestMatch = matchingMeetings.find((meeting: Meeting) =>
        meeting.title.toLowerCase().includes(titleLower) ||
        titleLower.includes(meeting.title.toLowerCase())
      );
      if (bestMatch) return bestMatch;
    }

    // Return the earliest scheduled meeting if any
    if (matchingMeetings.length > 0) {
      const statusPriority: Partial<Record<Meeting['status'], number>> = {
        recording: 3,
        active: 2,
        scheduled: 1
      };

      return matchingMeetings
        .sort((a: Meeting, b: Meeting) => {
          const aPriority = statusPriority[a.status ?? 'scheduled'] ?? 0;
          const bPriority = statusPriority[b.status ?? 'scheduled'] ?? 0;
          if (aPriority !== bPriority) {
            return bPriority - aPriority;
          }

          return new Date(a.date).getTime() - new Date(b.date).getTime();
        })[0];
    }

    return null;
  } catch (error) {
    logger.error('Error finding matching scheduled meeting:', error);
    return null;
  }
}

function isStoredMeeting(candidate: Meeting | CalendarEvent): candidate is Meeting {
  return typeof (candidate as Meeting)?.status === 'string';
}

function normalizeMatchTitle(title?: string | null): string {
  return typeof title === 'string' ? title.trim().replace(/\s+/g, ' ').toLowerCase() : '';
}

async function findExistingMeetingForCalendarMatch(
  match: CalendarEvent,
  context: { detectedTitle?: string }
): Promise<Meeting | null> {
  const direct = await storageService.getMeetingByCalendarId(match.id);
  if (direct) {
    return direct;
  }

  const allMeetings = await storageService.getAllMeetings();
  const normalizedEventTitle = normalizeMatchTitle(match.title || context.detectedTitle);
  const eventStart = match.start ? new Date(match.start) : null;
  const eventId = match.id ?? '';
  const baseEventId = typeof eventId === 'string' && eventId.includes('_') ? eventId.split('_')[0] : eventId;

  let bestScore = -Infinity;
  let bestMeeting: Meeting | null = null;

  const considerMeeting = (meeting: Meeting, score: number) => {
    if (score > bestScore) {
      bestScore = score;
      bestMeeting = meeting;
    }
  };

  for (const meeting of allMeetings) {
    if (!meeting.calendarEventId) {
      continue;
    }

    const meetingStatus = meeting.status ?? 'scheduled';
    if (!['scheduled', 'active', 'recording', 'partial'].includes(meetingStatus)) {
      continue;
    }

    let score = 0;
    const meetingEventId = meeting.calendarEventId;

    if (meetingEventId === eventId) {
      score += 20;
    }

    const meetingBaseId = meetingEventId.includes('_') ? meetingEventId.split('_')[0] : meetingEventId;
    if (baseEventId && meetingBaseId === baseEventId) {
      score += 8;
    } else if (baseEventId && meetingEventId.includes(baseEventId)) {
      score += 4;
    }

    const meetingTitle = normalizeMatchTitle(meeting.title);
    if (normalizedEventTitle) {
      if (meetingTitle === normalizedEventTitle) {
        score += 6;
      } else if (meetingTitle && (meetingTitle.includes(normalizedEventTitle) || normalizedEventTitle.includes(meetingTitle))) {
        score += 3;
      }
    }

    if (eventStart) {
      const meetingStartSource = meeting.startTime ?? meeting.date;
      const meetingStart = meetingStartSource ? new Date(meetingStartSource as Date | string) : null;
      if (meetingStart && !Number.isNaN(meetingStart.getTime())) {
        const diffMinutes = Math.abs(eventStart.getTime() - meetingStart.getTime()) / 60000;
        if (diffMinutes <= 5) {
          score += 6;
        } else if (diffMinutes <= 30) {
          score += 3;
        } else if (diffMinutes <= 120) {
          score += 1;
        }
      }
    }

    if (score > 0) {
      considerMeeting(meeting, score);
    }
  }

  if (bestMeeting !== null && bestScore >= 8) {
    return bestMeeting;
  }

  if (normalizedEventTitle) {
    const fallback = await findMatchingScheduledMeeting(match.title || context.detectedTitle);
    if (fallback) {
      return fallback;
    }
  }

  return null;
}

async function prepareMeetingForRecording(
  match: Meeting | CalendarEvent,
  context: { detectedTitle?: string; platform?: Meeting['platform'] }
): Promise<{ meeting: Meeting; created: boolean }> {
  const startTime = new Date();
  const platform = context.platform;

  if (isStoredMeeting(match)) {
    const updates: Partial<Meeting> = {
      status: 'recording',
      startTime
    };
    if (platform) {
      updates.platform = platform;
    }

    const updated = await storageService.updateMeeting(match.id, updates);
    return { meeting: updated, created: false };
  }

  const existing = await findExistingMeetingForCalendarMatch(match, context);
  if (existing) {
    const updates: Partial<Meeting> = {
      status: 'recording',
      startTime
    };
    if (platform) {
      updates.platform = platform;
    }
    if (match.id && existing.calendarEventId !== match.id) {
      updates.calendarEventId = match.id;
    }

    const refreshed = await storageService.updateMeeting(existing.id, updates);
    return { meeting: refreshed, created: false };
  }

  const creationPayload: Partial<Meeting> = {
    title: match.title || context.detectedTitle || 'Untitled Meeting',
    date: match.start ?? new Date(),
    status: 'recording',
    startTime,
    calendarEventId: match.id,
    meetingUrl: match.meetingUrl,
    calendarInviteUrl: match.htmlLink,
    attendees: match.attendees ?? [],
    notes: '',
    transcript: ''
  };

  if (platform) {
    creationPayload.platform = platform;
  }

  const created = await storageService.createMeeting(creationPayload);
  return { meeting: created, created: true };
}

// Store active notifications to prevent garbage collection
const activeNotifications = new Map<string, Notification | BrowserWindow>();

async function suppressAppFocusWhileInactive(callback: () => void | Promise<void>): Promise<void> {
  if (process.platform !== 'darwin') {
    await callback();
    return;
  }

  const candidateWindows = [mainWindow, coachWindow].filter((win): win is BrowserWindow => !!win && !win.isDestroyed());
  const windowsToSuppress = candidateWindows.filter((win) => !win.isFocused());

  if (windowsToSuppress.length === 0) {
    await callback();
    return;
  }

  windowsToSuppress.forEach((win) => {
    try {
      win.setFocusable(false);
    } catch (error) {
      logger.warn('[NOTIFICATION] Failed to set window focusable=false during suppression', {
        windowId: win.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  try {
    await callback();
  } finally {
    setTimeout(() => {
      windowsToSuppress.forEach((win) => {
        if (win.isDestroyed()) {
          return;
        }
        try {
          win.setFocusable(true);
        } catch (error) {
          logger.warn('[NOTIFICATION] Failed to restore window focusable state after suppression', {
            windowId: win.id,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      });
    }, 250);
  }
}

// Helper function to create custom notification windows
function createCustomNotification(config: {
  title: string;
  body: string;
  subtitle?: string;
  type?: NotificationType;
  icon?: string;
  autoCloseMs?: number;
  onClick?: () => void | Promise<void>;
  onClose?: () => void;
}): BrowserWindow {
  const { title, body, subtitle, type = 'info', icon, autoCloseMs = 5000, onClick, onClose } = config;

  logger.info('[NOTIFICATION-CREATE] Starting notification window creation', {
    title,
    bodyLength: body.length,
    autoCloseMs,
    timestamp: new Date().toISOString()
  });

  const notificationWindow = new BrowserWindow({
    width: 420,
    height: 140,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    show: false,
    focusable: process.platform === 'darwin' ? false : true,
    acceptFirstMouse: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  logger.info('[NOTIFICATION-CREATE] BrowserWindow created successfully', {
    windowId: notificationWindow.id,
    timestamp: new Date().toISOString()
  });

  // Position in top-right corner
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth } = primaryDisplay.workAreaSize;
  notificationWindow.setPosition(screenWidth - 420, 20);

  // Make it stay on top of everything
  // NOTE: DO NOT call setVisibleOnAllWorkspaces() as it can cause the app to disappear from dock
  // See: https://github.com/electron/electron/issues/26350
  notificationWindow.setAlwaysOnTop(true, 'screen-saver', 1);

  // CRITICAL FIX: Force dock to stay visible after creating notification window
  // This prevents macOS from transforming the app to a UI Element Application
  if (process.platform === 'darwin' && app.dock) {
    app.dock.show();
  }

  // Generate notification HTML using new template
  const notificationHTML = generateNotificationHTML({
    title,
    body,
    subtitle,
    type,
    icon,
    autoCloseMs
  });

  // Load notification HTML - catch any errors to prevent unhandled rejections
  logger.info('[NOTIFICATION-CREATE] Starting loadURL', {
    windowId: notificationWindow.id,
    timestamp: new Date().toISOString()
  });

  notificationWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(notificationHTML)}`)
    .then(() => {
      logger.info('[NOTIFICATION-CREATE] loadURL completed successfully', {
        windowId: notificationWindow.id,
        timestamp: new Date().toISOString()
      });

      if (!notificationWindow.isDestroyed()) {
        if (typeof notificationWindow.showInactive === 'function') {
          notificationWindow.showInactive();
        } else {
          notificationWindow.show();
        }
      }
    })
    .catch(error => {
      logger.error('[NOTIFICATION] Failed to load notification HTML:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        windowId: notificationWindow.id,
        title,
        bodyLength: body.length
      });
    });

  let autoCloseTimer: NodeJS.Timeout | null = null;

  const closeNotificationWindow = async (suppressFocus: boolean) => {
    if (autoCloseTimer) {
      clearTimeout(autoCloseTimer);
      autoCloseTimer = null;
    }

    if (notificationWindow.isDestroyed()) {
      return;
    }

    const closeAction = () => {
      if (!notificationWindow.isDestroyed()) {
        notificationWindow.close();
      }
    };

    if (suppressFocus) {
      await suppressAppFocusWhileInactive(closeAction);
    } else {
      closeAction();
    }
  };

  // Auto-close timer
  autoCloseTimer = setTimeout(() => {
    closeNotificationWindow(true).catch((error) => {
      logger.warn('[NOTIFICATION] Failed to close notification window on auto-close timer', {
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }, autoCloseMs);

  // No need to inject JavaScript - it's now embedded in the HTML

  notificationWindow.webContents.on('will-navigate', async (e, url) => {
    e.preventDefault();
    logger.info('[NOTIFICATION] will-navigate event fired', {
      url,
      timestamp: new Date().toISOString()
    });
    console.log('[NOTIFICATION] will-navigate:', url);

    if (url === 'notification://clicked') {
      logger.info('[NOTIFICATION] Notification clicked - executing onClick handler', {
        hasOnClick: !!onClick,
        timestamp: new Date().toISOString()
      });
      await closeNotificationWindow(false);
      if (onClick) {
        try {
          logger.info('[NOTIFICATION] About to call onClick handler', {
            timestamp: new Date().toISOString()
          });
          await onClick();
          logger.info('[NOTIFICATION] onClick handler completed successfully', {
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          logger.error('[NOTIFICATION] Error in onClick handler:', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          });
        }
      }
    } else if (url === 'notification://closed') {
      logger.info('[NOTIFICATION] Notification closed button clicked', {
        timestamp: new Date().toISOString()
      });
      await closeNotificationWindow(true);
      if (onClose) {
        try {
          onClose();
        } catch (error) {
          logger.error('[NOTIFICATION] Error in onClose handler:', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          });
        }
      }
    }
  });

  notificationWindow.on('focus', () => {
    if (!notificationWindow.isDestroyed()) {
      notificationWindow.blur();
    }
    if (process.platform === 'darwin' && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.blur();
    }
  });

  notificationWindow.on('closed', () => {
    activeNotifications.forEach((value, key) => {
      if (value === notificationWindow) {
        activeNotifications.delete(key);
      }
    });
  });

  logger.info('[NOTIFICATION-CREATE] Notification window fully configured, returning', {
    windowId: notificationWindow.id,
    timestamp: new Date().toISOString()
  });

  return notificationWindow;
}

function setupMeetingDetectionHandlers() {
  meetingDetectionService.on('meeting-detected', async (data) => {
    logger.info('[MEETING-DETECTED-START] Handler started', {
      timestamp: new Date().toISOString(),
      windowId: data.windowId
    });
    console.log('[MEETING-DETECTED-START] Meeting detection handler starting...');

    try {
      logger.info('[JOURNEY-8] Meeting detected event received in main process', {
        windowId: data.windowId,
        platform: data.platform,
        title: data.meetingTitle,
        hasSuggested: !!data.suggestedMeeting,
        currentlyRecording: !!currentRecordingMeetingId,
        timestamp: new Date().toISOString()
      });
      console.log('[JOURNEY-8] Meeting detected:', data.meetingTitle);

      // Skip notification if we're already recording something
      if (currentRecordingMeetingId) {
        logger.info('[JOURNEY-8-SKIP] Skipping notification - already recording', {
          currentRecordingMeetingId,
          detectedMeeting: data.meetingTitle
        });
        return;
      }

      // Try to find a matching scheduled meeting
      let matchedMeeting = data.suggestedMeeting;
      if (!matchedMeeting) {
        matchedMeeting = await findMatchingScheduledMeeting(data.meetingTitle);
        logger.info('[JOURNEY-8a] Searched for matching scheduled meeting', {
          detectedTitle: data.meetingTitle,
          foundMatch: !!matchedMeeting,
          matchedTitle: matchedMeeting?.title
        });
      }

      // Check if we should auto-record (user clicked "Join Meeting")
      if (autoRecordNextMeeting) {
        logger.info('[AUTO-RECORD] Auto-record flag detected, starting recording automatically', {
          detectedMeeting: data.meetingTitle,
          hasMatchedMeeting: !!matchedMeeting
        });

        // Clear the flag immediately
        autoRecordNextMeeting = false;

        try {
          let meetingToRecord: Meeting;

          if (matchedMeeting) {
            logger.info('[AUTO-RECORD] Using matched meeting candidate', {
              candidateId: matchedMeeting.id,
              title: matchedMeeting.title
            });

            const { meeting, created } = await prepareMeetingForRecording(matchedMeeting, {
              detectedTitle: data.meetingTitle,
              platform: data.platform as Meeting['platform']
            });
            meetingToRecord = meeting;

            if (created) {
              await storageService.forceSave();
            }
          } else {
            logger.info('[AUTO-RECORD] Creating new meeting for recording', {
              title: data.meetingTitle || 'Untitled Meeting'
            });

            const creationPayload: Partial<Meeting> = {
              title: data.meetingTitle || 'Untitled Meeting',
              date: new Date(),
              status: 'recording',
              startTime: new Date(),
              notes: '',
              transcript: ''
            };

            if (data.platform) {
              creationPayload.platform = data.platform as Meeting['platform'];
            }

            meetingToRecord = await storageService.createMeeting(creationPayload);
            await storageService.forceSave();
          }

          // Start recording with proper meeting ID
          logger.info('[AUTO-RECORD] Starting recording', {
            meetingId: meetingToRecord.id,
            meetingTitle: meetingToRecord.title
          });

          await startRecording(meetingToRecord, { logPrefix: '[AUTO-RECORD]', openBrowser: false });

          // Show success notification
          createCustomNotification({
            title: 'Recording Started',
            body: `Recording: ${meetingToRecord.title}`,
            type: 'recording-started',
            autoCloseMs: 3000
          });

          logger.info('[AUTO-RECORD] Successfully auto-started recording');
          return; // Skip the manual notification

        } catch (error) {
          logger.error('[AUTO-RECORD-ERROR] Failed to auto-start recording', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          });

          // Show error notification
          createCustomNotification({
            title: 'Auto-Record Failed',
            body: 'Could not start recording automatically. Please try manually.',
            type: 'error',
            autoCloseMs: 5000
          });

          // Fall through to show manual notification
        }
      }

      // Determine notification content based on whether we found a match
      const notificationTitle = matchedMeeting
        ? `Meeting: ${matchedMeeting.title}`
        : `Meeting Detected: ${data.meetingTitle || 'Unknown'}`;

      const notificationBody = 'Click to start recording';

      try {
        logger.info('[NOTIFICATION] Creating custom notification', {
          title: notificationTitle,
          body: notificationBody,
          timestamp: new Date().toISOString()
        });
      } catch (logError) {
        console.error('[NOTIFICATION] Logger failed:', logError);
      }

      console.log('[NOTIFICATION-CONSOLE] About to create notification ID');

      // Create custom notification window
      const notificationId = `${data.windowId}-${Date.now()}`;

      console.log('[NOTIFICATION-CONSOLE] Notification ID created:', notificationId);

      try {
        logger.info('[NOTIFICATION-DEBUG] About to call createCustomNotification', {
        notificationId,
        windowId: data.windowId,
        timestamp: new Date().toISOString()
      });
      } catch (logError) {
        console.error('[NOTIFICATION-DEBUG] Logger failed:', logError);
      }

      console.log('[NOTIFICATION-CONSOLE] About to call createCustomNotification');

      logger.info('[BEFORE-CREATE-NOTIFICATION] About to create notification window', {
        timestamp: new Date().toISOString()
      });
      console.log('[BEFORE-CREATE-NOTIFICATION] Creating notification window...');

      const notificationWindow = createCustomNotification({
      title: notificationTitle,
      body: notificationBody,
      type: 'meeting',
      autoCloseMs: 60000, // 60 seconds for meeting detection
      onClick: async () => {
        logger.info('[JOURNEY-9] Notification clicked - Start Recording', {
          notificationId,
          hasMatchedMeeting: !!matchedMeeting,
          matchedMeetingTitle: matchedMeeting?.title,
          windowId: data.windowId,
          timestamp: new Date().toISOString()
        });

        activeNotifications.delete(notificationId);

      try {
        let meetingToRecord: Meeting;

        if (matchedMeeting) {
          logger.info('[JOURNEY-9a] Using matched meeting candidate', {
            candidateId: matchedMeeting.id,
            title: matchedMeeting.title
          });

          const { meeting, created } = await prepareMeetingForRecording(matchedMeeting, {
            detectedTitle: data.meetingTitle,
            platform: data.platform as Meeting['platform']
          });
          meetingToRecord = meeting;

          if (created) {
            logger.info('[JOURNEY-9a-created] Meeting created from candidate', {
              meetingId: meetingToRecord.id,
              title: meetingToRecord.title
            });
            try {
              await storageService.forceSave();
              logger.info('[JOURNEY-9a-created] Cache saved after creation');
            } catch (saveError) {
              logger.error('[JOURNEY-9a-created] Failed to force save cache', {
                error: saveError instanceof Error ? saveError.message : String(saveError),
                stack: saveError instanceof Error ? saveError.stack : undefined
              });
            }
          }
        } else {
          logger.info('[JOURNEY-9b] Creating new meeting for recording', {
            title: data.meetingTitle || 'Untitled Meeting',
            windowId: data.windowId
          });

          const creationPayload: Partial<Meeting> = {
            title: data.meetingTitle || 'Untitled Meeting',
            date: new Date(),
            status: 'recording',
            startTime: new Date(),
            notes: '',
            transcript: ''
          };

          if (data.platform) {
            creationPayload.platform = data.platform as Meeting['platform'];
          }

          meetingToRecord = await storageService.createMeeting(creationPayload);
          logger.info('[JOURNEY-9b-created] New meeting created successfully', {
            meetingId: meetingToRecord.id,
            title: meetingToRecord.title
          });

          try {
            await storageService.forceSave();
            logger.info('[JOURNEY-9b-created] Cache saved after meeting creation');
          } catch (saveError) {
            logger.error('[JOURNEY-9b-created] Failed to force save cache', {
              error: saveError instanceof Error ? saveError.message : String(saveError),
              stack: saveError instanceof Error ? saveError.stack : undefined
            });
          }
        }

        logger.info('[JOURNEY-9d] About to start recording', {
          meetingId: meetingToRecord.id,
          meetingTitle: meetingToRecord.title,
          meetingStatus: meetingToRecord.status,
          recordingServiceExists: !!recordingService,
          recordingServiceInitialized: recordingService?.getInitializedStatus()
        });

        if (!recordingService) {
          throw new Error('Recording service not initialized');
        }

        await startRecording(meetingToRecord, { logPrefix: '[JOURNEY-9d]', openBrowser: false });

      } catch (error) {
        logger.error('[JOURNEY-9-ERROR] Failed to start recording from notification', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          name: error instanceof Error ? error.name : undefined,
          windowId: data.windowId,
          timestamp: new Date().toISOString()
        });

        // Try to save any pending data
        try {
          logger.info('[JOURNEY-9-ERROR-SAVE] Attempting emergency save after error');
          await storageService.forceSave();
          logger.info('[JOURNEY-9-ERROR-SAVE] Emergency save completed');
        } catch (saveError) {
          logger.error('[JOURNEY-9-ERROR-SAVE-FAILED] Emergency save failed', {
            error: saveError instanceof Error ? saveError.message : String(saveError)
          });
        }

        // Show error notification using custom notification
        createCustomNotification({
          title: 'Recording Failed',
          body: 'Could not start recording. Please check the app.',
          type: 'error',
          autoCloseMs: 5000
        });
      }
      },
      onClose: () => {
        logger.info('[NOTIFICATION] Notification manually closed', {
          notificationId,
          timestamp: new Date().toISOString()
        });
        activeNotifications.delete(notificationId);
      }
    });

      // Store notification window to prevent garbage collection
      activeNotifications.set(notificationId, notificationWindow);

      logger.info('[NOTIFICATION-DEBUG] Notification window created and stored', {
        notificationId,
        activeNotificationsCount: activeNotifications.size,
        timestamp: new Date().toISOString()
      });

      // Clean up notification references after 30 seconds
      scheduleNotificationCleanup(notificationId);
    } catch (error) {
      logger.error('[MEETING-DETECTED-ERROR] Error in meeting-detected event handler', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        name: error instanceof Error ? error.name : undefined,
        windowId: data.windowId,
        meetingTitle: data.meetingTitle,
        timestamp: new Date().toISOString()
      });

      // Try to show error notification
      try {
        createCustomNotification({
          title: 'Meeting Detection Error',
          body: 'Could not process meeting detection. Please try manually.',
          type: 'error',
          autoCloseMs: 5000
        });
      } catch (notifError) {
        logger.error('[MEETING-DETECTED-ERROR] Could not show error notification', notifError);
      }
    }
  });

  recordingService.on('transcript-chunk', async (chunk) => {
    logger.info('[JOURNEY-TRANSCRIPT] Transcript chunk received', {
      speaker: chunk.speaker,
      textLength: chunk.text?.length,
      timestamp: chunk.timestamp
    });

    // Get the current recording meeting ID
    const meetingId = recordingService.getRecordingState()?.meetingId;

    if (mainWindow && meetingId) {
      // Send with meetingId so the UI can match it
      mainWindow.webContents.send(IpcChannels.TRANSCRIPT_UPDATE, {
        meetingId,
        ...chunk
      });
    }

    // Forward transcript chunk to coaching service if active
    if (coachingService) {
      const enrichedChunk = meetingId ? { ...chunk, meetingId } : chunk;
      coachingService.addTranscriptChunk(enrichedChunk);
    }
  });

  recordingService.on('connection-status', async (status) => {
    if (mainWindow) {
      mainWindow.webContents.send(IpcChannels.CONNECTION_STATUS, status);
    }
  });

  recordingService.on('error', async (error) => {
    if (mainWindow) {
      mainWindow.webContents.send(IpcChannels.ERROR_OCCURRED, error);
    }
  });

  // Listen for calendar meeting reminders (proactive notifications)
  calendarService.on('meeting-reminder', async (event) => {
    const minutesBeforeStart = Math.round((new Date(event.start).getTime() - Date.now()) / (1000 * 60));

    logger.info('[MEETING-REMINDER] Meeting reminder triggered', {
      title: event.title,
      start: event.start,
      minutesBeforeStart
    });

    const reminderNotificationId = `reminder-${event.id}-${Date.now()}`;
    const notificationWindow = createCustomNotification({
      title: `Meeting starting soon: ${event.title}`,
      body: 'Click to start recording',
      subtitle: `Starting in ${minutesBeforeStart} minute(s)`,
      type: 'reminder',
      autoCloseMs: 90000, // 90 seconds
      onClick: async () => {
        activeNotifications.delete(reminderNotificationId);

        logger.info('[MEETING-REMINDER] Notification clicked for upcoming meeting', {
          eventId: event.id,
          title: event.title
        });

        try {
          // Find or create meeting and start recording
          const meetings = await storageService.getAllMeetings();
          let meeting = meetings.find(m => m.calendarEventId === event.id);

          if (!meeting) {
            logger.info('[MEETING-REMINDER] Creating new meeting from calendar event');
            meeting = await storageService.createMeeting({
              title: event.title,
              date: new Date(event.start),
              status: 'recording',
              startTime: new Date(),
              calendarEventId: event.id,
              meetingUrl: event.meetingUrl,
              attendees: event.attendees || [],
              notes: '',
              transcript: ''
            });
          } else {
            logger.info('[MEETING-REMINDER] Using existing meeting from calendar event');
            await storageService.updateMeeting(meeting.id, {
              status: 'recording',
              startTime: new Date()
            });
            meeting = await storageService.getMeeting(meeting.id);
          }

          if (!meeting) {
            throw new Error('Failed to create or retrieve meeting');
          }

          await startRecording(meeting, { logPrefix: '[MEETING-REMINDER]', openBrowser: true });
        } catch (error) {
          logger.error('[MEETING-REMINDER] Failed to start recording from reminder', {
            error: error instanceof Error ? error.message : String(error),
            eventId: event.id,
            title: event.title
          });

          // Show error notification using custom notification
          createCustomNotification({
            title: 'Recording Failed',
            body: 'Could not start recording for the upcoming meeting',
            type: 'error',
            autoCloseMs: 5000
          });
        }
      },
      onClose: () => {
        logger.info('[MEETING-REMINDER] Notification manually dismissed');
        activeNotifications.delete(reminderNotificationId);
      }
    });

    // Store notification window to prevent garbage collection
    activeNotifications.set(reminderNotificationId, notificationWindow);
  });
}

async function autoGenerateInsightsForMeeting(meetingId: string): Promise<void> {
  if (!recordingService) {
    return;
  }

  const insightsService = recordingService.getInsightsService();
  if (!insightsService || !insightsService.isAvailable()) {
    return;
  }

  if (autoInsightsInFlight.has(meetingId)) {
    return;
  }

  autoInsightsInFlight.add(meetingId);

  try {
    try {
      logger.info('[AUTO-INSIGHTS] Waiting for transcript finalization', { meetingId });
      await recordingService.waitForFinalization(meetingId, 120000);
      logger.info('[AUTO-INSIGHTS] Transcript finalization complete', { meetingId });
    } catch (finalizationError) {
      logger.warn('[AUTO-INSIGHTS] Finalization wait failed or timed out, proceeding anyway', {
        meetingId,
        error: finalizationError instanceof Error ? finalizationError.message : String(finalizationError)
      });
    }

    const meeting = await storageService.getMeeting(meetingId);
    if (!meeting) {
      return;
    }

    const insightsAlreadyPresent = typeof meeting.insights === 'string' && meeting.insights.trim().length > 0;
    if (insightsAlreadyPresent) {
      return;
    }

    const hasContent = (meeting.transcript && meeting.transcript.trim().length > 0) ||
      (meeting.notes && meeting.notes.trim().length > 0);
    if (!hasContent) {
      logger.info('[AUTO-INSIGHTS] Skipping generation due to missing content', { meetingId });
      return;
    }

    logger.info('[AUTO-INSIGHTS] Generating insights after recording completion', { meetingId });

    const userProfile = settingsService.getProfile();
    const insights = await insightsService.generateInsights(meeting, userProfile);
    await storageService.updateMeeting(meetingId, { insights });

    notifyMeetingsUpdated();
  } catch (error) {
    logger.warn('[AUTO-INSIGHTS] Failed to generate insights automatically', {
      meetingId,
      error: error instanceof Error ? error.message : String(error)
    });
  } finally {
    autoInsightsInFlight.delete(meetingId);
  }
}


// Consolidated helper function for starting recording with optional browser launch
async function startRecording(meeting: Meeting, options: { logPrefix: string; openBrowser?: boolean }): Promise<void> {
  // Open meeting URL in browser if requested
  if (options.openBrowser && meeting.meetingUrl) {
    logger.info(`${options.logPrefix} Opening meeting URL in browser`, {
      url: meeting.meetingUrl,
      meetingTitle: meeting.title
    });
    try {
      await shell.openExternal(meeting.meetingUrl);
    } catch (urlError) {
      logger.warn(`${options.logPrefix} Failed to open meeting URL`, {
        url: meeting.meetingUrl,
        error: urlError instanceof Error ? urlError.message : String(urlError)
      });
    }
  }

  await recordingService.startRecording(meeting.id);

  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    notifyRecordingStarted(meeting.id);
  }

  logger.info(`${options.logPrefix} Successfully started recording`, {
    meetingId: meeting.id,
    title: meeting.title,
    browserLaunched: options.openBrowser && !!meeting.meetingUrl
  });
}

// Helper function for silent calendar sync
async function initializeSDKInBackground() {
  // Initialize SDK asynchronously without blocking the UI
  logger.info('Starting SDK initialization in background...');
  
  const settings = settingsService.getSettings();
  if (settings.recallApiKey) {
    // Prioritize environment variable to prevent region mismatch with API key
    const apiUrl = process.env.RECALL_API_URL || settings.recallApiUrl || 'https://us-west-2.recall.ai';
    logger.info('[API-CONFIG] Initializing SDK with API configuration', {
      apiUrl,
      hasApiKey: !!settings.recallApiKey,
      source: process.env.RECALL_API_URL ? 'env' : (settings.recallApiUrl ? 'settings' : 'default')
    });

    try {
      await recordingService.initialize(settings.recallApiKey, apiUrl, settings.anthropicApiKey);
      
      // Start monitoring for meetings now that SDK is ready
      await meetingDetectionService.startMonitoring();
      
      logger.info('SDK initialized successfully in background');

      // Auto-sync calendar after SDK is ready if connected
      if (settings?.googleCalendarConnected && calendarService.isAuthenticated()) {
        setTimeout(async () => {
          try {
            // Initial sync on startup fetches 30 days ahead
            await syncCalendarSilently(30);
          } catch (error) {
            console.error('Auto-sync failed:', error);
          }
        }, 5000);
      }
    } catch (error) {
      logger.error('Failed to initialize SDK in background:', error);
      // App can still function without SDK - just no meeting detection
    }
  } else {
    logger.warn('No Recall API key - SDK not initialized');
  }
}

async function syncCalendarSilently(daysAhead: number = 7) {
  try {
    const events = await calendarService.fetchUpcomingMeetings(daysAhead);
    console.log(`Auto-sync (${daysAhead} days): Found ${events.length} calendar events`);

    // Use smart sync method
    const syncResult = await storageService.smartSyncCalendarEvents(events);

    if (syncResult.added > 0 || syncResult.updated > 0 || syncResult.deleted > 0) {
      console.log(`Auto-sync completed:`, {
        added: syncResult.added,
        updated: syncResult.updated,
        deleted: syncResult.deleted,
        errors: syncResult.errors.length
      });

      if (mainWindow) {
        mainWindow.webContents.send(IpcChannels.MEETINGS_UPDATED);
      }
    }

    if (syncResult.errors.length > 0) {
      console.warn('Auto-sync had errors:', syncResult.errors);
    }

    return {
      success: true,
      eventsCount: events.length,
      ...syncResult
    };
  } catch (error) {
    console.error('Silent sync failed:', error);
    throw error;
  }
}

app.whenReady().then(async () => {
  try {
    logger.info('[APP] Electron app is ready', {
      platform: process.platform,
      versions: process.versions,
      env: process.env.NODE_ENV,
    });

    // Force app to show in dock (macOS)
    if (process.platform === 'darwin' && app.dock) {
      app.dock.show();
    }

    // Create application menu
    createApplicationMenu();

    setupRendererDiagnostics();

    // Create window first so UI appears immediately
    createWindow();

    // Initialize basic services (fast) and setup IPC handlers immediately
    // so the UI can function while SDK initializes in background
    logger.info('Initializing core services...');

    // Initialize permission service first
    permissionService = new PermissionService();
    // Skip permission check on startup to avoid repeated dialogs on unsigned apps
    // Permissions will still be checked when user tries to record

    settingsService = new SettingsService();
    await settingsService.initialize();
    firefliesTranscriptService = new FirefliesTranscriptService(settingsService.getSettings().firefliesApiKey);

  try {
    logger.info('[MAIN-INIT] Creating PromptService instance...');
    promptService = new PromptService();
    logger.info('[MAIN-INIT] PromptService instance created, initializing...');
    await promptService.initialize();
    logger.info('[MAIN-INIT] PromptService initialized successfully');
  } catch (error) {
    logger.error('[MAIN-INIT] FATAL: Failed to initialize PromptService:', error);
    logger.error('[MAIN-INIT] Error details:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    // Continue without PromptService for now to avoid breaking the app
    logger.warn('[MAIN-INIT] Continuing without PromptService - some features will be disabled');
    promptService = null;
  }

  logger.info('[MAIN-INIT] PromptService status:', { isNull: promptService === null });

  storageService = new StorageService(settingsService, notifyMeetingsUpdated);
  await storageService.initialize();

  searchService = new SearchService();
  const meetings = await storageService.getAllMeetings();
  searchService.updateIndex(meetings);

  void storageService.waitForFullRefresh()
    .then(async () => {
      const refreshedMeetings = await storageService.getAllMeetings();
      searchService.updateIndex(refreshedMeetings);
    })
    .catch((error) => {
      logger.error('[MAIN-INIT] Background storage refresh failed', {
        error: error instanceof Error ? error.message : error
      });
    });

  calendarService = new CalendarService();
  notionTodoService = new NotionTodoService();

  logger.info('[MAIN-INIT] Creating RecordingService with PromptService:', { hasPromptService: promptService !== null });
  recordingService = new RecordingService(storageService, promptService);

  // Initialize coaching service
  logger.info('[MAIN-INIT] Creating RealtimeCoachingService with PromptService:', { hasPromptService: promptService !== null });
  coachingService = new RealtimeCoachingService(promptService, settingsService, storageService);
  meetingChatService = new MeetingChatService(storageService);
  const settings = settingsService.getSettings();
  if (settings.anthropicApiKey) {
    coachingService.initialize(settings.anthropicApiKey);
    meetingChatService.initialize(settings.anthropicApiKey);
  }

  // Setup coaching service event handlers
  if (coachingService) {
    coachingService.on('coaching-feedback', (feedback) => {
      if (mainWindow) {
        mainWindow.webContents.send(IpcChannels.COACHING_FEEDBACK, feedback);
      }
    });

    coachingService.on('coaching-error', (error) => {
      if (mainWindow) {
        mainWindow.webContents.send(IpcChannels.COACHING_ERROR, error);
      }
    });
  }

  // Create meeting detection service with basic setup (no SDK yet)
  meetingDetectionService = new MeetingDetectionService(
    settingsService,
    recordingService,
    storageService,
    calendarService
  );
  
  // Setup IPC handlers NOW so UI can load data
  setupIpcHandlers();
  
  // Setup meeting detection handlers
  setupMeetingDetectionHandlers();

  // Start calendar meeting reminders if calendar is connected
  if (settingsService.getSettings()?.googleCalendarConnected) {
    calendarService.startMeetingReminders();
    logger.info('Started meeting reminder service for calendar notifications');
  }

  // Listen for auto-stop recording events from the RecordingService
  recordingService.on('recording-auto-stopped', async (data) => {
    logger.info('Recording auto-stopped by SDK', {
      reason: data?.reason || 'unknown',
      meetingId: data?.meetingId,
      transcriptCount: data?.transcriptCount
    });

    const meetingId = data?.meetingId || currentRecordingMeetingId;
    currentRecordingMeetingId = null;

    if (meetingId) {
      // Update meeting status to completed
      await storageService.updateMeeting(meetingId, { status: 'completed' });
      void autoGenerateInsightsForMeeting(meetingId);
      void dispatchEndRecordingTrigger(meetingId);

      if (mainWindow) {
        mainWindow.webContents.send(IpcChannels.RECORDING_STOPPED);
        mainWindow.webContents.send(IpcChannels.MEETINGS_UPDATED);

        // Send notification about auto-stop
        mainWindow.webContents.send('recording-auto-stopped', {
          meetingId,
          reason: data?.reason || 'meeting-ended',
          transcriptCount: data?.transcriptCount || 0
        });
      }
    }
  });

  recordingService.on('transcript-correction-started', (payload) => {
    logger.info('[TRANSCRIPT-CORRECTION] started', {
      meetingId: payload?.meetingId
    });
    if (mainWindow) {
      mainWindow.webContents.send('transcript-correction-started', payload);
    }
  });

  recordingService.on('transcript-correction-progress', (payload) => {
    if (mainWindow) {
      mainWindow.webContents.send('transcript-correction-progress', payload);
    }
  });

  recordingService.on('transcript-correction-completed', (payload) => {
    logger.info('[TRANSCRIPT-CORRECTION] completed', {
      meetingId: payload?.meetingId
    });
    if (mainWindow) {
      mainWindow.webContents.send('transcript-correction-completed', payload);
    }
  });

  recordingService.on('transcript-correction-failed', (payload) => {
    logger.warn('[TRANSCRIPT-CORRECTION] failed', {
      meetingId: payload?.meetingId,
      error: payload?.error
    });
    if (mainWindow) {
      mainWindow.webContents.send('transcript-correction-failed', payload);
    }
  });

  // Initialize SDK in background (this can take 75+ seconds)
  initializeSDKInBackground();
  
  // Set app to start on boot if configured
  app.setLoginItemSettings({
    openAtLogin: settingsService.getSettings()?.autoStartOnBoot || false,
  });
  
  // Set up periodic sync every 10 minutes (only 7 days ahead for efficiency)
  setInterval(async () => {
    if (settingsService.getSettings()?.googleCalendarConnected && calendarService.isAuthenticated()) {
      console.log('Running periodic calendar sync...');
      try {
        // Periodic syncs only fetch 7 days ahead to reduce load
        await syncCalendarSilently(7);
      } catch (error) {
        console.error('Periodic sync failed:', error);
      }
    }
  }, 10 * 60 * 1000); // 10 minutes

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
  } catch (error) {
    logger.error('[APP-INIT-ERROR] Fatal error during app initialization', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined,
      timestamp: new Date().toISOString()
    });

    // Try to save any pending data before potential crash
    if (storageService) {
      try {
        logger.info('[APP-INIT-ERROR] Attempting emergency save...');
        await storageService.forceSave();
        logger.info('[APP-INIT-ERROR] Emergency save completed');
      } catch (saveError) {
        logger.error('[APP-INIT-ERROR] Emergency save failed:', saveError);
      }
    }

    // Show error dialog to user
    const { dialog } = require('electron');
    dialog.showErrorBox('Application Error',
      'Failed to initialize the application. Please check the logs and restart.');

    // Re-throw to let Electron handle it
    throw error;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  logger.info('[APP] Application quitting, cleaning up services...');

  // Clean up services
  if (meetingDetectionService) {
    await meetingDetectionService.stopMonitoring();
  }
  if (recordingService) {
    await recordingService.stopRecording();
  }
});

// Set app to start on boot if configured - will be set after initialization