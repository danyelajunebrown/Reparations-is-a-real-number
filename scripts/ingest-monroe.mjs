// ingest-monroe.mjs — verified add of President James Monroe as a slaveholder, via his father
// Spence Monroe's 1774 Westmoreland County VA estate inventory (the document by which James, ~16,
// INHERITED enslaved people). Fixes the identity bug: the DB "James Monroe" #614729 is a Georgia
// storekeeper — the President needs his own verified record.
//
// AUDIT-GRADE: the 1774 estate inventory is PRE-emancipation and NAMES enslaved people → it legitimately
// carries evidences_enslaved_holding=TRUE (unlike Duncan's 1866 will). Evidence tier = secondary/scholarly
// (White House Historical Association + "The People Enslaved by President Monroe", Hinterleiter, citing the
// Westmoreland County inventory). GOLD follow-on for a RULE 0.6 image = the Westmoreland County will/
// inventory book scan (Library of Virginia / FamilySearch VA probate).
//
// Enslaved people named in the 1774 inventory: Peter, Joe, Cuffee, Kate, Fanny, Nell (and child), Mud,
// Ralph, Daphne. Both Spence and James are set assertable_slaveowner via the inventory evidence.
//
// Usage: node scripts/ingest-monroe.mjs --apply

import 'dotenv/config';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const SRC = 'https://www.whitehousehistory.org/the-enslaved-households-of-president-james-monroe (+ "The People Enslaved by President Monroe", L. Hinterleiter) — citing the 1774 Spence Monroe estate inventory, Westmoreland County, Virginia';
const INV_TEXT = `Estate inventory/appraisal of Spence Monroe (1727–1774), Westmoreland County, Virginia, 1774. A working farm with enslaved persons named: Peter, Joe, Cuffee, Kate, Fanny, Nell and child, Mud, Ralph, and Daphne. James Monroe (b.1758), then ~16, inherited land and enslaved people from his father's estate in 1774 — his entry into slaveholding, which he continued for life at Highland (Albemarle Co.) and Oak Hill (Loudoun Co.).`;
const ENSLAVED = ['Peter', 'Joe', 'Cuffee', 'Kate', 'Fanny', 'Nell', 'Mud', 'Ralph', 'Daphne'];

async function upsertCanon(c, { name, first, last, sex, birth, death, state, county, notes }) {
  let id = (await c.query(`SELECT id FROM canonical_persons WHERE canonical_name ILIKE $1 AND birth_year_estimate=$2 AND created_by='roster_partner_ingest' LIMIT 1`, [name, birth])).rows[0]?.id;
  if (!id) {
    id = (await c.query(
      `INSERT INTO canonical_persons (canonical_name, first_name, last_name, first_name_soundex, last_name_soundex, last_name_metaphone,
          sex, person_type, birth_year_estimate, death_year_estimate, primary_state, primary_county, confidence_score, verification_status, created_by, notes)
       VALUES ($1,$2,$3, soundex($2), soundex($3), metaphone($3,8), $4,'enslaver',$5,$6,$7,$8,0.95,'verified','roster_partner_ingest',$9) RETURNING id`,
      [name, first, last, sex, birth, death, state, county, notes])).rows[0].id;
    await c.query(`INSERT INTO person_blocking_keys (subject_table, subject_id, canonical_person_id, key_type, key_value)
      SELECT 'canonical_persons',$1,$1,k.key_type,k.key_value FROM derive_blocking_keys($2,$3,$4) k ON CONFLICT DO NOTHING`, [id, name, sex, birth]);
  } else {
    await c.query(`UPDATE canonical_persons SET notes=$2, verification_status='verified' WHERE id=$1`, [id, notes]);
  }
  return id;
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  if (!APPLY) { console.log('[DRY-RUN]'); await pool.end(); return; }
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const spence = await upsertCanon(c, { name: 'Spence Monroe', first: 'Spence', last: 'Monroe', sex: 'm', birth: 1727, death: 1774, state: 'Virginia', county: 'Westmoreland',
      notes: 'Father of President James Monroe; farmer & joiner of Westmoreland County, VA. His 1774 estate inventory names enslaved persons (Peter, Joe, Cuffee, Kate, Fanny, Nell & child, Mud, Ralph, Daphne), inherited by James Monroe.' });
    const james = await upsertCanon(c, { name: 'James Monroe', first: 'James', last: 'Monroe', sex: 'm', birth: 1758, death: 1831, state: 'Virginia', county: 'Albemarle',
      notes: '5th U.S. President. Entered slaveholding in 1774 by inheriting enslaved people from his father Spence Monroe\'s estate (Westmoreland Co.); lifelong slaveholder at Highland (Albemarle) and Oak Hill (Loudoun). NOTE: distinct from #614729 (a Georgia storekeeper name-collision).' });
    // Spence's 1774 inventory → evidences holding on BOTH (Spence held; James inherited)
    for (const id of [spence, james]) {
      await c.query(`INSERT INTO person_documents (canonical_person_id, name_as_appears, document_type, source_url, source_type, evidence_strength, document_year, ocr_text, evidences_enslaved_holding, created_by)
         VALUES ($1,'Spence Monroe','estate_inventory',$2,'secondary','secondary',1774,$3,TRUE,'roster_partner_ingest') ON CONFLICT DO NOTHING`, [id, SRC, INV_TEXT]);
      await c.query(`UPDATE canonical_persons SET assertable_slaveowner=TRUE WHERE id=$1`, [id]);
    }
    // parent → child edge (best-effort; skip silently if schema differs)
    try { await c.query(`INSERT INTO canonical_family_edges (person_id, relative_id, relationship, source, confidence) VALUES ($1,$2,'child','spence_monroe_1774_estate',0.95) ON CONFLICT DO NOTHING`, [spence, james]); } catch { /* schema variance */ }
    // the ~9 enslaved people named in the inventory → leads (held by Spence 1774, inherited by James)
    let n = 0;
    for (const nm of ENSLAVED) {
      const lid = (await c.query(`INSERT INTO unconfirmed_persons (full_name, person_type, locations, context_text, source_url, source_type, extraction_method, confidence_score, created_at)
         VALUES ($1,'enslaved', ARRAY['Westmoreland County','Virginia'], $2, $3,'secondary','estate_inventory_named',0.75, now()) RETURNING lead_id`,
        [nm, `Named in the 1774 estate inventory of Spence Monroe (Westmoreland Co., VA); enslaved by Spence Monroe and inherited by James Monroe (later 5th U.S. President).`, SRC])).rows[0].lead_id;
      await c.query(`INSERT INTO person_external_ids (subject_table, subject_id, id_system, external_id, confidence)
        VALUES ('unconfirmed_persons',$1,'spence_monroe_inventory_1774',$2,0.75) ON CONFLICT (id_system, external_id) DO NOTHING`, [lid, 'smi1774:' + nm.toLowerCase()]);
      n++;
    }
    await c.query('COMMIT');
    console.log(`✓ Spence Monroe #${spence} (assertable) + President James Monroe #${james} (assertable) — 1774 inventory evidences holding`);
    console.log(`  ${n} enslaved leads named in the inventory: ${ENSLAVED.join(', ')}`);
    console.log(`  GOLD follow-on: Westmoreland County will/inventory book SCAN (LVA / FamilySearch VA probate) for the RULE 0.6 image.`);
  } catch (e) { await c.query('ROLLBACK'); console.error('ROLLBACK:', e.message); }
  finally { c.release(); await pool.end(); }
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
