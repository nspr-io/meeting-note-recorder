#!/bin/bash

echo "Meeting Note Recorder - Real Testing Script"
echo "==========================================="
echo ""
echo "This script will test the actual meeting detection with a real Zoom meeting."
echo ""

# Kill any existing instances
pkill -f "Meeting Note Recorder"
sleep 1

# Start the app
echo "Starting Meeting Note Recorder app..."
open "/Users/joshuawohle/Documents/Workspace/Core/Tools/meeting-note-recorder/dist-app/mac-arm64/Meeting Note Recorder.app"
sleep 3

# Check if app is running
if pgrep -f "Meeting Note Recorder" > /dev/null; then
    echo "✅ App started successfully"
else
    echo "❌ App failed to start"
    exit 1
fi

# Check logs
LOG_DIR="/var/folders/g1/fpr63r6j06x0k813kk8ydbch0000gn/T/meeting-recorder-test/logs"
echo ""
echo "Checking logs..."
if [ -d "$LOG_DIR" ]; then
    LATEST_LOG=$(ls -t "$LOG_DIR"/*.log 2>/dev/null | head -1)
    if [ -n "$LATEST_LOG" ]; then
        echo "📝 Latest log: $LATEST_LOG"
        echo "Last 20 lines:"
        tail -20 "$LATEST_LOG"
    fi
fi

echo ""
echo "========================================="
echo "TEST INSTRUCTIONS:"
echo "1. The Meeting Note Recorder app should now be running"
echo "2. Start a Zoom meeting"
echo "3. You should see a system notification when the meeting is detected"
echo "4. Click 'Start Recording' in the notification"
echo "5. The app will start recording audio locally"
echo "6. End the meeting and check the recordings folder"
echo ""
echo "Recording location: ~/Documents/MeetingRecordings/"
echo ""
echo "To check if meeting detection is working, watch the logs:"
echo "tail -f '$LATEST_LOG' | grep -E 'Meeting|Window|detected'"
echo ""
echo "========================================="