#!/usr/bin/env node
/**
 * Download File from S3 for Verification
 */

const AWS = require('aws-sdk');
const fs = require('fs');
require('dotenv').config();

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.S3_REGION
});

const s3 = new AWS.S3();
const bucket = process.env.S3_BUCKET;
const key = 'storage/owners/James-Hopewell/will/James-Hopewell-will-1763564287838.pdf';
const outputPath = './james-hopewell-from-s3.pdf';

async function downloadFile() {
  console.log('📥 Downloading from S3...');
  console.log(`   Bucket: ${bucket}`);
  console.log(`   Key: ${key}`);

  try {
    const data = await s3.getObject({
      Bucket: bucket,
      Key: key
    }).promise();

    fs.writeFileSync(outputPath, data.Body);

    console.log(`\n✅ Downloaded successfully`);
    console.log(`   Size: ${(data.Body.length / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Content-Type: ${data.ContentType}`);
    console.log(`   Saved to: ${outputPath}`);

    // Check file integrity
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(data.Body).digest('hex');
    console.log(`   SHA256: ${hash}`);

    console.log(`\n📊 Database SHA256: d7e9d9f70edcc88fe6438da976395c75d1856ea7c5b41dc6280d7905fa3b4f65`);
    console.log(`   Match: ${hash === 'd7e9d9f70edcc88fe6438da976395c75d1856ea7c5b41dc6280d7905fa3b4f65' ? 'YES ✅' : 'NO ❌'}`);

  } catch (error) {
    console.error('❌ Download failed:', error.message);
    process.exit(1);
  }
}

downloadFile();
