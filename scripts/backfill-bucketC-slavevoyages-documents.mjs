#!/usr/bin/env node
/**
 * Audit repair — Bucket C1: surface the SlaveVoyages voyage record for
 * canonical persons that serve no document but carry a `person_external_ids`
 * row of id_system 'slavevoyages'.
 *
 * Those rows hold a real, resolvable deep link into the SlaveVoyages voyage
 * database (e.g. https://www.slavevoyages.org/past/database#55367) — a genuine
 * primary source — that was never put on the person page because no
 * person_documents row linked it.
 *
 * This mirrors the Bucket B repair: one lightweight person_documents row per
 * (person, voyage link), no S3 object. A person may legitimately receive more
 * than one row (multiple voyages). Idempotent: a person who already serves ANY
 * document is skipped, so re-running only fills the remainder.
 *
 * DRY RUN by default.
 *   node scripts/backfill-bucketC-slavevoyages-documents.mjs            # dry run
 *   node scripts/backfill-bucketC-slavevoyages-documents.mjs --apply    # write
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

// SlaveVoyages external-id rows for persons that currently serve no document.
const SELECTION = `
  FROM person_external_ids pei
  JOIN canonical_persons cp ON cp.id = pei.canonical_person_id
  WHERE pei.id_system = 'slavevoyages'
    AND pei.external_url IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM person_documents pd WHERE pd.canonical_person_id = cp.id
    )
`;

async function main() {
  console.log(APPLY ? '=== Bucket C1 backfill (APPLY — writing) ===' : '=== Bucket C1 backfill (DRY RUN — no writes) ===');

  const counts = (await pool.query(`
    SELECT COUNT(*) AS rows, COUNT(DISTINCT cp.id) AS persons ${SELECTION}
  `)).rows[0];
  console.log(`\n${counts.rows} SlaveVoyages link(s) across ${counts.persons} person(s) would get a person_documents row.`);

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
      pei.external_url,
      'slavevoyages_record',
      'slavevoyages',
      'SlaveVoyages',
      -- voyage id keeps multi-voyage persons distinct under the
      -- (canonical_person_id, …, name_as_appears) unique index.
      COALESCE(cp.canonical_name, 'Voyage record') || ' — voyage ' || pei.external_id,
      'SlaveVoyages voyage record',
      'audit-repair-bucketC-slavevoyages'
    ${SELECTION}
    ON CONFLICT DO NOTHING
    RETURNING id
  `);
  console.log(`Done. Inserted ${res.rowCount} person_documents row(s).`);
  await pool.end();
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
