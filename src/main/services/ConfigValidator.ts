import { AppSettings, DEFAULT_COACH_CONFIGS } from '../../shared/types';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Configuration validator for AppSettings
 * Ensures all settings are valid before use
 */
export class ConfigValidator {
  /**
   * Validate entire settings object
   */
  static validateSettings(settings: AppSettings): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate API URL
    if (settings.recallApiUrl) {
      if (!this.isValidUrl(settings.recallApiUrl)) {
        errors.push(`Invalid Recall API URL: ${settings.recallApiUrl}`);
      }
      if (!settings.recallApiUrl.includes('recall.ai')) {
        errors.push(`Recall API URL should be a recall.ai domain: ${settings.recallApiUrl}`);
      }
    }

    // Validate API keys format (if provided)
    if (settings.recallApiKey) {
      if (!this.isValidApiKey(settings.recallApiKey)) {
        errors.push('Invalid Recall API key format');
      }
    }

    if (settings.anthropicApiKey) {
      if (!this.isValidAnthropicKey(settings.anthropicApiKey)) {
        errors.push('Invalid Anthropic API key format');
      }
    }

    if (settings.firefliesApiKey) {
      if (!this.isValidGenericKey(settings.firefliesApiKey)) {
        errors.push('Invalid Fireflies API key format');
      }
    }

    if (settings.notionIntegrationToken) {
      if (typeof settings.notionIntegrationToken !== 'string' || !settings.notionIntegrationToken.trim()) {
        errors.push('Notion integration token must be a non-empty string');
      }
    }

    if (settings.notionTodoIntegrationToken) {
      if (typeof settings.notionTodoIntegrationToken !== 'string' || !settings.notionTodoIntegrationToken.trim()) {
        errors.push('Notion to-do integration token must be a non-empty string');
      }
    }

    if (settings.notionDatabaseId) {
      if (typeof settings.notionDatabaseId !== 'string' || !settings.notionDatabaseId.trim()) {
        errors.push('Notion database ID must be a non-empty string');
      }
    }

    if (settings.notionTodoDatabaseId) {
      if (typeof settings.notionTodoDatabaseId !== 'string' || !settings.notionTodoDatabaseId.trim()) {
        errors.push('Notion to-do database ID must be a non-empty string');
      }
    }

    // Validate storage path
    if (settings.storagePath) {
      const pathErrors = this.validateStoragePath(settings.storagePath);
      errors.push(...pathErrors);
    }

    // Validate calendars array
    if (!Array.isArray(settings.selectedCalendars)) {
      errors.push('selectedCalendars must be an array');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate URL format
   */
  static isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate Recall API key format
   */
  static isValidApiKey(key: string): boolean {
    // Recall API keys are typically 40 character hex strings
    return /^[a-f0-9]{40,}$/i.test(key) || key.length > 20;
  }

  /**
   * Validate Anthropic API key format
   */
  static isValidAnthropicKey(key: string): boolean {
    // Anthropic keys typically start with 'sk-ant-'
    return key.startsWith('sk-ant-') || key.length > 20;
  }

  static isValidGenericKey(key: string): boolean {
    return typeof key === 'string' && key.trim().length >= 20;
  }

  /**
   * Validate storage path
   */
  static validateStoragePath(storagePath: string): string[] {
    const errors: string[] = [];

    if (!path.isAbsolute(storagePath)) {
      errors.push('Storage path must be an absolute path');
    }

    // Check if parent directory exists
    const parentDir = path.dirname(storagePath);
    if (!fs.existsSync(parentDir)) {
      errors.push(`Parent directory does not exist: ${parentDir}`);
    }

    // Check for potentially dangerous paths
    const dangerousPaths = ['/System', '/Library', '/usr', '/bin', '/sbin', '/etc'];
    if (dangerousPaths.some(dangerous => storagePath.startsWith(dangerous))) {
      errors.push(`Storage path should not be in system directory: ${storagePath}`);
    }

    return errors;
  }

  /**
   * Migrate settings from old format to new format
   */
  static migrateSettings(oldSettings: any): AppSettings {
    const migrated: AppSettings = {
      recallApiUrl: oldSettings.recallApiUrl || oldSettings.apiUrl || 'https://us-west-2.recall.ai',
      storagePath: oldSettings.storagePath || path.join(process.env.HOME || '', 'Documents', 'MeetingRecordings'),
      googleCalendarConnected: oldSettings.googleCalendarConnected || false,
      autoStartOnBoot: oldSettings.autoStartOnBoot || false,
      selectedCalendars: oldSettings.selectedCalendars || [],
      coaches: DEFAULT_COACH_CONFIGS.map(coach => ({ ...coach })),
    };

    // Migrate API keys if present
    if (oldSettings.recallApiKey) {
      migrated.recallApiKey = oldSettings.recallApiKey;
    }
    if (oldSettings.anthropicApiKey) {
      migrated.anthropicApiKey = oldSettings.anthropicApiKey;
    }

    migrated.permissionOnboarding = {
      completedAt: null,
      dismissedAt: null,
      lastPromptAt: null,
    };
    migrated.savedSearches = [];

    return migrated;
  }

  /**
   * Get safe default settings
   */
  static getDefaults(): AppSettings {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return {
      recallApiUrl: 'https://us-west-2.recall.ai',
      storagePath: path.join(home, 'Documents', 'MeetingRecordings'),
      googleCalendarConnected: false,
      autoStartOnBoot: false,
      selectedCalendars: [],
      notionIntegrationToken: '',
      notionDatabaseId: '',
      notionTodoIntegrationToken: '',
      notionTodoDatabaseId: '',
      coaches: DEFAULT_COACH_CONFIGS.map(coach => ({ ...coach })),
      permissionOnboarding: {
        completedAt: null,
        dismissedAt: null,
        lastPromptAt: null,
      },
      savedSearches: [],
    };
  }

  /**
   * Sanitize settings before saving
   */
  static sanitizeSettings(settings: AppSettings): AppSettings {
    const sanitized: AppSettings = { ...settings };

    // Remove trailing slashes from URLs
    if (sanitized.recallApiUrl) {
      sanitized.recallApiUrl = sanitized.recallApiUrl.replace(/\/+$/, '');
    }

    // Normalize path separators
    if (sanitized.storagePath) {
      sanitized.storagePath = path.normalize(sanitized.storagePath);
    }

    // Ensure arrays are arrays
    if (!Array.isArray(sanitized.selectedCalendars)) {
      sanitized.selectedCalendars = [];
    }

    if (sanitized.notionIntegrationToken) {
      sanitized.notionIntegrationToken = sanitized.notionIntegrationToken.trim();
    }

    if (sanitized.firefliesApiKey) {
      sanitized.firefliesApiKey = sanitized.firefliesApiKey.trim();
    }

    if (sanitized.notionTodoIntegrationToken) {
      sanitized.notionTodoIntegrationToken = sanitized.notionTodoIntegrationToken.trim();
    }

    if (sanitized.notionDatabaseId) {
      sanitized.notionDatabaseId = sanitized.notionDatabaseId.trim();
    }

    if (sanitized.notionTodoDatabaseId) {
      sanitized.notionTodoDatabaseId = sanitized.notionTodoDatabaseId.trim();
    }

    if (!Array.isArray(sanitized.coaches)) {
      sanitized.coaches = DEFAULT_COACH_CONFIGS.map(coach => ({ ...coach }));
    } else {
      const defaultsById = new Map(DEFAULT_COACH_CONFIGS.map(coach => [coach.id, coach]));
      sanitized.coaches = sanitized.coaches.map(coach => ({ ...coach }));

      for (const def of DEFAULT_COACH_CONFIGS) {
        if (!sanitized.coaches.some(coach => coach.id === def.id)) {
          sanitized.coaches.push({ ...def });
        }
      }

      sanitized.coaches = sanitized.coaches.map(coach => ({
        id: coach.id,
        name: coach.name || defaultsById.get(coach.id)?.name || coach.id,
        description: coach.description || defaultsById.get(coach.id)?.description || '',
        enabled: typeof coach.enabled === 'boolean' ? coach.enabled : defaultsById.get(coach.id)?.enabled ?? true,
        isCustom: coach.isCustom ?? !defaultsById.has(coach.id),
      }));
    }

    const onboarding = sanitized.permissionOnboarding && typeof sanitized.permissionOnboarding === 'object'
      ? sanitized.permissionOnboarding as any
      : {};
    sanitized.permissionOnboarding = {
      completedAt: typeof onboarding.completedAt === 'string' ? onboarding.completedAt : null,
      dismissedAt: typeof onboarding.dismissedAt === 'string' ? onboarding.dismissedAt : null,
      lastPromptAt: typeof onboarding.lastPromptAt === 'string' ? onboarding.lastPromptAt : null,
    };

    if (!Array.isArray(sanitized.savedSearches)) {
      sanitized.savedSearches = [];
    }

    return sanitized;
  }
}