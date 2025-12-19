/**
 * Verify James Hopewell document merge status
 */
const config = require('../config');
const db = require('../database.js');
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

const s3 = new S3Client({
  region: config.storage.s3.region,
  credentials: {
    accessKeyId: config.storage.s3.accessKeyId,
    secretAccessKey: config.storage.s3.secretAccessKey
  }
});

async function verify() {
  console.log('=== James Hopewell Document Status ===\n');
  
  try {
    // Check S3
    console.log('S3 Files in owners/James-Hopewell/will/:');
    const listCmd = new ListObjectsV2Command({
      Bucket: config.storage.s3.bucket,
      Prefix: 'owners/James-Hopewell/will/'
    });
    const result = await s3.send(listCmd);
    
    if (result.Contents && result.Contents.length > 0) {
      result.Contents.forEach(obj => {
        console.log(`  - ${obj.Key} (${(obj.Size / 1024).toFixed(1)} KB)`);
      });
    } else {
      console.log('  No files found');
    }
    
    // Check Database
    console.log('\nDatabase Record:');
    const dbResult = await db.query(`
      SELECT document_id, filename, file_path, s3_key, ocr_page_count, file_size
      FROM documents WHERE document_id = 'james-hopewell-will-1817'
    `);
    
    if (dbResult.rows.length > 0) {
      const doc = dbResult.rows[0];
      console.log(`  document_id: ${doc.document_id}`);
      console.log(`  filename: ${doc.filename}`);
      console.log(`  file_path: ${doc.file_path}`);
      console.log(`  s3_key: ${doc.s3_key}`);
      console.log(`  ocr_page_count: ${doc.ocr_page_count}`);
      console.log(`  file_size: ${doc.file_size ? (doc.file_size / 1024).toFixed(1) + ' KB' : 'null'}`);
    } else {
      console.log('  Document not found in database');
    }
    
    console.log('\n=== Verification Complete ===');
    
  } catch (error) {
    console.error('Error:', error.message);
  }
  
  process.exit(0);
}

verify();
