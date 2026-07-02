#!/usr/bin/env node
/**
 * test-dual-status-derivation.js — #96 P3 regression.
 *
 * Proves: (1) person_role_group() maps owner-side/enslaved-side/etc. correctly; (2) the dual-status
 * derivation upgrades a canonical carrying BOTH a slaveholding fact and a free/enslaved-status fact
 * to free_poc_slaveholder (William Ellison shape), leaves single-status people alone, and the
 * upgraded person is in the 'owner' role group (so the debit ledger includes them).
 *
 * Non-destructive: transaction + ROLLBACK.
 *   node tests/unit/test-dual-status-derivation.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const assert = require('node:assert');
const pg = require('pg');

let passed = 0, failed = 0;
const check = (name, cond) => { if (cond) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name}`); } };

// The derivation's candidate predicate (mirrors scripts/derive-dual-status-summary.mjs).
const UPGRADE = `
  UPDATE canonical_persons SET person_type='free_poc_slaveholder'
  WHERE person_type <> 'free_poc_slaveholder'
    AND EXISTS (SELECT 1 FROM person_facts f WHERE f.person_id=canonical_persons.id AND f.fact_type='slaveholding')
    AND EXISTS (SELECT 1 FROM person_facts f WHERE f.person_id=canonical_persons.id AND f.fact_type IN ('free_status','enslavement','manumission'))
    AND id = ANY($1::int[])
  RETURNING id`;

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const c = await pool.connect();
  await c.query('BEGIN');
  try {
    // person_role_group() unit checks
    const rg = (await c.query(`SELECT person_role_group('free_poc_slaveholder') o, person_role_group('enslaved') e, person_role_group('merged') m`)).rows[0];
    check('person_role_group(free_poc_slaveholder) = owner', rg.o === 'owner');
    check('person_role_group(enslaved) = enslaved', rg.e === 'enslaved');
    check('person_role_group(merged) = merged', rg.m === 'merged');

    const mk = async (name, type) => (await c.query(`INSERT INTO canonical_persons (canonical_name, person_type) VALUES ($1,$2) RETURNING id`, [name, type])).rows[0].id;
    const fact = async (pid, ft) => c.query(`INSERT INTO person_facts (person_id, fact_type) VALUES ($1,$2)`, [pid, ft]);

    // Ellison: enslaved-then-owner → slaveholding + free_status facts
    const ellison = await mk('Test Ellison', 'freedperson');
    await fact(ellison, 'slaveholding');
    await fact(ellison, 'free_status');
    // Single-status owner: only slaveholding
    const owner = await mk('Test Plain Owner', 'enslaver');
    await fact(owner, 'slaveholding');
    // Single-status freed: only free_status
    const freed = await mk('Test Plain Freed', 'freedperson');
    await fact(freed, 'free_status');

    await c.query(UPGRADE, [[ellison, owner, freed]]);
    const types = new Map((await c.query(`SELECT id, person_type FROM canonical_persons WHERE id = ANY($1::int[])`, [[ellison, owner, freed]])).rows.map(r => [r.id, r.person_type]));

    check('dual-status (slaveholding + free_status) → free_poc_slaveholder', types.get(ellison) === 'free_poc_slaveholder');
    check('single-status owner (slaveholding only) unchanged', types.get(owner) === 'enslaver');
    check('single-status freed (free_status only) unchanged', types.get(freed) === 'freedperson');

    // The upgraded person is owner-side → included in the debit ledger scope
    const inOwner = (await c.query(`SELECT person_role_group(person_type) g FROM canonical_persons WHERE id=$1`, [ellison])).rows[0].g;
    check('upgraded Ellison is in owner role group (debit ledger includes them)', inOwner === 'owner');
  } finally {
    await c.query('ROLLBACK');
    c.release();
    await pool.end();
  }
  console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
