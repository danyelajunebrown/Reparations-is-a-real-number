#!/usr/bin/env node
/**
 * backfill-source-url-docs-to-s3.js
 *
 * Phase 5 backfill: download person_documents rows that have source_url
 * but no s3_key, and upload them to S3 when possible.
 *
 * IMPORTANT NOTES ON FAMILYSEARCH TREE_PROFILE DOCS:
 *   - 2891 rows with document_type='tree_profile' and source_url pointing to
 *     familysearch.org/tree/person/... pages.
 *   - These are HTML genealogy profile pages, NOT downloadable PDFs/images.
 *   - They display correctly as external links in the new PersonProfile.jsx
 *     (source_url → <a target="_blank">) without S3 involvement.
 *   - DO NOT attempt to download/archive FamilySearch profile pages — they
 *     require authentication and the content changes over time.
 *
 * WHAT THIS SCRIPT HANDLES:
 *   - person_documents where source_url is a public PDF (e.g. MSA PDFs)
 *   - person_documents where source_url is a direct image (jpg/png/tiff)
 *   - Skips FamilySearch and other auth-gated sources
 *
 * Usage:
 *   node scripts/backfill-source-url-docs-to-s3.js [--dry-run] [--limit 100]
 *   node scripts/backfill-source-url-docs-to-s3.js --source msa --limit 50
 *
 * Options:
 *   --dry-run     Print what would be uploaded without actually doing it
 *   --limit N     Maximum number of rows to process (default: 100)
 *   --source      Filter by source domain (e.g. 'msa', 'nara', 'loc')
 *   --concurrency Parallel uploads (default: 3)
 */

require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const https = require('https');
const http = require('http');
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const path = require('path');

// ─── Config ──────────────────────────────────────────────────────────────────
const DRY_RUN     = process.argv.includes('--dry-run');
const LIMIT       = parseInt(process.argv[process.argv.indexOf('--limit') + 1] || 100);
const SOURCE_FILTER = process.argv.includes('--source')
    ? process.argv[process.argv.indexOf('--source') + 1] : null;
const CONCURRENCY = parseInt(process.argv[process.argv.indexOf('--concurrency') + 1] || 3);

const S3_BUCKET = process.env.AWS_S3_BUCKET || 'reparations-documents';
const S3_PREFIX = 'person-documents/backfill';

// Sources that are publicly downloadable (no auth required)
const DOWNLOADABLE_SOURCES = [
    'msa.maryland.gov',
    'nara.gov',
    'archives.gov',
    'loc.gov',
    'fold3.com',
    'chroniclingamerica.loc.gov',
    'docsouth.unc.edu',
];

// Sources to skip (auth-gated or HTML-only)
const SKIP_SOURCES = [
    'familysearch.org',
    'ancestry.com',
    'findmypast.com',
    'myheritage.com',
    'beyondkin.org',
];

// ─── S3 Client ───────────────────────────────────────────────────────────────
const s3 = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function shouldSkip(url) {
    if (!url) return true;
    return SKIP_SOURCES.some(domain => url.includes(domain));
}

function isDownloadable(url) {
    if (!url) return false;
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    const downloadableExts = ['.pdf', '.jpg', '.jpeg', '.png', '.tiff', '.tif', '.gif'];
    return downloadableExts.includes(ext) ||
        DOWNLOADABLE_SOURCES.some(domain => url.includes(domain));
}

function fetchBuffer(url) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https://') ? https : http;
        const req = protocol.get(url, {
            headers: {
                'User-Agent': 'Reparations Research Archive Bot (contact: research@reparationsproject.org)',
            },
            timeout: 30000,
        }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                return fetchBuffer(res.headers.location).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
            }
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve({
                buffer: Buffer.concat(chunks),
                contentType: res.headers['content-type'] || 'application/octet-stream',
            }));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
    });
}

async function s3KeyExists(key) {
    try {
        await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
        return true;
    } catch {
        return false;
    }
}

function urlToS3Key(id, url) {
    const parsed = new URL(url);
    const filename = path.basename(parsed.pathname) || `doc-${id}`;
    return `${S3_PREFIX}/${id}-${filename}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    const sql = neon(process.env.DATABASE_URL);

    console.log(`\n${'='.repeat(60)}`);
    console.log('BACKFILL: person_documents source_url → S3');
    console.log(`${'='.repeat(60)}`);
    console.log(`Mode:        ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
    console.log(`Limit:       ${LIMIT}`);
    console.log(`Source:      ${SOURCE_FILTER || 'all downloadable'}`);
    console.log(`Concurrency: ${CONCURRENCY}`);
    console.log();

    // Query rows that need backfill
    let rows;
    if (SOURCE_FILTER) {
        rows = await sql`
            SELECT id, canonical_person_id, name_as_appears, document_type, source_url
            FROM person_documents
            WHERE s3_key IS NULL
              AND source_url IS NOT NULL
              AND source_url ILIKE ${`%${SOURCE_FILTER}%`}
            ORDER BY id
            LIMIT ${LIMIT}
        `;
    } else {
        rows = await sql`
            SELECT id, canonical_person_id, name_as_appears, document_type, source_url
            FROM person_documents
            WHERE s3_key IS NULL
              AND source_url IS NOT NULL
              AND document_type != 'tree_profile'
            ORDER BY id
            LIMIT ${LIMIT}
        `;
    }

    console.log(`Found ${rows.length} rows to process`);

    // Filter to downloadable sources
    const processable = rows.filter(r => !shouldSkip(r.source_url) && isDownloadable(r.source_url));
    const skipped = rows.length - processable.length;
    console.log(`  Processable: ${processable.length}`);
    console.log(`  Skipped (auth-gated/tree-profile): ${skipped}`);
    console.log();

    if (DRY_RUN) {
        console.log('DRY RUN — would process:');
        processable.slice(0, 20).forEach(r => {
            console.log(`  [${r.id}] ${r.name_as_appears} | ${r.document_type} | ${r.source_url}`);
        });
        if (processable.length > 20) console.log(`  ... and ${processable.length - 20} more`);
        return;
    }

    // Process in batches
    let uploaded = 0, failed = 0, alreadyExists = 0;
    const errors = [];

    for (let i = 0; i < processable.length; i += CONCURRENCY) {
        const batch = processable.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(async (row) => {
            const s3Key = urlToS3Key(row.id, row.source_url);
            try {
                // Skip if already in S3
                if (await s3KeyExists(s3Key)) {
                    console.log(`  SKIP (exists) [${row.id}] ${s3Key}`);
                    // Update DB to point at existing S3 key
                    const s3Url = `https://${S3_BUCKET}.s3.amazonaws.com/${s3Key}`;
                    await sql`
                        UPDATE person_documents
                        SET s3_key = ${s3Key}, s3_url = ${s3Url}
                        WHERE id = ${row.id}
                    `;
                    alreadyExists++;
                    return;
                }

                console.log(`  FETCH [${row.id}] ${row.source_url.slice(0, 80)}`);
                const { buffer, contentType } = await fetchBuffer(row.source_url);

                // Upload to S3
                await s3.send(new PutObjectCommand({
                    Bucket: S3_BUCKET,
                    Key: s3Key,
                    Body: buffer,
                    ContentType: contentType,
                    Metadata: {
                        'person-doc-id': String(row.id),
                        'canonical-person-id': String(row.canonical_person_id),
                        'source-url': row.source_url,
                        'name-as-appears': row.name_as_appears || '',
                        'document-type': row.document_type || '',
                    },
                }));

                const s3Url = `https://${S3_BUCKET}.s3.amazonaws.com/${s3Key}`;

                // Update DB
                await sql`
                    UPDATE person_documents
                    SET s3_key = ${s3Key}, s3_url = ${s3Url}
                    WHERE id = ${row.id}
                `;

                console.log(`  ✓ UPLOADED [${row.id}] ${s3Key} (${(buffer.length / 1024).toFixed(0)}KB)`);
                uploaded++;
            } catch (err) {
                console.error(`  ✗ FAILED [${row.id}] ${err.message}`);
                errors.push({ id: row.id, url: row.source_url, error: err.message });
                failed++;
            }
        }));
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log('BACKFILL COMPLETE');
    console.log(`  Uploaded:      ${uploaded}`);
    console.log(`  Already in S3: ${alreadyExists}`);
    console.log(`  Failed:        ${failed}`);
    console.log(`  Skipped:       ${skipped}`);
    if (errors.length > 0) {
        console.log('\nErrors:');
        errors.forEach(e => console.log(`  [${e.id}] ${e.url}: ${e.error}`));
    }
    console.log(`${'='.repeat(60)}\n`);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
