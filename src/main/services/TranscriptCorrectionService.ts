import Anthropic from '@anthropic-ai/sdk';
import { getLogger } from './LoggingService';
import { EventEmitter } from 'events';
import { PromptService } from './PromptService';

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
  private readonly BLOCK_SIZE = 100; // Process 100 lines at a time
  private promptService: PromptService | null;

  constructor(promptService: PromptService | null) {
    super();
    this.promptService = promptService;
  }

  initialize(apiKey: string | undefined): void {
    if (!apiKey) {
      logger.warn('No Anthropic API key provided - transcript correction disabled');
      return;
    }

    logger.info(`Initializing TranscriptCorrectionService with API key: ${apiKey.substring(0, 10)}...`);

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
   * Get the correction prompt from PromptService
   */
  private async getDefensiveCorrectionPrompt(): Promise<string> {
    try {
      if (!this.promptService) {
        logger.warn('PromptService not available, using fallback prompt');
        throw new Error('PromptService not initialized');
      }
      return await this.promptService.getInterpolatedPrompt('transcript-correction', {
        transcript: '' // This will be replaced in the API call
      });
    } catch (error) {
      logger.error('Failed to load transcript correction prompt, using fallback:', error);
      // Fallback to a basic prompt if the service fails
      return 'You are a transcript correction specialist. Fix errors in the transcript while maintaining the exact format. Return ONLY the corrected text.';
    }
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

      logger.debug(`Making API call for block correction (${currentBlock.lines.length} lines)`);

      // Add timeout to prevent hanging (60 seconds for 100-line blocks)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('API request timeout after 60 seconds')), 60000);
      });

      const systemPrompt = await this.getDefensiveCorrectionPrompt();

      const apiPromise = this.anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        temperature: 0.2, // Low temperature for consistent, conservative corrections
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: `Please correct ONLY the transcription errors in the section marked [SECTION TO CORRECT], using the context to understand the conversation flow. Return ONLY the corrected lines from that section, nothing else.\n\n${contextMessage}`
        }]
      });

      const response = await Promise.race([apiPromise, timeoutPromise]) as any;

      logger.debug('API call completed successfully');

      // Extract the corrected text
      if (response.content[0].type === 'text') {
        let correctedText = response.content[0].text.trim();

        // Extract just the corrected section if the response includes markers
        // The AI might return the section with markers like [SECTION TO CORRECT]
        const sectionMatch = correctedText.match(/\[SECTION TO CORRECT[^\]]*\]([\s\S]*?)\[END OF SECTION/);
        if (sectionMatch) {
          correctedText = sectionMatch[1].trim();
        }

        // Validate that we got reasonable output (not empty, not too different in length)
        const originalLength = currentBlock.lines.join('\n').length;
        const correctedLength = correctedText.length;

        // Log what we're seeing for debugging
        logger.debug(`Block correction lengths - original: ${originalLength}, corrected: ${correctedLength}`);

        // Be more lenient with length changes - sometimes corrections can compress text significantly
        if (correctedLength < originalLength * 0.3 || correctedLength > originalLength * 2.0) {
          logger.warn(`Block correction resulted in suspicious length change (${originalLength} -> ${correctedLength}), using original`);
          logger.debug(`Original block sample: ${currentBlock.lines.slice(0, 3).join('\n').substring(0, 200)}...`);
          logger.debug(`Corrected block sample: ${correctedText.substring(0, 200)}...`);
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

      // Process all blocks in parallel for speed
      logger.info(`Processing all ${totalBlocks} blocks in parallel for maximum speed`);

      let completedBlocks = 0;

      const correctionPromises = blocks.map(async (block, i) => {
        // Get context blocks
        const previousBlock = i > 0 ? blocks[i - 1] : null;
        const nextBlock = i < blocks.length - 1 ? blocks[i + 1] : null;

        // Add a small random delay to avoid hitting the API all at once
        await new Promise(resolve => setTimeout(resolve, Math.random() * 1000));

        logger.debug(`Starting correction for block ${i + 1}/${totalBlocks} (lines ${block.startIndex + 1}-${block.endIndex + 1})`);

        try {
          const correctedBlock = await this.correctBlock(
            block,
            previousBlock,
            nextBlock
          );

          // Emit progress event when this block completes
          completedBlocks++;
          this.emit('correction-progress', {
            meetingId,
            current: completedBlocks,
            total: totalBlocks,
            percentage: Math.round((completedBlocks / totalBlocks) * 100)
          });

          logger.debug(`Completed block ${i + 1}/${totalBlocks} (${completedBlocks} total completed)`);
          return { index: i, corrected: correctedBlock };
        } catch (error) {
          logger.error(`Failed to correct block ${i + 1}:`, error);
          // Still count as completed for progress
          completedBlocks++;
          this.emit('correction-progress', {
            meetingId,
            current: completedBlocks,
            total: totalBlocks,
            percentage: Math.round((completedBlocks / totalBlocks) * 100)
          });
          // Return original block on error
          return { index: i, corrected: block.lines.join('\n') };
        }
      });

      // Wait for all blocks to complete
      const results = await Promise.all(correctionPromises);

      // Sort results by index to maintain order
      results.sort((a, b) => a.index - b.index);

      // Extract corrected blocks in order
      const correctedBlocks = results.map(r => r.corrected);

      // Join all corrected blocks
      const correctedTranscript = correctedBlocks.join('\n');

      // Log first 500 chars of original vs corrected to see if there are actual changes
      logger.info(`Original transcript sample (first 500 chars): ${transcript.substring(0, 500)}`);
      logger.info(`Corrected transcript sample (first 500 chars): ${correctedTranscript.substring(0, 500)}`);
      logger.info(`Transcript lengths - original: ${transcript.length}, corrected: ${correctedTranscript.length}`);

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
    // Estimate: 2-3 seconds per block + API latency (larger blocks take a bit longer)
    return blocks * 2.5;
  }
}