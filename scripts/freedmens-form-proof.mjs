// freedmens-form-proof.mjs — STEP 0 of plan-freedmens-enslaver-reextraction: prove the vision-router beats
// the old Google-Vision names on ONE form before building anything for 415,000.
//
// WHY THIS GATE EXISTS (the plan is explicit): "If Qwen-VL doesn't clearly beat the old name on these
// specific forms, stop and rethink." The Freedmen's Bank depositor naming their former enslaver is one of
// the highest-value links in the project — it crosses 1870 AND joins the two classes in one row — which is
// exactly why it must not be built on an unvalidated OCR assumption.
//
// WHAT THE OLD EXTRACTION PRODUCED (google_vision_ledger_extraction, 1,105 of 416,520 depositors):
//     James Greene   -> "Application Hilleder Pollard Halli"   (form text bleeding into the field)
//     Mingo Steele   -> "Application, Och 8th Lives on hurc"   (form text)
//     Jack Lancaster -> "Jack Lancaster"                       (the DEPOSITOR'S OWN NAME)
//     Eugene Bacon   -> "Eugen Beson"                          (depositor's name, garbled)
// That last class is worse than noise: it would mint an enslaved person as their own enslaver. The plan's
// instruction — "Promoting the JSONB as-is would mint hundreds of fake enslavers — do NOT" — is why this
// script only READS.
//
// WRITES NOTHING. Fetches one form image, OCRs it with the vision-router, prints both readings side by side.
//
// Usage: node scripts/freedmens-form-proof.mjs --lead 2382644
import 'dotenv/config';
import { createRequire } from 'node:module';
import pg from 'pg';
import puppeteer from 'puppeteer';

const require = createRequire(import.meta.url);
const { transcribeImage } = require('../src/services/vision/vision-router');
const sharp = require('sharp');

const A = process.argv.slice(2);
const val = (f, d) => { const i = A.indexOf(f); return i > -1 ? A[i + 1] : d; };
const LEAD = +val('--lead', 2382644);
const LEVEL = +val('--level', 11);
const PORT = val('--port', '9222');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false },
  statement_timeout: 120000 });
pool.on('error', (e) => console.error(`[pool] ${e.message}`));

const row = (await pool.query(
  `SELECT lead_id, full_name, source_url,
          jsonb_path_query_first(relationships,'$[*] ? (@.type == "enslaved_by")')->>'name' AS old_master
     FROM unconfirmed_persons WHERE lead_id = $1`, [LEAD])).rows[0];
if (!row) { console.error(`no lead ${LEAD}`); process.exit(1); }
console.log(`  depositor      : ${row.full_name}`);
console.log(`  record ark     : ${row.source_url}`);
console.log(`  OLD last_master: "${row.old_master}"   <- google_vision_ledger_extraction`);

const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null })
  .catch((e) => { console.error(`  no authenticated Chrome on :${PORT} — ${e.message}`); process.exit(1); });
const page = await browser.newPage();

// A 1:1: RECORD ark is an index page; the form IMAGE is a 3:1: ark linked from it.
await page.goto(row.source_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(6000);
const imageArk = await page.evaluate(() => {
  const a = [...document.querySelectorAll('a[href*="ark:/61903/3:1:"]')].map((x) => x.href);
  const m = document.body.innerHTML.match(/ark:\/61903\/(3:1:[A-Z0-9-]+)/i);
  return a[0] || (m ? `https://www.familysearch.org/ark:/61903/${m[1]}` : null);
});
console.log(`  form image ark : ${imageArk || '(none found on the record page)'}`);
if (!imageArk) { console.log('  → this record serves no image; the enslaver cannot be re-read from a scan.'); await page.close(); await browser.disconnect(); await pool.end(); process.exit(2); }

const ark = (imageArk.match(/(3:1:[A-Z0-9-]+)/i) || [])[1];
const base = `https://sg30p0.familysearch.org/service/records/storage/deepzoomcloud/dz/v1/${ark}/image_files/${LEVEL}`;
const tile = async (u) => { try { const r = await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 30000 });
  return r && r.status() === 200 ? await r.buffer() : null; } catch { return null; } };

const first = await tile(`${base}/0_0.jpg`);
if (!first) { console.log('  → no tiles at this zoom level (not permitted, or a different viewer).'); await page.close(); await browser.disconnect(); await pool.end(); process.exit(2); }
let cols = 1, rows = 1;
for (let c = 1; c < 16; c++) { if (!(await tile(`${base}/${c}_0.jpg`))) break; cols++; }
for (let r = 1; r < 16; r++) { if (!(await tile(`${base}/0_${r}.jpg`))) break; rows++; }
const meta = await sharp(first).metadata();
const parts = [];
for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
  const b = (c === 0 && r === 0) ? first : await tile(`${base}/${c}_${r}.jpg`);
  if (b) parts.push({ input: b, left: c * meta.width, top: r * meta.height });
}
const img = await sharp({ create: { width: cols * meta.width, height: rows * meta.height, channels: 3,
  background: { r: 255, g: 255, b: 255 } } }).composite(parts).jpeg({ quality: 92 }).toBuffer();
console.log(`  captured       : ${cols}x${rows} tiles, ${Math.round(img.length / 1024)}KB`);

await page.close(); await browser.disconnect();

const text = await transcribeImage(img, { mimeType: 'image/jpeg',
  prompt: 'Transcribe this Freedmen\'s Savings Bank depositor registration form verbatim, preserving the ' +
          'printed field labels and the handwritten answers. Pay particular attention to the fields naming ' +
          'the depositor\'s former master or mistress. If a field is blank or illegible, write [blank] or ' +
          '[illegible]. Do not summarise or infer.' });
console.log('\n──────── VISION-ROUTER TRANSCRIPTION ────────');
console.log(text ? text.slice(0, 1800) : '(empty)');
console.log('─────────────────────────────────────────────');
const m = (text || '').match(/(?:last\s+)?(?:master|mistress|owner)[^\n:]*[:\-]?\s*([A-Z][\w.'’-]+(?:\s+[A-Z][\w.'’-]+){0,3})/i);
console.log(`\n  OLD (google vision): "${row.old_master}"`);
console.log(`  NEW (vision-router): "${m ? m[1] : '(no master field matched — read the transcription above)'}"`);
await pool.end();
