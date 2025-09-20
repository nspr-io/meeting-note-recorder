#!/usr/bin/env node

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
require('dotenv').config();

const API_KEY = process.env.RECALL_API_KEY;
const API_URL = 'https://us-west-2.recall.ai';

const providers = [
  { name: 'AssemblyAI Streaming', config: { assembly_ai_streaming: {} } },
  { name: 'AssemblyAI Regular', config: { assembly_ai: {} } },
  { name: 'Deepgram Streaming', config: { deepgram_streaming: {} } },
  { name: 'Deepgram Regular', config: { deepgram: {} } },
  { name: 'Whisper', config: { whisper: {} } },
  { name: 'Rev', config: { rev: {} } },
  { name: 'Speechmatics', config: { speechmatics: {} } },
];

async function testProvider(provider) {
  console.log(`\n--- Testing: ${provider.name} ---`);

  const request = {
    meeting_title: `Test - ${provider.name}`,
    transcript: {
      provider: provider.config
    }
  };

  console.log('Request:', JSON.stringify(request, null, 2));

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
      console.log('Response:', responseText.substring(0, 200) + '...');

      // Clean up
      const data = JSON.parse(responseText);
      if (data.id) {
        await fetch(`${API_URL}/api/v1/sdk-upload/${data.id}/`, {
          method: 'DELETE',
          headers: { 'Authorization': `Token ${API_KEY}` }
        });
        console.log('Cleaned up test upload');
      }
      return true;
    } else {
      console.log(`❌ ${provider.name} failed (${response.status})`);
      try {
        const error = JSON.parse(responseText);
        console.log('Error:', JSON.stringify(error, null, 2));
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
  console.log('Testing All Transcript Providers');
  console.log('========================================\n');

  if (!API_KEY) {
    console.error('❌ RECALL_API_KEY not found');
    process.exit(1);
  }

  console.log('✅ API Key:', API_KEY.substring(0, 10) + '...');
  console.log('📍 API URL:', API_URL);

  const results = [];
  for (const provider of providers) {
    const success = await testProvider(provider);
    results.push({ name: provider.name, success });
  }

  console.log('\n========================================');
  console.log('Summary');
  console.log('========================================\n');

  const working = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log('✅ Working providers:');
  if (working.length > 0) {
    working.forEach(p => console.log(`   - ${p.name}`));
  } else {
    console.log('   None');
  }

  console.log('\n❌ Failed providers:');
  if (failed.length > 0) {
    failed.forEach(p => console.log(`   - ${p.name}`));
  } else {
    console.log('   None');
  }

  // Test no provider (post-processing)
  console.log('\n--- Testing: No Provider (Post-processing) ---');
  const noProviderRequest = {
    meeting_title: 'Test - Post Processing'
  };

  try {
    const response = await fetch(`${API_URL}/api/v1/sdk-upload/`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(noProviderRequest)
    });

    if (response.ok) {
      console.log('✅ Post-processing (no provider) WORKS!');
      const data = await response.json();
      if (data.id) {
        await fetch(`${API_URL}/api/v1/sdk-upload/${data.id}/`, {
          method: 'DELETE',
          headers: { 'Authorization': `Token ${API_KEY}` }
        });
      }
    }
  } catch (error) {
    console.error('Error:', error.message);
  }

  console.log('\n========================================\n');
}

main();