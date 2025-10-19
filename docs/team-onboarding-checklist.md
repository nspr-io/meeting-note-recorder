# Team Onboarding Checklist

## 1. Access & Prerequisites
- Confirm access to the private repository and Recall.ai account.
- Request Google OAuth app credentials (client ID/secret) from the owner.
- Install Node.js 20+, npm 10+, and Xcode Command Line Tools locally.

## 2. Local Environment
- Clone the repo and run `npm install`.
- Copy `.env.example` to `.env`; paste only the secrets you were provided.
- Verify `.gitignore` keeps `.env` out of version control before making commits.

## 3. Initial Build & Dev Run
- Run `npm run build` to compile main, preload, and renderer bundles.
- Start the dev environment with `npm run dev` and confirm the Electron window loads upcoming meetings UI.
- Verify macOS prompts for Accessibility, Screen Recording, and Microphone permissions; approve each.

## 4. QA Smoke Pass
- Run `npm run lint` and resolve any new warnings introduced by your changes.
- Execute `npm test` from an interactive terminal; follow prompts to validate manual flows (launch, permissions, manual recording, detection).
- Capture the resulting `test-results.json` and note any warnings remaining (e.g., missing log files on fresh installs).

## 5. Distribution Prep
- Build a DMG with `npm run dist`; confirm output in `dist-app/`.
- Locally ad-hoc sign the `.app`: `sudo codesign --force --deep --sign - /Applications/Meeting\ Note\ Recorder.app`.
- Launch the signed app to ensure permissions persist and calendar sync works with provided credentials.

## 6. Sharing With Teammates
- Provide teammates the DMG plus this checklist.
- Supply individualized `.env` secrets through the secure channel agreed upon (never in git or email).
- Walk through one pairing session to cover calendar sync, Recall.ai verification, and AI coach configuration.
