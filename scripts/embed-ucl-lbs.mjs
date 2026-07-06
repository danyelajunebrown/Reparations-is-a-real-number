#!/usr/bin/env node
/**
 * embed-ucl-lbs.mjs — the EMBED phase for the UCL LBS ingest (RULE 0.5: no ingest is complete until its
 * records reach the RAG/search/modal layer). Embeds the LBS person LEADS (unconfirmed_persons carrying a
 * ucl_lbs_person external id) as content_kind='person_profile' into the pgvector `embeddings` table, in
 * the SAME nomic-embed-text space as the doc corpus + RagService — so an LBS slaveholder surfaces in
 * /api/rag/query, name search, and the person-profile modal (not just the relational lbs_* tables).
 *
 * embed-persons.mjs only covers canonical_persons; LBS persons are leads, so this is the lead-scoped twin.
 * Run ON THE MINI (ollama local): EMBED_SOURCE=ollama node scripts/embed-ucl-lbs.mjs
 * Idempotent (ON CONFLICT). LIMIT=N for a slice.
 */
import dotenv from 'dotenv'; import crypto from 'node:crypto'; import pg from 'pg';
dotenv.config();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const SOURCE = process.env.EMBED_SOURCE || 'ollama';
const MODEL = SOURCE === 'gemini' ? 'gemini-embedding-001' : (process.env.EMBED_MODEL || 'nomic-embed-text');
const OLLAMA = process.env.OLLAMA_URL || 'http://localhost:11434/api/embeddings';
const GKEY = process.env.GEMINI_API_KEY;
const LIMIT = parseInt(process.env.LIMIT || '0', 10);
const BATCH = 200, CONC = parseInt(process.env.CONC || '3', 10);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function embedOllama(text) {
  const r = await fetch(OLLAMA, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: MODEL, prompt: text.slice(0, 4000) }) });
  if (!r.ok) throw new Error('embed ' + r.status);
  return (await r.json()).embedding;
}
async function embedGemini(text, a = 0) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GKEY}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: { parts: [{ text: text.slice(0, 4000) }] }, outputDimensionality: 768 }) });
  if ((r.status === 429 || r.status === 503) && a < 6) { await sleep(2000 * (a + 1)); return embedGemini(text, a + 1); }
  if (!r.ok) throw new Error('embed ' + r.status);
  return (await r.json())?.embedding?.values;
}
const embed = SOURCE === 'gemini' ? embedGemini : embedOllama;

// Profile text = name + type + biographical context + the colonies of the person's compensation claims.
const profileText = (p) => [p.full_name, p.person_type, p.context_text,
  p.colonies ? 'colonies: ' + p.colonies : null,
  (p.locations && p.locations.length) ? 'addr: ' + p.locations.slice(0, 2).join('; ') : null]
  .filter(Boolean).join(' | ');

(async () => {
  if (SOURCE === 'gemini' && !GKEY) { console.error('GEMINI_API_KEY not set'); process.exit(2); }
  console.log(`embed-ucl-lbs: source=${SOURCE} model=${MODEL} ${LIMIT ? 'LIMIT=' + LIMIT : '(full)'}`);
  try { const v = await embed('preflight'); if (!Array.isArray(v) || v.length !== 768) throw new Error(`bad dim ${Array.isArray(v) ? v.length : 'n/a'}`); }
  catch (e) { console.error(`FATAL preflight: ${e.message} (is ollama up at ${OLLAMA}? set EMBED_SOURCE=ollama)`); process.exit(3); }

  let lastId = 0, done = 0, skip = 0, err = 0;
  for (;;) {
    // LBS leads = unconfirmed_persons that carry a ucl_lbs_person external id; pull the claim colonies.
    const { rows } = await pool.query(
      `SELECT u.lead_id AS id, u.full_name, u.person_type, u.context_text, u.locations,
              (SELECT string_agg(DISTINCT c.colony, ',') FROM lbs_claim_persons cp
                 JOIN lbs_claims c ON c.claim_ext_id = cp.claim_ext_id
                WHERE cp.subject_table='unconfirmed_persons' AND cp.subject_id = u.lead_id) AS colonies
         FROM unconfirmed_persons u
         JOIN person_external_ids e ON e.subject_table='unconfirmed_persons' AND e.subject_id = u.lead_id
        WHERE e.id_system='ucl_lbs_person' AND u.full_name IS NOT NULL AND u.lead_id > $1
        ORDER BY u.lead_id LIMIT $2`, [lastId, BATCH]);
    if (!rows.length) break;
    lastId = rows[rows.length - 1].id;
    const have = new Set((await pool.query(
      `SELECT subject_id FROM embeddings WHERE subject_table='unconfirmed_persons' AND content_kind='person_profile' AND model=$1 AND subject_id = ANY($2::text[])`,
      [MODEL, rows.map(r => String(r.id))])).rows.map(r => r.subject_id));
    const todo = rows.filter(d => !have.has(String(d.id))); skip += rows.length - todo.length;
    const results = [];
    for (let i = 0; i < todo.length; i += CONC) {
      const chunk = todo.slice(i, i + CONC);
      const embs = await Promise.all(chunk.map(async p => { try { const e = await embed(profileText(p)); return (Array.isArray(e) && e.length === 768) ? { p, e } : null; } catch { return null; } }));
      for (const x of embs) { if (x) results.push(x); else err++; }
      if (LIMIT && done + results.length >= LIMIT) break;
    }
    if (results.length) {
      const sids = [], vecs = [], hashes = [];
      for (const { p, e } of results) { sids.push(String(p.id)); vecs.push('[' + e.join(',') + ']'); hashes.push(crypto.createHash('sha256').update(profileText(p)).digest('hex')); }
      await pool.query(
        `INSERT INTO embeddings (subject_table, subject_id, content_kind, model, embedding, content_hash)
         SELECT 'unconfirmed_persons', u.sid, 'person_profile', $2, u.v::vector, u.h
           FROM unnest($1::text[], $3::text[], $4::text[]) AS u(sid, v, h)
         ON CONFLICT (subject_table, subject_id, content_kind, model) DO NOTHING`, [sids, MODEL, vecs, hashes]);
      done += results.length;
      process.stdout.write(`\r  embedded ${done}, skipped ${skip}, err ${err}   `);
    }
    if (LIMIT && done >= LIMIT) break;
  }
  console.log(`\ndone: embedded ${done}, skipped ${skip}, err ${err}.`);
  await pool.end();
})();
