#!/usr/bin/env node
/**
 * Audit repair — link ancestor-climb canonical persons to their FamilySearch
 * profile as an identity source.
 *
 * Climb-discovered persons (created_by ancestor_climber / ancestor_climber_v2)
 * ARE legitimately canonical: the climb verified them as discrete humans.
 * 2,841 of ~8,703 already have a `person_external_ids` row pointing at their
 * FamilySearch tree profile. The rest do not — but every one of them carries
 * its FamilySearch ID in `notes` as JSON, e.g.
 *   {"familysearch_id":"G21N-4JF","father_fs_id":...,"generation_from_start":1}
 *
 * This script reads that id and inserts the missing `person_external_ids` row
 * (id_system 'familysearch'), so all climb persons have an explicit identity
 * source. A FamilySearch *tree profile* is provenance, not a primary-source
 * document — person_external_ids is its correct home, not person_documents.
 *
 * Idempotent (ON CONFLICT DO NOTHING). DRY RUN by default.
 *   node scripts/backfill-climb-fs-identity.mjs            # dry run
 *   node scripts/backfill-climb-fs-identity.mjs --apply    # write
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

// Climb persons with no person_external_ids row but a familysearch_id in notes.
const SELECTION = `
  FROM canonical_persons cp
  WHERE cp.created_by IN ('ancestor_climber_v2', 'ancestor_climber')
    AND substring(cp.notes from '"familysearch_id"\\s*:\\s*"([A-Z0-9-]+)"') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM person_external_ids pei WHERE pei.canonical_person_id = cp.id
    )
`;

async function main() {
  console.log(APPLY ? '=== Climb FS identity backfill (APPLY) ===' : '=== Climb FS identity backfill (DRY RUN) ===');

  const n = Number((await pool.query(`SELECT COUNT(*) n ${SELECTION}`)).rows[0].n);
  console.log(`\n${n} climb person(s) would get a FamilySearch person_external_ids row.`);

  if (!APPLY) {
    console.log('\nDry run — nothing written. Re-run with --apply to insert.');
    await pool.end();
    return;
  }

  console.log('\nInserting...');
  const res = await pool.query(`
    INSERT INTO person_external_ids
      (canonical_person_id, id_system, external_id, external_url, confidence, verified, discovered_by)
    SELECT
      cp.id,
      'familysearch',
      substring(cp.notes from '"familysearch_id"\\s*:\\s*"([A-Z0-9-]+)"'),
      'https://www.familysearch.org/tree/person/details/' ||
        substring(cp.notes from '"familysearch_id"\\s*:\\s*"([A-Z0-9-]+)"'),
      0.90,
      false,
      'audit-repair-climb-identity'
    ${SELECTION}
    ON CONFLICT DO NOTHING
    RETURNING id
  `);
  console.log(`Done. Inserted ${res.rowCount} person_external_ids row(s).`);
  await pool.end();
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
