import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels, Meeting, AppSettings, UserProfile, SearchOptions } from '../shared/types';

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
  generateInsights: (meetingId: string) =>
    ipcRenderer.invoke(IpcChannels.GENERATE_INSIGHTS, meetingId),
  generateTeamSummary: (meetingId: string) =>
    ipcRenderer.invoke(IpcChannels.GENERATE_TEAM_SUMMARY, meetingId),
  shareToSlack: (data: { meetingId: string; content: string }) =>
    ipcRenderer.invoke(IpcChannels.SHARE_TO_SLACK, data),

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
  openMeetingFile: (meetingId: string) =>
    ipcRenderer.invoke(IpcChannels.OPEN_MEETING_FILE, meetingId),
  showInFinder: (filePath: string) =>
    ipcRenderer.invoke(IpcChannels.SHOW_IN_FINDER, filePath),
  openExternal: (url: string) =>
    ipcRenderer.invoke(IpcChannels.OPEN_EXTERNAL, url),

  // Search
  searchMeetings: (options: SearchOptions) =>
    ipcRenderer.invoke(IpcChannels.SEARCH_MEETINGS, options),
  getSearchHistory: () =>
    ipcRenderer.invoke(IpcChannels.GET_SEARCH_HISTORY),
  clearSearchHistory: () =>
    ipcRenderer.invoke(IpcChannels.CLEAR_SEARCH_HISTORY),
  
  // System Prompts
  getPrompts: () =>
    ipcRenderer.invoke(IpcChannels.GET_PROMPTS),
  getPrompt: (promptId: string) =>
    ipcRenderer.invoke(IpcChannels.GET_PROMPT, promptId),
  updatePrompt: (data: { promptId: string; content: string }) =>
    ipcRenderer.invoke(IpcChannels.UPDATE_PROMPT, data),
  resetPrompt: (promptId: string) =>
    ipcRenderer.invoke(IpcChannels.RESET_PROMPT, promptId),

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
      'correction-progress',
      'correction-completed',
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