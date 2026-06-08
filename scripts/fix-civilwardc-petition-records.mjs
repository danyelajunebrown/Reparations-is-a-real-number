#!/usr/bin/env node
/**
 * Second-pass fix for the 117 inverted CivilWarDC petitions: correct the
 * historical_reparations_petitions row and the family_relationships direction
 * (the first pass, fix-civilwardc-roles.mjs, only corrected canonical_persons
 * person_type).
 *
 * Source of truth: the TEI roles captured in test-results/civilwardc-role-audit.json
 *   role="owner"            → enslaver / the petition's claimant-of-record
 *   role="petitioner-slave" → enslaved person freed by the petition
 *
 * Fixes, per inverted petition only (owner-filed petitions are left untouched):
 *  1. historical_reparations_petitions: claimant ← owner(s); enslaved_persons_claimed
 *     ← petitioner-slaves; claimant_canonical_id ← resolved DC enslaver id.
 *  2. family_relationships: rows were created as
 *     person1=petitioner-slave(role slaveholder) — person2=owner(role enslaved).
 *     Swap person1↔person2 (name/role/lead_id) so the owner is the slaveholder
 *     and the petitioner-slave is enslaved. relationship_type 'enslaved_by'
 *     (person2 enslaved_by person1) then reads correctly. Idempotent: only rows
 *     whose person2 is still the owner are swapped.
 *
 *   node scripts/fix-civilwardc-petition-records.mjs          # dry run
 *   node scripts/fix-civilwardc-petition-records.mjs --apply
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

async function resolveOwnerId(client, name) {
  const r = await client.query(
    `SELECT id FROM canonical_persons cp
     WHERE canonical_name=$1 AND person_type='enslaver' AND primary_state ILIKE '%columbia%'
       AND NOT EXISTS (SELECT 1 FROM person_documents s WHERE s.canonical_person_id=cp.id)`, [name]);
  return r.rows.length === 1 ? r.rows[0].id : null;
}

(async () => {
  const { inverted } = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../test-results/civilwardc-role-audit.json'), 'utf-8'));
  console.log(`${inverted.length} inverted petitions. Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);
  const client = await pool.connect();
  let petUpd = 0, frSwap = 0, ownerResolved = 0;
  try {
    await client.query('BEGIN'); // always in a txn; dry run ROLLBACKs at the end
    for (const pet of inverted) {
      if (!pet.owners.length || !pet.petitionerSlaves.length) continue;
      const ownerName = pet.owners[0];
      const ownerId = await resolveOwnerId(client, ownerName);
      if (ownerId) ownerResolved++;
      const enslavedJson = JSON.stringify(pet.petitionerSlaves.map(n => ({ name: n })));

      // 1. petition row
      // claimant_canonical_id ← resolved owner id, or NULL (don't keep the stale
      // id that points at the now-reclassified enslaved petitioner).
      const u = await client.query(
        `UPDATE historical_reparations_petitions
            SET claimant_name=$2, claimant_canonical_id=$3,
                enslaved_persons_claimed=$4::jsonb, updated_at=now()
          WHERE docket_number=$1`,
        [pet.docket, ownerName, ownerId, enslavedJson]);
      petUpd += u.rowCount;

      // 2. family_relationships — created inverted as
      //    person1=petitioner-slave(role slaveholder) — person2=owner(role enslaved).
      //    Swap the NAMES/lead_ids so the owner is person1, but FIX the roles to
      //    slaveholder/enslaved (do NOT carry the old roles across, or they stay
      //    inverted). relationship_type 'enslaved_by' = person2 enslaved_by person1.
      //    Idempotent: only matches rows whose person2 is still the owner.
      const fr = await client.query(
        `UPDATE family_relationships
            SET person1_name=person2_name, person1_lead_id=person2_lead_id, person1_role='slaveholder',
                person2_name=person1_name, person2_lead_id=person1_lead_id, person2_role='enslaved',
                relationship_type='enslaved_by'
          WHERE source_url ILIKE '%'||$1||'%' AND person2_name = ANY($2)`,
        [pet.docket, pet.owners]);
      frSwap += fr.rowCount;
    }
    if (APPLY) { await client.query('COMMIT'); console.log('✓ committed.'); }
    else { await client.query('ROLLBACK'); console.log('(dry run — rolled back, no writes)'); }
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('ERROR (rolled back):', e.message);
  } finally { client.release(); }

  console.log(`\nPetition rows updated:        ${petUpd}`);
  console.log(`Owner canonical id resolved:  ${ownerResolved}/${inverted.length}`);
  console.log(`family_relationships swapped: ${frSwap}`);
  await pool.end();
})();
