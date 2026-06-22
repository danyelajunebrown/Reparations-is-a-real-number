#!/usr/bin/env node
/**
 * Backfill probate `person_documents.document_year` (#67).
 *
 * The scraper historically derived the year with /18\d{2}/ — matching ONLY
 * 1800–1899 — so every colonial (16xx/17xx) and 20th-c probate page was either
 * NULLed or clamped into 1800–1899. The scraper regex is now widened to
 * /1[6-9]\d{2}/ (georgia-probate-scraper.js), but the ~38k pages already written
 * carry the broken value. This re-derives document_year from the stored ocr_text
 * with the corrected logic and rewrites it.
 *
 * The derivation is intentionally IDENTICAL to the scraper's inline rule
 * (Math.min over 4-digit 1600–1999 tokens) so backfilled and freshly-scraped
 * rows agree. Math.min = conservative earliest-stated-year proxy for the doc date.
 *
 *   node scripts/backfill-probate-document-year.mjs                 # dry run (default)
 *   node scripts/backfill-probate-document-year.mjs --apply
 *   node scripts/backfill-probate-document-year.mjs --prefix new-york-probate- --apply
 *   node scripts/backfill-probate-document-year.mjs --created-by new-york-probate-scraper --apply
 */
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv'; import pg from 'pg';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const arg = (flag) => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : null; };
const APPLY = process.argv.includes('--apply');
const FILL_ONLY = process.argv.includes('--fill-only'); // only fill NULLs; never overwrite an existing year
const PREFIX = arg('--prefix');                         // optional collection_key prefix filter
const CREATED_BY = arg('--created-by');                 // optional single created_by filter
const LIMIT = arg('--limit') ? parseInt(arg('--limit'), 10) : null;

// IDENTICAL to georgia-probate-scraper.js inline rule (#67). Keep in sync.
const deriveYear = (text) => {
  const m = (text || '').match(/\b(1[6-9]\d{2})\b/g);
  return m && m.length ? Math.min(...m.map((y) => parseInt(y, 10))) : null;
};
const century = (y) => (y == null ? 'NULL' : `${Math.floor(y / 100) * 100}s`);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  const where = [`created_by IN ('new-york-probate-scraper','georgia-probate-scraper')`];
  const params = [];
  if (CREATED_BY) { where[0] = `created_by = $${params.push(CREATED_BY)}`; }
  if (PREFIX) { where.push(`collection_key LIKE $${params.push(PREFIX + '%')}`); }
  const sql = `
    SELECT id, document_year, ocr_text
    FROM person_documents
    WHERE ${where.join(' AND ')} AND ocr_text IS NOT NULL AND length(ocr_text) > 20
    ${LIMIT ? `LIMIT ${LIMIT}` : ''}`;

  console.log(`[backfill-document-year] mode=${APPLY ? 'APPLY' : 'DRY-RUN'}${FILL_ONLY ? ' FILL-ONLY' : ''}${PREFIX ? ` prefix=${PREFIX}` : ''}${CREATED_BY ? ` created_by=${CREATED_BY}` : ''}`);
  const rows = (await pool.query(sql, params)).rows;
  console.log(`scanning ${rows.length} probate docs with OCR…`);

  const before = {}, after = {};
  let nullFilled = 0, valueChanged = 0, becameNull = 0, unchanged = 0;
  const updates = [];
  for (const r of rows) {
    const oldY = r.document_year;
    const newY = deriveYear(r.ocr_text);
    before[century(oldY)] = (before[century(oldY)] || 0) + 1;
    after[century(newY)] = (after[century(newY)] || 0) + 1;
    if (oldY === newY) { unchanged++; continue; }
    // --fill-only: only touch rows with no existing year (protects dates from a better
    // source, e.g. Georgia/Liberty's completed LLM estate extraction). Strictly additive.
    if (FILL_ONLY && oldY != null) { unchanged++; continue; }
    if (oldY == null && newY != null) nullFilled++;
    else if (oldY != null && newY == null) becameNull++;
    else valueChanged++;
    updates.push({ id: r.id, newY });
  }

  const dist = (o) => Object.entries(o).sort().map(([k, v]) => `${k}:${v}`).join('  ');
  console.log(`\nbefore: ${dist(before)}`);
  console.log(`after:  ${dist(after)}`);
  console.log(`\nchanges: ${updates.length}  (NULL→year ${nullFilled}, year→year ${valueChanged}, year→NULL ${becameNull}, unchanged ${unchanged})`);

  if (!APPLY) { console.log('\n(dry run — pass --apply to write)'); await pool.end(); return; }

  let written = 0;
  for (let i = 0; i < updates.length; i += 500) {
    const batch = updates.slice(i, i + 500);
    const ids = batch.map((u) => u.id);
    const years = batch.map((u) => u.newY);
    await pool.query(
      `UPDATE person_documents AS pd SET document_year = v.y
       FROM (SELECT unnest($1::int[]) AS id, unnest($2::int[]) AS y) AS v
       WHERE pd.id = v.id`,
      [ids, years]
    );
    written += batch.length;
    if (written % 5000 < 500) console.log(`  …${written}/${updates.length} written`);
  }
  console.log(`\n✓ updated ${written} rows.`);
  await pool.end();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
