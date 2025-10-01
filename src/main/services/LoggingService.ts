import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export class LoggingService {
  private logPath: string;
  private logStream: fs.WriteStream | null = null;
  private consoleLogLevel: 'error' | 'warn' | 'info' | 'debug';
  private logLevels = { error: 0, warn: 1, info: 2, debug: 3 };

  constructor() {
    // Get log level from environment, default to 'warn' for dev
    const envLogLevel = process.env.LOG_LEVEL?.toLowerCase();
    this.consoleLogLevel = (['error', 'warn', 'info', 'debug'].includes(envLogLevel || '')
      ? envLogLevel as 'error' | 'warn' | 'info' | 'debug'
      : 'warn');
    // Store logs in user data directory
    const logsDir = path.join(app.getPath('userData'), 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    
    // Create log file with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.logPath = path.join(logsDir, `app-${timestamp}.log`);
    
    // Also create a symlink to latest log for easy access
    const latestLogPath = path.join(logsDir, 'latest.log');
    try {
      // Try to remove existing symlink/file first
      if (fs.existsSync(latestLogPath)) {
        fs.unlinkSync(latestLogPath);
      }
      // Create new symlink
      fs.symlinkSync(this.logPath, latestLogPath);
    } catch (error) {
      // If symlink creation fails, just log it and continue
      // The app should still work without the latest.log symlink
      console.warn('Failed to create latest.log symlink:', error);
    }
    
    this.logStream = fs.createWriteStream(this.logPath, { flags: 'a' });
    
    this.log('info', 'LoggingService initialized', { logPath: this.logPath });
  }

  private formatMessage(level: string, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${dataStr}\n`;
  }

  log(level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: any) {
    const formattedMessage = this.formatMessage(level, message, data);

    // Always write to file
    if (this.logStream) {
      this.logStream.write(formattedMessage);
    }

    // Only log to console if level is at or below configured level
    const shouldLogToConsole = this.logLevels[level] <= this.logLevels[this.consoleLogLevel];

    if (shouldLogToConsole) {
      switch (level) {
        case 'error':
          console.error(message, data || '');
          break;
        case 'warn':
          console.warn(message, data || '');
          break;
        case 'debug':
          console.debug(message, data || '');
          break;
        default:
          console.log(message, data || '');
      }
    }
  }

  info(message: string, data?: any) {
    this.log('info', message, data);
  }

  warn(message: string, data?: any) {
    this.log('warn', message, data);
  }

  error(message: string, data?: any) {
    this.log('error', message, data);
  }

  debug(message: string, data?: any) {
    this.log('debug', message, data);
  }

  getLogPath(): string {
    return this.logPath;
  }

  getLatestLogPath(): string {
    return path.join(path.dirname(this.logPath), 'latest.log');
  }

  close() {
    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }
  }
}

// Singleton instance
let loggingService: LoggingService | null = null;

export function getLogger(): LoggingService {
  if (!loggingService) {
    loggingService = new LoggingService();
  }
  return loggingService;
}