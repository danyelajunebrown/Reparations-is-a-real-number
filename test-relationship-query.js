const axios = require('axios');

async function testQueries() {
  const queries = [
    "who is James Hopewell's wife?",
    "who is James Hopewell's son?",
    "who are James Hopewell's children?"
  ];

  for (const query of queries) {
    console.log(`\nTesting: "${query}"`);
    try {
      const response = await axios.post('http://localhost:3000/api/llm-query', { query });
      console.log('Success:', response.data.success);
      console.log('Response:', response.data.response);
    } catch (error) {
      console.error('Error:', error.response?.data || error.message);
    }
  }
}

testQueries();
