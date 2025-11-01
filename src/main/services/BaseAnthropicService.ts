import Anthropic from '@anthropic-ai/sdk';
import { EventEmitter } from 'events';
import { createServiceLogger } from './ServiceLogger';

/**
 * Base class for services that use Anthropic AI
 * Provides common initialization and availability checking
 */
export abstract class BaseAnthropicService extends EventEmitter {
  protected anthropic: Anthropic | null = null;
  protected logger: ReturnType<typeof createServiceLogger>;

  constructor(serviceName: string) {
    super();
    this.logger = createServiceLogger(serviceName);
  }

  /**
   * Initialize the Anthropic client with an API key
   */
  initialize(apiKey: string | undefined): void {
    if (!apiKey) {
      this.anthropic = null;
      this.logger.warn(`No Anthropic API key provided - ${this.constructor.name} disabled`);
      return;
    }

    try {
      this.anthropic = new Anthropic({
        apiKey: apiKey
      });
      this.logger.info(`${this.constructor.name} initialized successfully`);
    } catch (error) {
      this.logger.error(`Failed to initialize Anthropic client:`, error);
      this.anthropic = null;
    }
  }

  /**
   * Check if the Anthropic service is available
   */
  isAvailable(): boolean {
    return this.anthropic !== null;
  }
}
