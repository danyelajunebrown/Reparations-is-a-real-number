#!/usr/bin/env node
/**
 * embed-leads.mjs — source-agnostic EMBED phase (RULE 0.5) for any lead cohort identified by id_system.
 * Embeds unconfirmed_persons "profile text" (name + type + context) into the pgvector `embeddings` table
 * (content_kind='person_profile', nomic-embed-text, 768-dim) so the leads reach RAG/search/modals.
 * Generalizes embed-ucl-lbs.mjs. Idempotent (ON CONFLICT). Resumable (id cursor). Run on the Mini (ollama).
 *
 *   EMBED_SOURCE=ollama node scripts/embed-leads.mjs --id-system enslaved_org_qid
 *   flags: --id-system <sys> (required) · LIMIT=N env for a slice
 */
import dotenv from 'dotenv'; import crypto from 'node:crypto'; import pg from 'pg';
dotenv.config();
const IDSYS = (() => { const i = process.argv.indexOf('--id-system'); return i > -1 ? process.argv[i + 1] : null; })();
// Some cohorts (e.g. freedmens depositors) have NO person_external_ids — they're keyed by extraction_method.
const XMETHOD = (() => { const i = process.argv.indexOf('--extraction-method'); return i > -1 ? process.argv[i + 1] : null; })();
if (!IDSYS && !XMETHOD) { console.error('usage: node scripts/embed-leads.mjs (--id-system <sys> | --extraction-method <m[,m2]>)'); process.exit(1); }
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const SOURCE = process.env.EMBED_SOURCE || 'ollama';
const MODEL = SOURCE === 'gemini' ? 'gemini-embedding-001' : (process.env.EMBED_MODEL || 'nomic-embed-text');
const OLLAMA = process.env.OLLAMA_URL || 'http://localhost:11434/api/embeddings';
const LIMIT = parseInt(process.env.LIMIT || '0', 10);
const BATCH = 200, CONC = parseInt(process.env.CONC || '3', 10);

async function embed(text) {
  const r = await fetch(OLLAMA, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: MODEL, prompt: text.slice(0, 4000) }) });
  if (!r.ok) throw new Error('embed ' + r.status);
  return (await r.json()).embedding;
}
const profileText = (p) => [p.full_name, p.person_type, p.context_text,
  (p.locations && p.locations.length) ? 'addr: ' + p.locations.slice(0, 2).join('; ') : null].filter(Boolean).join(' | ');

(async () => {
  console.log(`embed-leads: ${XMETHOD ? 'extraction_method=' + XMETHOD : 'id_system=' + IDSYS} source=${SOURCE} model=${MODEL} ${LIMIT ? 'LIMIT=' + LIMIT : '(full)'}`);
  try { const v = await embed('preflight'); if (!Array.isArray(v) || v.length !== 768) throw new Error(`bad dim ${Array.isArray(v) ? v.length : 'n/a'}`); }
  catch (e) { console.error(`FATAL preflight: ${e.message} (is ollama up at ${OLLAMA}?)`); process.exit(3); }
  let lastId = 0, done = 0, skip = 0, err = 0;
  for (;;) {
    const { rows } = await pool.query(
      XMETHOD
        ? `SELECT u.lead_id AS id, u.full_name, u.person_type, u.context_text, u.locations
             FROM unconfirmed_persons u
            WHERE u.extraction_method = ANY($1::text[]) AND u.full_name IS NOT NULL AND u.lead_id > $2
            ORDER BY u.lead_id LIMIT $3`
        : `SELECT u.lead_id AS id, u.full_name, u.person_type, u.context_text, u.locations
             FROM unconfirmed_persons u
             JOIN person_external_ids e ON e.subject_table='unconfirmed_persons' AND e.subject_id = u.lead_id
            WHERE e.id_system=$1 AND u.full_name IS NOT NULL AND u.lead_id > $2
            ORDER BY u.lead_id LIMIT $3`,
      [XMETHOD ? XMETHOD.split(',') : IDSYS, lastId, BATCH]);
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
    }
    if (results.length) {
      const sids = [], vecs = [], hashes = [];
      for (const { p, e } of results) { sids.push(String(p.id)); vecs.push('[' + e.join(',') + ']'); hashes.push(crypto.createHash('sha256').update(profileText(p)).digest('hex')); }
      await pool.query(
        `INSERT INTO embeddings (subject_table, subject_id, content_kind, model, embedding, content_hash)
         SELECT 'unconfirmed_persons', u.sid, 'person_profile', $2, u.v::vector, u.h
           FROM unnest($1::text[], $3::text[], $4::text[]) AS u(sid, v, h)
         ON CONFLICT (subject_table, subject_id, content_kind, model, chunk_index) DO NOTHING`, [sids, MODEL, vecs, hashes]);
      done += results.length;
      if (done % 1000 < CONC) process.stdout.write(`\r  embedded ${done}, skipped ${skip}, err ${err}   `);
    }
    if (LIMIT && done >= LIMIT) break;
  }
  console.log(`\ndone: embedded ${done}, skipped ${skip}, err ${err}.`);
  await pool.end();
})();
