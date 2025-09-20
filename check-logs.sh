#!/bin/bash

echo "Meeting Recorder Logs"
echo "===================="
echo ""
echo "Latest log file location:"
echo "~/Library/Application Support/meeting-note-recorder/logs/latest.log"
echo ""
echo "To view logs in real-time:"
echo "tail -f ~/Library/Application\\ Support/meeting-note-recorder/logs/latest.log"
echo ""
echo "Recent meeting files:"
ls -lt ~/Documents/MeetingRecordings/*.md 2>/dev/null | head -5
echo ""
echo "To check a specific meeting file:"
echo "cat ~/Documents/MeetingRecordings/[filename].md"