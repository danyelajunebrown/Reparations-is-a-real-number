#!/usr/bin/env node
/**
 * generate-lineage-worksheet.mjs
 *
 * Renders the climbed ancestors GROUPED BY TOP (apical) ANCESTOR — each earliest-
 * known ancestor heads a section listing the descent line down to the participant
 * (Adrian). Built for tracing inheritances DOWN a line.
 *
 * Tree source: inferred_parent_links rows written by scrape-parents.js
 *   (discovery_method='details-parent-scrape') — child_fs_id -> parent_fs_id.
 * Names/years/places: canonical_persons via person_external_ids, with edge-name
 * fallback. Slaveholder flags: ancestor_climb_matches (keyed by name).
 *
 * Usage: node scripts/generate-lineage-worksheet.mjs [FS_ID] [--name "Label"]
 */
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import puppeteer from 'puppeteer';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

const sql = neon(process.env.DATABASE_URL);
const args = process.argv.slice(2);
const FS_ID = args.find(a => !a.startsWith('--')) || 'P4RF-PFQ';
const nameIdx = args.indexOf('--name');
const LABEL_OVERRIDE = nameIdx >= 0 ? args[nameIdx + 1] : null;
const ERA_END = 1865;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cleanPlace = (s) => { if (!s || typeof s !== 'string') return ''; const t = s.trim();
  if (t.length < 3 || t.length > 40) return ''; if (/\b(was|but|along|lived|married|born at)\b/i.test(t)) return ''; return t; };
const sideOf = (name) => {
  if (/\b(miller|lyman|biscoe|chew|hopewell|patterson|young|irvine|drennan|redifer)\b/i.test(name || '')) return 'MAT';
  if (/\b(brown|watson|knighten|larche|knighton)\b/i.test(name || '')) return 'PAT';
  return '';
};
const yrs = (b, d) => (b || d) ? `${b || '?'}–${d || '?'}` : '';

async function main() {
  const sessions = await sql`
    SELECT id, modern_person_name, modern_person_fs_id FROM ancestor_climb_sessions
    WHERE modern_person_fs_id = ${FS_ID} AND status='completed' ORDER BY ancestors_visited DESC NULLS LAST`;
  if (!sessions.length) throw new Error(`No completed climb session for ${FS_ID}`);
  const session = sessions[0];
  const label = LABEL_OVERRIDE || session.modern_person_name || FS_ID;

  const vsRow = await sql`SELECT visited_set v FROM ancestor_climb_sessions WHERE id=${session.id}::uuid`;
  const visited = (vsRow[0].v || []).filter(Boolean);
  const visitedSet = new Set(visited);

  // detail from canonical (also capture canonical id for evidence joins)
  const rows = await sql`
    SELECT pei.external_id fs, cp.id cid, cp.canonical_name name, cp.birth_year_estimate by, cp.death_year_estimate dy,
           cp.primary_state st, cp.primary_county co
    FROM person_external_ids pei JOIN canonical_persons cp ON cp.id=pei.canonical_person_id
    WHERE pei.id_system='familysearch' AND pei.external_id = ANY(${visited})`;
  const detail = new Map();
  const cidOf = new Map();   // fs -> canonical id
  const fsOfCid = new Map(); // canonical id -> fs
  for (const r of rows) { if (!r.fs || detail.has(r.fs)) continue;
    detail.set(r.fs, { name: r.name, by: r.by || null, dy: r.dy || null,
      place: [cleanPlace(r.co), cleanPlace(r.st)].filter(Boolean).join(', '), st: r.st, co: r.co });
    if (r.cid) { cidOf.set(r.fs, r.cid); if (!fsOfCid.has(r.cid)) fsOfCid.set(r.cid, r.fs); } }
  const cids = [...new Set([...cidOf.values()])];

  // ---- CONFIRMED slaveholder evidence (canonical-id-keyed = strong, already resolved) ----
  // person_documents_with_names: slave schedules, DC compensated-emancipation petitions, wills.
  // enslaver_evidence_compendium: vetted enslaver-evidence linkage with a claim summary.
  const evByFs = new Map(); // fs -> { confirmed:bool, tags:Set, notes:[] }
  const addEv = (fs, tag, note) => { if (!fs) return; if (!evByFs.has(fs)) evByFs.set(fs, { tags: new Set(), notes: [] });
    const e = evByFs.get(fs); if (tag) e.tags.add(tag); if (note) e.notes.push(note); };
  const SLAVE_DOCS = { census_slave_schedule: 'Slave schedule', compensated_emancipation_petition: 'DC petition', will: 'Will' };
  if (cids.length) {
    const docs = await sql`
      SELECT canonical_person_id cid, document_type dt, document_year dy, count(*)::int n
      FROM person_documents_with_names
      WHERE canonical_person_id = ANY(${cids}) AND document_type = ANY(${Object.keys(SLAVE_DOCS)})
      GROUP BY 1,2,3`;
    for (const d of docs) { const fs = fsOfCid.get(d.cid);
      addEv(fs, SLAVE_DOCS[d.dt], `${SLAVE_DOCS[d.dt]}${d.dy ? ' ' + d.dy : ''}`); }
    const comp = await sql`
      SELECT canonical_person_id cid, evidence_source_table est, max(claim_summary) cs
      FROM enslaver_evidence_compendium WHERE canonical_person_id = ANY(${cids}) GROUP BY 1,2`;
    for (const c of comp) { const fs = fsOfCid.get(c.cid);
      // skip the merely-genealogical linkages (tree_profile / external_id) — keep substantive ones
      if (/will_extraction|reparations_petition|debt_acknowledg|family_relationships|probate|slave/i.test(c.est))
        addEv(fs, 'Enslaver record', (c.cs || c.est).slice(0, 70)); }
  }
  const evOf = (fs) => { const e = evByFs.get(fs); if (!e || !e.tags.size) return null;
    return { confirmed: true, tags: [...e.tags], notes: [...new Set(e.notes)].slice(0, 4) }; };

  // parent edges
  const edges = await sql`
    SELECT child_fs_id c, child_name cn, parent_fs_id p, parent_name pn
    FROM inferred_parent_links
    WHERE session_id=${session.id}::uuid AND discovery_method='details-parent-scrape'`;
  const parentsOf = new Map();   // child -> Set(parent)
  const childrenOf = new Map();  // parent -> Set(child)
  const nameFb = new Map();      // fs -> name (edge fallback)
  for (const e of edges) {
    if (e.c && e.p) {
      if (!parentsOf.has(e.c)) parentsOf.set(e.c, new Set());
      parentsOf.get(e.c).add(e.p);
      if (!childrenOf.has(e.p)) childrenOf.set(e.p, new Set());
      childrenOf.get(e.p).add(e.c);
    }
    if (e.c && e.cn && !nameFb.has(e.c)) nameFb.set(e.c, e.cn);
    if (e.p && e.pn && !nameFb.has(e.p)) nameFb.set(e.p, e.pn);
  }
  const nameOf = (fs) => { const d = detail.get(fs); if (d && d.name) return d.name;
    const n = nameFb.get(fs); return (n && !/^living$/i.test(n)) ? n : null; };

  // match flags by terminal name
  const matches = await sql`
    SELECT slaveholder_name sn, classification cl, match_type mt, lineage_path lp
    FROM ancestor_climb_matches WHERE session_id=${session.id}::uuid ORDER BY generation_distance`;
  const flagByName = new Map();
  for (const m of matches) { const path = m.lineage_path || []; const t = path[path.length - 1];
    if (t && !flagByName.has(t)) flagByName.set(t, { slaveholder: m.sn, classification: m.cl, match_type: m.mt }); }

  // CONNECTED pedigree: only ancestors actually reachable UP from Adrian via the
  // scraped parent edges. This guarantees every line descends to Adrian; fragments
  // left by a missing edge go to the "lineage gap" appendix instead of faking a line.
  const known = new Set();
  { const stack = [FS_ID];
    while (stack.length) { const x = stack.pop();
      for (const p of (parentsOf.get(x) || [])) if (nameOf(p) && !known.has(p)) { known.add(p); stack.push(p); } } }
  known.delete(FS_ID);

  // orphans: named visited ancestors NOT connected to Adrian (parent link missing
  // somewhere between them and us) — listed honestly in an appendix.
  const orphanSet = [];
  for (const fs of visited) if (fs !== FS_ID && nameOf(fs) && !known.has(fs)) orphanSet.push(fs);

  // child-in-line within the connected graph (toward Adrian)
  const inLineChildren = (fs) => [...(childrenOf.get(fs) || [])].filter(c => c === FS_ID || known.has(c));
  // apicals: connected ancestors with NO connected parent (top of a line)
  const apicals = [...known].filter(fs => {
    const ps = [...(parentsOf.get(fs) || [])].filter(p => known.has(p));
    return ps.length === 0;
  });

  // Build descent chains apical -> ... -> Adrian. Each chain is an array of fs ids
  // (apical first, Adrian implicit at the end). Pedigree collapse can branch; we
  // enumerate paths but cap to avoid blowups.
  const node = (fs) => {
    const d = detail.get(fs) || {};
    const nm = nameOf(fs);
    return { fs, name: nm, by: d.by, dy: d.dy, place: d.place || '',
             flag: nm ? flagByName.get(nm) || null : null, side: sideOf(nm), ev: evOf(fs) };
  };
  const MAXDEPTH = 25;
  const chainsFor = (apex) => {
    const out = [];
    const walk = (fs, acc) => {
      acc = [...acc, fs];
      if (acc.length > MAXDEPTH) { out.push(acc); return; }
      const kids = inLineChildren(fs);
      const downstream = kids.filter(k => k !== FS_ID && !acc.includes(k));
      if (kids.includes(FS_ID) || downstream.length === 0) { out.push(acc); return; }
      for (const k of downstream) walk(k, acc);
    };
    walk(apex, []);
    return out;
  };

  // Choose, per apical, the single LONGEST chain (deepest line to Adrian) as the
  // headline; note if there were extra branches.
  const lines = [];
  for (const apex of apicals) {
    const chains = chainsFor(apex);
    chains.sort((a, b) => b.length - a.length);
    const chain = chains[0];
    const nodes = chain.map(node);
    const apexNode = nodes[0];
    lines.push({ apex, apexNode, nodes, branches: chains.length - 1,
      slaveEra: apexNode.by ? apexNode.by <= ERA_END : false,
      hasConfirmed: nodes.some(n => n.ev), confirmedCount: nodes.filter(n => n.ev).length,
      hasFlag: nodes.some(n => n.flag), depth: nodes.length });
  }
  // sort: CONFIRMED-slaveholder lines first, then climb-flagged, then oldest apical, then longest
  lines.sort((a, b) =>
    (b.hasConfirmed - a.hasConfirmed) || (b.hasFlag - a.hasFlag) ||
    ((a.apexNode.by || 9999) - (b.apexNode.by || 9999)) || (b.depth - a.depth));

  // ---- stats ----
  // orphan appendix nodes (named ancestors not yet connected to a line)
  const orphanNodes = orphanSet.map(node).sort((a, b) =>
    ((b.ev ? 1 : 0) - (a.ev ? 1 : 0)) || ((a.by || 9999) - (b.by || 9999)));
  const confirmedOrphans = orphanNodes.filter(n => n.ev).length;

  const namedCount = [...known].length;
  const withParentEdge = [...known].filter(fs => (parentsOf.get(fs) || new Set()).size).length;
  const flaggedLines = lines.filter(l => l.hasFlag).length;
  const confirmedPeople = [...known].filter(fs => evOf(fs)).length + confirmedOrphans;
  const confirmedLines = lines.filter(l => l.hasConfirmed).length;

  // ---- HTML ----
  const rowHtml = (n, depth) => {
    const indent = depth * 22;
    // CONFIRMED slaveholder evidence (canonical-keyed) is the prominent marker.
    const ev = n.ev ? `<span class="ev" title="${esc(n.ev.notes.join(' · '))}">⚖ ${esc(n.ev.tags.join(' · '))}</span>` : '';
    // climb's weak guess only as a faint "verify" hint when there is no confirmed evidence
    const flag = (!n.ev && n.flag) ? `<span class="flag" title="${esc(n.flag.slaveholder)} — ${esc(n.flag.classification || '')}">⚑ verify</span>` : '';
    const sideCls = n.side === 'MAT' ? 'mat' : n.side === 'PAT' ? 'pat' : '';
    return `<div class="prow ${sideCls} ${n.ev ? 'confirmed' : ''}" style="margin-left:${indent}px">
      <span class="conn">${depth ? '└─' : '◆'}</span>
      <span class="nm">${esc(n.name || '(unnamed)')}</span>
      <span class="yr">${esc(yrs(n.by, n.dy))}</span>
      ${n.place ? `<span class="pl">${esc(n.place)}</span>` : '<span class="pl none">—</span>'}
      <span class="id">${esc(n.fs)}</span>
      ${ev}${flag}
    </div>`;
  };
  const lineHtml = (l, i) => {
    const a = l.apexNode;
    return `<section class="line ${l.hasFlag ? 'flagged' : ''}">
      <h2>LINE ${i + 1} · ${esc(a.name || '(unnamed)')} <span class="apexmeta">${esc(yrs(a.by, a.dy))}${a.place ? ' · ' + esc(a.place) : ''}</span></h2>
      ${l.branches ? `<div class="note">+${l.branches} alternate descent branch(es) collapse into this line</div>` : ''}
      ${l.nodes.map((n, d) => rowHtml(n, d)).join('')}
      <div class="prow tail" style="margin-left:${l.nodes.length * 22}px"><span class="conn">└─</span><span class="nm you">${esc(label)} (you)</span></div>
    </section>`;
  };

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(label)} — Lineage Worksheet</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; color:#1a1a1a; margin:0; padding:28px 34px; font-size:12px; }
    h1 { font-size:22px; margin:0 0 2px; }
    .sub { color:#555; font-size:12px; margin-bottom:14px; }
    .stats { display:flex; gap:18px; flex-wrap:wrap; background:#f5f3ee; border:1px solid #e0dccf; border-radius:8px; padding:10px 14px; margin-bottom:16px; }
    .stats b { font-size:17px; display:block; }
    .stats span { color:#555; font-size:11px; }
    .intro { background:#fbfaf6; border-left:3px solid #8a7; padding:9px 13px; margin-bottom:18px; font-size:11.5px; line-height:1.5; }
    section.line { border:1px solid #e3e0d6; border-radius:7px; padding:10px 12px 12px; margin-bottom:13px; break-inside:avoid; }
    section.line.flagged { border-color:#c98; background:#fdf7f2; }
    section.line h2 { font-size:14px; margin:0 0 7px; border-bottom:1px solid #eee; padding-bottom:5px; }
    .apexmeta { font-weight:normal; color:#777; font-size:11px; }
    .note { font-size:10.5px; color:#a55; margin-bottom:5px; font-style:italic; }
    .prow { display:flex; align-items:baseline; gap:8px; padding:2px 0; font-size:11.5px; }
    .prow .conn { color:#bbb; font-family:monospace; }
    .prow .nm { font-weight:600; min-width:160px; }
    .prow.pat .nm { color:#1d4d2b; } .prow.mat .nm { color:#5a2d6e; }
    .prow .yr { color:#666; font-variant-numeric:tabular-nums; min-width:74px; }
    .prow .pl { color:#234; } .prow .pl.none { color:#bbb; }
    .prow .id { color:#999; font-family:monospace; font-size:10px; }
    .prow .flag { color:#b08; font-weight:500; font-size:10px; opacity:.6; }
    .prow .ev { color:#7a1f12; font-weight:700; font-size:10.5px; background:#f3d9b5; border:1px solid #d8a24a; border-radius:4px; padding:0 5px; }
    .prow.confirmed { background:#fbf1e0; border-radius:4px; }
    .prow.confirmed .nm { color:#7a1f12; }
    .cf { color:#9a3b12 !important; }
    .prow.tail .you { color:#b8860b; font-weight:700; }
    section.orphans { border:1px dashed #ccc; border-radius:7px; padding:10px 12px; margin-top:18px; background:#fafafa; }
    section.orphans h2 { font-size:13px; margin:0 0 4px; color:#555; }
    .legend { font-size:10.5px; color:#666; margin:6px 0 16px; }
    .legend .pat { color:#1d4d2b; font-weight:600; } .legend .mat { color:#5a2d6e; font-weight:600; }
  </style></head><body>
  <h1>${esc(label)} — Lineage Worksheet</h1>
  <div class="sub">Ancestors grouped by top-of-line (apical) ancestor, descending to you. Built for tracing inheritance down each line.</div>
  <div class="stats">
    <div><b>${lines.length}</b><span>lineage lines (top ancestors)</span></div>
    <div><b>${namedCount}</b><span>named ancestors placed</span></div>
    <div><b>${withParentEdge}</b><span>with parent link found</span></div>
    <div><b class="cf">${confirmedPeople}</b><span>⚖ confirmed slaveholder (evidence in DB)</span></div>
    <div><b>${confirmedLines}</b><span>lines containing a confirmed slaveholder</span></div>
  </div>
  <div class="legend"><span class="pat">Green = paternal (Brown / enslaved-descent)</span> &nbsp; <span class="mat">Purple = maternal (Miller–Lyman / slaveholding)</span> &nbsp; <span class="cf">⚖ = CONFIRMED slaveholder</span> (slave schedule / DC petition / will / enslaver record already in our database) &nbsp; ⚑ verify = climb name-hit, unconfirmed &nbsp; <b>blank = unknown</b> (research target).</div>
  <div class="intro"><b>How to read.</b> Each box is one lineage, headed by the earliest ancestor we reached on that branch. Indented rows walk DOWN the generations to you. Inheritance and estate property flow downward along these rows — to trace what passed hand to hand, follow a box top to bottom. <b>⚖ marks an ancestor we have already documented as a slaveholder</b> (the evidence type is named — slave schedule, 1862 DC compensated-emancipation petition, will, or a vetted enslaver record). A <b>blank</b> evidence slot means unknown — that ancestor is a research target, not a cleared name. The monospace code is the FamilySearch ID. Birth/death years are FamilySearch estimates. Lines with a confirmed slaveholder sort first and are tinted.</div>
  ${lines.map((l, i) => lineHtml(l, i)).join('')}
  ${orphanNodes.length ? `
  <section class="orphans">
    <h2>Lineage gap — ${orphanNodes.length} named ancestors not yet connected to a line${confirmedOrphans ? ` <span class="cf">(${confirmedOrphans} confirmed slaveholders)</span>` : ''}</h2>
    <div class="note">These were reached by the climb but a parent link is missing somewhere between them and you, so we can't yet place them in a descent line. Listed in full so nothing is hidden — re-scraping the broken edge would attach them.</div>
    ${orphanNodes.map(n => `<div class="prow ${n.ev ? 'confirmed' : ''}">
      <span class="conn">·</span><span class="nm">${esc(n.name || '(unnamed)')}</span>
      <span class="yr">${esc(yrs(n.by, n.dy))}</span>
      ${n.place ? `<span class="pl">${esc(n.place)}</span>` : '<span class="pl none">—</span>'}
      <span class="id">${esc(n.fs)}</span>
      ${n.ev ? `<span class="ev" title="${esc(n.ev.notes.join(' · '))}">⚖ ${esc(n.ev.tags.join(' · '))}</span>` : ''}
    </div>`).join('')}
  </section>` : ''}
  </body></html>`;

  const safe = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const htmlPath = resolve('worksheets', `${safe}-lineage-worksheet.html`);
  const pdfPath = resolve('worksheets', `${safe}-lineage-worksheet.pdf`);
  writeFileSync(htmlPath, html);
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.pdf({ path: pdfPath, format: 'Letter', printBackground: true, margin: { top: '0.4in', bottom: '0.4in', left: '0.4in', right: '0.4in' } });
  await browser.close();

  console.log(`✓ ${lines.length} lines · ${namedCount} named · ${withParentEdge} with parent-edge · ${confirmedPeople} CONFIRMED slaveholders (${confirmedLines} lines) · ${flaggedLines} unverified-flag lines`);
  console.log(`✓ HTML: ${htmlPath}`);
  console.log(`✓ PDF:  ${pdfPath}`);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
