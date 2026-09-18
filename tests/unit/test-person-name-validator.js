/**
 * test-person-name-validator.js — guards the mint gate in BOTH directions.
 *
 * The gate (PersonService.findOrCreateLead → isValidPersonName / isNameSuspect) is the single door every
 * person enters through, so both of its failure modes are expensive and they are NOT symmetric in how they
 * are noticed:
 *   - a false ACCEPT mints a non-person, and shows up later as junk somebody must delete (May-2026: 3,271);
 *   - a false REJECT destroys evidence SILENTLY — the row never exists, so nothing surfaces it. That is how
 *     87 real probate decedents ("A. S. Bacon", "Hannah Byrd", "Mrs. Eunice Miller Ashmore") were dropped
 *     until Aug 2026, and how fsIdClean() discarded 8 real climb seeds before it.
 *
 * Ground truth lives in tests/fixtures/person-names.json — add real corpus examples there, never here.
 *
 *   node tests/unit/test-person-name-validator.js
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { isValidPersonName, isNameSuspect } = require(path.resolve(__dirname, '../../src/utils/person-name-validator'));

const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/person-names.json'), 'utf8'));

let pass = 0;
const failures = [];

const check = (label, name, actual, expected, why) => {
  if (actual === expected) { pass++; return; }
  failures.push(`${label}: ${JSON.stringify(name)} → got ${actual}, expected ${expected}  (${why})`);
};

for (const c of fixture.must_pass) check('isValidPersonName', c.name, isValidPersonName(c.name), true, c.why);
for (const c of fixture.must_reject) check('isValidPersonName', c.name, isValidPersonName(c.name), false, c.why);
for (const c of fixture.must_be_suspect) check('isNameSuspect', c.name, isNameSuspect(c.name), true, c.why);
for (const c of fixture.must_not_be_suspect) check('isNameSuspect', c.name, isNameSuspect(c.name), false, c.why);

console.log(`person-name-validator: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('\nFAILURES:');
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log('✓ mint gate holds in both directions');
