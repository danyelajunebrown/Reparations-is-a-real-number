#!/usr/bin/env node
/**
 * Audit repair — Bucket B: surface the FamilySearch source record for canonical
 * persons that were promoted from `unconfirmed_persons` but serve no document.
 *
 * Background (canonical-person source-document audit, May 2026):
 *   563,249 canonical persons; only 39,497 served a linked person_document.
 *   Bucket B = 320,354 persons promoted from unconfirmed_persons whose
 *   `unconfirmed_persons` row carries a real `source_url` (a FamilySearch
 *   /ark:/ indexed-record link) that was never put on the person page.
 *
 * This script inserts one lightweight `person_documents` row per Bucket B
 * person: canonical_person_id + source_url, no S3 object. The frontend already
 * renders external source_url documents (opens in a new tab), and the API
 * exclusion in contribute.js was narrowed so /ark:/ record links are served
 * (only /tree/ profile links stay hidden).
 *
 * Idempotent: a person who already has ANY linked person_document is skipped,
 * so re-running only fills the remainder.
 *
 * DRY RUN by default — prints counts and URL-shape breakdown, writes nothing.
 *
 *   node scripts/backfill-bucketB-source-documents.mjs            # dry run
 *   node scripts/backfill-bucketB-source-documents.mjs --apply    # write
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const APPLY = process.argv.includes('--apply');

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Bucket B selection: canonical persons with a "Lead #N" note, no existing
// linked person_document, whose unconfirmed_persons row has a source_url.
const BUCKET_B_FROM = `
  FROM canonical_persons cp
  JOIN unconfirmed_persons up
    ON up.lead_id = (substring(cp.notes from 'Lead #([0-9]+)'))::bigint
  WHERE cp.notes ~ 'Lead #[0-9]+'
    AND up.source_url IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM person_documents pd WHERE pd.canonical_person_id = cp.id
    )
`;

async function main() {
  console.log(APPLY ? '=== Bucket B backfill (APPLY — writing) ===' : '=== Bucket B backfill (DRY RUN — no writes) ===');

  const shape = (await pool.query(`
    SELECT
      CASE
        WHEN up.source_url ILIKE '%familysearch.org/ark:/%' THEN 'fs_ark_record   (served)'
        WHEN up.source_url ILIKE '%familysearch.org/tree/%' THEN 'fs_tree_profile (hidden by API)'
        WHEN up.source_url ILIKE '%familysearch.org%'       THEN 'fs_other'
        ELSE 'non_familysearch'
      END AS url_shape,
      COUNT(*) AS n
    ${BUCKET_B_FROM}
    GROUP BY 1 ORDER BY 2 DESC
  `)).rows;

  let total = 0;
  console.log('\nBucket B rows to insert, by source URL shape:');
  for (const r of shape) {
    console.log(`  ${String(r.n).padStart(8)}  ${r.url_shape}`);
    total += Number(r.n);
  }
  console.log(`  ${'-'.repeat(8)}`);
  console.log(`  ${String(total).padStart(8)}  total person_documents rows`);

  if (!APPLY) {
    console.log('\nDry run — nothing written. Re-run with --apply to insert.');
    await pool.end();
    return;
  }

  console.log('\nInserting...');
  const res = await pool.query(`
    INSERT INTO person_documents
      (canonical_person_id, source_url, document_type, source_type,
       source_type_label, name_as_appears, title, created_by)
    SELECT
      cp.id,
      up.source_url,
      'familysearch_record',
      'familysearch',
      'FamilySearch',
      COALESCE(up.full_name, cp.canonical_name, 'Source record'),
      'FamilySearch source record',
      'audit-repair-bucketB'
    ${BUCKET_B_FROM}
    RETURNING id
  `);
  console.log(`Done. Inserted ${res.rowCount} person_documents row(s).`);
  await pool.end();
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
