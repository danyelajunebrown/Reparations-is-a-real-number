const axios = require('axios');

async function testQuery() {
  try {
    const response = await axios.post('http://localhost:3000/api/llm-query', {
      query: 'who was the slave owner documented in the database'
    });

    console.log('Success:', response.data.success);
    console.log('Response:', response.data.response);
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

testQuery();
