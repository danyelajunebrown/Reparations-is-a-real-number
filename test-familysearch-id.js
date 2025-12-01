const axios = require('axios');

const API_URL = process.env.API_URL || 'http://localhost:3000';

async function testFamilySearchIdAttachment() {
  try {
    console.log('Testing FamilySearch ID attachment feature...\n');

    // Test 1: Attach FamilySearch ID to a slave owner
    console.log('Test 1: Attaching FamilySearch ID to slave owner "James Hopewell"');
    const test1 = await axios.post(`${API_URL}/api/llm-query`, {
      query: "James Hopewell's FamilySearch ID is KWCG-8K9"
    });

    console.log('Response:', test1.data.response);
    console.log('Success:', test1.data.success);
    if (test1.data.data) {
      console.log('Data:', JSON.stringify(test1.data.data, null, 2));
    }
    console.log('');

    // Test 2: Try different format
    console.log('Test 2: Alternative format - "Set FamilySearch ID for Ann M. Biscoe to ABCD-123"');
    const test2 = await axios.post(`${API_URL}/api/llm-query`, {
      query: "Set FamilySearch ID for Ann M. Biscoe to ABCD-123"
    });

    console.log('Response:', test2.data.response);
    console.log('Success:', test2.data.success);
    if (test2.data.data) {
      console.log('Data:', JSON.stringify(test2.data.data, null, 2));
    }
    console.log('');

    // Test 3: Try with a person not in database
    console.log('Test 3: Person not found - "George Washington\'s FamilySearch ID is TEST-001"');
    const test3 = await axios.post(`${API_URL}/api/llm-query`, {
      query: "George Washington's FamilySearch ID is TEST-001"
    });

    console.log('Response:', test3.data.response);
    console.log('Success:', test3.data.success);
    console.log('');

    // Test 4: Query to verify the ID was saved
    console.log('Test 4: Verify FamilySearch ID was saved - "Tell me about James Hopewell"');
    const test4 = await axios.post(`${API_URL}/api/llm-query`, {
      query: "Tell me about James Hopewell"
    });

    console.log('Response:', test4.data.response);
    if (test4.data.data && test4.data.data.owner_familysearch_id) {
      console.log('✓ FamilySearch ID verified:', test4.data.data.owner_familysearch_id);
    }
    console.log('');

    console.log('✓ All tests complete!');

  } catch (error) {
    console.error('✗ Test failed:', error.response?.data || error.message);
  }
}

testFamilySearchIdAttachment();
