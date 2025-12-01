/**
 * Test historical document parser with James Hopewell will
 */

const ColonialAmericanDocumentParser = require('./historical-document-parser');
const fs = require('fs');

async function testParser() {
  console.log('=== Historical Document Parser Test ===\n');

  const parser = new ColonialAmericanDocumentParser();

  // Read the James Hopewell will
  const testFile = '/tmp/test_will.txt';

  if (!fs.existsSync(testFile)) {
    console.error(`Test file not found: ${testFile}`);
    process.exit(1);
  }

  const documentText = fs.readFileSync(testFile, 'utf8');

  console.log('Testing with James Hopewell will...\n');
  console.log('Document text:');
  console.log('─'.repeat(60));
  console.log(documentText);
  console.log('─'.repeat(60));

  try {
    const result = await parser.parseDocument(documentText, {
      documentType: 'will',
      owner: 'James Hopewell',
      year: '1820',
      location: 'Prince George\'s County, Maryland'
    });

    console.log('\n=== PARSING RESULTS ===\n');
    console.log(`Success: ${result.success}`);
    console.log(`Method: ${result.method}`);
    console.log(`Owner: ${result.owner_name}`);
    console.log(`Year: ${result.document_year}`);
    console.log(`Location: ${result.location}`);
    console.log(`Total Enslaved: ${result.total_count}`);
    console.log(`Confidence: ${(result.confidence * 100).toFixed(1)}%`);

    if (result.parsing_notes) {
      console.log(`\nNotes: ${result.parsing_notes}`);
    }

    console.log('\n=== ENSLAVED PEOPLE FOUND ===\n');

    if (result.enslaved_people && result.enslaved_people.length > 0) {
      result.enslaved_people.forEach((person, index) => {
        console.log(`${index + 1}. ${person.name || person.normalized_name}`);
        console.log(`   Age: ${person.age || 'unknown'}${person.age_approximate ? ' (approx)' : ''}`);
        console.log(`   Gender: ${person.gender || 'unknown'}`);
        if (person.relationships && person.relationships.length > 0) {
          console.log(`   Relationships: ${person.relationships.join(', ')}`);
        }
        console.log(`   Evidence: "${person.evidence_quote}"`);
        console.log(`   Confidence: ${(person.confidence * 100).toFixed(1)}%`);
        console.log('');
      });
    } else {
      console.log('No enslaved people found in document');
    }

    console.log('✓ Parser test completed successfully\n');

    // Show expected vs actual
    console.log('=== EXPECTED RESULTS (from document) ===');
    console.log('Harry, aged 35');
    console.log('Sarah, aged 28');
    console.log('Young Tom, aged 12');
    console.log('Old Ned, aged 60');
    console.log('Betsy and her child');
    console.log('\nTotal expected: 5 people\n');

  } catch (error) {
    console.error('\n✗ Parser test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run test
testParser().catch(console.error);
