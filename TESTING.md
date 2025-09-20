# Production Testing Guide

## Overview
This project uses **REAL PRODUCTION TESTING** with **NO MOCKS**. All tests interact with the actual application to verify functionality in real-world conditions.

## Available Test Scripts

### 1. Interactive Test (Recommended for First-Time Testing)
```bash
npm run test:interactive
```
This test guides you through each step with clear instructions and waits for your confirmation. Perfect for:
- Initial app verification
- Permission setup validation
- Understanding app behavior

### 2. Production Test (Comprehensive Testing)
```bash
npm run test:production
# or simply
npm test
```
This test provides:
- Detailed logging with timestamps
- Error context for debugging
- Comprehensive test coverage
- Saved test results in JSON format

## Test Coverage

Both test scripts verify:

1. **App Launch & Initialization**
   - Application starts correctly
   - Services initialize properly
   - Log files are created

2. **System Permissions**
   - Accessibility (required for window detection)
   - Microphone (required for audio recording)
   - Screen Recording (optional, for video)

3. **Manual Recording**
   - Create manual recording via UI
   - Start/stop recording
   - Save notes and audio
   - File verification

4. **Automatic Meeting Detection**
   - Detects Zoom meetings
   - Detects Google Meet (in Chrome)
   - Detects Microsoft Teams
   - Detects Slack Huddles

5. **Toast Notifications**
   - Shows notification when meeting detected
   - "Start Recording" button works
   - "Dismiss" button works
   - "Select Different Meeting" option

6. **Transcript Capture**
   - Audio recording starts
   - Transcript is generated
   - Content is saved to markdown

## Prerequisites

### 1. Build the App
```bash
npm run dist
```

### 2. Grant Permissions
Open System Preferences > Security & Privacy > Privacy and add Meeting Note Recorder to:
- **Accessibility** (required)
- **Microphone** (required)
- **Screen Recording** (optional)
- **Notifications** (recommended)

### 3. Install Meeting Apps
For full testing, have at least one installed:
- Zoom
- Google Chrome (for Google Meet)
- Microsoft Teams
- Slack

## Running Tests

### First Time Setup
1. Build the app: `npm run dist`
2. Run interactive test: `npm run test:interactive`
3. Follow the prompts to grant permissions
4. Complete each test step as instructed

### Regular Testing
```bash
npm test
```

### Debugging Failed Tests

#### Check Log Files
Production test creates multiple log files:
- **App logs**: `~/Documents/MeetingRecordings/logs/`
- **Test log**: `./test-production.log`
- **Results**: `./test-results.json`

#### Common Issues

**Meeting Not Detected:**
- Ensure Zoom/Teams/Meet window is visible
- Check accessibility permissions
- Window title must contain meeting information

**Recording Not Starting:**
- Check microphone permissions
- Verify API key is set (if using Recall.ai)
- Check available disk space

**No Transcript:**
- Speak clearly during recording
- Ensure microphone is working
- Check audio input settings

**Notification Not Shown:**
- Enable notifications in System Preferences
- Check notification settings for Meeting Note Recorder
- Ensure Do Not Disturb is off

## Test Output

### Success Example
```
✅ App started successfully (PID: 12345)
✅ Accessibility permission granted
✅ Meeting detected by test
✅ App detected meeting
✅ Notification displayed
✅ Recording started via notification
✅ Transcript captured
✅ Recording saved successfully
```

### Failure Example
```
❌ App meeting detection: Meeting not detected by app
   Context: {
     "detected_by_test": ["Zoom: Team Standup"],
     "missing_events": ["Meeting detected", "Zoom meeting detected"],
     "hint": "Check accessibility permissions"
   }
```

## Architecture

The testing approach verifies the complete system:

```
User Action (Start Meeting)
    ↓
AppleScript Detection (WindowDetectionService)
    ↓
Meeting Detection (MeetingDetectionService)
    ↓
System Notification
    ↓
User Clicks "Start Recording"
    ↓
Audio Recording (LocalRecordingService/RecallAI)
    ↓
Transcript Generation
    ↓
File Save (StorageService)
```

## Important Notes

1. **NO MOCKS**: These tests use the real production app
2. **Manual Actions Required**: You'll need to start actual meetings
3. **Permissions Critical**: Without proper permissions, detection won't work
4. **Logs Are Key**: Always check logs for debugging
5. **Platform Specific**: Tests are designed for macOS

## Troubleshooting

### App Won't Start
```bash
# Check if app is built
ls -la "dist-app/mac-arm64/Meeting Note Recorder.app"

# Rebuild if needed
npm run dist
```

### Permissions Issues
```bash
# Check accessibility permission via terminal
osascript -e 'tell application "System Events" to get name of first process'
```

### Meeting Not Detected
```bash
# Manually check for meeting windows
osascript -e 'tell application "System Events" to get name of every window of process "zoom.us"'
```

### View Real-Time Logs
```bash
# Tail app logs
tail -f ~/Documents/MeetingRecordings/logs/*.log
```

## Support

If tests fail consistently:
1. Check all log files mentioned in test output
2. Verify permissions are correctly granted
3. Ensure meeting apps are properly installed
4. Try the interactive test for step-by-step guidance
5. Check `test-results.json` for detailed failure information