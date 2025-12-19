/**
 * Fix James Hopewell Database Record
 * 
 * Updates the database to point to the merged document
 * or creates a merged document reference
 */
const config = require('../config');
const db = require('../database.js');
const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { PDFDocument } = require('pdf-lib');

const s3 = new S3Client({
  region: config.storage.s3.region,
  credentials: {
    accessKeyId: config.storage.s3.accessKeyId,
    secretAccessKey: config.storage.s3.secretAccessKey
  }
});

async function fixHopewellDocument() {
  console.log('=== Fixing James Hopewell Document ===\n');
  
  const mergedKey = 'owners/James-Hopewell/will/James-Hopewell-Will-1817-complete.pdf';
  
  try {
    // Step 1: Check if merged file already exists in S3
    console.log('Step 1: Checking for merged file in S3...');
    try {
      const headCmd = new HeadObjectCommand({
        Bucket: config.storage.s3.bucket,
        Key: mergedKey
      });
      const headResult = await s3.send(headCmd);
      console.log('  ✓ Merged file exists:', mergedKey);
      console.log('  ✓ Size:', (headResult.ContentLength / 1024).toFixed(1), 'KB');
      
      // Update database to point to merged file
      await updateDatabase(mergedKey, headResult.ContentLength, 2);
      return;
    } catch (err) {
      if (err.name === 'NotFound') {
        console.log('  Merged file does not exist, creating it...');
      } else {
        throw err;
      }
    }
    
    // Step 2: Download and merge pages
    console.log('\nStep 2: Downloading original pages...');
    
    const page1Cmd = new GetObjectCommand({
      Bucket: config.storage.s3.bucket,
      Key: 'owners/James-Hopewell/will/page-1.pdf'
    });
    const page1Response = await s3.send(page1Cmd);
    const page1Buffer = Buffer.from(await page1Response.Body.transformToByteArray());
    console.log('  ✓ Downloaded page-1.pdf');
    
    const page2Cmd = new GetObjectCommand({
      Bucket: config.storage.s3.bucket,
      Key: 'owners/James-Hopewell/will/page-2.pdf'
    });
    const page2Response = await s3.send(page2Cmd);
    const page2Buffer = Buffer.from(await page2Response.Body.transformToByteArray());
    console.log('  ✓ Downloaded page-2.pdf');
    
    // Step 3: Merge PDFs
    console.log('\nStep 3: Merging PDFs...');
    const page1Doc = await PDFDocument.load(page1Buffer);
    const page2Doc = await PDFDocument.load(page2Buffer);
    const mergedDoc = await PDFDocument.create();
    
    const page1Pages = await mergedDoc.copyPages(page1Doc, page1Doc.getPageIndices());
    page1Pages.forEach(page => mergedDoc.addPage(page));
    
    const page2Pages = await mergedDoc.copyPages(page2Doc, page2Doc.getPageIndices());
    page2Pages.forEach(page => mergedDoc.addPage(page));
    
    const mergedPdfBytes = await mergedDoc.save();
    console.log('  ✓ Merged PDF created:', (mergedPdfBytes.length / 1024).toFixed(1), 'KB');
    
    // Step 4: Upload merged document
    console.log('\nStep 4: Uploading merged document...');
    const uploadCmd = new PutObjectCommand({
      Bucket: config.storage.s3.bucket,
      Key: mergedKey,
      Body: mergedPdfBytes,
      ContentType: 'application/pdf'
    });
    await s3.send(uploadCmd);
    console.log('  ✓ Uploaded to:', mergedKey);
    
    // Step 5: Update database
    await updateDatabase(mergedKey, mergedPdfBytes.length, mergedDoc.getPageCount());
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

async function updateDatabase(mergedKey, fileSize, pageCount) {
  console.log('\nStep 5: Updating database...');
  
  const result = await db.query(`
    UPDATE documents
    SET 
      file_path = $1,
      s3_key = $1,
      filename = 'James-Hopewell-Will-1817-complete.pdf',
      file_size = $2,
      ocr_page_count = $3,
      document_group_id = 'james-hopewell-will-1817',
      updated_at = CURRENT_TIMESTAMP
    WHERE document_id = 'james-hopewell-will-1817'
    RETURNING document_id, filename, file_path, ocr_page_count
  `, [mergedKey, fileSize, pageCount]);
  
  if (result.rows.length > 0) {
    console.log('  ✓ Database updated:');
    console.log('    document_id:', result.rows[0].document_id);
    console.log('    filename:', result.rows[0].filename);
    console.log('    file_path:', result.rows[0].file_path);
    console.log('    ocr_page_count:', result.rows[0].ocr_page_count);
  }
  
  console.log('\n=== James Hopewell Document Fixed! ===\n');
  process.exit(0);
}

fixHopewellDocument();
