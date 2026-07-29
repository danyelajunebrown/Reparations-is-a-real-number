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
const MODEL = process.env.EMBED_MODEL || 'nomic-embed-text';
const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/embeddings';
if (!LIKE) { console.error('usage: --like <substr> [--limit N] [--chars 800] [--overlap 150] [--apply]'); process.exit(1); }

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

async function embed(text) {
  const r = await fetch(OLLAMA, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: String(text).slice(0, 6000) }), signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error('ollama ' + r.status);
  return (await r.json()).embedding;
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const { rows } = await pool.query(
    `SELECT id, ocr_text FROM person_documents
      WHERE (collection_key ILIKE $1 OR source_url ILIKE $1 OR ocr_text ILIKE $1)
        AND length(COALESCE(ocr_text,'')) > ${CHARS}
      ORDER BY id ${Number.isFinite(LIMIT) ? 'LIMIT ' + LIMIT : ''}`, ['%' + LIKE + '%']);
  console.log(`chunked re-embed: ${rows.length} docs like "${LIKE}" · model=${MODEL} · ollama=${OLLAMA} · ${CHARS}c/${OVERLAP}ov${APPLY ? '' : ' [DRY-RUN]'}`);
  let docs = 0, chunks = 0, skipped = 0, err = 0;
  for (const d of rows) {
    const passages = chunk(d.ocr_text);
    if (!passages.length) { skipped++; continue; }
    docs++;
    for (let i = 0; i < passages.length; i++) {
      const ci = i + 1; // chunk_index 0 reserved for any legacy whole-doc row
      if (!APPLY) { chunks++; continue; }
      try {
        const already = (await pool.query(
          `SELECT 1 FROM embeddings WHERE subject_table='person_documents' AND subject_id=$1 AND content_kind='doc_ocr' AND model=$2 AND chunk_index=$3`,
          [String(d.id), MODEL, ci])).rows.length;
        if (already) { chunks++; continue; }
        const vec = await embed(passages[i]);
        await pool.query(
          `INSERT INTO embeddings (subject_table, subject_id, content_kind, model, embedding, content_hash, chunk_index)
           VALUES ('person_documents',$1,'doc_ocr',$2,$3::vector,$4,$5)
           ON CONFLICT (subject_table, subject_id, content_kind, model, chunk_index) DO NOTHING`,
          [String(d.id), MODEL, '[' + vec.join(',') + ']', crypto.createHash('sha256').update(passages[i]).digest('hex'), ci]);
        chunks++;
      } catch (e) { err++; if (err <= 3) console.log(`  err doc#${d.id} chunk${ci}: ${e.message.slice(0, 40)}`); }
    }
    if (docs % 50 === 0) process.stdout.write(`\r  ${docs}/${rows.length} docs, ${chunks} chunks   `);
  }
  await pool.end();
  console.log(`\n=== ${docs} docs chunked → ${chunks} passage embeddings${APPLY ? '' : ' (dry-run)'} · skipped ${skipped} · err ${err} ===`);
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
