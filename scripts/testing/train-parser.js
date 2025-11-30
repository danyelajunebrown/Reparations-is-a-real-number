/**
 * Train the Colonial American parser with known-good examples
 * This improves accuracy over time as you add more documents
 */

const ColonialAmericanDocumentParser = require('./historical-document-parser');
const fs = require('fs');

async function trainParser() {
  console.log('=== Colonial American Document Parser Training ===\n');

  const parser = new ColonialAmericanDocumentParser({
    learningEnabled: true
  });

  // Wait for patterns to load
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Example 1: James Hopewell Will (1820)
  const hopewellText = fs.readFileSync('/tmp/test_will.txt', 'utf8');

  const hopewellExtractions = {
    owner_name: 'James Hopewell',
    document_year: '1820',
    location: 'Prince George\'s County, Maryland',
    enslaved_people: [
      {
        name: 'Harry',
        normalized_name: 'Harry',
        age: 35,
        age_approximate: false,
        gender: 'male',
        relationships: [],
        evidence_quote: 'Harry, aged 35',
        confidence: 1.0
      },
      {
        name: 'Sarah',
        normalized_name: 'Sarah',
        age: 28,
        age_approximate: false,
        gender: 'female',
        relationships: [],
        evidence_quote: 'Sarah, aged 28',
        confidence: 1.0
      },
      {
        name: 'Young Tom',
        normalized_name: 'Tom',
        age: 12,
        age_approximate: false,
        gender: 'male',
        relationships: [],
        evidence_quote: 'Young Tom, aged 12',
        confidence: 1.0
      },
      {
        name: 'Old Ned',
        normalized_name: 'Ned',
        age: 60,
        age_approximate: false,
        gender: 'male',
        relationships: [],
        evidence_quote: 'Old Ned, aged 60',
        confidence: 1.0
      },
      {
        name: 'Betsy',
        normalized_name: 'Betsy',
        age: null,
        age_approximate: false,
        gender: 'female',
        relationships: ['mother of unnamed child'],
        evidence_quote: 'Betsy and her child',
        confidence: 1.0
      }
    ],
    total_count: 5
  };

  console.log('Training Example 1: James Hopewell Will (1820)');
  const result1 = await parser.trainFromExample(hopewellText, hopewellExtractions, {
    documentType: 'will',
    source: 'manual_transcription'
  });

  console.log(`  ✓ Learned ${result1.learnedNames} names`);
  console.log(`  ✓ Total known names: ${result1.totalKnownNames}`);
  console.log(`  ✓ Total training examples: ${result1.totalTrainingExamples}\n`);

  // Example 2: Add more training examples as you process documents
  console.log('\n=== Training Summary ===');
  console.log(`Known enslaved person names: ${parser.knownNames.size}`);
  console.log(`Known slave owners: ${parser.knownOwners.size}`);
  console.log(`Learned patterns: ${parser.learnedPatterns.length}`);
  console.log(`Training examples: ${parser.trainingExamples.length}\n`);

  console.log('Files saved:');
  console.log('  - data/learned-patterns.json');
  console.log('  - data/training-examples.json\n');

  console.log('✓ Parser training complete!');
  console.log('\nNext time the parser runs, it will use these learned patterns');
  console.log('to improve extraction accuracy.\n');
}

// Run training
trainParser().catch(console.error);
