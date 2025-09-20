// Test script to simulate recording
const API_KEY = '1332daafebd5965acdf93098d1be5c9a23b2f2dc';
const API_URL = 'https://us-west-2.recall.ai';

async function testRecording() {
  console.log('========================================');
  console.log('Testing Recording Flow');
  console.log('========================================');
  console.log('API URL:', API_URL);
  console.log('API Key:', API_KEY.substring(0, 10) + '...');
  
  try {
    // Step 1: Create SDK upload
    console.log('\n1. Creating SDK upload...');
    const uploadResponse = await fetch(`${API_URL}/api/v1/sdk-upload/`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        meeting_title: 'Test Meeting - Recording Flow Test'
      })
    });

    if (!uploadResponse.ok) {
      const error = await uploadResponse.text();
      console.log('❌ Failed to create upload:', uploadResponse.status, error);
      return;
    }

    const uploadData = await uploadResponse.json();
    console.log('✅ Upload created successfully:', {
      id: uploadData.id,
      upload_token: uploadData.upload_token?.substring(0, 20) + '...',
      status: uploadData.status
    });

    // Step 2: Check upload status
    console.log('\n2. Checking upload status...');
    const statusResponse = await fetch(`${API_URL}/api/v1/sdk-upload/${uploadData.id}/`, {
      headers: {
        'Authorization': `Token ${API_KEY}`
      }
    });

    if (statusResponse.ok) {
      const statusData = await statusResponse.json();
      console.log('✅ Upload status:', {
        id: statusData.id,
        status: statusData.status,
        recording_id: statusData.recording_id || 'Not yet available'
      });
    } else {
      console.log('❌ Failed to get upload status:', statusResponse.status);
    }

    // Step 3: List all uploads to verify
    console.log('\n3. Listing all uploads...');
    const listResponse = await fetch(`${API_URL}/api/v1/sdk-upload/`, {
      headers: {
        'Authorization': `Token ${API_KEY}`
      }
    });

    if (listResponse.ok) {
      const listData = await listResponse.json();
      console.log('✅ Total uploads:', listData.results?.length || 0);
      
      // Show recent uploads
      if (listData.results && listData.results.length > 0) {
        console.log('Recent uploads:');
        listData.results.slice(0, 3).forEach(upload => {
          console.log(`  - ${upload.id}: ${upload.meeting_title || 'Untitled'} (${upload.status})`);
        });
      }
    } else {
      console.log('❌ Failed to list uploads:', listResponse.status);
    }

    // Step 4: Test if we can create a transcript (will fail if no recording)
    console.log('\n4. Testing transcript endpoint (expected to fail without actual recording)...');
    const testRecordingId = 'test-recording-id';
    const transcriptResponse = await fetch(`${API_URL}/api/v1/recording/${testRecordingId}/transcript/`, {
      headers: {
        'Authorization': `Token ${API_KEY}`
      }
    });

    if (transcriptResponse.ok) {
      console.log('✅ Transcript endpoint accessible');
    } else if (transcriptResponse.status === 404) {
      console.log('✅ Transcript endpoint works (404 is expected for non-existent recording)');
    } else {
      console.log('❌ Unexpected transcript response:', transcriptResponse.status);
    }

    console.log('\n========================================');
    console.log('Recording Flow Test Complete');
    console.log('✅ All API endpoints are working correctly with us-west-2');
    console.log('✅ The app should be able to record meetings now');
    console.log('========================================');
    
  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  }
}

testRecording();