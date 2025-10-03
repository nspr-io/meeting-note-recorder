# Installation Instructions

## macOS Installation

### Quick Install (Recommended)

1. Open the DMG file
2. Drag "Meeting Note Recorder" to Applications folder
3. Open Terminal and run:
   ```bash
   sudo codesign --force --deep --sign - /Applications/Meeting\ Note\ Recorder.app
   ```
4. Launch the app from Applications

> **Why this step?** The app requires accessibility permissions to detect meetings. Ad-hoc code signing ensures macOS remembers your permission grants across app launches.

### What Happens Next

On first launch, you'll be asked to grant:
- **Accessibility** - Required to detect meeting windows
- **Screen Recording** - Required to record meeting video
- **Microphone** - Required to record meeting audio

Grant these permissions once, and they'll be remembered.

### Troubleshooting

**If you still see permission dialogs every time:**

1. Remove the app from System Settings > Privacy & Security > Accessibility
2. Run the signing command again:
   ```bash
   sudo codesign --force --deep --sign - /Applications/Meeting\ Note\ Recorder.app
   ```
3. Launch the app and grant permissions again

**If the signing command fails:**

Make sure you have Xcode Command Line Tools installed:
```bash
xcode-select --install
```

### Technical Details

The RecallAI SDK used by this app monitors windows to detect Zoom, Google Meet, and Teams meetings. This requires accessibility permissions. macOS identifies apps by their code signature, so unsigned apps appear as "new" on every launch, causing repeated permission requests. Ad-hoc signing gives the app a consistent identity without requiring an Apple Developer certificate.
