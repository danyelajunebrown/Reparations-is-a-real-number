/**
 * Merge James Hopewell Will Pages
 * 
 * Combines page-1.pdf and page-2.pdf from S3 into a single unified document
 * and updates the database to reference the merged file.
 */

const config = require('../config');
const db = require('../database.js');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { PDFDocument } = require('pdf-lib');

const s3 = new S3Client({
  region: config.storage.s3.region,
  credentials: {
    accessKeyId: config.storage.s3.accessKeyId,
    secretAccessKey: config.storage.s3.secretAccessKey
  }
});

async function mergeHopewellPages() {
  console.log('========================================');
  console.log('Merging James Hopewell Will Pages');
  console.log('========================================\n');

  try {
    // Step 1: Download both pages from S3
    console.log('Step 1: Downloading pages from S3...');
    
    const page1Cmd = new GetObjectCommand({
      Bucket: config.storage.s3.bucket,
      Key: 'owners/James-Hopewell/will/page-1.pdf'
    });
    
    const page2Cmd = new GetObjectCommand({
      Bucket: config.storage.s3.bucket,
      Key: 'owners/James-Hopewell/will/page-2.pdf'
    });
    
    const page1Response = await s3.send(page1Cmd);
    const page1Buffer = Buffer.from(await page1Response.Body.transformToByteArray());
    console.log('  ✓ Downloaded page-1.pdf (' + (page1Buffer.length / 1024).toFixed(1) + ' KB)');
    
    const page2Response = await s3.send(page2Cmd);
    const page2Buffer = Buffer.from(await page2Response.Body.transformToByteArray());
    console.log('  ✓ Downloaded page-2.pdf (' + (page2Buffer.length / 1024).toFixed(1) + ' KB)');
    
    // Step 2: Load and merge PDFs
    console.log('\nStep 2: Merging PDFs...');
    const page1Doc = await PDFDocument.load(page1Buffer);
    const page2Doc = await PDFDocument.load(page2Buffer);
    
    const mergedDoc = await PDFDocument.create();
    
    // Copy pages from page 1
    const page1Pages = await mergedDoc.copyPages(page1Doc, page1Doc.getPageIndices());
    page1Pages.forEach(page => mergedDoc.addPage(page));
    console.log('  ✓ Added ' + page1Pages.length + ' page(s) from page-1.pdf');
    
    // Copy pages from page 2
    const page2Pages = await mergedDoc.copyPages(page2Doc, page2Doc.getPageIndices());
    page2Pages.forEach(page => mergedDoc.addPage(page));
    console.log('  ✓ Added ' + page2Pages.length + ' page(s) from page-2.pdf');
    
    const mergedPdfBytes = await mergedDoc.save();
    console.log('  ✓ Created merged PDF (' + (mergedPdfBytes.length / 1024).toFixed(1) + ' KB)');
    
    // Step 3: Upload merged document to S3
    console.log('\nStep 3: Uploading merged document to S3...');
    const mergedKey = 'owners/James-Hopewell/will/James-Hopewell-Will-1817-complete.pdf';
    
    const uploadCmd = new PutObjectCommand({
      Bucket: config.storage.s3.bucket,
      Key: mergedKey,
      Body: mergedPdfBytes,
      ContentType: 'application/pdf'
    });
    
    await s3.send(uploadCmd);
    console.log('  ✓ Uploaded to: ' + mergedKey);
    
    // Step 4: Update database record
    console.log('\nStep 4: Updating database record...');
    
    const updateResult = await db.query(`
      UPDATE documents
      SET 
        file_path = $1,
        s3_key = $1,
        filename = 'James-Hopewell-Will-1817-complete.pdf',
        ocr_page_count = $2,
        file_size = $3,
        document_group_id = 'james-hopewell-will-1817',
        updated_at = CURRENT_TIMESTAMP
      WHERE document_id = 'james-hopewell-will-1817'
      RETURNING document_id, filename, file_path, ocr_page_count
    `, [mergedKey, mergedDoc.getPageCount(), mergedPdfBytes.length]);
    
    if (updateResult.rows.length > 0) {
      console.log('  ✓ Database updated:');
      console.log('    Document ID: ' + updateResult.rows[0].document_id);
      console.log('    Filename: ' + updateResult.rows[0].filename);
      console.log('    File path: ' + updateResult.rows[0].file_path);
      console.log('    Page count: ' + updateResult.rows[0].ocr_page_count);
    }
    
    console.log('\n========================================');
    console.log('✓ Successfully merged James Hopewell will!');
    console.log('  Total pages: ' + mergedDoc.getPageCount());
    console.log('  S3 key: ' + mergedKey);
    console.log('========================================\n');
    
    return {
      success: true,
      mergedKey,
      pageCount: mergedDoc.getPageCount(),
      fileSize: mergedPdfBytes.length
    };
    
  } catch (error) {
    console.error('\n❌ Error merging documents:', error.message);
    throw error;
  }
}

// Run the merge
mergeHopewellPages()
  .then(result => {
    console.log('Merge complete. Result:', result);
    process.exit(0);
  })
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
