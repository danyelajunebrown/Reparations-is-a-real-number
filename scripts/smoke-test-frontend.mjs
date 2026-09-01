// smoke-test-frontend.mjs — runtime guardrail for the React frontend.
//
// Loads every main route in a headless browser at a PHONE viewport (390px, the
// phone-first mandate) and FAILS on: page JS exceptions, non-benign console errors,
// the OpenSeadragon "Error creating texture in WebGL" regression, or a document
// viewer that renders no <canvas>. This is the check that `vite build` can't do —
// the WebGL bug (fixed in 22d50268d) is exactly what it catches. Free; read-only.
//
// Run (any machine with a browser puppeteer can drive):
//   node scripts/smoke-test-frontend.mjs                      # headless launch, deployed site
//   BASE_URL=http://localhost:4173/Reparations-is-a-real-number node scripts/smoke-test-frontend.mjs   # vite preview
//   CHROME_URL=http://127.0.0.1:9222 node scripts/smoke-test-frontend.mjs   # CONNECT (Intel Mac Mini — launch crashes there per CLAUDE.md)
//
// Best in CI (Linux) or Apple Silicon where puppeteer.launch works; on the Intel
// Mini, start Chrome with --remote-debugging-port=9222 and pass CHROME_URL.
// Exit code 0 = all clean, 1 = at least one route had an issue.

import puppeteer from 'puppeteer';

const BASE = (process.env.BASE_URL || 'https://danyelajunebrown.github.io/Reparations-is-a-real-number/').replace(/\/+$/, '');
const CONNECT = process.env.CHROME_URL || process.env.PUPPETEER_WS || null;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Routes to smoke (path + a selector proving the SPA mounted). The person route
// also exercises the zoomable document viewer.
const ROUTES = [
  { path: '/' },
  { path: '/search?q=ward' },
  { path: '/ask' },
  { path: '/depositors' },
  { path: '/lineage' },
  { path: '/documents' },
  { path: '/corporate' },
  { path: '/legal' },
  { path: '/pay' },
  { path: '/contribute/will' },
  { path: '/person/canonical_persons/828471', docViewer: true }, // Joshua Ward — served scan
];
const MOUNTED = '.app-nav'; // rendered by App on every route

// Console noise that is NOT an app bug: favicon, and the GitHub-Pages SPA 404 that
// fires on a hard-loaded deep route (404.html redirects and the page recovers).
const BENIGN = [/favicon/i, /status of 404/i, /Failed to load resource/i, /net::ERR_ABORTED/i, /ERR_BLOCKED_BY_CLIENT/i];
const isBenign = t => BENIGN.some(re => re.test(t));

function watch(page, issues) {
  page.on('console', m => {
    const x = m.text();
    if (/error creating texture|webgl/i.test(x)) issues.push('WEBGL: ' + x);
    else if (m.type() === 'error' && !isBenign(x)) issues.push('console.error: ' + x);
  });
  page.on('pageerror', e => issues.push('pageerror: ' + e.message));
}

async function testDocViewer(page, issues) {
  // Wait for a document open control (in the Primary OR Secondary source section) —
  // the docs load async from Render, which can be slow on cold-start.
  const hasControl = () => {
    const sec = [...document.querySelectorAll('section')]
      .find(s => /source/i.test(s.querySelector('h2')?.textContent || '') && s.querySelector('button.box, a.box'));
    return !!(sec && sec.querySelector('button.box, a.box'));
  };
  try {
    await page.waitForFunction(hasControl, { timeout: 25000 });
  } catch {
    issues.push('docViewer: no document open control appeared within 25s');
    return;
  }
  const clicked = await page.evaluate(() => {
    const sec = [...document.querySelectorAll('section')]
      .find(s => /source/i.test(s.querySelector('h2')?.textContent || '') && s.querySelector('button.box, a.box'));
    const b = sec && sec.querySelector('button.box, a.box');
    if (b) { b.click(); return true; }
    return false;
  });
  if (!clicked) { issues.push('docViewer: open control vanished before click'); return; }
  // OpenSeadragon lazy-loads its chunk then initialises + draws a <canvas>.
  try {
    await page.waitForSelector('canvas', { timeout: 15000 });
  } catch {
    issues.push('docViewer: no <canvas> after opening the scan (OSD failed to render)');
  }
}

async function main() {
  console.log(`Frontend smoke test — ${BASE}  (viewport 390px, ${CONNECT ? 'connect ' + CONNECT : 'headless launch'})\n`);
  const browser = CONNECT
    ? await puppeteer.connect({ browserURL: CONNECT, defaultViewport: { width: 390, height: 844, isMobile: true } })
    : await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'], defaultViewport: { width: 390, height: 844, isMobile: true } });

  const results = [];
  for (const r of ROUTES) {
    const page = await browser.newPage();
    const issues = [];
    watch(page, issues);
    try {
      await page.goto(BASE + r.path, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForSelector(MOUNTED, { timeout: 20000 });
      await sleep(1500); // let lazy route chunks + first data settle
      if (r.docViewer) await testDocViewer(page, issues);
    } catch (e) {
      issues.push('nav/load: ' + e.message);
    }
    await page.close().catch(() => {});
    results.push({ path: r.path, issues });
  }

  if (CONNECT) await browser.disconnect(); else await browser.close();

  let fail = 0;
  for (const r of results) {
    if (r.issues.length) { fail++; console.log(`❌ ${r.path}`); r.issues.forEach(i => console.log('     ' + i)); }
    else console.log(`✅ ${r.path}`);
  }
  console.log(`\n${results.length - fail}/${results.length} routes clean`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(2); });
