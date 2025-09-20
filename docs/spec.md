# Local Meeting Recorder App Specification

## Executive Summary
A macOS desktop application that automatically detects meetings, records transcripts via recall.ai, and provides a unified interface for meeting notes and transcript management. Built with Electron and React/TypeScript, the app ensures reliable transcript capture with robust error handling and seamless Google Calendar integration.

## Core Requirements

### Technology Stack
- **Framework**: Electron
- **Frontend**: React with TypeScript
- **UI Design**: Native macOS appearance (following system theme)
- **Recording Backend**: recall.ai Desktop SDK
- **Calendar Integration**: Google Calendar API (OAuth 2.0)
- **Storage**: Hybrid approach
  - Audio/Video: recall.ai cloud storage
  - Transcripts/Notes: Local markdown files

### Architecture Overview
```
┌─────────────────────────────────────────┐
│           Main Window (Electron)        │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────────┐  ┌─────────────────┐  │
│  │  Upcoming   │  │  Past Meetings  │  │
│  │  Meetings   │  │   (Tab View)    │  │
│  └─────────────┘  └─────────────────┘  │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │    Meeting Detail View          │   │
│  │  ┌──────────┐  ┌──────────────┐│   │
│  │  │  Notes   │  │  Transcript  ││   │
│  │  │  Editor  │  │   Viewer     ││   │
│  │  └──────────┘  └──────────────┘│   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│         System Components               │
├─────────────────────────────────────────┤
│  Meeting Detector → Toast Notification  │
│  recall.ai SDK → Recording Manager      │
│  Google Calendar → Meeting Sync         │
│  Local Storage → Markdown Files         │
└─────────────────────────────────────────┘
```

## Feature Specifications

### 1. Meeting Detection & Recording

#### Auto-Detection
- **Behaviour**: Always monitor for meeting starts across all supported platforms
- **Supported Platforms**: Zoom, Google Meet, Microsoft Teams, Slack Huddles (limited)
- **Detection Flow**:
  1. SDK detects meeting start
  2. App attempts to match with existing meeting in database
  3. Shows macOS notification with detected meeting info
  4. User can confirm or select different meeting
  5. Recording starts upon confirmation

#### Notification Specification
```typescript
interface MeetingNotification {
  title: "Meeting Detected"
  body: string // e.g., "Zoom Meeting: Weekly Standup"
  actions: [
    { title: "Start Recording", action: "confirm" },
    { title: "Select Different Meeting", action: "select" },
    { title: "Dismiss", action: "dismiss" }
  ]
  showsMeetingTitle: boolean // Display matched/detected meeting
}
```

### 2. Data Management

#### Storage Structure
```
~/Documents/MeetingRecordings/ (configurable)
├── 2025-01-15_weekly-standup.md
├── 2025-01-15_client-call-acme.md
├── 2025-01-16_1on1-sarah.md
└── ...
```

#### Meeting File Format (Markdown)
```markdown
---
title: Weekly Standup
date: 2025-01-15T10:00:00Z
attendees: [John Doe, Jane Smith]
duration: 30
recall_recording_id: abc123
recall_video_url: https://recall.ai/recordings/abc123
recall_audio_url: https://recall.ai/audio/abc123
calendar_event_id: google_event_xyz
status: completed
---

# Meeting Notes

## Pre-meeting Prep
- Review last week's action items
- Prepare update on Project X

## Meeting Notes
- Sarah mentioned the deadline shift
- **Action**: Follow up with design team by Friday

---

# Transcript

[10:00:00] John Doe: Good morning everyone, let's get started...
[10:00:15] Jane Smith: Thanks John, I'll start with my update...
[10:02:30] Sarah Chen: Quick question about the timeline...
```

### 3. User Interface

#### Main Window Components

##### Home View
- **Tab Navigation**: "Upcoming" | "Past"
- **Meeting List Items** display:
  - Meeting title
  - Date/time
  - Duration (for past meetings)
  - Status indicators:
    - 📝 Has notes
    - 🎙️ Has transcript
    - 🔴 Currently recording
    - ⚠️ Partial/Error state
- **Actions**:
  - Click to open meeting detail
  - "+" button to manually create meeting

##### Meeting Detail View
- **Split view layout**:
  - Left: Notes editor (markdown with live preview)
  - Right: Transcript viewer (read-only, auto-scrolls during live recording)
- **Header** shows:
  - Meeting title (editable)
  - Date/time
  - Recording status
  - Link to recall.ai recording

##### Settings View
- **recall.ai Configuration**:
  - API Key input (password field)
  - API endpoint selection
  - Test connection button
- **Storage Settings**:
  - Local folder path selector
  - "Browse" button to choose folder
- **Google Calendar**:
  - OAuth connect/disconnect button
  - Account display when connected
  - Calendar selection (which calendars to sync)
- **App Preferences**:
  - Start on system boot (checkbox)
  - Notification preferences

### 4. Meeting Management Flow

#### Pre-Meeting
1. **Calendar Sync**: App fetches upcoming meetings from Google Calendar
2. **Manual Creation**: User can create meeting entries manually
3. **Pre-meeting Notes**: User can add prep notes before meeting starts
4. **Meeting Matching**: When meeting detected, app suggests best match from upcoming meetings

#### During Meeting
1. **Recording Start**: Upon user confirmation via notification
2. **Live Transcription**: Transcript appears in real-time (if supported by recall.ai)
3. **Note Taking**: User can add/edit notes alongside transcript
4. **Auto-save**: Notes saved every 10 seconds
5. **Status Display**: Visual indicator showing "Recording in progress"

#### Post-Meeting
1. **Recording Stop**: Automatic when meeting ends
2. **Upload Completion**: Final transcript uploaded to recall.ai
3. **File Update**: Local markdown file updated with final transcript
4. **Continued Editing**: User can add post-meeting notes anytime

### 5. Resilience & Error Handling

#### Connection Resilience
- **Partial Save**: Transcript chunks saved locally every 30 seconds
- **Connection Loss Handling**:
  - Continue recording locally
  - Display warning banner: "Connection lost - recording locally"
  - Auto-retry upload every 30 seconds
  - Merge local and remote data when reconnected
  
#### Error States & User Feedback
- **API Quota Exceeded**: Show alert with clear message and remaining quota
- **Service Outage**: Display banner with "recall.ai service unavailable"
- **Permission Errors**: Guide user through macOS permission settings
- **Recording Failures**: Mark meeting as "partial" with explanation

#### Recovery Mechanisms
- **Automatic Retry**: Failed uploads retry with exponential backoff
- **Manual Recovery**: Not needed - all retries automatic
- **Data Integrity**: Never lose data - always save locally first

### 6. Technical Implementation Details

#### Core Dependencies
```json
{
  "dependencies": {
    "@recallai/desktop-sdk": "latest",
    "electron": "^28.0.0",
    "react": "^18.2.0",
    "typescript": "^5.3.0",
    "@emotion/react": "^11.11.0",
    "googleapis": "^128.0.0",
    "electron-store": "^8.1.0",
    "gray-matter": "^4.0.3",
    "remark": "^15.0.0"
  }
}
```

#### Key Services

##### MeetingDetectionService
```typescript
class MeetingDetectionService {
  - initializeSDK(apiKey: string)
  - startMonitoring()
  - handleMeetingDetected(event: MeetingEvent)
  - matchWithCalendarEvent(meetingInfo: MeetingInfo): Meeting | null
  - showNotification(meeting: Meeting)
}
```

##### RecordingService
```typescript
class RecordingService {
  - startRecording(meeting: Meeting, uploadToken: string)
  - stopRecording()
  - handleTranscriptChunk(chunk: TranscriptChunk)
  - handleConnectionLoss()
  - retryUpload()
  - saveLocalBackup(transcript: Transcript)
}
```

##### StorageService
```typescript
class StorageService {
  - saveMeeting(meeting: Meeting): void
  - loadMeeting(id: string): Meeting
  - updateTranscript(id: string, transcript: string)
  - updateNotes(id: string, notes: string)
  - getStoragePath(): string
  - setStoragePath(path: string)
}
```

##### CalendarService
```typescript
class CalendarService {
  - authenticate(): Promise<void>
  - fetchUpcomingMeetings(): Promise<CalendarEvent[]>
  - syncMeetings(): void
  - matchMeetingToEvent(meetingInfo: MeetingInfo): CalendarEvent | null
}
```

### 7. Security & Privacy

#### Data Security
- **API Keys**: Stored in electron-store (encrypted)
- **OAuth Tokens**: Secure storage with refresh token rotation
- **Local Files**: Standard filesystem permissions
- **No Analytics**: No tracking or telemetry

#### Permissions Required
- **Screen Recording**: For meeting detection
- **Microphone**: For audio capture
- **Accessibility**: For window detection
- **Calendar Access**: Via OAuth consent

### 8. Deployment

#### Build & Distribution
- **Build Process**: 
  ```bash
  npm run build
  npm run dist  # Creates .dmg
  ```
- **Distribution**: DMG file for manual installation
- **Auto-start**: Register as login item on first launch
- **No Code Signing**: Personal use only (may show security warning)

### 9. Future Considerations (Not in MVP)

These features are explicitly NOT included but noted for potential future development:
- Search across all transcripts
- Tags/categories for meetings
- Keyboard shortcuts
- Export to other formats (PDF, etc.)
- Multiple calendar sources
- Team/shared meeting support
- Mobile companion app
- AI-powered meeting summaries
- Integration with other tools (Notion, Slack, etc.)

## Success Criteria

The application will be considered successful when it:
1. ✅ Reliably detects and records all meeting types
2. ✅ Never loses transcript data (local backup always works)
3. ✅ Provides seamless note-taking experience
4. ✅ Correctly matches meetings with calendar events
5. ✅ Handles connection issues gracefully
6. ✅ Maintains single source of truth (one markdown file per meeting)
7. ✅ Starts automatically and runs invisibly until needed
8. ✅ Integrates naturally into daily workflow

## Project Timeline Estimate

**Phase 1: Core Setup (Week 1)**
- Electron app scaffolding
- Basic UI with native macOS styling
- recall.ai SDK integration

**Phase 2: Meeting Management (Week 2)**
- Calendar integration
- Meeting detection and matching
- Notification system

**Phase 3: Recording & Storage (Week 3)**
- Recording workflow
- Markdown file management
- Transcript handling

**Phase 4: Resilience & Polish (Week 4)**
- Error handling
- Connection resilience
- Settings UI
- Testing & debugging

**Total Estimate**: 4 weeks for MVP