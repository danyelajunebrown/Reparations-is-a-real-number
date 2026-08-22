// backfill-scan-artifacts.mjs — give every S3-archived scan a source_artifacts row, so rule 8 is
// measurable instead of merely asserted.
//
// WHY (found 2026-08-22 when the operator asked whether the Suriname scans were on Wayback):
//   check-archival-compliance read source_artifacts ONLY — 218 rows — and reported "3 missing Wayback".
//   It was telling the truth about the wrong denominator. person_documents references 128,773 DISTINCT
//   s3 scans, of which 126,738 had NO artifact row at all: no hash, no witness, not even a size. The
//   Suriname registers alone are 68,319 documents over 6,215 folio scans, with exactly ONE artifact row.
//   A monitor that measures the wrong population buys false confidence, which is worse than no monitor.
//
// WHAT IT RECORDS, AND WHAT IT DELIBERATELY DOES NOT
//   HeadObject gives size, content-type and ETag WITHOUT downloading the object. For a single-part upload
//   the ETag IS the MD5, which is a real integrity anchor — enough to detect silent corruption or
//   replacement. So we record it, in `notes`, labelled for what it is.
//   We do NOT write it into `sha256`. That column means one thing, and filling it with a different digest
//   to make a compliance check go green is exactly the move this project keeps getting burned by — a field
//   whose name stops matching its contents (see DLAS `enslavedCount`). sha256 stays NULL until something
//   actually hashes the bytes.
//
// WAYBACK IS A SEPARATE, SLOWER PROBLEM. Save Page Now throttles anonymous callers to ~1 capture/minute
// and answers 500 when exceeded — that is why 4,560 rows written today carry no wayback_url. At 1/min,
// 126,738 captures is 88 days. Per-scan capture is therefore NOT the right unit: most of these scans share
// a handful of source pages (all 68,319 Suriname documents cite one finding aid, nt00461). This script
// records the artifact and leaves wayback_url NULL; backfill-wayback-snapshots.mjs walks DISTINCT source
// URLs at a sustainable rate. Recording the honest gap beats faking 126,738 witnesses.
//
// Usage: node scripts/backfill-scan-artifacts.mjs --limit 5000 [--apply]
import 'dotenv/config';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const A = process.argv.slice(2);
const val = (f, d) => { const i = A.indexOf(f); return i > -1 ? A[i + 1] : d; };
const APPLY = A.includes('--apply');
const LIMIT = +val('--limit', 5000);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false },
  statement_timeout: 900000, query_timeout: 900000 });
pool.on('error', (e) => console.error(`[pool] ${e.message}`));

const rows = (await pool.query(`
  SELECT d.s3_key,
         min(d.source_url) AS source_url,
         min(d.document_type) AS document_type,
         count(*)::int AS doc_count
    FROM person_documents d
   WHERE d.s3_key IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM source_artifacts sa WHERE sa.s3_key = d.s3_key)
   GROUP BY d.s3_key
   LIMIT $1`, [LIMIT])).rows;

console.log(`${APPLY ? '=== APPLY ===' : '=== DRY RUN ==='} ${rows.length} scans with no artifact row`);
if (!rows.length) { await pool.end(); process.exit(0); }

let head = null;
try {
  const { S3Client, HeadObjectCommand } = require('@aws-sdk/client-s3');
  const client = new S3Client({ region: process.env.S3_REGION || process.env.AWS_REGION || 'us-east-2' });
  head = async (Key) => {
    const r = await client.send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key }));
    return { bytes: r.ContentLength, etag: String(r.ETag || '').replace(/"/g, ''), type: r.ContentType };
  };
} catch (e) { console.log(`  (no S3 client: ${e.message.slice(0, 60)} — recording rows without size/etag)`); }

let ok = 0, missing = 0, err = 0;
for (const r of rows) {
  let meta = null;
  if (head) {
    try { meta = await head(r.s3_key); }
    catch (e) {
      // A referenced key that is NOT in the bucket is a REAL finding: the document claims an archive it
      // does not have. Count it loudly rather than writing a row that implies otherwise.
      if (/NotFound|NoSuchKey|404/i.test(e.message)) { missing++; continue; }
      err++; continue;
    }
  }
  if (!APPLY) { ok++; continue; }
  await pool.query(
    `INSERT INTO source_artifacts (artifact_key, dataset_label, source_name, source_url, s3_bucket, s3_key,
       sha256, bytes, content_type, rehostable, retrieved_at, notes)
     VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8,FALSE,now(),$9)
     ON CONFLICT (artifact_key) DO NOTHING`,
    [`s3:${r.s3_key}`, r.document_type || 'archived_scan', 'person_documents backfill',
     r.source_url || 'unrecorded', process.env.S3_BUCKET || null, r.s3_key,
     meta ? meta.bytes : null, meta ? meta.type : null,
     `backfilled 2026-08-22 · serves ${r.doc_count} person_document(s)` +
     (meta ? ` · s3 ETag ${meta.etag} (MD5 for single-part uploads — an integrity anchor, NOT a sha256; ` +
             `sha256 stays NULL until the bytes are actually hashed)` : '') +
     ` · wayback_url NULL: SPN throttles to ~1/min, so witnessing is done per DISTINCT SOURCE URL by ` +
     `backfill-wayback-snapshots.mjs, not per scan`])
    .then(() => { ok++; }).catch((e) => { err++; if (err <= 5) console.error(`  ! ${r.s3_key}: ${e.message.slice(0, 80)}`); });
}
console.log(`=== recorded ${ok} · MISSING FROM BUCKET ${missing} · errors ${err} ===`);
if (missing) console.log(`  ⚠️  ${missing} documents reference an s3_key that is NOT in the bucket — they claim an archive they do not have.`);
await pool.end();
