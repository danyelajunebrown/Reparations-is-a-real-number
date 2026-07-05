#!/usr/bin/env node
/**
 * audit-lineages.mjs
 *
 * Deterministic audit of the climbed lineage tree against the project's
 * genealogical-production standards. The climb scrapes FamilySearch's raw
 * collaborative tree, which bypasses identity resolution, evidence gating, and
 * the assertion gate — so the deep (pre-1800) tail is speculative. This grades
 * every connected ancestor and every apical→Adrian line on objective signals:
 *
 *   Per EDGE (parent→child): generation gap. Impossible if child born before
 *     parent, or gap <13 (parent a child) or >65 (parent post-menopausal/dead).
 *   Per NODE: era bucket; name quality (single-token / "Mrs X" / unresolved / null);
 *     >2 parents (impossible); duplicate identity (same name+birth-year reused).
 *   Per NODE: evidence status — in the VERIFIED layer (enslaver_evidence_compendium
 *     direct_primary) vs FamilySearch-only (everything else).
 *   Per LINE: depth, oldest birth year, count of impossible gaps / weak nodes,
 *     and a confidence grade SOLID / MODERATE / SPECULATIVE.
 *
 * Writes worksheets/lineage-audit.json (per-node + per-line flags, consumed by
 * the worksheet generator) and prints a summary. No model judgment — pure code.
 */
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { writeFileSync } from 'fs';

const sql = neon(process.env.DATABASE_URL);
const SID = process.env.SID || 'f4a5b049-30dc-437f-8d55-fe5d68d42115';
const ADRIAN = 'P4RF-PFQ';

const main = async () => {
  const vs = await sql`SELECT visited_set v FROM ancestor_climb_sessions WHERE id=${SID}::uuid`;
  const visited = new Set((vs[0].v || []).filter(Boolean));

  const rows = await sql`
    SELECT pei.external_id fs, cp.id cid, cp.canonical_name n, cp.birth_year_estimate by, cp.death_year_estimate dy, cp.primary_state st
    FROM person_external_ids pei JOIN canonical_persons cp ON cp.id=pei.canonical_person_id
    WHERE pei.id_system='familysearch'`;
  const det = new Map(), cidOf = new Map();
  for (const r of rows) if (!det.has(r.fs)) { det.set(r.fs, r); cidOf.set(r.fs, r.cid); }

  const edges = await sql`SELECT child_fs_id c, parent_fs_id p FROM inferred_parent_links WHERE session_id=${SID}::uuid AND discovery_method='details-parent-scrape'`;
  const parentsOf = new Map(), childrenOf = new Map();
  for (const e of edges) { if (!e.c || !e.p) continue;
    (parentsOf.get(e.c) || parentsOf.set(e.c, new Set()).get(e.c)).add(e.p);
    (childrenOf.get(e.p) || childrenOf.set(e.p, new Set()).get(e.p)).add(e.c); }

  // verified confirmations (direct_primary)
  const cids = [...new Set([...cidOf.values()])];
  const conf = new Set();
  const comp = await sql`SELECT DISTINCT canonical_person_id cid FROM enslaver_evidence_compendium WHERE evidence_strength='direct_primary'`;
  const confCid = new Set(comp.map(r => r.cid));
  for (const [fs, cid] of cidOf) if (confCid.has(cid)) conf.add(fs);

  // connected pedigree (up from Adrian)
  const connected = new Set([ADRIAN]); { const stk = [ADRIAN];
    while (stk.length) { const x = stk.pop(); for (const p of (parentsOf.get(x) || [])) if (det.has(p) && !connected.has(p)) { connected.add(p); stk.push(p); } } }
  connected.delete(ADRIAN);

  const nameWeak = (n) => !n || n.trim().split(/\s+/).length < 2 || /^\(?unresolved|^mrs?\.?\b|^miss\b|unknown|\[/i.test(n.trim());

  // ---- per-node flags ----
  const node = {};
  const dupKey = new Map();
  for (const fs of connected) {
    const d = det.get(fs) || {};
    const f = { fs, name: d.n, by: d.by, dy: d.dy, conf: conf.has(fs),
      weakName: nameWeak(d.n), multiParent: (parentsOf.get(fs)?.size || 0) > 2, badGap: [] };
    node[fs] = f;
    if (d.n && d.by) { const k = (d.n.toLowerCase().trim()) + '|' + d.by; dupKey.set(k, (dupKey.get(k) || 0) + 1); }
  }
  // generation-gap audit per edge (child d, parent p)
  let edgeChecked = 0, edgeBad = 0;
  for (const c of connected) {
    const cd = det.get(c); if (!cd?.by) continue;
    for (const p of (parentsOf.get(c) || [])) {
      const pd = det.get(p); if (!pd?.by) continue;
      edgeChecked++;
      const gap = cd.by - pd.by;            // child birth - parent birth
      let why = null;
      if (gap <= 0) why = `child b.${cd.by} ≤ parent b.${pd.by}`;
      else if (gap < 13) why = `gap ${gap}y (parent too young)`;
      else if (gap > 65) why = `gap ${gap}y (parent too old)`;
      if (why) { edgeBad++; if (node[c]) node[c].badGap.push({ parent: pd.n, why }); }
    }
  }
  // mark duplicate-identity nodes
  for (const fs of connected) { const d = det.get(fs); if (d?.n && d?.by) { const k = d.n.toLowerCase().trim() + '|' + d.by; node[fs].dupIdentity = (dupKey.get(k) || 0) > 1; } }

  // ---- per-line grade (rebuild apical→Adrian chains, same logic as the worksheet) ----
  const inLineChildren = (fs) => [...(childrenOf.get(fs) || [])].filter(k => k === ADRIAN || connected.has(k));
  const apicals = [...connected].filter(fs => ![...(parentsOf.get(fs) || [])].some(p => connected.has(p)));
  const lines = [];
  for (const apex of apicals) {
    // longest chain down to Adrian
    const chain = []; let cur = apex, hops = 0; const seen = new Set();
    while (cur && hops++ < 30 && !seen.has(cur)) { seen.add(cur); chain.push(cur);
      if (inLineChildren(cur).includes(ADRIAN)) break;
      const nxt = inLineChildren(cur).filter(k => k !== ADRIAN && !seen.has(k)).sort((a,b)=>( (det.get(b)?.by||0)-(det.get(a)?.by||0)))[0];
      cur = nxt; }
    const ns = chain.map(fs => node[fs]).filter(Boolean);
    const oldest = Math.min(...ns.map(n => n.by || 9999));
    const badGaps = ns.reduce((a, n) => a + (n.badGap?.length ? 1 : 0), 0);
    const weak = ns.filter(n => n.weakName).length;
    const hasConf = ns.some(n => n.conf);
    // grade
    let grade = 'SOLID';
    if (oldest < 1700 || badGaps >= 2 || weak >= Math.ceil(ns.length/2)) grade = 'SPECULATIVE';
    else if (oldest < 1780 || badGaps >= 1 || weak >= 2) grade = 'MODERATE';
    lines.push({ apex, depth: ns.length, oldest: oldest === 9999 ? null : oldest, badGaps, weak, hasConf, grade });
  }

  // ---- summary ----
  const g = (gr) => lines.filter(l => l.grade === gr).length;
  const eraBucket = (y) => !y ? 'undated' : y >= 1800 ? '≥1800' : y >= 1700 ? '1700s' : y >= 1600 ? '1600s' : y >= 1500 ? '1500s' : '<1500';
  const eras = {}; for (const fs of connected) { const b = eraBucket(det.get(fs)?.by); eras[b] = (eras[b]||0)+1; }
  const weakNames = Object.values(node).filter(n => n.weakName).length;
  const multiP = Object.values(node).filter(n => n.multiParent).length;
  const dupId = Object.values(node).filter(n => n.dupIdentity).length;
  const badGapNodes = Object.values(node).filter(n => n.badGap?.length).length;

  console.log('=== LINEAGE AUDIT ===');
  console.log(`connected ancestors: ${connected.size}`);
  console.log(`verified confirmations (direct_primary): ${[...conf].filter(f=>connected.has(f)).length}`);
  console.log(`\nera of birth (connected):`); for (const k of ['≥1800','1700s','1600s','1500s','<1500','undated']) console.log(`  ${k.padEnd(7)} ${eras[k]||0}`);
  console.log(`\ngeneration-gap edges checked: ${edgeChecked}, IMPOSSIBLE: ${edgeBad} (${(edgeBad/edgeChecked*100).toFixed(1)}%)`);
  console.log(`nodes with impossible parent gap: ${badGapNodes}`);
  console.log(`nodes with >2 parents (impossible): ${multiP}`);
  console.log(`nodes with weak/partial name: ${weakNames}`);
  console.log(`nodes that are duplicate-identity suspects (same name+year): ${dupId}`);
  console.log(`\nLINES by confidence grade (of ${lines.length}):`);
  console.log(`  SOLID:       ${g('SOLID')}   (shallow, post-1780, no gaps)`);
  console.log(`  MODERATE:    ${g('MODERATE')}`);
  console.log(`  SPECULATIVE: ${g('SPECULATIVE')}   (pre-1700 or multiple gaps/weak names)`);
  console.log(`  lines containing a verified confirmation: ${lines.filter(l=>l.hasConf).length}`);

  writeFileSync('worksheets/lineage-audit.json', JSON.stringify({
    generatedFor: SID,
    node: Object.fromEntries(Object.entries(node).map(([fs, n]) => [fs, {
      conf: n.conf, weakName: n.weakName, multiParent: n.multiParent,
      dupIdentity: !!n.dupIdentity, badGap: n.badGap }])),
    lineGradeByApex: Object.fromEntries(lines.map(l => [l.apex, l.grade])),
    summary: { connected: connected.size, edgeChecked, edgeBad, badGapNodes, multiP, weakNames, dupId,
      grades: { SOLID: g('SOLID'), MODERATE: g('MODERATE'), SPECULATIVE: g('SPECULATIVE') }, eras }
  }, null, 2));
  console.log('\n→ worksheets/lineage-audit.json written');
};
main().catch(e => { console.error('FATAL', e); process.exit(1); });
