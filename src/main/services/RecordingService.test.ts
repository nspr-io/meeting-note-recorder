import { RecordingService } from './RecordingService';
import { StorageService } from './StorageService';
import { RecallApiService } from './RecallApiService';
import { EventEmitter } from 'events';
import * as sinon from 'sinon';
import * as fs from 'fs';

jest.mock('./StorageService');
jest.mock('./RecallApiService');
jest.mock('fs');

describe('RecordingService', () => {
  let service: RecordingService;
  let storageServiceMock: jest.Mocked<StorageService>;
  let recallApiServiceMock: jest.Mocked<RecallApiService>;
  let sandbox: sinon.SinonSandbox;
  let eventEmitter: EventEmitter;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    eventEmitter = new EventEmitter();
    
    storageServiceMock = new StorageService() as jest.Mocked<StorageService>;
    recallApiServiceMock = new RecallApiService() as jest.Mocked<RecallApiService>;
    
    service = new RecordingService();
    service['storageService'] = storageServiceMock;
    service['recallApiService'] = recallApiServiceMock;
    service['eventEmitter'] = eventEmitter;
  });

  afterEach(() => {
    sandbox.restore();
    jest.clearAllMocks();
  });

  describe('startRecording', () => {
    it('should start recording successfully', async () => {
      const meeting = {
        id: 'meeting-123',
        title: 'Test Meeting',
        platform: 'zoom',
        startTime: new Date()
      };

      recallApiServiceMock.startRecording = jest.fn().mockResolvedValue({
        recordingId: 'rec-456',
        status: 'recording'
      });

      const result = await service.startRecording(meeting);

      expect(result).toEqual({
        success: true,
        recordingId: 'rec-456',
        meetingId: 'meeting-123'
      });
      expect(recallApiServiceMock.startRecording).toHaveBeenCalledWith(meeting);
    });

    it('should handle manual recording start', async () => {
      const meeting = {
        id: 'manual-123',
        title: 'Manual Meeting',
        platform: 'manual',
        startTime: new Date()
      };

      recallApiServiceMock.startRecording = jest.fn().mockResolvedValue({
        recordingId: 'manual-rec-789',
        status: 'recording'
      });

      const result = await service.startRecording(meeting, { manual: true });

      expect(result).toEqual({
        success: true,
        recordingId: 'manual-rec-789',
        meetingId: 'manual-123',
        manual: true
      });
    });

    it('should prevent duplicate recordings', async () => {
      const meeting = {
        id: 'meeting-123',
        title: 'Test Meeting',
        platform: 'zoom',
        startTime: new Date()
      };

      service['activeRecordings'].set('meeting-123', { recordingId: 'existing-rec' });

      const result = await service.startRecording(meeting);

      expect(result).toEqual({
        success: false,
        error: 'Recording already in progress for this meeting'
      });
    });

    it('should handle API failures gracefully', async () => {
      const meeting = {
        id: 'meeting-123',
        title: 'Test Meeting',
        platform: 'zoom',
        startTime: new Date()
      };

      recallApiServiceMock.startRecording = jest.fn().mockRejectedValue(new Error('API Error'));

      const result = await service.startRecording(meeting);

      expect(result).toEqual({
        success: false,
        error: 'Failed to start recording: API Error'
      });
    });
  });

  describe('stopRecording', () => {
    it('should stop recording successfully', async () => {
      const meetingId = 'meeting-123';
      service['activeRecordings'].set(meetingId, {
        recordingId: 'rec-456',
        startTime: new Date()
      });

      recallApiServiceMock.stopRecording = jest.fn().mockResolvedValue({
        success: true,
        finalTranscript: 'Final transcript content'
      });

      storageServiceMock.saveMeeting = jest.fn().mockResolvedValue(true);

      const result = await service.stopRecording(meetingId);

      expect(result).toEqual({
        success: true,
        recordingId: 'rec-456',
        saved: true
      });
      expect(service['activeRecordings'].has(meetingId)).toBe(false);
    });

    it('should handle non-existent recording', async () => {
      const result = await service.stopRecording('non-existent');

      expect(result).toEqual({
        success: false,
        error: 'No active recording found'
      });
    });
  });

  describe('Transcript Handling', () => {
    it('should handle transcript chunks', async () => {
      const chunk = {
        recordingId: 'rec-456',
        timestamp: new Date().toISOString(),
        speaker: 'John Doe',
        text: 'This is a test transcript'
      };

      service['activeRecordings'].set('meeting-123', {
        recordingId: 'rec-456',
        transcript: []
      });

      await service['handleTranscriptChunk'](chunk);

      const recording = service['activeRecordings'].get('meeting-123');
      expect(recording?.transcript).toContainEqual(chunk);
    });

    it('should buffer transcripts during connection loss', async () => {
      const chunk = {
        recordingId: 'rec-456',
        timestamp: new Date().toISOString(),
        speaker: 'Jane Smith',
        text: 'Buffered transcript'
      };

      service['connectionLost'] = true;
      service['transcriptBuffer'] = [];

      await service['handleTranscriptChunk'](chunk);

      expect(service['transcriptBuffer']).toContainEqual(chunk);
    });

    it('should auto-save transcripts periodically', async () => {
      jest.useFakeTimers();

      const meetingId = 'meeting-123';
      service['activeRecordings'].set(meetingId, {
        recordingId: 'rec-456',
        transcript: [
          { timestamp: '10:00:00', speaker: 'John', text: 'Hello' },
          { timestamp: '10:00:10', speaker: 'Jane', text: 'Hi there' }
        ]
      });

      storageServiceMock.updateTranscript = jest.fn().mockResolvedValue(true);

      // Trigger auto-save
      service['startAutoSave'](meetingId);
      jest.advanceTimersByTime(10000); // 10 seconds

      expect(storageServiceMock.updateTranscript).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  describe('Connection Resilience', () => {
    it('should handle connection loss', async () => {
      service['handleConnectionLoss']();

      expect(service['connectionLost']).toBe(true);
      expect(service['transcriptBuffer']).toBeDefined();
    });

    it('should recover from connection loss', async () => {
      // Simulate connection loss
      service['connectionLost'] = true;
      service['transcriptBuffer'] = [
        { timestamp: '10:00:00', speaker: 'John', text: 'Buffered text' }
      ];

      recallApiServiceMock.uploadTranscript = jest.fn().mockResolvedValue({ success: true });

      await service['handleConnectionRestored']();

      expect(service['connectionLost']).toBe(false);
      expect(recallApiServiceMock.uploadTranscript).toHaveBeenCalledWith(service['transcriptBuffer']);
      expect(service['transcriptBuffer']).toEqual([]);
    });

    it('should retry failed uploads with exponential backoff', async () => {
      jest.useFakeTimers();

      const uploadData = { transcript: 'test data' };
      let attempts = 0;

      recallApiServiceMock.uploadTranscript = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.reject(new Error('Network error'));
        }
        return Promise.resolve({ success: true });
      });

      const retryPromise = service['retryUpload'](uploadData);

      // First retry after 1s
      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      // Second retry after 2s
      jest.advanceTimersByTime(2000);
      await Promise.resolve();

      // Third attempt succeeds
      jest.advanceTimersByTime(4000);
      const result = await retryPromise;

      expect(result).toEqual({ success: true });
      expect(attempts).toBe(3);

      jest.useRealTimers();
    });
  });

  describe('Local Backup', () => {
    it('should create local backup on save', async () => {
      const meeting = {
        id: 'meeting-123',
        title: 'Test Meeting',
        transcript: 'Test transcript content'
      };

      (fs.writeFileSync as jest.Mock).mockImplementation(() => {});
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      await service['saveLocalBackup'](meeting);

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('backup.json'),
        expect.any(String)
      );
    });

    it('should restore from local backup if available', async () => {
      const meetingId = 'meeting-123';
      const backupData = {
        id: meetingId,
        transcript: 'Recovered transcript',
        lastSaved: new Date().toISOString()
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(backupData));

      const restored = await service['restoreFromBackup'](meetingId);

      expect(restored).toEqual(backupData);
    });
  });

  describe('Recording Status', () => {
    it('should track recording status accurately', async () => {
      const meetingId = 'meeting-123';
      
      expect(service.isRecording(meetingId)).toBe(false);

      service['activeRecordings'].set(meetingId, {
        recordingId: 'rec-456',
        status: 'recording'
      });

      expect(service.isRecording(meetingId)).toBe(true);

      service['activeRecordings'].delete(meetingId);

      expect(service.isRecording(meetingId)).toBe(false);
    });

    it('should get all active recordings', () => {
      service['activeRecordings'].set('meeting-1', { recordingId: 'rec-1' });
      service['activeRecordings'].set('meeting-2', { recordingId: 'rec-2' });

      const active = service.getActiveRecordings();

      expect(active).toHaveLength(2);
      expect(active).toContainEqual({ meetingId: 'meeting-1', recordingId: 'rec-1' });
      expect(active).toContainEqual({ meetingId: 'meeting-2', recordingId: 'rec-2' });
    });
  });

  describe('Error Handling', () => {
    it('should handle quota exceeded errors', async () => {
      const meeting = {
        id: 'meeting-123',
        title: 'Test Meeting'
      };

      const quotaError = new Error('Quota exceeded');
      quotaError['code'] = 'QUOTA_EXCEEDED';

      recallApiServiceMock.startRecording = jest.fn().mockRejectedValue(quotaError);

      const result = await service.startRecording(meeting);

      expect(result).toEqual({
        success: false,
        error: 'Recording quota exceeded',
        code: 'QUOTA_EXCEEDED'
      });
    });

    it('should handle service unavailable errors', async () => {
      const meeting = {
        id: 'meeting-123',
        title: 'Test Meeting'
      };

      const serviceError = new Error('Service unavailable');
      serviceError['code'] = 'SERVICE_UNAVAILABLE';

      recallApiServiceMock.startRecording = jest.fn().mockRejectedValue(serviceError);

      const result = await service.startRecording(meeting);

      expect(result).toEqual({
        success: false,
        error: 'Recording service temporarily unavailable',
        code: 'SERVICE_UNAVAILABLE',
        retry: true
      });
    });
  });

  describe('Performance', () => {
    it('should handle large transcripts efficiently', async () => {
      const largeTranscript = [];
      for (let i = 0; i < 10000; i++) {
        largeTranscript.push({
          timestamp: new Date().toISOString(),
          speaker: `Speaker ${i % 5}`,
          text: `This is line ${i} of the transcript`
        });
      }

      const startTime = Date.now();
      
      service['activeRecordings'].set('meeting-123', {
        recordingId: 'rec-456',
        transcript: largeTranscript
      });

      await service['processTranscript']('meeting-123');
      
      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(1000); // Should process in under 1 second
    });

    it('should limit memory usage for transcript buffers', () => {
      const initialMemory = process.memoryUsage().heapUsed;
      
      // Add many transcript chunks
      for (let i = 0; i < 1000; i++) {
        service['transcriptBuffer'].push({
          timestamp: new Date().toISOString(),
          speaker: 'Speaker',
          text: 'x'.repeat(1000) // 1KB per chunk
        });
      }

      const memoryUsed = process.memoryUsage().heapUsed - initialMemory;
      const memoryUsedMB = memoryUsed / 1024 / 1024;
      
      expect(memoryUsedMB).toBeLessThan(10); // Should use less than 10MB for 1MB of text
    });
  });
});