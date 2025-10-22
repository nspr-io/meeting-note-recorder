import { getLogger } from './LoggingService';
import { detectPlatform } from '../../shared/utils/PlatformDetector';
import { BaseAnthropicService } from './BaseAnthropicService';

const logger = getLogger();

interface ProcessedDescription {
  meetingUrl?: string;
  platform?: string;
  notes: string;
}

export class DescriptionProcessingService extends BaseAnthropicService {
  constructor() {
    super('DescriptionProcessingService');
  }

  /**
   * Process calendar event description to extract meeting URL and relevant notes
   */
  async processDescription(description: string): Promise<ProcessedDescription> {
    // First try LLM processing if available
    if (this.anthropic) {
      try {
        return await this.processWithLLM(description);
      } catch (error) {
        logger.warn('LLM processing failed, falling back to regex extraction:', error);
      }
    }

    // Fallback to regex-based extraction
    return this.extractWithRegex(description);
  }

  private async processWithLLM(description: string): Promise<ProcessedDescription> {
    if (!this.anthropic) {
      throw new Error('Anthropic client not initialized');
    }

    const systemPrompt = `You are an executive assistant processing calendar invitations.
Extract the meeting URL and any relevant information from the description.

Return JSON with:
- meetingUrl: The video conference link (prefer links with embedded passwords/meeting IDs)
- platform: zoom|teams|meet|webex|slack|other (detect from URL)
- notes: Any useful information like agenda items, preparation notes, or important context.
  Keep it concise and relevant. If there's nothing useful beyond the meeting link, leave this empty.

Ignore: email signatures, cancellation links, scheduling system metadata, boilerplate text like "is inviting you to a scheduled meeting"`;

      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
      max_tokens: 500,
      temperature: 0,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: description
        }
      ]
    });

    // Parse the response
    const responseText = response.content[0].type === 'text' ? response.content[0].text : '';

    const normalized = this.parseLLMResponse(responseText);
    if (normalized) {
      return normalized;
    }

    logger.warn('LLM response not in expected JSON format, falling back to text extraction');
    return this.extractFromText(responseText);
  }

  private parseLLMResponse(raw: string): ProcessedDescription | null {
    const stripped = this.stripCodeFences(raw);
    const candidate = this.extractJsonBlock(stripped) ?? stripped.trim();

    if (!candidate) {
      return null;
    }

    try {
      let parsed: any = JSON.parse(candidate);

      if (Array.isArray(parsed)) {
        parsed = parsed[0];
      }

      if (!parsed || typeof parsed !== 'object') {
        return null;
      }

      const meetingUrl = typeof parsed.meetingUrl === 'string' ? parsed.meetingUrl.trim() : undefined;
      const platform = typeof parsed.platform === 'string' ? parsed.platform.trim() : undefined;
      const notes = typeof parsed.notes === 'string' ? parsed.notes.trim() : '';

      return {
        meetingUrl: meetingUrl || undefined,
        platform: platform || (meetingUrl ? detectPlatform(meetingUrl) : undefined),
        notes: notes || ''
      };
    } catch (error) {
      logger.warn('Failed to parse sanitized LLM JSON payload', {
        error: error instanceof Error ? error.message : error
      });
      return null;
    }
  }

  private stripCodeFences(text: string): string {
    if (!text) {
      return '';
    }

    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) {
      return fenceMatch[1].trim();
    }

    return text.trim();
  }

  private extractJsonBlock(text: string): string | null {
    const start = text.search(/[\[{]/);
    if (start === -1) {
      return null;
    }

    const stack: string[] = [];
    let inString: string | null = null;
    let escape = false;

    for (let i = start; i < text.length; i++) {
      const char = text[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (char === '\\') {
        escape = true;
        continue;
      }

      if (char === '"') {
        if (inString) {
          inString = inString === '"' ? null : inString;
        } else {
          inString = '"';
        }
        continue;
      }

      if (inString) {
        continue;
      }

      if (char === '{' || char === '[') {
        stack.push(char);
      } else if (char === '}' || char === ']') {
        const expected = stack.pop();
        if (!expected) {
          return null;
        }
        if ((expected === '{' && char !== '}') || (expected === '[' && char !== ']')) {
          return null;
        }
        if (stack.length === 0) {
          return text.slice(start, i + 1);
        }
      }
    }

    return null;
  }

  private extractWithRegex(description: string): ProcessedDescription {
    // Common conference URL patterns with password/id parameters
    const urlPatterns = [
      // Zoom with password
      /https?:\/\/[\w\-\.]*zoom\.us\/[js]\/\d+\?pwd=[A-Za-z0-9\.\-_]+/gi,
      // Google Meet
      /https?:\/\/meet\.google\.com\/[a-z\-]+/gi,
      // Teams
      /https?:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\\s\]]+/gi,
      // Webex
      /https?:\/\/[\w\-\.]*webex\.com\/meet\/[^\s\]]+/gi,
      // Generic Zoom (without password)
      /https?:\/\/[\w\-\.]*zoom\.us\/[js]\/\d+/gi,
    ];

    let meetingUrl: string | undefined;
    let platform: string | undefined;

    // Try each pattern to find a meeting URL
    for (const pattern of urlPatterns) {
      const match = description.match(pattern);
      if (match) {
        meetingUrl = match[0];
        platform = detectPlatform(meetingUrl);
        break;
      }
    }

    // Extract potentially useful content (basic heuristic)
    let notes = '';

    // Remove the meeting URL from description to avoid duplication
    let cleanedDescription = description;
    if (meetingUrl) {
      cleanedDescription = cleanedDescription.replace(meetingUrl, '');
    }

    // Remove common boilerplate patterns
    const boilerplatePatterns = [
      /.*is inviting you to a scheduled .* meeting.*/gi,
      /Join from PC, Mac, Linux, iOS or Android:/gi,
      /View original email thread here:.*/gi,
      /To cancel or reschedule.*:/gi,
      /Scheduled with .*/gi,
      /--+/g,
      /\\-+/g,
    ];

    for (const pattern of boilerplatePatterns) {
      cleanedDescription = cleanedDescription.replace(pattern, '');
    }

    // Clean up extra whitespace
    cleanedDescription = cleanedDescription.trim().replace(/\n{3,}/g, '\n\n');

    // Only keep the notes if there's substantial content left
    if (cleanedDescription.length > 50) {
      notes = cleanedDescription;
    }

    return {
      meetingUrl,
      platform,
      notes
    };
  }

  private extractFromText(text: string): ProcessedDescription {
    // Try to extract URL and notes from freeform text
    const lines = text.split('\n');
    let meetingUrl: string | undefined;
    let notes = '';

    for (const line of lines) {
      if (!meetingUrl && line.includes('http')) {
        // Try to extract URL from this line
        const urlMatch = line.match(/https?:\/\/[^\s\]]+/);
        if (urlMatch) {
          meetingUrl = urlMatch[0];
        }
      } else if (line.trim() && !line.includes('meetingUrl') && !line.includes('platform')) {
        // Accumulate as notes
        notes += (notes ? '\n' : '') + line.trim();
      }
    }

    return {
      meetingUrl,
      platform: meetingUrl ? detectPlatform(meetingUrl) : undefined,
      notes
    };
  }
}