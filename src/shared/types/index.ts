export interface Attendee {
  name: string;
  email?: string;
}

export interface Meeting {
  id: string;
  title: string;
  date: Date | string;
  startTime?: Date;
  endTime?: Date;
  attendees: string[] | Attendee[];
  duration?: number;
  platform?: 'zoom' | 'googlemeet' | 'teams' | 'slack' | 'manual';
  recallRecordingId?: string | null;
  recallVideoUrl?: string;
  recallAudioUrl?: string;
  calendarEventId?: string;
  status: 'scheduled' | 'recording' | 'completed' | 'partial' | 'error' | 'active';
  notes: string;
  transcript: string;
  insights?: string; // JSON string containing summary, action items, decisions
  filePath?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface MeetingNotification {
  title: string;
  body: string;
  meetingId?: string;
  suggestedMeeting?: Meeting;
  actions: NotificationAction[];
}

export interface NotificationAction {
  title: string;
  action: 'confirm' | 'select' | 'dismiss';
}

export interface TranscriptChunk {
  timestamp: Date;
  speaker?: string;
  text: string;
}

export interface UserProfile {
  name: string;
  company: string;
  title: string;
  aboutMe: string;
  preferences: string;
}

export interface AppSettings {
  recallApiKey?: string;
  recallApiUrl: string;
  anthropicApiKey?: string;
  storagePath: string;
  googleCalendarConnected: boolean;
  autoStartOnBoot: boolean;
  selectedCalendars: string[];
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  attendees: string[];
  description?: string;
  location?: string;
  calendarId: string;
  meetingUrl?: string;
}

export interface RecordingState {
  isRecording: boolean;
  meetingId?: string;
  startTime?: Date;
  connectionStatus: 'connected' | 'disconnected' | 'reconnecting';
  lastBackupTime?: Date;
  uploadId?: string;
  localOnly?: boolean;
  error?: string;
}

export enum IpcChannels {
  // Main -> Renderer
  MEETING_DETECTED = 'meeting-detected',
  RECORDING_STARTED = 'recording-started',
  RECORDING_STOPPED = 'recording-stopped',
  TRANSCRIPT_UPDATE = 'transcript-update',
  CONNECTION_STATUS = 'connection-status',
  SETTINGS_UPDATED = 'settings-updated',
  MEETINGS_UPDATED = 'meetings-updated',
  ERROR_OCCURRED = 'error-occurred',
  
  // Renderer -> Main
  START_RECORDING = 'start-recording',
  STOP_RECORDING = 'stop-recording',
  CREATE_MEETING = 'create-meeting',
  UPDATE_MEETING = 'update-meeting',
  DELETE_MEETING = 'delete-meeting',
  GET_MEETINGS = 'get-meetings',
  GET_SETTINGS = 'get-settings',
  UPDATE_SETTINGS = 'update-settings',
  CONNECT_CALENDAR = 'connect-calendar',
  DISCONNECT_CALENDAR = 'disconnect-calendar',
  SYNC_CALENDAR = 'sync-calendar',
  SELECT_STORAGE_PATH = 'select-storage-path',
  OPEN_MEETING_FILE = 'open-meeting-file',
  SHOW_IN_FINDER = 'show-in-finder',
  CORRECT_TRANSCRIPT = 'correct-transcript',
  GENERATE_INSIGHTS = 'generate-insights',
  GET_PROFILE = 'get-profile',
  UPDATE_PROFILE = 'update-profile',

  // Search channels
  SEARCH_MEETINGS = 'search-meetings',
  GET_SEARCH_HISTORY = 'get-search-history',
  CLEAR_SEARCH_HISTORY = 'clear-search-history',
  SEARCH_RESULTS = 'search-results',
}

export interface SearchOptions {
  query: string;
  filters?: {
    dateFrom?: Date;
    dateTo?: Date;
    attendees?: string[];
    status?: Meeting['status'][];
    platforms?: string[];
  };
  limit?: number;
}

export interface SearchResult {
  meeting: Meeting;
  score: number;
  matches: SearchMatch[];
}

export interface SearchMatch {
  field: string;
  value: string;
  indices: [number, number][];
}