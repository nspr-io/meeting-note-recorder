import { getLogger } from './LoggingService';

const logger = getLogger();

export interface SdkUploadResponse {
  id: string;
  upload_token: string;
  recording_id?: string;
  status: string;
}

export interface TranscriptResponse {
  id: string;
  text: string;
  speaker: string;
  timestamp: number;
}

export class RecallApiService {
  private apiKey: string;
  private apiUrl: string;
  private activeUploads: Map<string, SdkUploadResponse> = new Map();
  private maxRetries = 3;
  private retryDelay = 1000; // Start with 1 second

  constructor(apiKey: string, apiUrl?: string) {
    this.apiKey = apiKey;
    // Use provided URL or default to us-west-2
    this.apiUrl = (apiUrl || process.env.RECALL_API_BASE || 'https://us-west-2.recall.ai').replace(/\/+$/, '');
    logger.info('RecallApiService initialized', { apiUrl: this.apiUrl });
  }

  /**
   * Helper method to retry failed API calls with exponential backoff
   */
  private async retryApiCall<T>(
    apiCall: () => Promise<Response>,
    operation: string
  ): Promise<Response> {
    let lastError: Error | null = null;
    let delay = this.retryDelay;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await apiCall();

        // Success or non-retryable error
        if (response.ok || response.status < 500) {
          return response;
        }

        // Server error - might be worth retrying
        lastError = new Error(`${operation} failed with status ${response.status}`);
        logger.warn(`[RETRY] ${operation} attempt ${attempt} failed`, {
          status: response.status,
          attempt,
          maxRetries: this.maxRetries
        });

      } catch (error: any) {
        // Network error - definitely worth retrying
        lastError = error;
        logger.warn(`[RETRY] ${operation} attempt ${attempt} failed with network error`, {
          error: error.message,
          attempt,
          maxRetries: this.maxRetries
        });
      }

      // Wait before next attempt (exponential backoff)
      if (attempt < this.maxRetries) {
        logger.info(`[RETRY] Waiting ${delay}ms before retry ${attempt + 1}`, {
          operation,
          delay
        });
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
      }
    }

    logger.error(`[RETRY] ${operation} failed after ${this.maxRetries} attempts`, {
      error: lastError?.message
    });
    throw lastError || new Error(`${operation} failed after ${this.maxRetries} attempts`);
  }

  /**
   * Create an SDK upload session for recording a meeting
   *
   * IMPORTANT: For real-time transcripts to work:
   * 1. Must include 'realtime_endpoints' configuration with type: 'desktop-sdk-callback'
   * 2. Must subscribe to events: ['transcript.data', 'transcript.partial_data']
   * 3. Provider must be configured in Recall.ai dashboard with proper API keys
   *    - For Deepgram: API key needs 'keys:write' scope
   *    - For AssemblyAI: Standard API key with transcription access
   */
  async createSdkUpload(meetingId: string, meetingTitle: string): Promise<SdkUploadResponse> {
    try {
      logger.info('[SDK-UPLOAD-START] Creating SDK upload', {
        meetingId,
        meetingTitle,
        apiUrl: this.apiUrl,
        timestamp: new Date().toISOString()
      });

      // Try with Deepgram first (currently configured in Recall.ai dashboard)
      const deepgramRequest = {
        meeting_title: meetingTitle,
        recording_config: {
          transcript: {
            provider: {
              deepgram_streaming: {
                model: "nova-2",
                language: "en-US",
                smart_format: true,
                punctuate: true,
                profanity_filter: false,
                diarize: true
              }
            }
          },
          // Enable real-time transcripts
          realtime_endpoints: [{
            type: 'desktop-sdk-callback',  // CRITICAL: hyphen not underscore!
            events: ['transcript.data', 'transcript.partial_data']
          }]
        }
      };

      logger.info('[SDK-UPLOAD-REQUEST-1] Trying Deepgram streaming provider', {
        request: deepgramRequest
      });

      let response = await this.retryApiCall(
        () => fetch(`${this.apiUrl}/api/v1/sdk-upload/`, {
          method: 'POST',
          headers: {
            'Authorization': `Token ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(deepgramRequest)
        }),
        'Create SDK Upload (Deepgram)'
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn('[SDK-UPLOAD-FAIL-1] Deepgram provider failed', {
          status: response.status,
          error: errorText,
          parsedError: (() => {
            try {
              return JSON.parse(errorText);
            } catch {
              return errorText;
            }
          })()
        });

        // Try with AssemblyAI as fallback
        const assemblyAiRequest = {
          meeting_title: meetingTitle,
          recording_config: {
            transcript: {
              provider: {
                assembly_ai_streaming: {
                  word_boost: [],
                  boost_param: "default"
                }
              }
            },
            // Enable real-time transcripts
            realtime_endpoints: [{
              type: 'desktop-sdk-callback',  // CRITICAL: hyphen not underscore!
              events: ['transcript.data', 'transcript.partial_data']
            }]
          }
        };

        logger.info('[SDK-UPLOAD-REQUEST-2] Trying AssemblyAI streaming provider as fallback', {
          request: assemblyAiRequest
        });

        response = await this.retryApiCall(
          () => fetch(`${this.apiUrl}/api/v1/sdk-upload/`, {
            method: 'POST',
            headers: {
              'Authorization': `Token ${this.apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(assemblyAiRequest)
          }),
          'Create SDK Upload (AssemblyAI)'
        );

        if (!response.ok) {
          const errorText2 = await response.text();
          logger.warn('[SDK-UPLOAD-FAIL-2] AssemblyAI provider also failed', {
            status: response.status,
            error: errorText2,
            parsedError: (() => {
              try {
                return JSON.parse(errorText2);
              } catch {
                return errorText2;
              }
            })()
          });

          // Both providers failed - cannot proceed without transcription
          throw new Error(`Failed to create SDK upload with transcription providers: ${response.status} - ${errorText2}`);
        } else {
          logger.info('[SDK-UPLOAD-SUCCESS-2] Created upload with AssemblyAI provider');
        }
      } else {
        logger.info('[SDK-UPLOAD-SUCCESS-1] Created upload with Deepgram provider');
      }

      const data = await response.json();
      logger.info('[SDK-UPLOAD-RESPONSE] Upload created', {
        uploadId: data.id,
        status: data.status,
        hasUploadToken: !!data.upload_token,
        fullResponse: data
      });
      logger.info('[REGION-CHECK] API using:', {
        recall_api_region: new URL(this.apiUrl).hostname
      });

      const uploadData: SdkUploadResponse = {
        id: data.id,
        upload_token: data.upload_token,
        status: data.status
      };

      this.activeUploads.set(meetingId, uploadData);
      logger.info('[SDK-UPLOAD-COMPLETE] SDK upload saved', {
        uploadId: data.id,
        meetingId
      });

      return uploadData;
    } catch (error) {
      logger.error('Failed to create SDK upload', { error });
      throw error;
    }
  }

  /**
   * Get the status of an SDK upload
   */
  async getSdkUploadStatus(uploadId: string): Promise<SdkUploadResponse> {
    try {
      const response = await fetch(`${this.apiUrl}/api/v1/sdk-upload/${uploadId}/`, {
        headers: {
          'Authorization': `Token ${this.apiKey}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to get SDK upload status: ${response.status}`);
      }

      const data = await response.json();
      return {
        id: data.id,
        upload_token: data.upload_token,
        recording_id: data.recording_id,
        status: data.status
      };
    } catch (error) {
      logger.error('Failed to get SDK upload status', { error });
      throw error;
    }
  }

  /**
   * Create a transcript for a completed recording
   */
  async createTranscript(recordingId: string): Promise<void> {
    try {
      logger.info('Creating transcript for recording', { recordingId });
      
      const response = await fetch(`${this.apiUrl}/api/v1/recording/${recordingId}/create_transcript/`, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to create transcript: ${response.status}`);
      }

      logger.info('Transcript creation initiated', { recordingId });
    } catch (error) {
      logger.error('Failed to create transcript', { error });
      throw error;
    }
  }

  /**
   * Fetch the transcript for a recording (used for post-recording retrieval)
   * Note: Real-time transcripts are delivered via SDK events during recording
   */
  async getTranscript(recordingId: string): Promise<TranscriptResponse[]> {
    try {
      logger.info('Fetching transcript from API', {
        recordingId,
        url: `${this.apiUrl}/api/v1/recording/${recordingId}/transcript/`
      });

      const response = await fetch(`${this.apiUrl}/api/v1/recording/${recordingId}/transcript/`, {
        headers: {
          'Authorization': `Token ${this.apiKey}`
        }
      });

      if (!response.ok) {
        if (response.status === 404) {
          logger.info('Transcript not ready yet (404)', {
            recordingId,
            note: 'Transcript may still be processing'
          });
          return [];
        }
        const errorText = await response.text();
        logger.error('Transcript API error', {
          status: response.status,
          error: errorText,
          recordingId
        });
        throw new Error(`Failed to get transcript: ${response.status}`);
      }

      const data = await response.json();
      logger.info('Transcript API response', {
        recordingId,
        hasTranscript: !!data.transcript,
        hasWords: !!data.transcript?.words,
        wordCount: data.transcript?.words?.length || 0,
        dataKeys: Object.keys(data),
        transcriptKeys: data.transcript ? Object.keys(data.transcript) : []
      });

      // Parse the transcript data into our format
      const transcript: TranscriptResponse[] = data.transcript?.words?.map((word: any) => ({
        id: word.id,
        text: word.text,
        speaker: word.speaker || 'Unknown',
        timestamp: word.start_time
      })) || [];

      return transcript;
    } catch (error) {
      logger.error('Failed to get transcript', { error });
      throw error;
    }
  }


  /**
   * Get the upload token for a meeting
   */
  getUploadToken(meetingId: string): string | undefined {
    return this.activeUploads.get(meetingId)?.upload_token;
  }

  /**
   * Clear upload data for a meeting
   */
  clearUpload(meetingId: string): void {
    this.activeUploads.delete(meetingId);
  }
}