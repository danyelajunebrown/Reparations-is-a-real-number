import 'dotenv/config';
import puppeteer from 'puppeteer';
const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
const p = await b.newPage();
await p.setViewport({ width: 1500, height: 1100 });
await p.goto('https://www.familysearch.org/en/search/image/index?owc=8BZB-6TL%3A1610312301%3Fcc%3D3161105&cc=3161105',
  { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 18000));
await p.screenshot({ path: '/tmp/va_browse.png', fullPage: false });
// what IS on the page?
let info = {};
try {
  info = await p.evaluate(() => {
    const txt = document.body.innerText || '';
    return { chars: txt.length, head: txt.slice(0, 400),
             sussex: /sussex/i.test(txt), bath: /bath/i.test(txt),
             links: document.querySelectorAll('a').length,
             lists: document.querySelectorAll('ul,ol,table,[role=list]').length };
  });
} catch (e) { info = { err: e.message.slice(0, 60) }; }
console.log('  ' + JSON.stringify(info).slice(0, 500));
try { await p.close(); } catch {}
await b.disconnect();
