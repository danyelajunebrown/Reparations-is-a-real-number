#!/usr/bin/env node
/**
 * One-shot backfill of debug/freedmens-bank/ to S3.
 *
 * Walks every file under debug/freedmens-bank/, computes the S3 key based
 * on the local relative path (with the redundant "enslaver-test/" prefix
 * stripped), and uploads to s3://<bucket>/freedmens-bank/<branch>/<file>.
 * Already-present objects are skipped via HeadObject check, so this is
 * idempotent and safe to re-run.
 *
 * Concurrency is set to 12 by default — high enough to saturate typical
 * residential upload, low enough to not trip S3's per-account limits.
 *
 * Usage:
 *   node scripts/backfill-freedmens-to-s3.js
 *   node scripts/backfill-freedmens-to-s3.js --dry-run    # plan only
 *   node scripts/backfill-freedmens-to-s3.js --branch huntsville-alabama-roll
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const BRANCH_FILTER_IDX = args.indexOf('--branch');
const BRANCH_FILTER = BRANCH_FILTER_IDX !== -1 ? args[BRANCH_FILTER_IDX + 1] : null;
const CONCURRENCY = parseInt(process.env.UPLOAD_CONCURRENCY) || 12;

const ROOT = path.resolve(__dirname, '..', 'debug', 'freedmens-bank', 'enslaver-test');
const BUCKET = process.env.S3_BUCKET;
const REGION = process.env.S3_REGION || 'us-east-2';

const client = new S3Client({ region: REGION });

const contentTypeFor = (filename) => {
    const ext = path.extname(filename).toLowerCase();
    return { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
             '.json': 'application/json', '.txt': 'text/plain' }[ext] || 'application/octet-stream';
};

function walkSync(dir, results = []) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) walkSync(full, results);
        else if (ent.isFile()) results.push(full);
    }
    return results;
}

async function existsInS3(key) {
    try {
        await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
        return true;
    } catch (e) {
        if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return false;
        throw e;
    }
}

async function uploadOne(localPath, key) {
    const body = fs.readFileSync(localPath);
    await client.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: body,
        ContentType: contentTypeFor(localPath),
    }));
    return body.length;
}

async function workerLoop(queue, stats) {
    while (queue.length > 0) {
        const job = queue.shift();
        if (!job) break;
        try {
            const exists = await existsInS3(job.key);
            if (exists) {
                stats.skipped++;
                continue;
            }
            if (DRY_RUN) {
                stats.wouldUpload++;
                stats.bytesPlanned += fs.statSync(job.local).size;
                continue;
            }
            const bytes = await uploadOne(job.local, job.key);
            stats.uploaded++;
            stats.bytes += bytes;
        } catch (e) {
            stats.errors++;
            stats.errorMessages.push(`${job.key}: ${e.name || 'Error'}: ${e.message}`);
            if (stats.errorMessages.length > 20) stats.errorMessages.length = 20;
        }
        // Progress every 100 files
        const total = stats.uploaded + stats.skipped + stats.errors + stats.wouldUpload;
        if (total > 0 && total % 100 === 0) {
            const mb = (stats.bytes / 1024 / 1024).toFixed(1);
            console.log(`  ${total}/${stats.totalFiles}  uploaded=${stats.uploaded} skipped=${stats.skipped} errors=${stats.errors}  ${mb} MB`);
        }
    }
}

async function main() {
    if (!BUCKET) { console.error('S3_BUCKET not set in .env'); process.exit(1); }
    if (!fs.existsSync(ROOT)) { console.error('debug/freedmens-bank/enslaver-test does not exist'); process.exit(1); }

    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  Freedmens Bank → S3 backfill`);
    console.log(`  Mode:        ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
    console.log(`  Bucket:      ${BUCKET} (${REGION})`);
    console.log(`  Concurrency: ${CONCURRENCY}`);
    if (BRANCH_FILTER) console.log(`  Branch:      ${BRANCH_FILTER}`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    const allFiles = walkSync(ROOT);
    const queue = [];
    for (const local of allFiles) {
        const rel = path.relative(ROOT, local);
        const branch = rel.split(path.sep)[0];
        if (BRANCH_FILTER && branch !== BRANCH_FILTER) continue;
        const key = `freedmens-bank/${rel.replace(/\\/g, '/')}`;
        queue.push({ local, key });
    }

    console.log(`Found ${queue.length} files to consider.\n`);

    const stats = {
        totalFiles: queue.length,
        uploaded: 0, skipped: 0, errors: 0, wouldUpload: 0,
        bytes: 0, bytesPlanned: 0, errorMessages: []
    };
    const t0 = Date.now();
    const workers = Array.from({ length: CONCURRENCY }, () => workerLoop(queue, stats));
    await Promise.all(workers);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(`Elapsed: ${elapsed}s`);
    console.log(`Uploaded: ${stats.uploaded} (${(stats.bytes / 1024 / 1024).toFixed(1)} MB)`);
    if (DRY_RUN) console.log(`Would upload: ${stats.wouldUpload} (${(stats.bytesPlanned / 1024 / 1024).toFixed(1)} MB)`);
    console.log(`Skipped (already in S3): ${stats.skipped}`);
    console.log(`Errors:   ${stats.errors}`);
    if (stats.errorMessages.length > 0) {
        console.log(`\nFirst error sample:`);
        for (const m of stats.errorMessages.slice(0, 5)) console.log(`  ${m}`);
    }
    console.log('═══════════════════════════════════════════════════════════════');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
