# Comprehensive Logging Guide - Meeting Note Recorder

## Overview
We've added detailed logging throughout the application to track user journeys, debug issues, and monitor performance. The logging follows a consistent pattern with prefixed categories for easy filtering.

## Logging Categories

### User Journey Logs
- **[USER-JOURNEY]** - High-level user actions and flows
- **[IPC]** - IPC handler requests from UI
- **[STATE-CHECK]** - State queries and checks

### Recording Lifecycle
- **[RECORDING-START]** - Recording initialization and startup
- **[RECORDING-STOP]** - Recording termination and cleanup
- **[RECORDING-EVENT]** - SDK recording events
- **[RECORDING-LIFECYCLE]** - Service initialization
- **[AUTO-STOP]** - Automatic recording stops
- **[TRANSCRIPT-FLOW]** - Transcript processing events
- **[TRANSCRIPT]** - Transcript chunk processing

### Meeting Detection
- **[DETECTION]** - Meeting detection service operations
- **[DETECTION-FLOW]** - Detection event flow
- **[JOURNEY-*]** - Legacy journey markers (being phased out)

### Storage Operations
- **[STORAGE]** - Data persistence operations
- **[PREP-NOTES]** - Prep note adoption flows

### Calendar Integration
- **[CALENDAR]** - Calendar service operations
- **[CALENDAR-SYNC]** - Calendar synchronization events

### API Operations
- **[API-UPLOAD]** - SDK upload creation
- **[API-STATUS]** - Upload status checks
- **[API-TRANSCRIPT]** - Transcript fetching
- **[API]** - General API operations

### Settings & Configuration
- **[SETTINGS]** - Settings updates and changes

## Key Performance Metrics Logged

All major operations now log duration in milliseconds:
- SDK health check duration
- Upload creation duration
- Recording start/stop duration
- Calendar sync duration
- API request durations
- Transcript processing time
- Search operation time

## Testing Scenarios

### Scenario 1: Full Recording Flow
```
1. Start app → [RECORDING-LIFECYCLE] Initialize
2. Detect meeting → [DETECTION-FLOW] Meeting detected
3. Start recording → [RECORDING-START] with timing
4. Receive transcripts → [TRANSCRIPT-FLOW] chunks
5. Stop recording → [RECORDING-STOP] with cleanup
6. Correct transcript → [RECORDING-STOP] correction timing
```

### Scenario 2: Calendar Sync
```
1. Connect calendar → [IPC] CONNECT_CALENDAR
2. Authenticate → [CALENDAR] authentication
3. Sync events → [CALENDAR-SYNC] with event count
4. Create meetings → [STORAGE] saving meetings
```

### Scenario 3: Error Scenarios
```
1. SDK not responding → [RECORDING-START] SDK health check failed
2. API failures → [API-UPLOAD] with retry information
3. Auto-stop failures → [AUTO-STOP] with error details
```

## Debugging Tips

### Filter by Category
```bash
# View only recording events
grep "\[RECORDING-" app.log

# View user journey
grep "\[USER-JOURNEY\]\|\[IPC\]" app.log

# View errors only
grep "ERROR\|error" app.log
```

### Performance Analysis
```bash
# Find slow operations (>1000ms)
grep "durationMs" app.log | grep -E "durationMs\": [1-9][0-9]{3}"

# Track memory usage
grep "bufferSize\|transcriptCount" app.log
```

### State Tracking
```bash
# Track recording state changes
grep "currentState\|isRecording" app.log

# Track meeting lifecycle
grep "status.*:\|meetingId" app.log
```

## Critical Paths Monitored

1. **Recording Start Path**
   - Permission check
   - SDK health check (3s timeout)
   - Meeting load from storage
   - Upload session creation
   - Window detection
   - SDK recording start

2. **Recording Stop Path**
   - Auto-save cleanup
   - SDK stop & upload
   - Transcript correction
   - Meeting status update
   - State reset

3. **Error Recovery**
   - Auto-save interval cleanup on error
   - State reset on failures
   - Retry logic for API calls

## Log Levels Used

- **info** - Normal operations, user actions, state changes
- **debug** - Detailed data flow, chunk processing
- **warn** - Recoverable issues, fallbacks used
- **error** - Failures requiring attention

## What's NOT Logged (Privacy)

- Full transcript content (only lengths/previews)
- Full API tokens (only first 10 chars)
- User credentials
- Meeting attendee details
- Sensitive meeting content

## Future Improvements

1. Add structured logging with correlation IDs
2. Implement log rotation and cleanup
3. Add metrics aggregation
4. Create debug mode toggle
5. Add telemetry for common issues

## Summary

The application now has comprehensive logging covering:
- ✅ All user-initiated actions
- ✅ Complete recording lifecycle
- ✅ API interactions with timing
- ✅ Error scenarios with context
- ✅ Performance metrics
- ✅ State transitions
- ✅ Auto-recovery attempts

This logging will help identify issues quickly and understand exactly what happened during any user session.