#!/usr/bin/env node
/**
 * Phase 1.1 verification probe.
 *
 * Fires a single Doc AI processDocument call against the (currently broken)
 * Custom Extractor with one known training image, then prints the timestamp
 * window so we can pull the Cloud Logging entry that GCP wrote on its side.
 *
 * The call is expected to FAIL with INVALID_ARGUMENT — that's the point. We
 * want to confirm (a) Data Access logging is now capturing failures, and
 * (b) the log entry contains the detail field that explains *why* GCP
 * rejected the request. Yesterday that detail was invisible because logging
 * was off.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { extractFromImage } = require('../src/services/document-ai-extractor');

const TEST_IMAGE = path.resolve(
  __dirname,
  '../debug/docai-to-upload/charleston-south-carolina-roll-21__acct-123.png'
);

(async () => {
  if (!fs.existsSync(TEST_IMAGE)) {
    console.error('Test image not found:', TEST_IMAGE);
    process.exit(2);
  }

  const buf = fs.readFileSync(TEST_IMAGE);
  const startedAt = new Date();
  console.log('PROBE_START', startedAt.toISOString());
  console.log('image:', TEST_IMAGE, `(${buf.length} bytes)`);
  console.log('processor: projects/157967637685/locations/us/processors/30049eebf8debcf4/processorVersions/b249cf11f364e209');

  try {
    const out = await extractFromImage(buf);
    console.log('UNEXPECTED_SUCCESS — entities:', out.raw?.entities?.length ?? 0);
  } catch (err) {
    console.log('EXPECTED_FAILURE');
    console.log('  code:', err.code);
    console.log('  message:', err.message?.split('\n')[0]);
    if (err.details) console.log('  details:', JSON.stringify(err.details).slice(0, 500));
    if (err.metadata) console.log('  metadata keys:', Object.keys(err.metadata).join(','));
  }

  const endedAt = new Date();
  console.log('PROBE_END', endedAt.toISOString());
  console.log('\nFetch the audit log entry with:');
  console.log(`  gcloud logging read 'resource.type="documentai.googleapis.com/ProcessorVersion" AND timestamp>="${startedAt.toISOString()}" AND timestamp<="${new Date(endedAt.getTime() + 30000).toISOString()}"' --project=velvety-tangent-476318-u1 --limit=5 --format=json`);
})();
