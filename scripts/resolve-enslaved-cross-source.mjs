#!/usr/bin/env node
/**
 * Issue #63 — enslaved owner-anchored cross-source dedup (Phase B of the unconfirmed_persons pass).
 *
 * The ~1.5M first-name-only ENSLAVED unconfirmed_persons carry an OWNER anchor in
 * `relationships` ({age, year, owner, state, county}). Their own surname is missing, so we block on
 * the OWNER instead: (owner-surname + state + county + year). Within an owner-block we find the SAME
 * enslaved person appearing in DIFFERENT sources (1860 schedule ↔ probate inventory ↔ Freedman's).
 *
 * Biscoe guardrails, applied BEFORE scoring:
 *   - Census mutual-exclusion (rule #2): two rows from the SAME source (same schedule) are provably
 *     DIFFERENT people → never paired.
 *   - First-name-only people are NEVER auto-merged → every pair routes to review.
 * Scoring (cross-source pairs only): given-name agreement (JW) + age agreement (±2) + gender.
 *
 * GOLD/REPORT mode first (acceptance criterion — validate before scale + before storage):
 *   node scripts/resolve-enslaved-cross-source.mjs --owner "Franklin"   # inspect one owner's blocks
 *   node scripts/resolve-enslaved-cross-source.mjs --owner "Isaac Franklin"
 * (--all + persistence land after the pairs-table migration; this build is report-only.)
 */
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv'; import pg from 'pg';
import { deriveSurnames, normalizeState } from './lib/name-normalize.mjs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const argVal = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const OWNER = argVal('--owner', null);
const REVIEW_MIN = 4;

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
// given name = first alphabetic token; placeholders ("unknown"/"no name"/"negro"/"boy"...) → null.
const PLACEHOLDER = new Set(['unknown', 'unnamed', 'noname', 'none', 'nonegiven', 'negro', 'boy', 'girl', 'man', 'woman', 'male', 'female', 'infant', 'child', 'slave']);
function givenName(full) {
  const m = norm(full).match(/[a-z]+/g);
  if (!m) return null;
  const g = m[0];
  return PLACEHOLDER.has(g) ? null : g;
}
function ageOf(lead) {
  const a = lead.relationships && lead.relationships.age;
  if (a != null && a !== '') { const n = parseInt(a, 10); if (!isNaN(n)) return n; }
  const m = String(lead.full_name || '').match(/age\s+(\d{1,3})/i); // "Unknown (Male, age 13)"
  return m ? parseInt(m[1], 10) : null;
}
function genderOf(lead) {
  const g = (lead.gender || '').trim().toLowerCase()[0];
  if (g === 'm' || g === 'f') return g;
  const m = String(lead.full_name || '').match(/\b(male|female)\b/i);
  return m ? m[1][0].toLowerCase() : null;
}
function jaroWinkler(s1, s2) {
  s1 = (s1 || '').toLowerCase(); s2 = (s2 || '').toLowerCase();
  if (!s1 || !s2) return 0; if (s1 === s2) return 1;
  const md = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const m1 = new Array(s1.length).fill(false), m2 = new Array(s2.length).fill(false); let m = 0;
  for (let i = 0; i < s1.length; i++) { const lo = Math.max(0, i - md), hi = Math.min(i + md + 1, s2.length); for (let j = lo; j < hi; j++) { if (!m2[j] && s1[i] === s2[j]) { m1[i] = m2[j] = true; m++; break; } } }
  if (!m) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < s1.length; i++) { if (m1[i]) { while (!m2[k]) k++; if (s1[i] !== s2[k]) t++; k++; } }
  t /= 2;
  const jaro = (m / s1.length + m / s2.length + (m - t) / m) / 3;
  let p = 0; while (p < 4 && s1[p] === s2[p]) p++;
  return jaro + p * 0.1 * (1 - jaro);
}

// owner-anchored block key: owner-surname + normalized state + county.
// YEAR is deliberately EXCLUDED from the block: the dominant cross-source overlap is
// pre_indexed ↔ census_ocr_extraction (two pipelines over the SAME 1860 census) which populate the
// `year` field inconsistently, so including year splits true matches apart (measured: 0 vs 399 blocks).
// Year still informs scoring via age (same-year census-census → raw age compare is valid).
function blockKeys(lead) {
  const r = lead.relationships || {};
  const owner = r.owner; if (!owner) return [];
  const surs = deriveSurnames(owner, null); if (!surs.length) return [];
  const st = normalizeState(r.state) || '?';
  const co = (r.county || '?').toLowerCase().trim();
  if (co === '?') return [];                          // no county → block too coarse (owner-name only); skip
  return surs.map((s) => `${s}|${st}|${co}`);
}

function scorePair(a, b) {
  const ev = []; let s = 0;
  const ga = givenName(a.full_name), gb = givenName(b.full_name);
  if (ga && gb) {
    const jw = jaroWinkler(ga, gb);
    if (ga === gb) { s += 4; ev.push(`same given name "${ga}" (+4)`); }
    else if (jw >= 0.90) { s += 2; ev.push(`given name ~${jw.toFixed(2)} (+2)`); }
    else { s -= 4; ev.push(`given names differ ${ga}/${gb} (-4)`); }
  } else { ev.push('given name unavailable (placeholder)'); }
  const aa = ageOf(a), ab = ageOf(b);
  if (aa != null && ab != null) {
    // year-adjusted age comparison would need both years; within same-year block ages should match.
    const d = Math.abs(aa - ab);
    if (d <= 1) { s += 3; ev.push(`age ${aa}≈${ab} (+3)`); }
    else if (d <= 3) { s += 1; ev.push(`age ${aa}/${ab} Δ${d} (+1)`); }
    else { s -= 3; ev.push(`age ${aa}/${ab} Δ${d} (-3)`); }
  }
  const xa = genderOf(a), xb = genderOf(b);
  if (xa && xb) { if (xa === xb) { s += 1; ev.push(`gender ${xa} (+1)`); } else { s -= 4; ev.push(`gender ${xa}/${xb} (-4)`); } }
  return { score: Math.round(s * 10) / 10, evidence: ev };
}

(async () => {
  if (!OWNER) { console.log('gold/report mode: pass --owner "<substr>" (e.g. "Franklin"). --all lands after the pairs-table migration.'); await pool.end(); return; }
  console.log(`=== #63 enslaved cross-source (GOLD/REPORT) owner~"${OWNER}" review≥${REVIEW_MIN} ===`);
  const leads = (await pool.query(`
    SELECT lead_id, full_name, gender, source_type, extraction_method, relationships
    FROM unconfirmed_persons
    WHERE person_type IN ('enslaved','suspected_enslaved')
      AND jsonb_typeof(relationships)='object'
      AND lower(relationships->>'owner') LIKE '%'||lower($1)||'%'`, [OWNER])).rows;
  console.log(`loaded ${leads.length.toLocaleString()} enslaved leads under owner~"${OWNER}"`);

  // build owner-blocks
  const blocks = new Map();
  for (const l of leads) for (const bk of blockKeys(l)) { let a = blocks.get(bk); if (!a) { a = []; blocks.set(bk, a); } a.push(l); }
  const multi = [...blocks.entries()].filter(([, a]) => a.length > 1);
  console.log(`${blocks.size} owner-blocks; ${multi.length} with ≥2 leads\n`);

  let pairs = 0, mutex = 0, dropped = 0;
  const found = [];
  for (const [bk, arr] of multi) {
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i], b = arr[j];
      const sameSource = (a.extraction_method || a.source_type) === (b.extraction_method || b.source_type);
      if (sameSource) { mutex++; continue; }                 // Biscoe #2: same schedule → distinct
      const { score, evidence } = scorePair(a, b);
      if (score < REVIEW_MIN) { dropped++; continue; }
      pairs++;
      found.push({ bk, a, b, score, evidence });
    }
  }
  console.log(`cross-source candidate pairs (→review, never auto-merge): ${pairs}`);
  console.log(`  same-source pairs held out by census mutual-exclusion: ${mutex.toLocaleString()}`);
  console.log(`  cross-source pairs below threshold (dropped): ${dropped}\n`);
  found.sort((x, y) => y.score - x.score).slice(0, 20).forEach((p) =>
    console.log(`  [${p.score}] "${p.a.full_name}" (${p.a.extraction_method}) ⇄ "${p.b.full_name}" (${p.b.extraction_method})  block=${p.bk}\n        ${p.evidence.join('; ')}`));
  await pool.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
