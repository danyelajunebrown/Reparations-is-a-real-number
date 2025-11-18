// test-s3-connection.js
// Test script to verify S3 configuration before deploying

require('dotenv').config();
const { S3Client, ListBucketsCommand, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

const config = {
  bucket: process.env.S3_BUCKET,
  region: process.env.S3_REGION || 'us-east-1',
  enabled: process.env.S3_ENABLED === 'true'
};

console.log('\n========================================');
console.log('S3 CONNECTION TEST');
console.log('========================================\n');

console.log('Configuration:');
console.log('  S3_ENABLED:', process.env.S3_ENABLED);
console.log('  S3_BUCKET:', config.bucket || 'NOT SET');
console.log('  S3_REGION:', config.region);
console.log('  AWS_ACCESS_KEY_ID:', process.env.AWS_ACCESS_KEY_ID ? '✓ Set (' + process.env.AWS_ACCESS_KEY_ID.substring(0, 8) + '...)' : '✗ NOT SET');
console.log('  AWS_SECRET_ACCESS_KEY:', process.env.AWS_SECRET_ACCESS_KEY ? '✓ Set (hidden)' : '✗ NOT SET');
console.log();

if (!config.enabled) {
  console.log('❌ S3 is DISABLED in environment variables');
  console.log('   Set S3_ENABLED=true in your .env file');
  process.exit(0);
}

if (!config.bucket) {
  console.log('❌ S3_BUCKET is not set');
  console.log('   Set S3_BUCKET=your-bucket-name in your .env file');
  process.exit(1);
}

if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  console.log('❌ AWS credentials are not set');
  console.log('   Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in your .env file');
  process.exit(1);
}

async function testS3Connection() {
  try {
    const s3 = new S3Client({ region: config.region });

    // Test 1: List buckets (verify credentials)
    console.log('Test 1: Verifying AWS credentials...');
    const listCommand = new ListBucketsCommand({});
    const buckets = await s3.send(listCommand);
    console.log('✅ AWS credentials are valid');
    console.log(`   Found ${buckets.Buckets.length} bucket(s) in your account\n`);

    // Test 2: Check if our bucket exists
    console.log('Test 2: Checking if bucket exists...');
    const bucketExists = buckets.Buckets.some(b => b.Name === config.bucket);
    if (bucketExists) {
      console.log(`✅ Bucket "${config.bucket}" exists\n`);
    } else {
      console.log(`❌ Bucket "${config.bucket}" NOT FOUND`);
      console.log('   Available buckets:');
      buckets.Buckets.forEach(b => console.log(`   - ${b.Name}`));
      console.log('\n   Please create the bucket or update S3_BUCKET in .env');
      process.exit(1);
    }

    // Test 3: Upload a test file
    console.log('Test 3: Testing file upload...');
    const testKey = 'test/connection-test-' + Date.now() + '.txt';
    const testContent = 'This is a test file to verify S3 upload permissions.\nCreated at: ' + new Date().toISOString();

    const putCommand = new PutObjectCommand({
      Bucket: config.bucket,
      Key: testKey,
      Body: testContent,
      ContentType: 'text/plain'
    });

    await s3.send(putCommand);
    console.log('✅ Test file uploaded successfully');
    console.log(`   Location: s3://${config.bucket}/${testKey}\n`);

    // Test 4: Download the test file
    console.log('Test 4: Testing file download...');
    const getCommand = new GetObjectCommand({
      Bucket: config.bucket,
      Key: testKey
    });

    const response = await s3.send(getCommand);
    const downloadedContent = await streamToString(response.Body);
    console.log('✅ Test file downloaded successfully');
    console.log(`   Content matches: ${downloadedContent === testContent ? 'YES' : 'NO'}\n`);

    // Summary
    console.log('========================================');
    console.log('✅ ALL TESTS PASSED!');
    console.log('========================================');
    console.log('\nYour S3 configuration is working correctly!');
    console.log('You can now:');
    console.log('  1. Upload documents via the platform');
    console.log('  2. Deploy to Render with the same S3 settings');
    console.log('  3. Check uploaded files in AWS Console:');
    console.log(`     https://s3.console.aws.amazon.com/s3/buckets/${config.bucket}\n`);

    console.log('Test file created at:');
    console.log(`  s3://${config.bucket}/${testKey}`);
    console.log('\nYou can delete it from the AWS Console if desired.\n');

  } catch (error) {
    console.log('\n========================================');
    console.log('❌ TEST FAILED');
    console.log('========================================\n');
    console.log('Error:', error.message);
    console.log('\nCommon issues:');
    console.log('  1. Invalid AWS credentials');
    console.log('  2. Bucket name is incorrect');
    console.log('  3. IAM user lacks S3 permissions');
    console.log('  4. Region mismatch');
    console.log('\nCheck your .env file and AWS IAM settings.\n');
    process.exit(1);
  }
}

// Helper function to convert stream to string
async function streamToString(stream) {
  const chunks = [];
  return new Promise((resolve, reject) => {
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

// Run the test
testS3Connection();
