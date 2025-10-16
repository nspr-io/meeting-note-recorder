import Store from 'electron-store';
import path from 'path';
import { app } from 'electron';
import { AppSettings, UserProfile } from '../../shared/types';
import { ConfigValidator } from './ConfigValidator';
import { createServiceLogger } from './ServiceLogger';

const logger = createServiceLogger('SettingsService');

export class SettingsService {
  private store: any; // Using any to work around TypeScript issues with electron-store in tests

  private defaultSettings: AppSettings = {
    recallApiUrl: process.env.RECALL_API_URL || 'https://us-west-2.recall.ai',
    storagePath: path.join(app.getPath('documents'), 'MeetingRecordings'),
    googleCalendarConnected: false,
    autoStartOnBoot: false,
    selectedCalendars: [],
    recallApiKey: process.env.RECALL_API_KEY || '',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    slackWebhookUrl: '',
    notionIntegrationToken: process.env.NOTION_INTEGRATION_TOKEN || '',
    notionDatabaseId: process.env.NOTION_DATABASE_ID || '',
    notionTodoIntegrationToken: process.env.NOTION_TODO_INTEGRATION_TOKEN || '',
    notionTodoDatabaseId: process.env.NOTION_TODO_DATABASE_ID || ''
  };

  constructor() {
    this.store = new Store<AppSettings>({
      defaults: this.defaultSettings,
      encryptionKey: 'meeting-recorder-secret-key', // In production, use a more secure key
    });
  }

  async initialize(): Promise<void> {
    // Validate current settings
    const currentSettings = this.getSettings();
    const validation = ConfigValidator.validateSettings(currentSettings);

    if (!validation.valid) {
      logger.warn('Settings validation errors:', validation.errors);
      // Apply safe defaults for invalid settings
      const safeDefaults = ConfigValidator.getDefaults();
      await this.updateSettings(safeDefaults);
    }

    // Ensure storage directory exists
    const storagePath = this.getSettings().storagePath;
    const fs = require('fs').promises;

    try {
      await fs.mkdir(storagePath, { recursive: true });
    } catch (error) {
      logger.error('Failed to create storage directory:', error);
    }

    // Log current settings for debugging
    logger.info('Settings initialized:', {
      googleCalendarConnected: this.store.get ? this.store.get('googleCalendarConnected') : this.store.store?.googleCalendarConnected,
      hasApiKey: !!this.getApiKey(),
      storagePath: this.store.get ? this.store.get('storagePath') : this.store.store?.storagePath
    });
  }

  getSettings(): AppSettings {
    const settings = this.store.get ? {
      recallApiUrl: this.store.get('recallApiUrl') || this.defaultSettings.recallApiUrl,
      storagePath: this.store.get('storagePath') || this.defaultSettings.storagePath,
      googleCalendarConnected: this.store.get('googleCalendarConnected') || false,
      autoStartOnBoot: this.store.get('autoStartOnBoot') || false,
      selectedCalendars: this.store.get('selectedCalendars') || [],
      recallApiKey: this.getApiKey(),
      anthropicApiKey: this.getAnthropicApiKey(),
      slackWebhookUrl: this.store.get('slackWebhookUrl') || '',
      notionIntegrationToken: this.getNotionIntegrationToken(),
      notionDatabaseId: this.getNotionDatabaseId(),
      notionTodoIntegrationToken: this.getNotionTodoIntegrationToken(),
      notionTodoDatabaseId: this.getNotionTodoDatabaseId()
    } : this.store.store;
    // Include the API keys from environment or store
    return {
      ...settings,
      recallApiKey: this.getApiKey(),
      anthropicApiKey: this.getAnthropicApiKey(),
      slackWebhookUrl: this.store.get ? this.store.get('slackWebhookUrl') || '' : this.store.store?.slackWebhookUrl || '',
      notionIntegrationToken: this.getNotionIntegrationToken(),
      notionDatabaseId: this.getNotionDatabaseId(),
      notionTodoIntegrationToken: this.getNotionTodoIntegrationToken(),
      notionTodoDatabaseId: this.getNotionTodoDatabaseId()
    };
  }

  async updateSettings(updates: Partial<AppSettings>): Promise<AppSettings> {
    const currentSettings = this.getSettings();
    
    // Handle API keys separately if provided
    if (updates.recallApiKey !== undefined) {
      this.setApiKey(updates.recallApiKey);
    }
    if (updates.anthropicApiKey !== undefined) {
      this.setAnthropicApiKey(updates.anthropicApiKey);
    }
    if (updates.notionIntegrationToken !== undefined) {
      this.setNotionIntegrationToken(updates.notionIntegrationToken);
    }
    if (updates.notionDatabaseId !== undefined) {
      this.setNotionDatabaseId(updates.notionDatabaseId);
    }
    if (updates.notionTodoIntegrationToken !== undefined) {
      this.setNotionTodoIntegrationToken(updates.notionTodoIntegrationToken);
    }
    if (updates.notionTodoDatabaseId !== undefined) {
      this.setNotionTodoDatabaseId(updates.notionTodoDatabaseId);
    }

    // Don't store API keys in the main settings object
    const {
      recallApiKey,
      anthropicApiKey,
      notionIntegrationToken,
      notionDatabaseId,
      notionTodoIntegrationToken,
      notionTodoDatabaseId,
      ...settingsToStore
    } = updates;
    const newSettings = { ...currentSettings, ...settingsToStore };
    
    // If storage path changed, create new directory
    if (updates.storagePath && updates.storagePath !== currentSettings.storagePath) {
      const fs = require('fs').promises;
      try {
        await fs.mkdir(updates.storagePath, { recursive: true });
      } catch (error) {
        console.error('Failed to create new storage directory:', error);
        throw error;
      }
    }

    // Update auto-start setting
    if (updates.autoStartOnBoot !== undefined) {
      app.setLoginItemSettings({
        openAtLogin: updates.autoStartOnBoot,
      });
    }

    if (this.store.set) {
      Object.entries(settingsToStore).forEach(([key, value]) => {
        this.store.set(key, value);
      });
    } else {
      this.store.store = { ...this.store.store, ...settingsToStore };
    }
    return this.getSettings(); // Return settings including API key
  }

  getNotionIntegrationToken(): string | undefined {
    const envToken = process.env.NOTION_INTEGRATION_TOKEN;
    if (envToken) {
      return envToken;
    }
    return this.store.get ? this.store.get('notionIntegrationToken') : this.store.store?.notionIntegrationToken;
  }

  setNotionIntegrationToken(token: string): void {
    if (this.store.set) {
      this.store.set('notionIntegrationToken', token);
    } else {
      this.store.store = { ...this.store.store, notionIntegrationToken: token };
    }
  }

  clearNotionIntegrationToken(): void {
    if (this.store.delete) {
      this.store.delete('notionIntegrationToken');
    } else if (this.store.store) {
      delete this.store.store.notionIntegrationToken;
    }
  }

  getNotionDatabaseId(): string | undefined {
    const envId = process.env.NOTION_DATABASE_ID;
    if (envId) {
      return envId;
    }
    return this.store.get ? this.store.get('notionDatabaseId') : this.store.store?.notionDatabaseId;
  }

  setNotionDatabaseId(databaseId: string): void {
    if (this.store.set) {
      this.store.set('notionDatabaseId', databaseId);
    } else {
      this.store.store = { ...this.store.store, notionDatabaseId: databaseId };
    }
  }

  clearNotionDatabaseId(): void {
    if (this.store.delete) {
      this.store.delete('notionDatabaseId');
    } else if (this.store.store) {
      delete this.store.store.notionDatabaseId;
    }
  }

  getNotionTodoDatabaseId(): string | undefined {
    const envId = process.env.NOTION_TODO_DATABASE_ID;
    if (envId) {
      return envId;
    }
    return this.store.get ? this.store.get('notionTodoDatabaseId') : this.store.store?.notionTodoDatabaseId;
  }

  setNotionTodoDatabaseId(databaseId: string): void {
    if (this.store.set) {
      this.store.set('notionTodoDatabaseId', databaseId);
    } else {
      this.store.store = { ...this.store.store, notionTodoDatabaseId: databaseId };
    }
  }

  clearNotionTodoDatabaseId(): void {
    if (this.store.delete) {
      this.store.delete('notionTodoDatabaseId');
    } else if (this.store.store) {
      delete this.store.store.notionTodoDatabaseId;
    }
  }

  getNotionTodoIntegrationToken(): string | undefined {
    const envToken = process.env.NOTION_TODO_INTEGRATION_TOKEN;
    if (envToken) {
      return envToken;
    }
    return this.store.get ? this.store.get('notionTodoIntegrationToken') : this.store.store?.notionTodoIntegrationToken;
  }

  setNotionTodoIntegrationToken(token: string): void {
    if (this.store.set) {
      this.store.set('notionTodoIntegrationToken', token);
    } else {
      this.store.store = { ...this.store.store, notionTodoIntegrationToken: token };
    }
  }

  clearNotionTodoIntegrationToken(): void {
    if (this.store.delete) {
      this.store.delete('notionTodoIntegrationToken');
    } else if (this.store.store) {
      delete this.store.store.notionTodoIntegrationToken;
    }
  }

  getApiKey(): string | undefined {
    // First try to get from environment variable
    const envApiKey = process.env.RECALL_API_KEY;
    if (envApiKey) {
      return envApiKey;
    }
    // Fall back to stored value
    return this.store.get ? this.store.get('recallApiKey') : this.store.store?.recallApiKey;
  }

  setApiKey(apiKey: string): void {
    if (this.store.set) {
      this.store.set('recallApiKey', apiKey);
    } else {
      this.store.store = { ...this.store.store, recallApiKey: apiKey };
    }
  }

  clearApiKey(): void {
    if (this.store.delete) {
      this.store.delete('recallApiKey');
    } else if (this.store.store) {
      delete this.store.store.recallApiKey;
    }
  }

  setStoragePath(path: string): void {
    if (this.store.set) {
      this.store.set('storagePath', path);
    } else {
      this.store.store = { ...this.store.store, storagePath: path };
    }
  }

  getStoragePath(): string {
    return this.store.get ? this.store.get('storagePath') : this.store.store?.storagePath;
  }

  getAnthropicApiKey(): string | undefined {
    // First try to get from environment variable
    const envApiKey = process.env.ANTHROPIC_API_KEY;
    if (envApiKey) {
      return envApiKey;
    }
    // Fall back to stored value
    return this.store.get ? this.store.get('anthropicApiKey') : this.store.store?.anthropicApiKey;
  }

  setAnthropicApiKey(apiKey: string): void {
    if (this.store.set) {
      this.store.set('anthropicApiKey', apiKey);
    } else {
      this.store.store = { ...this.store.store, anthropicApiKey: apiKey };
    }
  }

  clearAnthropicApiKey(): void {
    if (this.store.delete) {
      this.store.delete('anthropicApiKey');
    } else if (this.store.store) {
      delete this.store.store.anthropicApiKey;
    }
  }

  getProfile(): UserProfile | null {
    const profile = this.store.get ? this.store.get('userProfile') : this.store.store?.userProfile;
    return profile || null;
  }

  setProfile(profile: UserProfile): void {
    if (this.store.set) {
      this.store.set('userProfile', profile);
    } else {
      this.store.store = { ...this.store.store, userProfile: profile };
    }
  }

}