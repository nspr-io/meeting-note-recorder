import { Meeting } from '../types';

/**
 * Detects the meeting platform from a URL
 * @param url The meeting URL to analyze
 * @returns The detected platform type, or 'other' if unknown
 */
export function detectPlatform(url: string | undefined): Meeting['platform'] {
  if (!url) return 'other';

  if (url.includes('zoom.us')) return 'zoom';
  if (url.includes('meet.google.com')) return 'googlemeet';
  if (url.includes('teams.microsoft.com') || url.includes('teams.live.com')) return 'teams';
  if (url.includes('webex.com')) return 'webex';
  if (url.includes('slack.com')) return 'slack';

  // Other platforms map to 'other'
  if (url.includes('whereby.com')) return 'other';
  if (url.includes('gotomeeting.com')) return 'other';

  return 'other';
}