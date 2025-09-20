import { systemPreferences, dialog, shell } from 'electron';
import RecallAiSdk from '@recallai/desktop-sdk';
import { getLogger } from './LoggingService';

const logger = getLogger();

export type PermissionType = 'screen-capture' | 'microphone' | 'accessibility';

export interface PermissionStatus {
  'screen-capture': boolean;
  microphone: boolean;
  accessibility: boolean;
}

export class PermissionService {
  private permissionStatus: PermissionStatus = {
    'screen-capture': false,
    microphone: false,
    accessibility: false,
  };

  constructor() {
    // Don't check permissions in constructor - do it explicitly
  }

  /**
   * Check all permissions and update status
   */
  async checkAllPermissions(): Promise<PermissionStatus> {
    logger.info('Checking all permissions');
    
    // Check screen recording permission
    this.permissionStatus['screen-capture'] = await this.checkScreenRecordingPermission();
    
    // Check microphone permission
    this.permissionStatus.microphone = await this.checkMicrophonePermission();
    
    // Check accessibility permission (for window detection)
    this.permissionStatus.accessibility = this.checkAccessibilityPermission();
    
    logger.info('Permission status', this.permissionStatus);
    return this.permissionStatus;
  }

  /**
   * Request all required permissions
   */
  async requestAllPermissions(): Promise<void> {
    logger.info('Requesting all required permissions');
    
    // Request each permission that's not granted
    if (!this.permissionStatus['screen-capture']) {
      await this.requestScreenRecordingPermission();
    }
    
    if (!this.permissionStatus.microphone) {
      await this.requestMicrophonePermission();
    }
    
    if (!this.permissionStatus.accessibility) {
      await this.requestAccessibilityPermission();
    }
    
    // Don't use SDK to request permissions here - it might be triggering unwanted prompts
    // The SDK will request them when actually needed for recording
    
    // Re-check all permissions
    await this.checkAllPermissions();
  }

  /**
   * Check screen recording permission
   */
  private async checkScreenRecordingPermission(): Promise<boolean> {
    if (process.platform === 'darwin') {
      // Screen recording permission check is tricky on macOS
      // The getMediaAccessStatus('screen') may not always work correctly
      // Using a combination approach
      try {
        const status = systemPreferences.getMediaAccessStatus('screen');
        logger.info('Screen recording status:', status);
        // On macOS, 'not-determined' often means it hasn't been requested yet
        // 'granted' means explicitly allowed
        // Note: This API can be unreliable for screen recording
        return status === 'granted';
      } catch (error) {
        logger.warn('Could not check screen recording permission:', error);
        // If we can't check, assume it needs to be requested
        return false;
      }
    }
    return true; // Assume granted on other platforms
  }

  /**
   * Check microphone permission
   */
  private async checkMicrophonePermission(): Promise<boolean> {
    if (process.platform === 'darwin') {
      const status = systemPreferences.getMediaAccessStatus('microphone');
      return status === 'granted';
    }
    return true; // Assume granted on other platforms
  }


  /**
   * Check accessibility permission
   */
  private checkAccessibilityPermission(): boolean {
    if (process.platform === 'darwin') {
      return systemPreferences.isTrustedAccessibilityClient(false);
    }
    return true; // Assume granted on other platforms
  }

  /**
   * Request screen recording permission
   */
  private async requestScreenRecordingPermission(): Promise<void> {
    if (process.platform === 'darwin') {
      const status = systemPreferences.getMediaAccessStatus('screen');
      
      if (status === 'denied' || status === 'restricted') {
        const result = await dialog.showMessageBox({
          type: 'warning',
          title: 'Screen Recording Permission Required',
          message: 'Meeting Note Recorder needs screen recording permission to detect and record meetings.',
          detail: 'Please grant screen recording permission in System Settings > Privacy & Security > Screen Recording.',
          buttons: ['Open System Settings', 'Later'],
          defaultId: 0,
        });
        
        if (result.response === 0) {
          // Open System Preferences to Screen Recording
          shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
        }
      } else if (status === 'not-determined') {
        // Screen recording doesn't have askForMediaAccess - handled by SDK
      }
    }
  }

  /**
   * Request microphone permission
   */
  private async requestMicrophonePermission(): Promise<void> {
    if (process.platform === 'darwin') {
      const status = systemPreferences.getMediaAccessStatus('microphone');
      
      if (status === 'denied' || status === 'restricted') {
        const result = await dialog.showMessageBox({
          type: 'warning',
          title: 'Microphone Permission Required',
          message: 'Meeting Note Recorder needs microphone permission to record meeting audio.',
          detail: 'Please grant microphone permission in System Settings > Privacy & Security > Microphone.',
          buttons: ['Open System Settings', 'Later'],
          defaultId: 0,
        });
        
        if (result.response === 0) {
          // Open System Preferences to Microphone
          shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
        }
      } else if (status === 'not-determined') {
        // Will trigger permission prompt
        await systemPreferences.askForMediaAccess('microphone');
      }
    }
  }

  /**
   * Request accessibility permission
   */
  private async requestAccessibilityPermission(): Promise<void> {
    if (process.platform === 'darwin') {
      const isTrusted = systemPreferences.isTrustedAccessibilityClient(true); // true will prompt
      
      if (!isTrusted) {
        const result = await dialog.showMessageBox({
          type: 'warning',
          title: 'Accessibility Permission Required',
          message: 'Meeting Note Recorder needs accessibility permission to detect meeting windows.',
          detail: 'Please grant accessibility permission in System Settings > Privacy & Security > Accessibility.',
          buttons: ['Open System Settings', 'Later'],
          defaultId: 0,
        });
        
        if (result.response === 0) {
          // Open System Preferences to Accessibility
          shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
        }
      }
    }
  }

  /**
   * Show permission dialog with current status
   */
  async showPermissionDialog(): Promise<void> {
    const status = await this.checkAllPermissions();
    
    const permissionLines = [
      `✅ Screen Recording: ${status['screen-capture'] ? 'Granted' : '❌ Not Granted'}`,
      `✅ Microphone: ${status.microphone ? 'Granted' : '❌ Not Granted'}`,
      `✅ Accessibility: ${status.accessibility ? 'Granted' : '❌ Not Granted'}`,
    ];
    
    const allGranted = status['screen-capture'] && status.microphone && status.accessibility;
    
    const result = await dialog.showMessageBox({
      type: allGranted ? 'info' : 'warning',
      title: 'Permission Status',
      message: allGranted ? 'All required permissions granted!' : 'Some permissions need to be granted',
      detail: permissionLines.join('\n'),
      buttons: allGranted ? ['OK'] : ['Request Permissions', 'Later'],
      defaultId: 0,
    });
    
    if (!allGranted && result.response === 0) {
      await this.requestAllPermissions();
    }
  }

  /**
   * Check if all required permissions are granted
   */
  async hasRequiredPermissions(): Promise<boolean> {
    const status = await this.checkAllPermissions();
    return status['screen-capture'] && status.microphone && status.accessibility;
  }

  /**
   * Get current permission status
   */
  getPermissionStatus(): PermissionStatus {
    return { ...this.permissionStatus };
  }
}