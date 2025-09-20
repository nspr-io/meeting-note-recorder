import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels, Meeting, AppSettings } from '../shared/types';

const api = {
  // Settings
  getSettings: () => ipcRenderer.invoke(IpcChannels.GET_SETTINGS),
  updateSettings: (settings: Partial<AppSettings>) => 
    ipcRenderer.invoke(IpcChannels.UPDATE_SETTINGS, settings),
  
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
  stopRecording: () =>
    ipcRenderer.invoke(IpcChannels.STOP_RECORDING),
  correctTranscript: (meetingId: string) =>
    ipcRenderer.invoke(IpcChannels.CORRECT_TRANSCRIPT, meetingId),
  
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
  
  // Permissions
  getPermissionStatus: () => 
    ipcRenderer.invoke('get-permission-status'),
  checkPermissions: () => 
    ipcRenderer.invoke('check-permissions'),
  requestPermissions: () => 
    ipcRenderer.invoke('request-permissions'),
  
  // Event listeners
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
    ];
    
    if (validChannels.includes(channel as any)) {
      ipcRenderer.on(channel, (_, ...args) => callback(...args));
    }
  },
  
  removeListener: (channel: string, callback: Function) => {
    ipcRenderer.removeListener(channel, callback as any);
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;