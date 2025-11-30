#!/usr/bin/env node
/**
 * Delete Scraped Documents from S3
 */

const AWS = require('aws-sdk');
require('dotenv').config();

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.S3_REGION
});

const s3 = new AWS.S3();
const bucket = process.env.S3_BUCKET;

const filesToDelete = [
  '1763756547969_814177e4_Scholars-Commission-Report-1.pdf',
  '1763756549191_5af4be13_01-07-02-0342',
  '1763756550230_1d78d13a_01-07-02-0388',
  '1763756551275_298baaf7_01-04-02-0417',
  '1763756552317_029a8e2d_01-07-02-0214',
  '1763756553362_e2e21513_98-01-02-5893',
  '1763756554408_12d2c80c_03-07-02-0011',
  '1763756555461_7169e5a6_03-06-02-0333',
  '1763756556799_1dec107c_InsideVMNH07.pdf',
  '1763756559784_de005be1_InsideVMNH07.pdf',
  '1763756561822_7006135f_thomas%20jefferson%20and%20antislavery%20_%20the%20myth%20goes%20on%20_%20paul%20finkelman.pdf',
  '1763756563050_62196c61_v1ch8s41.html',
  '1763756564184_88603e13_03-07-02-0167',
  '1763756569215_07c2e41b_front_matter_and_report.pdf',
  '1764181483922_c17c5af0_BK-Header-4.jpg',
  '1764184849729_2991124a_cww.00036.003.jpg'
];

async function deleteFiles() {
  console.log('🗑️  DELETING FILES FROM S3');
  console.log('='.repeat(70));

  let deleted = 0;
  let errors = 0;

  for (const filename of filesToDelete) {
    try {
      const key = `scraped-documents/${filename}`;
      await s3.deleteObject({
        Bucket: bucket,
        Key: key
      }).promise();

      console.log(`✅ Deleted: ${key}`);
      deleted++;
    } catch (error) {
      console.error(`❌ Error deleting ${filename}: ${error.message}`);
      errors++;
    }
  }

  console.log('='.repeat(70));
  console.log(`✅ Deleted: ${deleted} files`);
  console.log(`❌ Errors: ${errors} files`);
  console.log('='.repeat(70));

  process.exit(0);
}

deleteFiles().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
