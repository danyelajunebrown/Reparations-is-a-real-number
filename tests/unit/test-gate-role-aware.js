#!/usr/bin/env node
/**
 * test-gate-role-aware.js — regression for the role-aware external-assertion gate (#95).
 *
 * Guards the fix against silent reversion: a stored WILL alone must NOT flip both flags; each
 * proposition must be earned by its own role/content. The William Ellison case (born enslaved →
 * major slaveowner) is the canonical dual-status fixture — a naive "slaveowner XOR enslaved" fix
 * would erase him, so we assert he keeps BOTH when each is separately documented.
 *
 * Non-destructive: all fixtures are created inside a transaction and ROLLED BACK.
 *
 *   node tests/unit/test-gate-role-aware.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const assert = require('node:assert');
const pg = require('pg');
const PersonService = require('../../src/services/PersonService');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}`); }
}

async function main() {
  const client = await pool.connect();
  const svc = new PersonService(client);
  await client.query('BEGIN');
  try {
    const mkPerson = async (name, type) =>
      (await client.query(`INSERT INTO canonical_persons (canonical_name, person_type) VALUES ($1,$2) RETURNING id`, [name, type])).rows[0].id;
    const mkDoc = async (cid, docType, { s3 = true } = {}) =>
      (await client.query(
        `INSERT INTO person_documents (canonical_person_id, name_as_appears, document_type, s3_key)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [cid, `fixture-${docType}`, docType, s3 ? `fixtures/${cid}-${docType}.jpg` : null])).rows[0].id;
    const mkOwnerEdge = async (ownerCid) =>
      client.query(
        `INSERT INTO enslaved_owner_relationships (enslaved_name, owner_name, owner_subject_table, owner_subject_id, owner_canonical_id)
         VALUES ('Fixture Enslaved','Fixture Owner','canonical_persons',$1,$1)`, [ownerCid]);
    const mkEnslavedEdge = async (enslavedCid) =>
      client.query(
        `INSERT INTO enslaved_owner_relationships (enslaved_name, owner_name, enslaved_subject_table, enslaved_subject_id, enslaved_canonical_id)
         VALUES ('Fixture Enslaved','Fixture Owner','canonical_persons',$1,$1)`, [enslavedCid]);
    const mkProbateCount = async (docId, n) =>
      client.query(
        `INSERT INTO probate_scrape_progress (collection_id, county, state, image_number, person_document_id, enslaved_count, status)
         VALUES ('TEST','Fixture','NY',1,$1,$2,'written')`, [docId, n]);
    const gate = (id) => svc.recomputeGate(id);

    // 1. THE BUG: a stored will, no enslaved evidence → NEITHER flag.
    let id = await mkPerson('Will Only Testator', 'enslaver');
    await mkDoc(id, 'will');
    let g = await gate(id);
    check('will-only testator → slaveowner FALSE', g.assertable_slaveowner === false);
    check('will-only testator → enslaved FALSE (the #95 bug)', g.assertable_enslaved === false);

    // 2. Slave schedule (owner-named type) → slaveowner only.
    id = await mkPerson('Schedule Owner', 'enslaver');
    await mkDoc(id, 'slave_schedule');
    g = await gate(id);
    check('slave_schedule → slaveowner TRUE', g.assertable_slaveowner === true);
    check('slave_schedule → enslaved FALSE', g.assertable_enslaved === false);

    // 3. Will + owner edge in the estate graph → slaveowner (content corroborated).
    id = await mkPerson('Will Plus Owner Edge', 'enslaver');
    await mkDoc(id, 'will');
    await mkOwnerEdge(id);
    g = await gate(id);
    check('will + owner edge → slaveowner TRUE', g.assertable_slaveowner === true);
    check('will + owner edge → enslaved FALSE', g.assertable_enslaved === false);

    // 4. Will + probate enslaved_count>0 → slaveowner (enumeration supports the OWNER).
    id = await mkPerson('Will Plus Enslaved Count', 'enslaver');
    const docId = await mkDoc(id, 'estate_inventory');
    await mkProbateCount(docId, 3);
    g = await gate(id);
    check('inventory + enslaved_count>0 → slaveowner TRUE', g.assertable_slaveowner === true);
    check('inventory + enslaved_count>0 → enslaved FALSE (enumeration ≠ named individual)', g.assertable_enslaved === false);

    // 5. Certificate of freedom (enslaved-subject type) → enslaved only.
    id = await mkPerson('Freed Person', 'freedperson');
    await mkDoc(id, 'certificate_of_freedom');
    g = await gate(id);
    check('certificate_of_freedom → enslaved TRUE', g.assertable_enslaved === true);
    check('certificate_of_freedom → slaveowner FALSE', g.assertable_slaveowner === false);

    // 6. ELLISON: slave schedule (owner) + certificate of freedom (was enslaved) → BOTH.
    id = await mkPerson('William Ellison (Ellerson)', 'enslaver');
    await mkDoc(id, 'slave_schedule');
    await mkDoc(id, 'certificate_of_freedom');
    g = await gate(id);
    check('Ellison dual-status → slaveowner TRUE', g.assertable_slaveowner === true);
    check('Ellison dual-status → enslaved TRUE (must NOT be erased)', g.assertable_enslaved === true);

    // 7. Will where the person is the ENSLAVED subject in the estate graph → enslaved.
    id = await mkPerson('Named Enslaved In Inventory', 'enslaved');
    await mkDoc(id, 'estate_inventory');
    await mkEnslavedEdge(id);
    g = await gate(id);
    check('inventory + enslaved-subject edge → enslaved TRUE', g.assertable_enslaved === true);

    // 8. URL-only doc (no s3_key) → neither (gate needs a STORED file).
    id = await mkPerson('URL Only', 'enslaver');
    await mkDoc(id, 'slave_schedule', { s3: false });
    g = await gate(id);
    check('slave_schedule without s3_key → slaveowner FALSE (needs stored file)', g.assertable_slaveowner === false);

  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }

  console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
