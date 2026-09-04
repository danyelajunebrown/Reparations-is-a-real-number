// enumerate-fs-counties-by-click.mjs — recover the counties the FamilySearch waypoint API refuses to return,
// by DRIVING THE BROWSE UI the way a person would.
//
// WHY THIS EXISTS. The recapi waypoint endpoint returns AT MOST 100 children per parent and honours no
// paging parameter (count/pageSize/start — byte-identical responses). Verified against Virginia's REAL
// state waypoint (8BZB-6TL:1610312301, taken from the operator's own browser): 101 children, Bath present,
// Sussex absent. Four states exceed 100 counties and every one was truncated alphabetically:
//     Virginia 147/100 (47 missing from Petersburg) · Georgia 132/100 (32 from Randolph)
//     Missouri 113/100 (13 from St Francois)        · Kentucky 108/100 (8 from Trimble)
// ~440 leaf pages, ~8% of the corpus — including Sussex, Southampton, Surry, Westmoreland, York, St Louis.
// The crawler was never at fault; it stored everything the API gave it. Re-running that endpoint can never
// recover these.
//
// THE UI KNOWS WHAT THE API WILL NOT SAY. The browse page renders all 147 county names client-side. So we
// stop asking the API for a list it caps, and instead click each county and read the waypoint out of the
// resulting URL — which is exactly how a researcher reaches Sussex today.
//
// A NOTE ON WHY THIS TOOK SO LONG TO FIND: I first derived Virginia's state waypoint by dropping a segment
// off a COUNTY url, which kept the county's prefix with the state's path. The prefix changes at every level
// (8BZB-6TL state → 815Q-L29 Bath → 815Q-GP8 district), so that handle was wrong and returned 54 children.
// I read 54 as "this state has 54 counties" rather than "this waypoint is wrong", and built a cap theory on
// top of it. The operator supplying three real URLs is what corrected it.
//
// Usage:
//   node scripts/enumerate-fs-counties-by-click.mjs --state Virginia --wp 8BZB-6TL:1610312301
//   node scripts/enumerate-fs-counties-by-click.mjs --state Virginia --wp ... --apply
import 'dotenv/config';
import pg from 'pg';
import puppeteer from 'puppeteer';

const A = process.argv.slice(2);
const val = (f, d) => { const i = A.indexOf(f); return i > -1 ? A[i + 1] : d; };
const APPLY = A.includes('--apply');
const STATE = val('--state', 'Virginia');
const WP = val('--wp', '8BZB-6TL:1610312301');
const CC = val('--cc', '3161105');
const GAP_MS = +val('--gap-ms', 1200);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false },
  statement_timeout: 300000, query_timeout: 300000 });
pool.on('error', (e) => console.error(`[pool] ${e.message}`));

const have = new Set((await pool.query(
  'SELECT DISTINCT county FROM familysearch_locations WHERE state=$1', [STATE])).rows.map((r) => r.county));
console.log(`${APPLY ? '=== APPLY ===' : '=== DRY RUN ==='} ${STATE} · already hold ${have.size} counties`);

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1100 });
const BROWSE = `https://www.familysearch.org/en/search/image/index?owc=${encodeURIComponent(WP + '?cc=' + CC)}&cc=${CC}`;

await page.goto(BROWSE, { waitUntil: 'domcontentloaded', timeout: 90000 });
await sleep(15000);

// The county list renders client-side; read the NAMES, then click each by name.
const counties = await page.evaluate(() => {
  const t = document.body.innerText || '';
  const i = t.indexOf('County');
  if (i < 0) return [];
  return t.slice(i + 6).split('\n').map((s) => s.trim())
    .filter((s) => s && s.length < 40 && /^[A-Z]/.test(s) && !/^(SKIP|Family|Search|Memories|Get|Activities|Records|Full|Images|Genealogies|Catalog|Books|Wiki|Image)/.test(s));
});
console.log(`  county names rendered in the UI: ${counties.length}`);
const missing = counties.filter((c) => !have.has(c));
console.log(`  MISSING from our enumeration: ${missing.length}`);
console.log(`  ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ' …' : ''}`);
if (!missing.length || !APPLY) {
  if (!APPLY) console.log('\n(dry run — pass --apply to click through and record waypoints)');
  try { await page.close(); } catch {} await browser.disconnect(); await pool.end(); process.exit(0);
}

// READ THE WAYPOINTS OUT OF THE DOM — no clicking at all.
// The county entries are bare <li> with no href, and neither a synthetic .click() nor a real mouse click
// changes the URL (the app routes internally). But the link IS in the page: React keeps it on the fiber
// node attached to each <li>, as props.children.props.to —
//     {"children":{"props":{"to":"/search/image/index?owc=8BZB-T38%3A1610312301%2C1610316501...",
//      "linkName":"Select Level","children":"Sussex"}}}
// So Sussex is 8BZB-T38:1610312301,1610316501, and every county on the page carries its own. This replaces
// 100 clicks (and a captcha-gated click-through that never worked) with ONE read.
const found = await page.evaluate(() => {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const out = [];
  for (const li of document.querySelectorAll('li')) {
    const key = Object.keys(li).find((k) => k.startsWith('__reactFiber') || k.startsWith('__reactProps'));
    if (!key) continue;
    let node = li[key];
    const props = node && (node.memoizedProps || node.pendingProps || node);
    const child = props && props.children;
    const to = child && child.props && child.props.to;
    const label = child && child.props && child.props.children;
    if (typeof to === 'string' && typeof label === 'string') out.push({ name: norm(label), to });
  }
  return out;
});
console.log(`  waypoints readable from the DOM: ${found.length}`);

let got = 0, failed = 0;
for (const f of found) {
  if (!missing.includes(f.name)) continue;
  const owc = decodeURIComponent((f.to.match(/owc=([^&]+)/) || [])[1] || '');
  const id = (owc.match(/^([A-Z0-9-]+:[\d,]+)/) || [])[1];
  if (!id) { failed++; console.log(`  ✗ ${f.name}: no waypoint in props`); continue; }
  try {
    await pool.query(
      `INSERT INTO familysearch_locations (collection_id, state, county, district, waypoint_id, waypoint_url, collection_type)
       SELECT $1::text,$2::text,$3::text,$3::text,$4::text,$5::text,'slave_schedule_1860'
        WHERE NOT EXISTS (SELECT 1 FROM familysearch_locations f
           WHERE f.collection_id=$1::text AND f.state=$2::text AND f.county=$3::text)`,
      [CC, STATE, f.name, id, `https://www.familysearch.org/service/cds/recapi/waypoints/${id}?cc=${CC}`]);
    got++;
    console.log(`  ✅ ${f.name} → ${id}`);
  } catch (e) { failed++; console.log(`  ✗ ${f.name}: ${e.message.slice(0, 60)}`); }
}

console.log(`\n=== recovered ${got} counties · ${failed} failed ===`);
try { await page.close(); } catch {}
await browser.disconnect(); await pool.end();
