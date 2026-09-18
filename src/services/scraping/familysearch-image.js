// familysearch-image.js — capture the REAL page image from the FamilySearch viewer.
//
// ISSUE #124. The FS viewer renders a page as TILED <img> elements: no <canvas>, no exposed
// OpenSeadragon. So element-grab and canvas.toDataURL() both fail, and callers fall back to
// `page.screenshot()` — a 1920x1200 viewport frame full of FS nav/index chrome, with the document
// reduced to a ~600x780 thumbnail.
//
// MEASURED 2026-09-17, which is why this file exists:
//   screenshot capture : 1920 x 1200  (~85-530 KB) — document is ~600x780 of that frame
//   Download button    : 3348 x 4522  (~650 KB)    — the actual scan
//   => 32x fewer pixels on the document (468,000 vs 15,139,656)
// That deficit — not the archive — is what produced the "~55% name-recall ceiling" the memory bank
// carried for months as a fact about the records. And when the FS session lapses, the screenshot
// silently captures the SIGN-IN PAGE: 10,879 documents were image-backed by one, across 359 real ARKs.
//
// So this module exists to make the correct capture the easy one. Extracted verbatim (behaviour
// unchanged) from pull-marquee-schedules.cjs, where it was proven, and where pull-bard-census.mjs had
// copy-pasted it — the two copies differed only in comments.
//
// Usage:
//   const { captureFamilySearchImage } = require('../services/scraping/familysearch-image');
//   const { imageBuffer, indexText, crumb, signedIn } = await captureFamilySearchImage(page, '/tmp/dl-x');
//   if (!signedIn) throw new Error('FS session lapsed — do NOT archive this capture');
//   if (!imageBuffer) { /* record a null finding; never fall back to page.screenshot() */ }
const fs = require('fs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Download the full-resolution page image via the viewer's Download button.
 *
 * @param {import('puppeteer').Page} page  already navigated to the ark: viewer URL
 * @param {string} dir                     a per-capture download directory (created by the caller)
 * @returns {Promise<{imageBuffer: Buffer|null, indexText: string, crumb: string, signedIn: boolean}>}
 *
 * `signedIn` is load-bearing: a lapsed session renders a sign-in page that screenshots perfectly well
 * and is worthless. ALWAYS check it before archiving. A null `imageBuffer` means the download did not
 * complete — record that as a finding; never substitute a screenshot.
 */
async function captureFamilySearchImage(page, dir) {
  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir }).catch(() => {});
  await sleep(9000); // viewer + index panel render
  const meta = await page.evaluate(() => {
    // Structured Image Index (every person on the page: Name / Sex / Age / Free-or-Enslaved).
    // Worth keeping: it is the pre-indexed volunteer transcription, and it is more reliable than OCR.
    let indexText = '';
    const nodes = Array.from(document.querySelectorAll('body *')).filter(el =>
      el.children.length < 40 && /free\s*or\s*enslaved|\bOwner\b|\bSlave\b/i.test(el.innerText || '') && (el.innerText || '').length < 20000);
    const cand = nodes.sort((a, b) => (b.innerText || '').length - (a.innerText || '').length)[0];
    if (cand) indexText = (cand.innerText || '').replace(/\s*\n\s*/g, ' | ').replace(/\s{2,}/g, ' ').trim().slice(0, 8000);
    const signInWall = /create a free account to view|sign in to view this image/i.test(document.body.innerText.slice(0, 4000));
    const crumb = (document.querySelector('nav, [class*="breadcrumb"]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 200);
    const clicked = (() => { const el = Array.from(document.querySelectorAll('button,[role=button],a')).find(e => /^download$/i.test((e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent || '').trim())); if (el) { el.click(); return true; } return false; })();
    return { indexText, signInWall, crumb, clicked };
  });
  // Poll the download dir for a COMPLETE file: size-stable across 1.2s and > 80 KB. The size floor
  // rejects partials and error pages; the stability check rejects an in-flight .crdownload.
  let imageBuffer = null;
  for (let i = 0; i < 24 && !imageBuffer; i++) {
    await sleep(1500);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /\.(jpe?g|png)$/i.test(f) && !/\.crdownload$/i.test(f)) : [];
    if (files.length) { const fp = dir + '/' + files[0]; const s1 = fs.statSync(fp).size; await sleep(1200); const s2 = fs.statSync(fp).size; if (s1 === s2 && s1 > 80000) imageBuffer = fs.readFileSync(fp); }
  }
  return { imageBuffer, indexText: meta.indexText, crumb: meta.crumb, signedIn: !meta.signInWall };
}

module.exports = { captureFamilySearchImage };
