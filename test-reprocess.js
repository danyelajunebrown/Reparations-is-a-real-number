const axios = require('axios');

const API_URL = process.env.API_URL || 'http://localhost:3000';

async function testReprocess() {
  try {
    console.log('Testing reprocess command via Research Assistant...\n');

    // Test: Simple "reprocess documents" command
    console.log('Sending: "reprocess documents"');
    const response = await axios.post(`${API_URL}/api/llm-query`, {
      query: "reprocess documents"
    }, {
      timeout: 60000 // 60 second timeout
    });

    console.log('Response:', response.data.response);
    console.log('Success:', response.data.success);

    if (response.data.data) {
      console.log('\nData:', JSON.stringify(response.data.data, null, 2));
    }

  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      console.error('Request timed out after 60 seconds');
    } else {
      console.error('Error:', error.response?.data || error.message);
    }
  }
}

testReprocess();
