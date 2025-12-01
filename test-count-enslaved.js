const axios = require('axios');

const API_URL = process.env.API_URL || 'http://localhost:3000';

async function testCountEnslaved() {
  try {
    console.log('Testing enslaved people counting...\n');

    // Test 1: "how many enslaved?"
    console.log('Test 1: "how many enslaved?"');
    const test1 = await axios.post(`${API_URL}/api/llm-query`, {
      query: "how many enslaved?"
    });
    console.log('Response:', test1.data.response);
    console.log('Success:', test1.data.success ? '✅' : '❌');
    console.log('');

    // Test 2: "how many slaves?"
    console.log('Test 2: "how many slaves?"');
    const test2 = await axios.post(`${API_URL}/api/llm-query`, {
      query: "how many slaves?"
    });
    console.log('Response:', test2.data.response);
    console.log('Success:', test2.data.success ? '✅' : '❌');
    console.log('');

    // Test 3: "total enslaved people"
    console.log('Test 3: "total enslaved people"');
    const test3 = await axios.post(`${API_URL}/api/llm-query`, {
      query: "total enslaved people"
    });
    console.log('Response:', test3.data.response);
    console.log('Success:', test3.data.success ? '✅' : '❌');
    console.log('');

    console.log('✅ All tests complete!');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

testCountEnslaved();
