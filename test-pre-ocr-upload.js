/**
 * Test: Upload document with pre-OCR'd text
 * Tests the new /api/upload-document-with-text endpoint
 */

const axios = require('axios');

const API_URL = 'http://localhost:3000';

async function testPreOCRUpload() {
  console.log('=== Testing Pre-OCR\'d Text Upload ===\n');

  // Example: Slave manifest text from an archive
  const manifestText = `
Manifest of Negroes Shipped Aboard the Brig "Fortune"
Charleston, South Carolina - March 15, 1787

Owner: Thomas Jefferson III
Destination: New Orleans

List of Negroes:
1. Samuel - Male - Age about 25 years
2. Lucy - Female - Age about 20 years
3. Caesar - Male - Age about 30 years
4. Dinah - Female - Age about 18 years
5. Tom - Male - Age about 22 years
6. Patience - Female - Age about 35 years, with child Jenny age 3 years

Total: Six negroes and one child

Signed this day by Capt. William Harrison
  `.trim();

  try {
    console.log('1. Uploading slave manifest with pre-OCR\'d text...');

    const response = await axios.post(`${API_URL}/api/upload-document-with-text`, {
      ownerName: 'Thomas Jefferson III',
      documentType: 'slave_manifest',
      textContent: manifestText,
      textSource: 'transcription',
      location: 'Charleston, South Carolina',
      birthYear: 1750,
      deathYear: 1810,
      notes: 'Ship manifest from archive.org - transcribed from original'
    });

    console.log('✓ Upload successful!\n');
    console.log('Document ID:', response.data.documentId);
    console.log('Enslaved people found:', response.data.parsed.enslaved_count);
    console.log('Parsing confidence:', response.data.parsed.confidence);
    console.log('Method used:', response.data.parsed.method);
    console.log('Trained system:', response.data.parsed.trained ? 'Yes' : 'No');

    if (response.data.result.enslaved_people) {
      console.log('\nExtracted people:');
      response.data.result.enslaved_people.forEach((person, i) => {
        console.log(`  ${i + 1}. ${person.name} - ${person.gender || 'unknown'} - Age: ${person.age || 'unknown'}`);
      });
    }

    console.log('\n=== Test Passed ===');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
    process.exit(1);
  }
}

// Run test
testPreOCRUpload()
  .then(() => {
    console.log('\n✓ All tests complete');
    process.exit(0);
  })
  .catch(err => {
    console.error('Test error:', err);
    process.exit(1);
  });
