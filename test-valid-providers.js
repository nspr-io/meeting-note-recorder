#!/usr/bin/env node

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
require('dotenv').config();

const API_KEY = process.env.RECALL_API_KEY;
const API_URL = 'https://us-west-2.recall.ai';

// Test only the VALID streaming providers from the error message
const providers = [
  { name: 'AssemblyAI v3 Streaming', config: { assembly_ai_v3_streaming: {} } },
  { name: 'AssemblyAI Async Chunked', config: { assembly_ai_async_chunked: {} } },
  { name: 'RecallAI Streaming', config: { recallai_streaming: {} } },
  { name: 'Meeting Captions', config: { meeting_captions: {} } },
];

async function testProvider(provider) {
  console.log(`\n--- Testing: ${provider.name} ---`);

  const request = {
    meeting_title: `Test - ${provider.name}`,
    transcript: {
      provider: provider.config
    }
  };

  try {
    const response = await fetch(`${API_URL}/api/v1/sdk-upload/`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(request)
    });

    const responseText = await response.text();

    if (response.ok) {
      console.log(`✅ ${provider.name} WORKS!`);
      const data = JSON.parse(responseText);
      console.log('Upload ID:', data.id);
      console.log('Token:', data.upload_token?.substring(0, 10) + '...');

      // Clean up
      if (data.id) {
        await fetch(`${API_URL}/api/v1/sdk-upload/${data.id}/`, {
          method: 'DELETE',
          headers: { 'Authorization': `Token ${API_KEY}` }
        });
      }
      return true;
    } else {
      console.log(`❌ ${provider.name} failed (${response.status})`);
      try {
        const error = JSON.parse(responseText);
        // Only show the actual error message, not the full structure
        const errorMsg = error.transcript ||
                        error.recording_config?.transcript?.provider ||
                        error;
        console.log('Error:', JSON.stringify(errorMsg, null, 2));
      } catch {
        console.log('Error text:', responseText);
      }
      return false;
    }
  } catch (error) {
    console.error(`Network error: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('\n========================================');
  console.log('Testing Valid Streaming Providers');
  console.log('========================================\n');

  const results = [];
  for (const provider of providers) {
    const success = await testProvider(provider);
    results.push({ name: provider.name, success });
  }

  console.log('\n========================================');
  console.log('RESULTS');
  console.log('========================================\n');

  const working = results.filter(r => r.success);

  if (working.length > 0) {
    console.log('✅ WORKING PROVIDERS FOR REAL-TIME TRANSCRIPT:');
    working.forEach(p => console.log(`   - ${p.name}`));
    console.log('\nUse one of these in the code!');
  } else {
    console.log('❌ No streaming providers work with current configuration');
    console.log('   You\'ll need to use post-processing (no provider)');
  }
}

main();