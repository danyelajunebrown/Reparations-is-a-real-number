#!/usr/bin/env node
/**
 * Delete probate canonical_persons whose canonical_name is a single word
 * ("Cason", "WHERE", "Janice"). A testator always has a full name in the
 * record; single-token rows came from surname-only captures, will boilerplate
 * fragments ("ACKNOWLEDGMENT OF SERVICE" → "SERVICE"), or honorific-stripped
 * truncations ("Mrs. Janice" → "Janice") in garbled OCR.
 *
 * extractTestator now rejects single-token captures (commit f677d42d3) so no
 * new ones will be created. This cleans up the ~790 already in the DB.
 *
 * FK-safe: scans every foreign key referencing canonical_persons; aborts if
 * any unexpected reference appears. Handled dependents:
 *   - person_documents:  null the link, revert name_as_appears to "Image N"
 *   - inheritance_edges (testator_id, heir_id):  delete (edge anchored on a
 *     bad person is itself bad)
 *   - enslaver_evidence_compendium:  delete the evidence row
 *   - person_relationships_verified:  delete
 *
 * DRY RUN by default.
 *   node scripts/cleanup-single-name-testators.mjs            # dry run
 *   node scripts/cleanup-single-name-testators.mjs --apply    # delete
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const APPLY = process.argv.includes('--apply');
const JUNK = `SELECT id FROM canonical_persons
  WHERE person_type = 'enslaver' AND primary_county = 'Liberty'
    AND canonical_name !~ ' '
    AND created_by IN ('reparse-probate-entities', 'system')`;

const KNOWN = {
  'person_documents.canonical_person_id': 'reset_doc',
  'inheritance_edges.testator_id': 'delete',
  'inheritance_edges.heir_id': 'delete',
  'enslaver_evidence_compendium.canonical_person_id': 'delete',
  'person_relationships_verified.person_id': 'delete',
  'person_relationships_verified.related_person_id': 'delete',
};

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  console.log(APPLY ? '=== single-name testator cleanup (APPLY) ===' : '=== single-name testator cleanup (DRY RUN) ===');

  const count = Number((await pool.query(`SELECT COUNT(*) n FROM (${JUNK}) j`)).rows[0].n);
  console.log(`\nTarget rows: ${count}`);

  // Sample names + linked-doc counts so the user can eyeball before --apply.
  const sample = (await pool.query(`
    SELECT cp.canonical_name, cp.created_by,
      (SELECT COUNT(*) FROM person_documents pd WHERE pd.canonical_person_id = cp.id) AS docs,
      (SELECT COUNT(*) FROM inheritance_edges ie WHERE ie.testator_id = cp.id) AS edges
    FROM canonical_persons cp
    WHERE cp.id IN (${JUNK}) ORDER BY random() LIMIT 12
  `)).rows;
  console.log('Random sample:');
  for (const s of sample) console.log(`  "${s.canonical_name}"  by ${s.created_by}  docs:${s.docs} edges:${s.edges}`);

  // FK scan
  const fks = (await pool.query(`
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'canonical_persons'
  `)).rows;
  console.log(`\nScanning ${fks.length} foreign keys...`);
  const exposed = []; let unexpected = false;
  for (const fk of fks) {
    const key = `${fk.table_name}.${fk.column_name}`;
    let n;
    try {
      n = Number((await pool.query(
        `SELECT COUNT(*) n FROM ${fk.table_name} t WHERE t.${fk.column_name} IN (${JUNK})`
      )).rows[0].n);
    } catch { continue; }
    if (n > 0) {
      const plan = KNOWN[key];
      console.log(`  ${key}: ${n} reference(s) — ${plan ? `will ${plan}` : 'UNEXPECTED'}`);
      exposed.push({ ...fk, key, n, plan });
      if (!plan) unexpected = true;
    }
  }
  if (unexpected) {
    console.log('\nABORT: unknown table references junk rows. Resolve and re-run.');
    await pool.end(); return;
  }

  if (!APPLY) {
    console.log('\nDry run — nothing deleted. Re-run with --apply.');
    await pool.end(); return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const e of exposed) {
      if (e.plan === 'delete') {
        const r = await client.query(`DELETE FROM ${e.table_name} WHERE ${e.column_name} IN (${JUNK})`);
        console.log(`  deleted ${r.rowCount} from ${e.key}`);
      } else if (e.plan === 'reset_doc') {
        // null the link AND restore the "Image <image_number>" fallback name.
        const r = await client.query(
          `UPDATE person_documents
              SET canonical_person_id = NULL,
                  name_as_appears = 'Image ' || COALESCE(image_number::text, '?')
            WHERE canonical_person_id IN (${JUNK})`
        );
        console.log(`  reset ${r.rowCount} person_documents (unlinked + name reverted)`);
      }
    }
    const del = await client.query(
      `DELETE FROM canonical_persons
        WHERE person_type = 'enslaver' AND primary_county = 'Liberty'
          AND canonical_name !~ ' '
          AND created_by IN ('reparse-probate-entities', 'system')`
    );
    await client.query('COMMIT');
    console.log(`\nDone. Deleted ${del.rowCount} single-name testator canonical_persons row(s).`);
  } catch (err) {
    await client.query('ROLLBACK'); throw err;
  } finally { client.release(); await pool.end(); }
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
