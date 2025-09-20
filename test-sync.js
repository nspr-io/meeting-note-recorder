// Test script to verify calendar sync works
const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const Store = require('electron-store');

const CLIENT_ID = '1042328300965-or1qom5dd5oechlkc03q9qpfelibaq1i.apps.googleusercontent.com';
const CLIENT_SECRET = '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';
const REDIRECT_URI = 'http://localhost:9001';

const oauth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const tokenStore = new Store({
  name: 'google-calendar-tokens',
  encryptionKey: 'calendar-encryption-key'
});

const tokens = tokenStore.store;
console.log('Stored tokens:', tokens);

if (tokens.access_token) {
  oauth2Client.setCredentials(tokens);
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  
  const now = new Date();
  const oneWeekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  
  calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: oneWeekFromNow.toISOString(),
    maxResults: 10,
    singleEvents: true,
    orderBy: 'startTime',
  }, (err, res) => {
    if (err) {
      console.error('Error:', err);
    } else {
      console.log('Success! Found', res.data.items?.length || 0, 'events');
      res.data.items?.forEach(event => {
        console.log('-', event.summary, 'at', event.start?.dateTime || event.start?.date);
      });
    }
  });
} else {
  console.log('No tokens found - need to authenticate first');
}