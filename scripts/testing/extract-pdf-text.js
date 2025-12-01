#!/usr/bin/env node
/**
 * Extract text from James Hopewell's will PDF and update database
 */

const fs = require('fs').promises;
const pdfParse = require('pdf-parse');
const database = require('./database');

async function extractAndUpdatePDF() {
  const pdfPath = './storage/owners/James-Hopewell/will/James-Hopewell-will-1763564287838.pdf';
  const documentId = 'd94180c70274f7bf25b735a8';

  try {
    console.log('Reading PDF file...');
    const dataBuffer = await fs.readFile(pdfPath);

    console.log('Extracting text from PDF...');
    const pdfData = await pdfParse(dataBuffer);

    console.log('\n=== PDF TEXT EXTRACTION RESULTS ===');
    console.log(`Pages: ${pdfData.numpages}`);
    console.log(`Text length: ${pdfData.text.length} characters`);
    console.log('\n=== EXTRACTED TEXT ===');
    console.log(pdfData.text);
    console.log('\n=== END OF TEXT ===\n');

    if (pdfData.text && pdfData.text.trim().length > 0) {
      console.log('Updating database...');

      const query = `
        UPDATE documents
        SET
          ocr_text = $1,
          ocr_confidence = 1.0,
          ocr_page_count = $2,
          ocr_service = 'pdf-direct-extraction',
          ocr_processed_at = NOW(),
          updated_at = NOW()
        WHERE document_id = $3
        RETURNING document_id, length(ocr_text) as text_length;
      `;

      const result = await database.query(query, [pdfData.text, pdfData.numpages, documentId]);

      if (result.rows.length > 0) {
        console.log('✓ Database updated successfully!');
        console.log(`  Document ID: ${result.rows[0].document_id}`);
        console.log(`  New OCR text length: ${result.rows[0].text_length} characters`);
      } else {
        console.error('✗ No rows updated - document may not exist');
      }
    } else {
      console.log('⚠ PDF has no extractable text - it may be a scanned image that needs OCR');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await database.end();
  }
}

extractAndUpdatePDF();
