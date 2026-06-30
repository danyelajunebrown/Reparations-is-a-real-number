#!/usr/bin/env node
/**
 * Phase-2d: embed canonical_persons "profile text" (name + type + place + birth + sex) into the
 * pgvector `embeddings` table (content_kind='person_profile', gemini-embedding-001, 768-dim) so
 * cosine-nearest pairs can surface semantic dedup candidates that blocking keys miss (Biscoe:
 * candidates only — never auto-merge). Idempotent. LIMIT for a demo slice; full ~678K is a deferred
 * background drip (run AFTER the doc corpus so it doesn't split the free-tier quota).
 *
 *   LIMIT=150 node scripts/embed-persons.mjs       # demo slice
 *   nohup node scripts/embed-persons.mjs &          # full (after doc corpus done)
 */
import dotenv from 'dotenv'; import crypto from 'node:crypto'; import pg from 'pg';
dotenv.config();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const GKEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-embedding-001';
const LIMIT = parseInt(process.env.LIMIT || '0', 10);
const BATCH = 200, CONC = parseInt(process.env.CONC || '8', 10);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function embed(text, attempt = 0) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent?key=${GKEY}`,
    { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: `models/${MODEL}`, content: { parts: [{ text: text.slice(0, 4000) }] }, outputDimensionality: 768 }) });
  if ((r.status === 429 || r.status === 503) && attempt < 6) { await sleep(2000 * (attempt + 1)); return embed(text, attempt + 1); }
  if (!r.ok) throw new Error('embed ' + r.status);
  return (await r.json())?.embedding?.values;
}
const profileText = (p) => [p.canonical_name, p.person_type, p.primary_state, p.primary_county,
  p.birth_year_estimate ? 'b.' + p.birth_year_estimate : null, p.sex].filter(Boolean).join(' | ');

(async () => {
  if (!GKEY) { console.error('GEMINI_API_KEY not set'); process.exit(2); }
  let lastId = 0, done = 0, skip = 0, err = 0, batches = 0;
  console.log(`embed-persons: model=${MODEL} ${LIMIT ? 'LIMIT=' + LIMIT : '(full)'}`);
  for (;;) {
    const { rows } = await pool.query(
      `SELECT id, canonical_name, person_type, primary_state, primary_county, birth_year_estimate, sex
       FROM canonical_persons WHERE canonical_name IS NOT NULL AND length(trim(canonical_name))>1
         AND person_type <> 'merged' AND id > $1 ORDER BY id LIMIT $2`, [lastId, BATCH]);
    if (!rows.length) break;
    lastId = rows[rows.length - 1].id;
    const have = new Set((await pool.query(
      `SELECT subject_id FROM embeddings WHERE subject_table='canonical_persons' AND content_kind='person_profile' AND model=$1
       AND subject_id = ANY($2::text[])`, [MODEL, rows.map(r => String(r.id))])).rows.map(r => r.subject_id));
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
         SELECT 'canonical_persons', u.sid, 'person_profile', $2, u.v::vector, u.h
           FROM unnest($1::text[], $3::text[], $4::text[]) AS u(sid, v, h)
         ON CONFLICT (subject_table, subject_id, content_kind, model) DO NOTHING`, [sids, MODEL, vecs, hashes]);
      done += results.length;
    }
    batches++;
    if (LIMIT && done >= LIMIT) break;
  }
  const tot = (await pool.query(`SELECT count(*) c FROM embeddings WHERE content_kind='person_profile' AND model=$1`, [MODEL])).rows[0].c;
  console.log(`done: embedded ${done}, skipped ${skip}, err ${err}. total person_profile: ${(+tot).toLocaleString()}`);
  await pool.end();
})();
