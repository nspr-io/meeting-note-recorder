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
import { IpcChannels, Meeting, UserProfile, SearchOptions } from '../shared/types';

const logger = getLogger();

let mainWindow: BrowserWindow | null = null;
let meetingDetectionService: MeetingDetectionService;
let recordingService: RecordingService;
let storageService: StorageService;
let calendarService: CalendarService;
let settingsService: SettingsService;
let permissionService: PermissionService;
let searchService: SearchService;
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

async function initializeServices() {
  logger.info('Initializing services...');
  
  // Initialize permission service first
  permissionService = new PermissionService();
  const permissionStatus = await permissionService.checkAllPermissions();
  logger.info('Permission status', permissionStatus);
  
  // Don't automatically request permissions on startup - let user do it manually
  // or wait until they try to record
  const hasRequiredPermissions = await permissionService.hasRequiredPermissions();
  if (!hasRequiredPermissions) {
    logger.info('Some permissions missing - user can grant them via Settings or when starting recording');
  }
  
  settingsService = new SettingsService();
  await settingsService.initialize();
  logger.info('Settings service initialized', settingsService.getSettings());

  storageService = new StorageService(settingsService);
  await storageService.initialize();

  searchService = new SearchService();
  const meetings = await storageService.getAllMeetings();
  searchService.updateIndex(meetings);

  calendarService = new CalendarService();

  recordingService = new RecordingService(storageService);
  
  // Initialize recording service with API key and URL from settings
  const settings = settingsService.getSettings();
  if (settings.recallApiKey) {
    // Force us-west-2 region for the API
    const apiUrl = 'https://us-west-2.recall.ai';
    await recordingService.initialize(settings.recallApiKey, apiUrl, settings.anthropicApiKey);
  } else {
    logger.warn('No Recall API key found in settings');
  }
  
  meetingDetectionService = new MeetingDetectionService(
    settingsService,
    recordingService,
    storageService,
    calendarService
  );

  // Listen for auto-stop recording events from the RecordingService
  recordingService.on('recording-auto-stopped', async () => {
    logger.info('Recording auto-stopped by SDK (meeting closed)');
    const meetingId = currentRecordingMeetingId;
    currentRecordingMeetingId = null;

    if (meetingId) {
      // Update meeting status to completed
      await storageService.updateMeeting(meetingId, { status: 'completed' });

      if (mainWindow) {
        mainWindow.webContents.send(IpcChannels.RECORDING_STOPPED);
        mainWindow.webContents.send(IpcChannels.MEETINGS_UPDATED);
      }
    }
  });

  // IMPORTANT: Register event listener BEFORE starting monitoring
  // Otherwise we miss events that fire during initialization
  logger.info('Registering meeting detection event listener');
  meetingDetectionService.on('meeting-detected', async (event) => {
      logger.info('🔔 [JOURNEY-START] Meeting detected event received', {
        event: JSON.stringify(event, null, 2)
      });
      // Extract proper meeting title from various sources
      const meetingTitle = event.meetingTitle || 
                          event.suggestedMeeting?.title || 
                          `${event.platform.charAt(0).toUpperCase() + event.platform.slice(1)} Meeting`;
      
      logger.info('🔔 Meeting detected, preparing notification', {
        title: meetingTitle,
        platform: event.platform,
        windowId: event.windowId,
        fullEvent: event
      });
      
      // Store the window ID for recording
      if (event.windowId) {
        recordingService.setCurrentWindow(event.windowId);
        logger.info('Set current window for recording', { windowId: event.windowId });
      }
      
      // Create notification - just title and body, no actions to avoid dropdown
      const notification = new Notification({
        title: `Meeting: ${meetingTitle}`,
        body: `Click to start recording`,
        silent: false
      });
      
      // Handle click on notification body  
      notification.on('click', async () => {
        logger.info('👆 [JOURNEY-NOTIFICATION-CLICKED] User clicked notification', { 
          title: meetingTitle,
          windowId: event.windowId 
        });
        
        try {
          // Create meeting with proper title
          logger.info('📝 [JOURNEY-CREATING-MEETING] Creating new meeting...');
          const meeting = await storageService.createMeeting({
            title: meetingTitle,
            platform: event.platform,
            status: 'active'
          });
          
          logger.info('✅ [JOURNEY-MEETING-CREATED] Meeting created successfully', {
            meeting: JSON.stringify(meeting, null, 2)
          });
          
          // Start recording (windowId already set above)
          logger.info('🎬 [JOURNEY-START-RECORDING] Starting SDK recording...');
          await recordingService.startRecording(meeting.id);
          logger.info('✅ [JOURNEY-RECORDING-STARTED] Recording started');
          
          logger.info('Recording started, updating UI');

          // Set the current recording meeting ID
          currentRecordingMeetingId = meeting.id;

          if (mainWindow) {
            // Show and focus the window
            mainWindow.show();
            mainWindow.focus();

            // Send the complete meeting object along with the recording started event
            // This ensures the UI has all the data it needs immediately
            logger.info('📨 [JOURNEY-SEND-TO-UI] Sending RECORDING_STARTED event to renderer', {
              meetingId: meeting.id,
              hasWindow: !!mainWindow
            });
            mainWindow.webContents.send(IpcChannels.RECORDING_STARTED, {
              meetingId: meeting.id,
              meeting: meeting,  // Send the full meeting object
              title: meetingTitle
            });

            // Also update the meetings list
            logger.info('📨 [JOURNEY-SEND-TO-UI] Sending MEETINGS_UPDATED event');
            mainWindow.webContents.send(IpcChannels.MEETINGS_UPDATED);

            logger.info('Meeting opened in UI', { meetingId: meeting.id });
          }
        } catch (error) {
          logger.error('Failed to start recording from notification', { error, title: meetingTitle });
          
          // Show error notification
          const errorNotification = new Notification({
            title: 'Recording Failed',
            body: 'Could not start recording. Please check logs.'
          });
          errorNotification.show();
        }
      });
      
      notification.show();
      logger.info('Notification shown', { title: meetingTitle });
      
      // Also notify the renderer
      if (mainWindow) {
        mainWindow.webContents.send(IpcChannels.MEETING_DETECTED, event);
      }
    });

  // Now actually START the meeting detection service
  try {
    await meetingDetectionService.startMonitoring();
    logger.info('Meeting detection service started successfully');
  } catch (error) {
    logger.error('Failed to start meeting detection service', error);
  }
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
      await recordingService.startRecording(meetingId);
      currentRecordingMeetingId = meetingId;
      
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

  ipcMain.handle(IpcChannels.STOP_RECORDING, async () => {
    logger.info('Stop recording requested');
    try {
      const meetingId = currentRecordingMeetingId;
      await recordingService.stopRecording();
      currentRecordingMeetingId = null;
      
      if (meetingId) {
        // Update meeting status to completed
        await storageService.updateMeeting(meetingId, { status: 'completed' });
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
      timestamp: new Date().toISOString()
    });

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

          // Update the meeting status to recording
          await storageService.updateMeeting(matchedMeeting.id, {
            status: 'recording',
            startTime: new Date(),
            platform: data.platform as Meeting['platform']
          });

          // Get the updated meeting
          meetingToRecord = await storageService.getMeeting(matchedMeeting.id);
        } else {
          // Create new meeting for recording
          logger.info('[JOURNEY-9b] Creating new meeting for recording', {
            title: data.meetingTitle || 'Untitled Meeting',
            windowId: data.windowId
          });

          meetingToRecord = await storageService.createMeeting({
            title: data.meetingTitle || 'Untitled Meeting',
            date: new Date(),
            status: 'recording',
            startTime: new Date(),
            platform: data.platform as Meeting['platform'],
            notes: '',
            transcript: ''
          });

          logger.info('[JOURNEY-9c] New meeting created', {
            meetingId: meetingToRecord.id,
            title: meetingToRecord.title,
            status: meetingToRecord.status
          });
        }

        // Start recording with proper meeting ID
        logger.info('[JOURNEY-9d] About to start recording', {
          meetingId: meetingToRecord.id,
          meetingTitle: meetingToRecord.title,
          meetingStatus: meetingToRecord.status
        });

        await recordingService.startRecording(meetingToRecord.id);

        // Verify recording state
        const recordingState = recordingService.getRecordingState();
        logger.info('[JOURNEY-9d-verify] Recording started and verified', {
          requestedMeetingId: meetingToRecord.id,
          recordingMeetingId: recordingState?.meetingId,
          isRecording: recordingState?.isRecording,
          matchesRequested: recordingState?.meetingId === meetingToRecord.id
        });

        if (recordingState?.meetingId !== meetingToRecord.id) {
          logger.error('[JOURNEY-9d-ERROR] Recording meeting ID mismatch!', {
            expected: meetingToRecord.id,
            actual: recordingState?.meetingId
          });
        }

        // Show the app and navigate to the recording meeting
        if (mainWindow) {
          logger.info('[JOURNEY-9e] Opening app to recording meeting', {
            meetingId: meetingToRecord.id,
            title: meetingToRecord.title,
            recordingMeetingId: recordingState?.meetingId
          });

          // Show and focus the window
          mainWindow.show();
          mainWindow.focus();

          // Send the meeting to the UI with explicit recording confirmation
          mainWindow.webContents.send(IpcChannels.RECORDING_STARTED, {
            meetingId: meetingToRecord.id,
            meeting: meetingToRecord,
            title: meetingToRecord.title,
            recordingState: recordingState
          });

          mainWindow.webContents.send(IpcChannels.MEETINGS_UPDATED);

          logger.info('[JOURNEY-9f] App opened successfully to recording meeting', {
            sentMeetingId: meetingToRecord.id,
            recordingActive: recordingState?.isRecording
          });
        }

      } catch (error) {
        logger.error('[JOURNEY-9-ERROR] Failed to start recording from notification', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          windowId: data.windowId
        });

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
}

// Helper function for silent calendar sync
async function initializeSDKInBackground() {
  // Initialize SDK asynchronously without blocking the UI
  logger.info('Starting SDK initialization in background...');
  
  const settings = settingsService.getSettings();
  if (settings.recallApiKey) {
    const apiUrl = 'https://us-west-2.recall.ai';
    
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
  
  storageService = new StorageService(settingsService);
  await storageService.initialize();

  searchService = new SearchService();
  const meetings = await storageService.getAllMeetings();
  searchService.updateIndex(meetings);

  calendarService = new CalendarService();
  recordingService = new RecordingService(storageService);
  
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