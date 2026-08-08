// run-source-extraction.mjs — the driver behind the source-type extraction registry.
//
// Turns the freshly-OCR'd holdings (reocr-holdings-monitor fills ocr_text) into typed structured rows: for each
// person_document with usable ocr_text and no extraction yet, detect its source type and run the FREE per-source
// extractor (src/services/extraction/source-type-registry.js → probate-llm-extractor's multi-provider router).
// Result lands in structured_extractions (migration 132). FREE/RULE-0.7 (no paid DocAI, no Claude); runs on the
// Mini. Promotion of these rows into canonical_persons/edges is a SEPARATE gated step (Biscoe-safe).
//
// Idempotent (unique on (person_document_id, source_type)); resumable; poison-pill/quota circuit-breaker.
//
// Usage:
//   node scripts/run-source-extraction.mjs                 # DRY-RUN: detect + extract a batch, print, write nothing
//   node scripts/run-source-extraction.mjs --apply         # write structured_extractions rows
//   BATCH=40 node scripts/run-source-extraction.mjs --apply
//   node scripts/run-source-extraction.mjs --apply --type freedmens   # restrict to one source type

import 'dotenv/config';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const { detectSourceType, REGISTRY } = require('../src/services/extraction/source-type-registry');
const { MODEL } = require('../src/services/probate/probate-llm-extractor');
const { notify } = require('../src/utils/notify');

const APPLY = process.argv.includes('--apply');
const ONLY_TYPE = (() => { const i = process.argv.indexOf('--type'); return i > -1 ? process.argv[i + 1] : null; })();
const BATCH = parseInt(process.env.BATCH || '30', 10);
const MIN_TEXT = 120;   // below this a "record" is a cover/sparse page — not worth a structured pass

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 180000 });
  console.log(`=== run-source-extraction — router=${MODEL} BATCH=${BATCH} ${APPLY ? 'APPLY' : 'DRY-RUN'}${ONLY_TYPE ? ' type=' + ONLY_TYPE : ''} ===`);
  if (MODEL === 'none') { console.error('FATAL: no LLM provider key (GEMINI_API_KEY / CEREBRAS_API_KEY / GROQ_API_KEY)'); process.exit(1); }

  const docs = (await pool.query(
    `SELECT pd.id, pd.s3_key, COALESCE(pd.collection_key,'') AS collection_key, pd.ocr_text
       FROM person_documents pd
      WHERE pd.ocr_text IS NOT NULL AND length(pd.ocr_text) >= ${MIN_TEXT}
        AND NOT EXISTS (SELECT 1 FROM structured_extractions se WHERE se.person_document_id = pd.id)
      ORDER BY pd.ocr_ran_at DESC NULLS LAST, pd.id DESC
      LIMIT ${BATCH * 3}`)).rows;   // over-fetch: type filter / detection may drop some

  const tally = { extracted: 0, empty: 0, failed: 0, by_type: {} };
  let processed = 0, failStreak = 0;
  for (const d of docs) {
    if (processed >= BATCH) break;
    const type = detectSourceType(d.s3_key, d.collection_key);
    if (ONLY_TYPE && type !== ONLY_TYPE) continue;
    processed++;
    const h = REGISTRY[type];
    let fields = null, n = 0, note = '';
    try {
      fields = await h.extract(d.ocr_text);
      n = h.count(fields) || 0;
      // callLLM throws on all-providers-fail; a valid-but-empty extraction (n===0) is a real "nothing here".
      if (n === 0) { tally.empty++; failStreak++; note = 'no named persons'; }
      else { tally.extracted++; failStreak = 0; }
    } catch (e) { tally.failed++; failStreak++; note = e.message.slice(0, 120); }

    tally.by_type[type] = (tally.by_type[type] || 0) + 1;
    console.log(`  #${d.id} ${type} persons=${n} ${note}`);

    // CIRCUIT BREAKER: 5 consecutive empty/failed in a row ⇒ provider quota exhausted (callLLM 429/402/403
    // exhaust the pool then throw). Abort so we don't burn the batch or falsely mark good docs.
    if (failStreak >= 5) { console.log('  ⚠ 5 consecutive empty/failed — likely provider quota; aborting run.'); break; }

    if (APPLY && fields && n > 0) {
      await pool.query(
        `INSERT INTO structured_extractions (person_document_id, s3_key, source_type, fields, model, n_persons, validated)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (person_document_id, source_type) DO UPDATE SET fields=EXCLUDED.fields, model=EXCLUDED.model, n_persons=EXCLUDED.n_persons, validated=EXCLUDED.validated, created_at=now()`,
        [d.id, d.s3_key, type, JSON.stringify(fields), MODEL, n, true]);
    }
  }

  const bt = Object.entries(tally.by_type).map(([k, v]) => `${k}=${v}`).join(' ');
  console.log(`=== run-source-extraction done: extracted=${tally.extracted} empty=${tally.empty} failed=${tally.failed} | ${bt} ===`);
  if (APPLY && tally.extracted > 0) await notify(`source-extraction: ${tally.extracted} docs → structured rows (${bt})`, { severity: 'info' }).catch(() => {});
  await pool.end();
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
