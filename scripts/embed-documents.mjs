#!/usr/bin/env node
/**
 * Phase-2 (2a): embed person_documents OCR text into the pgvector `embeddings` table (M107) via the
 * Mini's local ollama (nomic-embed-text, 768-dim) — free, self-hosted, no rate limits. Idempotent:
 * skips docs already embedded for (content_kind='doc_ocr', model); content_hash stored so a future
 * pass can detect changed text. Run ON THE MINI (ollama is local there).
 *
 *   LIMIT=20 node scripts/embed-documents.mjs        # smoke test
 *   nohup node scripts/embed-documents.mjs &          # full ~75K drip
 */
import dotenv from 'dotenv'; import crypto from 'node:crypto'; import pg from 'pg';
dotenv.config();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const OLLAMA = process.env.OLLAMA_URL || 'http://localhost:11434/api/embeddings';
const MODEL = process.env.EMBED_MODEL || 'nomic-embed-text';
const LIMIT = parseInt(process.env.LIMIT || '0', 10);
const BATCH = 500;

async function embed(text) {
  const r = await fetch(OLLAMA, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: MODEL, prompt: text.slice(0, 6000) }) });
  if (!r.ok) throw new Error('ollama ' + r.status);
  const j = await r.json();
  return j.embedding;
}

(async () => {
  let lastId = 0, done = 0, skip = 0, err = 0, batches = 0;
  console.log(`embed-documents: model=${MODEL} ${LIMIT ? 'LIMIT=' + LIMIT : '(full)'}`);
  for (;;) {
    const { rows } = await pool.query(
      `SELECT id, ocr_text FROM person_documents
       WHERE ocr_text IS NOT NULL AND length(ocr_text) > 40 AND id > $1
       ORDER BY id LIMIT $2`, [lastId, BATCH]);
    if (!rows.length) break;
    lastId = rows[rows.length - 1].id;
    const existing = new Set((await pool.query(
      `SELECT subject_id FROM embeddings WHERE subject_table='person_documents' AND content_kind='doc_ocr' AND model=$1
       AND subject_id = ANY($2::text[])`, [MODEL, rows.map(r => String(r.id))])).rows.map(r => r.subject_id));
    for (const d of rows) {
      if (existing.has(String(d.id))) { skip++; continue; }
      try {
        const emb = await embed(d.ocr_text);
        if (!Array.isArray(emb) || emb.length !== 768) { err++; continue; }
        const vec = '[' + emb.join(',') + ']';
        const hash = crypto.createHash('sha256').update(d.ocr_text).digest('hex');
        await pool.query(
          `INSERT INTO embeddings (subject_table, subject_id, content_kind, model, embedding, content_hash)
           VALUES ('person_documents', $1, 'doc_ocr', $2, $3::vector, $4)
           ON CONFLICT (subject_table, subject_id, content_kind, model) DO NOTHING`,
          [String(d.id), MODEL, vec, hash]);
        done++;
      } catch (e) { err++; }
      if (LIMIT && done >= LIMIT) break;
    }
    batches++;
    if (batches % 4 === 0) console.log(`  ...id<=${lastId} embedded=${done} skipped=${skip} err=${err}`);
    if (LIMIT && done >= LIMIT) break;
  }
  const tot = (await pool.query(`SELECT count(*) c FROM embeddings WHERE content_kind='doc_ocr' AND model=$1`, [MODEL])).rows[0].c;
  console.log(`done: embedded ${done}, skipped ${skip}, err ${err}. total doc_ocr embeddings: ${(+tot).toLocaleString()}`);
  await pool.end();
})();
