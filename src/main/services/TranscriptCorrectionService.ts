import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { getLogger } from './LoggingService';
import { PromptService } from './PromptService';
import { BaseAnthropicService } from './BaseAnthropicService';
import { Meeting } from '../../shared/types';

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

interface TranscriptCorrectionChange {
  start_line: number;
  end_line: number;
  replacement: string;
  rationale?: string;
}

export class TranscriptCorrectionService extends BaseAnthropicService {
  private readonly BLOCK_SIZE = 100; // Process 100 lines at a time
  private readonly MAX_INPUT_TOKENS = 190000;
  private readonly DIFF_MODEL = 'claude-3-7-sonnet-latest';
  private readonly TRANSCRIPT_LINE_REGEX = /^\[\d{1,2}:\d{2}:\d{2}\]\s+[^:]+:\s+.*$/;
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
  private async getDiffCorrectionPrompt(): Promise<string> {
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
      return `You are a transcript correction specialist. You are given the full transcript with line numbers plus meeting notes and attendees. Identify only the necessary corrections and respond EXCLUSIVELY by calling the submit_corrections tool with precise line ranges, replacement lines, and short rationales. Never output free-form transcript text.`;
    }
  }

  private getLegacyBlockPrompt(): string {
    return 'You are a transcript correction specialist. Fix errors in the provided transcript block while maintaining the exact format. Return ONLY the corrected text for the lines you were given.';
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

      const systemPrompt = this.getLegacyBlockPrompt();

      logger.info(`System prompt preview (first 200 chars): ${systemPrompt.substring(0, 200)}`);

      // Log a sample of what we're sending for debugging
      logger.debug(`Sample of transcript being corrected (first 300 chars): ${transcriptContent.substring(0, 300)}`);

      const apiPromise = this.anthropic.messages.create({
        model: this.DIFF_MODEL,
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

  async correctTranscript(meeting: Meeting): Promise<string> {
    const meetingId = meeting.id;
    const transcript = meeting.transcript || '';

    if (!this.anthropic) {
      logger.info('Transcript correction skipped - no Anthropic API key configured');
      return transcript;
    }

    logger.info(`Starting transcript correction for meeting ${meetingId}`);
    this.emit('correction-started', { meetingId });

    if (!transcript.trim()) {
      logger.warn('No content found in transcript');
      this.emit('correction-failed', { meetingId, error: 'Transcript empty' });
      return transcript;
    }

    try {
      const correctedTranscript = await this.runDiffCorrection(meeting);
      this.emit('correction-progress', { meetingId, current: 1, total: 1, percentage: 100 });
      this.emit('correction-completed', { meetingId });
      return correctedTranscript;
    } catch (diffError) {
      logger.warn('Whole transcript diff correction failed, falling back to legacy block processing', {
        meetingId,
        error: diffError instanceof Error ? diffError.message : diffError
      });

      try {
        const fallbackTranscript = await this.correctTranscriptWithLegacyBlocks(transcript, meetingId);
        this.emit('correction-completed', { meetingId });
        return fallbackTranscript;
      } catch (fallbackError) {
        logger.error('Legacy block correction failed', {
          meetingId,
          error: fallbackError instanceof Error ? fallbackError.message : fallbackError
        });
        this.emit('correction-failed', {
          meetingId,
          error: fallbackError instanceof Error ? fallbackError.message : fallbackError
        });
        return transcript;
      }
    }
  }

  private async runDiffCorrection(meeting: Meeting): Promise<string> {
    if (!this.anthropic) {
      throw new Error('Anthropic client unavailable');
    }

    const originalTranscript = meeting.transcript || '';
    const lines = originalTranscript.split('\n');

    const systemPrompt = await this.getDiffCorrectionPrompt();
    const toolDefinition = this.buildSubmitCorrectionsTool();

    const requestPayload = {
      model: this.DIFF_MODEL,
      max_tokens: 4096,
      temperature: 0.1,
      system: systemPrompt,
      tools: [toolDefinition],
      tool_choice: { type: 'tool', name: 'submit_corrections' } as const,
      messages: [
        {
          role: 'user' as const,
          content: this.buildDiffUserMessage(meeting, lines)
        }
      ]
    };

    await this.ensureRequestWithinTokenLimit(requestPayload, meeting.id);

    const response = await this.anthropic.messages.create(requestPayload);

    const changes = this.extractChangesFromResponse(response, meeting.id);

    if (!changes.length) {
      logger.info('Claude returned no changes; keeping original transcript', { meetingId: meeting.id });
      return originalTranscript;
    }

    const correctedTranscript = this.applyChangesToTranscript(lines, changes, meeting.id);

    const validationResult = this.validateCorrectedTranscript(originalTranscript, correctedTranscript);
    if (!validationResult.isValid) {
      throw new Error(`Validation failed after diff correction: ${validationResult.errors.join(', ')}`);
    }

    logger.info('Diff-based transcript correction succeeded', {
      meetingId: meeting.id,
      changeCount: changes.length
    });

    return correctedTranscript;
  }

  private async correctTranscriptWithLegacyBlocks(transcript: string, meetingId: string): Promise<string> {
    if (!this.anthropic) {
      return transcript;
    }

    const lines = transcript.split('\n').filter(line => line.trim());

    if (lines.length === 0) {
      return transcript;
    }

    const blocks = this.createBlocks(lines, this.BLOCK_SIZE);
    const totalBlocks = blocks.length;

    logger.info(`Processing transcript in ${totalBlocks} legacy blocks of ~${this.BLOCK_SIZE} lines each`, {
      meetingId
    });

    let completedBlocks = 0;

    const correctionPromises = blocks.map(async (block, i) => {
      const previousBlock = i > 0 ? blocks[i - 1] : null;
      const nextBlock = i < blocks.length - 1 ? blocks[i + 1] : null;

      await new Promise(resolve => setTimeout(resolve, Math.random() * 1000));

      logger.debug(`Starting legacy block correction ${i + 1}/${totalBlocks} (lines ${block.startIndex + 1}-${block.endIndex + 1})`, {
        meetingId
      });

      try {
        const correctedBlock = await this.correctBlock(block, previousBlock, nextBlock);
        completedBlocks++;
        this.emit('correction-progress', {
          meetingId,
          current: completedBlocks,
          total: totalBlocks,
          percentage: Math.round((completedBlocks / totalBlocks) * 100)
        });
        return { index: i, corrected: correctedBlock };
      } catch (error) {
        logger.error(`Failed legacy block correction ${i + 1}`, {
          meetingId,
          error: error instanceof Error ? error.message : error
        });
        completedBlocks++;
        this.emit('correction-progress', {
          meetingId,
          current: completedBlocks,
          total: totalBlocks,
          percentage: Math.round((completedBlocks / totalBlocks) * 100)
        });
        return { index: i, corrected: block.lines.join('\n') };
      }
    });

    const results = await Promise.all(correctionPromises);
    results.sort((a, b) => a.index - b.index);
    const correctedTranscript = results.map(r => r.corrected).join('\n');

    const validationResult = this.validateCorrectedTranscript(transcript, correctedTranscript);
    if (!validationResult.isValid) {
      throw new Error(`Legacy validation failed: ${validationResult.errors.join(', ')}`);
    }

    logger.info('Legacy block correction completed successfully', {
      meetingId,
      totalBlocks
    });

    return correctedTranscript;
  }

  private buildSubmitCorrectionsTool(): Tool {
    return {
      name: 'submit_corrections',
      description: 'Return only the targeted transcript edits that should be applied.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          changes: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['start_line', 'end_line', 'replacement'],
              properties: {
                start_line: {
                  type: 'integer',
                  minimum: 1,
                  description: '1-indexed line where the replacement should begin.'
                },
                end_line: {
                  type: 'integer',
                  minimum: 0,
                  description: '1-indexed line where the replacement should end (inclusive). May equal start_line - 1 for insertions.'
                },
                replacement: {
                  type: 'string',
                  description: 'Replacement transcript lines in the canonical "[HH:MM:SS] Speaker: text" format.'
                },
                rationale: {
                  type: 'string',
                  description: 'Brief explanation of why the change is necessary.'
                }
              }
            }
          }
        },
        required: ['changes']
      }
    } satisfies Tool;
  }

  private buildDiffUserMessage(meeting: Meeting, lines: string[]): string {
    const attendees = Array.isArray(meeting.attendees)
      ? meeting.attendees
          .map(attendee => typeof attendee === 'string' ? attendee : attendee.name)
          .filter(Boolean)
          .join(', ')
      : '';

    const notes = meeting.notes?.trim();

    const transcriptSection = lines
      .map((line, index) => `${index + 1}. ${line}`)
      .join('\n');

    const dateValue = meeting.date instanceof Date
      ? meeting.date.toISOString()
      : (meeting.date || '');

    return [
      'You are receiving the full meeting context for targeted transcript corrections.',
      `Meeting ID: ${meeting.id || 'unknown'}`,
      `Title: ${meeting.title || 'Untitled Meeting'}`,
      dateValue ? `Date: ${dateValue}` : '',
      meeting.duration ? `Duration (minutes): ${meeting.duration}` : '',
      attendees ? `Attendees: ${attendees}` : 'Attendees: (none recorded)',
      '',
      'Meeting notes (verbatim, do not rewrite):',
      notes ? notes : '(no notes provided)',
      '',
      'Transcript lines (each prefixed with 1-indexed line numbers for reference only):',
      transcriptSection,
      '',
      'Respond only by calling the submit_corrections tool. Do not include free-form transcript text in your reply.'
    ].filter(Boolean).join('\n');
  }

  private async ensureRequestWithinTokenLimit(request: any, meetingId: string): Promise<void> {
    if (!this.anthropic) {
      return;
    }

    try {
      const estimate = await this.anthropic.messages.countTokens({
        model: request.model,
        system: request.system,
        messages: request.messages,
        tools: request.tools,
        tool_choice: request.tool_choice
      } as any);

      logger.info('Token estimate for diff correction', {
        meetingId,
        inputTokens: estimate.input_tokens
      });

      if (estimate.input_tokens > this.MAX_INPUT_TOKENS) {
        throw new Error(`Input too large (${estimate.input_tokens} tokens > ${this.MAX_INPUT_TOKENS})`);
      }
    } catch (error) {
      logger.warn('Token estimation failed for diff correction', {
        meetingId,
        error: error instanceof Error ? error.message : error
      });
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  private extractChangesFromResponse(response: any, meetingId: string): TranscriptCorrectionChange[] {
    const content = response?.content;
    if (!Array.isArray(content)) {
      throw new Error('Claude response missing content blocks');
    }

    const toolBlock = content.find((block: any) => block?.type === 'tool_use' && block?.name === 'submit_corrections');

    if (!toolBlock) {
      throw new Error('Claude did not invoke submit_corrections tool');
    }

    const input = toolBlock.input;
    if (!input || !Array.isArray(input.changes)) {
      throw new Error('Tool payload missing changes array');
    }

    const sanitized: TranscriptCorrectionChange[] = [];

    for (const rawChange of input.changes) {
      const startLine = Number(rawChange.start_line);
      const endLine = Number(rawChange.end_line ?? rawChange.start_line);
      const replacement = typeof rawChange.replacement === 'string' ? rawChange.replacement : '';
      const rationale = typeof rawChange.rationale === 'string' ? rawChange.rationale : undefined;

      if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) {
        logger.warn('Skipping change with non-integer line numbers', { meetingId, rawChange });
        continue;
      }

      sanitized.push({
        start_line: startLine,
        end_line: endLine,
        replacement,
        rationale
      });
    }

    logger.info('Parsed changes from Claude response', {
      meetingId,
      changeCount: sanitized.length
    });

    return sanitized;
  }

  private applyChangesToTranscript(originalLines: string[], changes: TranscriptCorrectionChange[], meetingId: string): string {
    if (!changes.length) {
      return originalLines.join('\n');
    }

    const ascending = [...changes].sort((a, b) => a.start_line - b.start_line);

    for (let i = 1; i < ascending.length; i++) {
      const prev = ascending[i - 1];
      const curr = ascending[i];
      if (curr.start_line <= prev.end_line) {
        throw new Error(`Overlapping change ranges detected between lines ${prev.start_line}-${prev.end_line} and ${curr.start_line}-${curr.end_line}`);
      }
    }

    const workingLines = [...originalLines];

    const descending = [...ascending].sort((a, b) => b.start_line - a.start_line);
    descending.forEach(change => this.applySingleChange(workingLines, change, meetingId));

    return workingLines.join('\n');
  }

  private applySingleChange(lines: string[], change: TranscriptCorrectionChange, meetingId: string): void {
    const startIndex = Math.max(0, change.start_line - 1);
    const proposedEndIndex = change.end_line >= change.start_line ? change.end_line - 1 : change.start_line - 2;
    const endIndex = Math.min(proposedEndIndex, lines.length - 1);

    if (startIndex > lines.length) {
      throw new Error(`Change start line ${change.start_line} exceeds transcript length ${lines.length}`);
    }

    const deleteCount = endIndex >= startIndex ? Math.max(0, endIndex - startIndex + 1) : 0;

    let replacementLines: string[] = [];
    if (typeof change.replacement === 'string' && change.replacement.length > 0) {
      replacementLines = change.replacement.split(/\r?\n/).map(line => line.replace(/\r$/, ''));
      if (replacementLines.length === 1 && replacementLines[0] === '') {
        replacementLines = [];
      }
    }

    for (const line of replacementLines) {
      if (!this.TRANSCRIPT_LINE_REGEX.test(line)) {
        throw new Error(`Replacement line does not match transcript format: "${line}"`);
      }
    }

    lines.splice(startIndex, deleteCount, ...replacementLines);

    logger.debug('Applied transcript change', {
      meetingId,
      startLine: change.start_line,
      endLine: change.end_line,
      replacementLineCount: replacementLines.length,
      rationale: change.rationale
    });
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