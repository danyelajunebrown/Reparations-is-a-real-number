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

let got = 0, failed = 0;
for (const name of missing) {
  // A FRESH PAGE PER COUNTY. Reusing one page and navigating back to the browse view each iteration threw
  // "Attempted to use detached Frame" on all 48 — FamilySearch's SPA detaches the frame on re-navigation,
  // and once detached the page is poisoned for every county after it. Exactly the failure that killed 4 of
  // 5 depositors in the Freedmen's extractor. Closed in `finally` so this cannot become the tab leak that
  // made the Mini unusable twice.
  let pg = null;
  try {
    pg = await browser.newPage();
    await pg.setViewport({ width: 1500, height: 1100 });
    await pg.goto(BROWSE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(6000);
    const clicked = await pg.evaluate((n) => {
      const el = [...document.querySelectorAll('a,button,[role=link],[role=button],li,td')]
        .find((e) => (e.innerText || '').trim() === n);
      if (!el) return false; el.click(); return true;
    }, name);
    if (!clicked) { failed++; console.log(`  ✗ ${name}: not clickable`); continue; }
    await sleep(5000);
    const u = pg.url();
    const wp = decodeURIComponent((u.match(/owc=([^&]+)/) || [])[1] || '');
    const id = (wp.match(/^([A-Z0-9-]+:[\d,]+)/) || [])[1];
    if (!id) { failed++; console.log(`  ✗ ${name}: no waypoint in url`); continue; }
    await pool.query(
      `INSERT INTO familysearch_locations (collection_id, state, county, district, waypoint_id, waypoint_url, collection_type)
       SELECT $1::text,$2::text,$3::text,$3::text,$4::text,$5::text,'slave_schedule_1860'
        WHERE NOT EXISTS (SELECT 1 FROM familysearch_locations f
           WHERE f.collection_id=$1::text AND f.state=$2::text AND f.county=$3::text)`,
      [CC, STATE, name, id, `https://www.familysearch.org/service/cds/recapi/waypoints/${id}?cc=${CC}`]);
    got++;
    console.log(`  ✅ ${name} → ${id}`);
  } catch (e) { failed++; console.log(`  ✗ ${name}: ${e.message.slice(0, 60)}`); }
  finally { try { if (pg && !pg.isClosed()) await pg.close(); } catch (_) {} }
  await sleep(GAP_MS);
}

console.log(`\n=== recovered ${got} counties · ${failed} failed ===`);
try { await page.close(); } catch {}
await browser.disconnect(); await pool.end();
