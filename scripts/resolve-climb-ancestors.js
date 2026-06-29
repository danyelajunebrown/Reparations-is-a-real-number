#!/usr/bin/env node
/**
 * resolve-climb-ancestors.js
 *
 * Re-queries FamilySearch for every ancestor a completed climb VISITED, to:
 *   (1) NAME the ~1,042 ancestors whose person record never made it into our
 *       canonical database (they were stored only as bare FS IDs in
 *       ancestor_climb_sessions.visited_set), and
 *   (2) BACKFILL birth/death place (primary_state / primary_county) for the
 *       ~2,850 ancestors we already named but had no location for.
 *
 * Both goals are met in a SINGLE visit per person: one page load yields name,
 * years, and place. The script writes the same dual record the climber does —
 *   canonical_persons  (canonical_name, years, primary_state/county, ...)
 *   person_external_ids (id_system='familysearch', external_id=FS ID -> the row)
 * — which is exactly what generate-ancestor-probate-worksheet.mjs joins on, so
 * the worksheet picks up every newly-resolved ancestor automatically.
 *
 * Fully resumable: processed FS IDs are checkpointed to a progress file, so a
 * rate-limit, crash, or Ctrl-C loses nothing. Re-run to continue.
 *
 * Usage:
 *   HEADLESS=0 LIMIT=15 node scripts/resolve-climb-ancestors.js   # login + test batch
 *   HEADLESS=1 node scripts/resolve-climb-ancestors.js            # full headless run
 *
 * Env:
 *   SID       climb session id (default Adrian Brown's f4a5b049…)
 *   FS_ID     participant FS id (default P4RF-PFQ) — skipped, not an ancestor
 *   LIMIT     max persons to process this run (0 = all remaining)
 *   HEADLESS  '1' headless (needs fresh cookies), '0' headful (allows login)
 *   REGEN     '0' to skip worksheet regeneration at the end
 */
require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const { execFileSync } = require('child_process');

const sql = neon(process.env.DATABASE_URL);
const SID = process.env.SID || 'f4a5b049-30dc-437f-8d55-fe5d68d42115';
const FS_ID = process.env.FS_ID || 'P4RF-PFQ';
const LIMIT = parseInt(process.env.LIMIT || '0', 10);
const HEADLESS = process.env.HEADLESS !== '0';
const REGEN = process.env.REGEN !== '0';
const PARTICIPANT_LABEL = process.env.LABEL || 'Adrian (Danyela) Brown';

const PERSON_URL = 'https://www.familysearch.org/en/tree/person/details/';
const COOKIES = './fs-climber-cookies.json';
const PROGRESS = './worksheets/.resolve-progress.json';

const US_STATES = ['Alabama','Arkansas','Connecticut','Delaware','Florida','Georgia','Illinois','Indiana','Kentucky',
  'Louisiana','Maine','Maryland','Massachusetts','Mississippi','Missouri','New Jersey','New York','North Carolina',
  'Ohio','Pennsylvania','Rhode Island','South Carolina','Tennessee','Texas','Vermont','Virginia','West Virginia',
  'District of Columbia'];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function loadProgress() {
  try { return new Set(JSON.parse(fs.readFileSync(PROGRESS, 'utf8'))); } catch { return new Set(); }
}
function saveProgress(set) {
  try { fs.writeFileSync(PROGRESS, JSON.stringify([...set])); } catch (e) { console.error('progress save failed:', e.message); }
}

async function buildWorklist() {
  const vs = await sql`SELECT visited_set AS v FROM ancestor_climb_sessions WHERE id = ${SID}::uuid`;
  const visited = (vs[0].v || []).filter(Boolean).filter(id => id !== FS_ID);

  // What do we already have? canonical_id + whether a place is set.
  const have = await sql`
    SELECT pei.external_id AS fs_id, cp.id AS cid,
           (cp.primary_state IS NOT NULL OR cp.primary_county IS NOT NULL) AS has_place
    FROM person_external_ids pei JOIN canonical_persons cp ON cp.id = pei.canonical_person_id
    WHERE pei.id_system = 'familysearch' AND pei.external_id = ANY(${visited})`;
  const known = new Map();
  for (const r of have) if (!known.has(r.fs_id)) known.set(r.fs_id, { cid: r.cid, has_place: r.has_place });

  // Needs work = unnamed OR named-but-placeless.
  const worklist = visited.filter(id => { const k = known.get(id); return !k || !k.has_place; });
  return { visited, worklist, known };
}

async function applyCookies(page) {
  try {
    const cookies = JSON.parse(fs.readFileSync(COOKIES, 'utf8'));
    await page.setCookie(...cookies);
    return cookies.length;
  } catch { return 0; }
}

async function ensureLogin(page) {
  await page.goto(PERSON_URL + FS_ID, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2500);
  const url = page.url();
  if (url.includes('ident.familysearch') || url.includes('/auth/')) {
    if (HEADLESS) throw new Error('Login required but running headless. Re-run with HEADLESS=0 to log in once.');
    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║  LOG IN to FamilySearch in the browser window.       ║');
    console.log('║  Waiting up to 5 minutes for a person page to load…  ║');
    console.log('╚══════════════════════════════════════════════════════╝\n');
    for (let i = 0; i < 150; i++) {
      await sleep(2000);
      const u = page.url();
      if (u.includes('/tree/person/details/') && !u.includes('ident.familysearch') && !u.includes('/auth/')) break;
    }
    const cookies = await page.cookies();
    fs.writeFileSync(COOKIES, JSON.stringify(cookies, null, 2));
    console.log(`✓ Logged in, saved ${cookies.length} fresh cookies\n`);
  } else {
    console.log('✓ Existing cookies still valid — logged in\n');
  }
}

async function extractPerson(page, fsId) {
  await page.goto(PERSON_URL + fsId, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // Wait for the VITALS to actually render — not just the title. FamilySearch's
  // SPA paints the title first, then fills the Birth/Death place blocks a beat
  // later; reading too early yields empty name/place (the timing race).
  try {
    await page.waitForFunction(() => {
      const b = document.body.innerText || '';
      // Real vitals present (the event headers FS renders), OR a terminal state.
      return /\bBirth\b\s*(?:•|\n)/.test(b) || /\bDeath\b\s*(?:•|\n)/.test(b) ||
             b.includes('Vital Information') || b.includes('Person Not Found') ||
             b.includes('Unknown sex') || b.includes('This person is living');
    }, { timeout: 20000, polling: 400 });
  } catch { /* fall through to settle delay */ }
  await sleep(1200); // settle: let the place line under the date paint

  return await page.evaluate((states) => {
    const out = { name: null, birth_year: null, death_year: null, birth_place: null, death_place: null,
                  state: null, county: null, living: false, not_found: false };
    const title = document.title || '';
    const body = document.body.innerText || '';

    if (body.includes('Person Not Found') && !body.includes('UNKNOWN')) { out.not_found = true; return out; }
    if (title.includes('UNKNOWN') || title.includes('[Unknown Name]') ||
        (body.includes('UNKNOWN') && body.includes('Unknown sex'))) { out.living = true; }

    // Name + years from the page title: "Name (1799–1881) • Person • Family Tree"
    const range = title.match(/^([^(]+)\((\d{4})[–\-](\d{4})\)/);
    const birthOnly = title.match(/^([^(]+)\((\d{4})[–\-]/);
    const nameOnly = title.match(/^([^(]+)\((Deceased|Living|\?)/);
    if (range) { out.name = range[1].trim(); out.birth_year = +range[2]; out.death_year = +range[3]; }
    else if (birthOnly) { out.name = birthOnly[1].trim(); out.birth_year = +birthOnly[2]; }
    else if (nameOnly) { out.name = nameOnly[1].trim(); }
    if (!out.name) {
      const h1 = document.querySelector('h1');
      const first = (h1?.innerText || '').split('\n')[0]?.trim();
      if (first && first.split(/\s+/).length >= 2 && !/Family Tree|Search|Memories|Activities/i.test(first)) out.name = first;
    }

    // Birth / Death PLACE — FamilySearch renders vitals as line blocks:
    //   "Birth • 6 Sources" / "February 1860" / "Louisiana, United States"
    //   "Death • 2 Sources" / "8 July 1911" / "Marshall, Harrison, Texas, United States"
    // So: find the event header line, then the first following line that looks
    // like a place (the date line in between is skipped).
    const lines = body.split('\n').map(s => s.trim()).filter(Boolean);
    const looksPlace = (s) => {
      if (!s || s.length < 4 || s.length > 90) return false;
      if (/^(Christening|Burial|ADD|Add\b|Death|Birth|Marriage|Residence|Other Information|Detail View|Alternate|Sources?|VIEW|Edit|Show|Reason)/i.test(s)) return false;
      return s.includes('United States') || states.some(st => s.includes(st)) || /,\s*[A-Z]/.test(s);
    };
    const eventPlace = (label) => {
      for (let i = 0; i < lines.length; i++) {
        const isHeader = new RegExp('^' + label + '(?:\\s*•|\\s*$)', 'i').test(lines[i]);
        if (!isHeader) continue;
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          if (looksPlace(lines[j])) return lines[j];
        }
      }
      return null;
    };
    out.birth_place = eventPlace('Birth');
    out.death_place = eventPlace('Death');

    // Derive state + county from a place string. Prefer BIRTH (column is "Birth
    // state / county"); fall back to death. "Marshall, Harrison, Texas, United
    // States" -> state=Texas, county=Harrison (segment before the state).
    const parse = (place) => {
      if (!place) return { state: null, county: null };
      const segs = place.split(',').map(s => s.trim()).filter(s => s && !/United States|USA/i.test(s));
      let state = null;
      for (const st of states) { if (segs.includes(st) || place.includes(st)) { state = st; break; } }
      let county = null;
      const cs = segs.find(s => /\bCo\.?\b|County/i.test(s));
      if (cs) county = cs.replace(/\bCo\.?$/i, 'County').trim();
      else if (state) { const si = segs.indexOf(state); if (si >= 1) county = segs[si - 1]; }
      return { state, county };
    };
    // Derive state + county from ONE place as a unit (never mix a birth state
    // with a death county). Prefer the birth place; fall back to death.
    const bp = parse(out.birth_place), dp = parse(out.death_place);
    const primary = bp.state ? bp : dp.state ? dp : bp;
    out.state = primary.state;
    out.county = primary.county;
    return out;
  }, US_STATES);
}

async function upsert(fsId, p, known) {
  const existing = known.get(fsId);
  if (existing) {
    // Backfill: only set fields that are currently empty.
    await sql`
      UPDATE canonical_persons SET
        primary_state = COALESCE(primary_state, ${p.state || null}),
        primary_county = COALESCE(primary_county, ${p.county || null}),
        birth_year_estimate = COALESCE(birth_year_estimate, ${p.birth_year || null}),
        death_year_estimate = COALESCE(death_year_estimate, ${p.death_year || null}),
        updated_at = NOW()
      WHERE id = ${existing.cid}`;
    return (p.state || p.county) ? 'updated' : 'noplace';
  }
  if (!p.name) return 'skip';
  const parts = p.name.trim().split(/\s+/);
  const ins = await sql`
    INSERT INTO canonical_persons (
      canonical_name, first_name, last_name, birth_year_estimate, death_year_estimate,
      primary_state, primary_county, person_type, verification_status, confidence_score, created_by, notes
    ) VALUES (
      ${p.name}, ${parts[0]}, ${parts.length > 1 ? parts[parts.length - 1] : null},
      ${p.birth_year || null}, ${p.death_year || null}, ${p.state || null}, ${p.county || null},
      'descendant', 'familysearch_scraped', 0.9, 'climb_name_resolver',
      ${JSON.stringify({ familysearch_id: fsId, birth_place: p.birth_place, death_place: p.death_place,
                         resolved_from_session: SID, scraped_at: new Date().toISOString() })}
    ) RETURNING id`;
  const cid = ins[0].id;
  await sql`
    INSERT INTO person_external_ids (canonical_person_id, id_system, external_id, external_url, confidence, discovered_by, session_id)
    VALUES (${cid}, 'familysearch', ${fsId}, ${PERSON_URL + fsId}, 0.90, 'climb_name_resolver', ${SID}::uuid)
    ON CONFLICT (id_system, external_id) DO NOTHING`;
  return 'inserted';
}

function regenerate() {
  if (!REGEN) return;
  console.log('\nRegenerating worksheet…');
  try {
    const out = execFileSync('node', ['scripts/generate-ancestor-probate-worksheet.mjs', FS_ID, '--name', PARTICIPANT_LABEL],
      { encoding: 'utf8' });
    console.log(out.trim());
  } catch (e) { console.error('regen failed:', e.message); }
}

async function main() {
  const { visited, worklist, known } = await buildWorklist();
  const processed = loadProgress();
  const todo = worklist.filter(id => !processed.has(id));
  const batch = LIMIT > 0 ? todo.slice(0, LIMIT) : todo;

  console.log(`Session ${SID.slice(0, 8)} · ${visited.length} visited · ${worklist.length} need work · ${processed.size} already done`);
  console.log(`This run: ${batch.length} persons · headless=${HEADLESS}\n`);
  if (!batch.length) { console.log('Nothing to do.'); regenerate(); return; }

  const browser = await puppeteer.launch({ headless: HEADLESS ? 'new' : false, defaultViewport: null,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
  let page = await browser.newPage();
  await applyCookies(page);
  await ensureLogin(page);

  // Recycle the page every RECYCLE persons to cap memory over a long run.
  const RECYCLE = 250;
  const recyclePage = async () => {
    try { await page.close(); } catch {}
    page = await browser.newPage();
    await applyCookies(page);
  };

  const stats = { inserted: 0, updated: 0, noplace: 0, skip: 0, notfound: 0, err: 0 };
  let stop = false;
  process.on('SIGINT', () => { console.log('\n⏸ Ctrl-C — finishing current person, saving progress…'); stop = true; });

  for (let i = 0; i < batch.length && !stop; i++) {
    const fsId = batch[i];
    try {
      const p = await extractPerson(page, fsId);
      if (p.not_found) { stats.notfound++; }
      else {
        const r = await upsert(fsId, p, known);
        stats[r in stats ? r : 'skip']++;
        if ((i + 1) % 10 === 0 || r === 'inserted') {
          console.log(`[${i + 1}/${batch.length}] ${fsId}  ${r.padEnd(8)} ${p.name || (p.living ? '(living/hidden)' : '(no name)')}` +
            `${p.birth_year ? '  b.' + p.birth_year : ''}${p.state ? '  ' + (p.county ? p.county + ', ' : '') + p.state : ''}`);
        }
      }
    } catch (e) {
      stats.err++;
      const msg = e.message || '';
      if (/Login required|ident\.familysearch|\/auth\//.test(msg)) { console.error('✗ session expired — stopping. Re-run HEADLESS=0 to re-login.'); break; }
      if ((i + 1) % 10 === 0) console.error(`[${i + 1}] ${fsId} err: ${msg.slice(0, 60)}`);
    }
    processed.add(fsId);
    if ((i + 1) % 10 === 0) saveProgress(processed);
    if ((i + 1) % RECYCLE === 0) { saveProgress(processed); await recyclePage(); }
    await sleep(1400 + Math.floor((i % 7) * 180)); // polite, slightly varied
  }

  saveProgress(processed);
  await browser.close();
  console.log(`\n✓ Run done. inserted=${stats.inserted} updated=${stats.updated} skip=${stats.skip} not_found=${stats.notfound} err=${stats.err}`);
  console.log(`  Total processed across runs: ${processed.size}/${worklist.length}`);
  regenerate();
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
