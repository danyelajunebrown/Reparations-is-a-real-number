const axios = require('axios');

const API_URL = process.env.API_URL || 'http://localhost:3000';

async function testBothFeatures() {
  try {
    console.log('🧪 Testing FamilySearch ID and Reprocess Features\n');
    
    // Test 1: FamilySearch ID
    console.log('1️⃣  Testing FamilySearch ID attachment...');
    const test1 = await axios.post(`${API_URL}/api/llm-query`, {
      query: "James Hopewell's FamilySearch ID is TEST-123"
    });
    console.log('   Response:', test1.data.response);
    console.log('   Success:', test1.data.success ? '✅' : '❌');
    console.log('');

    // Test 2: Different format
    console.log('2️⃣  Testing alternative FamilySearch ID format...');
    const test2 = await axios.post(`${API_URL}/api/llm-query`, {
      query: "Set FamilySearch ID for Ann M. Biscoe to DEMO-456"
    });
    console.log('   Response:', test2.data.response);
    console.log('   Success:', test2.data.success ? '✅' : '❌');
    console.log('');

    // Test 3: Reprocess single owner
    console.log('3️⃣  Testing reprocess for single owner...');
    console.log('   (This may take 10-30 seconds)');
    const test3 = await axios.post(`${API_URL}/api/llm-query`, {
      query: "reprocess Ann M. Biscoe"
    }, { timeout: 30000 });
    console.log('   Response:', test3.data.response);
    console.log('   Success:', test3.data.success ? '✅' : '❌');
    console.log('');

    console.log('✅ All tests complete!');
    console.log('\nNote: To test "reprocess documents" (all documents), run separately as it takes 1-2 minutes.');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testBothFeatures();
