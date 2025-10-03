import { EventEmitter } from 'events';
import { StorageService } from './StorageService';
import { RecallApiService, TranscriptResponse } from './RecallApiService';
import { TranscriptChunk, RecordingState } from '../../shared/types';
import { SDKDebugger } from './SDKDebugger';
import { TranscriptCorrectionService } from './TranscriptCorrectionService';
import { InsightsGenerationService } from './InsightsGenerationService';
import { PromptService } from './PromptService';
import { createServiceLogger } from './ServiceLogger';

const logger = createServiceLogger('RecordingService');

export class RecordingService extends EventEmitter {
  private storageService: StorageService;
  private recallApiService: RecallApiService | null = null;
  private transcriptCorrectionService: TranscriptCorrectionService;
  private insightsGenerationService: InsightsGenerationService;
  private recordingState: RecordingState = {
    isRecording: false,
    connectionStatus: 'connected',
  };
  private currentWindowId: string | null = null;
  private currentUploadToken: string | null = null;
  private transcriptBuffer: TranscriptChunk[] = [];
  private transcriptBuffers = new Map<string, TranscriptChunk[]>();
  private isInitialized = false;
  private sdkDebugger: SDKDebugger;
  private unknownSpeakerCount = 0;
  private speakerMap: Map<string, string> = new Map();
  private autoSaveInterval: NodeJS.Timeout | null = null;

  constructor(storageService: StorageService, promptService: PromptService | null) {
    super();
    logger.info('[RECORDING-SERVICE-CONSTRUCTOR] Creating RecordingService', {
      hasPromptService: promptService !== null
    });
    this.storageService = storageService;
    this.sdkDebugger = new SDKDebugger();

    logger.info('[RECORDING-SERVICE-CONSTRUCTOR] Creating TranscriptCorrectionService', {
      hasPromptService: promptService !== null
    });
    this.transcriptCorrectionService = new TranscriptCorrectionService(promptService);

    logger.info('[RECORDING-SERVICE-CONSTRUCTOR] Creating InsightsGenerationService', {
      hasPromptService: promptService !== null
    });
    this.insightsGenerationService = new InsightsGenerationService(promptService);

    // Forward correction events
    this.transcriptCorrectionService.on('correction-started', (data) => {
      this.emit('transcript-correction-started', data);
    });
    this.transcriptCorrectionService.on('correction-progress', (data) => {
      this.emit('transcript-correction-progress', data);
    });
    this.transcriptCorrectionService.on('correction-completed', (data) => {
      this.emit('transcript-correction-completed', data);
    });
    this.transcriptCorrectionService.on('correction-failed', (data) => {
      this.emit('transcript-correction-failed', data);
    });

    // Forward insights events
    this.insightsGenerationService.on('insights-started', (data) => {
      this.emit('insights-started', data);
    });
    this.insightsGenerationService.on('insights-completed', (data) => {
      this.emit('insights-completed', data);
    });
    this.insightsGenerationService.on('insights-failed', (data) => {
      this.emit('insights-failed', data);
    });
  }

  async initialize(apiKey: string, apiUrl: string, anthropicApiKey?: string): Promise<void> {
    if (this.isInitialized) {
      logger.info('RecordingService already initialized');
      return;
    }

    try {
      logger.info('Initializing recording service', { apiUrl, hasApiKey: !!apiKey });

      // Ensure consistent API URL across SDK and API service
      const baseApiUrl = (apiUrl || process.env.RECALL_API_BASE || 'https://us-west-2.recall.ai').replace(/\/+$/, '');

      // Try to initialize RecallAI if we have an API key
      if (apiKey) {
        try {
          // Initialize the API service with consistent URL
          this.recallApiService = new RecallApiService(apiKey, baseApiUrl);

          // Try to initialize the SDK (may fail if not installed)
          // INTERCEPT and disable SDK notifications by overriding Notification API
          logger.info('Disabling SDK notifications by intercepting Notification API');
          const originalNotification = global.Notification;

          try {
            const RecallAiSdk = require('@recallai/desktop-sdk').default;

            if (originalNotification) {
              // Override global Notification to prevent SDK from showing notifications
              global.Notification = class MockNotification {
                constructor(title: string, options?: any) {
                  logger.info(`[SDK-NOTIFICATION-BLOCKED] Blocked SDK notification: ${title}`, options);
                  // Don't actually create the notification - return a mock object
                  return {
                    onclick: null,
                    onerror: null,
                    onshow: null,
                    onclose: null,
                    close: () => {},
                    addEventListener: () => {},
                    removeEventListener: () => {}
                  };
                }
                static permission = 'granted';
                static requestPermission = () => Promise.resolve('granted');
              } as any;
              logger.info('Successfully intercepted Notification API to block SDK notifications');
            }

            logger.info('Starting SDK init with config:', {
              apiUrl: baseApiUrl,
              api_url: baseApiUrl, // SDK accepts both keys
              restartOnError: false, // CHANGED: Don't restart on error to avoid crash loops
              showNotifications: false, // Disable SDK notifications
              silentMode: true,
              notificationsEnabled: false
            });
            logger.info('[REGION-CHECK] SDK will use:', { sdk_api_url: baseApiUrl });

            // Wrap SDK init in error handling to prevent crash
            const initPromise = new Promise(async (resolve, reject) => {
              try {
                await RecallAiSdk.init({
                  apiUrl: baseApiUrl,
                  api_url: baseApiUrl, // ensure both formats work
                  restartOnError: false, // Prevent automatic restart on error
                  dev: process.env.NODE_ENV === 'development', // Enable dev mode for better logging
                  showNotifications: false, // Disable SDK automatic notifications
                  silentMode: true, // Additional option to suppress notifications
                  notificationsEnabled: false // Alternative naming for notification control
                  // NOTE: acquirePermissionsOnStartup removed - it was causing repeated permission prompts
                  // Permissions are managed by PermissionService instead
                });
                resolve(true);
              } catch (initError) {
                logger.error('SDK init threw error:', initError);
                reject(initError);
              }
            });

            // Add timeout to SDK init
            const timeoutPromise = new Promise((_, reject) => {
              setTimeout(() => reject(new Error('SDK init timeout after 30 seconds')), 30000);
            });

            await Promise.race([initPromise, timeoutPromise]);

            logger.info('RecallAI SDK initialized successfully - now setting up event listeners');

            // IMPORTANT: Set up event listeners AFTER init to avoid race conditions
            // when a meeting is already running
            this.setupSDKEventListeners();
            logger.info('SDK event listeners set up successfully');

            // Permissions are managed by PermissionService, not SDK
            logger.info('Permissions will be checked by PermissionService before recording starts');

            // Start debugging after init
            this.sdkDebugger.startDebugging();
            await SDKDebugger.checkSDKPermissions();

          } catch (sdkError) {
            logger.error('RecallAI SDK not available or init failed', sdkError);
            throw new Error('Failed to initialize RecallAI SDK');
          } finally {
            // ALWAYS restore original Notification API, even on error, so our app notifications work
            if (originalNotification) {
              global.Notification = originalNotification;
              logger.info('Restored original Notification API after SDK initialization');
            }
          }
        } catch (apiError) {
          logger.error('Failed to initialize RecallAI API', apiError);
          throw new Error('Failed to initialize RecallAI API');
        }
      } else {
        logger.error('No API key provided');
        throw new Error('RecallAI API key is required');
      }
      this.isInitialized = true;

      // Initialize transcript correction service if API key provided
      this.transcriptCorrectionService.initialize(anthropicApiKey);

      // Initialize insights generation service if API key provided
      this.insightsGenerationService.initialize(anthropicApiKey);

      logger.info('RecallAI SDK and API service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize RecordingService', { error });
      throw error;
    }
  }

  private setupSDKEventListeners(): void {
    logger.info('Setting up SDK event listeners');
    
    try {
      const RecallAiSdk = require('@recallai/desktop-sdk').default;
      
      // Verify SDK is loaded
      logger.info('SDK module loaded, available methods:', Object.keys(RecallAiSdk));
      
      // Add a catch-all listener to debug ANY SDK event
      // NOTE: 'realtime-event' is handled separately below for transcript processing
      const allEvents = [
        'meeting-detected', 'meeting-updated', 'meeting-closed',
        'recording-started', 'recording-ended', 'upload-progress',
        'sdk-state-change', 'error', 'permission-status',
        'media-capture-status', 'participant-capture-status',
        'permissions-granted', 'shutdown'
      ];
      
      let eventListenerCount = 0;
      
      allEvents.forEach(eventName => {
        try {
          RecallAiSdk.addEventListener(eventName, (event: any) => {
            logger.info(`📡 SDK Event Received: ${eventName}`, {
              eventName,
              event: JSON.stringify(event, null, 2),
              timestamp: new Date().toISOString()
            });
          });
          eventListenerCount++;
          logger.debug(`Added listener for: ${eventName}`);
        } catch (err) {
          logger.error(`Failed to add listener for ${eventName}:`, err);
        }
      });
      
      logger.info(`Successfully added ${eventListenerCount} event listeners`);
      
      // CRITICAL: Listen for meeting detection from the SDK
      RecallAiSdk.addEventListener('meeting-detected', (event: any) => {
        logger.info('[JOURNEY-1] 🎯 Meeting detected by RecallAI SDK!', {
          windowId: event.window?.id,
          platform: event.window?.platform,
          title: event.window?.title,
          url: event.window?.url,
          timestamp: new Date().toISOString(),
          eventData: JSON.stringify(event)
        });
        
        // Store the window ID for recording
        if (event.window?.id) {
          this.currentWindowId = event.window.id;
        }
        
        // Forward the event to MeetingDetectionService
        // Handle null title properly (SDK returns null, not undefined)
        const meetingTitle = event.window?.title ||
                           `${(event.window?.platform || 'unknown').charAt(0).toUpperCase() + (event.window?.platform || 'unknown').slice(1)} Meeting`;

        const eventData = {
          windowId: event.window?.id || `unknown-${Date.now()}`,
          platform: event.window?.platform || 'unknown',
          title: meetingTitle,
          url: event.window?.url,
          meetingTitle: meetingTitle  // Add explicit meetingTitle field
        };
        logger.info('[JOURNEY-2] Emitting sdk-meeting-detected event', eventData);
        this.emit('sdk-meeting-detected', eventData);
      });

      // Listen for meeting updates
      RecallAiSdk.addEventListener('meeting-updated', (event: any) => {
        logger.info('Meeting updated by SDK', { window: event.window });
        this.emit('sdk-meeting-updated', event.window);
      });

      // Listen for meeting closed (window closed)
      RecallAiSdk.addEventListener('meeting-closed', async (event: any) => {
        logger.info('Meeting closed by SDK - window has been closed', {
          window: event.window,
          currentWindowId: this.currentWindowId,
          isRecording: this.recordingState.isRecording,
          windowIdMatch: event.window?.id === this.currentWindowId
        });
        this.emit('sdk-meeting-closed', event.window);

        // Auto-stop recording if this was the window being recorded
        if (this.recordingState.isRecording && event.window?.id === this.currentWindowId) {
          logger.info('Auto-stopping recording as meeting window was closed');
          try {
            const meetingId = this.recordingState.meetingId;
            await this.stopRecording();

            // Emit detailed event for UI notification
            this.emit('recording-auto-stopped', {
              reason: 'window-closed',
              meetingId,
              transcriptCount: this.transcriptBuffers.get(meetingId || '')?.length || 0
            });

            logger.info('Recording automatically stopped after window closed');
          } catch (err) {
            logger.error('Failed to auto-stop recording on window close', err);
          }
        } else if (this.recordingState.isRecording) {
          logger.info('Meeting window closed but not the one being recorded', {
            closedWindowId: event.window?.id,
            recordingWindowId: this.currentWindowId
          });
        }
      });
      
      // Listen for recording state changes
      RecallAiSdk.addEventListener('recording-started', (event: any) => {
        logger.info('Recording started event received', { windowId: event.window?.id });
        this.recordingState.connectionStatus = 'connected';
        this.emit('connection-status', 'connected');
      });

      RecallAiSdk.addEventListener('recording-ended', async (event: any) => {
        logger.info('Recording ended event received - meeting has finished', {
          windowId: event.window?.id,
          transcriptBufferLength: this.transcriptBuffer.length,
          bufferContent: this.transcriptBuffer.map(t => ({ speaker: t.speaker, text: t.text.substring(0, 50) }))
        });

        if (this.transcriptBuffer.length === 0) {
          logger.warn('No real-time transcripts received during recording');
        } else {
          logger.info('Recording completed with real-time transcripts', {
            totalChunks: this.transcriptBuffer.length
          });
        }

        // Automatically stop the recording when the meeting ends
        if (this.recordingState.isRecording) {
          logger.info('Meeting ended - automatically stopping recording');
          try {
            const meetingId = this.recordingState.meetingId;
            await this.stopRecording();
            logger.info('Recording automatically stopped after meeting ended');

            // Emit event for UI notification
            this.emit('recording-auto-stopped', {
              reason: 'meeting-ended',
              meetingId,
              transcriptCount: this.transcriptBuffers.get(meetingId || '')?.length || 0
            });
          } catch (error) {
            logger.error('Failed to automatically stop recording after meeting ended', { error });
          }
        }
      });

      RecallAiSdk.addEventListener('shutdown', (event: any) => {
        logger.warn('Recall SDK shutdown event received', {
          event: typeof event === 'string' ? event : JSON.stringify(event)
        });
        this.emit('sdk-shutdown', event);
      });

      // Listen for upload progress
      RecallAiSdk.addEventListener('upload-progress', (event: any) => {
        logger.info('Upload progress', { progress: event.progress });
        this.emit('upload-progress', event.progress);
      });

      // Handle errors
      RecallAiSdk.addEventListener('error', (error: any) => {
        logger.error('SDK error', { error });
        this.emit('error', error);
        if (error?.type === 'process') {
          this.emit('sdk-process-error', error);
        }
      });

      // Handle SDK state changes
      RecallAiSdk.addEventListener('sdk-state-change', (event: any) => {
        logger.info('SDK state changed', { state: event.sdk?.state?.code });
      });

      // Monitor permission status
      RecallAiSdk.addEventListener('permission-status', (event: any) => {
        logger.info('Permission status from SDK', { 
          permission: event.permission,
          status: event.status 
        });
      });

      /**
       * REAL-TIME TRANSCRIPTION EVENT HANDLER
       *
       * The Recall.ai Desktop SDK provides real-time transcripts during recording.
       * Events are emitted as 'realtime-event' with transcript data.
       */
      RecallAiSdk.addEventListener('realtime-event', async (event: any) => {
        // Log EVERY realtime event to understand what's coming through
        logger.info('🎤 Real-time event from SDK', {
          windowId: event.window?.id,
          eventType: event.type || event.event,
          eventString: event.event,
          hasData: !!event.data,
          dataKeys: event.data ? Object.keys(event.data) : [],
          fullEvent: JSON.stringify(event, null, 2)
        });

        // Also log to console for immediate visibility
        console.log('🔴 REALTIME EVENT RECEIVED:', {
          event: event.event,
          data: event.data,
          window: event.window?.id
        });

        // Handle real-time transcript chunks
        if (event.event === 'transcript.data' || event.event === 'transcript.partial_data') {
          logger.info('📝 TRANSCRIPT EVENT DETECTED!', {
            eventType: event.event,
            hasData: !!event.data
          });

          // Log the actual structure to debug
          if (event.data) {
            logger.info('📊 Event data structure:', {
              hasTranscript: !!event.data.transcript,
              hasData: !!event.data.data,
              transcriptKeys: event.data.transcript ? Object.keys(event.data.transcript) : [],
              dataKeys: event.data.data ? Object.keys(event.data.data) : []
            });

            // Check for words in different locations
            if (event.data.data) {
              logger.info('📊 Data.data structure:', {
                hasWords: !!event.data.data.words,
                hasTranscript: !!event.data.data.transcript,
                dataDataKeys: Object.keys(event.data.data)
              });

              // Log the actual transcript content if it exists
              if (event.data.data.transcript) {
                logger.info('📊 Transcript content:', {
                  transcriptType: typeof event.data.data.transcript,
                  transcriptLength: JSON.stringify(event.data.data.transcript).length,
                  transcriptSample: JSON.stringify(event.data.data.transcript).substring(0, 200)
                });
              }
            }
          }

          // Parse the transcript data based on the Recall.ai format
          let transcriptText = '';
          let speaker = '';

          if (event.data && event.data.data && event.data.data.words && Array.isArray(event.data.data.words) && event.data.data.words.length > 0) {
            // Recall.ai Desktop SDK format - combine all words
            const words = event.data.data.words;
            transcriptText = words.map((w: any) => w.text).join(' ');

            // Get speaker from participant data
            if (event.data.data.participant) {
              const participantName = event.data.data.participant.name;
              const participantId = event.data.data.participant.id;

              // Better speaker identification
              if (participantName && participantName !== 'Host' && participantName !== 'Guest') {
                speaker = participantName;
              } else if (participantId) {
                // Track unknown speakers with consistent numbering
                if (!this.speakerMap.has(participantId)) {
                  this.unknownSpeakerCount++;
                  this.speakerMap.set(participantId, `Speaker ${this.unknownSpeakerCount}`);
                }
                speaker = this.speakerMap.get(participantId) || 'Unknown Speaker';
              } else {
                speaker = 'Unknown Speaker';
              }
            } else {
              speaker = 'Unknown Speaker';
            }
          } else if (event.data && (event.data.text || event.data.content)) {
            // Fallback for other formats - but only if we have actual text
            transcriptText = event.data.text || event.data.content || '';
            const rawSpeaker = event.data.speaker || event.data.speaker_name || '';

            // Apply same speaker logic for fallback format
            if (rawSpeaker && rawSpeaker !== 'Unknown' && rawSpeaker !== 'Host' && rawSpeaker !== 'Guest') {
              speaker = rawSpeaker;
            } else {
              speaker = 'Unknown Speaker';
            }
          } else {
            // No valid transcript data - skip processing
            logger.debug('📊 Skipping event - no valid transcript data found');
            return;
          }

          // Only process if we have actual text
          if (transcriptText && transcriptText.trim().length > 0) {
            const chunk: TranscriptChunk = {
              timestamp: new Date(),
              speaker: speaker,
              text: transcriptText
            };

            logger.info('📝 Processing transcript chunk', {
              speaker: chunk.speaker,
              textLength: chunk.text.length,
              text: chunk.text.substring(0, 100) // Log first 100 chars
            });

            // Add to both global and meeting-specific buffers
            this.transcriptBuffer.push(chunk);

            if (this.recordingState.meetingId) {
              const buffer = this.transcriptBuffers.get(this.recordingState.meetingId);
              if (buffer) {
                buffer.push(chunk);
              }
            }

            this.emit('transcript-chunk', chunk);

            // Append to meeting file in real-time
            if (this.recordingState.meetingId) {
              await this.storageService.appendTranscript(
                this.recordingState.meetingId,
                chunk
              );
            }
          }
        }
      });

      // Handle media capture status
      RecallAiSdk.addEventListener('media-capture-status', (event: any) => {
        logger.info('Media capture status', { 
          window: event.window,
          type: event.type,
          capturing: event.capturing 
        });
        this.emit('media-capture-status', event);
      });

      // Handle participant capture status
      RecallAiSdk.addEventListener('participant-capture-status', (event: any) => {
        logger.info('Participant capture status', { 
          window: event.window,
          type: event.type,
          capturing: event.capturing 
        });
        this.emit('participant-capture-status', event);
      });
    } catch (error) {
      logger.warn('Could not set up SDK event listeners:', error);
    }
  }

  async startRecording(meetingId: string): Promise<void> {
    logger.info('[RECORDING-START] startRecording called', {
      meetingId,
      currentState: this.recordingState,
      timestamp: new Date().toISOString()
    });

    try {
      if (this.recordingState.isRecording) {
        const error = new Error('Recording already in progress');
        logger.warn('[RECORDING-START] Recording already in progress', {
          requestedMeetingId: meetingId,
          currentMeetingId: this.recordingState.meetingId,
          error: error.message
        });
        throw error;
      }

      // SDK health check before starting
      logger.info('[RECORDING-START] Performing SDK health check');
      const healthCheckStart = Date.now();
      try {
        const RecallAiSdk = require('@recallai/desktop-sdk').default;
        // Quick SDK responsiveness check - just verify SDK is initialized
        // Permissions are handled by SDK config, no need to request again
        if (!RecallAiSdk) {
          throw new Error('SDK not initialized');
        }
        logger.info('[RECORDING-START] SDK health check passed', {
          durationMs: Date.now() - healthCheckStart
        });
      } catch (error: any) {
        logger.error('[RECORDING-START] SDK health check failed', {
          error: error.message,
          stack: error.stack,
          durationMs: Date.now() - healthCheckStart
        });
        throw new Error('Recording system not ready. Please restart the app.');
      }

      // Create meeting-specific buffer instead of clearing global one
      if (!this.transcriptBuffers.has(meetingId)) {
        this.transcriptBuffers.set(meetingId, []);
        logger.info('[RECORDING-START] Created transcript buffer for meeting', { meetingId });
      }

      // Only reset speaker tracking for new meetings
      this.unknownSpeakerCount = 0;
      this.speakerMap.clear();

      if (!this.recallApiService) {
        const error = new Error('RecallApiService not initialized');
        logger.error('[RECORDING-START] RecallApiService not initialized', {
          meetingId,
          error: error.message
        });
        throw error;
      }

    try {
      logger.info('[JOURNEY-10] Starting recording', {
        meetingId,
        currentWindowId: this.currentWindowId,
        timestamp: new Date().toISOString()
      });
      console.log('[JOURNEY] RecordingService: Starting recording for meeting:', meetingId);
      
      // Get meeting details
      logger.info('[JOURNEY-11] Getting meeting from storage...', { meetingId });
      const meeting = await this.storageService.getMeeting(meetingId);
      logger.info('[JOURNEY-12] Meeting loaded from storage', {
        meetingId,
        found: !!meeting,
        title: meeting?.title,
        status: meeting?.status
      });
      if (!meeting) {
        const error = new Error(`Meeting ${meetingId} not found`);
        console.error('Meeting not found:', meetingId);
        throw error;
      }
      console.log('Found meeting:', meeting.title);
      
      // Create an SDK upload session with recall.ai API
      logger.info('[JOURNEY-13] Creating SDK upload with recall.ai API...', {
        meetingId,
        title: meeting.title,
        timestamp: new Date().toISOString()
      });
      console.log('[JOURNEY] Creating upload for:', meeting.title);
      
      let uploadData;
      const uploadStart = Date.now();
      try {
        uploadData = await this.recallApiService.createSdkUpload(meetingId, meeting.title);
        logger.info('[RECORDING-START] Upload created successfully', {
          uploadId: uploadData.id,
          durationMs: Date.now() - uploadStart
        });
        console.log('Upload created:', uploadData.id);

        // Check if local transcription is needed
        if ((uploadData as any).needsLocalTranscription) {
          logger.warn('[TRANSCRIPTION-UNAVAILABLE] No cloud transcription credentials configured', {
            note: 'Recording will continue without real-time transcription',
            suggestion: 'Configure AssemblyAI or Deepgram credentials at https://us-west-2.recall.ai/dashboard/transcription'
          });

          // Emit warning to UI
          this.emit('transcription-warning', {
            message: 'Recording without transcription - credentials not configured',
            details: 'Transcripts may be available after recording ends if post-processing is enabled'
          });
        }
      } catch (apiError: any) {
        logger.error('Failed to create SDK upload', { error: apiError.message });
        console.error('API Error creating upload:', apiError);
        throw apiError;
      }

      this.currentUploadToken = uploadData.upload_token;

      // If we don't have a window ID, wait for meeting detection
      if (!this.currentWindowId) {
        logger.info('[RECORDING-START] No current window ID, waiting for meeting detection...', {
          meetingId,
          currentWindowId: this.currentWindowId
        });

        // Wait up to 10 seconds for a meeting to be detected
        for (let i = 0; i < 10; i++) {
          await new Promise(resolve => setTimeout(resolve, 1000));

          if (this.currentWindowId) {
            logger.info('[RECORDING-START] Found window ID after waiting', {
              windowId: this.currentWindowId,
              waitTime: `${i + 1} seconds`
            });
            break;
          }

          logger.info('[RECORDING-START] Still waiting for meeting detection...', {
            attempt: i + 1,
            maxAttempts: 10
          });
        }

        // If still no window ID after waiting, throw error
        if (!this.currentWindowId) {
          const errorMsg = 'No meeting window detected after waiting 10 seconds. Please make sure you\'re in an active meeting (Zoom, Teams, etc.) before starting recording.';
          logger.error('[RECORDING-START-ERROR] Missing window ID after wait', {
            error: errorMsg,
            meetingId,
            waitTime: '10 seconds'
          });
          throw new Error(errorMsg);
        }
      }

      const windowId = this.currentWindowId;
      logger.info('Using window ID for recording', { windowId, currentWindowId: this.currentWindowId });

      // Permissions are checked by PermissionService in index.ts before startRecording is called
      // No need to request them again here

      // Start recording with the SDK using the upload token
      logger.info('[RECORDING-START] Calling SDK startRecording', {
        windowId,
        hasUploadToken: !!uploadData.upload_token
      });
      const sdkStart = Date.now();
      const RecallAiSdk = require('@recallai/desktop-sdk').default;
      await RecallAiSdk.startRecording({
        windowId: windowId,
        uploadToken: uploadData.upload_token
      });
      logger.info('[RECORDING-START] SDK startRecording completed', {
        durationMs: Date.now() - sdkStart
      });

      this.recordingState = {
        isRecording: true,
        meetingId,
        startTime: new Date(),
        connectionStatus: 'connected',
        uploadId: uploadData.id
      };

      logger.info('Real-time transcription enabled via SDK events', {
        uploadId: uploadData.id,
        meetingId: meetingId
      });

      // Start auto-save for notes
      this.storageService.startAutoSave(meetingId);

      // Start auto-save interval for transcripts
      this.autoSaveInterval = setInterval(() => {
        this.flushTranscriptBuffer(meetingId);
      }, 10000); // Every 10 seconds

      // Update meeting status
      await this.storageService.updateMeeting(meetingId, {
        status: 'recording',
        recallRecordingId: uploadData.id
      });

      this.emit('recording-started', { meetingId });
      logger.info('Recording started successfully', { 
        meetingId, 
        uploadId: uploadData.id,
        isRecording: this.recordingState.isRecording 
      });
    } catch (error: any) {
      logger.error('[RECORDING-START-ERROR] Failed to start recording', {
        meetingId,
        error: error.message,
        stack: error.stack,
        code: error.code,
        timestamp: new Date().toISOString()
      });

      // Clean up auto-save intervals on error
      if (this.autoSaveInterval) {
        clearInterval(this.autoSaveInterval);
        this.autoSaveInterval = null;
      }
      this.storageService.stopAutoSave(meetingId);

      // Reset state on error
      this.recordingState = {
        isRecording: false,
        connectionStatus: 'disconnected'
      };

      // Emit error event for UI
      this.emit('recording-error', {
        meetingId,
        error: error.message || 'Unknown error occurred while starting recording'
      });

      throw error;
    }
    } catch (outerError: any) {
      // Catch any errors from the outer try block
      logger.error('[RECORDING-START-FATAL] Fatal error in startRecording', {
        meetingId,
        error: outerError.message,
        stack: outerError.stack,
        timestamp: new Date().toISOString()
      });

      // Ensure state is reset
      this.recordingState = {
        isRecording: false,
        connectionStatus: 'disconnected'
      };

      throw outerError;
    }
  }

  async stopRecording(): Promise<boolean> {
    logger.info('[RECORDING-STOP] stopRecording called', {
      currentState: this.recordingState,
      timestamp: new Date().toISOString()
    });

    if (!this.recordingState.isRecording) {
      logger.warn('[RECORDING-STOP] No recording to stop');
      return false;
    }

    // CRITICAL FIX: Set isRecording to false IMMEDIATELY to prevent concurrent calls
    // Store the meetingId before clearing the state
    const meetingId = this.recordingState.meetingId;
    const startTime = this.recordingState.startTime;

    logger.info('[RECORDING-STOP] Setting isRecording to false immediately to prevent race conditions', {
      meetingId,
      timestamp: new Date().toISOString()
    });

    // Set isRecording to false immediately to prevent concurrent execution
    this.recordingState = {
      ...this.recordingState,
      isRecording: false
    };

    // Clear auto-save interval
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }

    // Final flush of transcript buffer
    if (meetingId) {
      await this.flushTranscriptBuffer(meetingId);
    }

    const stopStart = Date.now();
    try {
      logger.info('[RECORDING-STOP] Beginning stop sequence', {
        meetingId: meetingId,
        recordingDuration: startTime ?
          Date.now() - startTime.getTime() : null
      });

      if (this.currentWindowId) {
        // Stop the SDK recording
        try {
          const RecallAiSdk = require('@recallai/desktop-sdk').default;
          logger.info('[RECORDING-STOP] Stopping SDK recording');
          await RecallAiSdk.stopRecording({ windowId: this.currentWindowId });
          logger.info('[RECORDING-STOP] Uploading recording');
          await RecallAiSdk.uploadRecording({ windowId: this.currentWindowId });
          logger.info('[RECORDING-STOP] Upload complete');
        } catch (sdkError: any) {
          logger.warn('[RECORDING-STOP] Failed to stop SDK recording', {
            error: sdkError.message,
            windowId: this.currentWindowId
          });
        }
      }

      if (meetingId) {
        this.storageService.stopAutoSave(meetingId);

        // Get the current meeting to access transcript
        const meeting = await this.storageService.getMeeting(meetingId);

        // Correct transcript if available and correction service is initialized
        if (meeting && meeting.transcript && this.transcriptCorrectionService.isAvailable()) {
          logger.info('Starting transcript correction for meeting', { meetingId });
          try {
            const correctedTranscript = await this.transcriptCorrectionService.correctTranscript(
              meeting.transcript,
              meetingId
            );

            // Update meeting with corrected transcript
            await this.storageService.updateMeeting(meetingId, {
              transcript: correctedTranscript
            });

            logger.info('Transcript correction completed', { meetingId });
          } catch (error) {
            logger.error('Failed to correct transcript', { meetingId, error });
            // Continue with original transcript if correction fails
          }
        }

        // Update meeting status to completed
        await this.storageService.updateMeeting(meetingId, {
          status: 'completed',
          duration: startTime
            ? Math.floor((Date.now() - startTime.getTime()) / 1000 / 60)
            : undefined,
        });

        // Fetch final transcript from Recall AI in background (non-blocking)
        // This will attempt to replace the real-time transcript with a more accurate version
        if (meeting && meeting.recallRecordingId && this.recallApiService) {
          logger.info('[RECORDING-STOP] Starting background final transcript fetch', {
            meetingId,
            recordingId: meeting.recallRecordingId
          });
          this.fetchFinalTranscriptInBackground(meetingId, meeting.recallRecordingId);
        }

        // Clear the upload from API service
        if (this.recallApiService) {
          this.recallApiService.clearUpload(meetingId);
        }
      }

      // Finalize the recording state (isRecording already set to false above)
      this.recordingState = {
        isRecording: false,
        connectionStatus: 'connected',
      };

      // Don't clear the buffer here - let the recording-ended event handler access it first
      // The buffer will be cleared when starting a new recording
      this.currentWindowId = null;
      this.currentUploadToken = null;

      this.emit('recording-stopped');
      logger.info('Recording stopped successfully', { meetingId });
      return true;
    } catch (error) {
      logger.error('Failed to stop recording', { error });
      throw error;
    }
  }



  private formatTranscriptBuffer(): string {
    return this.transcriptBuffer
      .map(chunk => {
        const time = chunk.timestamp.toLocaleTimeString();
        return chunk.speaker 
          ? `[${time}] ${chunk.speaker}: ${chunk.text}`
          : `[${time}] ${chunk.text}`;
      })
      .join('\n');
  }

  // Called by MeetingDetectionService when a meeting window is detected
  setCurrentWindow(windowId: string): void {
    this.currentWindowId = windowId;
    logger.info('Current window set', { windowId });
  }

  getRecordingState(): RecordingState {
    return { ...this.recordingState };
  }

  isRecording(): boolean {
    return this.recordingState.isRecording;
  }

  getInitializedStatus(): boolean {
    return this.isInitialized;
  }

  async addTranscriptChunk(meetingId: string, chunk: any): Promise<void> {
    if (!this.recordingState.isRecording || this.recordingState.meetingId !== meetingId) {
      logger.warn('Cannot add transcript chunk - not recording this meeting', { meetingId });
      return;
    }

    const transcriptChunk: TranscriptChunk = {
      timestamp: new Date(chunk.timestamp),
      speaker: chunk.speaker,
      text: chunk.text
    };

    this.transcriptBuffer.push(transcriptChunk);
    logger.info('Transcript chunk added', { meetingId, speaker: chunk.speaker });
  }

  getCorrectionService(): TranscriptCorrectionService {
    return this.transcriptCorrectionService;
  }

  getInsightsService(): InsightsGenerationService {
    return this.insightsGenerationService;
  }

  private async flushTranscriptBuffer(meetingId: string) {
    const buffer = this.transcriptBuffers.get(meetingId);
    if (buffer && buffer.length > 0) {
      logger.info(`Auto-saving ${buffer.length} transcript chunks for meeting ${meetingId}`);
      // The chunks are already being persisted in real-time via appendTranscript
      // This is just a log for monitoring
    }
  }

  /**
   * Fetch final transcript from Recall AI in the background after recording ends.
   * This runs asynchronously without blocking the stop recording flow.
   * If successful, replaces the real-time transcript with a more accurate version.
   * If it fails, silently keeps the real-time transcript.
   */
  private fetchFinalTranscriptInBackground(meetingId: string, recordingId: string): void {
    // Fire and forget - runs in background, no blocking
    setTimeout(async () => {
      try {
        logger.info('[FINAL-TRANSCRIPT] Starting background fetch', { meetingId, recordingId });

        // Poll every 10 seconds, max 10 attempts (100 seconds total)
        for (let attempt = 1; attempt <= 10; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds

          logger.info('[FINAL-TRANSCRIPT] Polling attempt', { attempt, meetingId });

          try {
            const transcript = await this.recallApiService!.getTranscript(recordingId);

            if (transcript && transcript.length > 0) {
              // Format to same structure as real-time transcript
              const formatted = this.formatRecallTranscript(transcript);

              logger.info('[FINAL-TRANSCRIPT] Retrieved final transcript', {
                meetingId,
                wordCount: transcript.length,
                formattedLength: formatted.length
              });

              // Replace real-time transcript with final version
              await this.storageService.updateTranscript(meetingId, formatted);

              logger.info('[FINAL-TRANSCRIPT] Successfully replaced with final transcript', { meetingId });
              return; // Success - exit polling
            }
          } catch (pollError) {
            logger.debug('[FINAL-TRANSCRIPT] Poll attempt failed', {
              attempt,
              error: pollError instanceof Error ? pollError.message : String(pollError)
            });
            // Continue polling
          }
        }

        // All attempts exhausted
        logger.info('[FINAL-TRANSCRIPT] Final transcript not available after 10 attempts, keeping real-time version', {
          meetingId
        });

      } catch (error) {
        // Silently fail - real-time transcript is already saved
        logger.debug('[FINAL-TRANSCRIPT] Background fetch failed, keeping real-time transcript', {
          meetingId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }, 30000); // Wait 30 seconds after recording stops before first attempt
  }

  /**
   * Format Recall AI transcript response to match our real-time transcript format
   */
  private formatRecallTranscript(words: TranscriptResponse[]): string {
    // Group words by speaker and create timestamped lines
    const lines: string[] = [];

    for (const word of words) {
      const timestamp = new Date(word.timestamp * 1000);
      const time = timestamp.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });

      const speaker = word.speaker || 'Unknown';
      const line = `[${time}] ${speaker}: ${word.text}`;
      lines.push(line);
    }

    return lines.join('\n');
  }
}