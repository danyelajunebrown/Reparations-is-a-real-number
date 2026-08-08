// reocr-holdings-monitor.mjs — the INTERNAL MONITORING that (re-)OCRs everything we hold, again and again.
//
// User directive (2026-08-08): "re-OCR-ing everything we have again and again is exactly the internal
// monitoring that we need to build." 236K of 341K s3-backed person_documents have NO ocr_text — a retrieval
// silo (RULE 0.5: no ocr_text ⇒ not embedded ⇒ invisible to RAG/search/modals). This monitor drips through
// the archived images, transcribes each with the current best vision model, fills ocr_text, and re-embeds.
//
// REUSE (RULE: don't re-derive OCR): src/services/vision/vision-router.js `transcribeImage` — the bakeoff-
// validated multi-provider router (Qwen2.5-VL-72B via OpenRouter, uncapped, PRIMARY → Gemini 2.5-flash →
// gpt-4o). PDFs are rasterized with pdftoppm (-r 150, memory-bank Session 52) and each page transcribed.
// Re-embed is LOCAL nomic-embed-text (free) — FREE/RULE-0.7 end to end, no Claude, all inference on the Mini.
//
// Idempotent + resumable + poison-pill-guarded: a doc gets a document_ocr_runs row every pass; docs touched
// in the last REVISIT_DAYS are skipped so each run advances to fresh work and un-OCRable images aren't
// re-hammered. Provenance (person_documents.ocr_model/ocr_ran_at) lets a future pass re-OCR when the model
// improves. Low-and-slow by default (BATCH small) so it runs as a gentle Mini cron.
//
// Usage:
//   node scripts/reocr-holdings-monitor.mjs                 # DRY-RUN (default): pick a batch, transcribe, report
//   node scripts/reocr-holdings-monitor.mjs --apply         # write ocr_text + ledger + re-embed
//   BATCH=50 node scripts/reocr-holdings-monitor.mjs --apply
//   node scripts/reocr-holdings-monitor.mjs --apply --id 12345   # one specific person_document

import 'dotenv/config';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const { transcribeImage, VISION_MODEL } = require('../src/services/vision/vision-router');
const S3 = require('../src/services/storage/S3Service');
const { notify } = require('../src/utils/notify');
const execFileP = promisify(execFile);

const APPLY = process.argv.includes('--apply');
const ONE_ID = (() => { const i = process.argv.indexOf('--id'); return i > -1 ? parseInt(process.argv[i + 1], 10) : null; })();
const BATCH = parseInt(process.env.BATCH || (ONE_ID ? '1' : '30'), 10);
const REVISIT_DAYS = parseInt(process.env.REVISIT_DAYS || '14', 10);
const MIN_TEXT = 40;                          // below this we consider a doc un-OCR'd
const MAX_PDF_PAGES = parseInt(process.env.MAX_PDF_PAGES || '15', 10);
const OLLAMA = process.env.OLLAMA_URL || 'http://localhost:11434/api/embeddings';
const EMBED_MODEL = 'nomic-embed-text';

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
const extOf = (k) => (k.match(/\.([a-zA-Z0-9]+)$/)?.[1] || '').toLowerCase();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ── OCR one S3 object → text (image direct; pdf via pdftoppm per page) ──────────────────────────────────
async function ocrObject(s3Key, buf) {
  const ext = extOf(s3Key);
  if (MIME[ext]) {
    // Downsize very large images so the provider accepts them (sharp if available; original otherwise).
    let img = buf;
    if (buf.length > 4 * 1024 * 1024) {
      try { const sharp = require('sharp'); img = await sharp(buf).resize(2600, null, { fit: 'inside', withoutEnlargement: true }).toBuffer(); }
      catch { /* sharp unavailable → send original */ }
    }
    return await transcribeImage(img, { mimeType: MIME[ext] });
  }
  if (ext === 'pdf') {
    const tmp = `/tmp/reocr-${crypto.randomUUID()}`;
    await fs.writeFile(`${tmp}.pdf`, buf);
    try {
      await execFileP('pdftoppm', ['-png', '-r', '150', `${tmp}.pdf`, tmp]).catch(() => {});
      const dir = await fs.readdir('/tmp');
      const base = tmp.split('/').pop();
      const pages = dir.filter(f => f.startsWith(base) && f.endsWith('.png')).sort().slice(0, MAX_PDF_PAGES);
      let out = '';
      for (const pg2 of pages) {
        const pbuf = await fs.readFile(`/tmp/${pg2}`);
        const t = await transcribeImage(pbuf, { mimeType: 'image/png' });
        if (t) out += (out ? '\n\n' : '') + t;
        await fs.unlink(`/tmp/${pg2}`).catch(() => {});
      }
      return out;
    } finally { await fs.unlink(`${tmp}.pdf`).catch(() => {}); }
  }
  return null;  // html/txt/unknown → not an image
}

async function fetchS3(key) {
  const url = await S3.getViewUrl(key, 900);
  const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`s3 fetch ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function embedNomic(text) {
  const r = await fetch(OLLAMA, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text.slice(0, 2000) }), signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error('ollama ' + r.status);
  const j = await r.json();
  if (!j.embedding?.length) throw new Error('ollama empty embedding');
  return j.embedding;
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 180000 });
  if (S3._regionVerifiedPromise) await S3._regionVerifiedPromise;   // presigned URLs need the verified region
  console.log(`=== reocr-holdings-monitor — model=${VISION_MODEL} BATCH=${BATCH} ${APPLY ? 'APPLY' : 'DRY-RUN'} ===`);
  if (VISION_MODEL === 'none') { console.error('FATAL: no vision provider key (OPENROUTER_API_KEY / GEMINI_API_KEY)'); process.exit(1); }

  const where = ONE_ID
    ? `pd.id = ${ONE_ID}`
    : `pd.s3_key IS NOT NULL
       AND (pd.ocr_text IS NULL OR length(pd.ocr_text) < ${MIN_TEXT})
       AND lower(pd.s3_key) ~ '\\.(jpg|jpeg|png|webp|gif|pdf)$'
       AND NOT EXISTS (SELECT 1 FROM document_ocr_runs r
                       WHERE r.person_document_id = pd.id AND r.ran_at > now() - interval '${REVISIT_DAYS} days')`;
  const docs = (await pool.query(
    `SELECT pd.id, pd.s3_key, COALESCE(length(pd.ocr_text),0) AS prev_len
     FROM person_documents pd WHERE ${where} ORDER BY pd.id LIMIT ${BATCH}`)).rows;

  if (!docs.length) { console.log('nothing to (re)OCR right now.'); await pool.end(); return; }
  console.log(`picked ${docs.length} doc(s) (prioritising never-OCR'd)`);

  const tally = { ocr_filled: 0, ocr_improved: 0, ocr_kept: 0, ocr_failed: 0, skipped: 0, embedded: 0 };
  for (const d of docs) {
    const ext = extOf(d.s3_key);
    let text = '', action = 'ocr_failed', note = '';
    try {
      const buf = await fetchS3(d.s3_key);
      if (buf.length > 25 * 1024 * 1024) { action = 'skipped'; note = `oversized ${(buf.length / 1e6) | 0}MB`; }
      else {
        text = (await ocrObject(d.s3_key, buf) || '').trim();
        if (!text) { action = 'ocr_failed'; note = `no text returned from ${ext} (provider empty / unreadable)`; }
        else if (text.length < MIN_TEXT) { action = 'ocr_sparse'; note = `${text.length} chars — cover/divider/blank page`; }  // OCR succeeded; page just has ~no text. Don't write/embed noise; don't retry.
        else if (d.prev_len >= MIN_TEXT && text.length <= d.prev_len) { action = 'ocr_kept'; note = `new ${text.length} <= existing ${d.prev_len}`; }
        else { action = d.prev_len >= MIN_TEXT ? 'ocr_improved' : 'ocr_filled'; }
      }
    } catch (e) { action = 'ocr_failed'; note = e.message.slice(0, 120); }

    tally[action] = (tally[action] || 0) + 1;
    const wrote = (action === 'ocr_filled' || action === 'ocr_improved');
    console.log(`  #${d.id} ${ext} ${action} ${text ? text.length + 'ch' : ''} ${note}`);

    if (APPLY) {
      if (wrote) {
        await pool.query(`UPDATE person_documents SET ocr_text=$2, ocr_model=$3, ocr_ran_at=now() WHERE id=$1`, [d.id, text, VISION_MODEL]);
        // Re-embed (RULE 0.5): upsert the doc_ocr vector so the freshly-transcribed doc is retrievable.
        try {
          const vec = await embedNomic(text);
          await pool.query(
            `INSERT INTO embeddings (subject_table, subject_id, content_kind, model, embedding, content_hash, chunk_index)
             VALUES ('person_documents', $1, 'doc_ocr', $2, $3::vector, $4, 0)
             ON CONFLICT (subject_table, subject_id, content_kind, model, chunk_index)
             DO UPDATE SET embedding=EXCLUDED.embedding, content_hash=EXCLUDED.content_hash`,
            [String(d.id), EMBED_MODEL, '[' + vec.join(',') + ']', sha(text)]);
          tally.embedded++;
        } catch (e) { console.log(`     embed err: ${e.message.slice(0, 60)}`); }
      }
      await pool.query(
        `INSERT INTO document_ocr_runs (person_document_id, s3_key, ocr_model, char_len, prev_len, action, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [d.id, d.s3_key, VISION_MODEL, text.length, d.prev_len, action, note || null]);
    }
  }

  const line = Object.entries(tally).map(([k, v]) => `${k}=${v}`).join(' ');
  console.log(`=== reocr-holdings-monitor done: ${line} ===`);
  if (APPLY && (tally.ocr_filled + tally.ocr_improved) > 0)
    await notify(`re-OCR: +${tally.ocr_filled} filled, ${tally.ocr_improved} improved, ${tally.embedded} embedded (${tally.ocr_failed} failed)`, { severity: 'info' }).catch(() => {});
  await pool.end();
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
