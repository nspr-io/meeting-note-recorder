#!/usr/bin/env node

/**
 * PRODUCTION SYSTEM TEST - Meeting Note Recorder
 * 
 * This test verifies the ACTUAL production app with NO MOCKS
 * It guides you through manual actions and verifies system behavior
 */

const readline = require('readline');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');
const execAsync = util.promisify(exec);

// Configuration
const APP_PATH = path.join(__dirname, 'dist-app/mac-arm64/Meeting Note Recorder.app');
const STORAGE_PATH = path.join(process.env.HOME, 'Documents', 'MeetingRecordings');
const LOG_PATH = path.join(STORAGE_PATH, 'logs');

// Test state
let testResults = {
  passed: [],
  failed: [],
  warnings: []
};

// Terminal interface
const isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

const rl = isInteractive
  ? readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })
  : null;

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  red: '\x1b[31m',
  magenta: '\x1b[35m'
};

// Logging functions with timestamps and context
function log(message, color = colors.reset, context = null) {
  const timestamp = new Date().toISOString();
  console.log(`${color}[${timestamp}] ${message}${colors.reset}`);
  if (context) {
    console.log(`${colors.blue}   Context: ${JSON.stringify(context, null, 2)}${colors.reset}`);
  }
  
  // Also write to test log file
  const logFile = path.join(__dirname, 'test-production.log');
  fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`);
  if (context) {
    fs.appendFileSync(logFile, `   Context: ${JSON.stringify(context, null, 2)}\n`);
  }
}

function logSuccess(test, details) {
  log(`✅ ${test}`, colors.green, details);
  testResults.passed.push({ test, details, timestamp: new Date() });
}

function logFailure(test, error, details) {
  log(`❌ ${test}: ${error}`, colors.red, details);
  testResults.failed.push({ test, error, details, timestamp: new Date() });
}

function logWarning(test, warning, details) {
  log(`⚠️  ${test}: ${warning}`, colors.yellow, details);
  testResults.warnings.push({ test, warning, details, timestamp: new Date() });
}

function prompt(question, defaultAnswer = '') {
  if (!rl) {
    log(`Skipping prompt (non-interactive): ${question}`, colors.yellow);
    return Promise.resolve(defaultAnswer);
  }

  return new Promise(resolve => {
    rl.question(colors.blue + question + colors.reset + '\n> ', answer => {
      log(`User response: ${answer}`, colors.magenta);
      resolve(answer);
    });
  });
}

async function waitForUser(message = 'Press Enter to continue...') {
  await prompt(message);
}

// App control functions
async function isAppRunning() {
  try {
    const { stdout } = await execAsync('pgrep -f "Meeting Note Recorder"');
    const pids = stdout.trim().split('\n').filter(Boolean);
    return pids.length > 0 ? pids : false;
  } catch (e) {
    return false;
  }
}

async function killApp() {
  log('Killing any existing app instances...');
  try {
    await execAsync('pkill -f "Meeting Note Recorder"');
    await new Promise(resolve => setTimeout(resolve, 2000));
    logSuccess('App killed');
  } catch (e) {
    log('No app instances to kill');
  }
}

async function startApp() {
  log('Starting Meeting Note Recorder...', colors.bright);
  
  // Ensure app exists
  if (!fs.existsSync(APP_PATH)) {
    logFailure('App not found', 'Build the app first with: npm run dist', { path: APP_PATH });
    return false;
  }
  
  // Start the app
  const startTime = Date.now();
  spawn('open', [APP_PATH]);
  
  // Wait and verify startup
  let attempts = 0;
  while (attempts < 10) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const pids = await isAppRunning();
    if (pids) {
      const startupTime = Date.now() - startTime;
      logSuccess('App started', { pids, startupTimeMs: startupTime });
      return true;
    }
    attempts++;
  }
  
  logFailure('App startup', 'Failed to start within 10 seconds');
  return false;
}

// Log monitoring functions
async function getLatestLogFile() {
  const possiblePaths = [
    LOG_PATH,
    path.join(process.env.TMPDIR, 'meeting-recorder', 'logs'),
    '/var/folders/g1/fpr63r6j06x0k813kk8ydbch0000gn/T/meeting-recorder-test/logs'
  ];
  
  for (const logDir of possiblePaths) {
    if (fs.existsSync(logDir)) {
      const files = fs.readdirSync(logDir)
        .filter(f => f.endsWith('.log'))
        .sort((a, b) => {
          const statA = fs.statSync(path.join(logDir, a));
          const statB = fs.statSync(path.join(logDir, b));
          return statB.mtime - statA.mtime;
        });
      
      if (files.length > 0) {
        const logPath = path.join(logDir, files[0]);
        log(`Found log file: ${logPath}`, colors.blue);
        return logPath;
      }
    }
  }
  
  logWarning('Log file', 'No log files found', { searchedPaths: possiblePaths });
  return null;
}

async function tailLogFile(logFile, duration = 5000) {
  return new Promise((resolve) => {
    const logs = [];
    const tail = spawn('tail', ['-f', logFile]);
    
    tail.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      lines.forEach(line => {
        logs.push(line);
        if (line.includes('ERROR')) {
          log(`  📝 ERROR: ${line}`, colors.red);
        } else if (line.includes('WARN')) {
          log(`  📝 WARN: ${line}`, colors.yellow);
        } else if (line.includes('Meeting detected') || line.includes('recording-started')) {
          log(`  📝 EVENT: ${line}`, colors.green);
        }
      });
    });
    
    setTimeout(() => {
      tail.kill();
      resolve(logs);
    }, duration);
  });
}

async function checkLogForEvents(events, timeout = 10000) {
  const logFile = await getLatestLogFile();
  if (!logFile) return { found: [], missing: events };
  
  const startTime = Date.now();
  const found = [];
  const missing = [...events];
  
  while (Date.now() - startTime < timeout && missing.length > 0) {
    try {
      const content = fs.readFileSync(logFile, 'utf8');
      
      for (let i = missing.length - 1; i >= 0; i--) {
        if (content.includes(missing[i])) {
          found.push(missing[i]);
          log(`  ✓ Found event: ${missing[i]}`, colors.green);
          missing.splice(i, 1);
        }
      }
    } catch (e) {
      logWarning('Log read', e.message);
    }
    
    if (missing.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  return { found, missing };
}

// Meeting detection functions
async function detectRunningMeetings() {
  log('Detecting running meetings via AppleScript...', colors.blue);
  
  const script = `
    tell application "System Events"
      set meetingApps to {}
      
      -- Check Zoom
      if exists process "zoom.us" then
        repeat with win in windows of process "zoom.us"
          set winName to name of win
          if winName does not contain "Zoom" and winName does not contain "Settings" then
            set end of meetingApps to "Zoom: " & winName
          end if
        end repeat
      end if
      
      -- Check Chrome for Google Meet
      if exists process "Google Chrome" then
        repeat with win in windows of process "Google Chrome"
          set winName to name of win
          if winName contains "Meet" then
            set end of meetingApps to "Google Meet: " & winName
          end if
        end repeat
      end if
      
      -- Check Teams
      if exists process "Microsoft Teams" then
        repeat with win in windows of process "Microsoft Teams"
          set winName to name of win
          if winName contains "Meeting" or winName contains "Call" then
            set end of meetingApps to "Teams: " & winName
          end if
        end repeat
      end if
      
      return meetingApps
    end tell
  `;
  
  try {
    const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`);
    const meetings = stdout.trim().split(', ').filter(Boolean);
    
    if (meetings.length > 0) {
      logSuccess('Meetings detected', { meetings });
      return meetings;
    } else {
      log('No meetings currently running');
      return [];
    }
  } catch (e) {
    logFailure('Meeting detection', e.message, { 
      hint: 'Grant accessibility permissions in System Preferences'
    });
    return [];
  }
}

// File verification functions
async function verifyRecordingFiles(meetingId) {
  const files = {
    markdown: null,
    audio: null,
    transcript: null
  };
  
  // Check for markdown file
  if (fs.existsSync(STORAGE_PATH)) {
    const mdFiles = fs.readdirSync(STORAGE_PATH)
      .filter(f => f.endsWith('.md'))
      .filter(f => !meetingId || f.includes(meetingId));
    
    if (mdFiles.length > 0) {
      files.markdown = path.join(STORAGE_PATH, mdFiles[0]);
      const content = fs.readFileSync(files.markdown, 'utf8');
      log(`  📝 Markdown file: ${mdFiles[0]}`, colors.green);
      log(`     Length: ${content.length} chars`);
      
      // Check for transcript in markdown
      if (content.includes('## Transcript')) {
        files.transcript = 'embedded';
        log(`  📝 Transcript found in markdown`, colors.green);
      }
    }
  }
  
  // Check for audio recording
  const recordingsPath = path.join(STORAGE_PATH, 'recordings');
  if (fs.existsSync(recordingsPath)) {
    const audioFiles = fs.readdirSync(recordingsPath)
      .filter(f => f.endsWith('.wav') || f.endsWith('.m4a') || f.endsWith('.webm'));
    
    if (audioFiles.length > 0) {
      files.audio = path.join(recordingsPath, audioFiles[0]);
      const stats = fs.statSync(files.audio);
      log(`  🎵 Audio file: ${audioFiles[0]}`, colors.green);
      log(`     Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    }
  }
  
  return files;
}

// Test scenarios
async function testAppLaunch() {
  log('\n' + '='.repeat(60), colors.bright);
  log('TEST 1: APP LAUNCH AND INITIALIZATION', colors.bright + colors.blue);
  log('='.repeat(60), colors.bright);
  
  await killApp();
  const started = await startApp();
  
  if (!started) {
    logFailure('App Launch', 'Failed to start application');
    return false;
  }
  
  // Check for initialization in logs
  await new Promise(resolve => setTimeout(resolve, 3000));
  const { found, missing } = await checkLogForEvents([
    'Starting meeting detection monitoring',
    'Window detection service initialized'
  ], 5000);
  
  if (found.length > 0) {
    logSuccess('App initialized', { initialized: found });
  }
  
  if (missing.length > 0) {
    logWarning('Initialization', 'Some services may not have started', { missing });
  }
  
  return true;
}

async function testPermissions() {
  if (!isInteractive) {
    logWarning('System permissions', 'Skipped (non-interactive environment)');
    return true;
  }

  log('\n' + '='.repeat(60), colors.bright);
  log('TEST 2: SYSTEM PERMISSIONS', colors.bright + colors.blue);
  log('='.repeat(60), colors.bright);
  
  log('Checking required permissions...');
  
  // Test accessibility
  try {
    await execAsync('osascript -e \'tell application "System Events" to get name of first process\'');
    logSuccess('Accessibility permission granted');
  } catch (e) {
    logFailure('Accessibility permission', 'Not granted', {
      fix: 'System Preferences > Security & Privacy > Privacy > Accessibility'
    });
  }
  
  // Test microphone (can't easily test programmatically)
  log('⚠️  Microphone permission must be checked manually', colors.yellow);
  const micAnswer = await prompt('Has microphone permission been granted? (yes/no)');
  if (micAnswer.toLowerCase() === 'yes') {
    logSuccess('Microphone permission reported as granted');
  } else {
    logWarning('Microphone permission', 'Not confirmed');
  }
  
  return true;
}

async function testManualRecording() {
  if (!isInteractive) {
    logWarning('Manual recording test', 'Skipped (non-interactive environment)');
    return true;
  }

  log('\n' + '='.repeat(60), colors.bright);
  log('TEST 3: MANUAL RECORDING', colors.bright + colors.blue);
  log('='.repeat(60), colors.bright);
  
  log('Testing manual recording functionality...');
  log('\n📋 Instructions:', colors.yellow);
  log('1. Click the "+" button or "Create Manual Recording" in the app');
  log('2. Enter a title: "Test Manual Recording"');
  log('3. Add some notes: "Testing manual recording feature"');
  log('4. Click "Start Recording"');
  
  await waitForUser('Press Enter AFTER starting the manual recording...');
  
  // Monitor logs for recording start
  const { found } = await checkLogForEvents(['recording-started', 'Recording started'], 5000);
  
  if (found.length > 0) {
    logSuccess('Manual recording started');
    
    log('\n📋 Now please:', colors.yellow);
    log('1. Let it record for at least 10 seconds');
    log('2. Speak some test audio: "This is a test of manual recording"');
    log('3. Click "Stop Recording"');
    
    await waitForUser('Press Enter AFTER stopping the recording...');
    
    // Verify files were created
    const files = await verifyRecordingFiles('Manual');
    
    if (files.markdown) {
      logSuccess('Manual recording saved', files);
    } else {
      logFailure('Manual recording', 'Files not found');
    }
  } else {
    logFailure('Manual recording', 'Recording did not start');
  }
  
  return true;
}

async function testMeetingDetection() {
  if (!isInteractive) {
    logWarning('Meeting detection test', 'Skipped (non-interactive environment)');
    return true;
  }

  log('\n' + '='.repeat(60), colors.bright);
  log('TEST 4: AUTOMATIC MEETING DETECTION', colors.bright + colors.blue);
  log('='.repeat(60), colors.bright);
  
  log('Testing automatic meeting detection...');
  
  // First check if any meetings are already running
  const existingMeetings = await detectRunningMeetings();
  if (existingMeetings.length > 0) {
    log('⚠️  Please close existing meetings first:', colors.yellow);
    existingMeetings.forEach(m => log(`   - ${m}`));
    await waitForUser('Press Enter after closing existing meetings...');
  }
  
  log('\n📋 Instructions:', colors.yellow);
  log('1. Start a Zoom meeting (can be a test meeting)');
  log('2. Join the meeting so the window is visible');
  log('3. The app should detect it within 3 seconds');
  
  await waitForUser('Press Enter AFTER starting and joining a Zoom meeting...');
  
  // Check if meeting is detected by our test
  const meetings = await detectRunningMeetings();
  if (meetings.length === 0) {
    logFailure('Meeting detection', 'No meetings detected by test script', {
      hint: 'Ensure Zoom window is visible and has a meeting title'
    });
    return false;
  }
  
  logSuccess('Meeting detected by test', { meetings });
  
  // Check if app detected it
  log('Monitoring app logs for detection event...');
  const { found, missing } = await checkLogForEvents([
    'Meeting detected',
    'Zoom meeting detected'
  ], 10000);
  
  if (found.length > 0) {
    logSuccess('App detected meeting', { events: found });
    
    // Check for notification
    const notifAnswer = await prompt('Did you see a system notification about the meeting? (yes/no)');
    if (notifAnswer.toLowerCase() === 'yes') {
      logSuccess('Notification displayed');
    } else {
      logWarning('Notification', 'Not seen - check System Preferences > Notifications');
    }
  } else {
    logFailure('App meeting detection', 'Meeting not detected by app', {
      detected_by_test: meetings,
      missing_events: missing
    });
  }
  
  return true;
}

async function testToastRecording() {
  if (!isInteractive) {
    logWarning('Toast recording test', 'Skipped (non-interactive environment)');
    return true;
  }

  log('\n' + '='.repeat(60), colors.bright);
  log('TEST 5: RECORDING VIA TOAST NOTIFICATION', colors.bright + colors.blue);
  log('='.repeat(60), colors.bright);
  
  log('Testing recording triggered by notification...');
  
  const meetings = await detectRunningMeetings();
  if (meetings.length === 0) {
    log('⚠️  No meeting running. Starting this test requires an active meeting.', colors.yellow);
    log('\n📋 Instructions:', colors.yellow);
    log('1. Start a Zoom/Teams/Meet meeting');
    log('2. Wait for the notification');
    
    await waitForUser('Press Enter AFTER starting a meeting...');
  }
  
  log('\n📋 Instructions:', colors.yellow);
  log('1. If you see a notification, click "Start Recording"');
  log('2. If no notification, manually trigger detection by switching to the meeting window');
  log('3. Let it record for at least 15 seconds');
  log('4. Speak some test content: "This is a test of automatic recording"');
  
  await waitForUser('Press Enter AFTER clicking "Start Recording" on the notification...');
  
  // Check if recording started
  const { found } = await checkLogForEvents(['recording-started', 'Recording started for'], 5000);
  
  if (found.length > 0) {
    logSuccess('Recording started via notification');
    
    // Monitor for transcript capture
    log('\nMonitoring for transcript capture (speak now)...', colors.yellow);
    const logFile = await getLatestLogFile();
    if (logFile) {
      const logs = await tailLogFile(logFile, 15000);
      
      const transcriptEvents = logs.filter(l => 
        l.includes('transcript') || 
        l.includes('speech') || 
        l.includes('audio'));
      
      if (transcriptEvents.length > 0) {
        logSuccess('Transcript events detected', { count: transcriptEvents.length });
      } else {
        logWarning('Transcript', 'No transcript events detected');
      }
    }
    
    log('\n📋 Now stop the recording:', colors.yellow);
    log('1. Click "Stop Recording" in the app');
    log('2. Or end the meeting');
    
    await waitForUser('Press Enter AFTER stopping the recording...');
    
    // Verify saved files
    const files = await verifyRecordingFiles(null);
    
    if (files.markdown && files.audio) {
      logSuccess('Recording saved successfully', files);
      
      // Check transcript content
      if (files.markdown) {
        const content = fs.readFileSync(files.markdown, 'utf8');
        if (content.includes('## Transcript') && content.length > 500) {
          logSuccess('Transcript captured', { 
            hasTranscript: true,
            contentLength: content.length 
          });
        } else {
          logWarning('Transcript', 'Transcript section empty or missing');
        }
      }
    } else {
      logFailure('Recording save', 'Some files missing', files);
    }
  } else {
    logFailure('Toast recording', 'Recording did not start from notification');
  }
  
  return true;
}

async function testMultipleMeetings() {
  if (!isInteractive) {
    logWarning('Multiple meeting test', 'Skipped (non-interactive environment)');
    return true;
  }

  log('\n' + '='.repeat(60), colors.bright);
  log('TEST 6: MULTIPLE MEETING HANDLING', colors.bright + colors.blue);
  log('='.repeat(60), colors.bright);
  
  log('Testing behavior with multiple meetings...');
  
  const answer = await prompt('Do you want to test multiple meeting handling? (yes/no)');
  if (answer.toLowerCase() !== 'yes') {
    log('Skipping multiple meeting test');
    return true;
  }
  
  log('\n📋 Instructions:', colors.yellow);
  log('1. Start a Zoom meeting');
  log('2. Start recording when notified');
  log('3. Without stopping Zoom, start a Google Meet in Chrome');
  log('4. Observe how the app handles the second meeting');
  
  await waitForUser('Press Enter after completing the test...');
  
  const behavior = await prompt('What happened? (switched/prompted/ignored)');
  log(`Multiple meeting behavior: ${behavior}`, colors.blue);
  
  return true;
}

// Main test runner
async function runProductionTests() {
  log('\n🧪 MEETING NOTE RECORDER - PRODUCTION SYSTEM TEST', colors.bright + colors.green);
  log('=' .repeat(70), colors.bright);
  log('This test verifies the REAL production app with NO MOCKS\n');
  
  // Clear test log
  const logFile = path.join(__dirname, 'test-production.log');
  fs.writeFileSync(logFile, `Test started at ${new Date().toISOString()}\n`);
  
  try {
    // Run all tests
    await testAppLaunch();
    await testPermissions();
    await testManualRecording();
    await testMeetingDetection();
    await testToastRecording();
    await testMultipleMeetings();
    
  } catch (error) {
    logFailure('Test execution', error.message, { stack: error.stack });
  }
  
  // Summary
  log('\n' + '='.repeat(70), colors.bright);
  log('📊 TEST SUMMARY', colors.bright + colors.green);
  log('='.repeat(70), colors.bright);
  
  log(`\n✅ Passed: ${testResults.passed.length}`, colors.green);
  testResults.passed.forEach(t => log(`   • ${t.test}`));
  
  if (testResults.warnings.length > 0) {
    log(`\n⚠️  Warnings: ${testResults.warnings.length}`, colors.yellow);
    testResults.warnings.forEach(t => log(`   • ${t.test}: ${t.warning}`));
  }
  
  if (testResults.failed.length > 0) {
    log(`\n❌ Failed: ${testResults.failed.length}`, colors.red);
    testResults.failed.forEach(t => log(`   • ${t.test}: ${t.error}`));
  }
  
  // Debugging info
  log('\n' + '='.repeat(70), colors.bright);
  log('🔍 DEBUGGING INFORMATION', colors.bright + colors.blue);
  log('='.repeat(70), colors.bright);
  
  const logPath = await getLatestLogFile();
  log(`App logs: ${logPath || 'Not found'}`);
  log(`Test logs: ${logFile}`);
  log(`Storage path: ${STORAGE_PATH}`);
  log(`App path: ${APP_PATH}`);
  
  if (testResults.failed.length > 0) {
    log('\n💡 TROUBLESHOOTING TIPS:', colors.yellow);
    log('1. Check app logs for detailed error messages');
    log('2. Verify all permissions are granted in System Preferences');
    log('3. Ensure the app is properly built: npm run dist');
    log('4. Check that all dependencies are installed');
    log('5. Try running the app manually and checking console output');
  }
  
  log('\n✨ Production test complete!', colors.green);
  
  // Save detailed results
  const resultsFile = path.join(__dirname, 'test-results.json');
  fs.writeFileSync(resultsFile, JSON.stringify(testResults, null, 2));
  log(`\nDetailed results saved to: ${resultsFile}`);
  
  rl?.close();
  process.exit(testResults.failed.length > 0 ? 1 : 0);
}

// Handle errors
process.on('uncaughtException', (error) => {
  logFailure('Uncaught exception', error.message, { stack: error.stack });
  rl?.close();
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logFailure('Unhandled rejection', reason, { promise });
  rl?.close();
  process.exit(1);
});

// Run tests
runProductionTests().catch(error => {
  logFailure('Test runner', error.message, { stack: error.stack });
  rl?.close();
  process.exit(1);
});