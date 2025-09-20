# Meeting Note Recorder - Comprehensive Test Plan

## Test Strategy Overview

This test plan ensures the Meeting Note Recorder app meets all specifications and provides a reliable, user-friendly experience. Testing will cover functional requirements, integration points, resilience scenarios, and user workflows.

## Testing Levels

1. **Unit Tests** - Individual service/component functionality
2. **Integration Tests** - Service interactions and data flow
3. **System Tests** - End-to-end workflows
4. **User Acceptance Tests** - Real-world usage scenarios

## Test Environment Setup

### Prerequisites
- macOS 12.0+ (Monterey or later)
- Node.js 18+
- Valid recall.ai API key
- Google account with calendar access
- Test meetings scheduled in Zoom, Google Meet, and Teams

### Test Data
- Sample markdown files with various content types
- Mock calendar events
- Test recording files
- Network interruption simulation tools

---

## 1. Unit Tests

### 1.1 MeetingDetectionService

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| UD-001 | Initialize SDK with valid API key | SDK initializes successfully | Critical |
| UD-002 | Initialize SDK with invalid API key | Throws authentication error | High |
| UD-003 | Detect Zoom meeting start | Returns meeting metadata | Critical |
| UD-004 | Detect Google Meet start | Returns meeting metadata | Critical |
| UD-005 | Detect Teams meeting start | Returns meeting metadata | Critical |
| UD-006 | Detect Slack Huddle | Returns limited metadata | Medium |
| UD-007 | Match detected meeting to calendar event | Returns matched event or null | High |
| UD-008 | Handle multiple simultaneous meetings | Detects all meetings | Medium |

### 1.2 RecordingService

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| UR-001 | Start recording with valid token | Recording begins, returns recording ID | Critical |
| UR-002 | Stop recording | Recording stops, uploads initiated | Critical |
| UR-003 | Handle transcript chunk | Chunk saved to buffer | Critical |
| UR-004 | Save local backup | File written to disk | Critical |
| UR-005 | Handle connection loss during recording | Continues recording locally | Critical |
| UR-006 | Retry upload after connection restored | Upload resumes automatically | High |
| UR-007 | Handle partial transcript | Marks as partial, saves what's available | High |

### 1.3 StorageService

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| US-001 | Save new meeting | Creates markdown file with correct format | Critical |
| US-002 | Load existing meeting | Returns meeting object | Critical |
| US-003 | Update transcript | Appends to existing file | Critical |
| US-004 | Update notes | Merges with existing notes | Critical |
| US-005 | Set custom storage path | Updates configuration | High |
| US-006 | Handle invalid path | Shows error, keeps previous path | Medium |
| US-007 | Auto-save notes every 10 seconds | File updated without data loss | High |
| US-008 | Handle file permissions error | Shows clear error message | Medium |

### 1.4 CalendarService

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| UC-001 | OAuth authentication flow | Receives access token | Critical |
| UC-002 | Fetch upcoming meetings | Returns event list | Critical |
| UC-003 | Refresh expired token | Auto-refreshes silently | High |
| UC-004 | Match meeting to calendar event | Returns best match | High |
| UC-005 | Handle calendar API errors | Graceful degradation | Medium |
| UC-006 | Sync multiple calendars | Aggregates all events | Low |

### 1.5 NotificationService

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| UN-001 | Show meeting detected notification | Toast appears with actions | Critical |
| UN-002 | Handle "Start Recording" action | Initiates recording | Critical |
| UN-003 | Handle "Select Different Meeting" | Opens meeting selector | High |
| UN-004 | Handle "Dismiss" action | Notification closes | Medium |
| UN-005 | Show error notifications | Displays error clearly | High |
| UN-006 | Queue multiple notifications | Shows sequentially | Low |

---

## 2. Integration Tests

### 2.1 Meeting Detection → Recording Flow

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| IT-001 | Detect meeting → Show notification → Start recording | Full flow completes | Critical |
| IT-002 | Calendar sync → Meeting match → Pre-populate notes | Notes transferred correctly | High |
| IT-003 | Recording → Transcript chunks → Save locally | File updates in real-time | Critical |
| IT-004 | Connection loss → Local save → Reconnect → Upload | No data loss | Critical |
| IT-005 | Multiple meeting detection → User selection → Correct recording | Records to selected meeting | High |

### 2.2 Data Persistence

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| IT-006 | Notes + Transcript → Single markdown file | Correct file structure | Critical |
| IT-007 | Pre-meeting notes → Recording → Post-meeting notes | All content preserved | High |
| IT-008 | Auto-save → App crash → Recovery | No data loss | High |
| IT-009 | Storage path change → Existing meetings accessible | Files migrated or linked | Medium |

### 2.3 UI Component Integration

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| IT-010 | Tab navigation → Meeting list → Detail view | Smooth navigation | High |
| IT-011 | Markdown editor → Live preview | Preview updates instantly | Medium |
| IT-012 | Settings change → App behaviour update | Changes apply immediately | High |
| IT-013 | Meeting list → Status indicators | Correct icons displayed | Medium |

---

## 3. System Tests

### 3.1 End-to-End Workflows

| Test ID | Test Case | Steps | Expected Result | Priority |
|---------|-----------|-------|-----------------|----------|
| ST-001 | Complete meeting workflow | 1. Create pre-meeting notes<br>2. Start Zoom meeting<br>3. Confirm recording<br>4. Take notes during meeting<br>5. End meeting<br>6. Add post-meeting notes | All data saved in single file | Critical |
| ST-002 | Resilient recording | 1. Start recording<br>2. Disconnect internet<br>3. Continue recording<br>4. Reconnect<br>5. Verify upload | Recording complete, no gaps | Critical |
| ST-003 | Manual meeting creation | 1. Click "+" button<br>2. Enter meeting details<br>3. Add notes<br>4. Save meeting | Meeting appears in list | High |
| ST-004 | Calendar integration setup | 1. Open settings<br>2. Connect Google Calendar<br>3. Select calendars<br>4. View synced meetings | Meetings pre-populated | High |
| ST-005 | First-time setup | 1. Install app<br>2. Enter API key<br>3. Set storage location<br>4. Connect calendar<br>5. Grant permissions | App ready to use | Critical |

### 3.2 Performance Tests

| Test ID | Test Case | Acceptance Criteria | Priority |
|---------|-----------|---------------------|----------|
| PT-001 | App launch time | < 3 seconds | High |
| PT-002 | Meeting detection latency | < 2 seconds after meeting start | Critical |
| PT-003 | Note auto-save performance | No UI lag during save | High |
| PT-004 | Large transcript handling | Smooth scrolling with 2+ hour transcript | Medium |
| PT-005 | Memory usage during long recording | < 500MB RAM for 4-hour meeting | Medium |

### 3.3 Resilience Tests

| Test ID | Test Case | Expected Behaviour | Priority |
|---------|-----------|-------------------|----------|
| RT-001 | Network disconnection during recording | Local recording continues | Critical |
| RT-002 | recall.ai service outage | Clear error message, local recording | High |
| RT-003 | API quota exceeded | User notification with quota info | High |
| RT-004 | App crash during recording | Auto-recovery on restart | High |
| RT-005 | Corrupted markdown file | Backup recovery or clear error | Medium |
| RT-006 | Calendar sync failure | Graceful degradation, manual mode | Medium |
| RT-007 | Permission denied (screen/mic) | Clear instructions to fix | High |

---

## 4. User Acceptance Tests

### 4.1 Daily Usage Scenarios

| Test ID | Scenario | Success Criteria |
|---------|----------|------------------|
| UAT-001 | Back-to-back meetings | Correct recording separation, no data mixing |
| UAT-002 | Unexpected meeting | Can quickly start recording without prep |
| UAT-003 | Review yesterday's meetings | Easy navigation, searchable |
| UAT-004 | Prepare for tomorrow | Pre-create meetings with agenda |
| UAT-005 | Share meeting notes | Export/copy markdown easily |

### 4.2 Edge Cases

| Test ID | Scenario | Expected Handling |
|---------|----------|-------------------|
| UAT-006 | Join meeting late | Start recording mid-meeting |
| UAT-007 | Multiple monitors | Detect meeting on any screen |
| UAT-008 | Meeting platform switch | Handle Zoom → Teams transition |
| UAT-009 | Daylight saving time | Correct time handling |
| UAT-010 | Non-English meeting titles | Proper character encoding |

---

## 5. Security & Privacy Tests

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| SP-001 | API key storage | Encrypted in electron-store | Critical |
| SP-002 | OAuth token handling | Secure storage, auto-refresh | Critical |
| SP-003 | Local file permissions | User-only access | High |
| SP-004 | No telemetry verification | No external analytics calls | High |
| SP-005 | Recording consent | Clear user control | Critical |

---

## 6. Accessibility Tests

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| AC-001 | Keyboard navigation | All features accessible | High |
| AC-002 | Screen reader compatibility | Proper ARIA labels | Medium |
| AC-003 | High contrast mode | UI remains usable | Medium |
| AC-004 | Text scaling | Layout adapts properly | Low |

---

## 7. Installation & Configuration Tests

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| IC-001 | DMG installation | Drag-and-drop works | Critical |
| IC-002 | First launch | Setup wizard appears | High |
| IC-003 | Auto-start configuration | Launches on boot | High |
| IC-004 | Permissions request | Clear OS permission dialogs | Critical |
| IC-005 | Uninstall | Clean removal, settings preserved option | Low |

---

## Test Execution Schedule

### Phase 1: Development Testing (Weeks 1-3)
- Unit tests (automated) - Continuous during development
- Integration tests - After each service completion

### Phase 2: System Testing (Week 4)
- Day 1-2: Core workflows
- Day 3: Performance testing
- Day 4: Resilience testing
- Day 5: Security & accessibility

### Phase 3: User Acceptance (Week 4)
- Real meeting recordings
- Daily usage for 3 days
- Edge case validation

---

## Test Automation Strategy

### Automated Tests (Jest + Electron Testing)
- All unit tests
- Core integration tests
- Basic UI component tests

### Manual Tests
- End-to-end workflows
- User acceptance scenarios
- Accessibility verification
- Installation process

### Continuous Integration
```yaml
on: [push, pull_request]
jobs:
  test:
    - npm run test:unit
    - npm run test:integration
    - npm run lint
    - npm run build
```

---

## Success Metrics

### Coverage Requirements
- Unit test coverage: > 80%
- Integration test coverage: > 70%
- All critical tests: PASS

### Quality Gates
- No critical bugs
- All high-priority tests passing
- Performance benchmarks met
- Successful 3-day usage test

### Sign-off Criteria
- [ ] All critical functionality working
- [ ] Resilience mechanisms verified
- [ ] Data integrity confirmed
- [ ] User workflow validated
- [ ] Performance acceptable
- [ ] Security requirements met

---

## Bug Report Template

```markdown
**Bug ID**: BUG-XXX
**Test ID**: [Related test case]
**Severity**: Critical/High/Medium/Low
**Component**: [Affected service/UI]
**Description**: [What happened]
**Expected**: [What should happen]
**Steps to Reproduce**:
1. [Step 1]
2. [Step 2]
**Environment**: macOS version, app version
**Screenshots/Logs**: [Attach if applicable]
```

---

## Risk Mitigation

### High-Risk Areas
1. **recall.ai SDK integration** - Extensive mocking needed
2. **Permission handling** - Test on clean macOS install
3. **Connection resilience** - Network condition simulation
4. **Calendar sync** - Multiple account types testing

### Contingency Plans
- If recall.ai unavailable: Mock server for testing
- If calendar sync fails: Manual meeting creation fallback
- If notifications fail: In-app alerts as backup

This test plan ensures comprehensive validation of all features while focusing on the critical user journey of seamless meeting recording and note-taking.