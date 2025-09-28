import { app, BrowserWindow, ipcMain, dialog, Notification, shell } from 'electron';
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
import { SearchService } from './services/SearchService';
import { PromptService } from './services/PromptService';
import { IpcChannels, Meeting, UserProfile, SearchOptions } from '../shared/types';

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
    promise: promise,
    reason: reason,
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
let meetingDetectionService: MeetingDetectionService;
let recordingService: RecordingService;
let storageService: StorageService;
let calendarService: CalendarService;
let settingsService: SettingsService;
let permissionService: PermissionService;
let searchService: SearchService;
let promptService: PromptService | null = null;
let currentRecordingMeetingId: string | null = null;

function createWindow() {
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

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:9000');
    mainWindow.webContents.openDevTools();
  } else {
    const indexPath = path.join(__dirname, '../renderer/index.html');
    console.log('Loading index.html from:', indexPath);
    mainWindow.loadFile(indexPath).catch((err) => {
      console.error('Failed to load index.html:', err);
    });
  }

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
  });

  mainWindow.webContents.on('dom-ready', () => {
    console.log('DOM is ready');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function setupIpcHandlers() {
  // Settings
  ipcMain.handle(IpcChannels.GET_SETTINGS, async () => {
    return settingsService.getSettings();
  });

  ipcMain.handle(IpcChannels.UPDATE_SETTINGS, async (_, settings) => {
    await settingsService.updateSettings(settings);
    if (mainWindow) {
      mainWindow.webContents.send(IpcChannels.SETTINGS_UPDATED, settings);
    }
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
    return promptService.getAllPrompts();
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
    
    logger.debug('Getting meetings', { total: meetings.length, returned: recentMeetings.length });
    return recentMeetings;
  });

  ipcMain.handle(IpcChannels.CREATE_MEETING, async (_, meeting: Partial<Meeting>) => {
    const newMeeting = await storageService.createMeeting(meeting);
    // Update search index
    const allMeetings = await storageService.getAllMeetings();
    searchService.updateIndex(allMeetings);
    if (mainWindow) {
      mainWindow.webContents.send(IpcChannels.MEETINGS_UPDATED);
    }
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
        const correctedTranscript = await correctionService.correctTranscript(meeting.transcript, meetingId);

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
        return { success: false, error: 'Insights generation service not available. Please check your Anthropic API key in settings.' };
      }

      try {
        // Get user profile to personalize insights
        const userProfile = settingsService.getProfile();

        // Generate insights with profile context
        const insights = await insightsService.generateInsights(meeting, userProfile);

        // Update the meeting with insights
        await storageService.updateMeeting(meetingId, { insights });

        return { success: true, insights };
      } catch (error) {
        throw error;
      }
    } catch (error: any) {
      logger.error('Failed to generate insights:', error);
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
      console.log('Starting smart calendar sync...');
      const events = await calendarService.fetchUpcomingMeetings();
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
      logger.error(`Failed to open external URL: ${url}`);
      return { success: false, error: 'Failed to open URL' };
    }
  });

  // Get log file path (for debugging)
  ipcMain.handle('get-log-path', async () => {
    return logger.getLatestLogPath();
  });
  
  // Permission status
  ipcMain.handle('get-permission-status', async () => {
    return permissionService.getPermissionStatus();
  });

  ipcMain.handle('check-permissions', async () => {
    return await permissionService.checkAllPermissions();
  });

  ipcMain.handle('request-permissions', async () => {
    await permissionService.showPermissionDialog();
    return { success: true };
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
}

// Helper function to find scheduled meetings that match the current time
async function findMatchingScheduledMeeting(detectedTitle?: string): Promise<Meeting | null> {
  try {
    const now = new Date();
    const meetings = await storageService.getAllMeetings();

    // Look for meetings starting within the next 3 minutes OR already ongoing
    const matchingMeetings = meetings.filter((meeting: Meeting) => {
      if (meeting.status !== 'scheduled') return false;

      const meetingStartTime = new Date(meeting.date);
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
      return matchingMeetings.sort((a: Meeting, b: Meeting) =>
        new Date(a.date).getTime() - new Date(b.date).getTime()
      )[0];
    }

    return null;
  } catch (error) {
    logger.error('Error finding matching scheduled meeting:', error);
    return null;
  }
}

function setupMeetingDetectionHandlers() {
  meetingDetectionService.on('meeting-detected', async (data) => {
    logger.info('[JOURNEY-8] Meeting detected event received in main process', {
      windowId: data.windowId,
      platform: data.platform,
      title: data.meetingTitle,
      hasSuggested: !!data.suggestedMeeting,
      currentlyRecording: !!currentRecordingMeetingId,
      timestamp: new Date().toISOString()
    });

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

    // Determine notification content based on whether we found a match
    const notificationTitle = matchedMeeting
      ? `Meeting: ${matchedMeeting.title}`
      : `Meeting Detected: ${data.meetingTitle || 'Unknown'}`;

    const notificationBody = 'Start Recording';

    // Show notification with longer timeout and single button (no actions array = simple click notification)
    const notification = new Notification({
      title: notificationTitle,
      body: notificationBody,
      silent: false,
      timeoutType: 'never', // Keep notification visible longer
      urgency: 'normal'
    });

    // Handle notification click (single button - Start Recording)
    notification.on('click', async () => {
      logger.info('[JOURNEY-9] Notification clicked - Start Recording', {
        hasMatchedMeeting: !!matchedMeeting,
        matchedMeetingTitle: matchedMeeting?.title,
        windowId: data.windowId,
        timestamp: new Date().toISOString()
      });

      try {
        let meetingToRecord = matchedMeeting;

        if (matchedMeeting) {
          // Use the matched scheduled meeting
          logger.info('[JOURNEY-9a] Using matched scheduled meeting', {
            meetingId: matchedMeeting.id,
            title: matchedMeeting.title
          });

          // First check if the meeting actually exists in storage
          try {
            const existingMeeting = await storageService.getMeeting(matchedMeeting.id);
            if (existingMeeting) {
              // Update the existing meeting status to recording
              await storageService.updateMeeting(matchedMeeting.id, {
                status: 'recording',
                startTime: new Date(),
                platform: data.platform as Meeting['platform']
              });
              meetingToRecord = await storageService.getMeeting(matchedMeeting.id);
            } else {
              throw new Error('Meeting not found in storage');
            }
          } catch (error) {
            // Meeting doesn't exist in storage, create it
            logger.info('[JOURNEY-9a-fallback] Meeting not in storage, creating new', {
              calendarEventId: matchedMeeting.id,
              title: matchedMeeting.title
            });

            meetingToRecord = await storageService.createMeeting({
              title: matchedMeeting.title || data.meetingTitle || 'Untitled Meeting',
              date: matchedMeeting.date || new Date(),
              status: 'recording',
              startTime: new Date(),
              platform: data.platform as Meeting['platform'],
              calendarEventId: matchedMeeting.calendarEventId || matchedMeeting.id,
              meetingUrl: matchedMeeting.meetingUrl,
              calendarInviteUrl: matchedMeeting.calendarInviteUrl,
              attendees: matchedMeeting.attendees || [],
              notes: matchedMeeting.notes || '',
              transcript: ''
            });
          }
        } else {
          // Create new meeting for recording
          logger.info('[JOURNEY-9b] Creating new meeting for recording', {
            title: data.meetingTitle || 'Untitled Meeting',
            windowId: data.windowId
          });

          try {
            logger.info('[JOURNEY-9b-pre-create] About to call storageService.createMeeting');

            meetingToRecord = await storageService.createMeeting({
              title: data.meetingTitle || 'Untitled Meeting',
              date: new Date(),
              status: 'recording',
              startTime: new Date(),
              platform: data.platform as Meeting['platform'],
              notes: '',
              transcript: ''
            });

            logger.info('[JOURNEY-9c] New meeting created successfully', {
              meetingId: meetingToRecord.id,
              title: meetingToRecord.title,
              status: meetingToRecord.status
            });

            // Force save immediately after creation
            logger.info('[JOURNEY-9c-force-save] Forcing cache save after meeting creation');
            try {
              await storageService.forceSave();
              logger.info('[JOURNEY-9c-force-save-success] Cache saved successfully');
            } catch (saveError) {
              logger.error('[JOURNEY-9c-force-save-error] Failed to force save cache', {
                error: saveError instanceof Error ? saveError.message : String(saveError),
                stack: saveError instanceof Error ? saveError.stack : undefined
              });
            }
          } catch (createError) {
            logger.error('[JOURNEY-9b-ERROR] Failed to create meeting', {
              error: createError instanceof Error ? createError.message : String(createError),
              stack: createError instanceof Error ? createError.stack : undefined,
              name: createError instanceof Error ? createError.name : undefined
            });
            throw createError;
          }
        }

        // Start recording with proper meeting ID
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

        await startRecordingOnly(meetingToRecord, '[JOURNEY-9d]');

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

        // Show error notification
        const errorNotification = new Notification({
          title: 'Recording Failed',
          body: 'Could not start recording. Please check the app.',
          urgency: 'critical'
        });
        errorNotification.show();
      }
    });

    notification.show();
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
    logger.info('[MEETING-REMINDER] Meeting reminder triggered', {
      title: event.title,
      start: event.start,
      minutesBeforeStart: Math.round((new Date(event.start).getTime() - Date.now()) / (1000 * 60))
    });

    const notification = new Notification({
      title: `Meeting starting soon: ${event.title}`,
      body: 'Click to start recording',
      timeoutType: 'never',
      urgency: 'normal'
    });

    notification.on('click', async () => {
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

        await startRecordingWithBrowserLaunch(meeting, '[MEETING-REMINDER]');
      } catch (error) {
        logger.error('[MEETING-REMINDER] Failed to start recording from reminder', {
          error: error instanceof Error ? error.message : String(error),
          eventId: event.id,
          title: event.title
        });

        const errorNotification = new Notification({
          title: 'Recording Failed',
          body: 'Could not start recording for the upcoming meeting',
          urgency: 'critical'
        });
        errorNotification.show();
      }
    });

    notification.show();
  });
}

// Helper function for reactive notifications - only start recording (no browser launch)
async function startRecordingOnly(meeting: Meeting, logPrefix: string): Promise<void> {
  await recordingService.startRecording(meeting.id);

  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send(IpcChannels.RECORDING_STARTED, { meetingId: meeting.id });
    mainWindow.webContents.send(IpcChannels.MEETINGS_UPDATED);
  }

  logger.info(`${logPrefix} Successfully started recording`, {
    meetingId: meeting.id,
    title: meeting.title
  });
}

// Helper function for proactive notifications - start recording AND launch browser
async function startRecordingWithBrowserLaunch(meeting: Meeting, logPrefix: string): Promise<void> {
  // Open meeting URL in default browser if available
  if (meeting.meetingUrl) {
    logger.info(`${logPrefix} Opening meeting URL in browser`, {
      url: meeting.meetingUrl,
      meetingTitle: meeting.title
    });
    try {
      await shell.openExternal(meeting.meetingUrl);
    } catch (urlError) {
      logger.warn(`${logPrefix} Failed to open meeting URL`, {
        url: meeting.meetingUrl,
        error: urlError instanceof Error ? urlError.message : String(urlError)
      });
    }
  }

  await recordingService.startRecording(meeting.id);

  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send(IpcChannels.RECORDING_STARTED, { meetingId: meeting.id });
    mainWindow.webContents.send(IpcChannels.MEETINGS_UPDATED);
  }

  logger.info(`${logPrefix} Successfully started recording with browser launch`, {
    meetingId: meeting.id,
    title: meeting.title
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
            await syncCalendarSilently();
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

async function syncCalendarSilently() {
  try {
    const events = await calendarService.fetchUpcomingMeetings();
    console.log(`Auto-sync: Found ${events.length} calendar events`);

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
    // Create window first so UI appears immediately
    createWindow();

    // Initialize basic services (fast) and setup IPC handlers immediately
    // so the UI can function while SDK initializes in background
    logger.info('Initializing core services...');

    // Initialize permission service first
    permissionService = new PermissionService();
    await permissionService.checkAllPermissions();

    settingsService = new SettingsService();
    await settingsService.initialize();

  try {
    logger.info('Creating PromptService instance...');
    promptService = new PromptService();
    logger.info('PromptService instance created, initializing...');
    await promptService.initialize();
    logger.info('Prompt service initialized successfully');
  } catch (error) {
    logger.error('FATAL: Failed to initialize PromptService:', error);
    // Continue without PromptService for now to avoid breaking the app
    promptService = null;
  }
  
  storageService = new StorageService(settingsService);
  await storageService.initialize();

  searchService = new SearchService();
  const meetings = await storageService.getAllMeetings();
  searchService.updateIndex(meetings);

  calendarService = new CalendarService();
  recordingService = new RecordingService(storageService, promptService);
  
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

  // Initialize SDK in background (this can take 75+ seconds)
  initializeSDKInBackground();
  
  // Set app to start on boot if configured
  app.setLoginItemSettings({
    openAtLogin: settingsService.getSettings()?.autoStartOnBoot || false,
  });
  
  // Set up periodic sync every 10 minutes
  setInterval(async () => {
    if (settingsService.getSettings()?.googleCalendarConnected && calendarService.isAuthenticated()) {
      console.log('Running periodic calendar sync...');
      try {
        await syncCalendarSilently();
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
  // Clean up services
  if (meetingDetectionService) {
    await meetingDetectionService.stopMonitoring();
  }
  if (recordingService) {
    await recordingService.stopRecording();
  }
});

// Set app to start on boot if configured - will be set after initialization