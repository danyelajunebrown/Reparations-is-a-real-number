/**
 * Backfill Internet Archive for existing person_documents.
 *
 * Processes all rows where:
 *   s3_key IS NOT NULL AND ia_item_id IS NULL   → upload to IA (Strategy A/B)
 *   source_url IS NOT NULL AND wayback_url IS NULL
 *     AND s3_key IS NULL AND source_type != 'familysearch'  → Save Page Now (Strategy C)
 *
 * Priority order within Strategy A/B:
 *   1. will, estate_inventory, deed, case_register (uploaded originals)
 *   2. probate_record / 'familysearch' source (scraped screenshots)
 *   3. everything else
 *
 * Usage:
 *   node scripts/backfill-ia-archive.js [options]
 *
 * Options:
 *   --dry-run        Show what would be uploaded without doing it
 *   --limit N        Stop after N items (default: unlimited)
 *   --strategy A|B|C Run only one strategy (default: all)
 *   --doc-type X     Filter by document_type
 *   --verbose        Print per-item detail
 *   --concurrency N  Parallel uploads (default: 2, max: 4)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const pg = require('pg');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const IAService = require('../src/services/storage/InternetArchiveService');
const { InternetArchiveService } = require('../src/services/storage/InternetArchiveService');

const argv   = process.argv.slice(2);
const flag   = (name) => argv.includes(name);
const opt    = (name, def = null) => { const i = argv.indexOf(name); return (i !== -1 && argv[i + 1]) ? argv[i + 1] : def; };

const DRY_RUN     = flag('--dry-run');
const VERBOSE     = flag('--verbose');
const LIMIT       = opt('--limit') ? parseInt(opt('--limit'), 10) : Infinity;
const STRATEGY    = opt('--strategy', 'all');   // 'A', 'B', 'C', or 'all'
const DOC_TYPE    = opt('--doc-type', null);
const CONCURRENCY = Math.min(parseInt(opt('--concurrency', '2'), 10), 4);

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

// S3 client for downloading originals
const s3 = new S3Client({
    region: process.env.S3_REGION || 'us-east-2',
    credentials: {
        accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});
const S3_BUCKET = process.env.S3_BUCKET;

function log(...args) { console.log(new Date().toISOString().slice(11, 19), ...args); }

// Download a buffer from S3 (for Strategy B — uploaded originals)
async function downloadFromS3(s3Key) {
    const cmd = new GetObjectCommand({ Bucket: S3_BUCKET, Key: s3Key });
    const resp = await s3.send(cmd);
    const chunks = [];
    for await (const chunk of resp.Body) chunks.push(chunk);
    return { buffer: Buffer.concat(chunks), contentType: resp.ContentType || 'application/octet-stream' };
}

// Determine file extension from mime_type or document_type
function guessExt(mimeType, docType) {
    if (mimeType === 'application/pdf')  return 'pdf';
    if (mimeType === 'image/jpeg')       return 'jpg';
    if (mimeType === 'image/png')        return 'png';
    if (docType === 'will' || docType === 'estate_inventory' || docType === 'deed' || docType === 'case_register') return 'pdf';
    return 'jpg';
}

// Build IA metadata object from a person_documents row
function buildMetadata(pd) {
    const docLabel = (pd.document_type || 'document').replace('_', ' ');
    return {
        title:       pd.title || `${docLabel} — ${pd.name_as_appears || 'Unknown'}${pd.document_year ? ` (${pd.document_year})` : ''}`,
        description: [
            pd.title || '',
            pd.collection_name || '',
            pd.source_url ? `Source: ${pd.source_url}` : '',
            `Document type: ${pd.document_type || 'unknown'}`,
        ].filter(Boolean).join('. '),
        year:   pd.document_year || null,
        source: pd.source_url || pd.s3_url || null,
    };
}

// ── Strategy A/B: upload S3 content to IA ─────────────────────────────────────
async function processUpload(pd) {
    const isScrapedImage = pd.source_type === 'familysearch';
    const ext = guessExt(pd.mime_type, pd.document_type);

    let fileBuffer, contentType;

    if (DRY_RUN) {
        log(`  [DRY RUN] Would upload ${pd.id} (${pd.document_type}) → IA`);
        return true;
    }

    try {
        const dl = await downloadFromS3(pd.s3_key);
        fileBuffer   = dl.buffer;
        contentType  = dl.contentType;
    } catch (err) {
        log(`  WARN: S3 download failed for pd ${pd.id}: ${err.message}`);
        return false;
    }

    const iaIdentifier = InternetArchiveService.buildIdentifier(pd);
    const files = [];

    if (isScrapedImage) {
        // Strategy A: image + any stored transcript
        files.push({ filename: 'image.jpg', buffer: fileBuffer, contentType: 'image/jpeg' });
        if (pd.ocr_text && pd.ocr_text.length > 5) {
            files.push({
                filename:    'transcript.txt',
                buffer:      Buffer.from(pd.ocr_text, 'utf8'),
                contentType: 'text/plain',
            });
        }
        const meta = {
            source_url:   pd.source_url,
            document_type: pd.document_type,
            name_as_appears: pd.name_as_appears,
            document_year: pd.document_year,
            collection_name: pd.collection_name,
            archivedAt:   new Date().toISOString(),
        };
        files.push({
            filename:    'metadata.json',
            buffer:      Buffer.from(JSON.stringify(meta, null, 2), 'utf8'),
            contentType: 'application/json',
        });
    } else {
        // Strategy B: original file + metadata
        files.push({ filename: `original.${ext}`, buffer: fileBuffer, contentType });
        files.push({
            filename:    'metadata.json',
            buffer:      Buffer.from(JSON.stringify({
                document_type: pd.document_type,
                name_as_appears: pd.name_as_appears,
                document_year: pd.document_year,
                collection_name: pd.collection_name,
                source_url: pd.source_url,
                archivedAt: new Date().toISOString(),
            }, null, 2), 'utf8'),
            contentType: 'application/json',
        });
    }

    const metadata = buildMetadata(pd);
    const result = await IAService.uploadItem(iaIdentifier, files, metadata);
    if (!result) return false;

    await pool.query(
        'UPDATE person_documents SET ia_item_id = $1 WHERE id = $2',
        [result.itemId, pd.id]
    );
    if (VERBOSE) log(`  Uploaded pd ${pd.id} → ${result.itemUrl}`);
    return true;
}

// ── Strategy C: Save Page Now ──────────────────────────────────────────────────
async function processSpn(pd) {
    if (DRY_RUN) {
        log(`  [DRY RUN] Would SPN ${pd.id} → ${pd.source_url}`);
        return true;
    }

    const waybackUrl = await IAService.savePageNow(pd.source_url);
    if (!waybackUrl) return false;

    await pool.query(
        'UPDATE person_documents SET wayback_url = $1 WHERE id = $2',
        [waybackUrl, pd.id]
    );
    if (VERBOSE) log(`  SPN pd ${pd.id} → ${waybackUrl}`);
    return true;
}

// ── Batch processor with concurrency limit ─────────────────────────────────────
async function runBatch(rows, processFn) {
    let done = 0, ok = 0, fail = 0;

    async function worker(batch) {
        for (const row of batch) {
            try {
                const success = await processFn(row);
                if (success) ok++; else fail++;
            } catch (err) {
                fail++;
                log(`  ERROR pd ${row.id}: ${err.message}`);
            }
            done++;
            if (done % 25 === 0) log(`  Progress: ${done}/${rows.length} (ok=${ok} fail=${fail})`);
        }
    }

    // Split rows across N workers
    const chunkSize = Math.ceil(rows.length / CONCURRENCY);
    const chunks = [];
    for (let i = 0; i < CONCURRENCY; i++) {
        chunks.push(rows.slice(i * chunkSize, (i + 1) * chunkSize));
    }
    await Promise.all(chunks.map(worker));
    return { done, ok, fail };
}

async function main() {
    if (!IAService.isEnabled() && !DRY_RUN) {
        console.error('IA upload is disabled. Set IA_UPLOAD_ENABLED=true and IA_ACCESS_KEY/IA_SECRET_KEY.');
        process.exit(1);
    }

    log(`Starting IA backfill — strategy=${STRATEGY} concurrency=${CONCURRENCY} dry-run=${DRY_RUN}`);

    // ── Strategy A/B: S3 items without ia_item_id ─────────────────────────────
    if (STRATEGY === 'all' || STRATEGY === 'A' || STRATEGY === 'B') {
        const docTypeClause = DOC_TYPE ? `AND document_type = '${DOC_TYPE}'` : '';
        const result = await pool.query(`
            SELECT id, s3_key, s3_url, source_url, source_type, document_type, mime_type,
                   name_as_appears, document_year, ocr_text, title, collection_name,
                   collection_key, image_number
            FROM person_documents
            WHERE s3_key IS NOT NULL
              AND ia_item_id IS NULL
              ${docTypeClause}
            ORDER BY
              (CASE document_type
                WHEN 'will'              THEN 1
                WHEN 'estate_inventory'  THEN 2
                WHEN 'deed'              THEN 3
                WHEN 'case_register'     THEN 4
                ELSE 5
              END),
              id ASC
            LIMIT $1
        `, [LIMIT === Infinity ? 1000000 : LIMIT]);

        const rows = result.rows;
        log(`Strategy A/B: ${rows.length} person_documents to upload`);

        if (rows.length > 0) {
            const { done, ok, fail } = await runBatch(rows, processUpload);
            log(`Strategy A/B complete: ${done} processed, ${ok} succeeded, ${fail} failed`);
        }
    }

    // ── Strategy C: public-URL items without wayback_url ──────────────────────
    if (STRATEGY === 'all' || STRATEGY === 'C') {
        const remaining = LIMIT === Infinity ? 1000000 : LIMIT;
        const result = await pool.query(`
            SELECT id, source_url, document_type, name_as_appears, document_year
            FROM person_documents
            WHERE source_url IS NOT NULL
              AND s3_key IS NULL
              AND wayback_url IS NULL
              AND source_type != 'familysearch'
              AND source_url LIKE 'http%'
            ORDER BY id ASC
            LIMIT $1
        `, [remaining]);

        const rows = result.rows;
        log(`Strategy C: ${rows.length} source URLs to submit to Save Page Now`);

        if (rows.length > 0) {
            const { done, ok, fail } = await runBatch(rows, processSpn);
            log(`Strategy C complete: ${done} processed, ${ok} succeeded, ${fail} failed`);
        }
    }

    await pool.end();
    log('Backfill done.');
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
