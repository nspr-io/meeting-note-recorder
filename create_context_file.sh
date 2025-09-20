#!/bin/bash

# Create a comprehensive context file for debugging real-time transcripts issue

OUTPUT_FILE="all_transcript_context.txt"

echo "==================================================================" > $OUTPUT_FILE
echo "PROBLEM CONTEXT FOR REAL-TIME TRANSCRIPTS ISSUE" >> $OUTPUT_FILE
echo "==================================================================" >> $OUTPUT_FILE
echo "" >> $OUTPUT_FILE
echo "PROBLEM: Real-time transcripts are NOT being received during recording." >> $OUTPUT_FILE
echo "The SDK successfully creates uploads, records meetings, but NO 'realtime-event' callbacks" >> $OUTPUT_FILE
echo "are being emitted for transcript data, despite proper configuration." >> $OUTPUT_FILE
echo "" >> $OUTPUT_FILE
echo "EXPECTED: The SDK should emit 'realtime-event' callbacks with transcript.data" >> $OUTPUT_FILE
echo "and transcript.partial_data events during recording." >> $OUTPUT_FILE
echo "" >> $OUTPUT_FILE
echo "CONFIRMED WORKING:" >> $OUTPUT_FILE
echo "- Recording starts and stops successfully" >> $OUTPUT_FILE
echo "- SDK upload is created with transcript provider (Deepgram/AssemblyAI)" >> $OUTPUT_FILE
echo "- realtime_endpoints configuration is accepted by the API" >> $OUTPUT_FILE
echo "- Transcription provider credentials are configured in Recall dashboard" >> $OUTPUT_FILE
echo "- Other SDK events (meeting-detected, recording-started, etc.) work fine" >> $OUTPUT_FILE
echo "" >> $OUTPUT_FILE
echo "WHAT WAS TRIED:" >> $OUTPUT_FILE
echo "- Added comprehensive logging for ANY realtime-event" >> $OUTPUT_FILE
echo "- Verified realtime_endpoints configuration format" >> $OUTPUT_FILE
echo "- Tested with both Deepgram and AssemblyAI providers" >> $OUTPUT_FILE
echo "- Result: ZERO realtime-event callbacks received" >> $OUTPUT_FILE
echo "" >> $OUTPUT_FILE
echo "SDK VERSION: @recallai/desktop-sdk@1.1.0" >> $OUTPUT_FILE
echo "PLATFORM: macOS" >> $OUTPUT_FILE
echo "" >> $OUTPUT_FILE
echo "==================================================================" >> $OUTPUT_FILE
echo "PACKAGE.JSON" >> $OUTPUT_FILE
echo "==================================================================" >> $OUTPUT_FILE
cat package.json >> $OUTPUT_FILE

echo "" >> $OUTPUT_FILE
echo "" >> $OUTPUT_FILE
echo "==================================================================" >> $OUTPUT_FILE
echo "FILE: src/main/services/RecordingService.ts" >> $OUTPUT_FILE
echo "==================================================================" >> $OUTPUT_FILE
cat src/main/services/RecordingService.ts >> $OUTPUT_FILE

echo "" >> $OUTPUT_FILE
echo "" >> $OUTPUT_FILE
echo "==================================================================" >> $OUTPUT_FILE
echo "FILE: src/main/services/RecallApiService.ts" >> $OUTPUT_FILE
echo "==================================================================" >> $OUTPUT_FILE
cat src/main/services/RecallApiService.ts >> $OUTPUT_FILE

echo "" >> $OUTPUT_FILE
echo "" >> $OUTPUT_FILE
echo "==================================================================" >> $OUTPUT_FILE
echo "FILE: src/main/services/MeetingDetectionService.ts" >> $OUTPUT_FILE
echo "==================================================================" >> $OUTPUT_FILE
cat src/main/services/MeetingDetectionService.ts >> $OUTPUT_FILE

echo "" >> $OUTPUT_FILE
echo "" >> $OUTPUT_FILE
echo "==================================================================" >> $OUTPUT_FILE
echo "FILE: src/main/services/SDKDebugger.ts" >> $OUTPUT_FILE
echo "==================================================================" >> $OUTPUT_FILE
cat src/main/services/SDKDebugger.ts >> $OUTPUT_FILE

echo "" >> $OUTPUT_FILE
echo "" >> $OUTPUT_FILE
echo "==================================================================" >> $OUTPUT_FILE
echo "SDK TYPE DEFINITIONS: node_modules/@recallai/desktop-sdk/index.d.ts" >> $OUTPUT_FILE
echo "==================================================================" >> $OUTPUT_FILE
cat node_modules/@recallai/desktop-sdk/index.d.ts >> $OUTPUT_FILE

echo "" >> $OUTPUT_FILE
echo "" >> $OUTPUT_FILE
echo "==================================================================" >> $OUTPUT_FILE
echo "SDK IMPLEMENTATION (first 400 lines): node_modules/@recallai/desktop-sdk/index.js" >> $OUTPUT_FILE
echo "==================================================================" >> $OUTPUT_FILE
head -n 400 node_modules/@recallai/desktop-sdk/index.js >> $OUTPUT_FILE

echo "" >> $OUTPUT_FILE
echo "" >> $OUTPUT_FILE
echo "==================================================================" >> $OUTPUT_FILE
echo "ENVIRONMENT VARIABLES (.env)" >> $OUTPUT_FILE
echo "==================================================================" >> $OUTPUT_FILE
echo "RECALL_API_KEY=<REDACTED>" >> $OUTPUT_FILE
echo "WEBHOOK_URL not set" >> $OUTPUT_FILE
echo "NODE_ENV=development" >> $OUTPUT_FILE

echo "" >> $OUTPUT_FILE
echo "" >> $OUTPUT_FILE
echo "==================================================================" >> $OUTPUT_FILE
echo "SAMPLE LOG OUTPUT SHOWING THE ISSUE" >> $OUTPUT_FILE
echo "==================================================================" >> $OUTPUT_FILE
echo "When recording starts, we see:" >> $OUTPUT_FILE
echo "- [SDK-UPLOAD-SUCCESS-1] Created upload with Deepgram provider" >> $OUTPUT_FILE
echo "- Recording started event received" >> $OUTPUT_FILE
echo "- Media capture status events" >> $OUTPUT_FILE
echo "- Participant capture status events" >> $OUTPUT_FILE
echo "- But NO realtime-event callbacks at all" >> $OUTPUT_FILE
echo "" >> $OUTPUT_FILE
echo "The enhanced logging that should catch ANY realtime event:" >> $OUTPUT_FILE
echo "RecallAiSdk.addEventListener('realtime-event', async (event: any) => {" >> $OUTPUT_FILE
echo "  logger.info('🎤 Real-time event from SDK', { ... });" >> $OUTPUT_FILE
echo "  console.log('🔴 REALTIME EVENT RECEIVED:', { ... });" >> $OUTPUT_FILE
echo "});" >> $OUTPUT_FILE
echo "" >> $OUTPUT_FILE
echo "Never logs anything - meaning the SDK is not emitting these events." >> $OUTPUT_FILE

echo "" >> $OUTPUT_FILE
echo "File created: $OUTPUT_FILE ($(wc -l < $OUTPUT_FILE) lines)"