// Improved API test using the new test utilities
import { TestRunner, TestAssertions, TestDataBuilder } from './dist/src/test-utils/TestApiClient.js';

const API_KEY = process.env.RECALL_API_KEY || '1332daafebd5965acdf93098d1be5c9a23b2f2dc';
const API_URL = process.env.RECALL_API_URL || 'https://us-west-2.recall.ai';

async function runTests() {
  const runner = new TestRunner({ apiKey: API_KEY, apiUrl: API_URL });
  const client = runner.getClient();

  // Test 1: Create SDK upload without transcript provider
  await runner.runTest('Create SDK upload (no provider)', async () => {
    const result = await client.testSdkUpload('Test Meeting - No Provider');
    TestAssertions.assertApiSuccess(result);
    TestAssertions.assertUploadCreated(result.data);
  });

  // Test 2: Create SDK upload with Deepgram provider
  await runner.runTest('Create SDK upload (Deepgram)', async () => {
    const result = await client.testSdkUpload('Test Meeting - Deepgram', {
      deepgram_streaming: {
        model: "nova-2",
        language: "en-US",
        smart_format: true,
        punctuate: true,
        profanity_filter: false,
        diarize: true
      }
    });
    TestAssertions.assertApiSuccess(result, 'Deepgram provider should work');
  });

  // Test 3: Create SDK upload with AssemblyAI provider
  await runner.runTest('Create SDK upload (AssemblyAI)', async () => {
    const result = await client.testSdkUpload('Test Meeting - AssemblyAI', {
      assembly_ai_streaming: {
        word_boost: [],
        boost_param: "default"
      }
    });
    TestAssertions.assertApiSuccess(result, 'AssemblyAI provider should work');
  });

  // Test 4: List existing uploads
  await runner.runTest('List existing uploads', async () => {
    const result = await client.testListUploads();
    TestAssertions.assertApiSuccess(result);
    console.log(`   Found ${result.data?.results?.length || 0} uploads`);
  });

  // Test 5: Test with mock data
  await runner.runTest('Validate mock meeting structure', async () => {
    const mockMeeting = TestDataBuilder.createMockMeeting({
      title: 'Important Strategy Meeting'
    });
    TestAssertions.assertValidMeeting(mockMeeting);
  });

  // Get summary
  runner.getSummary();
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests().catch(error => {
    console.error('Test suite failed:', error);
    process.exit(1);
  });
}

module.exports = { runTests };