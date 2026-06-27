#!/usr/bin/env node
/**
 * Self-cleaning test for PersonService.promoteToCanonical + recomputeGate (step 3).
 * Unique throwaway name; DELETES everything it creates. Verifies:
 *   - dry-run → would_create, no canonical written
 *   - promote (secondary only) → canonical CREATED but GATED (both flags FALSE)
 *   - re-promote same identity → LINKS to the same canonical (dedup, no duplicate)
 *   - attach a STORED proposition-specific doc (census_slave_schedule + s3_key) → gate lifts
 *     for slaveowner only (enslaved stays FALSE)
 *   - blocking keys written (discoverable)
 *
 *   node tests/unit/test-person-promote.js
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { Pool } = require('pg');
const PersonService = require('../../src/services/PersonService');

const NAME = 'Zzqpromote Uniqueowner';
const BIRTH = 1788;

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const svc = new PersonService(pool);
  let leadId = null, leadId2 = null, canonicalId = null, pass = 0, total = 0;
  const check = (cond, msg) => { total++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (cond) pass++; };
  try {
    // clean slate
    await pool.query(`DELETE FROM unconfirmed_persons WHERE full_name=$1`, [NAME]);
    await pool.query(`DELETE FROM canonical_persons WHERE canonical_name=$1`, [NAME]);

    // create a lead to promote
    const lead = await svc.findOrCreateLead({ name: NAME, birthYear: BIRTH, sex: 'm', personType: 'suspected_owner', sourceUrl: 'test://promote-selftest', sourceType: 'test' });
    leadId = lead.ref.subject_id;
    check(lead.action === 'created', `lead created (#${leadId})`);

    // dry-run promote → would_create, nothing written
    const dry = await svc.promoteToCanonical({ subject_table: 'unconfirmed_persons', subject_id: leadId }, { personType: 'enslaver', createdBy: 'test' }, { dryRun: true });
    check(dry.action === 'would_create', `dry-run → would_create (got ${dry.action})`);
    const c0 = (await pool.query(`SELECT count(*) n FROM canonical_persons WHERE canonical_name=$1`, [NAME])).rows[0].n;
    check(c0 === '0', `dry-run wrote no canonical (count=${c0})`);

    // real promote, SECONDARY only (no s3_key) → created + GATED
    const prom = await svc.promoteToCanonical(
      { subject_table: 'unconfirmed_persons', subject_id: leadId },
      { personType: 'enslaver', sourceType: 'secondary', createdBy: 'test', document: { documentType: 'familysearch_record', sourceUrl: 'test://fs' } });
    canonicalId = prom.ref && prom.ref.subject_id;
    check(prom.action === 'created' && canonicalId, `promote → canonical CREATED (#${canonicalId})`);
    check(prom.gate && prom.gate.assertable_slaveowner === false && prom.gate.assertable_enslaved === false, `secondary-only → GATED (both FALSE)`);

    // blocking keys written for the canonical (discoverable)
    const bk = (await pool.query(`SELECT count(*) n FROM person_blocking_keys WHERE subject_table='canonical_persons' AND subject_id=$1`, [canonicalId])).rows[0].n;
    check(Number(bk) > 0, `canonical has blocking keys (${bk})`);

    // lead marked promoted
    const st = (await pool.query(`SELECT status FROM unconfirmed_persons WHERE lead_id=$1`, [leadId])).rows[0].status;
    check(st === 'promoted', `source lead marked promoted (got ${st})`);

    // re-ingest same identity → dedups to the SAME canonical (promoted lead's keys are gone,
    // so the canonical is the single pool entry → unambiguous link, no duplicate)
    const reagain = await svc.findOrCreateLead({ name: NAME, birthYear: BIRTH, sex: 'm', personType: 'suspected_owner', sourceUrl: 'test://promote-selftest-2', sourceType: 'test' });
    if (reagain.ref && reagain.ref.subject_table === 'unconfirmed_persons') leadId2 = reagain.ref.subject_id;
    check(reagain.action === 'linked' && reagain.ref.subject_table === 'canonical_persons' && reagain.ref.subject_id === canonicalId, `re-ingest dedups to same canonical (no dup)`);
    const cN = (await pool.query(`SELECT count(*) n FROM canonical_persons WHERE canonical_name=$1`, [NAME])).rows[0].n;
    check(cN === '1', `exactly ONE canonical for this identity (count=${cN})`);

    // attach a STORED proposition-specific doc → gate lifts for slaveowner only
    await pool.query(
      `INSERT INTO person_documents (canonical_person_id, name_as_appears, document_type, s3_key, s3_url, source_type, evidence_strength)
       VALUES ($1,$2,'census_slave_schedule','s3://test/key.jpg','s3://test/key.jpg','primary','direct_primary')`, [canonicalId, NAME]);
    const gate = await svc.recomputeGate(canonicalId);
    check(gate.assertable_slaveowner === true, `stored slave-schedule lifts slaveowner gate`);
    check(gate.assertable_enslaved === false, `enslaved gate stays FALSE (proposition-specific)`);

    console.log(`\n  ${pass}/${total} passed`);
  } catch (e) {
    console.error('  ERROR:', e.message);
  } finally {
    // cleanup (children first)
    if (canonicalId) {
      await pool.query(`DELETE FROM person_documents WHERE canonical_person_id=$1`, [canonicalId]);
      await pool.query(`DELETE FROM person_external_ids WHERE canonical_person_id=$1`, [canonicalId]);
      await pool.query(`DELETE FROM person_blocking_keys WHERE subject_table='canonical_persons' AND subject_id=$1`, [canonicalId]);
      await pool.query(`DELETE FROM canonical_persons WHERE id=$1`, [canonicalId]);
    }
    for (const lid of [leadId, leadId2]) if (lid) {
      await pool.query(`DELETE FROM person_blocking_keys WHERE subject_table='unconfirmed_persons' AND subject_id=$1`, [lid]);
      await pool.query(`DELETE FROM unconfirmed_persons WHERE lead_id=$1`, [lid]);
    }
    const left = (await pool.query(`SELECT count(*) n FROM canonical_persons WHERE canonical_name=$1`, [NAME])).rows[0].n;
    console.log(`  cleanup: ${left === '0' ? 'OK' : 'LEFTOVER canonical=' + left}`);
    await pool.end();
  }
})();
