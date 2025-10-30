import Store from 'electron-store';
import { promises as fs } from 'fs';
import path from 'path';
import { app } from 'electron';
import { AppSettings, CoachConfig, CoachVariable, DEFAULT_COACH_CONFIGS, UserProfile } from '../../shared/types';
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
    firefliesApiKey: process.env.FIREFLIES_API_KEY || '',
    slackWebhookUrl: '',
    notionIntegrationToken: process.env.NOTION_INTEGRATION_TOKEN || '',
    notionDatabaseId: process.env.NOTION_DATABASE_ID || '',
    notionTodoIntegrationToken: process.env.NOTION_TODO_INTEGRATION_TOKEN || '',
    notionTodoDatabaseId: process.env.NOTION_TODO_DATABASE_ID || '',
    coaches: DEFAULT_COACH_CONFIGS.map(coach => ({ ...coach })),
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
      // Apply sanitized settings while preserving existing values
      const sanitizedSettings = ConfigValidator.sanitizeSettings({
        ...this.defaultSettings,
        ...currentSettings
      });
      await this.updateSettings(sanitizedSettings);
    }

    // Ensure storage directory exists
    const storagePath = this.getSettings().storagePath;
    try {
      await fs.mkdir(storagePath, { recursive: true });
    } catch (error) {
      logger.error('Failed to create storage directory:', error);
    }

    await this.syncCustomCoachesFromPrompts();

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
      firefliesApiKey: this.getFirefliesApiKey(),
      slackWebhookUrl: this.store.get('slackWebhookUrl') || '',
      notionIntegrationToken: this.getNotionIntegrationToken(),
      notionDatabaseId: this.getNotionDatabaseId(),
      notionTodoIntegrationToken: this.getNotionTodoIntegrationToken(),
      notionTodoDatabaseId: this.getNotionTodoDatabaseId(),
      coaches: this.ensureCoachesSchema(this.store.get('coaches')),
    } : this.store.store;
    // Include the API keys from environment or store
    return {
      ...settings,
      recallApiKey: this.getApiKey(),
      anthropicApiKey: this.getAnthropicApiKey(),
      firefliesApiKey: this.getFirefliesApiKey(),
      slackWebhookUrl: this.store.get ? this.store.get('slackWebhookUrl') || '' : this.store.store?.slackWebhookUrl || '',
      notionIntegrationToken: this.getNotionIntegrationToken(),
      notionDatabaseId: this.getNotionDatabaseId(),
      notionTodoIntegrationToken: this.getNotionTodoIntegrationToken(),
      notionTodoDatabaseId: this.getNotionTodoDatabaseId(),
      coaches: this.ensureCoachesSchema(settings?.coaches),
    };
  }

  private ensureCoachesSchema(coachesCandidate: unknown): CoachConfig[] {
    const existing = Array.isArray(coachesCandidate) ? coachesCandidate.filter((c): c is CoachConfig => typeof c === 'object' && !!c && typeof (c as any).id === 'string') : [];
    const defaultsById = new Map(DEFAULT_COACH_CONFIGS.map((coach) => [coach.id, coach]));

    const merged = new Map<string, CoachConfig>();
    for (const coach of existing) {
      const base = defaultsById.get(coach.id);
      const sanitizedVariables = this.sanitizeCoachVariables((coach as any).variables);
      merged.set(coach.id, {
        id: coach.id,
        name: typeof (coach as any).name === 'string' ? (coach as any).name : base?.name || coach.id,
        description: typeof (coach as any).description === 'string' ? (coach as any).description : base?.description || '',
        enabled: typeof coach.enabled === 'boolean' ? coach.enabled : base?.enabled ?? true,
        isCustom: coach.isCustom ?? !defaultsById.has(coach.id),
        variables: sanitizedVariables,
      });
    }

    for (const def of DEFAULT_COACH_CONFIGS) {
      if (!merged.has(def.id)) {
        merged.set(def.id, { ...def, variables: this.sanitizeCoachVariables(def.variables) });
      }
    }

    return Array.from(merged.values());
  }

  private sanitizeCoachVariables(variablesCandidate: unknown): CoachVariable[] {
    if (!Array.isArray(variablesCandidate)) {
      return [];
    }

    const sanitized: CoachVariable[] = [];
    for (const candidate of variablesCandidate) {
      if (!candidate || typeof candidate !== 'object') {
        continue;
      }

      const id = typeof (candidate as any).id === 'string' && (candidate as any).id.trim() ? (candidate as any).id.trim() : null;
      const label = typeof (candidate as any).label === 'string' ? (candidate as any).label.trim() : '';
      const key = typeof (candidate as any).key === 'string' ? (candidate as any).key.trim() : '';
      const filePath = typeof (candidate as any).filePath === 'string' ? (candidate as any).filePath.trim() : '';

      if (!id || !key || !filePath) {
        continue;
      }

      sanitized.push({
        id,
        label: label || key,
        key,
        filePath,
      });
    }

    return sanitized;
  }

  private async syncCustomCoachesFromPrompts(): Promise<void> {
    try {
      const promptsDir = path.join(app.getPath('userData'), 'prompts');
      await fs.mkdir(promptsDir, { recursive: true });

      const entries = await fs.readdir(promptsDir);
      const coachPromptIds = new Set(
        entries
          .filter(name => name.startsWith('coach-') && name.endsWith('.txt'))
          .map(name => name.slice(0, -4))
      );

      const defaultCoachIds = new Set(DEFAULT_COACH_CONFIGS.map(coach => coach.id));
      const currentCoaches = this.getCoaches();
      const coachMap = new Map<string, CoachConfig>(currentCoaches.map(coach => [coach.id, { ...coach }]));

      let mutated = false;

      for (const coachId of coachPromptIds) {
        if (defaultCoachIds.has(coachId)) {
          continue;
        }

        if (!coachMap.has(coachId)) {
          coachMap.set(coachId, {
            id: coachId,
            name: this.deriveCoachName(coachId),
            description: '',
            enabled: true,
            isCustom: true,
            variables: [],
          });
          mutated = true;
        }
      }

      for (const [coachId, coach] of coachMap.entries()) {
        if (coach.isCustom && !coachPromptIds.has(coachId) && coach.enabled) {
          coachMap.set(coachId, { ...coach, enabled: false });
          mutated = true;
        }
      }

      if (mutated) {
        this.setCoaches(Array.from(coachMap.values()));
      }
    } catch (error) {
      logger.warn('Failed to synchronize custom coaches from prompts directory:', error);
    }
  }

  private deriveCoachName(coachId: string): string {
    const trimmed = coachId.replace(/^coach-/, '');
    if (!trimmed) {
      return 'Custom Coach';
    }

    const parts = trimmed.split('-').filter(Boolean);
    if (parts.length === 0) {
      return 'Custom Coach';
    }

    return parts
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
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
    if (updates.firefliesApiKey !== undefined) {
      this.setFirefliesApiKey(updates.firefliesApiKey);
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
      recallApiKey: _recallApiKey,
      anthropicApiKey: _anthropicApiKey,
      notionIntegrationToken: _notionIntegrationToken,
      notionDatabaseId: _notionDatabaseId,
      notionTodoIntegrationToken: _notionTodoIntegrationToken,
      notionTodoDatabaseId: _notionTodoDatabaseId,
      firefliesApiKey: _firefliesApiKey,
      coaches,
      ...settingsToStore
    } = updates;
    const settingsWithCoaches = coaches
      ? { ...settingsToStore, coaches: this.ensureCoachesSchema(coaches).map(coach => ({ ...coach, variables: this.sanitizeCoachVariables(coach.variables) })) }
      : settingsToStore;

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

    const dataToStore = settingsWithCoaches;

    if (this.store.set) {
      Object.entries(dataToStore).forEach(([key, value]) => {
        this.store.set(key, value);
      });
    } else {
      this.store.store = { ...this.store.store, ...dataToStore };
    }
    return this.getSettings(); // Return settings including API key
  }

  setCoaches(coaches: CoachConfig[]): CoachConfig[] {
    const sanitized = this.ensureCoachesSchema(coaches);
    if (this.store.set) {
      this.store.set('coaches', sanitized);
    } else {
      this.store.store = { ...this.store.store, coaches: sanitized };
    }
    return sanitized;
  }

  getCoaches(): CoachConfig[] {
    return this.ensureCoachesSchema(this.store.get ? this.store.get('coaches') : this.store.store?.coaches);
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

  getFirefliesApiKey(): string | undefined {
    const envApiKey = process.env.FIREFLIES_API_KEY;
    if (envApiKey) {
      return envApiKey;
    }
    return this.store.get ? this.store.get('firefliesApiKey') : this.store.store?.firefliesApiKey;
  }

  setFirefliesApiKey(apiKey: string): void {
    if (this.store.set) {
      this.store.set('firefliesApiKey', apiKey);
    } else {
      this.store.store = { ...this.store.store, firefliesApiKey: apiKey };
    }
  }

  clearFirefliesApiKey(): void {
    if (this.store.delete) {
      this.store.delete('firefliesApiKey');
    } else if (this.store.store) {
      delete this.store.store.firefliesApiKey;
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