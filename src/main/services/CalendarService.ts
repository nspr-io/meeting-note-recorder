import { google, calendar_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { CalendarEvent } from '../../shared/types';
import Store from 'electron-store';
import { EventEmitter } from 'events';

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];
const REMINDER_CACHE_TTL_MS = 2 * 60 * 1000;

interface TokenStore {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  expiry_date?: number;
}

type NormalizedEvent = {
  event: calendar_v3.Schema$Event;
  startDate: Date | null;
  endDate: Date | null;
};

export class CalendarService extends EventEmitter {
  private oauth2Client: OAuth2Client;
  private tokenStore: any; // Using any to work around TypeScript issues with electron-store in tests
  private calendar: any;
  private notificationTimer: NodeJS.Timeout | null = null;
  private notifiedMeetings = new Set<string>();
  private reminderEventsCache: CalendarEvent[] = [];
  private reminderEventsFetchedAt = 0;

  // Common video conference URL patterns
  private conferencePatterns = [
    /zoom\.us\/[js]\/\d+/i,
    /meet\.google\.com\/[a-z\-]+/i,
    /teams\.microsoft\.com\/l\/meetup-join/i,
    /teams\.live\.com\/meet/i,
    /webex\.com\/meet/i,
    /whereby\.com\/[a-z\-]+/i,
    /gotomeeting\.com\/join/i,
    /join\.me\/[a-z0-9]+/i,
    /bluejeans\.com\/\d+/i,
    /skype\.com\/join/i,
    /chime\.aws\/\d+/i,
    /hangouts\.google\.com\/call/i,
    /meet\.jit\.si\/[a-z\-]+/i,
    /discord\.gg\/[a-z0-9]+/i,
    /discord\.com\/channels/i,
    /telebridge/i,
    /dial-in/i,
    /conference.*call/i,
    /video.*call/i,
    /video.*conference/i,
    /virtual.*meeting/i,
    /online.*meeting/i,
  ];

  constructor() {
    super();
    // Use the actual credentials provided by the user
    const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
    const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
    const REDIRECT_URI = 'http://localhost:9001';

    console.log('Initializing CalendarService with CLIENT_ID:', CLIENT_ID.substring(0, 20) + '...');

    this.oauth2Client = new OAuth2Client(
      CLIENT_ID,
      CLIENT_SECRET,
      REDIRECT_URI
    );

    this.tokenStore = new Store<{ tokens: TokenStore }>({
      name: 'google-calendar-tokens',
      encryptionKey: 'calendar-encryption-key',
    });

    const tokens = this.tokenStore.get('tokens') || {};

    console.log('Stored tokens available:', !!tokens.access_token);
    console.log('Token store keys:', Object.keys(tokens));
    if (tokens.access_token) {
      console.log('Setting credentials from stored tokens');
      console.log('Token expiry:', new Date(tokens.expiry_date || 0));
      this.oauth2Client.setCredentials(tokens);
      this.calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
    } else {
      console.log('No access token found in stored tokens');
    }
  }

  async authenticate(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Generate auth URL
      const authUrl = this.oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent',
      });

      // Set up local server to receive OAuth callback
      const http = require('http');
      const url = require('url');
      const { shell } = require('electron');
      
      const server = http.createServer(async (req: any, res: any) => {
        const queryObject = url.parse(req.url, true).query;
        
        if (queryObject.code) {
          // Exchange code for tokens
          try {
            console.log('Received OAuth code, exchanging for tokens...');
            const { tokens } = await this.oauth2Client.getToken(queryObject.code);
            console.log('Received tokens:', Object.keys(tokens));
            this.oauth2Client.setCredentials(tokens);

            // Store tokens
            console.log('Storing tokens to electron-store...');
            this.tokenStore.set('tokens', tokens as TokenStore);
            console.log('Tokens stored successfully');

            // Verify tokens were stored
            const storedTokens = this.tokenStore.get('tokens');
            console.log('Verification - tokens retrieved:', !!storedTokens?.access_token);

            // Initialize calendar
            this.calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
            console.log('Calendar service initialized successfully');
            
            // Send success response with auto-close script
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; text-align: center; padding: 50px;">
                  <h1 style="color: #34c759;">✓ Authentication successful!</h1>
                  <p>You can close this browser tab and return to Meeting Note Recorder.</p>
                  <script>
                    setTimeout(() => {
                      window.close();
                    }, 3000);
                  </script>
                </body>
              </html>
            `);
            
            server.close();
            resolve();
          } catch (error) {
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; text-align: center; padding: 50px;">
                  <h1 style="color: #ff3b30;">✗ Authentication failed</h1>
                  <p>Please close this tab and try again.</p>
                </body>
              </html>
            `);
            server.close();
            reject(error);
          }
        } else if (req.url === '/') {
          // Redirect root requests to Google OAuth
          res.writeHead(302, { 'Location': authUrl });
          res.end();
        }
      });

      server.listen(9001, () => {
        console.log('OAuth callback server listening on http://localhost:9001');
        // Open the auth URL in the default browser
        shell.openExternal(authUrl);
      });

      // Set a timeout to close the server if no response is received
      setTimeout(() => {
        server.close();
        reject(new Error('Authentication timeout'));
      }, 120000); // 2 minute timeout
    });
  }

  async disconnect(): Promise<void> {
    this.oauth2Client.revokeCredentials();
    this.tokenStore.clear();
    this.calendar = null;
  }

  private extractMeetingUrl(event: any): string | undefined {
    // First try native conference data
    if (event.hangoutLink) {
      return event.hangoutLink;
    }

    if (event.conferenceData?.entryPoints) {
      const videoEntry = event.conferenceData.entryPoints.find((ep: any) =>
        ep.entryPointType === 'video' || ep.uri?.includes('http')
      );
      if (videoEntry?.uri) {
        return videoEntry.uri;
      }
    }

    // Fallback to searching in description and location
    const textToSearch = `${event.description || ''} ${event.location || ''}`;
    for (const pattern of this.conferencePatterns) {
      const match = textToSearch.match(pattern);
      if (match) {
        // Extract the full URL if we matched a pattern
        const urlMatch = textToSearch.match(/https?:\/\/[^\s<>"]+/gi);
        if (urlMatch) {
          for (const url of urlMatch) {
            if (pattern.test(url)) {
              return url;
            }
          }
        }
      }
    }

    return undefined;
  }

  private hasConferenceLink(event: any): boolean {
    return !!this.extractMeetingUrl(event);
  }

  async fetchUpcomingMeetings(daysAhead: number = 30): Promise<CalendarEvent[]> {
    console.log('fetchUpcomingMeetings called with daysAhead:', daysAhead);
    console.log('Calendar object exists:', !!this.calendar);
    console.log('Is authenticated:', this.isAuthenticated());

    // Re-initialize calendar if we have tokens but no calendar object
    if (!this.calendar && this.isAuthenticated()) {
      console.log('Re-initializing calendar from stored tokens');
      const tokens = this.tokenStore.get('tokens') || {};
      this.oauth2Client.setCredentials(tokens);
      this.calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
    }

    if (!this.calendar) {
      console.error('Calendar not authenticated - no calendar object');
      throw new Error('Calendar not authenticated - please connect Google Calendar first');
    }

    try {
      // Refresh token if expired
      await this.refreshTokenIfNeeded();

      const now = new Date();
      // Fetch events from 2 hours ago to specified days in the future (to include ongoing meetings)
      // This ensures meetings that have started but not ended still appear
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      const futureDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

      console.log('Fetching events from', twoHoursAgo.toISOString(), 'to', futureDate.toISOString());

      const response = await this.calendar.events.list({
        calendarId: 'primary',
        timeMin: twoHoursAgo.toISOString(),
        timeMax: futureDate.toISOString(),
        maxResults: 250,
        singleEvents: true,
        orderBy: 'startTime',
      });

      console.log('Calendar API response:', response.data.items?.length || 0, 'events found');

      const normalizedEvents: NormalizedEvent[] = (response.data.items || [])
        .filter((event: calendar_v3.Schema$Event | null | undefined): event is calendar_v3.Schema$Event => Boolean(event))
        .map((event: calendar_v3.Schema$Event) => {
        const startRaw = event?.start?.dateTime || event?.start?.date;
        const endRaw = event?.end?.dateTime || event?.end?.date;
        return {
          event,
          startDate: startRaw ? new Date(startRaw) : null,
          endDate: endRaw ? new Date(endRaw) : null,
        };
      });

      const eventsWithValidTimes = normalizedEvents.filter(({ event, startDate, endDate }: NormalizedEvent) => {
        if (event.status === 'cancelled') {
          console.log(`[CALENDAR] Skipping cancelled event ${event.id}`);
          return false;
        }
        if (!startDate || Number.isNaN(startDate.getTime())) {
          console.warn(`[CALENDAR] Skipping event ${event.id} (${event.summary || 'Untitled Event'}) - missing or invalid start time`);
          return false;
        }
        if (!endDate || Number.isNaN(endDate.getTime())) {
          console.warn(`[CALENDAR] Skipping event ${event.id} (${event.summary || 'Untitled Event'}) - missing or invalid end time`);
          return false;
        }
        if (!event.id) {
          console.warn('[CALENDAR] Skipping event without ID');
          return false;
        }
        if (endDate <= now) {
          return false;
        }
        return true;
      });

      const eventsWithConference = eventsWithValidTimes.filter(({ event }: NormalizedEvent) => {
        const hasLink = this.hasConferenceLink(event);
        if (!hasLink) {
          console.log(`Filtering out event "${event.summary}" - no conference link detected`);
        }
        return hasLink;
      });

      console.log(`Filtered ${eventsWithValidTimes.length} events to ${eventsWithConference.length} with conference links`);

      return eventsWithConference.map(({ event, startDate, endDate }: NormalizedEvent) => ({
        id: event.id!,
        title: event.summary || 'Untitled Event',
        start: startDate!,
        end: endDate!,
        attendees: (event.attendees || []).map((a: calendar_v3.Schema$EventAttendee) => a.email ?? a.displayName ?? ''),
        description: event.description ?? undefined,
        location: event.location ?? undefined,
        calendarId: 'primary',
        meetingUrl: this.extractMeetingUrl(event),
        htmlLink: event.htmlLink ?? undefined,
      }));
    } catch (error: any) {
      console.error('Failed to fetch calendar events:', error);
      console.error('Error details:', error.message, error.code, error.response?.data);
      throw error;
    }
  }

  async getEvent(eventId: string): Promise<CalendarEvent | null> {
    if (!this.calendar) {
      throw new Error('Calendar not authenticated');
    }

    try {
      await this.refreshTokenIfNeeded();

      const response = await this.calendar.events.get({
        calendarId: 'primary',
        eventId,
      });

      const event = response.data;
      
      const startRaw = event.start?.dateTime || event.start?.date;
      const endRaw = event.end?.dateTime || event.end?.date;
      if (!startRaw || !endRaw) {
        console.warn(`[CALENDAR] Event ${event.id} missing start or end time`);
        return null;
      }

      const startDate = new Date(startRaw);
      const endDate = new Date(endRaw);
      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        console.warn(`[CALENDAR] Event ${event.id} has invalid start or end time`);
        return null;
      }

      return {
        id: event.id,
        title: event.summary || 'Untitled Event',
        start: startDate,
        end: endDate,
        attendees: (event.attendees || []).map((a: any) => a.email || a.displayName || ''),
        description: event.description,
        location: event.location,
        calendarId: 'primary',
        meetingUrl: this.extractMeetingUrl(event),
        htmlLink: event.htmlLink,
      };
    } catch (error) {
      console.error('Failed to get calendar event:', error);
      return null;
    }
  }

  private async refreshTokenIfNeeded(): Promise<void> {
    const tokens = this.tokenStore.get('tokens') || {};
    
    if (tokens.expiry_date && tokens.expiry_date <= Date.now()) {
      try {
        const { credentials } = await this.oauth2Client.refreshAccessToken();
        this.oauth2Client.setCredentials(credentials);
        this.tokenStore.set('tokens', credentials as TokenStore);
      } catch (error) {
        console.error('Failed to refresh access token:', error);
        throw error;
      }
    }
  }

  isAuthenticated(): boolean {
    const tokens = this.tokenStore.get('tokens');
    return !!(tokens && tokens.access_token);
  }

  async initialize(): Promise<boolean> {
    try {
      if (this.isAuthenticated()) {
        this.calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to initialize calendar service:', error);
      return false;
    }
  }

  async getUpcomingEvents(daysAhead: number = 30): Promise<CalendarEvent[]> {
    return this.fetchUpcomingMeetings(daysAhead);
  }

  async listCalendars(): Promise<Array<{ id: string; name: string }>> {
    if (!this.calendar) {
      throw new Error('Calendar not authenticated');
    }

    try {
      await this.refreshTokenIfNeeded();

      const response = await this.calendar.calendarList.list({
        maxResults: 50,
      });

      return (response.data.items || []).map((cal: any) => ({
        id: cal.id,
        name: cal.summary || cal.id,
      }));
    } catch (error) {
      console.error('Failed to list calendars:', error);
      throw error;
    }
  }

  private async getCachedReminderEvents(): Promise<CalendarEvent[]> {
    const now = Date.now();
    const cacheStale = (now - this.reminderEventsFetchedAt) > REMINDER_CACHE_TTL_MS;

    if (!this.reminderEventsCache.length || cacheStale) {
      try {
        const events = await this.getUpcomingEvents();
        this.reminderEventsCache = events;
        this.reminderEventsFetchedAt = Date.now();
        console.log(`Reminder events cache refreshed (${events.length} events)`);
      } catch (error) {
        console.error('Failed to refresh reminder events cache:', error);
      }
    }

    return this.reminderEventsCache;
  }

  // Pre-meeting notification methods
  startMeetingReminders() {
    console.log('Starting meeting reminder service');
    // Check every 30 seconds for upcoming meetings
    this.notificationTimer = setInterval(() => {
      this.checkForUpcomingMeetings();
    }, 30000);

    // Do an immediate check
    this.checkForUpcomingMeetings();
  }

  stopMeetingReminders() {
    console.log('Stopping meeting reminder service');
    if (this.notificationTimer) {
      clearInterval(this.notificationTimer);
      this.notificationTimer = null;
    }
    this.notifiedMeetings.clear();
  }

  async checkForUpcomingMeetings() {
    if (!this.isAuthenticated()) {
      console.log('Calendar not authenticated, skipping reminder check');
      return;
    }

    try {
      const events = await this.getCachedReminderEvents();
      const now = Date.now();

      if (!events.length) {
        return;
      }

      for (const event of events) {
        const startTime = new Date(event.start).getTime();
        const timeDiff = startTime - now;

        // Notify between 60-90 seconds before meeting
        if (timeDiff > 0 && timeDiff <= 90000 && timeDiff > 30000) {
          const key = `${event.id}-${event.start}`;
          if (!this.notifiedMeetings.has(key)) {
            this.notifiedMeetings.add(key);
            console.log(`Meeting reminder: ${event.title} starts in ${Math.round(timeDiff/1000)} seconds`);
            this.emit('meeting-reminder', event);
          }
        }
      }

      // Clean up old notifications (older than 2 hours)
      this.cleanupOldNotifications();

      // Remove ended events from cache to keep it tidy
      this.reminderEventsCache = events.filter(event => {
        const endTime = new Date(event.end).getTime();
        return endTime > now;
      });
    } catch (error) {
      console.error('Error checking for upcoming meetings:', error);
    }
  }

  private cleanupOldNotifications() {
    const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
    const toDelete: string[] = [];

    this.notifiedMeetings.forEach(key => {
      const parts = key.split('-');
      const dateStr = parts[parts.length - 1];
      const eventTime = new Date(dateStr).getTime();

      if (eventTime < twoHoursAgo) {
        toDelete.push(key);
      }
    });

    toDelete.forEach(key => this.notifiedMeetings.delete(key));

    if (toDelete.length > 0) {
      console.log(`Cleaned up ${toDelete.length} old notification records`);
    }
  }
}