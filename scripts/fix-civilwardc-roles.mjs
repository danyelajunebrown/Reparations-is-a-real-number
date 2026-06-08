#!/usr/bin/env node
/**
 * Fix CivilWarDC role inversion on the 117 enslaved-filed (July-12-1862
 * supplementary-act) petitions found by audit-civilwardc-roles.mjs.
 *
 * Authoritative roles come from each petition's TEI <particDesc>:
 *   role="owner"            → the enslaver
 *   role="petitioner-slave" → the enslaved person who filed
 *
 * The ingestion tagged the enslaved petitioners as 'enslaver' and pushed the
 * actual owner into enslaved_persons_claimed / an 'enslaved'-typed record.
 *
 * This script resolves each role to a canonical_persons row and corrects
 * person_type, but ONLY for unambiguous, non-colliding records:
 *   - petitioner-slave: resolved via the petition's own person_documents link.
 *     CLEAN if its only source_type is civilwardc_org → flip enslaver→enslaved.
 *     COLLISION if it also has another source (e.g. a real 1860 slave-schedule
 *     slaveholder of the same name, like Mary Cambell #488228) → REPORT, never flip.
 *   - owner: resolved by exact name among 'enslaved'/'freedperson' records.
 *     Exactly one match → flip enslaved→enslaver. 0 or >1 → REPORT as ambiguous.
 *
 * Petition-table (claimant ↔ enslaved_persons_claimed) and family_relationships
 * direction fixes are REPORTED for a reviewed second pass, not auto-applied.
 *
 *   node scripts/fix-civilwardc-roles.mjs            # dry run (default)
 *   node scripts/fix-civilwardc-roles.mjs --apply    # apply clean person_type flips
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const APPLY = process.argv.includes('--apply');

const ENSLAVER_TYPES = new Set(['enslaver', 'owner', 'slaveholder', 'confirmed_owner', 'suspected_owner']);
const norm = s => (s || '').trim().toLowerCase();

(async () => {
  const reportPath = path.resolve(__dirname, '../test-results/civilwardc-role-audit.json');
  if (!fs.existsSync(reportPath)) { console.error('Run audit-civilwardc-roles.mjs first.'); process.exit(1); }
  const { inverted } = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  console.log(`${inverted.length} inverted petitions from audit. Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  const slaveFlips = [], slaveCollisions = [], ownerFlips = [], ownerAmbiguous = [], notFound = [];

  for (const pet of inverted) {
    // --- petitioner-slaves: resolve via the petition's person_documents ---
    const docPersons = (await pool.query(`
      SELECT DISTINCT pd.canonical_person_id AS id, cp.canonical_name AS name, cp.person_type,
        (SELECT array_agg(DISTINCT s.source_type) FROM person_documents s WHERE s.canonical_person_id = pd.canonical_person_id) AS sources
      FROM person_documents pd JOIN canonical_persons cp ON cp.id = pd.canonical_person_id
      WHERE pd.source_url ILIKE '%'||$1||'%'`, [pet.docket])).rows;

    for (const slaveName of pet.petitionerSlaves) {
      const match = docPersons.find(d => norm(d.name) === norm(slaveName));
      if (!match) { notFound.push({ docket: pet.docket, role: 'petitioner-slave', name: slaveName }); continue; }
      if (!ENSLAVER_TYPES.has(match.person_type)) continue; // already correct
      const onlyCivilwardc = (match.sources || []).every(s => s === 'civilwardc_org');
      const rec = { docket: pet.docket, id: match.id, name: match.name, from: match.person_type, to: 'enslaved', sources: match.sources };
      (onlyCivilwardc ? slaveFlips : slaveCollisions).push(rec);
    }

    // --- owners: resolve by exact name among enslaved/freedperson records, but
    //     ONLY petition-derived DC records. Exact-name matching alone produces
    //     false hits on same-named Freedman's Bank depositors in other states
    //     (formerly-enslaved people) — flipping THEM to enslaver would be the
    //     same harmful misclassification in reverse. So require DC jurisdiction
    //     AND no independent person_documents (these owners were pushed into
    //     enslaved_persons_claimed and have no source of their own).
    for (const ownerName of pet.owners) {
      const cands = (await pool.query(`
        SELECT id, canonical_name, person_type, primary_state
        FROM canonical_persons cp
        WHERE canonical_name = $1 AND person_type IN ('enslaved','freedperson')
          AND primary_state ILIKE '%columbia%'
          AND NOT EXISTS (SELECT 1 FROM person_documents s WHERE s.canonical_person_id = cp.id)`, [ownerName])).rows;
      if (cands.length === 1) {
        const c = cands[0];
        ownerFlips.push({ docket: pet.docket, id: c.id, name: c.canonical_name, from: c.person_type, to: 'enslaver', state: c.primary_state });
      } else {
        ownerAmbiguous.push({ docket: pet.docket, name: ownerName, matches: cands.length });
      }
    }
  }

  const report = { slaveFlips, slaveCollisions, ownerFlips, ownerAmbiguous, notFound };
  console.log('════════ FIX PLAN ════════');
  console.log(`Petitioner-slaves to flip enslaver→enslaved (CLEAN):   ${slaveFlips.length}`);
  console.log(`Petitioner-slaves COLLISION (has other source — REPORT only): ${slaveCollisions.length}`);
  console.log(`Owners to flip enslaved→enslaver (unambiguous):        ${ownerFlips.length}`);
  console.log(`Owners AMBIGUOUS (0 or >1 name match — REPORT only):   ${ownerAmbiguous.length}`);
  console.log(`Names not found among petition docs (REPORT only):     ${notFound.length}`);
  console.log(`\nCollision sample:`, slaveCollisions.slice(0, 8).map(r => `${r.name}#${r.id}[${(r.sources||[]).join(',')}]`).join(' | ') || '(none)');
  console.log(`Owner-flip sample:`, ownerFlips.slice(0, 8).map(r => `${r.name}#${r.id}(${r.from}→enslaver)`).join(' | ') || '(none)');

  if (APPLY) {
    const client = await pool.connect();
    let n = 0;
    try {
      await client.query('BEGIN');
      for (const f of [...slaveFlips, ...ownerFlips]) {
        const r = await client.query(
          `UPDATE canonical_persons SET person_type = $2, updated_at = now()
           WHERE id = $1 AND person_type <> $2`, [f.id, f.to]);
        n += r.rowCount;
      }
      await client.query('COMMIT');
      console.log(`\n✓ APPLIED: ${n} canonical_persons person_type corrections committed.`);
    } catch (e) { await client.query('ROLLBACK'); console.error('ROLLBACK:', e.message); }
    finally { client.release(); }
  } else {
    console.log(`\n(dry run — no writes. Re-run with --apply to commit the ${slaveFlips.length + ownerFlips.length} clean flips.)`);
  }

  fs.writeFileSync(path.resolve(__dirname, '../test-results/civilwardc-role-fix-plan.json'), JSON.stringify(report, null, 2));
  console.log('Full plan → test-results/civilwardc-role-fix-plan.json');
  await pool.end();
})();
