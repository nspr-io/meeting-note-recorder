#!/usr/bin/env node

/**
 * Script to add comprehensive logging throughout the meeting-note-recorder application
 * This will help track user journeys and debug issues
 */

const fs = require('fs');
const path = require('path');

// Define logging enhancements for each file
const loggingEnhancements = [
  {
    file: 'src/main/index.ts',
    replacements: [
      // IPC Handlers - Add detailed journey logging
      {
        search: /ipcMain\.handle\(IpcChannels\.CREATE_MEETING, async \(_, meetingData\) => \{/,
        replace: `ipcMain.handle(IpcChannels.CREATE_MEETING, async (_, meetingData) => {
    logger.info('[USER-JOURNEY] CREATE_MEETING requested', {
      title: meetingData.title,
      platform: meetingData.platform,
      hasUrl: !!meetingData.meetingUrl,
      timestamp: new Date().toISOString()
    });`
      },
      {
        search: /const meeting = await storageService\.createMeeting\(meetingData\);/,
        replace: `const startTime = Date.now();
    const meeting = await storageService.createMeeting(meetingData);
    logger.info('[USER-JOURNEY] CREATE_MEETING completed', {
      meetingId: meeting.id,
      durationMs: Date.now() - startTime
    });`
      },
      {
        search: /ipcMain\.handle\(IpcChannels\.SEARCH_MEETINGS, async \(_, query: string\) => \{/,
        replace: `ipcMain.handle(IpcChannels.SEARCH_MEETINGS, async (_, query: string) => {
    logger.info('[USER-JOURNEY] SEARCH_MEETINGS requested', {
      query,
      queryLength: query.length,
      timestamp: new Date().toISOString()
    });`
      },
      {
        search: /const results = searchService\.search\(query\);/,
        replace: `const searchStart = Date.now();
    const results = searchService.search(query);
    logger.info('[USER-JOURNEY] SEARCH_MEETINGS completed', {
      query,
      resultsCount: results.length,
      searchDurationMs: Date.now() - searchStart
    });`
      },
      {
        search: /ipcMain\.handle\(IpcChannels\.GET_RECORDING_STATE, async \(\) => \{/,
        replace: `ipcMain.handle(IpcChannels.GET_RECORDING_STATE, async () => {
    const state = recordingService.getRecordingState();
    logger.debug('[STATE-CHECK] Recording state requested', {
      isRecording: state.isRecording,
      meetingId: state.meetingId,
      connectionStatus: state.connectionStatus
    });`
      },
      {
        search: /ipcMain\.handle\(IpcChannels\.SYNC_CALENDAR, async \(\) => \{/,
        replace: `ipcMain.handle(IpcChannels.SYNC_CALENDAR, async () => {
    logger.info('[USER-JOURNEY] SYNC_CALENDAR requested', {
      isAuthenticated: calendarService.isAuthenticated(),
      timestamp: new Date().toISOString()
    });`
      }
    ]
  },
  {
    file: 'src/main/services/MeetingDetectionService.ts',
    replacements: [
      {
        search: /async startMonitoring\(\): Promise<void> \{/,
        replace: `async startMonitoring(): Promise<void> {
    logger.info('[DETECTION] Starting meeting monitoring', {
      timestamp: new Date().toISOString()
    });`
      },
      {
        search: /private async findMatchingCalendarEvent\(detectedMeeting: MeetingDetectedEvent\)/,
        replace: `private async findMatchingCalendarEvent(detectedMeeting: MeetingDetectedEvent) {
    logger.debug('[DETECTION] Finding matching calendar event', {
      platform: detectedMeeting.platform,
      title: detectedMeeting.meetingTitle,
      windowId: detectedMeeting.windowId
    });`
      },
      {
        search: /async createManualMeeting\(title: string\): Promise<Meeting> \{/,
        replace: `async createManualMeeting(title: string): Promise<Meeting> {
    logger.info('[DETECTION] Creating manual meeting', {
      title,
      timestamp: new Date().toISOString()
    });`
      },
      {
        search: /async handleToastAction\(action: string, meetingId: string\)/,
        replace: `async handleToastAction(action: string, meetingId: string) {
    logger.info('[DETECTION] Handling toast action', {
      action,
      meetingId,
      timestamp: new Date().toISOString()
    });`
      }
    ]
  },
  {
    file: 'src/main/services/StorageService.ts',
    replacements: [
      {
        search: /async saveMeeting\(meeting: Meeting\): Promise<void> \{/,
        replace: `async saveMeeting(meeting: Meeting): Promise<void> {
    logger.info('[STORAGE] Saving meeting', {
      meetingId: meeting.id,
      title: meeting.title,
      hasNotes: !!meeting.notes,
      hasTranscript: !!meeting.transcript,
      timestamp: new Date().toISOString()
    });`
      },
      {
        search: /async updateMeeting\(id: string, updates: Partial<Meeting>\)/,
        replace: `async updateMeeting(id: string, updates: Partial<Meeting>) {
    logger.info('[STORAGE] Updating meeting', {
      meetingId: id,
      fieldsUpdated: Object.keys(updates),
      hasNotes: !!updates.notes,
      hasTranscript: !!updates.transcript,
      timestamp: new Date().toISOString()
    });`
      },
      {
        search: /async deleteMeeting\(id: string\): Promise<void> \{/,
        replace: `async deleteMeeting(id: string): Promise<void> {
    logger.info('[STORAGE] Deleting meeting', {
      meetingId: id,
      timestamp: new Date().toISOString()
    });`
      },
      {
        search: /async appendTranscript\(meetingId: string, chunk: TranscriptChunk\)/,
        replace: `async appendTranscript(meetingId: string, chunk: TranscriptChunk) {
    logger.debug('[STORAGE] Appending transcript chunk', {
      meetingId,
      speaker: chunk.speaker,
      textLength: chunk.text.length,
      timestamp: chunk.timestamp
    });`
      },
      {
        search: /startAutoSave\(meetingId: string/,
        replace: `startAutoSave(meetingId: string) {
    logger.info('[STORAGE] Starting auto-save', {
      meetingId,
      interval: 10000
    });`
      },
      {
        search: /stopAutoSave\(meetingId: string\)/,
        replace: `stopAutoSave(meetingId: string) {
    logger.info('[STORAGE] Stopping auto-save', {
      meetingId
    });`
      }
    ]
  },
  {
    file: 'src/main/services/CalendarService.ts',
    replacements: [
      {
        search: /async authenticate\(\): Promise<void> \{/,
        replace: `async authenticate(): Promise<void> {
    logger.info('[CALENDAR] Starting authentication', {
      timestamp: new Date().toISOString()
    });`
      },
      {
        search: /async fetchUpcomingMeetings\(\): Promise<CalendarEvent\[\]> \{/,
        replace: `async fetchUpcomingMeetings(): Promise<CalendarEvent[]> {
    logger.info('[CALENDAR] Fetching upcoming meetings', {
      isAuthenticated: this.isAuthenticated(),
      timestamp: new Date().toISOString()
    });`
      },
      {
        search: /const response = await this\.calendar\.events\.list\(/,
        replace: `logger.info('[CALENDAR] Requesting events from Google Calendar', {
      timeMin: now.toISOString(),
      timeMax: thirtyDaysFromNow.toISOString()
    });
    const response = await this.calendar.events.list(`
      },
      {
        search: /private async refreshTokenIfNeeded\(\): Promise<void> \{/,
        replace: `private async refreshTokenIfNeeded(): Promise<void> {
    const tokens = this.tokenStore.get('tokens') || {};
    if (tokens.expiry_date && tokens.expiry_date <= Date.now()) {
      logger.info('[CALENDAR] Token expired, refreshing', {
        expiryDate: new Date(tokens.expiry_date)
      });
    }`
      }
    ]
  },
  {
    file: 'src/main/services/RecallApiService.ts',
    replacements: [
      {
        search: /async createSdkUpload\(meetingId: string, meetingTitle: string\)/,
        replace: `async createSdkUpload(meetingId: string, meetingTitle: string) {
    logger.info('[API] Creating SDK upload', {
      meetingId,
      meetingTitle,
      apiUrl: this.apiUrl,
      timestamp: new Date().toISOString()
    });`
      },
      {
        search: /response = await this\.retryApiCall\(/,
        replace: `logger.debug('[API] Making API request', {
      operation: 'Create SDK Upload',
      provider: 'deepgram_streaming'
    });
    response = await this.retryApiCall(`
      },
      {
        search: /async getSdkUploadStatus\(uploadId: string\)/,
        replace: `async getSdkUploadStatus(uploadId: string) {
    logger.debug('[API] Getting upload status', {
      uploadId,
      timestamp: new Date().toISOString()
    });`
      },
      {
        search: /async getTranscript\(recordingId: string\)/,
        replace: `async getTranscript(recordingId: string) {
    logger.info('[API] Fetching transcript', {
      recordingId,
      apiUrl: this.apiUrl,
      timestamp: new Date().toISOString()
    });`
      }
    ]
  },
  {
    file: 'src/main/services/SettingsService.ts',
    replacements: [
      {
        search: /async updateSettings\(updates: Partial<AppSettings>\)/,
        replace: `async updateSettings(updates: Partial<AppSettings>) {
    logger.info('[SETTINGS] Updating settings', {
      fieldsUpdated: Object.keys(updates),
      hasApiKey: !!updates.recallApiKey,
      hasApiUrl: !!updates.recallApiUrl,
      timestamp: new Date().toISOString()
    });`
      },
      {
        search: /async initialize\(\): Promise<void> \{/,
        replace: `async initialize(): Promise<void> {
    logger.info('[SETTINGS] Initializing settings service', {
      timestamp: new Date().toISOString()
    });`
      }
    ]
  }
];

// Function to apply replacements to a file
function enhanceLogging(filePath, replacements) {
  console.log(`Enhancing logging in ${filePath}...`);

  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;

    replacements.forEach(({ search, replace }) => {
      if (search instanceof RegExp) {
        if (content.match(search)) {
          content = content.replace(search, replace);
          modified = true;
          console.log(`  ✓ Applied regex replacement`);
        }
      } else {
        if (content.includes(search)) {
          content = content.replace(search, replace);
          modified = true;
          console.log(`  ✓ Applied string replacement`);
        }
      }
    });

    if (modified) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`  ✅ Enhanced logging in ${path.basename(filePath)}`);
    } else {
      console.log(`  ℹ️ No changes needed in ${path.basename(filePath)}`);
    }
  } catch (error) {
    console.error(`  ❌ Error processing ${filePath}:`, error.message);
  }
}

// Main execution
console.log('Adding comprehensive logging to meeting-note-recorder...\n');

loggingEnhancements.forEach(({ file, replacements }) => {
  const fullPath = path.join(__dirname, file);
  enhanceLogging(fullPath, replacements);
});

console.log('\n✨ Logging enhancement complete!');
console.log('Note: This script adds basic logging. You may need to manually add more specific logs for edge cases.');