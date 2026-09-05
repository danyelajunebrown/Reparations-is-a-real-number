// enumerate-fs-counties-by-click.mjs — recover the counties the FamilySearch waypoint API refuses to return,
// by reading the browse UI's own React fiber props.
//
// WHY THIS EXISTS. The recapi waypoint endpoint returns AT MOST 100 children per parent and honours no
// paging parameter (count/pageSize/start — byte-identical responses). Four states exceed 100 counties and
// every one was truncated alphabetically:
//     Virginia 147/100 (47 missing from Petersburg) · Georgia 132/100 (32 from Randolph)
//     Missouri 113/100 (13 from St Francois)        · Kentucky 108/100 (8 from Trimble)
// The crawler was never at fault; it stored everything the API gave it. Re-running that endpoint can never
// recover these.
//
// THE UI KNOWS WHAT THE API WILL NOT SAY. Each county <li> has no href and does not respond to a click, but
// React keeps the destination on the fiber node as props.children.props.to —
//     {"children":{"props":{"to":"/search/image/index?owc=8BZB-T38%3A1610312301%2C1610316501",
//      "linkName":"Select Level","children":"Sussex"}}}
// So Sussex is 8BZB-T38:1610312301,1610316501, and every county carries its own. ONE DOM read, no clicking.
//
// ── 2026-09-04: THREE DEFECTS THAT MADE THIS REPORT SUCCESS OVER A GAP IT HAD NOT CLOSED ────────────────
// The first version announced "0 still missing (was 100)" while 41 counties were still absent — 61 of 100
// recovered. Diffing the live table against memory-bank/reference-data/ found VA 4 · GA 22 · MO 8 · KY 7
// still missing, every one of them at the ALPHABETICAL TAIL. Causes, all three fixed below:
//
//   1. THE DENOMINATOR WAS THE PAGE. `missing` was computed from a page innerText scrape, then
//      `if (!missing.length) exit(0)` printed completion. When the list renders short, `missing` shrinks and
//      the script congratulates itself. This is the SAME self-confirming-metric defect the reference-data
//      files were committed to fix — the files existed and this script never opened them. It now diffs
//      against reference-data/<state>.txt, an external denominator we did not generate, and it FAILS LOUDLY
//      (non-zero exit) when the page renders fewer counties than the list names.
//   2. THE LIST IS VIRTUALIZED. A single read only sees what is currently rendered — which is why Georgia
//      yielded 10 of its 32. It now scrolls and re-reads until the readable set stops growing.
//   3. THE STATE WAYPOINT WAS HAND-FED. --wp had to be supplied per state and the PREFIX is the identity
//      (the numeric path is discarded by FS), so a wrong prefix silently returns the wrong state's children
//      — that is how "Virginia has 54 counties" was once believed. States are now resolved from the
//      COLLECTION ROOT page by the same fiber read, so there is nothing left to guess.
//
// Usage:
//   node scripts/enumerate-fs-counties-by-click.mjs --state Virginia            # dry run
//   node scripts/enumerate-fs-counties-by-click.mjs --state all --apply         # all four gap states
//   node scripts/enumerate-fs-counties-by-click.mjs --state Alabama --cc 1420440 --apply   # 1850
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import puppeteer from 'puppeteer';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REFDIR = path.join(HERE, '..', 'memory-bank', 'reference-data');

const A = process.argv.slice(2);
const val = (f, d) => { const i = A.indexOf(f); return i > -1 ? A[i + 1] : d; };
const APPLY = A.includes('--apply');
const CC = val('--cc', '3161105');
const GAP_MS = +val('--gap-ms', 1200);
const STATE_ARG = val('--state', 'all');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The four states the API truncated. --state all means these; any other value is taken literally.
const GAP_STATES = ['Virginia', 'Georgia', 'Missouri', 'Kentucky'];
const STATES = STATE_ARG.toLowerCase() === 'all' ? GAP_STATES : [STATE_ARG];

// Name normalisation. The DB holds "Richmond County" where the list says "Richmond", and FS writes
// "St Louis" for "St. Louis". Comparing raw strings invents gaps and hides real ones in equal measure.
const norm = (s) => (s || '').toLowerCase()
  .replace(/\b(county|co\.?|city|parish)\b/g, '').replace(/[^a-z]/g, '');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false },
  statement_timeout: 300000, query_timeout: 300000 });
pool.on('error', (e) => console.error(`[pool] ${e.message}`));

// Read every <li>'s React fiber destination. Used for BOTH levels: states off the collection root, counties
// off a state page. Same DOM shape, so the state waypoint never has to be supplied or derived by hand.
const FIBER_READ = () => {
  const out = [];
  for (const li of document.querySelectorAll('li')) {
    const key = Object.keys(li).find((k) => k.startsWith('__reactFiber') || k.startsWith('__reactProps'));
    if (!key) continue;
    const node = li[key];
    const props = node && (node.memoizedProps || node.pendingProps || node);
    const child = props && props.children;
    const to = child && child.props && child.props.to;
    const label = child && child.props && child.props.children;
    if (typeof to === 'string' && typeof label === 'string') {
      out.push({ name: label.replace(/\s+/g, ' ').trim(), to });
    }
  }
  return out;
};

const waypointOf = (to) => {
  const owc = decodeURIComponent((to.match(/owc=([^&]+)/) || [])[1] || '');
  return (owc.match(/^([A-Z0-9-]+:[\d,]+)/) || [])[1] || null;
};

const browseUrl = (wp) => (wp
  ? `https://www.familysearch.org/en/search/image/index?owc=${encodeURIComponent(wp + '?cc=' + CC)}&cc=${CC}`
  : `https://www.familysearch.org/en/search/image/index?cc=${CC}`);

// Read a browse page to exhaustion. The list is virtualized: one read sees only what is rendered, which is
// how Georgia returned 10 of 32. Scroll and re-read until the set stops growing for two consecutive passes.
async function readAllEntries(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(15000);
  const seen = new Map();
  let stable = 0;
  for (let pass = 0; pass < 40 && stable < 2; pass++) {
    const before = seen.size;
    for (const e of await page.evaluate(FIBER_READ)) if (!seen.has(e.name)) seen.set(e.name, e.to);
    stable = seen.size === before ? stable + 1 : 0;
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.9));
    await sleep(900);
  }
  return [...seen].map(([name, to]) => ({ name, to }));
}

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1100 });

// LEVEL 1 — states, off the collection root. No --wp, nothing to mistype.
console.log(`${APPLY ? '=== APPLY ===' : '=== DRY RUN ==='} collection ${CC} · states: ${STATES.join(', ')}`);
const stateEntries = await readAllEntries(page, browseUrl(null));
console.log(`collection root lists ${stateEntries.length} states`);
const stateWp = new Map(stateEntries.map((e) => [norm(e.name), waypointOf(e.to)]));

let exitCode = 0;
const summary = [];

for (const STATE of STATES) {
  console.log(`\n──────── ${STATE} ────────`);
  const wp = stateWp.get(norm(STATE));
  if (!wp) { console.log(`  ✗ no state waypoint on the root page — skipping`); exitCode = 1; continue; }
  console.log(`  state waypoint: ${wp}`);

  // THE EXTERNAL DENOMINATOR. Absent it, refuse to measure rather than measure against ourselves.
  const refFile = path.join(REFDIR, `${STATE.toLowerCase().replace(/\s+/g, '-')}.txt`);
  if (!fs.existsSync(refFile)) {
    console.log(`  ✗ no reference list at ${path.relative(process.cwd(), refFile)} — REFUSING to report`);
    console.log(`    (a coverage number without an external denominator is not a coverage number)`);
    exitCode = 1; continue;
  }
  const listed = fs.readFileSync(refFile, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);

  const have = new Set((await pool.query(
    'SELECT DISTINCT county FROM familysearch_locations WHERE state=$1 AND collection_id=$2',
    [STATE, CC])).rows.map((r) => norm(r.county)));
  const missing = listed.filter((c) => !have.has(norm(c)));
  console.log(`  listed ${listed.length} · hold ${have.size} · MISSING ${missing.length}`);
  if (missing.length) console.log(`  ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ' …' : ''}`);
  if (!missing.length) { summary.push({ state: STATE, listed: listed.length, missing: 0, recovered: 0, unreadable: 0 }); continue; }

  const found = await readAllEntries(page, browseUrl(wp));
  const foundN = new Map(found.map((f) => [norm(f.name), f]));
  console.log(`  waypoints readable from the DOM: ${found.length}`);

  // The check the old version could not make: did the PAGE cover the LIST? If not, say so — do not let a
  // short render read as a closed gap.
  const unreadable = missing.filter((c) => !foundN.has(norm(c)));
  if (unreadable.length) {
    console.log(`  ⚠️  ${unreadable.length} listed counties DID NOT RENDER: ${unreadable.join(', ')}`);
    exitCode = 1;
  }

  let got = 0, failed = 0;
  for (const c of missing) {
    const f = foundN.get(norm(c));
    if (!f) continue;
    const id = waypointOf(f.to);
    if (!id) { failed++; console.log(`  ✗ ${c}: no waypoint in props`); continue; }
    if (!APPLY) { console.log(`  (dry) ${c} → ${id}`); got++; continue; }
    try {
      await pool.query(
        `INSERT INTO familysearch_locations (collection_id, state, county, district, waypoint_id, waypoint_url, collection_type)
         SELECT $1::text,$2::text,$3::text,$3::text,$4::text,$5::text,$6::text
          WHERE NOT EXISTS (SELECT 1 FROM familysearch_locations f
             WHERE f.collection_id=$1::text AND f.state=$2::text AND f.county=$3::text)`,
        [CC, STATE, f.name, id, `https://www.familysearch.org/service/cds/recapi/waypoints/${id}?cc=${CC}`,
         CC === '1420440' ? 'slave_schedule_1850' : 'slave_schedule_1860']);
      got++;
      console.log(`  ✅ ${f.name} → ${id}`);
    } catch (e) { failed++; console.log(`  ✗ ${f.name}: ${e.message.slice(0, 60)}`); }
    await sleep(GAP_MS / 4);
  }
  summary.push({ state: STATE, listed: listed.length, missing: missing.length, recovered: got, unreadable: unreadable.length });
  if (failed) exitCode = 1;
}

console.log('\n=== SUMMARY ===');
console.table(summary);
const stillOpen = summary.reduce((n, s) => n + (s.missing - s.recovered), 0);
console.log(stillOpen === 0
  ? (APPLY ? 'gap closed for the states measured' : 'dry run — pass --apply to record')
  : `⚠️  ${stillOpen} counties STILL MISSING after this pass — the gap is NOT closed`);
if (stillOpen > 0) exitCode = 1;

try { await page.close(); } catch {}
await browser.disconnect();   // BORROWED session — never browser.close(), that logs the whole Mini out of FS
await pool.end();
process.exit(exitCode);
