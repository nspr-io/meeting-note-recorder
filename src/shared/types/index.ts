export interface Attendee {
  name: string;
  email?: string;
}

export type NotionShareMode = 'full' | 'insights';

export interface Meeting {
  id: string;
  title: string;
  date: Date | string;
  startTime?: Date;
  endTime?: Date;
  attendees: string[] | Attendee[];
  duration?: number;
  platform?: 'zoom' | 'googlemeet' | 'teams' | 'slack' | 'manual' | 'webex' | 'other';
  recallRecordingId?: string | null;
  recallVideoUrl?: string;
  recallAudioUrl?: string;
  calendarEventId?: string;
  meetingUrl?: string;  // Video conference URL
  calendarInviteUrl?: string;  // Link to Google Calendar event
  status: 'scheduled' | 'recording' | 'completed' | 'partial' | 'error' | 'active';
  notes: string;
  transcript: string;
  tags?: string[];
  insights?: string; // JSON string containing summary, action items, decisions
  insightsFilePath?: string | null; // Relative path to persisted insights JSON
  actionItemSyncStatus?: ActionItemSyncStatus[];
  teamSummary?: string; // JSON string containing team-appropriate summary
  slackSharedAt?: Date; // Timestamp when shared to Slack
  notionSharedAt?: Date | string | null;
  notionPageId?: string | null;
  filePath?: string;
  createdAt?: Date;
  updatedAt?: Date;
  autoRecordApproved?: boolean; // Flag to track if user pre-approved recording
  __transcriptDedupeIndex?: Map<string, string>;
  firefliesTranscriptId?: string;
  firefliesTranscriptFetchedAt?: Date | string;
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
  timestamp: Date | string;
  speaker?: string;
  text: string;
  sequenceId?: string;
  isFinal?: boolean;
  partial?: boolean;
  persisted?: boolean;
  hash?: string;
  meetingId?: string;
}

export interface UserProfile {
  name: string;
  company: string;
  title: string;
  aboutMe: string;
  preferences: string;
}

export interface CoachVariable {
  id: string;
  label: string;
  key: string;
  filePath: string;
}

export interface CoachConfig {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  isCustom?: boolean;
  variables?: CoachVariable[];
}

export const DEFAULT_COACH_CONFIGS: CoachConfig[] = [
  {
    id: 'coach-sales',
    name: 'Sales Coach',
    description: 'Real-time coaching for sales calls',
    enabled: true,
    isCustom: false,
    variables: [],
  },
  {
    id: 'coach-interview',
    name: 'Interview Coach',
    description: 'Real-time coaching for job interviews',
    enabled: true,
    isCustom: false,
    variables: [],
  },
  {
    id: 'coach-facilitator',
    name: 'Meeting Facilitator Coach',
    description: 'Real-time coaching for meeting facilitation',
    enabled: true,
    isCustom: false,
    variables: [],
  },
];

export interface AppSettings {
  recallApiKey?: string;
  recallApiUrl: string;
  anthropicApiKey?: string;
  firefliesApiKey?: string;
  storagePath: string;
  googleCalendarConnected: boolean;
  autoStartOnBoot: boolean;
  selectedCalendars: string[];
  slackWebhookUrl?: string;
  notionIntegrationToken?: string;
  notionDatabaseId?: string;
  notionTodoIntegrationToken?: string;
  notionTodoDatabaseId?: string;
  coaches: CoachConfig[];
}

export interface ActionItemSyncStatus {
  task: string;
  owner?: string;
  due?: string;
  status: 'pending' | 'sent' | 'failed';
  notionPageId?: string;
  notionPageUrl?: string;
  sentAt?: string;
  error?: string;
  insightIndex?: number;
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
  htmlLink?: string;  // Google Calendar event URL
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
  GET_TRANSCRIPT_BUFFER = 'get-transcript-buffer',
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
  REFRESH_MEETING = 'refresh-meeting',
  GET_RECORDING_STATE = 'get-recording-state',
  GET_SETTINGS = 'get-settings',
  UPDATE_SETTINGS = 'update-settings',
  CONNECT_CALENDAR = 'connect-calendar',
  DISCONNECT_CALENDAR = 'disconnect-calendar',
  SYNC_CALENDAR = 'sync-calendar',
  SELECT_STORAGE_PATH = 'select-storage-path',
  SELECT_FILE_PATH = 'select-file-path',
  OPEN_MEETING_FILE = 'open-meeting-file',
  SHOW_IN_FINDER = 'show-in-finder',
  OPEN_EXTERNAL = 'open-external',
  CORRECT_TRANSCRIPT = 'correct-transcript',
  FETCH_FIREFLIES_TRANSCRIPT = 'fetch-fireflies-transcript',
  GENERATE_INSIGHTS = 'generate-insights',
  GENERATE_TEAM_SUMMARY = 'generate-team-summary',
  SHARE_TO_SLACK = 'share-to-slack',
  SHARE_TO_NOTION = 'share-to-notion',
  SEND_NOTION_ACTION_ITEMS = 'send-notion-action-items',
  SEND_SINGLE_NOTION_ACTION_ITEM = 'send-single-notion-action-item',
  GET_PROFILE = 'get-profile',
  UPDATE_PROFILE = 'update-profile',

  // Search channels
  SEARCH_MEETINGS = 'search-meetings',
  GET_SEARCH_HISTORY = 'get-search-history',
  CLEAR_SEARCH_HISTORY = 'clear-search-history',
  SEARCH_RESULTS = 'search-results',

  // System Prompts channels
  GET_PROMPTS = 'get-prompts',
  GET_PROMPT = 'get-prompt',
  UPDATE_PROMPT = 'update-prompt',
  RESET_PROMPT = 'reset-prompt',
  GET_COACHES = 'get-coaches',
  UPSERT_COACH = 'upsert-coach',
  TOGGLE_COACH = 'toggle-coach',
  DELETE_COACH = 'delete-coach',

  // Real-time coaching
  START_COACHING = 'start-coaching',
  STOP_COACHING = 'stop-coaching',
  UPDATE_COACHING_NOTES = 'update-coaching-notes',
  GET_COACHING_STATE = 'get-coaching-state',
  GET_COACHING_FEEDBACK = 'get-coaching-feedback',
  OPEN_COACH_WINDOW = 'open-coach-window',
  CLOSE_COACH_WINDOW = 'close-coach-window',
  GET_COACH_WINDOW_STATUS = 'get-coach-window-status',
  COACHING_FEEDBACK = 'coaching-feedback',
  COACHING_ERROR = 'coaching-error',
  COACH_WINDOW_STATUS = 'coach-window-status',
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

export type CoachingType = string;

export interface CoachingFeedback {
  timestamp: Date;
  alerts: string[];
  observations: string[];
  suggestions: string[];
}

export interface CoachingState {
  isActive: boolean;
  coachingType: CoachingType | null;
  meetingId: string | null;
}

export interface CoachWindowStatus {
  isOpen: boolean;
}