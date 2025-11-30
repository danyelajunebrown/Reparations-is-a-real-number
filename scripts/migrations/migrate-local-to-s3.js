#!/usr/bin/env node
/**
 * Migrate Local Files to S3
 * Uploads all files from ./storage to S3 and updates database records
 */

const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');
const database = require('./database');
require('dotenv').config();

console.log('📦 MIGRATING LOCAL FILES TO S3');
console.log('='.repeat(70));

// Configure AWS SDK
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.S3_REGION
});

const s3 = new AWS.S3();
const bucket = process.env.S3_BUCKET;

async function uploadFileToS3(localPath, s3Key) {
  const fileContent = fs.readFileSync(localPath);
  const mimeType = getMimeType(localPath);

  await s3.putObject({
    Bucket: bucket,
    Key: s3Key,
    Body: fileContent,
    ContentType: mimeType,
    Metadata: {
      'original-path': localPath,
      'migrated-at': new Date().toISOString()
    }
  }).promise();

  return `https://${bucket}.s3.${process.env.S3_REGION}.amazonaws.com/${s3Key}`;
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.txt': 'text/plain',
    '.json': 'application/json'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

function walkDirectory(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      walkDirectory(filePath, fileList);
    } else {
      fileList.push(filePath);
    }
  });
  return fileList;
}

async function migrate() {
  try {
    // Get all documents from database
    const result = await database.query(`
      SELECT document_id, file_path, filename, owner_name
      FROM documents
      WHERE file_path LIKE './storage/%' OR file_path LIKE 'storage/%'
      ORDER BY created_at DESC
    `);

    console.log(`Found ${result.rows.length} documents with local file paths\n`);

    let uploaded = 0;
    let skipped = 0;
    let errors = 0;

    for (const doc of result.rows) {
      try {
        // Check if file exists locally
        if (!fs.existsSync(doc.file_path)) {
          console.log(`⚠️  MISSING: ${doc.filename} (${doc.file_path})`);
          skipped++;
          continue;
        }

        // Generate S3 key from file path
        // Convert: ./storage/owners/James-Hopewell/will/file.pdf
        // To: owners/James-Hopewell/will/file.pdf
        const s3Key = doc.file_path.replace(/^\.?\/storage\//, '');

        console.log(`📤 Uploading: ${doc.filename}`);
        console.log(`   Owner: ${doc.owner_name}`);
        console.log(`   Local: ${doc.file_path}`);
        console.log(`   S3 Key: ${s3Key}`);

        // Upload to S3
        const s3Url = await uploadFileToS3(doc.file_path, s3Key);

        // Update database with new S3 path
        await database.query(`
          UPDATE documents
          SET file_path = $1,
              updated_at = CURRENT_TIMESTAMP
          WHERE document_id = $2
        `, [s3Key, doc.document_id]);

        console.log(`   ✅ Uploaded: ${s3Url}\n`);
        uploaded++;

      } catch (error) {
        console.error(`   ❌ Error uploading ${doc.filename}: ${error.message}\n`);
        errors++;
      }
    }

    console.log('='.repeat(70));
    console.log('📊 MIGRATION SUMMARY');
    console.log('='.repeat(70));
    console.log(`✅ Uploaded: ${uploaded} files`);
    console.log(`⚠️  Skipped (missing): ${skipped} files`);
    console.log(`❌ Errors: ${errors} files`);
    console.log('='.repeat(70));

    if (uploaded > 0) {
      console.log('\n✅ Migration complete! Files are now in S3.');
      console.log('🔧 Next step: Update Render environment variables:');
      console.log('   - S3_ENABLED=true');
      console.log('   - S3_BUCKET=' + bucket);
      console.log('   - S3_REGION=' + process.env.S3_REGION);
      console.log('   - AWS_ACCESS_KEY_ID=' + process.env.AWS_ACCESS_KEY_ID.substring(0, 8) + '...');
      console.log('   - AWS_SECRET_ACCESS_KEY=***');
    }

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
migrate().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
