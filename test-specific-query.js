const axios = require('axios');

async function testQuery() {
  try {
    console.log('Testing: "How many owners are documented?"');
    const response = await axios.post('https://reparations-platform.onrender.com/api/llm-query', {
      query: 'How many owners are documented?'
    }, {
      timeout: 30000
    });

    console.log('Success:', response.data.success);
    console.log('Response:', response.data.response);
    if (response.data.error) {
      console.log('Error:', response.data.error);
    }
  } catch (error) {
    console.error('Request failed:');
    console.error('Status:', error.response?.status);
    console.error('Data:', error.response?.data);
    console.error('Message:', error.message);
  }
}

testQuery();
