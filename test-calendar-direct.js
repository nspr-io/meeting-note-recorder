// Direct test of calendar sync with stored credentials
const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CLIENT_ID = '1042328300965-or1qom5dd5oechlkc03q9qpfelibaq1i.apps.googleusercontent.com';
const CLIENT_SECRET = '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';
const REDIRECT_URI = 'http://localhost:9001';

// Read tokens from electron-store location
const configPath = path.join(os.homedir(), 'Library', 'Application Support', 'meeting-note-recorder', 'google-calendar-tokens.json');

console.log('Looking for tokens at:', configPath);

try {
  const configData = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(configData);
  
  console.log('Found tokens:', {
    hasAccessToken: !!config.access_token,
    hasRefreshToken: !!config.refresh_token,
    expiryDate: config.expiry_date ? new Date(config.expiry_date) : null
  });
  
  const oauth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  oauth2Client.setCredentials(config);
  
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  
  const now = new Date();
  const oneWeekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  
  console.log('\nFetching calendar events from', now.toISOString(), 'to', oneWeekFromNow.toISOString());
  
  calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: oneWeekFromNow.toISOString(),
    maxResults: 10,
    singleEvents: true,
    orderBy: 'startTime',
  })
  .then(response => {
    console.log('\n✅ SUCCESS! Found', response.data.items?.length || 0, 'events\n');
    
    if (response.data.items && response.data.items.length > 0) {
      console.log('Upcoming events:');
      response.data.items.forEach(event => {
        const start = event.start?.dateTime || event.start?.date;
        console.log(`- ${event.summary || 'Untitled'} at ${start}`);
      });
    } else {
      console.log('No upcoming events found in the next week.');
    }
  })
  .catch(error => {
    console.error('\n❌ ERROR:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
      console.error('Response status:', error.response.status);
    }
    if (error.code === 401) {
      console.error('\nToken may be expired. Need to refresh or re-authenticate.');
    }
  });
  
} catch (error) {
  console.error('Could not read token file:', error.message);
  console.log('\nPlease authenticate with Google Calendar first in the app.');
}