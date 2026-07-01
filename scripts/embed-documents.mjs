#!/usr/bin/env node
/**
 * Phase-2 (2a): embed person_documents OCR text into the pgvector `embeddings` table (M107).
 * Two free sources (both 768-dim → identical schema):
 *   EMBED_SOURCE=gemini  (default) — Gemini text-embedding-004 via GEMINI_API_KEY (free tier;
 *        network-bound, fast; concurrent + 429 backoff). Run where the key + egress live (the Mini).
 *   EMBED_SOURCE=ollama  — local nomic-embed-text (free/self-hosted, but CPU-bound on an Intel Mini
 *        it is ~3/min → impractical for 75K; kept for an Apple-Silicon host / offline use).
 * Idempotent: skips docs already embedded for (content_kind='doc_ocr', model); stores content_hash.
 *
 *   LIMIT=20 node scripts/embed-documents.mjs                 # smoke test (gemini)
 *   nohup node scripts/embed-documents.mjs > /tmp/embed-docs.log 2>&1 &   # full ~75K
 *   EMBED_SOURCE=ollama node scripts/embed-documents.mjs      # local model instead
 */
import dotenv from 'dotenv'; import crypto from 'node:crypto'; import pg from 'pg';
dotenv.config();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const SOURCE = process.env.EMBED_SOURCE || 'gemini';
const LIMIT = parseInt(process.env.LIMIT || '0', 10);
const BATCH = 200;
const CONC = parseInt(process.env.CONC || (SOURCE === 'gemini' ? '8' : '1'), 10);
const MODEL = SOURCE === 'gemini' ? 'gemini-embedding-001' : (process.env.EMBED_MODEL || 'nomic-embed-text');
const GKEY = process.env.GEMINI_API_KEY;
const OLLAMA = process.env.OLLAMA_URL || 'http://localhost:11434/api/embeddings';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function embedGemini(text, attempt = 0) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GKEY}`;
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'models/gemini-embedding-001', content: { parts: [{ text: text.slice(0, 8000) }] }, outputDimensionality: 768 }) });
  if (r.status === 429 || r.status === 503) { if (attempt > 6) throw new Error('rate-limited'); await sleep(2000 * (attempt + 1)); return embedGemini(text, attempt + 1); }
  if (!r.ok) throw new Error('gemini ' + r.status);
  return (await r.json())?.embedding?.values;
}
// CONC=1 for ollama: 0.24.0 wedges under concurrent requests. Slice 2000 chars (well within nomic's
// window; the OCR header + first entries carry the strongest retrieval signal) → ~15 docs/min clean.
const OLLAMA_MAXCHARS = parseInt(process.env.OLLAMA_MAXCHARS || '2000', 10);
async function embedOllama(text) {
  const r = await fetch(OLLAMA, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: MODEL, prompt: text.slice(0, OLLAMA_MAXCHARS) }) });
  if (!r.ok) throw new Error('ollama ' + r.status);
  return (await r.json()).embedding;
}
const embed = SOURCE === 'gemini' ? embedGemini : embedOllama;

// Fail-loud config (reckoning item C): the silent EMBED_SOURCE fallback masqueraded as a "stall"
// twice on Jun 30 (dropped env var -> capped Gemini -> zero progress). Warn on an implicit default,
// then PREFLIGHT one embed and abort with a clear message if the resolved provider is unreachable/
// rate-limited — instead of grinding to no effect. The corpus space is model-specific, so a wrong
// source silently produces an unqueryable second space; better to stop now.
async function preflight() {
  if (!process.env.EMBED_SOURCE) {
    console.warn(`⚠ EMBED_SOURCE not set — defaulting to '${SOURCE}'.` +
      (SOURCE === 'gemini' ? ' NOTE: gemini free tier caps at 1,000 embeds/DAY; set EMBED_SOURCE=ollama for the bulk corpus.' : ''));
  }
  try {
    const v = await embed('preflight');
    if (!Array.isArray(v) || v.length !== 768) throw new Error(`bad embedding (dim ${Array.isArray(v) ? v.length : 'n/a'})`);
  } catch (e) {
    console.error(`FATAL preflight: source='${SOURCE}' model='${MODEL}' failed a test embed: ${e.message}.` +
      (SOURCE === 'gemini' ? ' (gemini rate-limited/capped? set EMBED_SOURCE=ollama)' : ` (is ollama up at ${OLLAMA}?)`));
    process.exit(3);
  }
}

(async () => {
  if (SOURCE === 'gemini' && !GKEY) { console.error('GEMINI_API_KEY not set'); process.exit(2); }
  console.log(`embed-documents: source=${SOURCE} model=${MODEL} conc=${CONC} ${LIMIT ? 'LIMIT=' + LIMIT : '(full)'}`);
  await preflight();
  let lastId = 0, done = 0, skip = 0, err = 0, batches = 0;
  for (;;) {
    const { rows } = await pool.query(
      `SELECT id, ocr_text FROM person_documents
       WHERE ocr_text IS NOT NULL AND length(ocr_text) > 40 AND id > $1
       ORDER BY id LIMIT $2`, [lastId, BATCH]);
    if (!rows.length) break;
    lastId = rows[rows.length - 1].id;
    const have = new Set((await pool.query(
      `SELECT subject_id FROM embeddings WHERE subject_table='person_documents' AND content_kind='doc_ocr' AND model=$1
       AND subject_id = ANY($2::text[])`, [MODEL, rows.map(r => String(r.id))])).rows.map(r => r.subject_id));
    const todo = rows.filter(d => !have.has(String(d.id)));
    skip += rows.length - todo.length;

    // concurrent embed
    const results = [];
    for (let i = 0; i < todo.length; i += CONC) {
      const chunk = todo.slice(i, i + CONC);
      const embs = await Promise.all(chunk.map(async d => {
        try { const e = await embed(d.ocr_text); return (Array.isArray(e) && e.length === 768) ? { d, e } : null; }
        catch { return null; }
      }));
      for (const x of embs) { if (x) results.push(x); else err++; }
      if (LIMIT && done + results.length >= LIMIT) break;
    }
    // bulk insert
    if (results.length) {
      const sids = [], models = [], vecs = [], hashes = [];
      for (const { d, e } of results) { sids.push(String(d.id)); models.push(MODEL); vecs.push('[' + e.join(',') + ']'); hashes.push(crypto.createHash('sha256').update(d.ocr_text).digest('hex')); }
      await pool.query(
        `INSERT INTO embeddings (subject_table, subject_id, content_kind, model, embedding, content_hash)
         SELECT 'person_documents', u.sid, 'doc_ocr', u.m, u.v::vector, u.h
           FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) AS u(sid, m, v, h)
         ON CONFLICT (subject_table, subject_id, content_kind, model) DO NOTHING`, [sids, models, vecs, hashes]);
      done += results.length;
    }
    batches++;
    if (batches % 3 === 0) console.log(`  ...id<=${lastId} embedded=${done} skipped=${skip} err=${err}`);
    if (LIMIT && done >= LIMIT) break;
  }
  const tot = (await pool.query(`SELECT count(*) c FROM embeddings WHERE content_kind='doc_ocr' AND model=$1`, [MODEL])).rows[0].c;
  console.log(`done: embedded ${done}, skipped ${skip}, err ${err}. total doc_ocr(${MODEL}): ${(+tot).toLocaleString()}`);
  await pool.end();
})();
