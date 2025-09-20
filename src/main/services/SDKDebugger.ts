import { getLogger } from './LoggingService';

const logger = getLogger();

export class SDKDebugger {
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private sdkProcessCheck: NodeJS.Timeout | null = null;
  
  startDebugging(): void {
    logger.info('🔍 SDK Debugger started');
    
    // Log SDK heartbeat every 10 seconds
    this.heartbeatInterval = setInterval(() => {
      try {
        const RecallAiSdk = require('@recallai/desktop-sdk').default;
        logger.debug('💓 SDK heartbeat - SDK module loaded successfully');
        
        // Check if we can access SDK methods
        if (typeof RecallAiSdk.addEventListener === 'function') {
          logger.debug('✅ SDK methods accessible');
        } else {
          logger.error('❌ SDK methods not accessible');
        }
      } catch (error) {
        logger.error('❌ SDK heartbeat failed', { error });
      }
    }, 10000);
    
    // Check SDK process every 5 seconds
    this.sdkProcessCheck = setInterval(async () => {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      
      try {
        const { stdout } = await execAsync('ps aux | grep desktop_sdk_macos_exe | grep -v grep');
        const processes = stdout.trim().split('\n').filter(Boolean);
        if (processes.length > 0) {
          logger.debug(`🎯 SDK process running (${processes.length} instance(s))`);
        } else {
          logger.error('❌ SDK process not found!');
        }
      } catch (error) {
        logger.error('❌ SDK process not running');
      }
    }, 5000);
  }
  
  stopDebugging(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.sdkProcessCheck) {
      clearInterval(this.sdkProcessCheck);
      this.sdkProcessCheck = null;
    }
    logger.info('🔍 SDK Debugger stopped');
  }
  
  // Log all SDK events with full details
  static logSDKEvent(eventName: string, data: any): void {
    logger.info(`📡 SDK Event: ${eventName}`, {
      eventName,
      timestamp: new Date().toISOString(),
      data: JSON.stringify(data, null, 2)
    });
  }
  
  // Check SDK permissions
  static async checkSDKPermissions(): Promise<void> {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      
      // Check accessibility
      try {
        await execAsync('osascript -e \'tell application "System Events" to return name of first process\'');
        logger.info('✅ Accessibility permission granted');
      } catch (e) {
        logger.error('❌ Accessibility permission denied');
      }
      
      // Log all environment variables that might affect SDK
      logger.debug('SDK Environment', {
        NODE_ENV: process.env.NODE_ENV,
        RECALL_API_KEY: process.env.RECALL_API_KEY ? 'SET' : 'NOT SET',
        PATH: process.env.PATH
      });
      
    } catch (error) {
      logger.error('Failed to check SDK permissions', { error });
    }
  }
}