#!/usr/bin/env node
/**
 * Un-merge the two CivilWarDC name-collision cases flagged by
 * fix-civilwardc-roles.mjs.
 *
 * Each of these canonical_persons is a REAL 1860-slave-schedule slaveholder who
 * wrongly also carries a DC emancipation petition about a *same-named enslaved
 * person*. We cannot flip them to 'enslaved' (that would corrupt the genuine
 * slaveholder record), so instead we DETACH the civilwardc petition documents
 * onto a new, correct 'enslaved' canonical record and leave the schedule
 * slaveholder intact.
 *
 *   #488228 "Mary Cambell" (Sussex, Delaware — 1860 schedule slaveholder)
 *           wrongly carries cww.01034 (the enslaved 5-yo Mary Cambell, DC)
 *   #242725 "Samuel Lee" (District 2, Kentucky — 1860 schedule slaveholder)
 *           wrongly carries cww.01078 (the enslaved Samuel Lee, DC)
 *
 *   node scripts/unmerge-civilwardc-collisions.mjs          # dry run
 *   node scripts/unmerge-civilwardc-collisions.mjs --apply
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const APPLY = process.argv.includes('--apply');

const CASES = [
  { oldId: 488228, name: 'Mary Cambell', docket: 'cww.01034' },
  { oldId: 242725, name: 'Samuel Lee',   docket: 'cww.01078' },
];

(async () => {
  console.log(`Un-merge ${CASES.length} CivilWarDC collisions. Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);
  const client = await pool.connect();
  try {
    if (APPLY) await client.query('BEGIN');
    for (const c of CASES) {
      const cwdc = (await client.query(
        `SELECT id FROM person_documents WHERE canonical_person_id=$1 AND source_type='civilwardc_org'`, [c.oldId])).rows;
      const kept = (await client.query(
        `SELECT COUNT(*) n FROM person_documents WHERE canonical_person_id=$1 AND source_type<>'civilwardc_org'`, [c.oldId])).rows[0].n;
      console.log(`#${c.oldId} ${c.name}: ${cwdc.length} civilwardc docs to detach, ${kept} schedule doc(s) kept on slaveholder.`);
      if (cwdc.length === 0) { console.log('  (already un-merged — skipping)'); continue; }
      if (!APPLY) { console.log(`  → would create enslaved DC record for "${c.name}" and move ${cwdc.length} docs to it.\n`); continue; }

      const ins = await client.query(
        `INSERT INTO canonical_persons (canonical_name, person_type, primary_state, notes, created_at)
         VALUES ($1, 'enslaved', 'District of Columbia', $2, now()) RETURNING id`,
        [c.name, `Enslaved petitioner-slave from DC emancipation petition ${c.docket}. Un-merged 2026-06-08 from canonical #${c.oldId}, a same-named 1860 slave-schedule slaveholder the TEI ingestion conflated this petition onto.`]);
      const newId = ins.rows[0].id;
      const moved = await client.query(
        `UPDATE person_documents SET canonical_person_id=$1 WHERE canonical_person_id=$2 AND source_type='civilwardc_org'`,
        [newId, c.oldId]);
      console.log(`  ✓ created enslaved DC record #${newId}; moved ${moved.rowCount} civilwardc docs. #${c.oldId} stays enslaver with its schedule doc.`);
    }
    if (APPLY) { await client.query('COMMIT'); console.log('\n✓ committed.'); }
    else console.log('\n(dry run — re-run with --apply)');
  } catch (e) { if (APPLY) await client.query('ROLLBACK'); console.error('ERROR (rolled back):', e.message); }
  finally { client.release(); await pool.end(); }
})();
