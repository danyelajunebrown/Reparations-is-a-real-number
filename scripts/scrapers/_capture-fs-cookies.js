// Capture the live FamilySearch cookie jar from the running Chrome on :9222
// and write it in puppeteer page.setCookie() format for FAMILYSEARCH_COOKIES.
const puppeteer = require('puppeteer-extra');
const fs = require('fs');
const path = require('path');
// Default to the repo's tmp/ — the SAME path the scraper injects from
// (georgia-probate-scraper.js reads <repo>/tmp/familysearch-cookies.json). Writing
// to /tmp/ instead meant a "fresh" capture silently never reached the scraper, so a
// stale jar kept clobbering the live session on every launch (the NY index-wall).
const OUT = process.argv[2] || path.resolve(__dirname, '../../tmp/familysearch-cookies.json');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  const pages = await browser.pages();
  const page = pages.find(p => /familysearch\.org/.test(p.url())) || pages[0] || (await browser.newPage());
  const client = await page.target().createCDPSession();
  const { cookies } = await client.send('Network.getAllCookies');
  const valid = new Set(['Strict', 'Lax', 'None']);
  const jar = cookies
    .filter(c => /familysearch\.org$/.test((c.domain || '').replace(/^\./, '')))
    .map(c => {
      const o = {
        name: c.name, value: c.value, domain: c.domain, path: c.path || '/',
        httpOnly: !!c.httpOnly, secure: !!c.secure,
      };
      if (typeof c.expires === 'number' && c.expires > 0) o.expires = c.expires;
      if (valid.has(c.sameSite)) o.sameSite = c.sameSite;
      return o;
    });
  fs.writeFileSync(OUT, JSON.stringify(jar, null, 2));
  const session = jar.find(c => /fssession/i.test(c.name));
  console.log(`Wrote ${jar.length} familysearch cookies to ${OUT}`);
  console.log('fssessionid present:', !!session,
    session && session.expires ? 'expires=' + new Date(session.expires * 1000).toISOString() : '(session cookie / no expiry)');
  await browser.disconnect();
  process.exit(0);
})().catch(e => { console.error('CAPTURE_ERROR', e.message); process.exit(1); });
