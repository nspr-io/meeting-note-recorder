# 🔐 PERMISSIONS SETUP GUIDE

## CRITICAL: Which App to Grant Permissions To

**You must grant permissions to the CORRECT app:**

### ✅ CORRECT APP PATH:
```
/Users/joshuawohle/Documents/Workspace/Core/Tools/meeting-note-recorder/dist-app/mac-arm64/Meeting Note Recorder.app
```

### ❌ WRONG PATHS (DO NOT USE):
- Any DMG file
- Any app in Downloads folder
- Any app in /Applications folder (unless you copied it there)

## Step-by-Step Permission Setup

### 1. Open System Preferences
- Click Apple Menu → System Preferences
- Click "Security & Privacy"
- Click the "Privacy" tab
- Click the lock 🔒 to make changes (enter your password)

### 2. Grant ACCESSIBILITY Permission (REQUIRED)
- Select "Accessibility" from the left sidebar
- Click the "+" button
- Navigate to: `/Users/joshuawohle/Documents/Workspace/Core/Tools/meeting-note-recorder/dist-app/mac-arm64/`
- Select "Meeting Note Recorder.app"
- Click "Open"
- ✅ Make sure the checkbox is CHECKED

### 3. Grant MICROPHONE Permission (REQUIRED)
- Select "Microphone" from the left sidebar
- Look for "Meeting Note Recorder"
- ✅ Make sure the checkbox is CHECKED
- If not listed, the app will request it when first needed

### 4. Grant SCREEN RECORDING Permission (REQUIRED)
- Select "Screen Recording" from the left sidebar
- Click the "+" button
- Navigate to: `/Users/joshuawohle/Documents/Workspace/Core/Tools/meeting-note-recorder/dist-app/mac-arm64/`
- Select "Meeting Note Recorder.app"
- Click "Open"
- ✅ Make sure the checkbox is CHECKED

### 5. CRITICAL: Grant Permissions to BOTH Processes

⚠️ **BOTH processes need permissions for meeting detection to work:**

1. **Main App:** Meeting Note Recorder.app
2. **SDK Process:** desktop_sdk_macos_exe

When macOS asks for permissions, you'll see TWO different permission requests:
- One for "Meeting Note Recorder" 
- One for "desktop_sdk_macos_exe"

**YOU MUST ALLOW BOTH!**

If you missed the SDK permission prompt:
1. Go to System Preferences → Security & Privacy → Privacy → Accessibility
2. Look for BOTH:
   - Meeting Note Recorder
   - desktop_sdk_macos_exe
3. Make sure BOTH are checked ✅

## How to Verify Permissions Are Correct

Run this command to check:
```bash
# Check if the app has accessibility permission
osascript -e 'tell application "System Events" to get name of first process'
```

If it works without error, permissions are correct.

## If Permissions Don't Work

1. **Remove and Re-add the App:**
   - In each permission section, select the app and click "-" to remove
   - Click "+" to add it again
   - Make sure you're adding from the correct path

2. **Restart the App:**
   ```bash
   pkill -f "Meeting Note Recorder"
   open "/Users/joshuawohle/Documents/Workspace/Core/Tools/meeting-note-recorder/dist-app/mac-arm64/Meeting Note Recorder.app"
   ```

3. **Check Console for Errors:**
   - Open Console.app
   - Filter for "Meeting Note Recorder"
   - Look for permission-related errors

## Common Issues

### "App is damaged and can't be opened"
```bash
xattr -cr "/Users/joshuawohle/Documents/Workspace/Core/Tools/meeting-note-recorder/dist-app/mac-arm64/Meeting Note Recorder.app"
```

### "Operation not permitted" errors
- The app doesn't have the right permissions
- Double-check you added the correct app path
- Try removing and re-adding permissions

### SDK Process Not Detecting Meetings
- The SDK subprocess also needs permissions
- Look for "desktop_sdk_macos_exe" in permission dialogs
- Grant it the same permissions as the main app