# Meeting Note Recorder

## Overview

Meeting Note Recorder is a macOS Electron application that detects online meetings, records audio/video via the Recall.ai desktop SDK, captures live transcripts, and provides a unified React-based UI for note taking, transcript review, and AI-assisted coaching.

## Prerequisites

- macOS 13+
- Node.js 20+
- npm 10+
- Xcode Command Line Tools (`xcode-select --install`)
- Recall.ai desktop SDK account and API key
- Google Cloud project with OAuth credentials for Calendar API
- (Optional) Anthropic API key for real-time coaching features
- (Optional) Notion integration token + database IDs for automated todo syncing

## Local Setup

1. Clone the repository and install dependencies:
   ```bash
   git clone <repo-url>
   cd meeting-note-recorder
   npm install
   ```
2. Copy `.env.example` to `.env` and populate the secrets you have been granted. Do **not** commit personal keys.
3. Build the desktop app:
   ```bash
   npm run build
   ```
4. Start the development environment:
   ```bash
   npm run dev
   ```
   This launches webpack watchers for main, preload, and renderer bundles and opens Electron pointed at `http://localhost:9000`.

## Distribution Build

- `npm run dist` creates a notarization-ready DMG at `dist-app/` (codesigning must be completed manually by whoever has signing rights).
- After copying the `.app` bundle, teammates need to run `sudo codesign --force --deep --sign - /Applications/Meeting\ Note\ Recorder.app` to preserve accessibility permissions across restarts.

## Testing & QA Flow

- `npm run lint` – TypeScript lint rules across `src/` (currently emits unused-variable warnings; triage before release).
- `npm test` – Runs `test-production.js`. In non-interactive shells it only validates app start/stop; to exercise manual steps run from a terminal with the Electron window visible and follow prompts.
- Additional scripts (`test-interactive.js`, `test-production.js`, etc.) live at repo root for manual workflows.

Recent automated run (2025-10-19) reports only warnings when running non-interactively: missing log file detection and manual tests skipped. Ensure a fully interactive run before sharing release notes.
