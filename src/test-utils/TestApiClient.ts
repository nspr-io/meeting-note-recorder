/**
 * Test utilities for API testing
 * Provides common patterns and mock data for testing the meeting recorder
 */

export interface TestApiConfig {
  apiKey?: string;
  apiUrl?: string;
  timeout?: number;
}

export class TestApiClient {
  private config: TestApiConfig;

  constructor(config: TestApiConfig = {}) {
    this.config = {
      apiKey: config.apiKey || 'test-api-key',
      apiUrl: config.apiUrl || 'https://us-west-2.recall.ai',
      timeout: config.timeout || 5000
    };
  }

  /**
   * Make a test API request with automatic error handling
   */
  async request(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<{ ok: boolean; data?: any; error?: string }> {
    try {
      const response = await fetch(`${this.config.apiUrl}${endpoint}`, {
        ...options,
        headers: {
          'Authorization': `Token ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          ...options.headers
        }
      });

      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }

      return {
        ok: response.ok,
        data,
        error: response.ok ? undefined : `${response.status}: ${text}`
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Test SDK upload creation
   */
  async testSdkUpload(title: string = 'Test Meeting', provider?: any) {
    const body: any = { meeting_title: title };
    if (provider) {
      body.recording_config = { transcript: { provider } };
    }

    return this.request('/api/v1/sdk-upload/', {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }

  /**
   * Test listing uploads
   */
  async testListUploads() {
    return this.request('/api/v1/sdk-upload/');
  }
}

/**
 * Mock data builders for tests
 */
export class TestDataBuilder {
  static createMockMeeting(overrides = {}) {
    return {
      id: `test-meeting-${Date.now()}`,
      title: 'Test Meeting',
      date: new Date(),
      attendees: ['Test User'],
      status: 'scheduled' as const,
      notes: '',
      transcript: '',
      platform: 'zoom' as const,
      ...overrides
    };
  }

  static createMockUploadResponse(overrides = {}) {
    return {
      id: `upload-${Date.now()}`,
      upload_token: 'test-upload-token',
      status: 'pending',
      ...overrides
    };
  }

  static createMockTranscriptChunk(overrides = {}) {
    return {
      timestamp: new Date(),
      speaker: 'Test Speaker',
      text: 'This is a test transcript chunk.',
      ...overrides
    };
  }

  static createMockSDKEvent(eventName: string, data = {}) {
    return {
      event: eventName,
      window: {
        id: 'test-window-id',
        platform: 'zoom',
        title: 'Test Meeting'
      },
      ...data
    };
  }
}

/**
 * Common test assertions
 */
export class TestAssertions {
  /**
   * Assert API response is successful
   */
  static assertApiSuccess(result: { ok: boolean; data?: any; error?: string }, message?: string) {
    if (!result.ok) {
      throw new Error(
        `API call failed${message ? `: ${message}` : ''}\nError: ${result.error}`
      );
    }
  }

  /**
   * Assert upload was created successfully
   */
  static assertUploadCreated(data: any) {
    if (!data.id || !data.upload_token) {
      throw new Error(
        `Invalid upload response. Missing id or upload_token.\nReceived: ${JSON.stringify(data)}`
      );
    }
  }

  /**
   * Assert meeting has required fields
   */
  static assertValidMeeting(meeting: any) {
    const requiredFields = ['id', 'title', 'date', 'status'];
    const missingFields = requiredFields.filter(field => !meeting[field]);

    if (missingFields.length > 0) {
      throw new Error(
        `Invalid meeting object. Missing fields: ${missingFields.join(', ')}`
      );
    }
  }
}

/**
 * Test runner utility
 */
export class TestRunner {
  private client: TestApiClient;
  private results: Array<{ test: string; passed: boolean; error?: string }> = [];

  constructor(config?: TestApiConfig) {
    this.client = new TestApiClient(config);
  }

  /**
   * Run a single test
   */
  async runTest(testName: string, testFn: () => Promise<void>) {
    console.log(`\nRunning: ${testName}...`);
    try {
      await testFn();
      console.log(`✅ PASSED: ${testName}`);
      this.results.push({ test: testName, passed: true });
    } catch (error: any) {
      console.log(`❌ FAILED: ${testName}`);
      console.error(`   Error: ${error.message}`);
      this.results.push({ test: testName, passed: false, error: error.message });
    }
  }

  /**
   * Get test results summary
   */
  getSummary() {
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;

    console.log('\n========================================');
    console.log('TEST RESULTS SUMMARY');
    console.log('========================================');
    console.log(`Total: ${this.results.length}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);

    if (failed > 0) {
      console.log('\nFailed tests:');
      this.results
        .filter(r => !r.passed)
        .forEach(r => console.log(`  - ${r.test}: ${r.error}`));
    }

    return { passed, failed, total: this.results.length };
  }

  getClient() {
    return this.client;
  }
}