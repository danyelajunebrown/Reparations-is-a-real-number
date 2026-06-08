#!/usr/bin/env node
/**
 * Fill the gaps left by the CivilWarDC role-inversion fix: petition persons the
 * TEI ingestion never promoted to canonical_persons (because the inversion bug
 * pushed owners into enslaved_persons_claimed and left some petitioner-slaves
 * un-promoted). Source of truth: test-results/civilwardc-role-audit.json.
 *
 * For each inverted petition, for each TEI person (role owner / petitioner-slave):
 *   - 0 existing canonical records by exact name  → CREATE one
 *       owner            → person_type='enslaver',  DC
 *       petitioner-slave → person_type='enslaved',  DC
 *     with provenance notes citing the petition, then wire owner↔slave
 *     family_relationships (slaveholder/enslaved, enslaved_by) and set the
 *     petition's claimant_canonical_id to a created owner.
 *   - >=1 existing record → REPORT for manual review (name-collision risk — these
 *     are exactly the cases where exact-name matching hits Freedman's Bank
 *     depositors etc., so we never auto-link them).
 *
 * Naturally idempotent: a re-run finds the just-created record (now 1 match) and
 * routes it to review instead of creating a duplicate.
 *
 *   node scripts/promote-civilwardc-petition-persons.mjs          # dry run
 *   node scripts/promote-civilwardc-petition-persons.mjs --apply
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

(async () => {
  const { inverted } = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../test-results/civilwardc-role-audit.json'), 'utf-8'));
  const client = await pool.connect();
  const created = { enslaver: 0, enslaved: 0 }, reviewed = [], frLinks = [], claimantSet = [];
  try {
    await client.query('BEGIN');
    const ensureCanonical = async (name, role, docket) => {
      const existing = await client.query(`SELECT id, person_type FROM canonical_persons WHERE canonical_name=$1`, [name]);
      if (existing.rows.length >= 1) { reviewed.push({ name, role, docket, matches: existing.rows.length }); return null; }
      const ptype = role === 'owner' ? 'enslaver' : 'enslaved';
      const ins = await client.query(
        `INSERT INTO canonical_persons (canonical_name, person_type, primary_state, notes, created_at)
         VALUES ($1, $2, 'District of Columbia', $3, now()) RETURNING id`,
        [name, ptype, `Created 2026-06-08 from DC emancipation petition ${docket} (TEI role=${role}). Completes the TEI ingestion that omitted this person via the role-inversion bug.`]);
      created[ptype]++;
      return ins.rows[0].id;
    };

    for (const pet of inverted) {
      if (!pet.owners.length || !pet.petitionerSlaves.length) continue;
      const ownerId = await ensureCanonical(pet.owners[0], 'owner', pet.docket);
      const slaveIds = [];
      for (const s of pet.petitionerSlaves) { const id = await ensureCanonical(s, 'petitioner-slave', pet.docket); if (id) slaveIds.push({ id, name: s }); }

      if (ownerId) {
        const u = await client.query(
          `UPDATE historical_reparations_petitions SET claimant_canonical_id=$2, updated_at=now()
           WHERE docket_number=$1 AND claimant_canonical_id IS NULL`, [pet.docket, ownerId]);
        if (u.rowCount) claimantSet.push(pet.docket);
      }
      // wire family_relationships for any newly-created slave to its owner
      if (ownerId && slaveIds.length) {
        for (const sl of slaveIds) {
          const exists = await client.query(
            `SELECT 1 FROM family_relationships WHERE source_url ILIKE '%'||$1||'%' AND person1_name=$2 AND person2_name=$3`,
            [pet.docket, pet.owners[0], sl.name]);
          if (!exists.rows.length) {
            await client.query(
              `INSERT INTO family_relationships (person1_name, person1_role, person2_name, person2_role, relationship_type, source_url, matched_text, confidence, created_at)
               VALUES ($1,'slaveholder',$2,'enslaved','enslaved_by',$3,$4,0.9, now())`,
              [pet.owners[0], sl.name, `https://civilwardc.org/texts/petitions/${pet.docket}.html`, `DC 1862 petition ${pet.docket}: ${pet.owners[0]} held ${sl.name}`]);
            frLinks.push(`${pet.owners[0]}→${sl.name}`);
          }
        }
      }
    }
    if (APPLY) { await client.query('COMMIT'); console.log('✓ committed.\n'); }
    else { await client.query('ROLLBACK'); console.log('(dry run — rolled back)\n'); }
  } catch (e) { try { await client.query('ROLLBACK'); } catch {} console.error('ERROR (rolled back):', e.message); }
  finally { client.release(); }

  console.log(`Created enslaver (owner) records:        ${created.enslaver}`);
  console.log(`Created enslaved (petitioner) records:   ${created.enslaved}`);
  console.log(`family_relationships links added:        ${frLinks.length}`);
  console.log(`petition claimant_canonical_id set:      ${claimantSet.length}`);
  console.log(`Existing-record cases held for REVIEW:   ${reviewed.length} (name-collision risk — not auto-linked)`);
  fs.writeFileSync(path.resolve(__dirname, '../test-results/civilwardc-promote-review.json'), JSON.stringify({ created, reviewed }, null, 2));
  console.log(`Review list → test-results/civilwardc-promote-review.json`);
  await pool.end();
})();
