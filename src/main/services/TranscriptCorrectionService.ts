import Anthropic from '@anthropic-ai/sdk';
import { getLogger } from './LoggingService';
import { EventEmitter } from 'events';

const logger = getLogger();

interface TranscriptSegment {
  time: string;
  speaker: string;
  text: string;
}

export class TranscriptCorrectionService extends EventEmitter {
  private anthropic: Anthropic | null = null;

  constructor() {
    super();
  }

  initialize(apiKey: string | undefined): void {
    if (!apiKey) {
      logger.warn('No Anthropic API key provided - transcript correction disabled');
      return;
    }

    try {
      this.anthropic = new Anthropic({
        apiKey: apiKey
      });
      logger.info('TranscriptCorrectionService initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Anthropic client:', error);
      this.anthropic = null;
    }
  }

  /**
   * Parse transcript string into segments grouped by speaker
   * This mirrors the logic from MeetingDetailFinal.tsx
   */
  private parseTranscript(transcript: string): TranscriptSegment[] {
    const segments: TranscriptSegment[] = [];
    const lines = transcript.split('\n');

    let currentSegment: TranscriptSegment | null = null;
    let lastSpeaker = '';
    let segmentCounter = 0;

    lines.forEach((line) => {
      const trimmedLine = line.trim();
      if (!trimmedLine) return;

      // Check for timestamp pattern [HH:MM:SS] or (HH:MM:SS)
      const timeMatch = trimmedLine.match(/^[\[(]?(\d{1,2}:\d{2}(?::\d{2})?)[\])]?\s*(.*)/) ||
                        trimmedLine.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.*)/);

      if (timeMatch) {
        // Save previous segment if exists
        if (currentSegment && currentSegment.text) {
          segments.push(currentSegment);
        }

        const time = timeMatch[1];
        const restOfLine = timeMatch[2] || '';

        // Check for speaker in the rest of the line
        const speakerMatch = restOfLine.match(/^([A-Z][^:]+):\s*(.*)/);

        if (speakerMatch) {
          lastSpeaker = speakerMatch[1].trim();
          currentSegment = {
            time,
            speaker: lastSpeaker,
            text: speakerMatch[2].trim()
          };
        } else {
          currentSegment = {
            time,
            speaker: lastSpeaker || 'Speaker',
            text: restOfLine.trim()
          };
        }
      } else {
        // Check for speaker pattern without timestamp
        const speakerMatch = trimmedLine.match(/^([A-Z][^:]+):\s*(.*)/);

        if (speakerMatch) {
          // Save previous segment if exists
          if (currentSegment && currentSegment.text) {
            segments.push(currentSegment);
          }

          lastSpeaker = speakerMatch[1].trim();
          segmentCounter++;

          currentSegment = {
            time: `00:${String(Math.floor(segmentCounter / 2)).padStart(2, '0')}:${String((segmentCounter % 2) * 30).padStart(2, '0')}`,
            speaker: lastSpeaker,
            text: speakerMatch[2].trim()
          };
        } else if (currentSegment) {
          // Continue current segment - append to same speaker's text
          currentSegment.text += ' ' + trimmedLine;
        } else {
          // Create new segment without explicit speaker
          segmentCounter++;
          currentSegment = {
            time: `00:${String(Math.floor(segmentCounter / 2)).padStart(2, '0')}:${String((segmentCounter % 2) * 30).padStart(2, '0')}`,
            speaker: lastSpeaker || 'Speaker',
            text: trimmedLine
          };
        }
      }
    });

    // Add the last segment
    if (currentSegment !== null && (currentSegment as TranscriptSegment).text) {
      segments.push(currentSegment as TranscriptSegment);
    }

    return segments;
  }

  /**
   * Reconstruct transcript string from segments
   */
  private reconstructTranscript(segments: TranscriptSegment[]): string {
    return segments.map(segment => {
      return `[${segment.time}] ${segment.speaker}: ${segment.text}`;
    }).join('\n');
  }

  /**
   * Correct a single transcript segment using Anthropic API
   */
  private async correctSegment(
    segment: TranscriptSegment,
    contextBefore: TranscriptSegment[],
    contextAfter: TranscriptSegment[]
  ): Promise<TranscriptSegment> {
    if (!this.anthropic) {
      return segment; // Return unchanged if API not initialized
    }

    try {
      // Build context string
      const contextBeforeText = contextBefore.map(s => `${s.speaker}: ${s.text}`).join('\n');
      const contextAfterText = contextAfter.map(s => `${s.speaker}: ${s.text}`).join('\n');

      const systemMessage = `You are an expert transcription professional with over 20 years of experience in correcting and improving transcripts. Your task is to correct transcription errors while staying as close as possible to what the speaker intended to say.

CRITICAL RULES:
1. Fix obvious transcription errors (misspellings, garbled words, incorrect homophones)
2. Preserve the speaker's original meaning and intent
3. Keep the same conversational tone and style
4. Do NOT add or remove significant content
5. Do NOT change technical terms unless clearly mis-transcribed
6. Maintain the exact same speaker attribution
7. Return ONLY the corrected text, nothing else

Context helps you understand the conversation flow but focus on correcting only the current segment.`;

      const userMessage = `Context before (for reference only):
${contextBeforeText}

Current segment to correct:
Speaker: ${segment.speaker}
Text: ${segment.text}

Context after (for reference only):
${contextAfterText}

Return ONLY the corrected text for the current segment, preserving the speaker's intended meaning:`;

      const response = await this.anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1024,
        temperature: 0.3, // Lower temperature for more consistent corrections
        system: systemMessage,
        messages: [{
          role: 'user',
          content: userMessage
        }]
      });

      // Extract the corrected text from the response
      const correctedText = response.content[0].type === 'text'
        ? response.content[0].text.trim()
        : segment.text;

      return {
        ...segment,
        text: correctedText
      };
    } catch (error) {
      logger.error('Failed to correct segment:', error);
      // Return original segment if correction fails
      return segment;
    }
  }

  /**
   * Correct an entire transcript
   */
  async correctTranscript(transcript: string, meetingId: string): Promise<string> {
    if (!this.anthropic) {
      logger.info('Transcript correction skipped - no Anthropic API key configured');
      return transcript;
    }

    logger.info(`Starting transcript correction for meeting ${meetingId}`);
    this.emit('correction-started', { meetingId });

    try {
      // Parse transcript into segments
      const segments = this.parseTranscript(transcript);
      const totalSegments = segments.length;

      if (totalSegments === 0) {
        logger.warn('No segments found in transcript');
        return transcript;
      }

      logger.info(`Found ${totalSegments} segments to correct`);

      // Correct each segment with context
      const correctedSegments: TranscriptSegment[] = [];

      for (let i = 0; i < segments.length; i++) {
        // Get context (2 segments before and after)
        const contextBefore = i > 0 ? segments.slice(Math.max(0, i - 2), i) : [];
        const contextAfter = i < segments.length - 1 ? segments.slice(i + 1, Math.min(segments.length, i + 3)) : [];

        // Emit progress event
        this.emit('correction-progress', {
          meetingId,
          current: i + 1,
          total: totalSegments,
          percentage: Math.round(((i + 1) / totalSegments) * 100)
        });

        logger.debug(`Correcting segment ${i + 1}/${totalSegments}`);

        // Correct the segment
        const correctedSegment = await this.correctSegment(
          segments[i],
          contextBefore,
          contextAfter
        );

        correctedSegments.push(correctedSegment);

        // Small delay to avoid rate limiting
        if (i < segments.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // Reconstruct the transcript
      const correctedTranscript = this.reconstructTranscript(correctedSegments);

      logger.info(`Transcript correction completed for meeting ${meetingId}`);
      this.emit('correction-completed', { meetingId });

      return correctedTranscript;

    } catch (error) {
      logger.error('Failed to correct transcript:', error);
      this.emit('correction-failed', { meetingId, error });
      // Return original transcript if correction fails
      return transcript;
    }
  }

  /**
   * Check if correction service is available
   */
  isAvailable(): boolean {
    return this.anthropic !== null;
  }
}