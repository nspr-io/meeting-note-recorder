import { LoggingService, getLogger } from './LoggingService';

/**
 * ServiceLogger - A wrapper around LoggingService that automatically adds service context
 *
 * This reduces boilerplate and ensures consistent logging format across all services.
 * Each log entry will be prefixed with the service name for easier debugging.
 */
export class ServiceLogger {
  private logger: LoggingService;
  private serviceName: string;

  constructor(serviceName: string) {
    this.serviceName = serviceName;
    this.logger = getLogger();
  }

  /**
   * Format message with service context
   */
  private formatMessage(message: string): string {
    return `[${this.serviceName}] ${message}`;
  }

  /**
   * Log info level message
   */
  info(message: string, data?: any): void {
    this.logger.info(this.formatMessage(message), data);
  }

  /**
   * Log warning level message
   */
  warn(message: string, data?: any): void {
    this.logger.warn(this.formatMessage(message), data);
  }

  /**
   * Log error level message
   */
  error(message: string, data?: any): void {
    this.logger.error(this.formatMessage(message), data);
  }

  /**
   * Log debug level message
   */
  debug(message: string, data?: any): void {
    this.logger.debug(this.formatMessage(message), data);
  }

  /**
   * Log with explicit level
   */
  log(level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: any): void {
    this.logger.log(level, this.formatMessage(message), data);
  }

  /**
   * Log method entry with parameters (useful for debugging)
   */
  methodEntry(methodName: string, params?: any): void {
    this.debug(`-> ${methodName}()`, params);
  }

  /**
   * Log method exit with return value (useful for debugging)
   */
  methodExit(methodName: string, result?: any): void {
    this.debug(`<- ${methodName}()`, result);
  }

  /**
   * Log performance timing
   */
  timing(operation: string, startTime: number): void {
    const duration = Date.now() - startTime;
    this.info(`${operation} completed`, { durationMs: duration });
  }

  /**
   * Create a child logger with additional context
   */
  child(context: string): ServiceLogger {
    const childLogger = new ServiceLogger(`${this.serviceName}:${context}`);
    return childLogger;
  }
}

/**
 * Factory function to create a ServiceLogger
 */
export function createServiceLogger(serviceName: string): ServiceLogger {
  return new ServiceLogger(serviceName);
}