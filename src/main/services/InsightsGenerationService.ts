import { getLogger } from './LoggingService';
import { Meeting, UserProfile, NotionShareMode } from '../../shared/types';
import { PromptService } from './PromptService';
import { BaseAnthropicService } from './BaseAnthropicService';

const logger = getLogger();

export interface MeetingInsights {
  summary: string;
  actionItems: Array<{
    owner: string;
    task: string;
    due?: string | null;
  }>;
  keyDecisions: string[];
  followUps: string[];
}

type InsightSection = 'summary' | 'action-items' | 'key-decisions';

type SectionRequestContext = 'insights-summary' | 'insights-action-items' | 'insights-key-decisions';

const SECTION_PROMPT_IDS: Record<InsightSection, string> = {
  summary: 'insights-summary',
  'action-items': 'insights-action-items',
  'key-decisions': 'insights-key-decisions'
};

const SECTION_CONTEXT: Record<InsightSection, SectionRequestContext> = {
  summary: 'insights-summary',
  'action-items': 'insights-action-items',
  'key-decisions': 'insights-key-decisions'
};

const SECTION_FALLBACKS: Record<InsightSection, string> = {
  summary: 'You are an experienced Executive Assistant. Using the provided meeting context, craft a concise executive summary (2-3 paragraphs) and list any unanswered questions or dependencies as follow-up items. Return JSON with keys "summary" (string) and "followUps" (array of strings).',
  'action-items': 'You are an experienced Executive Assistant. From the meeting context, list all actionable tasks with owners and due dates when available. Return JSON with key "actionItems" containing objects with owner (string), task (string), and due (ISO date string or null).',
  'key-decisions': 'You are an experienced Executive Assistant. Extract the concrete decisions agreed upon in the meeting, capturing any responsible parties or conditions. Return JSON with key "keyDecisions" containing an array of strings.'
};

type AnthropicRequestContext = SectionRequestContext | 'team-summary';

const REQUEST_CONTEXT_LABELS: Record<AnthropicRequestContext, string> = {
  'insights-summary': 'Meeting summary section',
  'insights-action-items': 'Meeting action items section',
  'insights-key-decisions': 'Meeting key decisions section',
  'team-summary': 'Team summary'
};

interface SummarySectionPayload {
  summary: string;
  followUps?: string[];
}

interface ActionItemsSectionPayload {
  actionItems: Array<{
    owner?: string;
    task?: string;
    due?: string | null;
  }>;
}

interface KeyDecisionsSectionPayload {
  keyDecisions: string[];
}

interface ShareToNotionParams {
  meeting: Meeting;
  mode: NotionShareMode;
  notionToken: string;
  notionDatabaseId: string;
}

export class InsightsGenerationService extends BaseAnthropicService {
  private promptService: PromptService | null;

  constructor(promptService: PromptService | null) {
    super('InsightsGenerationService');
    logger.info('[INSIGHTS-GENERATION-CONSTRUCTOR] Creating InsightsGenerationService', {
      hasPromptService: promptService !== null
    });
    this.promptService = promptService;
  }

  /**
   * Generate insights from meeting notes and transcript
   */
  async generateInsights(meeting: Meeting, userProfile?: UserProfile | null): Promise<string> {
    if (!this.anthropic) {
      logger.info('Insights generation skipped - no Anthropic API key configured');
      throw new Error('Insights generation not available');
    }

    logger.info(`Starting insights generation for meeting ${meeting.id}`);
    this.emit('insights-started', { meetingId: meeting.id });

    try {
      const prompt = this.buildMeetingContext(meeting);

      logger.info('[Insights][Service] Requesting Anthropic insights', {
        meetingId: meeting.id,
        notesLength: meeting.notes?.length || 0,
        transcriptLength: meeting.transcript?.length || 0
      });

      const [summaryPayload, actionItemsPayload, keyDecisionsPayload] = await Promise.all([
        this.generateInsightSection<SummarySectionPayload>('summary', meeting, prompt, userProfile),
        this.generateInsightSection<ActionItemsSectionPayload>('action-items', meeting, prompt, userProfile),
        this.generateInsightSection<KeyDecisionsSectionPayload>('key-decisions', meeting, prompt, userProfile)
      ]);

      const parsed: MeetingInsights = {
        summary: (summaryPayload?.summary || '').trim(),
        followUps: Array.isArray(summaryPayload?.followUps)
          ? summaryPayload.followUps.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          : [],
        actionItems: Array.isArray(actionItemsPayload?.actionItems)
          ? actionItemsPayload.actionItems
              .filter(item => item && typeof item.task === 'string' && item.task.trim())
              .map(item => {
                const task = (item.task || '').trim();
                const owner = (item.owner || '').trim() || 'Unassigned';
                const rawDue = typeof item.due === 'string' ? item.due.trim() : item.due;
                const due = rawDue && typeof rawDue === 'string' ? rawDue : null;
                return { owner, task, due };
              })
          : [],
        keyDecisions: Array.isArray(keyDecisionsPayload?.keyDecisions)
          ? keyDecisionsPayload.keyDecisions.filter((decision): decision is string => typeof decision === 'string' && decision.trim().length > 0)
          : []
      };

      logger.info(`Insights generation completed for meeting ${meeting.id}`);
      this.emit('insights-completed', { meetingId: meeting.id });

      return JSON.stringify(parsed);
    } catch (error) {
      logger.error('[Insights][Service] Failed to generate insights', {
        meetingId: meeting.id,
        error: error instanceof Error ? error.message : String(error)
      });
      this.emit('insights-failed', { meetingId: meeting.id, error });
      throw error;
    }
  }

  private async getSectionSystemPrompt(section: InsightSection, meeting: Meeting, userProfile?: UserProfile | null): Promise<string> {
    const promptId = SECTION_PROMPT_IDS[section];

    try {
      if (!this.promptService) {
        logger.warn('PromptService not available, using fallback prompt', { section });
        throw new Error('PromptService not initialized');
      }

      return await this.promptService.getInterpolatedPrompt(promptId, {
        userProfile,
        meeting,
        transcript: meeting.transcript,
        notes: meeting.notes
      });
    } catch (error) {
      logger.error(`Failed to load ${promptId} prompt, using fallback`, {
        section,
        error: error instanceof Error ? error.message : error
      });
      return SECTION_FALLBACKS[section];
    }
  }

  private async generateInsightSection<T>(
    section: InsightSection,
    meeting: Meeting,
    prompt: string,
    userProfile?: UserProfile | null
  ): Promise<T> {
    const systemPrompt = await this.getSectionSystemPrompt(section, meeting, userProfile);
    const rawJson = await this.requestWithRetries<T>({
      systemPrompt,
      prompt,
      context: SECTION_CONTEXT[section]
    });

    try {
      return JSON.parse(rawJson) as T;
    } catch (error) {
      logger.error('Failed to parse section JSON after successful response', {
        section,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  }

  private buildMeetingContext(meeting: Meeting): string {
    const attendeesList = Array.isArray(meeting.attendees)
      ? meeting.attendees.map(a => typeof a === 'string' ? a : a.name).join(', ')
      : 'Unknown';

    let prompt = `MEETING CONTEXT:
Title: ${meeting.title}
Date: ${meeting.date}
Attendees: ${attendeesList}

`;

    if (meeting.notes && meeting.notes.trim()) {
      prompt += `PERSONAL NOTES TAKEN DURING MEETING:
${meeting.notes}

`;
    } else {
      prompt += `PERSONAL NOTES: None taken

`;
    }

    if (meeting.transcript && meeting.transcript.trim()) {
      // Limit transcript to reasonable length to avoid token limits
      const transcriptLines = meeting.transcript.split('\n');
      const maxLines = 500; // Roughly 10-15k tokens
      const truncatedTranscript = transcriptLines.slice(0, maxLines).join('\n');

      prompt += `MEETING TRANSCRIPT:
${truncatedTranscript}`;

      if (transcriptLines.length > maxLines) {
        prompt += `\n[Transcript truncated - ${transcriptLines.length - maxLines} lines omitted]`;
      }
    } else {
      prompt += `TRANSCRIPT: Not available`;
    }

    prompt += `

Analyze this meeting and create insights that an experienced Executive Assistant would prepare. Consider the strategic importance, required actions, and follow-ups needed.
`;

    return prompt;
  }

  /**
   * Generate team summary from meeting notes and transcript
   */
  async generateTeamSummary(meeting: Meeting): Promise<string> {
    if (!this.anthropic) {
      logger.info('Team summary generation skipped - no Anthropic API key configured');
      throw new Error('Team summary generation not available');
    }

    logger.info(`Starting team summary generation for meeting ${meeting.id}`);

    try {
      const systemPrompt = await this.getSystemPromptForType('team-summary', meeting, null);
      const prompt = this.buildMeetingContext(meeting);

      const rawJson = await this.requestWithRetries<any>({
        systemPrompt,
        prompt,
        context: 'team-summary'
      });

      const parsed = JSON.parse(rawJson);
      logger.info(`Team summary generation completed for meeting ${meeting.id}`);
      return JSON.stringify(parsed);
    } catch (error) {
      logger.error('Failed to generate team summary:', error);
      throw error;
    }
  }

  /**
   * Share content to Slack webhook
   */
  async shareToSlack(webhookUrl: string, content: string): Promise<void> {
    if (!webhookUrl) {
      throw new Error('No Slack webhook URL configured');
    }

    logger.info('Sharing content to Slack');

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: content,
          unfurl_links: false,
          unfurl_media: false
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Slack webhook failed: ${response.status} ${errorText}`);
      }

      logger.info('Content shared to Slack successfully');
    } catch (error) {
      logger.error('Failed to share to Slack:', error);
      throw error;
    }
  }

  async shareToNotion(params: ShareToNotionParams): Promise<{ pageId?: string; url?: string }> {
    const { meeting, mode, notionToken, notionDatabaseId } = params;

    if (!notionToken || !notionDatabaseId) {
      throw new Error('Notion integration is not configured');
    }

    logger.info('Preparing Notion share payload', {
      meetingId: meeting.id,
      mode
    });

    const notionApiUrl = 'https://api.notion.com/v1/pages';

    const properties: Record<string, any> = {
      Name: {
        title: [
          {
            type: 'text',
            text: {
              content: meeting.title || 'Untitled Meeting'
            }
          }
        ]
      }
    };

    const children: any[] = [];

    const meetingDate = meeting.date ? new Date(meeting.date) : null;

    let datePropertyName: string | null = null;
    if (meetingDate && !Number.isNaN(meetingDate.getTime())) {
      try {
        const dbResponse = await fetch(`https://api.notion.com/v1/databases/${notionDatabaseId}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${notionToken}`,
            'Content-Type': 'application/json',
            'Notion-Version': '2022-06-28'
          }
        });

        if (dbResponse.ok) {
          const dbData = await dbResponse.json();
          const entry = Object.entries(dbData?.properties || {}).find(([, value]) => (value as any)?.type === 'date');
          if (entry) {
            datePropertyName = entry[0];
          } else {
            logger.warn('No date property available in Notion database; adding date to page body instead.', {
              databaseId: notionDatabaseId
            });
          }
        } else {
          logger.warn('Failed to fetch Notion database schema; proceeding without date property.', {
            databaseId: notionDatabaseId,
            status: dbResponse.status
          });
        }
      } catch (schemaError) {
        logger.warn('Error while inspecting Notion database schema.', {
          databaseId: notionDatabaseId,
          error: schemaError instanceof Error ? schemaError.message : schemaError
        });
      }

      if (datePropertyName) {
        properties[datePropertyName] = {
          date: {
            start: meetingDate.toISOString()
          }
        };
      }
    }

    if (mode === 'full') {
      children.push(...this.buildFullModeBlocks(meeting));
    } else {
      if (!meeting.insights) {
        throw new Error('No insights available for this meeting. Generate insights before sharing to Notion.');
      }

      let insights: MeetingInsights;
      try {
        insights = JSON.parse(meeting.insights);
      } catch (error) {
        logger.error('Failed to parse meeting insights JSON:', error);
        throw new Error('Stored meeting insights are malformed. Regenerate insights and try again.');
      }

      children.push(...this.buildInsightsBlocks(insights));
    }

    const response = await fetch(notionApiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${notionToken}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        parent: {
          database_id: notionDatabaseId
        },
        properties,
        children
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Notion API error', {
        status: response.status,
        error: errorText,
        mode,
        meetingId: meeting.id,
        properties: Object.keys(properties)
      });
      throw new Error(`Notion API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    return { pageId: data?.id, url: data?.url };
  }

  private buildFullModeBlocks(meeting: Meeting): any[] {
    const blocks: any[] = [];
    const meetingDate = meeting.date ? new Date(meeting.date) : null;

    blocks.push({
      type: 'heading_2',
      heading_2: {
        rich_text: [
          {
            type: 'text',
            text: { content: 'Meeting Summary' }
          }
        ]
      }
    });

    const attendees = Array.isArray(meeting.attendees)
      ? meeting.attendees.map(a => (typeof a === 'string' ? a : a.name)).join(', ')
      : 'Unknown';

    const metadataLines: string[] = [];

    if (meeting.date) {
      if (meetingDate && !Number.isNaN(meetingDate.getTime())) {
        metadataLines.push(`Date: ${meetingDate.toISOString()}`);
      } else if (typeof meeting.date === 'string') {
        metadataLines.push(`Date: ${meeting.date}`);
      }
    }

    metadataLines.push(
      `Status: ${meeting.status}`,
      `Attendees: ${attendees}`
    );

    blocks.push(...this.buildParagraphBlocks(metadataLines.join('\n')));

    blocks.push({
      type: 'heading_2',
      heading_2: {
        rich_text: [
          {
            type: 'text',
            text: { content: 'Notes' }
          }
        ]
      }
    });

    const notesContent = meeting.notes && meeting.notes.trim()
      ? meeting.notes.trim()
      : 'No notes were captured for this meeting.';

    blocks.push(...this.buildParagraphBlocks(notesContent));

    if (meeting.transcript && meeting.transcript.trim()) {
      blocks.push({
        type: 'heading_2',
        heading_2: {
          rich_text: [
            {
              type: 'text',
              text: { content: 'Transcript (excerpt)' }
            }
          ]
        }
      });

      const transcriptExcerpt = meeting.transcript.trim().split('\n').slice(0, 200).join('\n');
      blocks.push(...this.buildParagraphBlocks(transcriptExcerpt));
    }

    return blocks;
  }

  private buildInsightsBlocks(insights: MeetingInsights): any[] {
    const blocks: any[] = [];

    if (insights.summary) {
      blocks.push({
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: 'Summary' } }]
        }
      });
      blocks.push(...this.buildParagraphBlocks(insights.summary));
    }

    if (Array.isArray(insights.actionItems) && insights.actionItems.length > 0) {
      blocks.push({
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: 'Action Items' } }]
        }
      });
      insights.actionItems.forEach((item) => {
        const owner = item.owner || 'Unassigned';
        const description = `${owner}: ${item.task}${item.due ? ` (Due: ${item.due})` : ''}`;
        blocks.push({
          type: 'to_do',
          to_do: {
            checked: false,
            rich_text: [{ type: 'text', text: { content: description } }]
          }
        });
      });
    }

    if (Array.isArray(insights.keyDecisions) && insights.keyDecisions.length > 0) {
      blocks.push({
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: 'Key Decisions' } }]
        }
      });
      insights.keyDecisions.forEach((decision) => {
        blocks.push({
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [{ type: 'text', text: { content: decision } }]
          }
        });
      });
    }

    if (Array.isArray(insights.followUps) && insights.followUps.length > 0) {
      blocks.push({
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: 'Follow Ups' } }]
        }
      });
      insights.followUps.forEach((followUp) => {
        blocks.push({
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [{ type: 'text', text: { content: followUp } }]
          }
        });
      });
    }

    return blocks;
  }

  private buildParagraphBlocks(text: string): any[] {
    if (!text || !text.trim()) {
      return [{
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: '—' } }]
        }
      }];
    }

    const chunks = this.chunkText(text.trim(), 1800);
    return chunks.map(chunk => ({
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: chunk } }]
      }
    }));
  }

  private chunkText(text: string, chunkSize: number): string[] {
    const chunks: string[] = [];
    let current = '';

    text.split('\n').forEach((line) => {
      const candidate = current ? `${current}\n${line}` : line;
      if (candidate.length > chunkSize) {
        if (current) {
          chunks.push(current);
        }
        if (line.length > chunkSize) {
          for (let i = 0; i < line.length; i += chunkSize) {
            chunks.push(line.slice(i, i + chunkSize));
          }
          current = '';
        } else {
          current = line;
        }
      } else {
        current = candidate;
      }
    });

    if (current) {
      chunks.push(current);
    }

    return chunks.slice(0, 40); // cap to avoid hitting Notion block limits
  }

  private normalizeAnthropicJsonResponse<T>(raw: string, context: AnthropicRequestContext): string {
    const trimmed = (raw || '').trim();
    if (!trimmed) {
      throw new Error('Empty response received from Anthropic');
    }

    const fenceMatch = trimmed.match(/```json([\s\S]*?)```/i);
    if (fenceMatch && fenceMatch[1]) {
      return fenceMatch[1].trim();
    }

    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return trimmed;
    }

    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return trimmed.slice(firstBrace, lastBrace + 1);
    }

    const contextLabel = REQUEST_CONTEXT_LABELS[context] || 'Anthropic response';
    throw new Error(`${contextLabel} response was not valid JSON.`);
  }

  private async requestWithRetries<T>(params: {
    systemPrompt: string;
    prompt: string;
    context: AnthropicRequestContext;
    maxAttempts?: number;
  }): Promise<string> {
    if (!this.anthropic) {
      throw new Error('Anthropic client is not initialized');
    }

    const { systemPrompt, prompt, context, maxAttempts = 3 } = params;
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: prompt }
    ];

    let attempt = 0;
    let lastError: unknown = null;

    while (attempt < maxAttempts) {
      attempt += 1;

      try {
        logger.info('[Insights][Anthropic] Sending request attempt', {
          attempt,
          context,
          temperature: attempt === 1 ? 0.3 : 0.2
        });

        const response = await this.anthropic.messages.create({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 4096,
          temperature: attempt === 1 ? 0.3 : 0.2,
          system: systemPrompt,
          messages
        });

        const firstContent = response.content[0];
        if (firstContent && firstContent.type === 'text') {
          const assistantReply = firstContent.text || '';
          const normalized = this.normalizeAnthropicJsonResponse<T>(assistantReply, context);

          try {
            JSON.parse(normalized); // Validate JSON
            logger.info('[Insights][Anthropic] Received valid JSON', {
              attempt,
              context,
              length: normalized.length
            });
            return normalized;
          } catch (parseError) {
            lastError = parseError;
            logger.warn(`[${context.toUpperCase()}] Attempt ${attempt} produced invalid JSON`, {
              error: parseError instanceof Error ? parseError.message : parseError
            });

            if (attempt >= maxAttempts) {
              throw parseError;
            }

            messages.push({ role: 'assistant', content: assistantReply });
            messages.push({
              role: 'user',
              content: this.buildRetryInstruction(context, parseError)
            });
            continue;
          }
        }

        lastError = new Error('Unexpected response format from Anthropic');
        logger.warn(`[${context.toUpperCase()}] Attempt ${attempt} returned unexpected format`);
      } catch (error) {
        lastError = error;
        logger.warn(`[${context.toUpperCase()}] Attempt ${attempt} failed`, {
          error: error instanceof Error ? error.message : error
        });

        if (attempt >= maxAttempts) {
          throw error;
        }

        messages.push({
          role: 'user',
          content: this.buildRetryInstruction(context, error)
        });
        continue;
      }

      if (attempt >= maxAttempts) {
        throw lastError instanceof Error ? lastError : new Error('Failed to produce valid JSON response');
      }

      if (lastError) {
        messages.push({
          role: 'user',
          content: this.buildRetryInstruction(context, lastError)
        });
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Failed to produce valid JSON response');
  }

  private buildRetryInstruction(context: AnthropicRequestContext, error: unknown): string {
    const reason = error instanceof Error ? error.message : String(error ?? 'Unknown error');
    let structureHint: string;

    switch (context) {
      case 'insights-summary':
        structureHint = 'Provide keys: summary (string) and followUps (array of strings).';
        break;
      case 'insights-action-items':
        structureHint = 'Provide key "actionItems" containing an array of objects with owner (string), task (string), and due (string or null).';
        break;
      case 'insights-key-decisions':
        structureHint = 'Provide key "keyDecisions" containing an array of strings.';
        break;
      case 'team-summary':
      default:
        structureHint = 'Return the same JSON structure used previously for the team summary, preserving all required fields exactly.';
        break;
    }

    return [
      `The previous response was not valid JSON and could not be parsed (error: ${reason}).`,
      'Respond again with ONLY valid JSON using double-quoted keys and no surrounding commentary or code fences.',
      structureHint
    ].join(' ');
  }

  private async getSystemPromptForType(promptType: string, meeting: Meeting, userProfile?: UserProfile | null): Promise<string> {
    try {
      if (!this.promptService) {
        logger.warn('PromptService not available, using fallback prompt');
        throw new Error('PromptService not initialized');
      }
      return await this.promptService.getInterpolatedPrompt(promptType, {
        userProfile,
        meeting,
        transcript: meeting.transcript,
        notes: meeting.notes
      });
    } catch (error) {
      logger.error(`Failed to load ${promptType} prompt, using fallback:`, error);
      // Fallback prompt based on type
      if (promptType === 'team-summary') {
        return 'You are preparing a team update. Create a sanitized summary removing personal notes or sensitive information. Focus on key decisions, action items with owners, and required follow-ups. Return JSON with: summary, actionItems, keyDecisions, followUps.';
      }
      return 'You are an experienced Executive Assistant. Analyze the meeting content and produce structured insights in JSON format with summary, actionItems, keyDecisions, and followUps.';
    }
  }
}

