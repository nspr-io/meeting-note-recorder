const BASE_COACH_VARIABLES = ['previousFeedback', 'recentTranscript'];
import fs from 'fs/promises';
import path from 'path';
import { app } from 'electron';
import { getLogger } from './LoggingService';
import { interpolatePrompt, PromptVariables } from '../../shared/utils/promptUtils';
import { CoachConfig } from '../../shared/types';

const logger = getLogger();

interface PromptConfig {
  name: string;
  description: string;
  variables: string[];
}

export class PromptService {
  private promptsDir: string;
  private userPromptsDir: string;
  private promptsConfig: Record<string, PromptConfig> = {};

  constructor() {
    // Default prompts in the app bundle - in development, go up from dist/main to find prompts
    // In production, prompts should be bundled or accessible relative to the app
    logger.info('[PROMPT-SERVICE-CONSTRUCTOR] Starting PromptService construction', {
      nodeEnv: process.env.NODE_ENV,
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      userDataPath: app.getPath('userData')
    });

    if (process.env.NODE_ENV === 'development') {
      // In development, webpack bundles to dist/main, so we need to go up two levels to project root
      // __dirname in bundled code points to dist/main, so ../../prompts gets us to project root/prompts
      this.promptsDir = path.join(__dirname, '..', '..', 'prompts');
      logger.info('[PROMPT-SERVICE-CONSTRUCTOR] Using development mode path', {
        dirname: __dirname,
        calculatedPromptsDir: this.promptsDir
      });
    } else {
      this.promptsDir = path.join(process.resourcesPath, 'prompts');
      logger.info('[PROMPT-SERVICE-CONSTRUCTOR] Using production mode path', {
        resourcesPath: process.resourcesPath,
        calculatedPromptsDir: this.promptsDir
      });
    }
    // User-customized prompts in app data
    this.userPromptsDir = path.join(app.getPath('userData'), 'prompts');

    logger.info('[PROMPT-SERVICE-CONSTRUCTOR] PromptService constructed', {
      promptsDir: this.promptsDir,
      userPromptsDir: this.userPromptsDir
    });
  }

  async initialize(): Promise<void> {
    try {
      logger.info('PromptService initializing...', {
        promptsDir: this.promptsDir,
        userPromptsDir: this.userPromptsDir,
        nodeEnv: process.env.NODE_ENV
      });

      // Ensure user prompts directory exists
      await fs.mkdir(this.userPromptsDir, { recursive: true });
      logger.info('User prompts directory created/verified:', this.userPromptsDir);

      // Load prompts configuration
      const configPath = path.join(this.promptsDir, 'prompts-config.json');
      logger.info('Loading prompts config from:', configPath);

      const configContent = await fs.readFile(configPath, 'utf-8');
      this.promptsConfig = JSON.parse(configContent);
      logger.info('Loaded prompts config:', Object.keys(this.promptsConfig));

      // Copy default prompts to user directory if they don't exist
      await this.copyDefaultPrompts();

      logger.info('PromptService initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize PromptService:', error);
      logger.error('Error details:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        promptsDir: this.promptsDir,
        userPromptsDir: this.userPromptsDir
      });
      throw error; // Re-throw to prevent undefined service
    }
  }

  private async copyDefaultPrompts(): Promise<void> {
    for (const promptId of Object.keys(this.promptsConfig)) {
      const userPromptPath = path.join(this.userPromptsDir, `${promptId}.txt`);

      try {
        // Check if user prompt already exists
        await fs.access(userPromptPath);
      } catch {
        // User prompt doesn't exist, copy default
        try {
          const defaultPromptPath = path.join(this.promptsDir, `${promptId}.txt`);
          const defaultContent = await fs.readFile(defaultPromptPath, 'utf-8');
          await fs.writeFile(userPromptPath, defaultContent, 'utf-8');
          logger.info(`Copied default prompt: ${promptId}`);
        } catch (error) {
          logger.error(`Failed to copy default prompt ${promptId}:`, error);
        }
      }
    }
  }

  async getPrompt(promptId: string): Promise<string> {
    try {
      const userPromptPath = path.join(this.userPromptsDir, `${promptId}.txt`);
      return await fs.readFile(userPromptPath, 'utf-8');
    } catch (error) {
      logger.error(`Failed to read prompt ${promptId}:`, error);
      // Fallback to default prompt
      try {
        const defaultPromptPath = path.join(this.promptsDir, `${promptId}.txt`);
        return await fs.readFile(defaultPromptPath, 'utf-8');
      } catch (fallbackError) {
        logger.error(`Failed to read default prompt ${promptId}:`, fallbackError);
        throw new Error(`Prompt ${promptId} not found`);
      }
    }
  }

  async updatePrompt(promptId: string, content: string): Promise<void> {
    try {
      const userPromptPath = path.join(this.userPromptsDir, `${promptId}.txt`);
      await fs.writeFile(userPromptPath, content, 'utf-8');
      logger.info(`Updated prompt: ${promptId}`);
    } catch (error) {
      logger.error(`Failed to update prompt ${promptId}:`, error);
      throw error;
    }
  }

  async resetPrompt(promptId: string): Promise<void> {
    try {
      const defaultPromptPath = path.join(this.promptsDir, `${promptId}.txt`);
      const userPromptPath = path.join(this.userPromptsDir, `${promptId}.txt`);

      const defaultContent = await fs.readFile(defaultPromptPath, 'utf-8');
      await fs.writeFile(userPromptPath, defaultContent, 'utf-8');

      logger.info(`Reset prompt to default: ${promptId}`);
    } catch (error) {
      logger.error(`Failed to reset prompt ${promptId}:`, error);
      throw error;
    }
  }

  async getAllPrompts(additionalCoaches: CoachConfig[] = []): Promise<Record<string, { config: PromptConfig; content: string }>> {
    const prompts: Record<string, { config: PromptConfig; content: string }> = {};

    const allConfigs: Record<string, PromptConfig> = {
      ...this.promptsConfig,
    };

    additionalCoaches.forEach(coach => {
      const extraVariables = Array.isArray(coach.variables)
        ? coach.variables.map(variable => variable.key).filter(key => !!key)
        : [];

      if (!allConfigs[coach.id]) {
        allConfigs[coach.id] = {
          name: coach.name,
          description: coach.description,
          variables: [...BASE_COACH_VARIABLES, ...extraVariables],
        };
      } else if (allConfigs[coach.id].variables) {
        const merged = new Set([...allConfigs[coach.id].variables!, ...extraVariables]);
        allConfigs[coach.id].variables = Array.from(merged);
      }
    });

    for (const [promptId, config] of Object.entries(allConfigs)) {
      try {
        const content = await this.getPrompt(promptId);
        prompts[promptId] = { config, content };
      } catch (error) {
        logger.error(`Failed to load prompt ${promptId}:`, error);
      }
    }

    return prompts;
  }

  async deletePrompt(promptId: string): Promise<void> {
    try {
      const userPromptPath = path.join(this.userPromptsDir, `${promptId}.txt`);
      await fs.unlink(userPromptPath);
      logger.info(`Deleted prompt: ${promptId}`);
    } catch (error) {
      logger.error(`Failed to delete prompt ${promptId}:`, error);
      throw error;
    }
  }

  async getInterpolatedPrompt(promptId: string, variables: PromptVariables): Promise<string> {
    const template = await this.getPrompt(promptId);
    return interpolatePrompt(template, variables);
  }

  getPromptConfig(promptId: string): PromptConfig | undefined {
    return this.promptsConfig[promptId];
  }

  getAvailablePrompts(): Record<string, PromptConfig> {
    return { ...this.promptsConfig };
  }
}