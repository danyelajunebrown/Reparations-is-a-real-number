#!/usr/bin/env node
/**
 * test-daa-owner-universe.js — #96 P0 regression.
 *
 * Guards two things:
 *  1. person-roles.js groups (owner-side includes free_poc_slaveholder; enslaved/descendant excluded).
 *  2. The DAA owner-universe scope query (DAAOrchestrator step 2b) now LOADS owner-side synonyms —
 *     especially free_poc_slaveholder (William Ellison: free person of color who owned people) — which
 *     the old `person_type IN ('enslaver','descendant')` silently dropped, zeroing their obligation.
 *
 * Non-destructive: DB fixtures created in a transaction and ROLLED BACK.
 *   node tests/unit/test-daa-owner-universe.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const assert = require('node:assert');
const pg = require('pg');
const { OWNER_ROLE_TYPES, roleGroup, isOwnerType } = require('../../src/services/person-roles');

let passed = 0, failed = 0;
const check = (name, cond) => { if (cond) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name}`); } };

// 1. role-group unit assertions
check('free_poc_slaveholder is owner-side', isOwnerType('free_poc_slaveholder') && roleGroup('free_poc_slaveholder') === 'owner');
check('slaveholder/owner/slave_owner are owner-side', ['slaveholder', 'owner', 'slave_owner'].every(isOwnerType));
check('enslaved is NOT owner-side', !isOwnerType('enslaved') && roleGroup('enslaved') === 'enslaved');
check('descendant is its own group', roleGroup('descendant') === 'descendant' && !isOwnerType('descendant'));
check('merged is a tombstone, not owner', roleGroup('merged') === 'merged');

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  await client.query('BEGIN');
  try {
    const mk = async (name, type) =>
      (await client.query(`INSERT INTO canonical_persons (canonical_name, person_type) VALUES ($1,$2) RETURNING id`, [name, type])).rows[0].id;
    const ellison = await mk('P0 Test Ellison', 'free_poc_slaveholder');
    const plainOwner = await mk('P0 Test Owner', 'enslaver');
    const descendant = await mk('P0 Test Descendant', 'descendant');
    const enslaved = await mk('P0 Test Enslaved', 'enslaved');

    // The exact scope predicate from DAAOrchestrator step 2b (owner-side ∪ descendant).
    const scope = [...OWNER_ROLE_TYPES, 'descendant'];
    const r = await client.query(
      `SELECT id, person_type FROM canonical_persons WHERE person_type = ANY($1::text[]) AND id = ANY($2::int[])`,
      [scope, [ellison, plainOwner, descendant, enslaved]]);
    const ids = new Set(r.rows.map(x => x.id));

    check('DAA scope INCLUDES free_poc_slaveholder (the fix — was excluded before)', ids.has(ellison));
    check('DAA scope includes plain enslaver', ids.has(plainOwner));
    check('DAA scope includes descendant (acknowledger side)', ids.has(descendant));
    check('DAA scope EXCLUDES enslaved (not an owner or descendant)', !ids.has(enslaved));
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
  console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
