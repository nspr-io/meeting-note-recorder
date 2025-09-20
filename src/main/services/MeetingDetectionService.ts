import { EventEmitter } from 'events';
import { RecordingService } from './RecordingService';
import { StorageService } from './StorageService';
import { CalendarService } from './CalendarService';
import { SettingsService } from './SettingsService';
import { getLogger } from './LoggingService';
import { Meeting, CalendarEvent } from '../../shared/types';
import { v4 as uuidv4 } from 'uuid';

const logger = getLogger();

export interface MeetingDetectedEvent {
  meetingTitle?: string;
  platform: 'zoom' | 'meet' | 'teams' | 'slack' | 'manual' | string;
  windowId: string;
  url?: string;
  detected?: boolean;
}

export class MeetingDetectionService extends EventEmitter {
  private settingsService: SettingsService;
  private recordingService: RecordingService;
  private storageService: StorageService;
  private calendarService: CalendarService;
  private isMonitoring = false;
  private detectedMeetings = new Map<string, MeetingDetectedEvent>();
  private dismissedMeetings = new Set<string>();

  constructor(
    settingsService: SettingsService,
    recordingService: RecordingService,
    storageService: StorageService,
    calendarService: CalendarService
  ) {
    super();
    this.settingsService = settingsService;
    this.recordingService = recordingService;
    this.storageService = storageService;
    this.calendarService = calendarService;
    
    // Listen for SDK meeting detection events
    this.setupSDKEventListeners();
  }

  private setupSDKEventListeners(): void {
    // Listen for meetings detected by the RecallAI SDK
    this.recordingService.on('sdk-meeting-detected', async (event: MeetingDetectedEvent) => {
      logger.info('[JOURNEY-3] Meeting detection service received SDK event', {
        ...event,
        timestamp: new Date().toISOString()
      });
      
      // Skip if we've already dismissed this meeting
      if (this.dismissedMeetings.has(event.windowId)) {
        logger.info('[JOURNEY-3a] Skipping dismissed meeting', {
          windowId: event.windowId,
          timestamp: new Date().toISOString()
        });
        return;
      }
      
      // Skip if we're already tracking this meeting
      if (this.detectedMeetings.has(event.windowId)) {
        logger.info('[JOURNEY-3b] Meeting already tracked', {
          windowId: event.windowId,
          timestamp: new Date().toISOString()
        });
        return;
      }
      
      // Store the detected meeting
      logger.info('[JOURNEY-4] Storing detected meeting', {
        windowId: event.windowId,
        platform: event.platform,
        title: event.meetingTitle
      });
      this.detectedMeetings.set(event.windowId, event);
      
      // Try to match with calendar events
      logger.info('[JOURNEY-5] Attempting to match with calendar events');
      const suggestedMeeting = await this.findMatchingCalendarEvent(event);
      logger.info('[JOURNEY-6] Calendar matching result', {
        found: !!suggestedMeeting,
        suggestedTitle: suggestedMeeting?.title
      });
      
      // Emit meeting detected event for UI notification
      logger.info('[JOURNEY-7] Emitting meeting-detected event for notification', {
        windowId: event.windowId,
        platform: event.platform,
        title: event.meetingTitle,
        hasSuggested: !!suggestedMeeting,
        timestamp: new Date().toISOString()
      });
      this.emit('meeting-detected', {
        ...event,
        suggestedMeeting
      });
    });
    
    // Listen for meeting updates
    this.recordingService.on('sdk-meeting-updated', (window: any) => {
      logger.info('Meeting updated', window);
      if (this.detectedMeetings.has(window.id)) {
        const existing = this.detectedMeetings.get(window.id)!;
        this.detectedMeetings.set(window.id, {
          ...existing,
          meetingTitle: window.title || existing.meetingTitle,
          url: window.url || existing.url
        });
        this.emit('meeting-updated', window);
      }
    });
    
    // Listen for meeting closed
    this.recordingService.on('sdk-meeting-closed', (window: any) => {
      logger.info('Meeting closed', window);
      this.detectedMeetings.delete(window.id);
      this.dismissedMeetings.delete(window.id);
      this.emit('meeting-closed', window);
    });
  }

  async startMonitoring(): Promise<void> {
    if (this.isMonitoring) {
      logger.warn('Meeting detection already running');
      return;
    }

    logger.info('Meeting detection service ready (SDK handles detection)');
    this.isMonitoring = true;
    
    // The RecallAI SDK automatically detects meetings once initialized
    // We just need to listen for the events, which we've set up above
    logger.info('SDK meeting detection is active');
  }

  stopMonitoring(): void {
    logger.info('Stopping meeting detection monitoring');
    this.isMonitoring = false;
    this.detectedMeetings.clear();
    this.dismissedMeetings.clear();
  }

  isActive(): boolean {
    return this.isMonitoring;
  }

  private async findMatchingCalendarEvent(detectedMeeting: MeetingDetectedEvent): Promise<CalendarEvent | undefined> {
    try {
      // Get upcoming calendar events
      const upcomingEvents = await this.calendarService.getUpcomingEvents();
      const now = new Date();
      
      // Try to find a matching event based on platform or title
      return upcomingEvents.find(event => {
        // Check if the event is happening now (within 15 minutes before/after start)
        const eventStart = new Date(event.start);
        const timeDiff = Math.abs(now.getTime() - eventStart.getTime());
        if (timeDiff > 15 * 60 * 1000) return false; // More than 15 minutes difference
        
        // Check platform match
        if (detectedMeeting.platform.toLowerCase() === 'zoom' && event.meetingUrl?.includes('zoom.us')) {
          return true;
        }
        if (detectedMeeting.platform.toLowerCase() === 'meet' && event.meetingUrl?.includes('meet.google.com')) {
          return true;
        }
        if (detectedMeeting.platform.toLowerCase() === 'teams' && event.meetingUrl?.includes('teams.microsoft.com')) {
          return true;
        }
        
        // Check title similarity if available
        if (detectedMeeting.meetingTitle && event.title) {
          const titleMatch = event.title.toLowerCase().includes(detectedMeeting.meetingTitle.toLowerCase()) ||
                           detectedMeeting.meetingTitle.toLowerCase().includes(event.title.toLowerCase());
          if (titleMatch) return true;
        }
        
        return false;
      });
    } catch (error) {
      logger.warn('Failed to match calendar event', error);
      return undefined;
    }
  }

  async createManualMeeting(title: string): Promise<Meeting> {
    const meetingId = uuidv4();
    const meeting: Meeting = {
      id: meetingId,
      title: title || 'Manual Meeting',
      date: new Date(),
      startTime: new Date(),
      endTime: new Date(),
      attendees: [],
      notes: '',
      transcript: '',
      platform: 'manual',
      status: 'active'
    };

    await this.storageService.saveMeeting(meeting);
    logger.info('Created manual meeting', { meetingId, title });
    
    return meeting;
  }

  async handleToastAction(action: string, meetingId: string): Promise<any> {
    logger.info('Handling toast action', { action, meetingId });
    
    switch (action) {
      case 'start-recording':
        try {
          await this.recordingService.startRecording(meetingId);
          return { action, success: true };
        } catch (error) {
          logger.error('Failed to start recording from toast', error);
          throw error;
        }
        
      case 'dismiss':
        // Add to dismissed set so we don't show notification again
        const meeting = this.detectedMeetings.get(meetingId);
        if (meeting) {
          this.dismissedMeetings.add(meetingId);
        }
        return { action, dismissed: true };
        
      case 'select-different':
        // Return list of detected meetings
        return { 
          action, 
          meetings: Array.from(this.detectedMeetings.values())
        };
        
      default:
        logger.warn('Unknown toast action', { action });
        return { action, error: 'Unknown action' };
    }
  }

  // Helper method to prepare notification data
  prepareNotification(detectedMeeting: any): any {
    return {
      title: 'Meeting Detected',
      body: `${detectedMeeting.platform} meeting detected: ${detectedMeeting.meetingTitle || 'Meeting'}`,
      actions: ['Start Recording', 'Dismiss', 'Select Different Meeting']
    };
  }
}