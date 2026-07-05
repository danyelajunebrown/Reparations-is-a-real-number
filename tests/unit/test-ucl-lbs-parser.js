/**
 * test-ucl-lbs-parser.js — verify the LBS stage-2 parser against real archived fixtures.
 * Fixtures are 2024-2026 Wayback captures in tests/fixtures/ucl-lbs/ (the current-era DOM the corpus fetch pulls).
 * Run: node tests/unit/test-ucl-lbs-parser.js
 */
const fs = require('fs');
const path = require('path');
const { parseLbs, parsePounds } = require('../../src/services/lbs/lbs-parser');

const FIX = path.join(__dirname, '..', 'fixtures', 'ucl-lbs');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};
const ok = (name, cond, detail) => { console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : `  ${detail || ''}`}`); cond ? pass++ : fail++; };

// ── pounds helper ──
const p = parsePounds('£6212 0s 3d');
eq('pounds.pounds', p.pounds, 6212);
eq('pounds.decimal', p.decimal, +(6212 + 0 / 20 + 3 / 240).toFixed(4));
eq('pounds comma+caps', parsePounds('£6,212 0S 3D').pounds, 6212);

// ── CLAIM (Grenada 770, Telescope Estate) ──
const c = parseLbs('claim', read('claim-10894.html'));
eq('claim.colony', c.colony, 'Grenada');
eq('claim.claimNo', c.claimNo, '770');
eq('claim.contested', c.contested, true);
eq('claim.enslavedCount', c.enslavedCount, 206);
eq('claim.year', c.year, 1836);
eq('claim.compensation.pounds', c.compensation.pounds, 6212);
eq('claim.individuals count', c.individuals.length, 8);
ok('claim has Awardee/claimant with Mortgagee role', c.individuals.some((i) => /Mortgagee/.test(i.role || '')), JSON.stringify(c.individuals.map((i) => i.role)));
ok('claim individuals carry personId', c.individuals.every((i) => /^-?\d+$/.test(i.personId)));
eq('claim.estates count', c.estates.length, 1);
eq('claim.estate id', c.estates[0].estateId, '1368');

// ── PERSON (Thomas Barrett Lennard) ──
const pe = parseLbs('person', read('person-neg1012574016.html'));
ok('person.name present', /Lennard/.test(pe.name || ''), pe.name);
eq('person.occupation', pe.occupation, 'Politician');
ok('person.spouse present', /Shedden|Wharton/.test(pe.spouse || ''), pe.spouse);
ok('person has >=1 associated claim', pe.claims.length >= 1, String(pe.claims.length));
ok('person claim carries £ amount', pe.claims.some((cl) => cl.amount && cl.amount.pounds > 0), JSON.stringify(pe.claims.map((x) => x.amount)));
ok('person has >=1 relationship w/ otherPersonId', pe.relationships.some((r) => /^-?\d+$/.test(r.otherPersonId || '')), JSON.stringify(pe.relationships));
ok('person has >=1 address', pe.addresses.length >= 1, JSON.stringify(pe.addresses));

// ── ESTATE (Telescope Estate) ──
const es = parseLbs('estate', read('estate-1368.html'));
ok('estate.name present', /Telescope/.test(es.name || ''), es.name);
eq('estate.colony', es.colony, 'Grenada');
eq('estate.parish', es.parish, 'St Andrew');
ok('estate has >=5 registration years', es.registrations.length >= 5, String(es.registrations.length));
ok('estate registration has total count', es.registrations.every((r) => Number.isInteger(r.year) && (r.total === null || Number.isInteger(r.total))), JSON.stringify(es.registrations.slice(0, 2)));
ok('estate 1820 reg has F/M split', es.registrations.some((r) => r.year === 1820 && r.female === 109 && r.male === 130), JSON.stringify(es.registrations.find((r) => r.year === 1820)));

// ── FIRM (Imperial Fire) ──
const fm = parseLbs('firm', read('firm-neg17932753.html'));
ok('firm.name present', (fm.name || '').length > 0, fm.name);
ok('firm has >=1 person w/ role', fm.people.some((x) => x.personId && x.role), JSON.stringify(fm.people.slice(0, 3)));

console.log(`\n${pass}/${pass + fail} passed${fail ? `  (${fail} FAILED)` : ''}`);
process.exit(fail ? 1 : 0);
