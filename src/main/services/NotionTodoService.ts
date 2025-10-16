import { createServiceLogger } from './ServiceLogger';

const logger = createServiceLogger('NotionActionItemService');

const NOTION_VERSION = '2022-06-28';

interface CreateActionItemsParams {
  notionToken: string;
  databaseId: string;
  items: Array<{
    task: string;
    owner?: string;
    due?: string;
    alreadySent?: boolean;
    insightIndex?: number;
  }>;
}

interface CreateActionItemResult {
  task: string;
  notionPageId?: string;
  notionPageUrl?: string;
  success: boolean;
  error?: string;
  skipped?: boolean;
  insightIndex?: number;
}

interface DatabasePropertyMapping {
  titleProperty?: string;
  dateProperty?: string;
  checkboxProperty?: string;
  statusProperty?: string;
  statusOptions?: string[];
}

export class NotionTodoService {
  async createActionItems({ notionToken, databaseId, items }: CreateActionItemsParams): Promise<CreateActionItemResult[]> {
    const trimmedDbId = (databaseId || '').trim();
    if (!trimmedDbId) {
      throw new Error('Notion to-do database ID is required');
    }

    const mapping = await this.getDatabaseProperties(notionToken, trimmedDbId);

    const results: CreateActionItemResult[] = [];

    for (const item of items) {
      if (item.alreadySent) {
        results.push({
          task: item.task,
          success: true,
          skipped: true,
          insightIndex: item.insightIndex
        });
        continue;
      }

      try {
        const payload = this.buildCreatePayload(trimmedDbId, mapping, item);
        const response = await fetch('https://api.notion.com/v1/pages', {
          method: 'POST',
          headers: this.buildHeaders(notionToken),
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.error('Failed to create Notion action item', {
            status: response.status,
            error: errorText
          });
          results.push({
            task: item.task,
            success: false,
            error: `Notion API error: ${response.status}`
          });
          continue;
        }

        const data = await response.json();
        results.push({
          task: item.task,
          success: true,
          notionPageId: data?.id,
          notionPageUrl: data?.url,
          insightIndex: item.insightIndex
        });
      } catch (error) {
        results.push({
          task: item.task,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          insightIndex: item.insightIndex
        });
      }
    }

    return results;
  }

  private async getDatabaseProperties(notionToken: string, databaseId: string): Promise<DatabasePropertyMapping> {
    try {
      const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
        method: 'GET',
        headers: this.buildHeaders(notionToken)
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn('Unable to load Notion database schema', {
          status: response.status,
          error: errorText
        });
        return {};
      }

      const schema = await response.json();
      const entries = Object.entries(schema?.properties || {});

      const mapping: DatabasePropertyMapping = {};

      for (const [key, value] of entries) {
        const property: any = value;
        if (!mapping.titleProperty && property?.type === 'title') {
          mapping.titleProperty = key;
          continue;
        }

        if (!mapping.dateProperty && property?.type === 'date') {
          mapping.dateProperty = key;
        }

        if (!mapping.checkboxProperty && property?.type === 'checkbox') {
          mapping.checkboxProperty = key;
        }

        if (!mapping.statusProperty && property?.type === 'status') {
          mapping.statusProperty = key;
          if (Array.isArray(property?.status?.options)) {
            mapping.statusOptions = property.status.options.map((option: any) => option?.name).filter(Boolean);
          }
        }
      }

      return mapping;
    } catch (error) {
      logger.warn('Error while fetching Notion database schema', {
        databaseId,
        error: error instanceof Error ? error.message : error
      });
      return {};
    }
  }

  private buildCreatePayload(databaseId: string, mapping: DatabasePropertyMapping, item: { task: string; owner?: string; due?: string }) {
    const properties: Record<string, any> = {};

    const titleProperty = mapping.titleProperty || 'Name';
    properties[titleProperty] = {
      title: [
        {
          type: 'text',
          text: {
            content: item.task
          }
        }
      ]
    };

    if (mapping.dateProperty && item.due) {
      properties[mapping.dateProperty] = {
        date: {
          start: item.due
        }
      };
    }

    if (mapping.checkboxProperty) {
      properties[mapping.checkboxProperty] = {
        checkbox: false
      };
    }

    if (mapping.statusProperty && mapping.statusOptions && mapping.statusOptions.length > 0) {
      properties[mapping.statusProperty] = {
        status: {
          name: mapping.statusOptions[0]
        }
      };
    }

    const children: any[] = [];

    if (item.owner) {
      children.push(this.buildBulletedListItem(`Owner: ${item.owner}`));
    }

    if (item.due) {
      children.push(this.buildBulletedListItem(`Due: ${item.due}`));
    }

    if (children.length === 0) {
      children.push(this.buildBulletedListItem('Created by Meeting Note Recorder'));
    }

    return {
      parent: {
        database_id: databaseId
      },
      properties,
      children
    };
  }

  private buildBulletedListItem(content: string) {
    return {
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: {
        rich_text: [
          {
            type: 'text',
            text: {
              content
            }
          }
        ]
      }
    };
  }

  private buildHeaders(notionToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${notionToken}`,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_VERSION
    };
  }
}
