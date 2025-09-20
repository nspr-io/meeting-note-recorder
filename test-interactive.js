#!/usr/bin/env node

/**
 * Interactive Production Test for Meeting Note Recorder
 * This guides you through testing the REAL app with REAL meetings
 */

const readline = require('readline');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');
const execAsync = util.promisify(exec);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const APP_PATH = path.join(__dirname, 'dist-app/mac-arm64/Meeting Note Recorder.app');
const STORAGE_PATH = path.join(process.env.HOME, 'Documents', 'MeetingRecordings');

// Colors for terminal
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  red: '\x1b[31m'
};

function log(message, color = colors.reset) {
  console.log(color + message + colors.reset);
}

function prompt(question) {
  return new Promise(resolve => {
    rl.question(colors.blue + question + colors.reset + '\n> ', resolve);
  });
}

async function waitForUser(message = 'Press Enter to continue...') {
  await prompt(message);
}

async function checkAppRunning() {
  try {
    const { stdout } = await execAsync('pgrep -f "Meeting Note Recorder"');
    return stdout.trim() !== '';
  } catch (e) {
    return false;
  }
}

async function getLatestLog() {
  const logDir = path.join(process.env.HOME, 'Documents', 'MeetingRecordings', 'logs');
  if (!fs.existsSync(logDir)) {
    // Try temp directory
    const tempLogDir = '/var/folders/g1/fpr63r6j06x0k813kk8ydbch0000gn/T/meeting-recorder-test/logs';
    if (fs.existsSync(tempLogDir)) {
      const files = fs.readdirSync(tempLogDir).filter(f => f.endsWith('.log')).sort();
      if (files.length > 0) {
        return path.join(tempLogDir, files[files.length - 1]);
      }
    }
    return null;
  }
  
  const files = fs.readdirSync(logDir).filter(f => f.endsWith('.log')).sort();
  return files.length > 0 ? path.join(logDir, files[files.length - 1]) : null;
}

async function checkLogForEvent(event, timeout = 10000) {
  const logFile = await getLatestLog();
  if (!logFile) return false;
  
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    try {
      const content = fs.readFileSync(logFile, 'utf8');
      if (content.includes(event)) {
        return true;
      }
    } catch (e) {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

async function startTest() {
  log('\n🧪 INTERACTIVE PRODUCTION TEST - Meeting Note Recorder', colors.bright);
  log('=' .repeat(60));
  log('This test will guide you through testing the REAL app with REAL meetings\n');

  // Test 1: App Launch
  log('\n📱 TEST 1: APP LAUNCH', colors.bright + colors.green);
  log('-'.repeat(40));
  
  const isRunning = await checkAppRunning();
  if (isRunning) {
    log('App is already running. Killing it first...', colors.yellow);
    await execAsync('pkill -f "Meeting Note Recorder"');
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  log('Starting Meeting Note Recorder...');
  spawn('open', [APP_PATH]);
  
  log('\n⏳ Waiting for app to start...');
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  if (await checkAppRunning()) {
    log('✅ App started successfully!', colors.green);
  } else {
    log('❌ App failed to start', colors.red);
    log('Please check if the app is built: npm run dist');
    process.exit(1);
  }

  await waitForUser();

  // Test 2: Permission Check
  log('\n🔐 TEST 2: PERMISSIONS', colors.bright + colors.green);
  log('-'.repeat(40));
  log('The app needs these permissions:');
  log('  • Accessibility (for window detection)');
  log('  • Microphone (for audio recording)');
  log('  • Screen Recording (optional, for video)');
  
  const permissionAnswer = await prompt('Have you granted these permissions? (yes/no)');
  if (permissionAnswer.toLowerCase() !== 'yes') {
    log('\n📝 To grant permissions:', colors.yellow);
    log('1. Open System Preferences > Security & Privacy > Privacy');
    log('2. Click the lock to make changes');
    log('3. Add Meeting Note Recorder to:');
    log('   - Accessibility');
    log('   - Microphone');
    log('4. Restart the app after granting permissions');
    await waitForUser('Grant permissions, then press Enter...');
  }

  // Test 3: Meeting Detection Service
  log('\n🔍 TEST 3: MEETING DETECTION SERVICE', colors.bright + colors.green);
  log('-'.repeat(40));
  log('Checking if meeting detection started...');
  
  const logFile = await getLatestLog();
  if (logFile) {
    log(`📄 Log file: ${logFile}`);
    const detectionStarted = await checkLogForEvent('Starting meeting detection monitoring', 5000);
    if (detectionStarted) {
      log('✅ Meeting detection service is running!', colors.green);
    } else {
      log('⚠️  Meeting detection may not have started', colors.yellow);
      log('Check the log file for errors');
    }
  } else {
    log('⚠️  Could not find log file', colors.yellow);
  }

  await waitForUser();

  // Test 4: Zoom Detection
  log('\n🎥 TEST 4: ZOOM MEETING DETECTION', colors.bright + colors.green);
  log('-'.repeat(40));
  log('Now we\'ll test if the app detects a Zoom meeting.\n');
  log('📋 Instructions:');
  log('1. Start a Zoom meeting (can be a test meeting)');
  log('2. Make sure the Zoom window is visible');
  log('3. Wait up to 3 seconds for detection');
  
  await waitForUser('Press Enter AFTER you\'ve started a Zoom meeting...');
  
  log('\n⏳ Monitoring for meeting detection (10 seconds)...');
  
  // Start monitoring logs
  let meetingDetected = false;
  const startTime = Date.now();
  
  while (Date.now() - startTime < 10000 && !meetingDetected) {
    meetingDetected = await checkLogForEvent('Meeting detected:', 1000);
    if (!meetingDetected) {
      process.stdout.write('.');
    }
  }
  
  console.log(''); // New line
  
  if (meetingDetected) {
    log('✅ Meeting detected!', colors.green);
    log('You should see a system notification', colors.yellow);
    
    const sawNotification = await prompt('Did you see a notification? (yes/no)');
    if (sawNotification.toLowerCase() === 'yes') {
      log('✅ Notification system working!', colors.green);
    } else {
      log('⚠️  Notification may be disabled in System Preferences', colors.yellow);
    }
  } else {
    log('❌ Meeting not detected', colors.red);
    log('Possible issues:', colors.yellow);
    log('  • Accessibility permissions not granted');
    log('  • Zoom window not visible');
    log('  • Window title doesn\'t match expected pattern');
    
    // Try to debug
    log('\nAttempting manual window detection...');
    try {
      const { stdout } = await execAsync(`osascript -e 'tell application "System Events" to get name of every window of process "zoom.us"'`);
      log('Zoom windows found: ' + stdout, colors.blue);
    } catch (e) {
      log('Could not detect Zoom windows via AppleScript', colors.yellow);
    }
  }

  await waitForUser();

  // Test 5: Recording
  log('\n🎙️ TEST 5: RECORDING', colors.bright + colors.green);
  log('-'.repeat(40));
  log('Now test the recording functionality.\n');
  log('📋 Instructions:');
  log('1. If you saw a notification, click "Start Recording"');
  log('2. OR in the app, click "Create Manual Recording"');
  log('3. Let it record for at least 10 seconds');
  log('4. Stop the recording');
  
  await waitForUser('Press Enter AFTER starting a recording...');
  
  const recordingStarted = await checkLogForEvent('recording-started', 5000);
  if (recordingStarted) {
    log('✅ Recording started!', colors.green);
    
    await waitForUser('Press Enter AFTER stopping the recording...');
    
    // Check for saved files
    log('\nChecking for saved recordings...');
    if (fs.existsSync(STORAGE_PATH)) {
      const files = fs.readdirSync(STORAGE_PATH);
      const mdFiles = files.filter(f => f.endsWith('.md'));
      
      if (mdFiles.length > 0) {
        log(`✅ Found ${mdFiles.length} meeting note files:`, colors.green);
        mdFiles.forEach(f => log(`   📝 ${f}`));
      }
      
      const recordingsPath = path.join(STORAGE_PATH, 'recordings');
      if (fs.existsSync(recordingsPath)) {
        const recordings = fs.readdirSync(recordingsPath);
        if (recordings.length > 0) {
          log(`✅ Found ${recordings.length} audio recordings:`, colors.green);
          recordings.forEach(f => log(`   🎵 ${f}`));
        }
      }
    }
  } else {
    log('⚠️  Recording may not have started', colors.yellow);
  }

  // Test 6: Other meeting platforms
  log('\n🌐 TEST 6: OTHER PLATFORMS (Optional)', colors.bright + colors.green);
  log('-'.repeat(40));
  log('The app also supports:');
  log('  • Google Meet (in Chrome)');
  log('  • Microsoft Teams');
  log('  • Slack Huddles');
  
  const testOthers = await prompt('Do you want to test other platforms? (yes/no)');
  if (testOthers.toLowerCase() === 'yes') {
    log('\n📋 Instructions:');
    log('1. Start a meeting in one of these platforms');
    log('2. Watch for the notification');
    log('3. The app should detect it within 3 seconds');
    
    await waitForUser('Press Enter AFTER starting the meeting...');
    
    const otherDetected = await checkLogForEvent('Meeting detected:', 10000);
    if (otherDetected) {
      log('✅ Meeting detected!', colors.green);
    } else {
      log('⚠️  Meeting not detected - check window title patterns', colors.yellow);
    }
  }

  // Summary
  log('\n📊 TEST SUMMARY', colors.bright + colors.green);
  log('=' .repeat(60));
  
  const results = {
    'App Launch': '✅',
    'Permissions': permissionAnswer?.toLowerCase() === 'yes' ? '✅' : '⚠️',
    'Detection Service': detectionStarted ? '✅' : '❌',
    'Zoom Detection': meetingDetected ? '✅' : '❌',
    'Notifications': sawNotification?.toLowerCase() === 'yes' ? '✅' : '⚠️',
    'Recording': recordingStarted ? '✅' : '⚠️'
  };
  
  Object.entries(results).forEach(([test, result]) => {
    log(`${result} ${test}`);
  });
  
  log('\n💡 DEBUGGING TIPS:', colors.yellow);
  log(`• Check logs at: ${logFile || 'Log file not found'}`);
  log(`• Recordings saved to: ${STORAGE_PATH}`);
  log('• For Accessibility permissions issues:');
  log('  System Preferences > Security & Privacy > Privacy > Accessibility');
  log('• For notification issues:');
  log('  System Preferences > Notifications > Meeting Note Recorder');
  
  log('\n✨ Test complete!', colors.green);
  rl.close();
}

// Run the interactive test
startTest().catch(error => {
  log(`\n❌ Test failed: ${error.message}`, colors.red);
  rl.close();
  process.exit(1);
});