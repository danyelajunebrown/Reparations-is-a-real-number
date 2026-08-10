// embed-doc-chunks.mjs — CHUNKED RAG re-embed. Splits a document's ocr_text into overlapping passages and
// embeds EACH as a separate content_kind='doc_ocr' row (chunk_index 1..N), so RagService.retrieve matches
// the relevant PASSAGE instead of a diffuse whole-doc vector. Proven-needed by the retrievability rubric
// (whole-doc colonial wills scored ~0.45 against queries naming their own contents). Same embeddings table,
// same content_kind RagService reads → RAG stays central; chunks just give passage-level matches, deduped
// to the doc id by the caller.
//
// Run ON THE MINI (localhost:11434 = Mini ollama) for the heavy job. Idempotent per (doc, chunk_index).
// Usage: node scripts/embed-doc-chunks.mjs --like dutchess [--limit N] [--chars 800] [--overlap 150] [--apply]

import 'dotenv/config';
import crypto from 'node:crypto';
import pg from 'pg';

const A = process.argv.slice(2);
const li = A.indexOf('--like'); const LIKE = li > -1 ? A[li + 1] : null;
const lm = A.indexOf('--limit'); const LIMIT = lm > -1 ? +A[lm + 1] : Infinity;
const ch = A.indexOf('--chars'); const CHARS = ch > -1 ? +A[ch + 1] : 800;
const ov = A.indexOf('--overlap'); const OVERLAP = ov > -1 ? +A[ov + 1] : 150;
const APPLY = A.includes('--apply');
// --unchunked: select the actual REMEDIATION TARGET instead of a text pattern — documents long enough to
// have been truncated by the head-only embedders (text.slice(0,4000)) that carry no chunk_index>0 row.
// Those are RAG-visible for their first page and invisible past it; a probate estate puts the heirs, the
// named enslaved and the valuations in the BODY. Measured 2026-08-09: 21,180 such documents
// (finding-retrievability-metric-and-doc-tails-aug09.md). Makes this script re-runnable as a sweep.
const UNCHUNKED = A.includes('--unchunked');
const cc = A.indexOf('--conc'); const CONC = cc > -1 ? +A[cc + 1] : 4;
// --timeout: ollama does NOT serve embeds concurrently -- it queues them. Measured 2026-08-09 on the
// MacBook: idle round-trip 0.2s, but under --conc 6 a single embed took 39.6s because it waited behind the
// in-flight batch. The original hardcoded 30s therefore did not protect against a hung server, it GUARANTEED
// failures the moment the queue got deep, and that is what killed the first 21,817-doc sweep at doc 1,725.
// A queued request is healthy, not hung, so the ceiling must sit well above the deepest expected queue.
const to = A.indexOf('--timeout'); const TIMEOUT = to > -1 ? +A[to + 1] : 180000;
const rt = A.indexOf('--retries'); const RETRIES = rt > -1 ? +A[rt + 1] : 2;
const MODEL = process.env.EMBED_MODEL || 'nomic-embed-text';
const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/embeddings';
if (!LIKE && !UNCHUNKED) {
  console.error('usage: (--like <substr> | --unchunked) [--limit N] [--chars 800] [--overlap 150] [--conc 4] [--timeout ms] [--retries N] [--apply]');
  process.exit(1);
}

// Sentence-aware overlapping chunks: pack sentences up to ~CHARS, carry OVERLAP chars of tail into the next.
function chunk(text) {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= CHARS) return clean ? [clean] : [];
  const sents = clean.match(/[^.!?;]+[.!?;]?/g) || [clean];
  const out = []; let buf = '';
  for (const s of sents) {
    if ((buf + s).length > CHARS && buf) { out.push(buf.trim()); buf = buf.slice(-OVERLAP) + s; }
    else buf += s;
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter((c) => c.length > 40);
}

// Retries with backoff because the failure mode here is a DEEP QUEUE, not a dead server -- and an
// un-retried chunk is a silent retrievability hole: the doc keeps its other passages, so it no longer
// looks unchunked, yet the passage that actually named the heirs is simply missing from RAG. Same class of
// invisible loss as the name-validator false rejects (finding-name-validator-false-rejects-aug09).
async function embed(text) {
  let last;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const r = await fetch(OLLAMA, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, prompt: String(text).slice(0, 6000) }), signal: AbortSignal.timeout(TIMEOUT) });
      if (!r.ok) throw new Error('ollama ' + r.status);
      const vec = (await r.json()).embedding;
      if (!Array.isArray(vec) || !vec.length) throw new Error('ollama returned empty embedding');
      return vec;
    } catch (e) {
      last = e;
      if (attempt < RETRIES) await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw last;
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const rows = UNCHUNKED
    ? (await pool.query(
        `SELECT id, ocr_text FROM person_documents d
          WHERE length(COALESCE(ocr_text,'')) > 4000
            AND NOT EXISTS (SELECT 1 FROM embeddings e
                             WHERE e.subject_table='person_documents' AND e.subject_id=d.id::text
                               AND e.content_kind='doc_ocr' AND e.chunk_index > 0)
          ORDER BY id ${Number.isFinite(LIMIT) ? 'LIMIT ' + LIMIT : ''}`)).rows
    : (await pool.query(
        `SELECT id, ocr_text FROM person_documents
          WHERE (collection_key ILIKE $1 OR source_url ILIKE $1 OR ocr_text ILIKE $1)
            AND length(COALESCE(ocr_text,'')) > ${CHARS}
          ORDER BY id ${Number.isFinite(LIMIT) ? 'LIMIT ' + LIMIT : ''}`, ['%' + LIKE + '%'])).rows;
  console.log(`chunked re-embed: ${rows.length} docs ${UNCHUNKED ? '(unchunked >4000c)' : `like "${LIKE}"`} · model=${MODEL} · ollama=${OLLAMA} · ${CHARS}c/${OVERLAP}ov · conc=${CONC}${APPLY ? '' : ' [DRY-RUN]'}`);

  let docs = 0, chunks = 0, skipped = 0, err = 0;
  const t0 = Date.now();

  // One document at a time, but its passages embed CONCURRENTLY. Sequential embedding made the 21,180-doc
  // sweep a multi-hour job for no reason — ollama serves several requests happily and the DB write is
  // per-passage and independent. Per-document batching keeps progress reporting and idempotency simple.
  const embedPassage = async (docId, passage, ci) => {
    try {
      const already = (await pool.query(
        `SELECT 1 FROM embeddings WHERE subject_table='person_documents' AND subject_id=$1 AND content_kind='doc_ocr' AND model=$2 AND chunk_index=$3`,
        [String(docId), MODEL, ci])).rows.length;
      if (already) return 'skip';
      const vec = await embed(passage);
      await pool.query(
        `INSERT INTO embeddings (subject_table, subject_id, content_kind, model, embedding, content_hash, chunk_index)
         VALUES ('person_documents',$1,'doc_ocr',$2,$3::vector,$4,$5)
         ON CONFLICT (subject_table, subject_id, content_kind, model, chunk_index) DO NOTHING`,
        [String(docId), MODEL, '[' + vec.join(',') + ']', crypto.createHash('sha256').update(passage).digest('hex'), ci]);
      return 'ok';
    } catch (e) { err++; if (err % 25 === 1) console.log(`\n  err doc#${docId} chunk${ci}: ${e.message.slice(0, 60)} (err #${err})`); return 'err'; }
  };

  let rolledBack = 0;
  for (const d of rows) {
    const passages = chunk(d.ocr_text);
    if (!passages.length) { skipped++; continue; }
    docs++;
    if (!APPLY) { chunks += passages.length; continue; }
    let docErr = 0;
    for (let i = 0; i < passages.length; i += CONC) {
      const slice = passages.slice(i, i + CONC);
      const res = await Promise.all(slice.map((psg, j) => embedPassage(d.id, psg, i + j + 1)));
      docErr += res.filter((r) => r === 'err').length;
      chunks += res.filter((r) => r !== 'err').length;
    }
    // PARTIAL DOCS ARE ROLLED BACK, NOT KEPT. The --unchunked selector asks "does this doc have ANY
    // chunk_index>0 row?" -- so a doc that embedded 7 of 8 passages looks DONE forever, and the one missing
    // passage is invisibly absent from RAG. Since chunk() is deterministic, discarding the partial set is
    // free and returns the doc to the sweep pool. Better to redo a doc than to silently under-index it.
    if (docErr) {
      const del = await pool.query(
        `DELETE FROM embeddings WHERE subject_table='person_documents' AND subject_id=$1
           AND content_kind='doc_ocr' AND model=$2 AND chunk_index > 0 RETURNING id`,
        [String(d.id), MODEL]);
      chunks -= del.rows.length; rolledBack++;
    }
    if (docs % 25 === 0) {
      const rate = docs / ((Date.now() - t0) / 60000);
      const eta = rate > 0 ? Math.round((rows.length - docs) / rate) : 0;
      process.stdout.write(`\r  ${docs}/${rows.length} docs, ${chunks} chunks, ${rate.toFixed(1)} docs/min, ETA ~${eta}min, err ${err}, rolled back ${rolledBack}   `);
    }
  }
  await pool.end();
  console.log(`\n=== ${docs} docs chunked → ${chunks} passage embeddings${APPLY ? '' : ' (dry-run)'} · skipped ${skipped} · err ${err} · rolled back ${rolledBack} (re-run to retry those) ===`);
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
