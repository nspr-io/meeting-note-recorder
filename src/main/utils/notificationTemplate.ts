/**
 * Notification Template Generator
 * Generates HTML for enhanced notification windows
 */

import * as fs from 'fs';
import * as path from 'path';

export type NotificationType =
  | 'meeting'
  | 'recording-started'
  | 'recording-stopped'
  | 'reminder'
  | 'error'
  | 'success'
  | 'info';

export interface NotificationConfig {
  title: string;
  body: string;
  subtitle?: string;
  type?: NotificationType;
  icon?: string;
  autoCloseMs?: number;
}

/**
 * Get icon for notification type
 */
function getIconForType(type: NotificationType, customIcon?: string): string {
  if (customIcon) return customIcon;

  const iconMap: Record<NotificationType, string> = {
    'meeting': '📅',
    'recording-started': '🔴',
    'recording-stopped': '⏹️',
    'reminder': '⏰',
    'error': '⚠️',
    'success': '✓',
    'info': 'ℹ️'
  };

  return iconMap[type] || 'ℹ️';
}

/**
 * Load CSS from file
 */
function loadCSS(): string {
  try {
    const cssPath = path.join(__dirname, '../styles/notifications.css');
    return fs.readFileSync(cssPath, 'utf-8');
  } catch (error) {
    console.error('Failed to load notification CSS:', error);
    return ''; // Fallback to inline styles if file not found
  }
}

/**
 * Generate notification HTML
 */
export function generateNotificationHTML(config: NotificationConfig): string {
  const {
    title,
    body,
    subtitle,
    type = 'info',
    icon,
    autoCloseMs = 5000
  } = config;

  const notificationIcon = getIconForType(type, icon);
  const css = loadCSS();

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        ${css}
      </style>
      <script>
        // Inline JS to avoid IPC serialization issues
        window.electronAPI = {
          notificationClicked: () => {
            window.location.href = 'notification://clicked';
          },
          notificationClosed: () => {
            window.location.href = 'notification://closed';
          }
        };

        // Progress bar countdown
        let progressWidth = 100;
        let progressInterval = null;
        let isPaused = false;
        const totalDuration = ${autoCloseMs};
        const updateInterval = 100; // Update every 100ms
        const decrementPerUpdate = (100 / totalDuration) * updateInterval;

        function startProgressBar() {
          progressInterval = setInterval(() => {
            if (!isPaused) {
              progressWidth -= decrementPerUpdate;
              if (progressWidth <= 0) {
                progressWidth = 0;
                clearInterval(progressInterval);
              }
              const progressBar = document.querySelector('.progress-bar-fill');
              if (progressBar) {
                progressBar.style.width = progressWidth + '%';
              }
            }
          }, updateInterval);
        }

        function pauseProgressBar() {
          isPaused = true;
        }

        function resumeProgressBar() {
          isPaused = false;
        }

        // Initialize when DOM is ready
        document.addEventListener('DOMContentLoaded', () => {
          startProgressBar();

          // Pause on hover
          const container = document.querySelector('.notification-container');
          if (container) {
            container.addEventListener('mouseenter', pauseProgressBar);
            container.addEventListener('mouseleave', resumeProgressBar);
          }
        });
      </script>
    </head>
    <body>
      <div class="notification-container" data-type="${type}">
        <button class="close-btn" onclick="event.stopPropagation(); window.electronAPI?.notificationClosed()">×</button>

        <div class="notification-content" onclick="window.electronAPI?.notificationClicked()">
          <div class="notification-icon">${notificationIcon}</div>
          <div class="notification-text">
            <div class="notification-title">${escapeHtml(title)}</div>
            <div class="notification-body">${escapeHtml(body)}</div>
            ${subtitle ? `<div class="notification-subtitle">${escapeHtml(subtitle)}</div>` : ''}
          </div>
        </div>

        <div class="progress-bar">
          <div class="progress-bar-fill" style="width: 100%;"></div>
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text: string): string {
  const div = { innerHTML: '' } as any;
  const textNode = text;
  return textNode
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
