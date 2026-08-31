// reextract-freedmens-enslaver.mjs — re-read the Freedmen's Bank depositor forms at quality and recover the
// enslaver (last master / mistress) the depositor named at emancipation.
//
// WHY THIS IS THE HIGHEST-VALUE LINK IN THE PROJECT: the depositor naming their former enslaver crosses
// 1870 AND joins the two classes in a single row. plan-freedmens-enslaver-reextraction calls the signature
// registers "the single highest-value document in the project" for the enslaved line.
//
// WHAT THE OLD EXTRACTION DID (google_vision_ledger_extraction, 1,105 of 416,520 depositors):
//     James Greene   -> "Application Hilleder Pollard Hallis"  (printed form text, not a person)
//     Mingo Steele   -> "Application, Och 8th Lives on hurc"   (form text)
//     Jack Lancaster -> "Jack Lancaster"                       (THE DEPOSITOR'S OWN NAME)
//     Eugene Bacon   -> "Eugen Beson"                          (depositor's name, garbled)
// The last class would assert an enslaved person as their own enslaver. The plan is explicit: promoting
// that JSONB as-is "would mint hundreds of fake enslavers — do NOT."
//
// STEP 0 PROVED THE FIX AND EXPOSED THE TRAP (2026-08-24). Qwen-VL read the same image cleanly —
// "Record for James Greene / Name of Master: William Ballard / Name of Mistress: Margaret" — so the real
// enslaver is WILLIAM BALLARD and there is a MISTRESS the old pass lost entirely. BUT a first-match regex
// for "Name of Master" returned "John Ferguson": ONE FORM IMAGE HOLDS SEVERAL DEPOSITORS' RECORDS. At 415K
// scale that mis-attributes enslavers to the wrong freedpeople wholesale, and every row looks plausible —
// there is no shape to that error anyone would catch downstream. A descendant would be handed a DAA naming
// the wrong man.
//
// THEREFORE THIS SCRIPT FAILS CLOSED. It locates the block headed by THE DEPOSITOR'S OWN NAME and reads the
// master field only from inside it. If that block cannot be found, it records needs_review and writes NO
// enslaver. Silence is the correct output when the evidence cannot be scoped.
//
// Usage:
//   node scripts/reextract-freedmens-enslaver.mjs --limit 3
//   node scripts/reextract-freedmens-enslaver.mjs --limit 200 --apply
import 'dotenv/config';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';
import puppeteer from 'puppeteer';

const require = createRequire(import.meta.url);
const { transcribeImage } = require('../src/services/vision/vision-router');
const S3 = require('../src/services/storage/S3Service');
const sharp = require('sharp');

const A = process.argv.slice(2);
const val = (f, d) => { const i = A.indexOf(f); return i > -1 ? A[i + 1] : d; };
const APPLY = A.includes('--apply');
const LIMIT = +val('--limit', 25);
const LEVEL = +val('--level', 11);
const PORT = val('--port', '9222');
const GAP_MS = +val('--gap-ms', 2500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

// Split a transcription into per-depositor blocks. The model emits "Record for <Name>" headers; we also
// accept a bare "Name of Depositor" style header so a formatting change does not silently merge records.
function blocksFor(text) {
  const marks = [...text.matchAll(/(?:^|\n)\s*\**\s*(?:Record for|Depositor)[:\s]+([^\n*]{2,60})/gi)];
  if (!marks.length) return [];
  return marks.map((m, i) => ({
    name: m[1].trim().replace(/\*+$/, ''),
    body: text.slice(m.index, i + 1 < marks.length ? marks[i + 1].index : text.length),
  }));
}
const fieldIn = (body, label) => {
  const m = body.match(new RegExp(`Name of ${label}\\s*[:\\-]?\\s*([^\\n]{1,60})`, 'i'));
  if (!m) return null;
  const v = m[1].trim().replace(/\[(blank|illegible)\]/i, '').trim();
  return v && v.length > 1 ? v : null;
};

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false },
  statement_timeout: 600000, query_timeout: 600000 });
pool.on('error', (e) => console.error(`[pool] ${e.message}`));

const rows = (await pool.query(`
  SELECT lead_id, full_name, source_url,
         jsonb_path_query_first(relationships,'$[*] ? (@.type == "enslaved_by")')->>'name' AS old_master
    FROM unconfirmed_persons
   WHERE extraction_method IN ('freedmens_bank_index','freedmens_bank_ocr')
     AND relationships::text ILIKE '%enslaved_by%'
     AND source_url ~ 'ark:/61903/'
     AND NOT EXISTS (SELECT 1 FROM research_findings f
        WHERE f.searched_by='reextract-freedmens-enslaver' AND f.subject_id = unconfirmed_persons.lead_id)
   ORDER BY lead_id LIMIT $1`, [LIMIT])).rows;

console.log(`${APPLY ? '=== APPLY ===' : '=== DRY RUN ==='} ${rows.length} depositors (Batch 1: the already-annotated 1,105)`);
if (!rows.length) { await pool.end(); process.exit(0); }

let browser;
try { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null }); }
catch (e) { console.error(`no authenticated Chrome on :${PORT} — refusing to launch one. ${e.message}`); await pool.end(); process.exit(1); }
for (const t of await browser.pages()) {
  try { if (/familysearch|deepzoomcloud/i.test(t.url() || '')) { if (globalThis.__kept) await t.close(); else globalThis.__kept = true; } } catch {}
}
const page = await browser.newPage();
const cleanup = async () => { try { if (!page.isClosed()) await page.close(); } catch {} try { await browser.disconnect(); } catch {} try { await pool.end(); } catch {} };
process.once('SIGTERM', async () => { await cleanup(); process.exit(0); });
process.once('SIGINT', async () => { await cleanup(); process.exit(0); });

const tile = async (u) => { try { const r = await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 30000 });
  return r && r.status() === 200 ? await r.buffer() : null; } catch { return null; } };

const st = { read: 0, improved: 0, unchanged: 0, no_block: 0, no_image: 0, err: 0 };
for (const r of rows) {
  try {
    await page.goto(r.source_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(5000);
    const imageArk = await page.evaluate(() => {
      const a = [...document.querySelectorAll('a[href*="ark:/61903/3:1:"]')].map((x) => x.href);
      const m = document.body.innerHTML.match(/ark:\/61903\/(3:1:[A-Z0-9-]+)/i);
      return a[0] || (m ? `https://www.familysearch.org/ark:/61903/${m[1]}` : null);
    });
    if (!imageArk) { st.no_image++; continue; }
    const ark = (imageArk.match(/(3:1:[A-Z0-9-]+)/i) || [])[1];
    const base = `https://sg30p0.familysearch.org/service/records/storage/deepzoomcloud/dz/v1/${ark}/image_files/${LEVEL}`;
    const first = await tile(`${base}/0_0.jpg`);
    if (!first) { st.no_image++; continue; }
    let cols = 1, rows_ = 1;
    for (let c = 1; c < 16; c++) { if (!(await tile(`${base}/${c}_0.jpg`))) break; cols++; }
    for (let y = 1; y < 16; y++) { if (!(await tile(`${base}/0_${y}.jpg`))) break; rows_++; }
    const meta = await sharp(first).metadata();
    const parts = [];
    for (let c = 0; c < cols; c++) for (let y = 0; y < rows_; y++) {
      const b = (c === 0 && y === 0) ? first : await tile(`${base}/${c}_${y}.jpg`);
      if (b) parts.push({ input: b, left: c * meta.width, top: y * meta.height });
    }
    const img = await sharp({ create: { width: cols * meta.width, height: rows_ * meta.height, channels: 3,
      background: { r: 255, g: 255, b: 255 } } }).composite(parts).jpeg({ quality: 92 }).toBuffer();

    const text = await transcribeImage(img, { mimeType: 'image/jpeg',
      prompt: 'Transcribe this Freedmen\'s Savings Bank register page verbatim. It contains SEVERAL depositor ' +
              'records. Begin each one with "Record for <depositor name>" and then list its fields, including ' +
              '"Name of Master" and "Name of Mistress". Use [blank] or [illegible] where a field cannot be read. ' +
              'Do not merge records and do not infer anything not written.' });
    st.read++;

    // SCOPE TO THIS DEPOSITOR. Fail closed if their block is not on the page.
    const blocks = blocksFor(text || '');
    const want = norm(r.full_name);
    const mine = blocks.find((b) => { const n = norm(b.name); return n && (n === want || n.includes(want) || want.includes(n)); });
    if (!mine) {
      st.no_block++;
      if (APPLY) await pool.query(
        `INSERT INTO research_findings (question,repository,index_searched,result,hit_count,evidence_note,searched_by,subject_table,subject_id)
         VALUES ($1,$2,$3,'partial',0,$4,'reextract-freedmens-enslaver','unconfirmed_persons',$5)`,
        [`Who did ${r.full_name} name as their former enslaver?`,
         'FamilySearch collection 1417695 — Freedmen\'s Savings Bank signature registers',
         r.source_url,
         `Form re-read at quality, but the block headed by this depositor's own name was NOT located among ` +
         `${blocks.length} record(s) on the page (${blocks.map((b) => b.name).slice(0, 6).join(' | ')}). ` +
         `FAILED CLOSED: no enslaver written. One page holds several depositors, and a first-match read would ` +
         `attribute someone else's enslaver to this person.`, r.lead_id]);
      await sleep(GAP_MS); continue;
    }
    const master = fieldIn(mine.body, 'Master');
    const mistress = fieldIn(mine.body, 'Mistress');
    const changed = master && norm(master) !== norm(r.old_master || '');
    if (changed) st.improved++; else st.unchanged++;
    console.log(`  ${String(r.full_name).slice(0, 20).padEnd(22)} OLD "${String(r.old_master).slice(0, 26)}"  ->  MASTER "${master || '-'}"${mistress ? ` · MISTRESS "${mistress}"` : ''}`);

    if (APPLY) {
      const sha = crypto.createHash('sha256').update(img).digest('hex');
      const key = `sources/freedmens-bank/registers/${ark.replace(/:/g, '_')}/${sha.slice(0, 16)}.jpg`;
      await S3.upload(key, img, 'image/jpeg', { 'source-url': r.source_url, ark }).catch(() => {});
      await pool.query(
        `INSERT INTO source_artifacts (artifact_key,dataset_label,source_name,source_url,s3_bucket,s3_key,
           sha256,bytes,content_type,rehostable,retrieved_at,notes)
         VALUES ($1,'freedmens_register','FamilySearch collection 1417695',$2,$3,$4,$5,$6,'image/jpeg',FALSE,now(),$7)
         ON CONFLICT (artifact_key) DO NOTHING`,
        [`fs_image:${ark}`, r.source_url, process.env.S3_BUCKET || null, key, sha, img.length,
         `Freedmen's Bank register page, ${cols}x${rows_} tiles. Holds ${blocks.length} depositor record(s).`]).catch(() => {});
      await pool.query(
        `INSERT INTO research_findings (question,repository,index_searched,result,hit_count,evidence_note,searched_by,subject_table,subject_id)
         VALUES ($1,$2,$3,$4,1,$5,'reextract-freedmens-enslaver','unconfirmed_persons',$6)`,
        [`Who did ${r.full_name} name as their former enslaver?`,
         'FamilySearch collection 1417695 — Freedmen\'s Savings Bank signature registers',
         r.source_url, master ? 'hit' : 'none',
         `Re-read with vision-router, scoped to the block headed "${mine.name}" (page holds ${blocks.length} records). ` +
         `MASTER: ${master || '[not stated]'}${mistress ? ` · MISTRESS: ${mistress}` : ''}. ` +
         `SUPERSEDES google_vision_ledger_extraction "${r.old_master}". Scan archived ${key} (sha256 ${sha.slice(0, 16)}). ` +
         `Testimony of the depositor — tier 0.65-0.70, NOT government-primary; requires human review before any ` +
         `enslaver is minted.`, r.lead_id]).catch((e) => console.error(`  ! finding: ${e.message.slice(0, 70)}`));
    }
  } catch (e) { st.err++; if (st.err <= 5) console.error(`  ! ${r.full_name}: ${e.message.slice(0, 90)}`); }
  await sleep(GAP_MS);
}
console.log(`\n=== ${JSON.stringify(st)} ===`);
console.log('NOTE: no enslaver is minted here. Findings are staged for human review per the plan.');
await cleanup();
