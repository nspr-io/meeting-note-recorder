import { EventEmitter } from 'events';
import { StorageService } from './StorageService';
import { RecallApiService, TranscriptResponse } from './RecallApiService';
import { TranscriptChunk, RecordingState } from '../../shared/types';
import crypto from 'crypto';
import { SDKDebugger } from './SDKDebugger';
import { TranscriptCorrectionService } from './TranscriptCorrectionService';
import { InsightsGenerationService } from './InsightsGenerationService';
import { PromptService } from './PromptService';
import { PermissionService } from './PermissionService';
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
  private partialChunkIndex = new Map<string, TranscriptChunk>();
  private isInitialized = false;
  private sdkDebugger: SDKDebugger;
  private unknownSpeakerCount = 0;
  private speakerMap: Map<string, string> = new Map();
  private autoSaveInterval: NodeJS.Timeout | null = null;
  private finalizationTasks = new Map<string, Promise<void>>();

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

            // ============================================================================
            // CRITICAL: Event listeners MUST be set up BEFORE SDK init
            // ============================================================================
            // The Recall.ai SDK starts firing events immediately during init().
            // If addEventListener is called AFTER init, early events (especially realtime-event)
            // will be dropped/lost because there's no event buffering in the SDK.
            //
            // This was confirmed by comparing:
            // - Oct 2, 2025: Listeners BEFORE init → realtime events worked ✅
            // - Oct 3, 2025: Listeners AFTER init → realtime events lost ❌
            //
            // CODE VERSION MARKER: v2025-10-03-listeners-before-init-with-permissions
            // ============================================================================
            logger.info('🔧 [CODE-VERSION] v2025-10-03-all-permissions-in-sdk-init');
            logger.info('🎯 [CRITICAL-FIX] Setting up SDK event listeners BEFORE init to catch all events');
            this.setupSDKEventListeners();
            logger.info('✅ [LISTENERS-READY] All SDK event listeners configured BEFORE init');

            // ============================================================================
            // PERMISSION MANAGEMENT
            // ============================================================================
            // Check which permissions are already granted BEFORE SDK init
            // Only request permissions that are already granted to avoid repeated prompts
            // SDK needs these permissions to set up its audio capture pipeline
            // ============================================================================
            logger.info('🔐 [PERMISSIONS] Checking current permission status before SDK init');
            const permissionService = new PermissionService();
            const permissionStatus = await permissionService.checkAllPermissions();

            logger.info('🔐 [PERMISSIONS] Current permission status:', permissionStatus);

            // Build dynamic acquirePermissionsOnStartup array
            // Only include permissions that are already granted
            const permissionsToAcquire: Array<'accessibility' | 'screen-capture' | 'microphone'> = [];

            if (permissionStatus.accessibility) {
              permissionsToAcquire.push('accessibility');
              logger.info('✅ [PERMISSIONS] Will acquire: accessibility (already granted)');
            } else {
              logger.warn('⚠️ [PERMISSIONS] Skipping: accessibility (not granted)');
            }

            if (permissionStatus['screen-capture']) {
              permissionsToAcquire.push('screen-capture');
              logger.info('✅ [PERMISSIONS] Will acquire: screen-capture (already granted)');
            } else {
              logger.warn('⚠️ [PERMISSIONS] Skipping: screen-capture (not granted)');
            }

            if (permissionStatus.microphone) {
              permissionsToAcquire.push('microphone');
              logger.info('✅ [PERMISSIONS] Will acquire: microphone (already granted)');
            } else {
              logger.warn('⚠️ [PERMISSIONS] Skipping: microphone (not granted)');
            }

            logger.info('🔐 [PERMISSIONS] Final permissions to acquire:', permissionsToAcquire);

            // ============================================================================
            // CUSTOM BROWSER SUPPORT FOR GOOGLE MEET
            // ============================================================================
            // The Recall.ai SDK officially only supports Google Meet in Chrome.
            // However, it can detect meetings in Chromium-based browsers (Arc, Brave, Edge, Comet)
            // by overriding the GOOGLE_MEET_BUNDLE_ID environment variable.
            //
            // Set this BEFORE SDK init so it's passed to the native SDK process.
            // ============================================================================

            // Support for Comet browser (Chromium-based by Perplexity)
            if (!process.env.GOOGLE_MEET_BUNDLE_ID) {
              // Allow multiple bundle IDs separated by comma for broader Chromium browser support
              // This enables Google Meet detection in: Chrome, Comet, Arc, Brave, Edge, etc.
              process.env.GOOGLE_MEET_BUNDLE_ID = [
                'com.google.Chrome',        // Official Chrome
                'ai.perplexity.comet',      // Comet browser
                'company.thebrowser.Browser', // Arc browser
                'com.brave.Browser',        // Brave browser
                'com.microsoft.edgemac'     // Microsoft Edge
              ].join(',');

              logger.info('[BROWSER-SUPPORT] Extended Google Meet support to Chromium browsers:', {
                bundleIds: process.env.GOOGLE_MEET_BUNDLE_ID
              });
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

            logger.info('RecallAI SDK initialized successfully');

            // Permissions are managed by PermissionService, not SDK
            logger.info('Permissions will be checked by PermissionService before recording starts');

            // Start debugger helpers only in development to avoid production polling
            if (process.env.NODE_ENV === 'development') {
              this.sdkDebugger.startDebugging();
              await SDKDebugger.checkSDKPermissions();
            }

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
        const isDev = process.env.NODE_ENV === 'development';
        if (isDev) {
          logger.debug('🎤 Real-time event from SDK', {
            windowId: event.window?.id,
            eventType: event.type || event.event,
            eventString: event.event,
            hasData: !!event.data,
            dataKeys: event.data ? Object.keys(event.data) : [],
            fullEvent: JSON.stringify(event, null, 2)
          });
        } else {
          logger.debug('🎤 Real-time event from SDK', {
            windowId: event.window?.id,
            eventType: event.type || event.event,
            hasData: !!event.data
          });
        }

        // Handle real-time transcript chunks
        if (event.event === 'transcript.data' || event.event === 'transcript.partial_data') {
          logger.debug('📝 Transcript event detected', {
            eventType: event.event,
            hasData: !!event.data
          });

          if (event.data && isDev) {
            logger.debug('📊 Event data structure', {
              hasTranscript: !!event.data.transcript,
              hasData: !!event.data.data,
              transcriptKeys: event.data.transcript ? Object.keys(event.data.transcript) : [],
              dataKeys: event.data.data ? Object.keys(event.data.data) : []
            });

            if (event.data.data) {
              logger.debug('📊 Data.data structure', {
                hasWords: !!event.data.data.words,
                hasTranscript: !!event.data.data.transcript,
                dataDataKeys: Object.keys(event.data.data)
              });

              if (event.data.data.transcript) {
                logger.debug('📊 Transcript content preview', {
                  transcriptType: typeof event.data.data.transcript,
                  transcriptLength: JSON.stringify(event.data.data.transcript).length,
                  transcriptSample: JSON.stringify(event.data.data.transcript).substring(0, 200)
                });
              }
            }
          }

          const captureWindowId = event.window?.id;

          // Parse the transcript data based on the Recall.ai format
          let transcriptText = '';
          let speaker = '';
          let segmentId: string | undefined;
          let isFinal = event.event === 'transcript.data';

          // Extract segment/sequence identifiers for dedupe
          if (event.data?.data?.segment || event.data?.data?.sequenceId) {
            segmentId = String(event.data.data.segment ?? event.data.data.sequenceId);
          } else if (event.data?.segment || event.data?.sequenceId) {
            segmentId = String(event.data.segment ?? event.data.sequenceId);
          }

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

            logger.debug('📝 Processing transcript chunk', {
              speaker: chunk.speaker,
              textLength: chunk.text.length,
              text: chunk.text.substring(0, 100) // Log first 100 chars
            });

            // Add to both global and meeting-specific buffers
            this.storeTranscriptChunk(chunk, segmentId, isFinal, captureWindowId);

            // Append to meeting file in real-time
            if (this.recordingState.meetingId) {
              await this.storageService.appendTranscript(this.recordingState.meetingId, chunk, {
                dedupeKey: segmentId,
                replace: isFinal
              });
              chunk.persisted = true;
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

      // Reset buffers for this meeting to avoid stale duplicates when resuming
      this.transcriptBuffers.set(meetingId, []);
      this.transcriptBuffer = [];
      this.partialChunkIndex.clear();
      logger.info('[RECORDING-START] Initialized transcript buffers for meeting', { meetingId });

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

      // CRITICAL: Prepare desktop audio recording BEFORE starting
      // This sets up the audio pipeline and requests system-audio permission
      // Without this, audio is captured locally but not sent to Recall.ai for transcription
      logger.info('[AUDIO-SETUP] Preparing desktop audio recording');
      const RecallAiSdk = require('@recallai/desktop-sdk').default;
      try {
        const audioDevice = await RecallAiSdk.prepareDesktopAudioRecording();
        logger.info('[AUDIO-SETUP] Desktop audio prepared successfully', {
          audioDevice,
          timestamp: new Date().toISOString()
        });
      } catch (audioError: any) {
        logger.error('[AUDIO-SETUP] Failed to prepare desktop audio', {
          error: audioError.message,
          note: 'Recording will continue but may not have audio transcription'
        });
        // Don't throw - allow recording to continue even if audio prep fails
      }

      // Start recording with the SDK using the upload token
      logger.info('[RECORDING-START] Calling SDK startRecording', {
        windowId,
        hasUploadToken: !!uploadData.upload_token
      });
      const sdkStart = Date.now();
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
        void this.flushTranscriptBuffer(meetingId);
      }, 10000); // Every 10 seconds

      // Update meeting status and store recording start time
      await this.storageService.updateMeeting(meetingId, {
        status: 'recording',
        recallRecordingId: uploadData.id,
        startTime: this.recordingState.startTime
      });

      this.emit('recording-started', { meetingId, startTime: this.recordingState.startTime });
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
    const windowId = this.currentWindowId;

    logger.info('[RECORDING-STOP] Setting isRecording to false immediately to prevent race conditions', {
      meetingId,
      timestamp: new Date().toISOString()
    });

    // Set isRecording to false immediately to prevent concurrent execution
    this.recordingState = {
      ...this.recordingState,
      isRecording: false,
      connectionStatus: 'connected'
    };

    // Clear auto-save interval
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }

    // Final flush of transcript buffer
    if (meetingId) {
      await this.flushTranscriptBuffer(meetingId);
      this.storageService.stopAutoSave(meetingId);
    }

    try {
      if (meetingId) {
        await this.storageService.updateMeeting(meetingId, {
          status: 'completed',
          duration: startTime
            ? Math.floor((Date.now() - startTime.getTime()) / 1000 / 60)
            : undefined,
        });
      }
    } catch (error) {
      logger.error('[RECORDING-STOP] Failed to update meeting status during stop', {
        meetingId,
        error
      });
      throw error;
    }

    this.emit('recording-stopped');
    logger.info('Recording stopped successfully', { meetingId });

    this.scheduleRecordingFinalization({
      meetingId: meetingId || undefined,
      windowId: windowId || undefined
    });

    this.currentWindowId = null;
    this.currentUploadToken = null;

    return true;
  }



  private formatTranscriptChunk(chunk: TranscriptChunk): string {
    const time = new Date(chunk.timestamp).toLocaleTimeString();
    return chunk.speaker
      ? `[${time}] ${chunk.speaker}: ${chunk.text}`
      : `[${time}] ${chunk.text}`;
  }

  private formatTranscriptBuffer(): string {
    return this.transcriptBuffer.map(chunk => this.formatTranscriptChunk(chunk)).join('\n');
  }

  private generateChunkHash(chunk: TranscriptChunk): string {
    const timestamp = new Date(chunk.timestamp).getTime();
    const timeBucket = Number.isNaN(timestamp) ? 0 : Math.floor(timestamp / 1000); // bucket to the nearest second
    const base = [
      (chunk.speaker || 'unknown').trim().toLowerCase(),
      (chunk.text || '').trim(),
      timeBucket
    ].join('|');
    return crypto.createHash('sha1').update(base).digest('hex');
  }

  private storeTranscriptChunk(
    chunk: TranscriptChunk,
    sequenceId?: string,
    isFinal = false,
    _windowId?: string,
    fromReplay = false
  ): void {
    const meetingId = this.recordingState.meetingId;
    if (!meetingId) {
      logger.warn('[TRANSCRIPT] Received chunk without active meeting', {
        sequenceId,
        textPreview: chunk.text?.substring(0, 50)
      });
      return;
    }

    const normalized: TranscriptChunk = {
      ...chunk,
      timestamp: new Date(chunk.timestamp),
      sequenceId,
      isFinal,
      partial: !isFinal,
      hash: chunk.hash || this.generateChunkHash(chunk),
      meetingId,
      persisted: chunk.persisted || false
    };

    let meetingBuffer = this.transcriptBuffers.get(meetingId);
    if (!meetingBuffer) {
      meetingBuffer = [];
      this.transcriptBuffers.set(meetingId, meetingBuffer);
    }

    const dedupeKey = sequenceId || normalized.hash;
    const existingPartial = dedupeKey ? this.partialChunkIndex.get(dedupeKey) : undefined;

    if (existingPartial) {
      if (isFinal) {
        this.partialChunkIndex.delete(dedupeKey!);
        logger.info('[TRANSCRIPT] Replacing partial chunk with final version', {
          meetingId,
          sequenceId: dedupeKey,
          previousText: existingPartial.text?.substring(0, 50),
          newText: normalized.text?.substring(0, 50)
        });
        this.replaceBufferChunk(meetingId, existingPartial, normalized);
      } else {
        // Partial update - replace text but keep in index
        existingPartial.text = normalized.text;
        existingPartial.timestamp = normalized.timestamp;
        existingPartial.hash = normalized.hash;
        return;
      }
    } else {
      if (dedupeKey && meetingBuffer) {
        const existing = meetingBuffer.find(item => (item.sequenceId || item.hash) === dedupeKey);
        if (existing) {
          if (isFinal) {
            this.replaceBufferChunk(meetingId, existing, normalized);
          }
          return;
        }
      }

      if (!isFinal && dedupeKey) {
        this.partialChunkIndex.set(dedupeKey, normalized);
      }

      this.transcriptBuffer.push(normalized);
      if (meetingBuffer) {
        meetingBuffer.push(normalized);
      }
    }

    this.emit('transcript-chunk', normalized);
  }

  private replaceBufferChunk(meetingId: string, existing: TranscriptChunk, replacement: TranscriptChunk) {
    const replace = (list: TranscriptChunk[]) => {
      const index = list.findIndex(item => item.hash === existing.hash || (item.sequenceId && item.sequenceId === existing.sequenceId));
      if (index >= 0) {
        list[index] = replacement;
      }
    };

    replace(this.transcriptBuffer);

    const meetingBuffer = this.transcriptBuffers.get(meetingId);
    if (meetingBuffer) {
      replace(meetingBuffer);
    }
  }

  getBufferedChunks(meetingId: string): TranscriptChunk[] {
    const buffer = this.transcriptBuffers.get(meetingId) || [];
    const deduped: TranscriptChunk[] = [];
    const indexByKey = new Map<string, number>();

    const computeKey = (chunk: TranscriptChunk): string => {
      if (chunk.sequenceId) {
        return `seq:${chunk.sequenceId}`;
      }
      if (chunk.hash) {
        return `hash:${chunk.hash}`;
      }
      const timestamp = new Date(chunk.timestamp).getTime();
      const bucket = Number.isNaN(timestamp) ? 0 : Math.floor(timestamp / 1000);
      const speaker = (chunk.speaker || 'unknown').trim().toLowerCase();
      const text = (chunk.text || '').trim();
      return `fallback:${speaker}:${bucket}:${text}`;
    };

    buffer.forEach(chunk => {
      const key = computeKey(chunk);
      const existingIndex = indexByKey.get(key);

      if (existingIndex === undefined) {
        indexByKey.set(key, deduped.length);
        deduped.push(chunk);
        return;
      }

      const existing = deduped[existingIndex];
      const incomingTime = new Date(chunk.timestamp).getTime();
      const existingTime = new Date(existing.timestamp).getTime();
      const preferIncoming =
        (!existing.isFinal && !!chunk.isFinal) ||
        (!existing.persisted && !!chunk.persisted) ||
        (Number.isFinite(incomingTime) && Number.isFinite(existingTime) && incomingTime > existingTime);

      if (preferIncoming) {
        deduped[existingIndex] = chunk;
      }
    });

    return deduped.map(chunk => ({
      ...chunk,
      timestamp: new Date(chunk.timestamp).toISOString()
    }));
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

  async addTranscriptChunk(meetingId: string, chunk: TranscriptChunk): Promise<void> {
    if (!this.recordingState.isRecording || this.recordingState.meetingId !== meetingId) {
      logger.warn('Cannot add transcript chunk - not recording this meeting', {
        meetingId,
        requestedMeetingId: this.recordingState.meetingId,
        isRecording: this.recordingState.isRecording
      });
      return;
    }

    const normalizedChunk: TranscriptChunk = {
      timestamp: new Date(chunk.timestamp),
      speaker: chunk.speaker,
      text: chunk.text,
      sequenceId: chunk.sequenceId,
      isFinal: chunk.isFinal,
      partial: chunk.partial,
      persisted: chunk.persisted,
      hash: chunk.hash,
      meetingId
    };

    this.storeTranscriptChunk(normalizedChunk, chunk.sequenceId, chunk.isFinal ?? false, undefined, true);
    logger.info('Transcript chunk added from external source', {
      meetingId,
      speaker: normalizedChunk.speaker,
      isFinal: normalizedChunk.isFinal,
      sequenceId: normalizedChunk.sequenceId
    });
  }

  getCorrectionService(): TranscriptCorrectionService {
    return this.transcriptCorrectionService;
  }

  getInsightsService(): InsightsGenerationService {
    return this.insightsGenerationService;
  }

  private async flushTranscriptBuffer(meetingId: string) {
    const buffer = this.transcriptBuffers.get(meetingId);
    if (!buffer || buffer.length === 0) {
      logger.info('[TRANSCRIPT-FLUSH] No buffered transcript chunks to flush', { meetingId });
      return;
    }

    const unsaved = buffer.filter(chunk => !chunk.persisted);
    if (unsaved.length === 0) {
      logger.info('[TRANSCRIPT-FLUSH] All buffered chunks already persisted', {
        meetingId,
        totalBuffered: buffer.length
      });
      return;
    }

    logger.info('[TRANSCRIPT-FLUSH] Flushing transcript buffer', {
      meetingId,
      pendingCount: unsaved.length
    });

    for (const chunk of unsaved) {
      let attempts = 0;
      const maxAttempts = 3;
      let success = false;

      while (!success && attempts < maxAttempts) {
        attempts++;
        try {
          await this.storageService.appendTranscript(meetingId, chunk);
          chunk.persisted = true;
          success = true;
        } catch (error) {
          logger.warn('[TRANSCRIPT-FLUSH] Failed to append transcript chunk', {
            meetingId,
            attempt: attempts,
            maxAttempts,
            error: error instanceof Error ? error.message : String(error)
          });

          if (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 250 * attempts));
          }
        }
      }

      if (!success) {
        logger.error('[TRANSCRIPT-FLUSH] Exhausted retry attempts for chunk', {
          meetingId,
          textPreview: chunk.text?.substring(0, 50)
        });
      }
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

  private scheduleRecordingFinalization(options: { meetingId?: string; windowId?: string }): void {
    const key = options.meetingId || options.windowId;
    if (!key) {
      return;
    }

    if (this.finalizationTasks.has(key)) {
      logger.info('[RECORDING-FINALIZE] Finalization already scheduled', { key });
      return;
    }

    const task = this.finalizeRecording(options).finally(() => {
      this.finalizationTasks.delete(key);
    });

    this.finalizationTasks.set(key, task);
  }

  private async finalizeRecording({ meetingId, windowId }: { meetingId?: string; windowId?: string }): Promise<void> {
    const finalizeStart = Date.now();
    logger.info('[RECORDING-FINALIZE] Starting background finalization', {
      meetingId,
      windowId
    });

    try {
      if (windowId) {
        try {
          const RecallAiSdk = require('@recallai/desktop-sdk').default;
          logger.info('[RECORDING-FINALIZE] Stopping SDK recording in background', { windowId });
          await RecallAiSdk.stopRecording({ windowId });
          logger.info('[RECORDING-FINALIZE] Uploading recording in background', { windowId });
          await RecallAiSdk.uploadRecording({ windowId });
          logger.info('[RECORDING-FINALIZE] Upload completed', { windowId });
        } catch (sdkError: any) {
          logger.warn('[RECORDING-FINALIZE] SDK finalization failed', {
            windowId,
            error: sdkError?.message || sdkError
          });
        }
      }

      if (meetingId) {
        let meeting;
        try {
          meeting = await this.storageService.getMeeting(meetingId);
        } catch (error) {
          logger.error('[RECORDING-FINALIZE] Failed to load meeting for finalization', {
            meetingId,
            error
          });
        }

        if (meeting && meeting.transcript && this.transcriptCorrectionService.isAvailable()) {
          logger.info('Starting transcript correction for meeting', { meetingId });
          try {
            const correctedTranscript = await this.transcriptCorrectionService.correctTranscript(meeting);
            await this.storageService.updateMeeting(meetingId, {
              transcript: correctedTranscript
            });
            logger.info('Transcript correction completed', { meetingId });
          } catch (error) {
            logger.error('Failed to correct transcript', { meetingId, error });
          }
        }

        if (meeting && meeting.recallRecordingId && this.recallApiService) {
          logger.info('[RECORDING-FINALIZE] Starting background final transcript fetch', {
            meetingId,
            recordingId: meeting.recallRecordingId
          });
          this.fetchFinalTranscriptInBackground(meetingId, meeting.recallRecordingId);
        }

        if (meetingId && this.recallApiService) {
          try {
            this.recallApiService.clearUpload(meetingId);
          } catch (error) {
            logger.warn('[RECORDING-FINALIZE] Failed to clear upload', {
              meetingId,
              error
            });
          }
        }
      }
    } catch (error) {
      logger.error('[RECORDING-FINALIZE] Unexpected error', { error });
    } finally {
      logger.info('[RECORDING-FINALIZE] Background finalization finished', {
        meetingId,
        windowId,
        durationMs: Date.now() - finalizeStart
      });
    }
  }

  async waitForFinalization(meetingId: string, timeoutMs = 120000): Promise<void> {
    if (!meetingId) {
      return;
    }

    const task = this.finalizationTasks.get(meetingId);
    if (!task) {
      return;
    }

    if (!timeoutMs || timeoutMs <= 0) {
      await task;
      return;
    }

    await Promise.race([
      task,
      new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error(`Finalization wait timeout for meeting ${meetingId}`)), timeoutMs);
      })
    ]);
  }
}