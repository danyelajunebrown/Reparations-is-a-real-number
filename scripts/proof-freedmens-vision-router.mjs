// proof-freedmens-vision-router.mjs — STEP 0 of plan-freedmens-enslaver-reextraction.
// Take a depositor whose last_master was extracted by google_vision_ledger_extraction, re-fetch its form image
// via the FamilySearch ARK, OCR it with the vision-router (Qwen2.5-VL-72B), re-extract last_master with the
// freedmens registry, and print OLD (Vision) vs NEW (Qwen-VL) side by side. Validates the approach before scale.
// READ-ONLY (no DB writes). Needs FS Chrome on :9222 (logged in). Usage: node scripts/proof-freedmens-vision-router.mjs [--lead <id>]

import 'dotenv/config';
import { createRequire } from 'node:module';
import pg from 'pg';
const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer');
const { transcribeImage, VISION_MODEL } = require('../src/services/vision/vision-router');
const { REGISTRY } = require('../src/services/extraction/source-type-registry');

const LEAD = (() => { const i = process.argv.indexOf('--lead'); return i > -1 ? +process.argv[i + 1] : null; })();

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const dep = (await pool.query(
    `SELECT lead_id, full_name, source_url,
            (jsonb_path_query_first(relationships,'$[*] ? (@.type == "enslaved_by")')->>'name') AS old_master
       FROM unconfirmed_persons
      WHERE extraction_method IN ('freedmens_bank_index','freedmens_bank_ocr')
        AND relationships @> '[{"type":"enslaved_by"}]' AND source_url LIKE '%ark:/61903%'
        ${LEAD ? 'AND lead_id = ' + LEAD : ''}
      ORDER BY lead_id LIMIT 1`)).rows[0];
  if (!dep) { console.error('no annotated freedmens depositor found'); process.exit(1); }
  console.log(`depositor #${dep.lead_id} "${dep.full_name}"`);
  console.log(`  OLD last_master (google_vision): "${dep.old_master}"`);
  console.log(`  ARK: ${dep.source_url}`);

  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 2200, deviceScaleFactor: 2 });
  try {
    // 1. record detail → original-document (image viewer) link, detecting the login wall (reused selectors)
    await page.goto(`${dep.source_url}?lang=en`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 4000));
    const st = await page.evaluate(() => {
      const url = location.href;
      const orig = [...document.querySelectorAll('a')].find(a => /original|document/i.test(a.innerText || ''));
      return { url, loggedOut: /identity\/login/.test(url), origHref: orig ? orig.href : null };
    });
    if (st.loggedOut) { console.error('\n✗ FS SESSION EXPIRED (redirected to login) — re-login via VNC into the :9222 Chrome, then retry.'); process.exit(2); }
    if (!st.origHref) { console.error('\n✗ no original-document link on the record page (markup change or restricted image).'); process.exit(3); }

    // 2. image viewer → zoom a little → screenshot
    await page.goto(st.origHref.replace(/([?&])view=index(&|$)/, (m, a, b) => b ? a : ''), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 6000));
    for (let z = 0; z < 3; z++) { try { await page.click('button[aria-label="Zoom In"]', { timeout: 1500 }); await new Promise(r => setTimeout(r, 700)); } catch { break; } }
    const shot = await page.screenshot({ encoding: 'binary' });
    console.log(`  captured form image: ${(shot.length / 1024 | 0)}KB → OCR with ${VISION_MODEL}…`);

    // 3. OCR with the vision-router (Qwen-VL) + 4. re-extract via the freedmens registry
    const ocr = (await transcribeImage(shot, { mimeType: 'image/png' }) || '').trim();
    console.log(`  Qwen-VL OCR: ${ocr.length} chars`);
    if (ocr.length < 40) { console.error('✗ OCR returned almost nothing — the viewer may not have rendered; retry or check the image.'); process.exit(4); }
    const fields = await REGISTRY.freedmens.extract(ocr);

    console.log(`\n===== RESULT =====`);
    console.log(`  depositor (OCR)     : ${fields.depositor_name || '(none)'}   [db: ${dep.full_name}]`);
    console.log(`  NEW last_master     : "${fields.last_master || fields.last_mistress || '(none)'}"`);
    console.log(`  OLD last_master     : "${dep.old_master}"`);
    console.log(`  plantation/residence: ${fields.plantation || '-'} / ${fields.slave_residence || fields.residence || '-'}`);
    console.log(`\n  OCR excerpt: ${JSON.stringify(ocr.slice(0, 400))}`);
  } finally { await page.close(); await browser.disconnect(); await pool.end(); }
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
