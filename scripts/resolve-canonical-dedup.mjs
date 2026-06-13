#!/usr/bin/env node
/**
 * Canonical-person dedup resolver (first-pass entity resolution).
 * Block -> score -> route, encoding the verified methodology
 * (research/entity-resolution-methodology.md) + the 5 Biscoe rules.
 *
 * BLOCKING (person_blocking_keys, populated by populate-blocking-keys.mjs):
 *   pairs share a CLEAN surname key (sn) OR a surname-suffix bridge (s4, which
 *   unites spelling variants like Biscoe/Briscoe whose phonetic codes differ),
 *   conjoined with the same first-name initial to keep blocks tractable.
 *   Phonetic codes are for BLOCKING ONLY, never matching.
 *
 * SCORING — name agreement is the blocking PRECONDITION, not evidence. A
 *   positive route REQUIRES corroboration beyond the name (research: never merge
 *   on name alone; route multi-match to review). Additive:
 *     + shared external id (non-census) .............. +10  (near-certain)
 *     + shared parent + name agreement ............... +6   (parentage-primary)
 *     - shared parent + DIFFERENT name -> SIBLINGS ... hard exclude
 *     - CONFLICTING parents (both set, disjoint) ..... -8   (keeps the 3 Anns apart)
 *     + shared spouse ................................ +4
 *     + identical full name .......................... +3
 *     + birth-year |Δ|<=1 / <=3 ...................... +3 / +1
 *     + death-year |Δ|<=1 ............................ +2
 *     + name Jaro-Winkler >=.97 / >=.90 / <.80 ....... +1.5 / +0.5 / -3
 *     + same / different normalized state ............ +1 / -3
 *     - common-name penalty (big block) .............. -1 / -2
 * HARD EXCLUDE (never merge): birth-year Δ>7 (the 1799-vs-1844 case);
 *   enslaver<->enslaved role conflict; two distinct rows in one 1860 census set.
 * ROUTE: score>=8 auto_merge_candidate · >=4 review · else dropped (not stored).
 *   Every routed pair still gets HUMAN review before any merge (Biscoe rule:
 *   edges/merges are hand-resolved, never auto-applied).
 *
 *   node scripts/resolve-canonical-dedup.mjs --validate           # Biscoe gold check
 *   node scripts/resolve-canonical-dedup.mjs --name biscoe        # inspect one block
 *   node scripts/resolve-canonical-dedup.mjs --all [--apply]      # full pass -> dedup_candidate_pairs
 *   node scripts/resolve-canonical-dedup.mjs --all --apply --cap 800 --review-min 4
 */
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv'; import pg from 'pg';
import { normalizeState } from './lib/name-normalize.mjs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const argVal = (flag, def) => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : def; };
const APPLY = process.argv.includes('--apply');
const CAP = parseInt(argVal('--cap', '800'), 10);          // skip blocks bigger than this (defer, logged)
const REVIEW_MIN = parseFloat(argVal('--review-min', '4'));
const AUTO_MIN = parseFloat(argVal('--auto-min', '8'));

function jaroWinkler(s1, s2) {
  s1 = (s1 || '').toLowerCase(); s2 = (s2 || '').toLowerCase();
  if (!s1 || !s2) return 0; if (s1 === s2) return 1;
  const md = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const m1 = new Array(s1.length).fill(false), m2 = new Array(s2.length).fill(false);
  let m = 0;
  for (let i = 0; i < s1.length; i++) {
    const lo = Math.max(0, i - md), hi = Math.min(i + md + 1, s2.length);
    for (let j = lo; j < hi; j++) { if (!m2[j] && s1[i] === s2[j]) { m1[i] = m2[j] = true; m++; break; } }
  }
  if (!m) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < s1.length; i++) { if (m1[i]) { while (!m2[k]) k++; if (s1[i] !== s2[k]) t++; k++; } }
  t /= 2;
  const jaro = (m / s1.length + m / s2.length + (m - t) / m) / 3;
  let p = 0; while (p < 4 && s1[p] === s2[p]) p++;
  return jaro + p * 0.1 * (1 - jaro);
}
const normName = (s) => (s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

// Score a candidate pair. Returns {score, evidence, exclude}.
function score(a, b, blockSize) {
  const ev = [];
  // ---- hard exclusions ----
  if (a.birth && b.birth && Math.abs(a.birth - b.birth) > 7) return { exclude: 'birth-year Δ>7', score: -99 };
  const roleConf = (x, y) => (x === 'enslaver' && y === 'enslaved') || (x === 'enslaved' && y === 'enslaver');
  if (roleConf(a.person_type, b.person_type)) return { exclude: 'enslaver↔enslaved role conflict', score: -99 };
  for (const xa of a.extids) for (const xb of b.extids)
    if (xa.id_system === '1860_slave_schedule' && xb.id_system === '1860_slave_schedule' && xa.external_id !== xb.external_id)
      return { exclude: 'distinct rows in same 1860 census', score: -99 };

  let s = 0;
  // "corroborated" = at least one signal that is NOT a bare name/birth/state
  // coincidence. Required (with a small block) to enter review — defends against
  // the common-name floods (49 "Charlotte D'Hauterive", "Jean Baptiste" ...).
  let corroborated = false;
  const jw = jaroWinkler(a.canonical_name, b.canonical_name);
  // Kinship is RELATIONAL: a shared parent with DIFFERENT names => SIBLINGS.
  const ap = new Set(a.parents), bp = new Set(b.parents);
  const sharedParent = [...ap].some((p) => bp.has(p));
  if (sharedParent) {
    if (jw >= 0.85) { s += 6; corroborated = true; ev.push('shared parent + name match (+6)'); }
    else return { exclude: 'shared parent + different name → siblings', score: -99 };
  } else if (ap.size && bp.size) { s -= 8; ev.push('CONFLICTING parents (-8)'); }

  const sharedExt = a.extids.some((xa) => xa.id_system !== '1860_slave_schedule'
    && b.extids.some((xb) => xb.id_system === xa.id_system && xb.external_id === xa.external_id));
  if (sharedExt) { s += 10; corroborated = true; ev.push('shared external id (+10)'); }
  if (a.spouses.some((x) => b.spouses.includes(x))) { s += 4; corroborated = true; ev.push('shared spouse (+4)'); }
  if (normName(a.canonical_name) && normName(a.canonical_name) === normName(b.canonical_name)) { s += 3; ev.push('identical full name (+3)'); }
  if (a.birth && b.birth) { const d = Math.abs(a.birth - b.birth); if (d <= 1) { s += 3; ev.push('birth ≤1yr (+3)'); } else if (d <= 3) { s += 1; ev.push('birth ≤3yr (+1)'); } }
  if (a.death && b.death) { const d = Math.abs(a.death - b.death); if (d <= 1) { s += 2; corroborated = true; ev.push('death ≤1yr (+2)'); } }
  if (jw >= 0.97) { s += 1.5; ev.push(`name JW ${jw.toFixed(2)} (+1.5)`); } else if (jw >= 0.90) { s += 0.5; ev.push(`name JW ${jw.toFixed(2)} (+0.5)`); } else if (jw < 0.80) { s -= 3; ev.push(`name JW ${jw.toFixed(2)} (-3)`); }
  const sa = normalizeState(a.state), sb = normalizeState(b.state);
  if (sa && sb) { if (sa === sb) { s += 1; ev.push(`same state ${sa} (+1)`); } else { s -= 3; ev.push(`diff state ${sa}/${sb} (-3)`); } }
  // name-commonness over-merge defense (research: the single strongest control).
  // Big blocks = common name -> a bare name+state coincidence must NOT reach review.
  if (blockSize > 200) { s -= 3; ev.push(`common-name block ${blockSize} (-3)`); }
  else if (blockSize > 100) { s -= 2; ev.push(`common-name block ${blockSize} (-2)`); }
  else if (blockSize > 50) { s -= 1; ev.push(`common-name block ${blockSize} (-1)`); }

  return { score: Math.round(s * 10) / 10, evidence: ev, exclude: null, corroborated };
}

// Soft-only pairs (name+birth+state, no relational corroborator) are only
// trustworthy when the name is rare (small block). In big common-name blocks
// they are deferred to the relational cross-source pass, not the review queue.
const SOFT_BLOCK_MAX = parseInt(argVal('--soft-block-max', '25'), 10);
function routeOf(r, blockSize = 0) {
  if (r.exclude) return 'excluded';
  let route = r.score >= AUTO_MIN ? 'auto_merge_candidate' : r.score >= REVIEW_MIN ? 'review' : null;
  if (route && !r.corroborated && blockSize > SOFT_BLOCK_MAX) return null; // defer common-name coincidence
  return route;
}

// ---- attribute loading for small ad-hoc blocks (--validate / --name) ----
async function loadPeople(where, params = []) {
  const r = await pool.query(`
    SELECT cp.id, cp.canonical_name, cp.first_name, cp.birth_year_estimate birth,
           cp.death_year_estimate death, cp.person_type, cp.primary_state state
    FROM canonical_persons cp WHERE cp.person_type <> 'merged' AND (${where}) ORDER BY cp.id`, params);
  const people = r.rows;
  const ids = people.map((p) => p.id);
  if (!ids.length) return people;
  const ext = (await pool.query(`SELECT canonical_person_id cid, id_system, external_id FROM person_external_ids WHERE canonical_person_id = ANY($1)`, [ids])).rows;
  const par = (await pool.query(`SELECT person_b_id child, person_a_id parent FROM canonical_family_edges WHERE relationship_type='parent_of' AND person_b_id = ANY($1)`, [ids])).rows;
  const spo = (await pool.query(`SELECT person_a_id a, person_b_id b FROM canonical_family_edges WHERE relationship_type='spouse' AND (person_a_id = ANY($1) OR person_b_id = ANY($1))`, [ids])).rows;
  for (const p of people) {
    p.extids = ext.filter((e) => e.cid === p.id);
    p.parents = par.filter((e) => e.child === p.id).map((e) => e.parent);
    p.spouses = spo.filter((e) => e.a === p.id || e.b === p.id).map((e) => (e.a === p.id ? e.b : e.a));
  }
  return people;
}

function scoreBlock(people) {
  const out = [];
  for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
    const r = score(people[i], people[j], people.length);
    if (r.exclude || r.score >= REVIEW_MIN) out.push({ a: people[i], b: people[j], ...r });
  }
  return out;
}

// ---- full-population pass ----
async function runAll() {
  console.log(`--all: cap=${CAP} review≥${REVIEW_MIN} auto≥${AUTO_MIN} apply=${APPLY}`);
  // 1) bulk-load attributes for every person that has a surname blocking key
  console.log('loading person attributes + relational data ...');
  const people = new Map();
  {
    const r = await pool.query(`
      SELECT cp.id, cp.canonical_name, lower(left(regexp_replace(coalesce(cp.first_name,''),'[^A-Za-z]','','g'),1)) fi,
             cp.birth_year_estimate birth, cp.death_year_estimate death, cp.person_type, cp.primary_state state
      FROM canonical_persons cp
      WHERE cp.person_type <> 'merged'
        AND EXISTS (SELECT 1 FROM person_blocking_keys k WHERE k.canonical_person_id = cp.id)`);
    for (const p of r.rows) { p.extids = []; p.parents = []; p.spouses = []; people.set(p.id, p); }
  }
  console.log(`  ${people.size} people with surname keys`);
  for (const e of (await pool.query(`SELECT canonical_person_id cid, id_system, external_id FROM person_external_ids`)).rows) {
    const p = people.get(e.cid); if (p) p.extids.push({ id_system: e.id_system, external_id: e.external_id });
  }
  for (const e of (await pool.query(`SELECT person_b_id child, person_a_id parent FROM canonical_family_edges WHERE relationship_type='parent_of'`)).rows) {
    const p = people.get(e.child); if (p) p.parents.push(e.parent);
  }
  for (const e of (await pool.query(`SELECT person_a_id a, person_b_id b FROM canonical_family_edges WHERE relationship_type='spouse'`)).rows) {
    const pa = people.get(e.a); if (pa) pa.spouses.push(e.b);
    const pb = people.get(e.b); if (pb) pb.spouses.push(e.a);
  }

  // 2) build blocks: (key_value + first-initial) -> [ids], for sn and s4 keys
  console.log('building blocks ...');
  const blocks = new Map();
  const kr = await pool.query(`SELECT canonical_person_id pid, key_type kt, key_value kv FROM person_blocking_keys WHERE key_type IN ('sn','s4')`);
  for (const row of kr.rows) {
    const p = people.get(row.pid); if (!p || !p.fi) continue;
    const bk = row.kv + '|' + p.fi;
    let arr = blocks.get(bk); if (!arr) { arr = []; blocks.set(bk, arr); }
    arr.push(row.pid);
  }

  // 3) score intra-block pairs, dedupe, route
  console.log(`scoring ${blocks.size} blocks ...`);
  const results = new Map(); // "a|b" -> {a,b,score,route,evidence,blockKeys}
  let deferred = 0, deferredPeople = 0, compared = 0;
  for (const [bk, ids] of blocks) {
    if (ids.length < 2) continue;
    if (ids.length > CAP) { deferred++; deferredPeople += ids.length; continue; }
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a0 = people.get(ids[i]), b0 = people.get(ids[j]);
      const [a, b] = a0.id < b0.id ? [a0, b0] : [b0, a0];
      const pk = a.id + '|' + b.id;
      if (results.has(pk)) { results.get(pk).blockKeys.add(bk); continue; }
      compared++;
      const r = score(a, b, ids.length);
      const route = routeOf(r, ids.length);
      if (route === 'auto_merge_candidate' || route === 'review') {
        results.set(pk, { a, b, score: r.score, route, evidence: r.evidence || [], blockKeys: new Set([bk]) });
      }
    }
  }
  console.log(`  compared ${compared} unique pairs; kept ${results.size}; deferred ${deferred} mega-blocks (${deferredPeople} people > cap ${CAP})`);

  // 4) write
  const byRoute = {};
  for (const v of results.values()) byRoute[v.route] = (byRoute[v.route] || 0) + 1;
  console.log('  routes:', byRoute);
  if (!APPLY) { console.log('  (dry-run; pass --apply to write dedup_candidate_pairs). Sample:');
    [...results.values()].sort((x, y) => y.score - x.score).slice(0, 15).forEach((v) =>
      console.log(`   [${v.route}] ${v.score}  ${v.a.id} "${v.a.canonical_name}" ⟷ ${v.b.id} "${v.b.canonical_name}" | ${v.evidence.join('; ')}`));
    await pool.end(); return;
  }
  console.log('writing to dedup_candidate_pairs ...');
  // idempotent: clear prior UNREVIEWED candidates so tightened scoring can drop
  // pairs that no longer qualify; never touch human-reviewed rows.
  const del = await pool.query(`DELETE FROM dedup_candidate_pairs WHERE status='pending'`);
  console.log(`  cleared ${del.rowCount} prior pending pairs`);
  const vals = [...results.values()];
  let written = 0;
  const COLS = 8;
  for (let i = 0; i < vals.length; i += 500) {
    const chunk = vals.slice(i, i + 500);
    const tuples = [], params = [];
    chunk.forEach((v, idx) => {
      const o = idx * COLS;
      tuples.push(`($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5}::jsonb,$${o + 6}::text[],$${o + 7},$${o + 8})`);
      params.push(v.a.id, v.b.id, v.score, v.route, JSON.stringify(v.evidence), [...v.blockKeys], v.a.canonical_name, v.b.canonical_name);
    });
    await pool.query(`
      INSERT INTO dedup_candidate_pairs (person_a_id, person_b_id, score, route, evidence, blocking_keys, a_name, b_name)
      VALUES ${tuples.join(',')}
      ON CONFLICT (person_a_id, person_b_id) DO UPDATE SET
        score=EXCLUDED.score, route=EXCLUDED.route, evidence=EXCLUDED.evidence,
        blocking_keys=EXCLUDED.blocking_keys, a_name=EXCLUDED.a_name, b_name=EXCLUDED.b_name
      WHERE dedup_candidate_pairs.status='pending'`, params);
    written += chunk.length;
  }
  console.log(`  wrote ${written} candidate pairs.`);
  await pool.end();
}

(async () => {
  if (process.argv.includes('--validate')) {
    const ppl = await loadPeople(`cp.canonical_name ~* '(bi|bri)scoe' OR cp.id IN (140344,141015)`);
    const byId = Object.fromEntries(ppl.map((p) => [p.id, p]));
    const checks = [
      [141015, 140344, 'matriarch(b1799) vs Annie Maria(b1844) → MUST separate'],
      [196010, 196013, 'Ann Biscoe(Bennett) vs Ann Briscoe(Edward) → MUST separate (conflicting parents)'],
    ];
    console.log('=== BISCOE VALIDATION ===');
    for (const [x, y, label] of checks) {
      if (!byId[x] || !byId[y]) { console.log(`  [skip ${x}/${y}] not loaded`); continue; }
      const r = score(byId[x], byId[y], 10);
      const verdict = r.exclude ? `EXCLUDED (${r.exclude})` : r.score >= AUTO_MIN ? 'AUTO-MERGE' : r.score >= REVIEW_MIN ? 'REVIEW' : 'SEPARATE';
      console.log(`  ${label}\n     → ${verdict} | score ${r.score} | ${(r.evidence || []).join(', ')}`);
    }
    await pool.end(); return;
  }
  const ni = process.argv.indexOf('--name');
  const mi = process.argv.indexOf('--metaphone');
  if (ni > -1 || mi > -1) {
    const people = ni > -1 ? await loadPeople(`cp.canonical_name ILIKE '%'||$1||'%'`, [process.argv[ni + 1]])
      : await loadPeople(`cp.last_name_metaphone = $1`, [process.argv[mi + 1]]);
    console.log(`block: ${people.length} people`);
    const cands = scoreBlock(people).sort((a, b) => b.score - a.score);
    console.log(`candidate pairs (score≥${REVIEW_MIN} or excluded): ${cands.length}`);
    console.table(cands.slice(0, 25).map((c) => ({ a: c.a.id, an: c.a.canonical_name.slice(0, 20), b: c.b.id, bn: c.b.canonical_name.slice(0, 20), score: c.exclude ? 'EXCL' : c.score, route: c.exclude ? c.exclude.slice(0, 20) : routeOf(c) })));
    await pool.end(); return;
  }
  if (process.argv.includes('--all')) { await runAll(); return; }
  console.log('use --validate, --name <substr>, --metaphone <code>, or --all [--apply]');
  await pool.end();
})();
