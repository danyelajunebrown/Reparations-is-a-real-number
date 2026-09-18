// audit-1860-page-completeness.mjs — is the 1860 extraction actually complete?
//
// THE PROBLEM. 144,571 census documents, and 35 of them (0.02%) carry any per-page count. So for 99.98%
// of the corpus nothing independent says how many people SHOULD have come off a page, and extraction
// completeness has never been measurable. That is the county-gap defect one level down: there, coverage
// divided scraped-by-enumerated and could only confirm itself; here there is no denominator at all.
//
// THE DENOMINATOR WAS ALWAYS ON THE PAGE. Every schedule ends in a printed summary box:
//     No. of male slaves, 39 · No. of female slaves, 39 · Total slaves, 78
// The enumerator wrote that in 1860. We did not generate it, cannot influence it, and it is the external
// check this corpus has been missing. Compare it to the rows we extracted and completeness becomes a
// measurement instead of an assumption.
//
// WHY A CROP. The box sits in the bottom ~10% of the page. Cropping to it cuts a 644KB page to ~167KB
// (measured), so ~2,500 prompt tokens instead of 10,853 — and turns a 78-row cursive transcription into
// reading three numbers anchored by printed labels. ~$0.0025/page, so a 400-page sample costs about $1.
// SAMPLE, DO NOT CENSUS: auditing all 144,571 would be ~$360 and tells you nothing a sample won't.
//
// SIGNAL THIS EXISTS TO TEST (2026-09-17): corpus mean is 39.8 enslaved/page against a page capacity of
// 80, and each page is TWO PANELS OF EXACTLY 40 ROWS. Only 372 of 38,923 pages (0.96%) ever reach 80. On
// the one page hand-verified, 53 of 78 were extracted — 32% short. Either roughly half the corpus is
// missing, or pages are genuinely part-full. This script decides which.
//
// Usage: node scripts/audit-1860-page-completeness.mjs [--limit 400] [--apply]
import 'dotenv/config';
import { createRequire } from 'node:module';
import pg from 'pg';
const require = createRequire(import.meta.url);
const sharp = require('sharp');
const S3 = require('../src/services/storage/S3Service');
const { transcribeImage } = require('../src/services/vision/vision-router');

const A = process.argv.slice(2);
const LIMIT = (() => { const i = A.indexOf('--limit'); return i > -1 ? +A[i + 1] : 40; })();
const APPLY = A.includes('--apply');

// Deliberately NOT a format template. Today's lesson: handing a model a schema to fill makes it fill the
// schema whether or not it can read — a `AGE | SEX | COLOR` prompt produced 40 invented rows on this very
// page. Ask for three labelled values, and give an explicit way to decline.
const PROMPT =
  'This is the printed summary box from the bottom of an 1860 US census slave schedule. It contains ' +
  'printed labels with handwritten numbers beside them. Report ONLY these three values exactly as ' +
  'written: "No. of male slaves", "No. of female slaves", and "Total slaves". ' +
  'Answer as three lines: male=<n> female=<n> total=<n>. ' +
  'If a value is blank or you cannot read it, write UNREADABLE for that value. Do not guess or calculate.';

const num = (s) => { const m = String(s).match(/(\d{1,3})/); return m ? +m[1] : null; };

function parse(text) {
  const g = (k) => {
    const m = new RegExp(`${k}\\s*=\\s*([^\\s\\n]+)`, 'i').exec(text || '');
    return m ? (/unreadable/i.test(m[1]) ? 'unreadable' : num(m[1])) : null;
  };
  return { male: g('male'), female: g('female'), total: g('total') };
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false },
  statement_timeout: 120000 });
pool.on('error', (e) => console.error(`[pool] ${e.message}`));

const docs = (await pool.query(`
  SELECT d.id, d.s3_key, d.source_url,
         (SELECT count(*)::int FROM unconfirmed_persons u
           WHERE u.source_url = d.source_url AND u.person_type = 'enslaved') AS extracted
    FROM person_documents d
   WHERE d.document_type = 'census_slave_schedule'
     AND d.s3_key IS NOT NULL AND d.source_url IS NOT NULL
   ORDER BY d.id                      -- deterministic: the same sample is re-auditable
   LIMIT $1`, [LIMIT])).rows;

console.log(`\n=== 1860 PAGE COMPLETENESS — ${docs.length} pages ${APPLY ? '(recording findings)' : '(dry run)'} ===\n`);

const rows = [];
let exhausted = false;
for (const d of docs) {
  let footer;
  try {
    const url = await S3.getViewUrl(d.s3_key, 900);
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    const m = await sharp(buf).metadata();
    footer = await sharp(buf)
      .extract({ left: 0, top: Math.round(m.height * 0.855), width: m.width, height: Math.round(m.height * 0.10) })
      .jpeg({ quality: 92 }).toBuffer();
  } catch (e) { rows.push({ id: d.id, verdict: 'image error', detail: e.message.slice(0, 40) }); continue; }

  let text;
  try { text = await transcribeImage(footer, { mimeType: 'image/jpeg', prompt: PROMPT, maxTokens: 120 }); }
  catch (e) {
    // Provider exhaustion is NOT a finding about the page. Stop; record nothing for it.
    console.log(`\n⛔ vision providers exhausted after ${rows.length} pages — stopping.`);
    console.log(`   ${String(e.message).slice(0, 120)}`);
    exhausted = true; break;
  }

  const p = parse(text);
  const printed = typeof p.total === 'number' ? p.total : null;
  const verdict = printed === null ? 'footer unreadable'
    : d.extracted === printed ? 'MATCH'
    : d.extracted < printed ? 'UNDER-extracted' : 'over-extracted';
  const pct = printed ? Math.round(100 * d.extracted / printed) : null;
  rows.push({ id: d.id, printed_total: printed, extracted: d.extracted, recall_pct: pct, verdict });
  console.log(`  #${String(d.id).padEnd(8)} printed=${String(printed ?? '?').padStart(3)}  extracted=${String(d.extracted).padStart(3)}  ${pct !== null ? String(pct).padStart(3) + '%' : '   '}  ${verdict}`);
}

const scored = rows.filter((r) => typeof r.recall_pct === 'number');
console.log(`\n=== RESULT ===`);
if (!scored.length) {
  console.log('  ⚠️  NOTHING WAS MEASURED. This run says nothing about corpus completeness.');
} else {
  const mean = scored.reduce((a, r) => a + r.recall_pct, 0) / scored.length;
  const under = scored.filter((r) => r.verdict === 'UNDER-extracted').length;
  console.log(`  pages measured : ${scored.length} of ${docs.length}${exhausted ? ' (run cut short by provider quota)' : ''}`);
  console.log(`  MEAN RECALL    : ${mean.toFixed(1)}%   <- share of the enumerator's own count we actually hold`);
  console.log(`  under-extracted: ${under}/${scored.length}`);
  console.log(`\n  ${mean < 70 ? '⛔ The 1860 extraction is materially incomplete. Revisit before extending it.'
                              : '✅ Extraction tracks the enumerator\'s totals; the 39.8 mean reflects part-full pages.'}`);
}

// Null results are first-class evidence here — record the measurement either way.
if (APPLY && scored.length) {
  for (const r of scored) {
    await pool.query(
      `INSERT INTO research_findings (subject_table, subject_id, searched_for, searched_by, outcome, detail, created_at)
       VALUES ('person_documents', $1, '1860 page completeness vs printed footer total', 'audit-1860-page-completeness', $2, $3, now())`,
      [String(r.id), r.verdict, JSON.stringify(r)]).catch(() => {});
  }
  console.log(`\n  recorded ${scored.length} findings`);
}
await pool.end();
process.exit(exhausted && !scored.length ? 2 : 0);
