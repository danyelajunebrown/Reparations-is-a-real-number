#!/usr/bin/env node
/**
 * Self-cleaning test for de-siloing fix #1 (migration 103): lead-aware relationship edges.
 * Verifies the M101 polymorphic (subject_table, subject_id) retrofit + back-compat trigger on
 * canonical_family_edges and enslaved_owner_relationships:
 *   - legacy writer (person_a_id/person_b_id) → trigger fills the polymorphic subject cols
 *   - a PAST LEAD can be a kinship endpoint (legacy canonical id stays NULL → no FK violation)
 *   - the canonical endpoint is back-filled to the legacy id (legacy readers keep working)
 *   - a lead's edges are queryable by subject ref
 *   - an ownership edge links a PAST enslaved LEAD → an owner canonical
 *
 *   node tests/unit/test-lead-aware-edges.js
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { Pool } = require('pg');

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  let pass = 0, total = 0;
  const check = (c, m) => { total++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}`); if (c) pass++; };
  const made = { cfe: [], eor: [] };
  try {
    const cid = (await pool.query('SELECT id FROM canonical_persons ORDER BY id DESC LIMIT 1')).rows[0].id;
    const cid2 = (await pool.query('SELECT id FROM canonical_persons ORDER BY id DESC OFFSET 1 LIMIT 1')).rows[0].id;
    const pastId = String((await pool.query('SELECT sv_id FROM slavevoyages_past_people LIMIT 1')).rows[0].sv_id);

    // 1. legacy writer → trigger fills polymorphic cols
    const e1 = await pool.query(
      `INSERT INTO canonical_family_edges (person_a_id, person_b_id, relationship_type, confidence)
       VALUES ($1,$2,'child_of',0.9) RETURNING id, a_subject_table, a_subject_id, b_subject_id`, [cid, cid2]);
    made.cfe.push(e1.rows[0].id);
    check(e1.rows[0].a_subject_table === 'canonical_persons' && e1.rows[0].a_subject_id === cid && e1.rows[0].b_subject_id === cid2,
      'legacy insert → trigger filled polymorphic subject cols');

    // 2. PAST lead as a kinship endpoint (legacy person_a_id stays NULL)
    const e2 = await pool.query(
      `INSERT INTO canonical_family_edges (a_subject_table, a_subject_id, b_subject_table, b_subject_id, relationship_type, confidence)
       VALUES ('slavevoyages_past_people',$1,'canonical_persons',$2,'child_of',0.8)
       RETURNING id, person_a_id, person_b_id, a_subject_table, a_subject_id`, [pastId, cid]);
    made.cfe.push(e2.rows[0].id);
    check(e2.rows[0].a_subject_table === 'slavevoyages_past_people' && String(e2.rows[0].a_subject_id) === pastId, 'PAST lead is a kinship endpoint');
    check(e2.rows[0].person_a_id === null, 'lead endpoint leaves legacy person_a_id NULL (no canonical-FK violation)');
    check(e2.rows[0].person_b_id === cid, 'canonical endpoint back-filled to legacy person_b_id (legacy readers OK)');

    // 3. lead's edges are queryable by subject ref
    const q = await pool.query(
      `SELECT count(*) c FROM canonical_family_edges WHERE a_subject_table='slavevoyages_past_people' AND a_subject_id=$1`, [pastId]);
    check(Number(q.rows[0].c) >= 1, `PAST lead's kinship edges are queryable (${q.rows[0].c})`);

    // 4. ownership edge: PAST enslaved lead → owner canonical
    const e3 = await pool.query(
      `INSERT INTO enslaved_owner_relationships (enslaved_subject_table, enslaved_subject_id, enslaved_name, owner_subject_table, owner_subject_id, owner_name, relationship_type)
       VALUES ('slavevoyages_past_people',$1,'(test)','canonical_persons',$2,'(test)','enslaved_by')
       RETURNING id, enslaved_subject_table, owner_canonical_id`, [pastId, cid]);
    made.eor.push(e3.rows[0].id);
    check(e3.rows[0].enslaved_subject_table === 'slavevoyages_past_people' && e3.rows[0].owner_canonical_id === cid,
      'ownership edge: PAST enslaved lead → owner canonical (legacy owner_canonical_id synced)');

    console.log(`\n  ${pass}/${total} passed`);
  } catch (e) {
    console.error('  ERROR:', e.message);
  } finally {
    for (const id of made.cfe) await pool.query('DELETE FROM canonical_family_edges WHERE id=$1', [id]);
    for (const id of made.eor) await pool.query('DELETE FROM enslaved_owner_relationships WHERE id=$1', [id]);
    console.log('  cleanup OK');
    await pool.end();
  }
})();
