#!/usr/bin/env node
/**
 * Cross-source enslaver resolver (phase A of the unconfirmed_persons pass).
 * Match the ~24K UNLINKED enslaver unconfirmed_persons (confirmed_individual_id
 * NULL) to existing canonical_persons enslavers, and write link candidates to
 * cross_source_candidates (migration 092) for human review.
 *
 * Enslaver leads carry almost no birth/death — scoring is name + LOCATION
 * (state/county from the locations array) only. Blocking reuses the canonical
 * person_blocking_keys (sn surname + first-initial). Multi-match -> all to
 * review, never auto-link (IPUMS: never pick a single best match).
 *
 *   node scripts/resolve-cross-source-enslavers.mjs            # dry-run
 *   node scripts/resolve-cross-source-enslavers.mjs --apply
 */
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv'; import pg from 'pg';
import { deriveSurnames, normalizeState } from './lib/name-normalize.mjs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const APPLY = process.argv.includes('--apply');
const REVIEW_MIN = 4, AUTO_MIN = 6;

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const firstInitial = (name) => { const m = norm(name).match(/[a-z]+/); return m ? m[0][0] : ''; };
function jaroWinkler(s1, s2) {
  s1 = (s1 || '').toLowerCase(); s2 = (s2 || '').toLowerCase();
  if (!s1 || !s2) return 0; if (s1 === s2) return 1;
  const md = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const m1 = new Array(s1.length).fill(false), m2 = new Array(s2.length).fill(false);
  let m = 0;
  for (let i = 0; i < s1.length; i++) { const lo = Math.max(0, i - md), hi = Math.min(i + md + 1, s2.length); for (let j = lo; j < hi; j++) { if (!m2[j] && s1[i] === s2[j]) { m1[i] = m2[j] = true; m++; break; } } }
  if (!m) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < s1.length; i++) { if (m1[i]) { while (!m2[k]) k++; if (s1[i] !== s2[k]) t++; k++; } }
  t /= 2;
  const jaro = (m / s1.length + m / s2.length + (m - t) / m) / 3;
  let p = 0; while (p < 4 && s1[p] === s2[p]) p++;
  return jaro + p * 0.1 * (1 - jaro);
}

// parse locations JSONB array (["Williamson, Tennessee"]) -> {state, county}
function parseLoc(locations) {
  let arr = locations;
  if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch { arr = [arr]; } }
  if (!Array.isArray(arr) || !arr.length) return { state: null, county: null };
  const parts = String(arr[0]).split(',').map((s) => s.trim());
  return { state: normalizeState(parts[parts.length - 1]), county: (parts.length > 1 ? parts[0] : '').toLowerCase() || null };
}

function score(lead, cand, blockSize) {
  const ev = [];
  let s = 0;
  const jw = jaroWinkler(lead.name, cand.name);
  if (norm(lead.name) === norm(cand.name)) { s += 3; ev.push('identical name (+3)'); }
  if (jw >= 0.97) { s += 1.5; ev.push(`JW ${jw.toFixed(2)} (+1.5)`); } else if (jw >= 0.90) { s += 0.5; ev.push(`JW ${jw.toFixed(2)} (+0.5)`); } else if (jw < 0.85) { s -= 2; ev.push(`JW ${jw.toFixed(2)} (-2)`); }
  if (lead.state && cand.state) { if (lead.state === cand.state) { s += 2; ev.push(`same state ${lead.state} (+2)`); } else { s -= 3; ev.push(`diff state ${lead.state}/${cand.state} (-3)`); } }
  if (lead.county && cand.county && lead.county === cand.county) { s += 1; ev.push(`same county (+1)`); }
  if (blockSize > 50) { s -= 2; ev.push(`common-name block ${blockSize} (-2)`); } else if (blockSize > 20) { s -= 1; ev.push(`common-name block ${blockSize} (-1)`); }
  return { score: Math.round(s * 10) / 10, evidence: ev };
}

(async () => {
  console.log(`cross-source enslavers: review≥${REVIEW_MIN} auto≥${AUTO_MIN} apply=${APPLY}`);
  // 1) canonical enslaver blocks: (sn surname + first-initial) -> [candidates]
  console.log('loading canonical enslaver blocks ...');
  const blocks = new Map();
  const cr = await pool.query(`
    SELECT k.surname, cp.id, cp.canonical_name name, cp.primary_state state, lower(cp.primary_county) county,
           lower(left(regexp_replace(coalesce(cp.first_name,''),'[^A-Za-z]','','g'),1)) fi
    FROM person_blocking_keys k JOIN canonical_persons cp ON cp.id = k.canonical_person_id
    WHERE k.key_type = 'sn' AND cp.person_type = 'enslaver'`);
  for (const c of cr.rows) {
    c.state = normalizeState(c.state);
    const bk = c.surname + '|' + (c.fi || '');
    let arr = blocks.get(bk); if (!arr) { arr = []; blocks.set(bk, arr); }
    arr.push(c);
  }
  console.log(`  ${cr.rows.length} canonical enslaver keys in ${blocks.size} blocks`);

  // 2) unlinked enslaver leads
  const leads = (await pool.query(`
    SELECT lead_id, full_name, locations FROM unconfirmed_persons
    WHERE person_type IN ('enslaver','slaveholder','owner','suspected_owner') AND confirmed_individual_id IS NULL
      AND status = 'pending' AND full_name ~ '\\S+ \\S+'`)).rows;
  console.log(`  ${leads.length} unlinked enslaver leads`);

  // 3) match
  const out = []; let matchedLeads = 0, multi = 0;
  for (const lead of leads) {
    const surs = deriveSurnames(lead.full_name, null);
    if (!surs.length) continue;
    const fi = firstInitial(lead.full_name);
    const loc = parseLoc(lead.locations);
    lead.name = lead.full_name; lead.state = loc.state; lead.county = loc.county;
    const seen = new Map(); // canonId -> best result
    for (const sur of surs) {
      const cands = blocks.get(sur + '|' + fi); if (!cands) continue;
      for (const cand of cands) {
        cand.county = cand.county || null;
        const r = score(lead, cand, cands.length);
        if (r.score < REVIEW_MIN) continue;
        const prev = seen.get(cand.id);
        if (!prev || r.score > prev.score) seen.set(cand.id, { cand, ...r, bk: sur + '|' + fi });
      }
    }
    if (!seen.size) continue;
    matchedLeads++;
    const hits = [...seen.values()].sort((a, b) => b.score - a.score);
    const multiMatch = hits.length > 1;
    if (multiMatch) multi++;
    for (const h of hits) {
      // multi-match -> force review even if individually high (IPUMS: no single best)
      const route = (!multiMatch && h.score >= AUTO_MIN) ? 'auto_link_candidate' : 'review';
      out.push({ lead, ...h, route, loc });
    }
  }
  const byRoute = {}; for (const o of out) byRoute[o.route] = (byRoute[o.route] || 0) + 1;
  console.log(`  matched ${matchedLeads} leads (${multi} multi-match) -> ${out.length} candidate links`, byRoute);

  if (!APPLY) {
    console.log('  dry-run sample:');
    out.sort((a, b) => b.score - a.score).slice(0, 15).forEach((o) =>
      console.log(`   [${o.route}] ${o.score}  lead ${o.lead.lead_id} "${o.lead.full_name}" (${o.lead.state || '?'}/${o.lead.county || '?'}) -> cp=${o.cand.id} "${o.cand.name}" | ${o.evidence.join('; ')}`));
    await pool.end(); return;
  }
  await pool.query(`DELETE FROM cross_source_candidates WHERE entity_kind='enslaver' AND status='pending'`);
  let written = 0;
  for (let i = 0; i < out.length; i += 500) {
    const chunk = out.slice(i, i + 500);
    const tuples = [], params = []; const C = 9;
    chunk.forEach((o, idx) => {
      const b = idx * C;
      tuples.push(`($${b + 1},$${b + 2},'enslaver',$${b + 3},$${b + 4},$${b + 5}::jsonb,$${b + 6}::text[],$${b + 7},$${b + 8},$${b + 9})`);
      params.push(o.cand.id, o.lead.lead_id, o.score, o.route, JSON.stringify(o.evidence), [o.bk],
        o.cand.name, o.lead.full_name, [o.lead.state, o.lead.county].filter(Boolean).join(' / '));
    });
    await pool.query(`
      INSERT INTO cross_source_candidates (canonical_person_id, unconfirmed_lead_id, entity_kind, score, route, evidence, blocking_keys, canonical_name, unconfirmed_name, location)
      VALUES ${tuples.join(',')}
      ON CONFLICT (canonical_person_id, lead_table, unconfirmed_lead_id) DO UPDATE SET
        score=EXCLUDED.score, route=EXCLUDED.route, evidence=EXCLUDED.evidence, location=EXCLUDED.location
      WHERE cross_source_candidates.status='pending'`, params);
      // NB: ON CONFLICT target updated for M101 (cross_source_candidates went polymorphic — unique is
      // now (canonical_person_id, lead_table, unconfirmed_lead_id); lead_table defaults to
      // 'unconfirmed_persons'). The old 2-col target no longer matched an arbiter index.
    written += chunk.length;
  }
  console.log(`  wrote ${written} cross-source candidate links.`);

  // Auto-apply the unambiguous tier so humans never have to hand-click obvious matches: an
  // 'auto_link_candidate' is a SINGLE-match with exact/near name + same state + same county (name-only
  // and multi-match were routed to 'review', which is left untouched for humans). Same op as the Link
  // endpoint. Reversible (clear confirmed_individual_id). See scripts/bulk-link-auto-enslaver-candidates.mjs.
  const autoLinked = (await pool.query(`
    UPDATE unconfirmed_persons u
       SET confirmed_individual_id = x.canonical_person_id::text, status='confirmed',
           reviewed_by='cross_source_auto', reviewed_at=NOW(),
           review_notes = COALESCE(u.review_notes,'') || ' | auto-linked to cp=' || x.canonical_person_id || ' (auto_link_candidate)'
      FROM cross_source_candidates x
      WHERE x.entity_kind='enslaver' AND x.route='auto_link_candidate' AND x.status='pending'
        AND u.lead_id = x.unconfirmed_lead_id
      RETURNING u.lead_id`)).rowCount;
  await pool.query(`UPDATE cross_source_candidates SET status='linked', reviewed_by='cross_source_auto', reviewed_at=NOW()
                    WHERE entity_kind='enslaver' AND route='auto_link_candidate' AND status='pending'`);
  console.log(`  auto-linked ${autoLinked} unambiguous leads; the 'review' tier stays for humans.`);
  await pool.end();
})();
