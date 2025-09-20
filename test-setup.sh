#!/bin/bash

echo "🚀 Meeting Note Recorder - Comprehensive Test Setup"
echo "=================================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to print colored output
print_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[⚠]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

# Navigate to project directory
cd "$(dirname "$0")"

print_step "Installing testing dependencies..."
npm install --save-dev \
    jest@^29.5.0 \
    @types/jest@^29.5.0 \
    ts-jest@^29.1.0 \
    @testing-library/react@^14.0.0 \
    @testing-library/jest-dom@^5.16.5 \
    @testing-library/user-event@^14.4.3 \
    electron-mock-ipc@^0.3.12 \
    sinon@^15.0.0 \
    @types/sinon@^10.0.0 \
    supertest@^6.3.3 \
    @types/supertest@^2.0.12 \
    jest-environment-jsdom@^29.5.0 \
    @babel/preset-env@^7.22.0 \
    @babel/preset-react@^7.22.0 \
    @babel/preset-typescript@^7.22.0 \
    babel-jest@^29.5.0 \
    identity-obj-proxy@^3.0.0 \
    jest-mock-electron@^0.1.3

print_success "Testing dependencies installed"

print_step "Creating Jest configuration..."
cat > jest.config.js << 'EOF'
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.tsx?$',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  projects: [
    {
      displayName: 'main',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/src/main/**/*.test.ts'],
    },
    {
      displayName: 'renderer',
      testEnvironment: 'jsdom',
      testMatch: ['<rootDir>/src/renderer/**/*.test.tsx'],
    },
  ],
};
EOF
print_success "Jest configuration created"

print_step "Creating test setup file..."
mkdir -p tests
cat > tests/setup.ts << 'EOF'
import '@testing-library/jest-dom';

// Mock Electron
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(),
    whenReady: jest.fn(() => Promise.resolve()),
    quit: jest.fn(),
  },
  BrowserWindow: jest.fn(() => ({
    loadURL: jest.fn(),
    on: jest.fn(),
    webContents: {
      send: jest.fn(),
    },
  })),
  ipcMain: {
    handle: jest.fn(),
    on: jest.fn(),
  },
  ipcRenderer: {
    invoke: jest.fn(),
    on: jest.fn(),
    send: jest.fn(),
  },
  dialog: {
    showOpenDialog: jest.fn(),
    showMessageBox: jest.fn(),
  },
  Notification: jest.fn(),
  systemPreferences: {
    getMediaAccessStatus: jest.fn(),
    askForMediaAccess: jest.fn(),
  },
}));

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.RECALL_API_KEY = 'test-api-key';

// Suppress console errors in tests
global.console = {
  ...console,
  error: jest.fn(),
  warn: jest.fn(),
};
EOF
print_success "Test setup file created"

print_step "Creating test data directory..."
mkdir -p tests/fixtures
cat > tests/fixtures/sample-meeting.json << 'EOF'
{
  "id": "test-meeting-001",
  "title": "Test Meeting",
  "startTime": "2025-01-16T14:00:00Z",
  "endTime": "2025-01-16T15:00:00Z",
  "attendees": ["John Doe", "Jane Smith"],
  "platform": "zoom",
  "notes": "Sample meeting notes",
  "transcript": "Sample transcript content",
  "recallRecordingId": "recall-123",
  "status": "completed"
}
EOF
print_success "Test fixtures created"

print_step "Creating test environment file..."
cat > .env.test << 'EOF'
# Test Environment Variables
GOOGLE_CLIENT_ID=test-google-client-id
GOOGLE_CLIENT_SECRET=test-google-client-secret
RECALL_API_KEY=test-recall-api-key
NODE_ENV=test
LOG_LEVEL=debug
STORAGE_PATH=./tests/test-storage
EOF
print_success "Test environment file created"

print_step "Setting up test storage directory..."
mkdir -p tests/test-storage
print_success "Test storage directory created"

echo ""
echo "=================================================="
echo -e "${GREEN}✓ Test environment setup complete!${NC}"
echo ""
echo "Available test commands:"
echo "  npm test           - Run all tests"
echo "  npm run test:unit  - Run unit tests only"
echo "  npm run test:integration - Run integration tests"
echo ""
echo "Next steps:"
echo "1. Run 'chmod +x test-setup.sh' to make this script executable"
echo "2. Run 'npm test' to verify setup"
echo "3. Check coverage reports in './coverage' directory"