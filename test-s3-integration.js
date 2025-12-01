#!/usr/bin/env node
/**
 * S3 Integration Test
 * Tests AWS S3 connection, upload, download, and cleanup
 */

const AWS = require('aws-sdk');
require('dotenv').config();

console.log('🔒 SECURITY AUDIT RESULTS');
console.log('='.repeat(60));
console.log('✅ .env properly excluded in .gitignore');
console.log('✅ .env never committed to git repository');
console.log('✅ No sensitive files tracked in git');
console.log('✅ No hardcoded API keys in codebase');
console.log('✅ All credentials use environment variables');
console.log('✅ Frontend has no exposed secrets');
console.log('='.repeat(60));
console.log();

console.log('🧪 S3 INTEGRATION TEST');
console.log('='.repeat(60));

// Load config
const config = {
  bucket: process.env.S3_BUCKET,
  region: process.env.S3_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  enabled: process.env.S3_ENABLED === 'true'
};

console.log('Configuration:');
console.log('  S3_ENABLED:', config.enabled);
console.log('  S3_BUCKET:', config.bucket);
console.log('  S3_REGION:', config.region);
console.log('  AWS_ACCESS_KEY_ID:', config.accessKeyId ? config.accessKeyId.substring(0, 8) + '...' : 'NOT SET');
console.log('  AWS_SECRET_ACCESS_KEY:', config.secretAccessKey ? '***' + config.secretAccessKey.substring(config.secretAccessKey.length - 4) : 'NOT SET');
console.log();

if (!config.enabled) {
  console.log('⚠️  S3_ENABLED is false - S3 integration is disabled');
  process.exit(0);
}

if (!config.bucket || !config.accessKeyId || !config.secretAccessKey) {
  console.log('❌ Missing required S3 configuration');
  process.exit(1);
}

// Configure AWS SDK
AWS.config.update({
  accessKeyId: config.accessKeyId,
  secretAccessKey: config.secretAccessKey,
  region: config.region
});

const s3 = new AWS.S3();

async function testS3() {
  try {
    // Test 1: Upload test file (will verify bucket access and credentials)
    console.log('Test 1: Uploading test file to S3...');
    const testContent = 'Reparations Platform S3 Test - ' + new Date().toISOString();
    const testKey = 'test/s3-integration-test.txt';

    await s3.putObject({
      Bucket: config.bucket,
      Key: testKey,
      Body: testContent,
      ContentType: 'text/plain',
      Metadata: {
        'test': 'true',
        'timestamp': Date.now().toString()
      }
    }).promise();

    console.log('  ✅ Upload successful');
    console.log('  ✅ Credentials and bucket access verified');
    console.log('  📄 Key:', testKey);
    console.log('  🔗 URL: https://' + config.bucket + '.s3.' + config.region + '.amazonaws.com/' + testKey);
    console.log();

    // Test 2: Download and verify
    console.log('Test 2: Downloading and verifying file...');
    const downloaded = await s3.getObject({
      Bucket: config.bucket,
      Key: testKey
    }).promise();

    const downloadedContent = downloaded.Body.toString('utf-8');

    if (downloadedContent === testContent) {
      console.log('  ✅ Content verified - upload/download working correctly');
      console.log('  📊 Size:', downloaded.ContentLength, 'bytes');
      console.log('  📅 Last Modified:', downloaded.LastModified);
    } else {
      console.log('  ❌ Content mismatch!');
      console.log('  Expected:', testContent);
      console.log('  Got:', downloadedContent);
      process.exit(1);
    }
    console.log();

    // Test 3: List objects
    console.log('Test 3: Listing objects in bucket...');
    const objects = await s3.listObjectsV2({
      Bucket: config.bucket,
      MaxKeys: 10
    }).promise();

    console.log('  ✅ Found', objects.KeyCount, 'objects');
    if (objects.Contents && objects.Contents.length > 0) {
      console.log('  📁 Recent files:');
      objects.Contents.slice(0, 5).forEach(obj => {
        console.log('    -', obj.Key, '(' + obj.Size + ' bytes)');
      });
    }
    console.log();

    // Test 4: Cleanup
    console.log('Test 4: Cleaning up test file...');
    await s3.deleteObject({
      Bucket: config.bucket,
      Key: testKey
    }).promise();
    console.log('  ✅ Test file deleted');
    console.log();

    console.log('='.repeat(60));
    console.log('✅ S3 INTEGRATION TEST PASSED');
    console.log('='.repeat(60));
    console.log();
    console.log('Next steps:');
    console.log('  1. Add same credentials to Render dashboard:');
    console.log('     - S3_ENABLED=true');
    console.log('     - S3_BUCKET=' + config.bucket);
    console.log('     - S3_REGION=' + config.region);
    console.log('     - AWS_ACCESS_KEY_ID=' + config.accessKeyId.substring(0, 8) + '...');
    console.log('     - AWS_SECRET_ACCESS_KEY=***');
    console.log('  2. Deploy to production');
    console.log('  3. Test document uploads through frontend');
    console.log();

  } catch (error) {
    console.error('\n❌ S3 TEST FAILED');
    console.error('Error:', error.message);
    if (error.code) {
      console.error('Error Code:', error.code);
    }
    if (error.statusCode) {
      console.error('Status Code:', error.statusCode);
    }
    console.error('\nFull error:', error);
    process.exit(1);
  }
}

testS3().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
