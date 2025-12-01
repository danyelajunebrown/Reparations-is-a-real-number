#!/usr/bin/env node
/**
 * Upload Scraped Documents to S3
 * Uploads all files from ./scraped-documents to S3
 */

const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

console.log('📦 UPLOADING SCRAPED DOCUMENTS TO S3');
console.log('='.repeat(70));

// Configure AWS SDK
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.S3_REGION
});

const s3 = new AWS.S3();
const bucket = process.env.S3_BUCKET;
const scrapedDir = './scraped-documents';

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.json': 'application/json'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

async function uploadFileToS3(localPath, filename) {
  const fileContent = fs.readFileSync(localPath);
  const mimeType = getMimeType(localPath);

  // S3 key: scraped-documents/filename
  const s3Key = `scraped-documents/${filename}`;

  await s3.putObject({
    Bucket: bucket,
    Key: s3Key,
    Body: fileContent,
    ContentType: mimeType,
    Metadata: {
      'original-path': localPath,
      'migrated-at': new Date().toISOString(),
      'source': 'web-scraper'
    }
  }).promise();

  return `https://${bucket}.s3.${process.env.S3_REGION}.amazonaws.com/${s3Key}`;
}

async function uploadScrapedDocuments() {
  try {
    // Get all files in scraped-documents directory
    const files = fs.readdirSync(scrapedDir);

    console.log(`Found ${files.length} files in ${scrapedDir}\n`);

    let uploaded = 0;
    let skipped = 0;
    let errors = 0;

    for (const filename of files) {
      const filePath = path.join(scrapedDir, filename);

      // Skip directories
      if (fs.statSync(filePath).isDirectory()) {
        skipped++;
        continue;
      }

      try {
        console.log(`📤 Uploading: ${filename}`);
        console.log(`   Local: ${filePath}`);
        console.log(`   Size: ${(fs.statSync(filePath).size / 1024).toFixed(2)} KB`);

        // Upload to S3
        const s3Url = await uploadFileToS3(filePath, filename);

        console.log(`   ✅ Uploaded: ${s3Url}\n`);
        uploaded++;

      } catch (error) {
        console.error(`   ❌ Error uploading ${filename}: ${error.message}\n`);
        errors++;
      }
    }

    console.log('='.repeat(70));
    console.log('📊 UPLOAD SUMMARY');
    console.log('='.repeat(70));
    console.log(`✅ Uploaded: ${uploaded} files`);
    console.log(`⏭️  Skipped: ${skipped} files`);
    console.log(`❌ Errors: ${errors} files`);
    console.log('='.repeat(70));

    if (uploaded > 0) {
      console.log('\n✅ Upload complete! Scraped documents are now in S3.');
      console.log(`📍 S3 Location: s3://${bucket}/scraped-documents/`);
    }

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Upload failed:', error);
    process.exit(1);
  }
}

// Run upload
uploadScrapedDocuments().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
