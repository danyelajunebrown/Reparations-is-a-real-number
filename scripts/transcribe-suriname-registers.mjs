// transcribe-suriname-registers.mjs — read the Dutch Suriname slave registers so 68,319 people stop being
// invisible to every query we write.
//
// THE GAP, measured: 68,319 person_documents of type slave_register, over 6,215 distinct folio scans,
// with ZERO transcribed text. These are the best-evidenced people in the entire database — 100%
// image-backed, 100% publicly assertable, each serving an archived folio from the Nationaal Archief
// (nt00461) — and not one of them can be found by searching for anything written about them. We hold the
// evidence and cannot read it.
//
// WHY IT WAS INVISIBLE TO US: every extraction tool in this project reads English, and these registers are
// DUTCH. The scans came in through a bulk import that recorded names and folio references but never OCR'd
// the page. So Suriname is our second-largest block and our least legible one.
//
// WHY IT IS WORTH DOING BEYOND SEARCH: a Dutch slave register is not a tally. The 1826-1863 registers
// record, per enslaved person, name, sex, birth year or age, mother's name, and the plantation or owner —
// and the MOTHER'S NAME is the single most valuable field in this project, because matrilineal descent is
// how an enslaved line is traced at all. None of that is reachable while the page is only an image.
//
// ONE SCAN, MANY PEOPLE: a folio lists dozens of individuals (up to ~70 documents share one s3_key here),
// so this transcribes PER SCAN, not per person, and stores the text on every document that cites that
// folio. Transcribing per person would re-read the same page seventy times.
//
// The transcription is stored as ocr_text with ocr_model recorded. It does NOT parse people out of the
// page — that is a separate, reviewable step. Reading and interpreting are different acts, and conflating
// them is how "John Ferguson" ended up attached to James Greene.
//
// Usage: node scripts/transcribe-suriname-registers.mjs [--limit 20] [--apply]
import 'dotenv/config';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const { transcribeImage, VISION_MODEL } = require('../src/services/vision/vision-router');
const S3 = require('../src/services/storage/S3Service');

const A = process.argv.slice(2);
const val = (f, d) => { const i = A.indexOf(f); return i > -1 ? A[i + 1] : d; };
const APPLY = A.includes('--apply');
const LIMIT = +val('--limit', 20);
const GAP_MS = +val('--gap-ms', 1500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROMPT =
  'This is a page from a Dutch colonial slave register of Suriname (slavenregister, c.1826-1863), held by ' +
  'the Nationaal Archief. Transcribe it VERBATIM in the original Dutch, preserving the tabular layout: one ' +
  'line per enslaved person. These registers typically record, per person: naam (name), geslacht (m/v), ' +
  'geboortejaar or ouderdom (birth year or age), moeder (mother — record this carefully, it is the most ' +
  'important field), and the eigenaar or plantage (owner or plantation). Also transcribe the folio and ' +
  'inventory numbers if visible. Use [onleesbaar] for illegible text and [leeg] for blank cells. Do not ' +
  'translate, summarise, or infer anything that is not written on the page.';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false },
  statement_timeout: 900000, query_timeout: 900000 });
pool.on('error', (e) => console.error(`[pool] ${e.message}`));

const scans = (await pool.query(`
  SELECT s3_key, count(*)::int people, min(source_url) AS source_url
    FROM person_documents
   WHERE document_type = 'slave_register' AND s3_key IS NOT NULL
     AND (ocr_text IS NULL OR length(ocr_text) < 40)
   GROUP BY s3_key
   ORDER BY count(*) DESC
   LIMIT $1`, [LIMIT])).rows;

console.log(`${APPLY ? '=== APPLY ===' : '=== DRY RUN ==='} ${scans.length} folio scans · model ${VISION_MODEL || 'vision-router'}`);
console.log(`  (these ${scans.reduce((s, r) => s + r.people, 0)} people currently have NO readable text)`);

let ok = 0, err = 0, chars = 0;
for (const s of scans) {
  try {
    const buf = Buffer.from(await (await fetch(await S3.getViewUrl(s.s3_key, 900))).arrayBuffer());
    const text = await transcribeImage(buf, { mimeType: s.s3_key.endsWith('.png') ? 'image/png' : 'image/jpeg',
      prompt: PROMPT, maxTokens: 4096 });
    if (!text || text.length < 40) { err++; continue; }
    chars += text.length; ok++;
    console.log(`  ✅ ${s.s3_key.split('/').pop()} (${s.people} people) — ${text.length} chars`);
    if (ok === 1) console.log(`     first lines: ${text.split('\n').slice(0, 3).join(' | ').slice(0, 200)}`);
    if (APPLY) {
      await pool.query(
        `UPDATE person_documents SET ocr_text = $1, ocr_model = $2, ocr_ran_at = now()
          WHERE s3_key = $3 AND (ocr_text IS NULL OR length(ocr_text) < 40)`,
        [text, String(VISION_MODEL || 'vision-router'), s.s3_key]);
    }
  } catch (e) { err++; if (err <= 5) console.error(`  ! ${s.s3_key}: ${e.message.slice(0, 90)}`); }
  await sleep(GAP_MS);
}
console.log(`\n=== ${ok} scans transcribed · ${err} errors · ${Math.round(chars / Math.max(ok, 1))} chars/page avg ===`);
if (APPLY) console.log('RULE 0.5 — embed: node scripts/embed-documents.mjs (nightly cron also covers this)');
await pool.end();
