import { createServiceLogger } from './ServiceLogger';

const logger = createServiceLogger('ServiceError');

/**
 * Base error class for service-level errors
 * Provides consistent error handling and cleanup
 */
export class ServiceError extends Error {
  public readonly code: string;
  public readonly statusCode?: number;
  public readonly context?: any;
  public readonly isRetryable: boolean;
  private cleanupCallback?: () => Promise<void> | void;

  constructor(
    message: string,
    code: string,
    options?: {
      statusCode?: number;
      context?: any;
      isRetryable?: boolean;
      cause?: Error;
    }
  ) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.statusCode = options?.statusCode;
    this.context = options?.context;
    this.isRetryable = options?.isRetryable ?? false;

    // Preserve stack trace
    if (options?.cause && options.cause.stack) {
      this.stack = options.cause.stack;
    }
  }

  /**
   * Set cleanup callback to be executed on error
   */
  setCleanup(callback: () => Promise<void> | void): void {
    this.cleanupCallback = callback;
  }

  /**
   * Execute cleanup if defined
   */
  async cleanup(): Promise<void> {
    if (this.cleanupCallback) {
      try {
        await this.cleanupCallback();
      } catch (cleanupError) {
        logger.error('Cleanup failed during error handling', {
          originalError: this.message,
          cleanupError
        });
      }
    }
  }

  /**
   * Convert to plain object for logging/serialization
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      context: this.context,
      isRetryable: this.isRetryable,
      stack: this.stack
    };
  }
}

/**
 * Specific error types
 */
export class ApiError extends ServiceError {
  constructor(
    message: string,
    statusCode: number,
    options?: {
      context?: any;
      cause?: Error;
    }
  ) {
    const isRetryable = statusCode >= 500 || statusCode === 429;
    super(
      message,
      `API_ERROR_${statusCode}`,
      {
        statusCode,
        isRetryable,
        ...options
      }
    );
    this.name = 'ApiError';
  }
}

export class AuthenticationError extends ServiceError {
  constructor(message: string = 'Authentication failed') {
    super(message, 'AUTH_ERROR', { statusCode: 401, isRetryable: false });
    this.name = 'AuthenticationError';
  }
}

export class ValidationError extends ServiceError {
  constructor(message: string, errors: string[]) {
    super(message, 'VALIDATION_ERROR', {
      statusCode: 400,
      context: { errors },
      isRetryable: false
    });
    this.name = 'ValidationError';
  }
}

export class NetworkError extends ServiceError {
  constructor(message: string = 'Network request failed', cause?: Error) {
    super(message, 'NETWORK_ERROR', {
      isRetryable: true,
      cause
    });
    this.name = 'NetworkError';
  }
}

export class InitializationError extends ServiceError {
  constructor(service: string, message: string, cause?: Error) {
    super(
      `Failed to initialize ${service}: ${message}`,
      'INIT_ERROR',
      {
        context: { service },
        isRetryable: false,
        cause
      }
    );
    this.name = 'InitializationError';
  }
}

/**
 * Error handler utility
 */
export class ErrorHandler {
  /**
   * Wrap an async function with error handling
   */
  static async handleAsync<T>(
    operation: string,
    fn: () => Promise<T>,
    options?: {
      cleanup?: () => Promise<void> | void;
      retries?: number;
      retryDelay?: number;
    }
  ): Promise<T> {
    const maxRetries = options?.retries ?? 0;
    const retryDelay = options?.retryDelay ?? 1000;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;
        logger.error(`${operation} failed (attempt ${attempt + 1}/${maxRetries + 1})`, {
          error: error.message,
          code: error.code,
          statusCode: error.statusCode
        });

        // Check if error is retryable
        const isRetryable = error instanceof ServiceError ? error.isRetryable :
                           error.code === 'ECONNREFUSED' ||
                           error.code === 'ETIMEDOUT';

        if (attempt < maxRetries && isRetryable) {
          logger.info(`Retrying ${operation} in ${retryDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay * Math.pow(2, attempt)));
          continue;
        }

        // Execute cleanup if provided
        if (options?.cleanup) {
          await options.cleanup();
        }

        // Execute error's own cleanup
        if (error instanceof ServiceError) {
          await error.cleanup();
        }

        throw error;
      }
    }

    throw lastError || new Error(`${operation} failed after ${maxRetries + 1} attempts`);
  }

  /**
   * Convert any error to ServiceError
   */
  static toServiceError(error: any, defaultCode: string = 'UNKNOWN_ERROR'): ServiceError {
    if (error instanceof ServiceError) {
      return error;
    }

    if (error?.response) {
      // Axios-like error
      return new ApiError(
        error.response.data?.message || error.message,
        error.response.status,
        { context: error.response.data }
      );
    }

    if (error?.code === 'ECONNREFUSED') {
      return new NetworkError('Connection refused', error);
    }

    if (error?.code === 'ETIMEDOUT') {
      return new NetworkError('Request timeout', error);
    }

    return new ServiceError(
      error?.message || 'Unknown error occurred',
      error?.code || defaultCode,
      { cause: error }
    );
  }
}