#!/usr/bin/env node
/**
 * Self-cleaning test for PersonService.findOrCreateLead (step 2).
 * Uses a unique throwaway name so it can't collide with real data, and DELETES
 * everything it creates. Verifies: dry-run, create-lead, resolve-finds-it,
 * re-ingest-LINKS (no duplicate), cleanup.
 *
 *   node tests/unit/test-person-findorcreate.js
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { Pool } = require('pg');
const PersonService = require('../../src/services/PersonService');

const TEST = {
  name: 'Zzqtest Uniqueperson', birthYear: 1777, sex: 'm',
  sourceUrl: 'test://person-service-selftest', sourceType: 'test',
  personType: 'enslaver', context: 'PersonService.findOrCreateLead self-test (auto-deleted)',
};

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const svc = new PersonService(pool);
  let leadId = null, pass = 0, total = 0;
  const check = (cond, msg) => { total++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (cond) pass++; };
  try {
    // 0. ensure clean slate
    await pool.query(`DELETE FROM unconfirmed_persons WHERE full_name=$1`, [TEST.name]);

    // 1. dry-run → would_create, no row
    const dry = await svc.findOrCreateLead(TEST, { dryRun: true });
    check(dry.action === 'would_create', `dry-run → would_create (got ${dry.action})`);
    const c0 = (await pool.query(`SELECT count(*) n FROM unconfirmed_persons WHERE full_name=$1`, [TEST.name])).rows[0].n;
    check(c0 === '0', `dry-run wrote nothing (count=${c0})`);

    // 2. real create → created
    const made = await svc.findOrCreateLead(TEST);
    leadId = made.ref && made.ref.subject_id;
    check(made.action === 'created' && made.ref.subject_table === 'unconfirmed_persons' && leadId, `create → lead unconfirmed_persons#${leadId}`);

    // 3. blocking keys written for the lead
    const k = (await pool.query(`SELECT count(*) n FROM person_blocking_keys WHERE subject_table='unconfirmed_persons' AND subject_id=$1`, [leadId])).rows[0].n;
    check(Number(k) > 0, `blocking keys written (${k})`);

    // 4. resolve now finds the lead (unambiguous: unique name + birth_year)
    const r = await svc.resolve({ name: TEST.name, birthYear: TEST.birthYear, sex: TEST.sex });
    check(r.match && r.match.subject_table === 'unconfirmed_persons' && r.match.subject_id === leadId, `resolve finds the new lead (#${r.match ? r.match.subject_id : 'null'})`);

    // 5. re-ingest LINKS to the existing lead — no duplicate
    const again = await svc.findOrCreateLead(TEST);
    check(again.action === 'linked' && again.ref.subject_id === leadId, `re-ingest → linked (no dup) (got ${again.action})`);
    const c1 = (await pool.query(`SELECT count(*) n FROM unconfirmed_persons WHERE full_name=$1`, [TEST.name])).rows[0].n;
    check(c1 === '1', `still exactly ONE row after re-ingest (count=${c1})`);
  } catch (e) { console.log('  FAIL  exception:', e.message); }
  finally {
    // cleanup — always
    if (leadId) await pool.query(`DELETE FROM person_blocking_keys WHERE subject_table='unconfirmed_persons' AND subject_id=$1`, [leadId]).catch(() => {});
    await pool.query(`DELETE FROM unconfirmed_persons WHERE full_name=$1`, [TEST.name]).catch(() => {});
    const left = (await pool.query(`SELECT count(*) n FROM unconfirmed_persons WHERE full_name=$1`, [TEST.name])).rows[0].n;
    console.log(`  cleanup: ${left === '0' ? 'OK (0 rows left)' : 'WARNING ' + left + ' rows left'}`);
    console.log(`\n  ${pass}/${total} passed`);
    await pool.end();
    process.exit(pass === total ? 0 : 1);
  }
})();
