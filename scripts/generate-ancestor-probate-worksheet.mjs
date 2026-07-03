#!/usr/bin/env node
/**
 * generate-ancestor-probate-worksheet.mjs
 *
 * Produces a printable PDF research worksheet for ONE participant's traced
 * ancestor pool. The worksheet operationalises the "actively solicit will /
 * probate for each ancestor and manually LOOK" practice: rather than only
 * cross-referencing every ancestor against our datasets, we hand-investigate
 * each named direct-line ancestor by writing the relevant county clerk.
 *
 * ---------------------------------------------------------------------------
 * 2026-06 REWRITE — recover the FULL ancestor pool, not just the match paths.
 *
 *   The climb stores every visited ancestor as a bare FamilySearch ID in
 *   ancestor_climb_sessions.visited_set (e.g. 3,922 IDs for Adrian Brown).
 *   The PREVIOUS version of this script only named the ~36 ancestors that sat
 *   on a lineage_path leading to one of the 16 slaveholder matches — so 3,886
 *   real ancestors were silently dropped and the sheet looked empty.
 *
 *   It turns out the names were NOT lost: the climber persisted each visited
 *   person to canonical_persons and recorded the FS ID in person_external_ids
 *   (id_system = 'familysearch'). Joining visited_set back through that table
 *   re-attaches names, birth/death year estimates and primary state/county for
 *   ~2,880 of the 3,922 — including ~2,721 born in the 1450–1865 slavery era.
 *
 *   This script now resolves the ENTIRE visited_set, lists every named
 *   ancestor as a research row, and prints an honest appendix of the IDs that
 *   still could not be resolved (those need re-querying FamilySearch).
 * ---------------------------------------------------------------------------
 *
 * Usage:
 *   node scripts/generate-ancestor-probate-worksheet.mjs [FS_ID] [--name "Label"]
 *   Defaults to Adrian Brown (P4RF-PFQ).
 */
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const sql = neon(process.env.DATABASE_URL);

const args = process.argv.slice(2);
const FS_ID = args.find(a => !a.startsWith('--')) || 'P4RF-PFQ';
const nameFlagIdx = args.indexOf('--name');
const LABEL_OVERRIDE = nameFlagIdx >= 0 ? args[nameFlagIdx + 1] : null;

// Upper bound of the slavery-era research window. Ancestors born at/after this
// were not alive to appear in pre-Emancipation slavery records as adults, so
// they sort below the priority block (but are still listed for completeness).
const ERA_END = 1865;

function cleanPlace(s) {
  if (!s || typeof s !== 'string') return '';
  const t = s.trim();
  if (t.length < 3 || t.length > 40) return '';
  if (/\b(was|but|along|lived|married|born at)\b/i.test(t)) return '';
  return t;
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sideOf(state, name) {
  // Heuristic lineage side for sorting/colour only. Brown = paternal (Black /
  // enslaved-descent), Miller–Lyman = maternal (white / slaveholding).
  if (/\b(miller|lyman|biscoe|chew|hopewell|patterson|young|irvine|drennan|redifer)\b/i.test(name || '')) return 'MAT';
  if (/\b(brown|watson|knighten|larche|knighton)\b/i.test(name || '')) return 'PAT';
  return '';
}

async function main() {
  const sessions = await sql`
    SELECT id, modern_person_name, modern_person_fs_id, status, ancestors_visited, matches_found, completed_at, started_at
    FROM ancestor_climb_sessions
    WHERE modern_person_fs_id = ${FS_ID} AND status = 'completed'
    ORDER BY ancestors_visited DESC NULLS LAST`;
  if (!sessions.length) throw new Error(`No completed climb session for FS ID ${FS_ID}`);
  const session = sessions[0];
  const label = LABEL_OVERRIDE || session.modern_person_name || FS_ID;

  // ---- The full visited pool (bare FS IDs) ----
  const vsRow = await sql`SELECT visited_set AS v FROM ancestor_climb_sessions WHERE id = ${session.id}::uuid`;
  const visited = (vsRow[0].v || []).filter(Boolean);
  const visitedSet = new Set(visited);

  // ---- Resolve names + detail for the whole pool via canonical_persons ----
  // person_external_ids(id_system='familysearch').external_id  ->  canonical_persons
  const resolvedRows = await sql`
    SELECT pei.external_id AS fs_id, cp.canonical_name AS name,
           cp.birth_year_estimate AS birth_year, cp.death_year_estimate AS death_year,
           cp.primary_state AS state, cp.primary_county AS county
    FROM person_external_ids pei
    JOIN canonical_persons cp ON cp.id = pei.canonical_person_id
    WHERE pei.id_system = 'familysearch' AND pei.external_id = ANY(${visited})`;
  const detail = new Map(); // fs_id -> {name, birth_year, death_year, place}
  for (const r of resolvedRows) {
    if (!r.fs_id || detail.has(r.fs_id)) continue;
    const place = [cleanPlace(r.county), cleanPlace(r.state)].filter(Boolean).join(', ');
    detail.set(r.fs_id, { name: r.name, birth_year: r.birth_year || null, death_year: r.death_year || null, place });
  }

  // ---- Supplement names/places from the rich all_matches person objects ----
  const amRow = await sql`SELECT all_matches FROM ancestor_climb_sessions WHERE id = ${session.id}::uuid`;
  const allMatches = Array.isArray(amRow[0].all_matches) ? amRow[0].all_matches : [];
  for (const e of allMatches) {
    const p = e?.person; if (!p?.fs_id || !p?.name) continue;
    const cur = detail.get(p.fs_id) || { name: p.name, birth_year: null, death_year: null, place: '' };
    cur.name = cur.name || p.name;
    cur.birth_year = cur.birth_year || p.birth_year || null;
    cur.death_year = cur.death_year || p.death_year || null;
    cur.place = cur.place || cleanPlace(p.birth_place) || cleanPlace((p.locations || [])[0]) || '';
    detail.set(p.fs_id, cur);
  }

  // ---- Lineage edges: child-in-line (the next person toward the participant) ----
  // From this session's inferred_parent_links (parent -> child by FS ID).
  const edges = await sql`
    SELECT child_fs_id, child_name, parent_fs_id, parent_name
    FROM inferred_parent_links WHERE session_id = ${session.id}::uuid`;
  const childOf = new Map(); // ancestor fs_id -> child name (toward Adrian)
  const childByName = new Map(); // ancestor name -> child name (fallback)
  for (const e of edges) {
    if (e.parent_fs_id && e.child_name && !childOf.has(e.parent_fs_id)) childOf.set(e.parent_fs_id, e.child_name);
    if (e.parent_name && e.child_name && !childByName.has(e.parent_name)) childByName.set(e.parent_name, e.child_name);
    // backfill any names the edges know that canonical didn't
    for (const [id, nm] of [[e.child_fs_id, e.child_name], [e.parent_fs_id, e.parent_name]]) {
      if (id && nm && visitedSet.has(id) && !detail.has(id)) detail.set(id, { name: nm, birth_year: null, death_year: null, place: '' });
    }
  }

  // ---- Slaveholder match flags, keyed by ancestor NAME (matches store name paths) ----
  const matches = await sql`
    SELECT slaveholder_name, generation_distance, lineage_path, match_type, classification, classification_reason
    FROM ancestor_climb_matches WHERE session_id = ${session.id}::uuid
    ORDER BY generation_distance`;
  const flagByName = new Map(); // ancestor name (terminal of path) -> {slaveholder, classification, match_type}
  for (const m of matches) {
    const path = m.lineage_path || [];
    const terminal = path[path.length - 1];
    if (terminal && !flagByName.has(terminal)) {
      flagByName.set(terminal, { slaveholder: m.slaveholder_name, classification: m.classification, match_type: m.match_type });
    }
    // record child-in-line for everyone along a match path too
    for (let i = 1; i < path.length; i++) {
      if (path[i] && path[i - 1] && !childByName.has(path[i])) childByName.set(path[i], path[i - 1]);
    }
  }

  // ---- Build rows for every RESOLVED visited ancestor (skip the participant) ----
  const rows = [];
  for (const fs_id of visited) {
    const d = detail.get(fs_id);
    if (!d || !d.name) continue;
    if (fs_id === FS_ID) continue;                // skip the participant themselves
    if ((d.birth_year || 0) >= 1980) continue;    // skip clearly-living recent relatives
    const child = childOf.get(fs_id) || childByName.get(d.name) || '';
    const flag = flagByName.get(d.name) || null;
    rows.push({ fs_id, name: d.name, birth_year: d.birth_year, death_year: d.death_year, place: d.place, child, flag,
                side: sideOf(d.state, d.name) });
  }

  // Dedup by (name + birth_year) — the same ancestor can appear under two FS IDs.
  const seen = new Set();
  const deduped = [];
  for (const r of rows) {
    const k = `${r.name}|${r.birth_year || ''}`;
    if (seen.has(k)) continue;
    seen.add(k); deduped.push(r);
  }

  // Sort by birth year ascending (oldest ancestors first); unknown years last.
  deduped.sort((a, b) => {
    const ay = a.birth_year || 99999, by = b.birth_year || 99999;
    return ay - by || (a.name > b.name ? 1 : -1);
  });

  // Split: priority = born on/before 1865 OR unknown year; recent = born after 1865.
  const priority = deduped.filter(r => !r.birth_year || r.birth_year <= ERA_END);
  const recent = deduped.filter(r => r.birth_year && r.birth_year > ERA_END);

  // Unresolved IDs — listed honestly so the sheet hides nothing.
  const resolvedIds = new Set(deduped.map(r => r.fs_id));
  const unresolved = visited.filter(id => id !== FS_ID && !resolvedIds.has(id) && !detail.has(id));

  const generated = (session.completed_at || session.started_at)
    ? new Date(session.completed_at || session.started_at).toISOString().slice(0, 10) : '';

  // ---------- render helpers ----------
  const flagSpan = (f) => f
    ? `<div class="hit"><span class="flag ${esc(f.classification)}">⚑ ${esc(f.slaveholder)} (${esc(f.classification)})</span></div>` : '';
  const logRow = (r, i) => `<tr class="${r.side === 'PAT' ? 'pat' : r.side === 'MAT' ? 'mat' : ''}">
      <td class="num">${i}</td>
      <td class="nm">${esc(r.name)}${flagSpan(r.flag)}<div class="fsid">${esc(r.fs_id)}</div></td>
      <td class="c">${r.birth_year || ''}</td>
      <td class="c">${r.death_year || ''}</td>
      <td>${esc(r.place)}</td>
      <td></td>
      <td class="child">${esc(r.child || '')}</td>
      <td class="findings"></td>
    </tr>`;

  const priorityRows = priority.map((r, i) => logRow(r, i + 1)).join('\n');
  const recentRows = recent.map((r, i) => logRow(r, priority.length + i + 1)).join('\n');

  // Flagged-ancestors verification table (the small set with dataset hits).
  const flagged = deduped.filter(r => r.flag);
  const flaggedRows = flagged.map((r, i) => `<tr>
      <td class="num">${i + 1}</td>
      <td class="nm">${esc(r.name)}<div class="fsid">${esc(r.fs_id)}</div></td>
      <td class="c">${r.birth_year || ''}</td>
      <td>${esc(r.flag.slaveholder)}</td>
      <td class="c">${esc((r.flag.match_type || '').replace(/_/g, ' '))}</td>
      <td class="c"><span class="flag ${esc(r.flag.classification)}">${esc(r.flag.classification)}</span></td>
      <td class="findings"></td>
    </tr>`).join('\n');

  // Unresolved appendix — compact multi-column ID dump.
  const unresolvedCols = (() => {
    const per = Math.ceil(unresolved.length / 6) || 1;
    let cells = '';
    for (let c = 0; c < 6; c++) {
      const slice = unresolved.slice(c * per, (c + 1) * per);
      cells += `<td class="idcol">${slice.map(esc).join('<br>')}</td>`;
    }
    return `<tr>${cells}</tr>`;
  })();

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: letter landscape; margin: 12mm 10mm; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; font-size: 9px; margin: 0; }
  h1 { font-size: 17px; margin: 0 0 2px; }
  h2 { font-size: 13px; margin: 16px 0 4px; border-bottom: 2px solid #333; padding-bottom: 2px; }
  .sub { font-size: 9px; color: #555; margin: 0 0 6px; }
  .meta { font-size: 8.5px; color: #444; margin: 2px 0 8px; }
  .intro { font-size: 9px; background: #f4f1ea; border-left: 3px solid #8a7a52; padding: 6px 9px; margin: 6px 0 4px; line-height: 1.35; }
  .stat { display: inline-block; background: #2b2b2b; color: #fff; padding: 2px 7px; margin: 0 4px 4px 0; font-size: 9px; }
  .stat b { font-size: 11px; }
  table { border-collapse: collapse; width: 100%; table-layout: fixed; }
  th, td { border: 0.6px solid #999; padding: 3px 4px; vertical-align: top; text-align: left; }
  th { background: #2b2b2b; color: #fff; font-size: 8px; font-weight: normal; }
  td.num { width: 26px; text-align: right; color: #888; }
  td.c { text-align: center; }
  td.findings { background: #fffdf7; }
  td.child { font-style: italic; color: #444; }
  td.nm { font-weight: bold; }
  .fsid { font-weight: normal; font-style: italic; color: #999; font-size: 7px; }
  .hit { margin-top: 2px; }
  .flag { font-size: 7.5px; padding: 1px 3px; border-radius: 2px; background: #eee; }
  .flag.temporal_impossible { background: #e8e8e8; color: #777; text-decoration: line-through; }
  .flag.unverified { background: #fff3cd; color: #7a5b00; }
  .flag.free_poc_slaveholder { background: #d8e6f3; color: #234; }
  .flag.common_name_suspect { background: #f0e0e0; color: #844; }
  tr.mat td.nm { border-left: 3px solid #b08a4f; }
  tr.pat td.nm { border-left: 3px solid #4f7bb0; }
  .legend { font-size: 8px; color: #555; margin: 4px 0 0; }
  .legend b { color: #222; }
  .pagebreak { page-break-before: always; }
  td.idcol { font-family: 'Courier New', monospace; font-size: 7.5px; color: #555; line-height: 1.5; vertical-align: top; }
  </style></head><body>

  <h1>Ancestor Probate &amp; Will Research Worksheet</h1>
  <div class="sub">Participant: <b>${esc(label)}</b> &nbsp;·&nbsp; FamilySearch ID ${esc(FS_ID)} &nbsp;·&nbsp; Reparations &#8712; &#8477;</div>
  <div class="meta">Climb session ${esc(session.id.slice(0, 8))} · climbed ${esc(generated)}</div>

  <div style="margin:6px 0;">
    <span class="stat"><b>${visited.length}</b> ancestors climbed</span>
    <span class="stat"><b>${deduped.length}</b> named &amp; researchable</span>
    <span class="stat"><b>${priority.length}</b> born &#8804;${ERA_END} (slavery-era priority)</span>
    <span class="stat"><b>${flagged.length}</b> dataset flags to verify</span>
    <span class="stat"><b>${unresolved.length}</b> still ID-only</span>
  </div>

  <div class="intro"><b>How to use this sheet.</b> Every named ancestor below is one research target. For each, write the clerk of court / probate office in the county where they <b>died</b> (or last lived) and request their estate file: will, inventory, and any appraisal of property. On <b>maternal (Miller–Lyman, white/slaveholding)</b> lines the ancestor's <b>own</b> will may itemise enslaved people by name and value — direct evidence. On <b>paternal (Brown, Black/enslaved-descent)</b> lines look instead for the ancestor's <b>name inside a slaveholder's</b> estate file, bill of sale, or 1850/1860 slave schedule. Record everything — a blank "no record found" is still a finding. The italic code under each name is the FamilySearch ID (open <span style="font-family:monospace">familysearch.org/tree/person/details/&lt;ID&gt;</span> to confirm dates &amp; place). ⚑ marks a dataset hit our climb already flagged — verify it; many are false positives. Birth/death years are FamilySearch estimates; confirm before relying on them.</div>

  <h2>Section 1 — Slavery-era ancestors (born on or before ${ERA_END}) · ${priority.length} rows</h2>
  <table>
    <colgroup>
      <col style="width:26px"><col style="width:150px"><col style="width:34px"><col style="width:34px">
      <col style="width:110px"><col style="width:100px"><col style="width:110px"><col>
    </colgroup>
    <thead><tr>
      <th>#</th><th>Ancestor name &amp; FS ID</th><th>Birth</th><th>Death</th>
      <th>Birth state / county (climb)</th><th>Death place &#8594; which county clerk</th>
      <th>Child in our line</th><th>Findings (clerk replied / will / inventory / enslaved named)</th>
    </tr></thead>
    <tbody>
      ${priorityRows}
    </tbody>
  </table>
  <div class="legend"><b>Match flags:</b>
    <span class="flag temporal_impossible">temporal_impossible</span> born too late to have enslaved — usually a name collision. &nbsp;
    <span class="flag unverified">unverified</span> name/location match, needs a document. &nbsp;
    <span class="flag free_poc_slaveholder">free_poc_slaveholder</span> free person of colour appearing as a holder. &nbsp;
    <span class="flag common_name_suspect">common_name_suspect</span> common name, likely false positive. &nbsp;
    <b>Side bar:</b> <span style="color:#b08a4f">▌</span> maternal (slaveholding) · <span style="color:#4f7bb0">▌</span> paternal (enslaved-descent).
  </div>

  ${flagged.length ? `
  <div class="pagebreak"></div>
  <h2>Section 2 — Flagged ancestors: dataset hits to verify · ${flagged.length} rows</h2>
  <table>
    <colgroup><col style="width:26px"><col style="width:170px"><col style="width:40px"><col style="width:150px"><col style="width:110px"><col style="width:120px"><col></colgroup>
    <thead><tr><th>#</th><th>Ancestor &amp; FS ID</th><th>Birth</th><th>Candidate slaveholder / record</th><th>Match type</th><th>Classification</th><th>Verification finding</th></tr></thead>
    <tbody>${flaggedRows}</tbody>
  </table>
  <div class="legend">These are the only ancestors our automated climb already tied to a dataset record. Treat each as a lead to confirm with a primary document — not a settled fact.</div>
  ` : ''}

  ${recent.length ? `
  <div class="pagebreak"></div>
  <h2>Section 3 — Later ancestors (born after ${ERA_END}) · ${recent.length} rows</h2>
  <div class="sub">Born too late to appear as adults in pre-Emancipation slavery records, but listed to complete the line and to trace where the family went after 1865.</div>
  <table>
    <colgroup>
      <col style="width:26px"><col style="width:150px"><col style="width:34px"><col style="width:34px">
      <col style="width:110px"><col style="width:100px"><col style="width:110px"><col>
    </colgroup>
    <thead><tr><th>#</th><th>Ancestor name &amp; FS ID</th><th>Birth</th><th>Death</th><th>Birth state / county</th><th>Death place &#8594; county clerk</th><th>Child in our line</th><th>Findings</th></tr></thead>
    <tbody>${recentRows}</tbody>
  </table>
  ` : ''}

  ${unresolved.length ? `
  <div class="pagebreak"></div>
  <h2>Section 4 — Unresolved ancestors (climbed but not yet named) · ${unresolved.length} IDs</h2>
  <div class="sub">The climb visited these FamilySearch IDs but their person record was not captured in our canonical database, so we cannot yet print a name. They are listed in full so <b>nothing is hidden</b>. To name them, re-query each on FamilySearch (<span style="font-family:monospace">familysearch.org/tree/person/details/&lt;ID&gt;</span>) or re-run the climber with name-persistence enabled.</div>
  <table><tbody>${unresolvedCols}</tbody></table>
  ` : ''}

  </body></html>`;

  mkdirSync(resolve('worksheets'), { recursive: true });
  const safe = label.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const htmlPath = resolve('worksheets', `${safe}-probate-worksheet.html`);
  const pdfPath = resolve('worksheets', `${safe}-probate-worksheet.pdf`);
  writeFileSync(htmlPath, html);

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.pdf({ path: pdfPath, format: 'Letter', landscape: true, printBackground: true,
    margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } });
  await browser.close();

  console.log(`✓ ${visited.length} climbed · ${deduped.length} named (${priority.length} born ≤${ERA_END}) · ${flagged.length} flagged · ${unresolved.length} unresolved`);
  console.log(`✓ HTML: ${htmlPath}`);
  console.log(`✓ PDF:  ${pdfPath}`);
}

main().catch(e => { console.error('ERR', e); process.exit(1); });
