// Comprehensive API test
const API_KEY = '1332daafebd5965acdf93098d1be5c9a23b2f2dc';
const API_URL = 'https://us-west-2.recall.ai';

async function testAPI() {
  console.log('========================================');
  console.log('Testing Recall.ai API');
  console.log('========================================');
  console.log('API URL:', API_URL);
  console.log('API Key:', API_KEY.substring(0, 10) + '...');
  
  try {
    // Test 1: Create SDK upload without transcript provider
    console.log('\n1. Testing SDK upload creation (no transcript provider)...');
    let response = await fetch(`${API_URL}/api/v1/sdk-upload/`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        meeting_title: 'Test Meeting - No Provider'
      })
    });

    if (response.ok) {
      const data = await response.json();
      console.log('✅ SUCCESS! Upload created:', {
        id: data.id,
        upload_token: data.upload_token?.substring(0, 20) + '...',
        status: data.status
      });
    } else {
      const error = await response.text();
      console.log('❌ FAILED:', response.status, error);
    }

    // Test 2: Try with different transcript options
    console.log('\n2. Testing with recall transcription...');
    response = await fetch(`${API_URL}/api/v1/sdk-upload/`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        meeting_title: 'Test Meeting - Recall Transcript',
        transcript: {
          provider: 'recall'
        }
      })
    });

    if (response.ok) {
      const data = await response.json();
      console.log('✅ SUCCESS with recall provider!');
    } else {
      const error = await response.text();
      console.log('❌ Failed with recall provider:', error);
    }

    // Test 3: List existing uploads
    console.log('\n3. Testing list existing uploads...');
    response = await fetch(`${API_URL}/api/v1/sdk-upload/`, {
      headers: {
        'Authorization': `Token ${API_KEY}`
      }
    });

    if (response.ok) {
      const data = await response.json();
      console.log('✅ Can list uploads. Count:', data.results?.length || 0);
    } else {
      console.log('❌ Cannot list uploads:', response.status);
    }

  } catch (error) {
    console.error('❌ Connection error:', error.message);
  }
  
  console.log('\n========================================');
}

testAPI();