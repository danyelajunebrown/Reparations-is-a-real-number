#!/usr/bin/env node
/**
 * archive-msa-sc2908-to-s3.js
 *
 * Preservation script: Downloads all 132 unique MSA SC 2908 PDFs from
 * msa.maryland.gov and uploads them to S3. Then creates person_documents
 * rows linking each of the ~18,203 enslaved_individuals to their S3-preserved PDF.
 *
 * MSA SC 2908 = "Certificates of Freedom for Blacks, 1806–1864" (Maryland)
 * URL pattern:  https://msa.maryland.gov/megafile/msa/speccol/sc2900/sc2908/000001/000812/pdf/am812--{N}.pdf
 * S3 key:       msa/sc2908/am812--{N}.pdf
 *
 * Phases:
 *   1. Ensure migration 063 (enslaved_individual_id column) is applied
 *   2. Download all 132 unique PDFs → S3 (skips already-uploaded)
 *   3. Batch-insert person_documents rows for every enslaved_individual
 *      that references a now-preserved PDF (skips already-linked rows)
 *
 * Usage:
 *   node scripts/archive-msa-sc2908-to-s3.js
 *   node scripts/archive-msa-sc2908-to-s3.js --dry-run
 *   node scripts/archive-msa-sc2908-to-s3.js --skip-download   # only insert person_documents
 *   node scripts/archive-msa-sc2908-to-s3.js --limit 5          # test with 5 PDFs
 *   node scripts/archive-msa-sc2908-to-s3.js --concurrency 5
 */

'use strict';
require('dotenv').config();

const { neon }        = require('@neondatabase/serverless');
const https           = require('https');
const http            = require('http');
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');

// ─── CLI flags ────────────────────────────────────────────────────────────────
const argv         = process.argv.slice(2);
const DRY_RUN      = argv.includes('--dry-run');
const SKIP_DL      = argv.includes('--skip-download');
const LIMIT        = argv.includes('--limit') ? parseInt(argv[argv.indexOf('--limit') + 1]) : Infinity;
const CONCURRENCY  = argv.includes('--concurrency') ? parseInt(argv[argv.indexOf('--concurrency') + 1]) : 4;
const BATCH_INSERT = 200;   // rows per DB insert batch

// ─── AWS / S3 ─────────────────────────────────────────────────────────────────
const S3_BUCKET = process.env.S3_BUCKET || process.env.AWS_S3_BUCKET || 'reparations-them';
const S3_REGION = process.env.S3_REGION || process.env.AWS_REGION    || 'us-east-2';
const MSA_S3_PREFIX = 'msa/sc2908';

const s3 = new S3Client({
  region: S3_REGION,
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
/**
 * Build the canonical MSA URL from a PDF filename like "am812--97.pdf"
 */
function msaUrl(filename) {
  return `https://msa.maryland.gov/megafile/msa/speccol/sc2900/sc2908/000001/000812/pdf/${filename}`;
}

/**
 * S3 key for a given PDF filename
 */
function s3Key(filename) {
  return `${MSA_S3_PREFIX}/${filename}`;
}

/**
 * Public S3 URL (no presigning needed – bucket is public-read for this prefix)
 */
function s3Url(filename) {
  return `https://${S3_BUCKET}.s3.amazonaws.com/${s3Key(filename)}`;
}

/**
 * Download a URL into a Buffer, following one level of redirect.
 */
function fetchBuffer(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https://') ? https : http;
    const req = proto.get(url, {
      headers: {
        'User-Agent': 'Reparations Research Archive Bot (contact: research@reparationsproject.org)',
        'Accept': 'application/pdf,*/*',
      },
      timeout: 60_000,
    }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        if (redirectsLeft <= 0) return reject(new Error(`Too many redirects: ${url}`));
        return fetchBuffer(res.headers.location, redirectsLeft - 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        buffer:      Buffer.concat(chunks),
        contentType: res.headers['content-type'] || 'application/pdf',
      }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

/**
 * Returns true if the S3 key already exists.
 */
async function s3Exists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Run N async tasks at a time from an array of thunk factories.
 */
async function pMap(items, fn, concurrency) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const res = await Promise.all(batch.map(fn));
    results.push(...res);
  }
  return results;
}

// ─── Phase 1: download & upload PDFs ─────────────────────────────────────────
async function uploadPdfs(sql, uniqueFiles) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`PHASE 1 — Download & upload ${uniqueFiles.length} unique MSA PDFs to S3`);
  console.log(`  Bucket: ${S3_BUCKET}  |  Prefix: ${MSA_S3_PREFIX}`);
  console.log(`  Concurrency: ${CONCURRENCY}`);
  console.log(`${'─'.repeat(60)}`);

  const stats = { uploaded: 0, skipped: 0, failed: 0, errors: [] };

  const toProcess = LIMIT < Infinity ? uniqueFiles.slice(0, LIMIT) : uniqueFiles;

  await pMap(toProcess, async ({ filename, count }) => {
    const key  = s3Key(filename);
    const url  = msaUrl(filename);

    // Already in S3?
    if (await s3Exists(key)) {
      console.log(`  SKIP (exists) ${filename}  [covers ${count} persons]`);
      stats.skipped++;
      return;
    }

    if (DRY_RUN) {
      console.log(`  DRY  FETCH   ${url}`);
      stats.skipped++;
      return;
    }

    try {
      process.stdout.write(`  FETCH  ${filename}  [covers ${count} persons] … `);
      const { buffer, contentType } = await fetchBuffer(url);

      await s3.send(new PutObjectCommand({
        Bucket:      S3_BUCKET,
        Key:         key,
        Body:        buffer,
        ContentType: contentType.includes('pdf') ? 'application/pdf' : contentType,
        Metadata: {
          'source-url':   url,
          'collection':   'msa-sc2908-certificates-of-freedom',
          'archive-date': new Date().toISOString().slice(0, 10),
          'persons-covered': String(count),
        },
      }));

      console.log(`✓  (${(buffer.length / 1024).toFixed(0)} KB)`);
      stats.uploaded++;
    } catch (err) {
      console.log(`✗  ${err.message}`);
      stats.errors.push({ filename, error: err.message });
      stats.failed++;
    }
  }, CONCURRENCY);

  console.log(`\n  PHASE 1 RESULTS: uploaded=${stats.uploaded}  skipped=${stats.skipped}  failed=${stats.failed}`);
  if (stats.errors.length) {
    console.log('  Failed files:');
    stats.errors.forEach(e => console.log(`    ${e.filename}: ${e.error}`));
  }

  return stats;
}

// ─── Phase 2: create person_documents rows ───────────────────────────────────
async function createPersonDocRows(sql, hasEnslaved_id_col) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log('PHASE 2 — Create person_documents rows for enslaved_individuals');
  console.log(`${'─'.repeat(60)}`);

  // Fetch all enslaved individuals that have MSA URLs in their notes
  // and whose PDF is now in S3
  console.log('  Querying enslaved_individuals with MSA references…');
  const persons = await sql`
    SELECT
      enslaved_id,
      full_name,
      enslaved_by_individual_id,
      (regexp_match(notes, 'Source:\\s*(https?://[^\\s,;]+\\.pdf)'))[1]  AS source_url,
      (regexp_match(notes, '(am\\d+--\\d+\\.pdf)'))[1]                  AS pdf_filename,
      (regexp_match(notes, 'SC\\s*\\d+[^,]*,\\s*[Vv]ol\\.\\s*\\d+[^,]*,\\s*p\\.\\s*\\d+'))[1] AS archive_ref
    FROM enslaved_individuals
    WHERE notes ILIKE '%msa.maryland.gov%'
      AND (regexp_match(notes, '(am\\d+--\\d+\\.pdf)'))[1] IS NOT NULL
    ORDER BY enslaved_id
  `;

  console.log(`  Found ${persons.length} enslaved individuals with MSA PDF references`);

  // Which PDFs are actually in S3 now?
  console.log('  Checking which PDFs landed in S3…');
  const inS3 = new Set();
  // We uploaded them in Phase 1; let's trust Phase 1 + any pre-existing.
  // Quick check: query S3 would be too slow for 132 items; just check DB approach:
  // We'll mark all files that were either already there or just uploaded as "good".
  // Actually, we verified s3Exists during Phase 1. Re-verify a sample:
  const uniqueFilenames = [...new Set(persons.map(p => p.pdf_filename).filter(Boolean))];
  for (const fn of uniqueFilenames) {
    if (await s3Exists(s3Key(fn))) {
      inS3.add(fn);
    }
  }
  console.log(`  ${inS3.size} / ${uniqueFilenames.length} unique PDFs confirmed in S3`);

  const eligible = persons.filter(p => p.pdf_filename && inS3.has(p.pdf_filename));
  console.log(`  ${eligible.length} persons have their PDF in S3 and are eligible for person_documents rows`);

  if (eligible.length === 0) {
    console.log('  Nothing to insert (run without --skip-download first to upload PDFs).');
    return { inserted: 0, skipped: 0 };
  }

  // Check how many already have rows
  const existingCheck = await sql`
    SELECT COUNT(*) AS cnt
    FROM person_documents
    WHERE s3_key ILIKE 'msa/sc2908/%'
  `;
  const alreadyHave = parseInt(existingCheck[0].cnt);
  console.log(`  Already have ${alreadyHave} msa/sc2908 person_documents rows in DB`);

  if (DRY_RUN) {
    console.log(`  DRY RUN — would insert up to ${eligible.length} person_documents rows`);
    eligible.slice(0, 10).forEach(p =>
      console.log(`    enslaved_id=${p.enslaved_id}  name=${p.full_name}  pdf=${p.pdf_filename}`)
    );
    if (eligible.length > 10) console.log(`    … and ${eligible.length - 10} more`);
    return { inserted: 0, skipped: eligible.length };
  }

  // Build insert batches
  let inserted = 0, skipped = 0;
  const toLimit = LIMIT < Infinity ? eligible.slice(0, LIMIT) : eligible;

  for (let i = 0; i < toLimit.length; i += BATCH_INSERT) {
    const batch = toLimit.slice(i, i + BATCH_INSERT);

    // Build VALUES with tagged template for neon (must use individual inserts or raw SQL)
    for (const p of batch) {
      const filename  = p.pdf_filename;
      const key       = s3Key(filename);
      const url       = p.source_url || msaUrl(filename);
      const s3UrlVal  = s3Url(filename);
      const title     = `Certificate of Freedom — ${p.full_name}${p.archive_ref ? ' | ' + p.archive_ref : ''}`;

      try {
        if (hasEnslaved_id_col) {
          // Full insert with enslaved_individual_id (preferred)
          await sql`
            INSERT INTO person_documents
              (enslaved_individual_id, canonical_person_id, name_as_appears,
               document_type, title, source_url, s3_key, s3_url)
            VALUES (
              ${p.enslaved_id},
              ${p.enslaved_by_individual_id || null},
              ${p.full_name},
              'certificate_of_freedom',
              ${title},
              ${url},
              ${key},
              ${s3UrlVal}
            )
            ON CONFLICT DO NOTHING
          `;
        } else {
          // Fallback: no enslaved_individual_id column yet
          await sql`
            INSERT INTO person_documents
              (canonical_person_id, name_as_appears,
               document_type, title, source_url, s3_key, s3_url)
            VALUES (
              ${p.enslaved_by_individual_id || null},
              ${p.full_name},
              'certificate_of_freedom',
              ${title},
              ${url},
              ${key},
              ${s3UrlVal}
            )
            ON CONFLICT DO NOTHING
          `;
        }
        inserted++;
      } catch (err) {
        // Column might not exist or other issue
        if (err.message.includes('column') && err.message.includes('title')) {
          // title column doesn't exist, retry without it
          try {
            if (hasEnslaved_id_col) {
              await sql`
                INSERT INTO person_documents
                  (enslaved_individual_id, canonical_person_id, name_as_appears,
                   document_type, source_url, s3_key, s3_url)
                VALUES (
                  ${p.enslaved_id},
                  ${p.enslaved_by_individual_id || null},
                  ${p.full_name},
                  'certificate_of_freedom',
                  ${url},
                  ${key},
                  ${s3UrlVal}
                )
                ON CONFLICT DO NOTHING
              `;
            } else {
              await sql`
                INSERT INTO person_documents
                  (canonical_person_id, name_as_appears,
                   document_type, source_url, s3_key, s3_url)
                VALUES (
                  ${p.enslaved_by_individual_id || null},
                  ${p.full_name},
                  'certificate_of_freedom',
                  ${url},
                  ${key},
                  ${s3UrlVal}
                )
                ON CONFLICT DO NOTHING
              `;
            }
            inserted++;
          } catch (err2) {
            skipped++;
            if (skipped <= 5) console.error(`  ✗ INSERT failed for ${p.enslaved_id}: ${err2.message}`);
          }
        } else {
          skipped++;
          if (skipped <= 5) console.error(`  ✗ INSERT failed for ${p.enslaved_id}: ${err.message}`);
        }
      }
    }

    const pct = Math.round(((i + batch.length) / toLimit.length) * 100);
    process.stdout.write(`\r  Progress: ${i + batch.length}/${toLimit.length} (${pct}%) — ${inserted} inserted, ${skipped} errors`);
  }

  console.log(`\n\n  PHASE 2 RESULTS: inserted=${inserted}  skipped/errors=${skipped}`);
  return { inserted, skipped };
}

// ─── Phase 0: ensure migration 063 column exists ─────────────────────────────
async function ensureMigration063(sql) {
  console.log('\nChecking migration 063 (enslaved_individual_id column)…');
  try {
    const result = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'person_documents'
        AND column_name = 'enslaved_individual_id'
    `;
    if (result.length > 0) {
      console.log('  ✓ enslaved_individual_id column exists');
      return true;
    }

    console.log('  Column missing — applying migration 063…');
    await sql`
      ALTER TABLE person_documents
        ADD COLUMN IF NOT EXISTS enslaved_individual_id VARCHAR(50)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_person_documents_enslaved_individual_id
        ON person_documents (enslaved_individual_id)
        WHERE enslaved_individual_id IS NOT NULL
    `;
    console.log('  ✓ migration 063 applied (enslaved_individual_id column + index created)');
    return true;
  } catch (err) {
    console.warn(`  ⚠ Could not check/apply migration 063: ${err.message}`);
    console.warn('  Proceeding without enslaved_individual_id column (will omit it from INSERT)');
    return false;
  }
}

// ─── Phase 0b: check/add title column ────────────────────────────────────────
async function ensureTitleColumn(sql) {
  try {
    const result = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'person_documents'
        AND column_name = 'title'
    `;
    if (result.length > 0) return true;
    await sql`ALTER TABLE person_documents ADD COLUMN IF NOT EXISTS title TEXT`;
    console.log('  ✓ Added title column to person_documents');
    return true;
  } catch {
    return false;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const sql = neon(process.env.DATABASE_URL);

  console.log(`\n${'═'.repeat(60)}`);
  console.log('MSA SC 2908 → S3 PRESERVATION ARCHIVE');
  console.log('  Certificates of Freedom for Blacks, 1806–1864 (Maryland)');
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Mode:        ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`  Phase 1:     ${SKIP_DL ? 'SKIPPED (--skip-download)' : 'Download + upload PDFs'}`);
  console.log(`  S3 bucket:   ${S3_BUCKET} (${S3_REGION})`);
  console.log(`  Concurrency: ${CONCURRENCY}`);
  console.log(`  Limit:       ${LIMIT === Infinity ? 'all' : LIMIT}`);

  // Phase 0: migration + schema checks
  const hasEnslaved_id_col = await ensureMigration063(sql);
  await ensureTitleColumn(sql);

  // Query all distinct PDF filenames from enslaved_individuals.notes
  console.log('\nQuerying unique MSA PDF filenames from enslaved_individuals.notes…');
  const uniqueRows = await sql`
    SELECT
      (regexp_match(notes, '(am\\d+--\\d+\\.pdf)'))[1] AS filename,
      COUNT(*)::int                                      AS count
    FROM enslaved_individuals
    WHERE notes ILIKE '%msa.maryland.gov%'
      AND (regexp_match(notes, '(am\\d+--\\d+\\.pdf)'))[1] IS NOT NULL
    GROUP BY filename
    ORDER BY count DESC
  `;

  console.log(`Found ${uniqueRows.length} unique PDF files covering ${uniqueRows.reduce((s, r) => s + r.count, 0)} enslaved individuals`);

  // Phase 1
  let phase1Stats = { uploaded: 0, skipped: uniqueRows.length, failed: 0 };
  if (!SKIP_DL) {
    phase1Stats = await uploadPdfs(sql, uniqueRows);
  } else {
    console.log('\nPHASE 1 SKIPPED (--skip-download flag)');
  }

  // Phase 2
  const phase2Stats = await createPersonDocRows(sql, hasEnslaved_id_col);

  // Final summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log('PRESERVATION ARCHIVE COMPLETE');
  console.log(`${'═'.repeat(60)}`);
  console.log(`  PDFs uploaded to S3:          ${phase1Stats.uploaded}`);
  console.log(`  PDFs skipped (already in S3): ${phase1Stats.skipped}`);
  console.log(`  PDFs failed:                  ${phase1Stats.failed}`);
  console.log(`  person_documents inserted:    ${phase2Stats.inserted}`);
  console.log(`  person_documents skipped:     ${phase2Stats.skipped}`);
  console.log(`\n  S3 prefix: s3://${S3_BUCKET}/${MSA_S3_PREFIX}/`);
  console.log(`${'═'.repeat(60)}\n`);

  // Post-run verification
  if (!DRY_RUN && phase2Stats.inserted > 0) {
    const check = await sql`
      SELECT
        COUNT(*) FILTER (WHERE s3_key ILIKE 'msa/sc2908/%') AS msa_rows,
        COUNT(*) FILTER (WHERE s3_key IS NOT NULL)           AS total_s3_rows,
        COUNT(*)                                              AS total_rows
      FROM person_documents
    `;
    console.log('Post-run DB check (person_documents):');
    console.log(`  MSA SC 2908 rows:   ${check[0].msa_rows}`);
    console.log(`  Total S3-backed:    ${check[0].total_s3_rows}`);
    console.log(`  Total rows:         ${check[0].total_rows}\n`);
  }
}

main().catch(err => {
  console.error('\nFATAL ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
