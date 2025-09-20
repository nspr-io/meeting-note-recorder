#!/bin/bash

# Meeting Note Recorder - Quick Production Test
# This script tests the real app step by step

set -e

echo "🧪 MEETING NOTE RECORDER - PRODUCTION TEST"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;36m'
NC='\033[0m' # No Color

# Step 1: Check if app is built
echo "1️⃣  Checking if app is built..."
if [ -d "dist-app/mac-arm64/Meeting Note Recorder.app" ]; then
    echo -e "${GREEN}✅ App is built${NC}"
else
    echo -e "${RED}❌ App not found. Run: npm run dist${NC}"
    exit 1
fi

# Step 2: Kill existing instances
echo ""
echo "2️⃣  Stopping any existing instances..."
pkill -f "Meeting Note Recorder" 2>/dev/null || true
sleep 1
echo -e "${GREEN}✅ Cleaned up${NC}"

# Step 3: Start the app
echo ""
echo "3️⃣  Starting Meeting Note Recorder..."
open "dist-app/mac-arm64/Meeting Note Recorder.app"
sleep 3

# Check if running
if pgrep -f "Meeting Note Recorder" > /dev/null; then
    echo -e "${GREEN}✅ App is running!${NC}"
else
    echo -e "${RED}❌ App failed to start${NC}"
    exit 1
fi

# Step 4: Check logs
echo ""
echo "4️⃣  Checking logs for initialization..."
LOG_DIR="$HOME/Documents/MeetingRecordings/logs"
if [ -d "$LOG_DIR" ]; then
    LATEST_LOG=$(ls -t "$LOG_DIR"/*.log 2>/dev/null | head -1)
    if [ -n "$LATEST_LOG" ]; then
        echo "📄 Log file: $LATEST_LOG"
        
        # Check for key events
        if grep -q "Starting meeting detection monitoring" "$LATEST_LOG" 2>/dev/null; then
            echo -e "${GREEN}✅ Meeting detection started${NC}"
        else
            echo -e "${YELLOW}⚠️  Meeting detection may not have started${NC}"
        fi
    fi
else
    echo -e "${YELLOW}⚠️  No log directory found${NC}"
fi

# Step 5: Test window detection
echo ""
echo "5️⃣  Testing window detection..."
osascript -e 'tell application "System Events" to get name of first process' > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Accessibility permissions OK${NC}"
else
    echo -e "${RED}❌ Need accessibility permissions${NC}"
    echo "   Go to: System Preferences > Security & Privacy > Privacy > Accessibility"
    echo "   Add: Meeting Note Recorder"
fi

# Step 6: Manual test instructions
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${BLUE}📋 MANUAL TESTING STEPS${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "TEST A: Manual Recording"
echo "  1. Click the '+' button in the app"
echo "  2. Enter title: 'Test Recording'"
echo "  3. Click 'Start Recording'"
echo "  4. Wait 10 seconds"
echo "  5. Click 'Stop Recording'"
echo "  6. Check ~/Documents/MeetingRecordings/ for the file"
echo ""
echo "TEST B: Automatic Detection"
echo "  1. Start a Zoom meeting"
echo "  2. Wait 3 seconds for notification"
echo "  3. Click 'Start Recording' on the notification"
echo "  4. Let it record for 15 seconds"
echo "  5. Stop the meeting"
echo "  6. Check for saved files"
echo ""

# Step 7: Check for meeting windows right now
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔍 Checking for meeting windows now..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check Zoom
if pgrep -x "zoom.us" > /dev/null; then
    echo -e "${BLUE}Found: Zoom is running${NC}"
    ZOOM_WINDOWS=$(osascript -e 'tell application "System Events" to get name of every window of process "zoom.us"' 2>/dev/null || echo "")
    if [ -n "$ZOOM_WINDOWS" ]; then
        echo "  Windows: $ZOOM_WINDOWS"
    fi
else
    echo "  Zoom: Not running"
fi

# Check for Google Meet in Chrome
if pgrep -x "Google Chrome" > /dev/null; then
    CHROME_WINDOWS=$(osascript -e 'tell application "Google Chrome" to get title of every tab of every window' 2>/dev/null | grep -i "meet" || true)
    if [ -n "$CHROME_WINDOWS" ]; then
        echo -e "${BLUE}Found: Google Meet tab in Chrome${NC}"
    fi
fi

# Check Teams
if pgrep -x "Microsoft Teams" > /dev/null; then
    echo -e "${BLUE}Found: Microsoft Teams is running${NC}"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✨ Test setup complete!${NC}"
echo "The app is running. Now perform the manual tests above."
echo ""
echo "To monitor logs in real-time:"
echo "  tail -f ~/Documents/MeetingRecordings/logs/*.log"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"