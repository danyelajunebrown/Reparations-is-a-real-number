// One-off probe: connect to the already-logged-in Chrome on :9222 and list the
// county link texts on the New York probate (collection 1920234) waypoints page.
// Confirms the generic scraper's Phase-0 selector will find NY counties.
const puppeteer = require('puppeteer-extra');
const COLLECTION_ID = process.argv[2] || '1920234';
const WAYPOINTS_URL = `https://www.familysearch.org/search/image/index?owc=${encodeURIComponent('https://www.familysearch.org/platform/records/collections/' + COLLECTION_ID + '/waypoints')}`;

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null });
  const page = await browser.newPage();
  console.log('Navigating:', WAYPOINTS_URL);
  await page.goto(WAYPOINTS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 6000));
  const counties = await page.evaluate(() => {
    const out = [];
    for (const link of Array.from(document.querySelectorAll('a[href*="owc="]'))) {
      const href = link.href || '';
      if (!href.includes('familysearch.org')) continue;
      const m = href.match(/[?&]owc=([^&]+)/);
      if (!m) continue;
      const parts = decodeURIComponent(m[1]).replace(/\?.*$/, '').split(':');
      if (parts.length < 2) continue;
      const name = (link.textContent || '').trim();
      if (parts[0].trim() && parts[1].trim() && name) out.push(name);
    }
    return out;
  });
  console.log(`Found ${counties.length} county entries.`);
  console.log(counties.slice(0, 80).join('\n'));
  const bodySnippet = await page.evaluate(() => (document.body.innerText || '').slice(0, 300));
  if (counties.length === 0) console.log('--- body snippet ---\n' + bodySnippet);
  await page.close();
  await browser.disconnect();
  process.exit(0);
})().catch(e => { console.error('PROBE_ERROR', e.message); process.exit(1); });
