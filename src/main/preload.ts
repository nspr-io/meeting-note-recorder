import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels, Meeting, AppSettings, UserProfile, SearchOptions, CoachingType, NotionShareMode, CoachConfig } from '../shared/types';

const api = {
  // Settings
  getSettings: () => ipcRenderer.invoke(IpcChannels.GET_SETTINGS),
  updateSettings: (settings: Partial<AppSettings>) =>
    ipcRenderer.invoke(IpcChannels.UPDATE_SETTINGS, settings),

  // Profile
  getProfile: () => ipcRenderer.invoke(IpcChannels.GET_PROFILE),
  updateProfile: (profile: UserProfile) =>
    ipcRenderer.invoke(IpcChannels.UPDATE_PROFILE, profile),

  // Meetings
  getMeetings: () => ipcRenderer.invoke(IpcChannels.GET_MEETINGS),
  refreshMeeting: (meetingId: string) => ipcRenderer.invoke(IpcChannels.REFRESH_MEETING, meetingId),
  getRecordingState: () => ipcRenderer.invoke(IpcChannels.GET_RECORDING_STATE),
  createMeeting: (meeting: Partial<Meeting>) =>
    ipcRenderer.invoke(IpcChannels.CREATE_MEETING, meeting),
  updateMeeting: (id: string, updates: Partial<Meeting>) => 
    ipcRenderer.invoke(IpcChannels.UPDATE_MEETING, id, updates),
  deleteMeeting: (id: string) => 
    ipcRenderer.invoke(IpcChannels.DELETE_MEETING, id),
  
  // Recording
  startRecording: (meetingId: string) =>
    ipcRenderer.invoke(IpcChannels.START_RECORDING, meetingId),
  stopRecording: (meetingId?: string) =>
    ipcRenderer.invoke(IpcChannels.STOP_RECORDING, meetingId),
  correctTranscript: (meetingId: string) =>
    ipcRenderer.invoke(IpcChannels.CORRECT_TRANSCRIPT, meetingId),
  fetchFirefliesTranscript: (meetingId: string) =>
    ipcRenderer.invoke(IpcChannels.FETCH_FIREFLIES_TRANSCRIPT, meetingId),
  generateInsights: (meetingId: string) =>
    ipcRenderer.invoke(IpcChannels.GENERATE_INSIGHTS, meetingId),
  generateTeamSummary: (meetingId: string) =>
    ipcRenderer.invoke(IpcChannels.GENERATE_TEAM_SUMMARY, meetingId),
  shareToSlack: (data: { meetingId: string; content: string }) =>
    ipcRenderer.invoke(IpcChannels.SHARE_TO_SLACK, data),
  shareToNotion: (data: { meetingId: string; mode: NotionShareMode }) =>
    ipcRenderer.invoke(IpcChannels.SHARE_TO_NOTION, data),
  sendNotionActionItems: (meetingId: string) =>
    ipcRenderer.invoke(IpcChannels.SEND_NOTION_ACTION_ITEMS, meetingId),
  sendSingleNotionActionItem: (data: { meetingId: string; item: { insightIndex?: number; task?: string; owner?: string; due?: string } }) =>
    ipcRenderer.invoke(IpcChannels.SEND_SINGLE_NOTION_ACTION_ITEM, data),

  // Calendar
  connectCalendar: () => 
    ipcRenderer.invoke(IpcChannels.CONNECT_CALENDAR),
  disconnectCalendar: () => 
    ipcRenderer.invoke(IpcChannels.DISCONNECT_CALENDAR),
  syncCalendar: () => 
    ipcRenderer.invoke(IpcChannels.SYNC_CALENDAR),
  
  // Storage
  selectStoragePath: () =>
    ipcRenderer.invoke(IpcChannels.SELECT_STORAGE_PATH),
  selectFilePath: () =>
    ipcRenderer.invoke(IpcChannels.SELECT_FILE_PATH),
  openMeetingFile: (meetingId: string) =>
    ipcRenderer.invoke(IpcChannels.OPEN_MEETING_FILE, meetingId),
  showInFinder: (filePath: string) =>
    ipcRenderer.invoke(IpcChannels.SHOW_IN_FINDER, filePath),
  openExternal: (url: string) =>
    ipcRenderer.invoke(IpcChannels.OPEN_EXTERNAL, url),
  joinMeetingWithIntent: (url: string) =>
    ipcRenderer.invoke('join-meeting-with-intent', url),

  // Search
  searchMeetings: (options: SearchOptions) =>
    ipcRenderer.invoke(IpcChannels.SEARCH_MEETINGS, options),
  getSearchHistory: () =>
    ipcRenderer.invoke(IpcChannels.GET_SEARCH_HISTORY),
  clearSearchHistory: () =>
    ipcRenderer.invoke(IpcChannels.CLEAR_SEARCH_HISTORY),
  getTranscriptBuffer: (meetingId: string) =>
    ipcRenderer.invoke(IpcChannels.GET_TRANSCRIPT_BUFFER, meetingId),
  
  // System Prompts
  getPrompts: () =>
    ipcRenderer.invoke(IpcChannels.GET_PROMPTS),
  getPrompt: (promptId: string) =>
    ipcRenderer.invoke(IpcChannels.GET_PROMPT, promptId),
  updatePrompt: (data: { promptId: string; content: string }) =>
    ipcRenderer.invoke(IpcChannels.UPDATE_PROMPT, data),
  resetPrompt: (promptId: string) =>
    ipcRenderer.invoke(IpcChannels.RESET_PROMPT, promptId),

  // Coaches
  getCoaches: (): Promise<CoachConfig[]> =>
    ipcRenderer.invoke(IpcChannels.GET_COACHES),
  upsertCoach: (coach: CoachConfig & { promptContent?: string }) =>
    ipcRenderer.invoke(IpcChannels.UPSERT_COACH, coach),
  toggleCoach: (coachId: string, enabled: boolean) =>
    ipcRenderer.invoke(IpcChannels.TOGGLE_COACH, coachId, enabled),
  deleteCoach: (coachId: string) =>
    ipcRenderer.invoke(IpcChannels.DELETE_COACH, coachId),

  // Real-time coaching
  startCoaching: (meetingId: string, coachingType: CoachingType) =>
    ipcRenderer.invoke(IpcChannels.START_COACHING, meetingId, coachingType),
  stopCoaching: () =>
    ipcRenderer.invoke(IpcChannels.STOP_COACHING),
  updateCoachingNotes: (meetingId: string, notes: string) =>
    ipcRenderer.invoke(IpcChannels.UPDATE_COACHING_NOTES, meetingId, notes),
  getCoachingState: () =>
    ipcRenderer.invoke(IpcChannels.GET_COACHING_STATE),
  getCoachingFeedbackHistory: () =>
    ipcRenderer.invoke(IpcChannels.GET_COACHING_FEEDBACK),
  openCoachWindow: (meetingId?: string) =>
    ipcRenderer.invoke(IpcChannels.OPEN_COACH_WINDOW, meetingId || null),
  closeCoachWindow: () =>
    ipcRenderer.invoke(IpcChannels.CLOSE_COACH_WINDOW),
  getCoachWindowStatus: () =>
    ipcRenderer.invoke(IpcChannels.GET_COACH_WINDOW_STATUS),

  // Permissions
  getPermissionStatus: () =>
    ipcRenderer.invoke('get-permission-status'),
  checkPermissions: () =>
    ipcRenderer.invoke('check-permissions'),
  requestPermissions: () =>
    ipcRenderer.invoke('request-permissions'),
  
  // Event listeners - Fixed to properly handle listener removal
  on: (channel: string, callback: Function) => {
    const validChannels = [
      IpcChannels.MEETING_DETECTED,
      IpcChannels.RECORDING_STARTED,
      IpcChannels.RECORDING_STOPPED,
      IpcChannels.TRANSCRIPT_UPDATE,
      IpcChannels.CONNECTION_STATUS,
      IpcChannels.SETTINGS_UPDATED,
      IpcChannels.MEETINGS_UPDATED,
      IpcChannels.ERROR_OCCURRED,
      IpcChannels.SEARCH_RESULTS,
      IpcChannels.COACHING_FEEDBACK,
      IpcChannels.COACHING_ERROR,
      IpcChannels.COACH_WINDOW_STATUS,
      IpcChannels.FETCH_FIREFLIES_TRANSCRIPT,
      'correction-progress',
      'correction-completed',
      'transcript-correction-started',
      'transcript-correction-progress',
      'transcript-correction-completed',
      'transcript-correction-failed',
    ];

    if (validChannels.includes(channel as any)) {
      // Create a wrapper function that we can reference for removal
      const wrapper = (_: any, ...args: any[]) => callback(...args);
      // Store the wrapper on the callback so we can remove it later
      (callback as any).__ipcWrapper = wrapper;
      ipcRenderer.on(channel, wrapper);
    }
  },

  removeListener: (channel: string, callback: Function) => {
    // Remove using the stored wrapper function
    const wrapper = (callback as any).__ipcWrapper;
    if (wrapper) {
      ipcRenderer.removeListener(channel, wrapper);
      delete (callback as any).__ipcWrapper;
    }
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;