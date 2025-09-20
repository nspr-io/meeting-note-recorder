#!/usr/bin/env node

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
require('dotenv').config();

const API_KEY = process.env.RECALL_API_KEY;
const API_URL = 'https://us-west-2.recall.ai';

async function testSDKUpload() {
  console.log('\n========================================');
  console.log('Testing Recall.ai SDK Upload API');
  console.log('========================================\n');

  if (!API_KEY) {
    console.error('❌ RECALL_API_KEY not found in environment');
    process.exit(1);
  }

  console.log('✅ API Key found:', API_KEY.substring(0, 10) + '...');
  console.log('📍 API URL:', API_URL);

  // Test 1: AssemblyAI streaming
  console.log('\n--- Test 1: AssemblyAI Streaming ---');
  const assemblyAiRequest = {
    meeting_title: 'Test Meeting - AssemblyAI',
    transcript: {
      provider: {
        assembly_ai_streaming: {}
      }
    }
  };

  console.log('Request:', JSON.stringify(assemblyAiRequest, null, 2));

  try {
    const response = await fetch(`${API_URL}/api/v1/sdk-upload/`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(assemblyAiRequest)
    });

    const responseText = await response.text();
    console.log('Response Status:', response.status);
    console.log('Response Body:', responseText);

    if (response.ok) {
      console.log('✅ AssemblyAI streaming configuration WORKS!');
      const data = JSON.parse(responseText);

      // Clean up the test upload
      if (data.id) {
        console.log('\nCleaning up test upload:', data.id);
        await fetch(`${API_URL}/api/v1/sdk-upload/${data.id}/`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Token ${API_KEY}`
          }
        });
      }
    } else {
      console.log('❌ AssemblyAI streaming failed');
      try {
        const error = JSON.parse(responseText);
        console.log('Error details:', JSON.stringify(error, null, 2));
      } catch {}
    }
  } catch (error) {
    console.error('Network error:', error.message);
  }

  // Test 2: Deepgram streaming
  console.log('\n--- Test 2: Deepgram Streaming ---');
  const deepgramRequest = {
    meeting_title: 'Test Meeting - Deepgram',
    transcript: {
      provider: {
        deepgram_streaming: {}
      }
    }
  };

  console.log('Request:', JSON.stringify(deepgramRequest, null, 2));

  try {
    const response = await fetch(`${API_URL}/api/v1/sdk-upload/`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(deepgramRequest)
    });

    const responseText = await response.text();
    console.log('Response Status:', response.status);
    console.log('Response Body:', responseText);

    if (response.ok) {
      console.log('✅ Deepgram streaming configuration WORKS!');
      const data = JSON.parse(responseText);

      // Clean up the test upload
      if (data.id) {
        console.log('\nCleaning up test upload:', data.id);
        await fetch(`${API_URL}/api/v1/sdk-upload/${data.id}/`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Token ${API_KEY}`
          }
        });
      }
    } else {
      console.log('❌ Deepgram streaming failed');
      try {
        const error = JSON.parse(responseText);
        console.log('Error details:', JSON.stringify(error, null, 2));
      } catch {}
    }
  } catch (error) {
    console.error('Network error:', error.message);
  }

  // Test 3: No provider (post-processing)
  console.log('\n--- Test 3: No Provider (Post-processing) ---');
  const noProviderRequest = {
    meeting_title: 'Test Meeting - No Provider'
  };

  console.log('Request:', JSON.stringify(noProviderRequest, null, 2));

  try {
    const response = await fetch(`${API_URL}/api/v1/sdk-upload/`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(noProviderRequest)
    });

    const responseText = await response.text();
    console.log('Response Status:', response.status);
    console.log('Response Body:', responseText);

    if (response.ok) {
      console.log('✅ No provider (post-processing) WORKS!');
      const data = JSON.parse(responseText);

      // Clean up the test upload
      if (data.id) {
        console.log('\nCleaning up test upload:', data.id);
        await fetch(`${API_URL}/api/v1/sdk-upload/${data.id}/`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Token ${API_KEY}`
          }
        });
      }
    } else {
      console.log('❌ No provider configuration failed');
    }
  } catch (error) {
    console.error('Network error:', error.message);
  }

  console.log('\n========================================');
  console.log('Test Complete');
  console.log('========================================\n');
}

testSDKUpload();