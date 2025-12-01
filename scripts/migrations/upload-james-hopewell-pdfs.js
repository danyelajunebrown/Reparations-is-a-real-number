#!/usr/bin/env node
/**
 * Upload James Hopewell PDFs to S3 and update database
 *
 * This script:
 * 1. Uploads the original PDF files to S3
 * 2. Updates the database with correct file paths and mime types
 * 3. Preserves the OCR text already extracted
 *
 * Usage: node upload-james-hopewell-pdfs.js
 */

const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, CreateBucketCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');
const database = require('./database');
const fileType = require('file-type'); // v12 API

// Configuration
const config = {
  s3Bucket: process.env.S3_BUCKET || 'reparations-documents',
  s3Region: process.env.S3_REGION || 'us-east-1',
  documentId: 'd94180c70274f7bf25b735a8', // James Hopewell will document ID

  // Local PDF files to upload
  pdfFiles: [
    '/Users/danyelabrown/Downloads/Transcript.pdf',
    '/Users/danyelabrown/Downloads/Transcript-2.pdf'
  ]
};

async function uploadToS3(filePath, key) {
  console.log(`\nUploading ${path.basename(filePath)} to S3...`);

  // Try with endpoint configuration for region auto-detection
  const s3Client = new S3Client({
    region: config.s3Region,
    forcePathStyle: false,
    useAccelerateEndpoint: false
  });

  // Detect file type (file-type v12 API: buffer-based)
  const buffer = fs.readFileSync(filePath);
  const detectedType = await fileType(buffer);
  if (!detectedType) {
    throw new Error(`Could not detect file type for ${filePath}`);
  }

  console.log(`✓ Detected: ${detectedType.mime} (.${detectedType.ext})`);

  // Get file stats
  const stats = fs.statSync(filePath);
  console.log(`✓ File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

  // Create read stream
  const fileStream = fs.createReadStream(filePath);

  // Upload to S3
  const uploadParams = {
    Bucket: config.s3Bucket,
    Key: key,
    Body: fileStream,
    ContentType: detectedType.mime,
    ContentLength: stats.size,
    Metadata: {
      'original-filename': path.basename(filePath),
      'detected-type': detectedType.mime,
      'upload-date': new Date().toISOString(),
      'document-id': config.documentId
    }
  };

  await s3Client.send(new PutObjectCommand(uploadParams));

  const url = `https://${config.s3Bucket}.s3.${config.s3Region}.amazonaws.com/${key}`;
  console.log(`✓ Uploaded to: ${url}`);

  return {
    key,
    url,
    size: stats.size,
    mimeType: detectedType.mime,
    extension: detectedType.ext
  };
}

async function updateDatabase(uploadResults) {
  console.log('\nUpdating database record...');

  // Combine file sizes
  const totalSize = uploadResults.reduce((sum, r) => sum + r.size, 0);

  // Use the first file's path as the primary file path (multi-page stored separately)
  const primaryFile = uploadResults[0];

  await database.query(`
    UPDATE documents
    SET
      file_path = $1,
      file_size = $2,
      mime_type = $3,
      filename = $4,
      updated_at = CURRENT_TIMESTAMP
    WHERE document_id = $5
  `, [
    primaryFile.key,
    totalSize,
    primaryFile.mimeType,
    `James-Hopewell-will-${uploadResults.length}pages.${primaryFile.extension}`,
    config.documentId
  ]);

  console.log('✓ Database updated successfully');
  console.log(`  Document ID: ${config.documentId}`);
  console.log(`  File path: ${primaryFile.key}`);
  console.log(`  Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  MIME type: ${primaryFile.mimeType}`);
}

async function ensureBucketExists() {
  console.log(`\n🪣 Checking S3 bucket: ${config.s3Bucket}...`);
  const s3Client = new S3Client({ region: config.s3Region });

  try {
    // Try to access the bucket
    await s3Client.send(new HeadBucketCommand({ Bucket: config.s3Bucket }));
    console.log(`✓ Bucket exists and is accessible`);
  } catch (error) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      // Bucket doesn't exist, create it
      console.log(`⚠️  Bucket doesn't exist, creating it...`);
      try {
        await s3Client.send(new CreateBucketCommand({
          Bucket: config.s3Bucket,
          CreateBucketConfiguration: config.s3Region !== 'us-east-1' ? {
            LocationConstraint: config.s3Region
          } : undefined
        }));
        console.log(`✓ Bucket created successfully`);
      } catch (createError) {
        console.error(`❌ Failed to create bucket: ${createError.message}`);
        throw createError;
      }
    } else {
      console.error(`❌ Bucket access error: ${error.message}`);
      throw error;
    }
  }
}

async function main() {
  console.log('========================================');
  console.log('James Hopewell PDFs → S3 Upload Script');
  console.log('========================================\n');

  // Check if S3 credentials are configured
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error('❌ ERROR: AWS credentials not configured');
    console.error('   Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables');
    process.exit(1);
  }

  // Ensure bucket exists
  await ensureBucketExists();

  // Check if files exist
  for (const filePath of config.pdfFiles) {
    if (!fs.existsSync(filePath)) {
      console.error(`❌ ERROR: File not found: ${filePath}`);
      process.exit(1);
    }
  }

  try {
    // Upload each PDF to S3
    const uploadResults = [];

    for (let i = 0; i < config.pdfFiles.length; i++) {
      const filePath = config.pdfFiles[i];
      const key = `owners/James-Hopewell/will/James-Hopewell-will-page${i + 1}.pdf`;

      const result = await uploadToS3(filePath, key);
      uploadResults.push(result);
    }

    // Update database with new file paths
    await updateDatabase(uploadResults);

    console.log('\n========================================');
    console.log('✅ SUCCESS! All files uploaded and database updated');
    console.log('========================================\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = { uploadToS3, updateDatabase };
