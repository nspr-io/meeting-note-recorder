import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { CalendarEvent } from '../../shared/types';
import { BrowserWindow } from 'electron';
import Store from 'electron-store';

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

interface TokenStore {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  expiry_date?: number;
}

export class CalendarService {
  private oauth2Client: OAuth2Client;
  private tokenStore: any; // Using any to work around TypeScript issues with electron-store in tests
  private calendar: any;

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

  private hasConferenceLink(event: any): boolean {
    // Check various fields where conference links might be stored
    const fieldsToCheck = [
      event.description || '',
      event.location || '',
      event.hangoutLink || '',
      event.conferenceData?.entryPoints?.map((ep: any) => ep.uri).join(' ') || ''
    ].join(' ');

    // Check if any conference pattern matches
    return this.conferencePatterns.some(pattern => pattern.test(fieldsToCheck));
  }

  async fetchUpcomingMeetings(): Promise<CalendarEvent[]> {
    console.log('fetchUpcomingMeetings called');
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
      // Fetch events from now to 30 days in the future (no past meetings)
      const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      console.log('Fetching future events from', now.toISOString(), 'to', thirtyDaysFromNow.toISOString());

      const response = await this.calendar.events.list({
        calendarId: 'primary',
        timeMin: now.toISOString(),
        timeMax: thirtyDaysFromNow.toISOString(),
        maxResults: 250,
        singleEvents: true,
        orderBy: 'startTime',
      });

      console.log('Calendar API response:', response.data.items?.length || 0, 'events found');

      const events = response.data.items || [];

      // Filter events to only include those with conference links
      const eventsWithConference = events.filter((event: any) => {
        const hasLink = this.hasConferenceLink(event);
        if (!hasLink) {
          console.log(`Filtering out event "${event.summary}" - no conference link detected`);
        }
        return hasLink;
      });

      console.log(`Filtered ${events.length} events to ${eventsWithConference.length} with conference links`);

      return eventsWithConference.map((event: any) => ({
        id: event.id,
        title: event.summary || 'Untitled Event',
        start: new Date(event.start.dateTime || event.start.date),
        end: new Date(event.end.dateTime || event.end.date),
        attendees: (event.attendees || []).map((a: any) => a.email || a.displayName || ''),
        description: event.description,
        location: event.location,
        calendarId: 'primary',
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
      
      return {
        id: event.id,
        title: event.summary || 'Untitled Event',
        start: new Date(event.start.dateTime || event.start.date),
        end: new Date(event.end.dateTime || event.end.date),
        attendees: (event.attendees || []).map((a: any) => a.email || a.displayName || ''),
        description: event.description,
        location: event.location,
        calendarId: 'primary',
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

  async getUpcomingEvents(): Promise<CalendarEvent[]> {
    return this.fetchUpcomingMeetings();
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
}