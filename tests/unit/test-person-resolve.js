#!/usr/bin/env node
/**
 * Broad validation for PersonService.resolve (step 1 of the person-layer consolidation).
 * Two layers of coverage:
 *  (A) CURATED regression cases (grounded in real records) across the case types:
 *      common-name ambiguity, unique match, surname cluster, external-id Tier-1,
 *      no-match, placeholder/invalid.
 *  (B) STATISTICAL self-match pass over a random real sample — the breadth that catches
 *      failure modes we didn't hand-pick. For each sampled real person, resolve(name +
 *      birthYear) and classify: matched-SELF (correct), matched-OTHER (FALSE POSITIVE —
 *      the dangerous case; inspect), or no-match (ambiguous/uncorroborated).
 *
 *   node tests/unit/test-person-resolve.js [--sample 200]
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { Pool } = require('pg');
const PersonService = require('../../src/services/PersonService');

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const SAMPLE = parseInt(arg('--sample', '200'), 10);

const CURATED = [
  { d: 'common first-name Mary/f → NO auto-match (ambiguous)', q: { name: 'Mary', sex: 'f', birthYear: 1812 }, ok: r => r.match === null },
  { d: 'common first-name John/m → NO auto-match (ambiguous)', q: { name: 'John', sex: 'm', birthYear: 1820 }, ok: r => r.match === null },
  { d: 'unique James Hopewell 1780 → match #1070', q: { name: 'James Hopewell', birthYear: 1780 }, ok: r => r.match && r.match.subject_id === 1070 },
  { d: 'unique Thomas Aston Coffin 1795 → match #1212', q: { name: 'Thomas Aston Coffin', birthYear: 1795 }, ok: r => r.match && r.match.subject_id === 1212 },
  { d: 'George Washington Biscoe 1787 → match #140301', q: { name: 'George Washington Biscoe', birthYear: 1787 }, ok: r => r.match && r.match.subject_id === 140301 },
  { d: 'external-id Tier-1 familysearch:L4QZ-F2H → match #140888 (tier 1)', q: { name: 'Mary Tarbell', externalId: 'L4QZ-F2H', idSystem: 'familysearch' }, ok: r => r.match && r.match.subject_id === 140888 && r.match.tier === 1 },
  { d: 'surname cluster Ann Biscoe 1799 → NO auto-match, candidates incl Biscoe', q: { name: 'Ann Biscoe', birthYear: 1799 }, ok: r => r.match === null && r.candidates.some(c => /biscoe/i.test(c.name)) },
  { d: 'nonexistent name → NO match (weak phonetic candidates ok, never an auto-match)', q: { name: 'Zxqwerty Nonesuchington', birthYear: 1800 }, ok: r => r.match === null },
  { d: 'placeholder "unnamed" → no match', q: { name: 'unnamed' }, ok: r => r.match === null },
  { d: 'numeric name → no match', q: { name: '12345' }, ok: r => r.match === null },
];

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const svc = new PersonService(pool);

  // ---- (A) curated ----
  console.log('=== (A) CURATED regression cases ===');
  let passA = 0;
  for (const c of CURATED) {
    let r, ok = false, err = '';
    try { r = await svc.resolve(c.q); ok = c.ok(r); } catch (e) { err = e.message; }
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${c.d}${ok ? '' : `  → match=${r && r.match ? '#' + r.match.subject_id : 'null'} cand=${r ? r.candidates.length : '?'} ${err}`}`);
    if (ok) passA++;
  }
  console.log(`  curated: ${passA}/${CURATED.length} passed\n`);

  // ---- (B) statistical self-match over random real samples, per population ----
  async function statPass(label, rows, selfTable, selfId) {
    console.log(`\n=== (B) STATISTICAL self-match — ${label} (n=${rows.length}) ===`);
    let self = 0, other = 0, none = 0; const falsePos = []; let i = 0;
    for (const p of rows) {
      const r = await svc.resolve(p.query);
      if (!r.match) none++;
      else if (r.match.subject_table === selfTable && r.match.subject_id === selfId(p)) self++;
      else { other++; if (falsePos.length < 12) falsePos.push({ q: p.label, got: `${r.match.kind}/${r.match.subject_table}#${r.match.subject_id} ${r.match.name} b.${r.match.birth_year || '?'} {${(r.match.signals || []).join(',')}}` }); }
      if (++i % 50 === 0) process.stdout.write(`  …${i}/${rows.length}\r`);
    }
    const pct = n => (100 * n / rows.length).toFixed(1);
    console.log(`\n  matched-SELF (correct):      ${self} (${pct(self)}%)`);
    console.log(`  matched-OTHER (FALSE POS!):  ${other} (${pct(other)}%)`);
    console.log(`  no-match (ambiguous/uncorr): ${none} (${pct(none)}%)`);
    if (falsePos.length) { console.log('  matched-OTHER examples (false positive OR real duplicate — needs eyes):'); falsePos.forEach(f => console.log(`    ${f.q}  →  ${f.got}`)); }
    return other;
  }

  const canon = (await pool.query(
    `SELECT id, canonical_name, birth_year_estimate, primary_state, sex FROM canonical_persons
      WHERE birth_year_estimate IS NOT NULL AND canonical_name ~ '\\s' AND person_type IS NOT NULL
      ORDER BY random() LIMIT $1`, [SAMPLE])).rows
    .map(p => ({ query: { name: p.canonical_name, birthYear: p.birth_year_estimate, location: p.primary_state, sex: p.sex }, label: `"${p.canonical_name}" b.${p.birth_year_estimate} #${p.id}`, id: p.id }));

  // PAST leads — the highest-risk first-name population
  const past = (await pool.query(
    `SELECT sv_id::int AS sid, name, sex, (year-age)::int AS by FROM slavevoyages_past_people
      WHERE sv_id ~ '^[0-9]+$' AND name IS NOT NULL AND length(trim(name))>1 AND year IS NOT NULL AND age IS NOT NULL
      ORDER BY random() LIMIT $1`, [SAMPLE])).rows
    .map(p => ({ query: { name: p.name, birthYear: p.by, sex: p.sex }, label: `"${p.name}" b.${p.by} sv#${p.sid}`, sid: p.sid }));

  const fp1 = await statPass('canonical_persons', canon, 'canonical_persons', p => p.id);
  const fp2 = await statPass('slavevoyages_past_people (first-name leads, riskiest)', past, 'slavevoyages_past_people', p => p.sid);
  console.log(`\n=== TOTAL false positives across ${canon.length + past.length} samples: ${fp1 + fp2} ===`);
  await pool.end();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
