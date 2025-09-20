import { MeetingDetectionService } from './MeetingDetectionService';
import { CalendarService } from './CalendarService';
import { Notification, systemPreferences, app } from 'electron';
import * as sinon from 'sinon';

jest.mock('electron');
jest.mock('./CalendarService');

describe('MeetingDetectionService', () => {
  let service: MeetingDetectionService;
  let calendarServiceMock: jest.Mocked<CalendarService>;
  let notificationStub: sinon.SinonStub;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    calendarServiceMock = new CalendarService() as jest.Mocked<CalendarService>;
    service = new MeetingDetectionService();
    
    // Mock Notification
    notificationStub = sandbox.stub(Notification, 'constructor');
    
    // Mock system preferences
    (systemPreferences.getMediaAccessStatus as jest.Mock).mockReturnValue('granted');
  });

  afterEach(() => {
    sandbox.restore();
    jest.clearAllMocks();
  });

  describe('initialize', () => {
    it('should initialize the service successfully', async () => {
      const result = await service.initialize();
      expect(result).toBe(true);
    });

    it('should handle initialization errors gracefully', async () => {
      (systemPreferences.getMediaAccessStatus as jest.Mock).mockReturnValue('denied');
      const result = await service.initialize();
      expect(result).toBe(false);
    });
  });

  describe('startMonitoring', () => {
    it('should start monitoring for meetings', async () => {
      await service.initialize();
      const startSpy = jest.spyOn(service as any, 'detectMeetingWindows');
      
      await service.startMonitoring();
      
      expect(startSpy).toHaveBeenCalled();
    });

    it('should detect Zoom meetings', async () => {
      const mockZoomWindow = {
        title: 'Zoom Meeting',
        app: 'zoom.us',
        bounds: { x: 0, y: 0, width: 1920, height: 1080 }
      };

      await service.initialize();
      const detected = await service['detectPlatform'](mockZoomWindow);
      
      expect(detected).toEqual({
        platform: 'zoom',
        title: 'Zoom Meeting',
        detected: true
      });
    });

    it('should detect Google Meet meetings', async () => {
      const mockMeetWindow = {
        title: 'Meet - Google Chrome',
        app: 'Google Chrome',
        url: 'https://meet.google.com/abc-defg-hij'
      };

      await service.initialize();
      const detected = await service['detectPlatform'](mockMeetWindow);
      
      expect(detected).toEqual({
        platform: 'googlemeet',
        title: 'Meet',
        meetingId: 'abc-defg-hij',
        detected: true
      });
    });

    it('should detect Microsoft Teams meetings', async () => {
      const mockTeamsWindow = {
        title: 'Microsoft Teams',
        app: 'Microsoft Teams',
        bounds: { x: 0, y: 0, width: 1920, height: 1080 }
      };

      await service.initialize();
      const detected = await service['detectPlatform'](mockTeamsWindow);
      
      expect(detected).toEqual({
        platform: 'teams',
        title: 'Microsoft Teams',
        detected: true
      });
    });

    it('should detect Slack Huddles', async () => {
      const mockSlackWindow = {
        title: 'Slack | Huddle',
        app: 'Slack',
        bounds: { x: 0, y: 0, width: 1920, height: 1080 }
      };

      await service.initialize();
      const detected = await service['detectPlatform'](mockSlackWindow);
      
      expect(detected).toEqual({
        platform: 'slack',
        title: 'Slack Huddle',
        detected: true
      });
    });
  });

  describe('Meeting Matching', () => {
    it('should match detected meeting with calendar event', async () => {
      const mockCalendarEvent = {
        id: 'cal-123',
        title: 'Weekly Standup',
        startTime: new Date(),
        endTime: new Date(Date.now() + 3600000),
        attendees: ['john@example.com', 'jane@example.com']
      };

      calendarServiceMock.getUpcomingMeetings = jest.fn().mockResolvedValue([mockCalendarEvent]);

      const detectedMeeting = {
        platform: 'zoom',
        title: 'Weekly Standup',
        detected: true
      };

      const matched = await service['matchWithCalendarEvent'](detectedMeeting);
      
      expect(matched).toEqual(mockCalendarEvent);
    });

    it('should handle no calendar match gracefully', async () => {
      calendarServiceMock.getUpcomingMeetings = jest.fn().mockResolvedValue([]);

      const detectedMeeting = {
        platform: 'zoom',
        title: 'Ad-hoc Meeting',
        detected: true
      };

      const matched = await service['matchWithCalendarEvent'](detectedMeeting);
      
      expect(matched).toBeNull();
    });
  });

  describe('Notifications', () => {
    it('should show meeting detection notification', async () => {
      const showSpy = sandbox.spy();
      const mockNotification = {
        show: showSpy,
        on: sandbox.stub()
      };
      
      notificationStub.returns(mockNotification);

      await service['showMeetingNotification']({
        platform: 'zoom',
        title: 'Team Meeting',
        id: 'meeting-123'
      });

      expect(notificationStub.calledOnce).toBe(true);
      expect(showSpy.calledOnce).toBe(true);
    });

    it('should handle notification click for start recording', async () => {
      const mockNotification = {
        show: sandbox.stub(),
        on: sandbox.stub()
      };
      
      notificationStub.returns(mockNotification);

      await service['showMeetingNotification']({
        platform: 'zoom',
        title: 'Team Meeting',
        id: 'meeting-123'
      });

      // Simulate clicking "Start Recording"
      const clickHandler = mockNotification.on.getCall(0).args[1];
      await clickHandler('start-recording');

      // Verify recording started
      expect(service['currentRecordingMeeting']).toBeDefined();
    });

    it('should handle notification dismiss', async () => {
      const mockNotification = {
        show: sandbox.stub(),
        on: sandbox.stub()
      };
      
      notificationStub.returns(mockNotification);

      await service['showMeetingNotification']({
        platform: 'zoom',
        title: 'Team Meeting',
        id: 'meeting-123'
      });

      // Simulate clicking "Dismiss"
      const clickHandler = mockNotification.on.getCall(0).args[1];
      await clickHandler('dismiss');

      // Verify no recording started
      expect(service['currentRecordingMeeting']).toBeUndefined();
    });
  });

  describe('stopMonitoring', () => {
    it('should stop monitoring cleanly', async () => {
      await service.initialize();
      await service.startMonitoring();
      
      const stopSpy = jest.spyOn(service as any, 'cleanup');
      await service.stopMonitoring();
      
      expect(stopSpy).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle multiple simultaneous meetings', async () => {
      const meetings = [
        { platform: 'zoom', title: 'Meeting 1' },
        { platform: 'googlemeet', title: 'Meeting 2' }
      ];

      for (const meeting of meetings) {
        await service['handleMeetingDetected'](meeting);
      }

      // Should only record one meeting at a time
      expect(service['activeMeetings'].length).toBeLessThanOrEqual(1);
    });

    it('should handle rapid meeting switches', async () => {
      // Start first meeting
      await service['handleMeetingDetected']({
        platform: 'zoom',
        title: 'Meeting 1',
        id: 'meeting-1'
      });

      // Quick switch to another meeting
      await service['handleMeetingDetected']({
        platform: 'teams',
        title: 'Meeting 2',
        id: 'meeting-2'
      });

      // Should handle gracefully
      expect(service['currentRecordingMeeting']).toBeDefined();
    });

    it('should recover from detection errors', async () => {
      // Simulate error in detection
      const detectStub = sandbox.stub(service as any, 'detectPlatform').throws(new Error('Detection failed'));
      
      try {
        await service['detectMeetingWindows']();
      } catch (error) {
        // Should not crash
      }

      detectStub.restore();
      
      // Should be able to continue
      await service['detectMeetingWindows']();
      expect(service['isMonitoring']).toBe(true);
    });
  });

  describe('Performance', () => {
    it('should detect meetings within 2 seconds', async () => {
      const startTime = Date.now();
      
      await service.initialize();
      await service['detectMeetingWindows']();
      
      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(2000);
    });

    it('should not consume excessive memory', () => {
      const memBefore = process.memoryUsage().heapUsed;
      
      // Create multiple service instances
      for (let i = 0; i < 10; i++) {
        new MeetingDetectionService();
      }
      
      const memAfter = process.memoryUsage().heapUsed;
      const memIncrease = (memAfter - memBefore) / 1024 / 1024; // MB
      
      expect(memIncrease).toBeLessThan(50); // Should use less than 50MB
    });
  });
});