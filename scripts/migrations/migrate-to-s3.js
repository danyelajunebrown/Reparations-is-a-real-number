/**
 * Migrate existing local storage files to S3
 * Run: node migrate-to-s3.js
 */

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
const database = require('./database');

async function migrateToS3() {
  // Check S3 configuration
  if (!process.env.S3_ENABLED || process.env.S3_ENABLED !== 'true') {
    console.error('❌ S3_ENABLED must be set to "true" in environment variables');
    process.exit(1);
  }

  if (!process.env.S3_BUCKET) {
    console.error('❌ S3_BUCKET must be set in environment variables');
    process.exit(1);
  }

  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error('❌ AWS credentials must be set (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)');
    process.exit(1);
  }

  const s3Client = new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
  });

  console.log('🚀 Starting S3 migration...');
  console.log(`📦 Target bucket: ${process.env.S3_BUCKET}`);
  console.log(`🌍 Region: ${process.env.S3_REGION || 'us-east-1'}`);

  // Get all documents from database
  const result = await database.query(`
    SELECT document_id, file_path, filename, mime_type, owner_name
    FROM documents
    WHERE file_path LIKE 'storage/%'
    ORDER BY created_at DESC
  `);

  console.log(`\n📄 Found ${result.rows.length} documents to migrate\n`);

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const doc of result.rows) {
    const localPath = doc.file_path;
    const s3Key = doc.file_path.replace(/^storage\//, ''); // Remove 'storage/' prefix

    console.log(`Processing: ${doc.filename}`);
    console.log(`  Local: ${localPath}`);
    console.log(`  S3 Key: ${s3Key}`);

    // Check if local file exists
    if (!fs.existsSync(localPath)) {
      console.log(`  ⚠️  File not found locally, skipping`);
      skipped++;
      continue;
    }

    try {
      // Read file
      const fileContent = fs.readFileSync(localPath);
      const stats = fs.statSync(localPath);

      // Upload to S3
      await s3Client.send(new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: s3Key,
        Body: fileContent,
        ContentType: doc.mime_type || 'application/octet-stream',
        Metadata: {
          'original-filename': doc.filename,
          'owner-name': doc.owner_name || 'unknown',
          'document-id': doc.document_id
        }
      }));

      // Update database record
      const s3Url = `https://${process.env.S3_BUCKET}.s3.${process.env.S3_REGION || 'us-east-1'}.amazonaws.com/${encodeURIComponent(s3Key)}`;

      await database.query(`
        UPDATE documents
        SET file_path = $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE document_id = $2
      `, [s3Url, doc.document_id]);

      console.log(`  ✅ Migrated successfully (${(stats.size / 1024).toFixed(2)} KB)`);
      migrated++;

    } catch (error) {
      console.error(`  ❌ Migration failed: ${error.message}`);
      failed++;
    }

    console.log('');
  }

  console.log('═══════════════════════════════════════');
  console.log('📊 Migration Summary:');
  console.log(`  ✅ Migrated: ${migrated}`);
  console.log(`  ⚠️  Skipped: ${skipped}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`  📄 Total: ${result.rows.length}`);
  console.log('═══════════════════════════════════════');

  process.exit(0);
}

// Run migration
migrateToS3().catch(error => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});
