import Anthropic from '@anthropic-ai/sdk';
import { getLogger } from './LoggingService';
import { EventEmitter } from 'events';

const logger = getLogger();

interface TranscriptSegment {
  time: string;
  speaker: string;
  text: string;
}

interface TranscriptBlock {
  lines: string[];
  startIndex: number;
  endIndex: number;
}

export class TranscriptCorrectionService extends EventEmitter {
  private anthropic: Anthropic | null = null;
  private readonly BLOCK_SIZE = 50; // Process 50 lines at a time

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
   * Create blocks of lines for processing
   */
  private createBlocks(lines: string[], blockSize: number): TranscriptBlock[] {
    const blocks: TranscriptBlock[] = [];

    for (let i = 0; i < lines.length; i += blockSize) {
      blocks.push({
        lines: lines.slice(i, Math.min(i + blockSize, lines.length)),
        startIndex: i,
        endIndex: Math.min(i + blockSize - 1, lines.length - 1)
      });
    }

    return blocks;
  }

  /**
   * Get the defensive correction prompt
   */
  private getDefensiveCorrectionPrompt(): string {
    return `You are a transcript correction specialist. Your ONLY job is to fix obvious transcription errors while preserving the exact meaning and intent of the speakers.

STRICT RULES - YOU MUST:
1. ONLY fix clear transcription errors:
   - Misspelled words (e.g., "teh" → "the")
   - Wrong homophones (e.g., "there" vs "their" based on context)
   - Garbled audio artifacts (e.g., "um the the" → "um the")
   - Obvious punctuation errors that affect readability

2. NEVER change:
   - The speaker's actual words or phrasing
   - Technical terms (even if they seem wrong)
   - Numbers, dates, or specific values
   - The order or structure of sentences
   - Informal language or colloquialisms (keep "gonna", "wanna", etc.)
   - Filler words that were actually spoken ("um", "uh", "like")

3. PRESERVE exactly:
   - Speaker attributions and timestamps
   - Line breaks and formatting
   - Incomplete thoughts or interruptions
   - Any [inaudible] or [unclear] markers

4. When uncertain:
   - Leave it unchanged
   - If 60% sure it's an error, fix it
   - If less than 60% sure, keep original

IMPORTANT: People's exact words matter. This could be used for records or documentation. A court reporter wouldn't change "gonna" to "going to" - neither should you.

Return ONLY the corrected text block, maintaining the exact same format, structure, and number of lines.`;
  }

  /**
   * Correct a single block of transcript
   */
  private async correctBlock(
    currentBlock: TranscriptBlock,
    previousBlock: TranscriptBlock | null,
    nextBlock: TranscriptBlock | null
  ): Promise<string> {
    if (!this.anthropic) {
      return currentBlock.lines.join('\n');
    }

    try {
      // Build context for better correction
      let contextMessage = '';

      if (previousBlock) {
        // Include last 5 lines of previous block for context
        const prevContext = previousBlock.lines.slice(-5);
        contextMessage += `[Context from previous section - DO NOT MODIFY]\n${prevContext.join('\n')}\n\n[END OF CONTEXT]\n\n`;
      }

      contextMessage += `[SECTION TO CORRECT - Line ${currentBlock.startIndex + 1} to ${currentBlock.endIndex + 1}]\n${currentBlock.lines.join('\n')}\n[END OF SECTION TO CORRECT]`;

      if (nextBlock) {
        // Include first 5 lines of next block for context
        const nextContext = nextBlock.lines.slice(0, 5);
        contextMessage += `\n\n[Context from next section - DO NOT MODIFY]\n${nextContext.join('\n')}\n[END OF CONTEXT]`;
      }

      const response = await this.anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        temperature: 0.2, // Low temperature for consistent, conservative corrections
        system: this.getDefensiveCorrectionPrompt(),
        messages: [{
          role: 'user',
          content: `Please correct ONLY the transcription errors in the section marked [SECTION TO CORRECT], using the context to understand the conversation flow. Return ONLY the corrected lines from that section, nothing else.\n\n${contextMessage}`
        }]
      });

      // Extract the corrected text
      if (response.content[0].type === 'text') {
        const correctedText = response.content[0].text.trim();

        // Validate that we got reasonable output (not empty, not too different in length)
        const originalLength = currentBlock.lines.join('\n').length;
        const correctedLength = correctedText.length;

        // If the correction is drastically different in size (more than 50% change),
        // it might have done something wrong, so return original
        if (correctedLength < originalLength * 0.5 || correctedLength > originalLength * 1.5) {
          logger.warn(`Block correction resulted in suspicious length change (${originalLength} -> ${correctedLength}), using original`);
          return currentBlock.lines.join('\n');
        }

        return correctedText;
      }

      return currentBlock.lines.join('\n');
    } catch (error) {
      logger.error('Failed to correct block:', error);
      // Return original block if correction fails
      return currentBlock.lines.join('\n');
    }
  }

  /**
   * Correct an entire transcript using block processing
   */
  async correctTranscript(transcript: string, meetingId: string): Promise<string> {
    if (!this.anthropic) {
      logger.info('Transcript correction skipped - no Anthropic API key configured');
      return transcript;
    }

    logger.info(`Starting transcript correction for meeting ${meetingId}`);
    this.emit('correction-started', { meetingId });

    try {
      const lines = transcript.split('\n').filter(line => line.trim()); // Remove empty lines

      if (lines.length === 0) {
        logger.warn('No content found in transcript');
        return transcript;
      }

      // Create blocks for processing
      const blocks = this.createBlocks(lines, this.BLOCK_SIZE);
      const totalBlocks = blocks.length;

      logger.info(`Processing transcript in ${totalBlocks} blocks of ~${this.BLOCK_SIZE} lines each`);

      const correctedBlocks: string[] = [];

      for (let i = 0; i < blocks.length; i++) {
        // Emit progress event
        this.emit('correction-progress', {
          meetingId,
          current: i + 1,
          total: totalBlocks,
          percentage: Math.round(((i + 1) / totalBlocks) * 100)
        });

        logger.debug(`Correcting block ${i + 1}/${totalBlocks} (lines ${blocks[i].startIndex + 1}-${blocks[i].endIndex + 1})`);

        // Get context blocks
        const previousBlock = i > 0 ? blocks[i - 1] : null;
        const nextBlock = i < blocks.length - 1 ? blocks[i + 1] : null;

        // Correct the block
        const correctedBlock = await this.correctBlock(
          blocks[i],
          previousBlock,
          nextBlock
        );

        correctedBlocks.push(correctedBlock);

        // Small delay to avoid rate limiting (only between blocks, not after the last one)
        if (i < blocks.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 200)); // Slightly longer delay for safety
        }
      }

      // Join all corrected blocks
      const correctedTranscript = correctedBlocks.join('\n');

      logger.info(`Transcript correction completed for meeting ${meetingId} (${totalBlocks} blocks processed)`);
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
   * Parse transcript string into segments grouped by speaker
   * This is kept for backward compatibility but not used in block processing
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
   * Check if correction service is available
   */
  isAvailable(): boolean {
    return this.anthropic !== null;
  }

  /**
   * Get estimated time for correction based on transcript length
   */
  getEstimatedCorrectionTime(transcript: string): number {
    const lines = transcript.split('\n').filter(line => line.trim());
    const blocks = Math.ceil(lines.length / this.BLOCK_SIZE);
    // Estimate: 1-2 seconds per block + API latency
    return blocks * 1.5;
  }
}