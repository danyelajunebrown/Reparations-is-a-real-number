#!/usr/bin/env node
/**
 * generate-climb-accuracy-audit.mjs
 *
 * Produces a printable "Climb Accuracy Verification Packet" — one section per
 * test-climb participant — to be used when contacting each participant to ask:
 * "did our climber trace your real family, and at which generation (if any) did
 * it go wrong?" The answers debug the climber's parent-linking + matching.
 *
 * Premise #2 we are now stress-testing: we have been assuming FamilySearch
 * trees are genealogically correct. They are not always. The only way to know
 * the climber's true accuracy is to put the traced lineage in front of the
 * person who knows their own family and have them confirm or correct it.
 *
 * For each completed session it shows:
 *   - the distinct lineage CHAINS the climber built (the parent→child links it
 *     asserts — this is what the participant verifies, link by link), and
 *   - every dataset MATCH with its classification (so obvious false positives,
 *     e.g. temporal_impossible name collisions, are visible as climber errors).
 *
 * Sessions that barely ran (≤2 ancestors visited) are listed in a "failed —
 * re-run needed" appendix rather than presented as results.
 *
 * Usage: node scripts/generate-climb-accuracy-audit.mjs
 */
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const sql = neon(process.env.DATABASE_URL);
const MIN_VISITED = 3;       // below this the climb effectively failed
const MAX_MATCHES_SHOWN = 40; // cap noisy sessions (e.g. Fagan's 548)

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function main() {
  const sessions = await sql`
    SELECT id, modern_person_name, modern_person_fs_id, status, ancestors_visited,
           max_generation_reached, matches_found, started_at, completed_at
    FROM ancestor_climb_sessions
    WHERE status = 'completed'
    ORDER BY ancestors_visited DESC NULLS LAST`;

  const real = sessions.filter(s => (s.ancestors_visited || 0) >= MIN_VISITED);
  const failed = sessions.filter(s => (s.ancestors_visited || 0) < MIN_VISITED);

  const sections = [];
  for (const s of real) {
    const matches = await sql`
      SELECT slaveholder_name, generation_distance, lineage_path, match_type,
             match_confidence, classification, classification_reason
      FROM ancestor_climb_matches WHERE session_id = ${s.id}::uuid
      ORDER BY generation_distance, match_confidence DESC`;

    // Distinct lineage chains (dedupe identical paths; keep the longest variants).
    const chainSet = new Map();
    for (const m of matches) {
      const p = m.lineage_path || [];
      if (p.length < 2) continue;
      const key = p.join(' > ');
      if (!chainSet.has(key)) chainSet.set(key, p);
    }
    // Remove chains that are a prefix of a longer chain.
    const chains = [...chainSet.values()].sort((a, b) => b.length - a.length)
      .filter((p, _i, arr) => !arr.some(q => q !== p && q.length > p.length && q.slice(0, p.length).join('>') === p.join('>')));

    sections.push({ s, matches, chains });
  }

  const chainHtml = (chains) => chains.map(p =>
    `<div class="chain"><span class="root">${esc(p[0])}</span>` +
    p.slice(1).map((n, i) => ` <span class="arr">→</span> <span class="g">g${i + 1}</span> ${esc(n)}`).join('') +
    ` <span class="conf">✔ correct? &nbsp; ✘ wrong at g__ : ____________________</span></div>`
  ).join('\n');

  const matchRows = (matches) => matches.slice(0, MAX_MATCHES_SHOWN).map(m => {
    const term = (m.lineage_path || []).slice(-1)[0] || '';
    return `<tr>
      <td class="c">${m.generation_distance ?? ''}</td>
      <td>${esc(term)}</td>
      <td>${esc(m.slaveholder_name)}</td>
      <td class="c">${m.match_confidence ?? ''}</td>
      <td><span class="cls ${esc(m.classification)}">${esc(m.classification || '')}</span></td>
      <td class="vr">✔ real &nbsp; ✘ false</td>
    </tr>`;
  }).join('\n');

  const sectionHtml = sections.map(({ s, matches, chains }, idx) => {
    const more = matches.length > MAX_MATCHES_SHOWN ? `<div class="note">+ ${matches.length - MAX_MATCHES_SHOWN} more matches not shown (this climb produced ${matches.length} total — high volume usually means loose matching to audit).</div>` : '';
    return `
    <div class="${idx > 0 ? 'pagebreak' : ''}"></div>
    <h2>${esc(s.modern_person_name || s.modern_person_fs_id)} <span class="fsid">${esc(s.modern_person_fs_id)}</span></h2>
    <div class="meta">session ${esc(s.id.slice(0, 8))} · ${s.ancestors_visited} ancestors visited · ${matches.length} dataset matches · climbed ${s.completed_at ? new Date(s.completed_at).toISOString().slice(0, 10) : ''}</div>

    <div class="ask"><b>Ask the participant:</b> Walk each chain below aloud. For every <b>→</b> link, is that really this person's parent? Mark ✔ if the whole chain is right, or ✘ and the generation (g1, g2…) where it first goes wrong. A wrong link there is a climber error to fix; a right link the participant has never heard of is a lead.</div>

    <h3>Lineage chains the climber asserts</h3>
    ${chains.length ? chainHtml(chains) : '<div class="note">No multi-generation chains recorded for this session.</div>'}

    <h3>Dataset matches found on these lines</h3>
    <table>
      <thead><tr><th class="c">Gen</th><th>Ancestor matched</th><th>Claimed slaveholder / record</th><th class="c">Conf</th><th>Our classification</th><th>Participant / researcher verdict</th></tr></thead>
      <tbody>${matches.length ? matchRows(matches) : '<tr><td colspan="6" class="note">No matches.</td></tr>'}</tbody>
    </table>
    ${more}`;
  }).join('\n');

  const failedHtml = failed.length ? `
    <div class="pagebreak"></div>
    <h2>Appendix — climbs that failed (re-run, do not verify)</h2>
    <table>
      <thead><tr><th>Participant</th><th>FS ID</th><th class="c">Visited</th><th>Likely cause</th></tr></thead>
      <tbody>${failed.map(f => `<tr><td>${esc(f.modern_person_name || '?')}</td><td>${esc(f.modern_person_fs_id)}</td><td class="c">${f.ancestors_visited || 0}</td><td>Climber extracted 0–1 ancestors — usually a living-person page with private/unshared tree or failed login. Needs grandparent FS IDs + confirmed tree sharing, then re-climb.</td></tr>`).join('')}</tbody>
    </table>` : '';

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: letter portrait; margin: 14mm 14mm; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; font-size: 10px; margin: 0; line-height: 1.4; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  h2 { font-size: 14px; margin: 16px 0 2px; border-bottom: 2px solid #333; padding-bottom: 2px; }
  h3 { font-size: 11px; margin: 12px 0 4px; color: #444; }
  .fsid { font-size: 9px; color: #888; font-weight: normal; }
  .sub { font-size: 10px; color: #555; margin: 0 0 10px; }
  .meta { font-size: 8.5px; color: #666; margin: 0 0 6px; }
  .intro, .ask { background: #f4f1ea; border-left: 3px solid #8a7a52; padding: 7px 10px; margin: 6px 0; font-size: 9.5px; }
  .chain { font-size: 9.5px; padding: 4px 6px; border-bottom: 0.6px dotted #bbb; }
  .chain .root { font-weight: bold; }
  .chain .g { color: #aa8; font-size: 8px; }
  .chain .arr { color: #999; }
  .chain .conf { display: block; color: #777; font-size: 8.5px; margin-top: 2px; }
  table { border-collapse: collapse; width: 100%; margin-top: 4px; }
  th, td { border: 0.6px solid #aaa; padding: 3px 5px; text-align: left; vertical-align: top; }
  th { background: #2b2b2b; color: #fff; font-size: 8.5px; font-weight: normal; }
  td.c, th.c { text-align: center; }
  td.vr, td.findings { background: #fffdf7; color: #aaa; font-size: 8px; }
  .cls { font-size: 8px; padding: 1px 3px; border-radius: 2px; background: #eee; }
  .cls.temporal_impossible { background: #e8e8e8; color: #888; text-decoration: line-through; }
  .cls.unverified { background: #fff3cd; color: #7a5b00; }
  .cls.free_poc_slaveholder { background: #d8e6f3; color: #234; }
  .cls.common_name_suspect { background: #f0e0e0; color: #844; }
  .note { font-size: 8.5px; color: #888; font-style: italic; margin: 4px 0; }
  .pagebreak { page-break-before: always; }
  </style></head><body>
  <h1>Climb Accuracy Verification Packet</h1>
  <div class="sub">Reparations ∈ ℝ — testing assumption #2: that FamilySearch trees (and our climber's reading of them) are genealogically correct.</div>
  <div class="intro"><b>Purpose.</b> For each test-climb participant below, contact them and walk the lineage chains our climber built. Every confirmed wrong link is a climber/tree bug; every confirmed right link the participant didn't know is a genuine discovery. Record verdicts on this sheet, then feed corrections back into the climber (garbage-detection, parent-extraction, match thresholds). ${real.length} participants to verify; ${failed.length} failed climb(s) to re-run.</div>
  ${sectionHtml}
  ${failedHtml}
  </body></html>`;

  mkdirSync(resolve('worksheets'), { recursive: true });
  const htmlPath = resolve('worksheets', 'climb-accuracy-verification-packet.html');
  const pdfPath = resolve('worksheets', 'climb-accuracy-verification-packet.pdf');
  writeFileSync(htmlPath, html);

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.pdf({ path: pdfPath, format: 'Letter', printBackground: true,
    margin: { top: '14mm', bottom: '14mm', left: '14mm', right: '14mm' } });
  await browser.close();

  console.log(`✓ ${real.length} participants, ${failed.length} failed climbs`);
  console.log(`✓ PDF:  ${pdfPath}`);
}

main().catch(e => { console.error('ERR', e); process.exit(1); });
