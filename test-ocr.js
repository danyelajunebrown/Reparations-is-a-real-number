/**
 * Quick OCR test script
 */

const OCRService = require('./ocr-service');
const fs = require('fs');

async function testOCR() {
  console.log('=== OCR Service Test ===\n');

  const ocrService = new OCRService();

  // Test with the text file (simulate document)
  const testFile = '/tmp/test_will.txt';

  if (!fs.existsSync(testFile)) {
    console.error(`Test file not found: ${testFile}`);
    console.log('\nPlease provide an image file (JPG, PNG, PDF) to test OCR.');
    console.log('Usage: node test-ocr.js <path-to-image>');
    process.exit(1);
  }

  try {
    console.log(`Testing OCR on: ${testFile}\n`);

    const result = await ocrService.performOCR(testFile, {
      documentType: 'will'
    });

    console.log('\n=== OCR RESULTS ===');
    console.log(`Service: ${result.service}`);
    console.log(`Method: ${result.method}`);
    console.log(`Confidence: ${(result.confidence * 100).toFixed(2)}%`);
    console.log(`Page Count: ${result.pageCount}`);
    console.log(`Word Count: ${result.words || 'N/A'}`);
    console.log(`Duration: ${result.duration}s`);
    console.log('\n=== EXTRACTED TEXT ===');
    console.log(result.text.substring(0, 500));
    if (result.text.length > 500) {
      console.log(`\n... (${result.text.length - 500} more characters)`);
    }

    console.log('\n✓ OCR test completed successfully');

  } catch (error) {
    console.error('\n✗ OCR test failed:', error.message);
    process.exit(1);
  }
}

// Run test
testOCR().catch(console.error);
