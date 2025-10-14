import { getLogger } from './LoggingService';
import { PromptService } from './PromptService';
import { BaseAnthropicService } from './BaseAnthropicService';

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

export class TranscriptCorrectionService extends BaseAnthropicService {
  private readonly BLOCK_SIZE = 100; // Process 100 lines at a time
  private promptService: PromptService | null;

  constructor(promptService: PromptService | null) {
    super('TranscriptCorrectionService');
    logger.info('[TRANSCRIPT-CORRECTION-CONSTRUCTOR] Creating TranscriptCorrectionService', {
      hasPromptService: promptService !== null
    });
    this.promptService = promptService;
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
      logger.info('Getting transcript correction prompt from PromptService');
      const prompt = await this.promptService.getInterpolatedPrompt('transcript-correction', {
        transcript: '' // This will be replaced in the API call
      });
      logger.info(`Loaded custom prompt (length: ${prompt.length} chars)`);
      return prompt;
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
      // Build the transcript content to be corrected
      const transcriptContent = currentBlock.lines.join('\n');

      // Build context message for the user
      let userMessage = '';

      // Add previous context if available
      if (previousBlock) {
        const prevContext = previousBlock.lines.slice(-3);
        userMessage += `Previous context (for reference only, do not include in output):\n${prevContext.join('\n')}\n\n---\n\n`;
      }

      // Add the content to correct
      userMessage += `Transcript to correct:\n${transcriptContent}`;

      // Add next context if available
      if (nextBlock) {
        const nextContext = nextBlock.lines.slice(0, 3);
        userMessage += `\n\n---\n\nNext context (for reference only, do not include in output):\n${nextContext.join('\n')}`;
      }

      logger.debug(`Making API call for block correction (${currentBlock.lines.length} lines)`);

      // Add timeout to prevent hanging (60 seconds for 100-line blocks)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('API request timeout after 60 seconds')), 60000);
      });

      const systemPrompt = await this.getDefensiveCorrectionPrompt();

      logger.info(`System prompt preview (first 200 chars): ${systemPrompt.substring(0, 200)}`);

      // Log a sample of what we're sending for debugging
      logger.debug(`Sample of transcript being corrected (first 300 chars): ${transcriptContent.substring(0, 300)}`);

      const apiPromise = this.anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        temperature: 0.1, // Even lower temperature for more consistent corrections
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: userMessage
        }]
      });

      const response = await Promise.race([apiPromise, timeoutPromise]) as any;

      logger.debug('API call completed successfully');

      // Extract the corrected text
      if (response.content[0].type === 'text') {
        let correctedText = response.content[0].text.trim();

        // Remove any wrapper text that Claude might add
        // Look for common patterns where Claude might wrap the response
        if (correctedText.includes('---')) {
          // If there are dividers, extract the main content between them
          const parts = correctedText.split('---');
          // Usually the corrected transcript is in the middle section
          if (parts.length >= 3) {
            correctedText = parts[1].trim();
          }
        }

        // Remove any leading/trailing explanation text
        correctedText = correctedText
          .replace(/^(Here'?s? the corrected transcript:?|Corrected transcript:?|Corrected version:?)\s*/i, '')
          .replace(/\s*(End of corrected transcript|That'?s? all)\s*$/i, '')
          .trim();

        // Validate that we got reasonable output
        const originalLength = transcriptContent.length;
        const correctedLength = correctedText.length;

        // Log what we're seeing for debugging
        logger.debug(`Block correction lengths - original: ${originalLength}, corrected: ${correctedLength}`);
        logger.debug(`First 200 chars of corrected text: ${correctedText.substring(0, 200)}`);

        // Be more lenient with length changes - corrections can compress text
        if (correctedLength < originalLength * 0.3 || correctedLength > originalLength * 2.0) {
          logger.warn(`Block correction resulted in suspicious length change (${originalLength} -> ${correctedLength}), using original`);
          return transcriptContent;
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
  private validateCorrectedTranscript(original: string, corrected: string): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check if corrected transcript is not empty
    if (!corrected || corrected.trim().length === 0) {
      errors.push('Corrected transcript is empty');
      return { isValid: false, errors };
    }

    // Check if transcript length is reasonable - be VERY lenient since custom prompts
    // may aggressively clean up duplicate content
    const originalLength = original.length;
    const correctedLength = corrected.length;
    if (correctedLength < originalLength * 0.15) {
      // Only error if we lost more than 85% of content
      errors.push(`Transcript too short: ${correctedLength} chars vs original ${originalLength} chars`);
    }

    // Count timestamp lines in both transcripts (with or without square brackets)
    const timestampRegex = /^(\[)?\d{2}:\d{2}:\d{2}(\])?\s+/gm;
    const originalTimestamps = (original.match(timestampRegex) || []).length;
    const correctedTimestamps = (corrected.match(timestampRegex) || []).length;

    // Be very lenient with timestamp consolidation - custom prompts may merge broken lines
    if (correctedTimestamps < originalTimestamps * 0.15) {
      // Only error if we lost more than 85% of timestamps
      errors.push(`Lost too many timestamp lines: ${correctedTimestamps} vs original ${originalTimestamps}`);
    }

    // Check if the basic structure is maintained (has timestamp lines)
    if (correctedTimestamps === 0 && originalTimestamps > 0) {
      errors.push('No timestamp lines found in corrected transcript');
    }

    // Extract and compare speakers to ensure they weren't lost (with or without square brackets)
    const speakerRegex = /^(\[)?\d{2}:\d{2}:\d{2}(\])?\s+(.+?)$/gm;
    const originalSpeakers = new Set<string>();
    const correctedSpeakers = new Set<string>();

    let match;
    while ((match = speakerRegex.exec(original)) !== null) {
      // The speaker name is now in match[3] because of the optional bracket groups
      originalSpeakers.add(match[3].trim());
    }

    speakerRegex.lastIndex = 0; // Reset regex
    while ((match = speakerRegex.exec(corrected)) !== null) {
      correctedSpeakers.add(match[3].trim());
    }

    // Clean up speaker names for comparison (remove duplicates and extra formatting)
    const cleanSpeaker = (speaker: string) => {
      // Remove duplicate patterns like "Name: Name:" or "Speaker: Name"
      return speaker
        .replace(/^(Speaker:\s*)/i, '') // Remove "Speaker:" prefix
        .replace(/(.+?):\s*\1:?/g, '$1') // Remove duplicate names like "LeonorL: LeonorL:"
        .trim();
    };

    const cleanedOriginalSpeakers = new Set(Array.from(originalSpeakers).map(cleanSpeaker));
    const cleanedCorrectedSpeakers = new Set(Array.from(correctedSpeakers).map(cleanSpeaker));

    // Check if we lost any core speakers (after cleaning)
    const lostCoreSpeakers = Array.from(cleanedOriginalSpeakers).filter(
      speaker => !Array.from(cleanedCorrectedSpeakers).some(
        corrected => corrected.includes(speaker) || speaker.includes(corrected)
      )
    );

    if (lostCoreSpeakers.length > 0 && cleanedOriginalSpeakers.size > 0) {
      // Only error if we lost ALL speakers AND there are no speakers in corrected
      if (lostCoreSpeakers.length === cleanedOriginalSpeakers.size && correctedSpeakers.size === 0) {
        errors.push(`All speakers appear to be lost: ${lostCoreSpeakers.join(', ')}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

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

      // Log comparison for debugging
      logger.debug(`[CORRECTION CHECK] Original sample: ${transcript.substring(0, 300)}`);
      logger.debug(`[CORRECTION CHECK] Corrected sample: ${correctedTranscript.substring(0, 300)}`);
      logger.debug(`[CORRECTION CHECK] Are they the same? ${transcript === correctedTranscript}`);

      // Validate the corrected transcript
      const validationResult = this.validateCorrectedTranscript(transcript, correctedTranscript);
      if (!validationResult.isValid) {
        logger.error(`Transcript validation failed for meeting ${meetingId}: ${validationResult.errors.join(', ')}`);
        logger.info('Returning original transcript due to validation failure');
        this.emit('correction-failed', { meetingId, error: `Validation failed: ${validationResult.errors.join(', ')}` });
        return transcript;
      }

      logger.info(`Transcript correction successful for meeting ${meetingId}`);

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
   * Get estimated time for correction based on transcript length
   */
  getEstimatedCorrectionTime(transcript: string): number {
    const lines = transcript.split('\n').filter(line => line.trim());
    const blocks = Math.ceil(lines.length / this.BLOCK_SIZE);
    // Estimate: 2-3 seconds per block + API latency (larger blocks take a bit longer)
    return blocks * 2.5;
  }
}