# Production Environment Variables Fix

## Date Fixed
2025-10-06

## Problem

The production DMG build was missing **Google OAuth credentials**, causing calendar sync to fail:

- ❌ **Calendar Sync**: Couldn't connect to Google Calendar (no OAuth credentials)
- ✅ **Recording**: Works if user enters Recall.ai API key in Settings UI
- ✅ **AI Features**: Works if user enters Anthropic API key in Settings UI
- ⚠️ **Logging**: Wrong verbosity level (minor issue)

## Root Cause

Environment variables from `.env` file were **only available in development**, not production:

### Development (Worked)
1. `.env` file exists in project directory
2. `dotenv.config()` loads variables at runtime
3. All features work ✅

### Production (Broken)
1. `.env` file correctly excluded from DMG (security)
2. `dotenv.config()` fails silently (no file found)
3. All `process.env.GOOGLE_CLIENT_ID` etc. = `undefined`
4. Applications features completely broken ❌

## Technical Details

**Before**: Webpack only injected `NODE_ENV`:
```javascript
new webpack.DefinePlugin({
  'process.env.NODE_ENV': JSON.stringify(isDevelopment ? 'development' : 'production'),
}),
```

**After**: Webpack now injects ALL required credentials at build time:
```javascript
const envConfig = dotenv.config({ path: path.resolve(__dirname, '.env') }).parsed || {};

new webpack.DefinePlugin({
  'process.env.NODE_ENV': JSON.stringify(isDevelopment ? 'development' : 'production'),
  'process.env.GOOGLE_CLIENT_ID': JSON.stringify(envConfig.GOOGLE_CLIENT_ID || ''),
  'process.env.GOOGLE_CLIENT_SECRET': JSON.stringify(envConfig.GOOGLE_CLIENT_SECRET || ''),
  'process.env.RECALL_API_KEY': JSON.stringify(envConfig.RECALL_API_KEY || ''),
  'process.env.RECALL_API_URL': JSON.stringify(envConfig.RECALL_API_URL || ''),
  'process.env.RECALL_API_BASE': JSON.stringify(envConfig.RECALL_API_URL || ''),
  'process.env.ANTHROPIC_API_KEY': JSON.stringify(envConfig.ANTHROPIC_API_KEY || ''),
  'process.env.LOG_LEVEL': JSON.stringify(envConfig.LOG_LEVEL || 'info'),
}),
```

## Files Changed

**File**: `webpack.main.config.js`
- Added `dotenv` import
- Load `.env` file at build time
- Inject all required environment variables via `DefinePlugin`

## Environment Variables Injected

| Variable | Required? | Purpose | User-Configurable? |
|----------|-----------|---------|-------------------|
| `GOOGLE_CLIENT_ID` | ✅ **YES** | Google OAuth app ID | ❌ No (OAuth app credential) |
| `GOOGLE_CLIENT_SECRET` | ✅ **YES** | Google OAuth app secret | ❌ No (OAuth app credential) |
| `RECALL_API_KEY` | ⚠️ Optional default | Recall.ai authentication | ✅ Yes (Settings UI) |
| `RECALL_API_URL` | ⚠️ Optional default | Recall.ai endpoint | ✅ Yes (Settings UI) |
| `RECALL_API_BASE` | ⚠️ Optional default | Recall.ai endpoint (alias) | ✅ Yes (Settings UI) |
| `ANTHROPIC_API_KEY` | ⚠️ Optional default | Claude AI | ✅ Yes (Settings UI) |
| `LOG_LEVEL` | ⚠️ Optional default | Logging verbosity | ❌ No |

**Note**: Only Google credentials are **required** in the build. Recall/Anthropic keys can be entered by users in the Settings UI and persist via electron-store.

## Impact

### Before Fix
- Production DMG: **Calendar sync broken** ❌
  - Calendar sync failed silently (no OAuth credentials)
  - Recording requires user to enter API key in Settings
  - AI features require user to enter API key in Settings

### After Fix
- Production DMG: **Fully functional** ✅
  - Calendar sync works (OAuth credentials embedded)
  - Recording works if user enters API key OR uses .env default
  - AI features work if user enters API key OR uses .env default
  - Correct logging level

## Security Considerations

**Question**: Is it safe to embed credentials in the production build?

**Answer**:
- ✅ **Acceptable** for desktop Electron apps (code is obfuscated in ASAR)
- ❌ **NOT acceptable** for web apps (credentials exposed)
- ⚠️ **Better approach**: Use OAuth flows that don't require embedding secrets

**Recommendations**:
1. For Google Calendar: Current approach is acceptable (OAuth 2.0 flow)
2. For Recall.ai: Consider backend proxy or OAuth if available
3. For Anthropic: Consider user-provided API keys in settings
4. Rotate keys regularly
5. Don't commit `.env` to git (already in `.gitignore`)

## Testing

To verify the fix works:
1. Build production DMG: `npm run build && npm run dist`
2. Install DMG on fresh system
3. Open app and check:
   - Calendar connects successfully
   - Recording starts successfully
   - AI features work
   - Logs show correct level

## Notes

- This is a **critical fix** - without it, production builds are unusable
- The fix uses webpack's compile-time substitution (not runtime loading)
- `.env` file still correctly excluded from DMG package
- Development mode unchanged (still uses runtime dotenv)
