#!/usr/bin/env node
/**
 * Phase-2d: find semantic person-duplicate candidates from person_profile embeddings (M107) —
 * complements the blocking-key dedup by catching look-alikes the surname/name keys miss. For each
 * embedded person, find its cosine-nearest OTHER person (HNSW); pairs above the threshold are
 * CANDIDATES for human review. Biscoe: never auto-merges — this only surfaces pairs.
 *
 *   node scripts/find-semantic-dup-candidates.mjs                 # report top candidates
 *   THRESHOLD=0.92 LIMIT=40 node scripts/find-semantic-dup-candidates.mjs
 */
import dotenv from 'dotenv'; import pg from 'pg';
dotenv.config();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const MODEL = 'gemini-embedding-001';
const THRESHOLD = parseFloat(process.env.THRESHOLD || '0.90');
const LIMIT = parseInt(process.env.LIMIT || '30', 10);

(async () => {
  const n = (await pool.query(`SELECT count(*) c FROM embeddings WHERE content_kind='person_profile' AND model=$1`, [MODEL])).rows[0].c;
  console.log(`person_profile embeddings: ${(+n).toLocaleString()} | threshold ${THRESHOLD}`);
  // For each person, its single nearest OTHER person (HNSW), keep pairs above threshold, dedup a<b.
  const { rows } = await pool.query(`
    SELECT a.subject_id AS a_id, ca.canonical_name AS a_name, ca.primary_state AS a_st, ca.primary_county AS a_co, ca.person_type a_type,
           n.b_id, cb.canonical_name AS b_name, cb.primary_state AS b_st, cb.primary_county AS b_co, n.sim
    FROM embeddings a
    JOIN canonical_persons ca ON ca.id = a.subject_id::int
    CROSS JOIN LATERAL (
      SELECT b.subject_id AS b_id, 1 - (a.embedding <=> b.embedding) AS sim
      FROM embeddings b
      WHERE b.content_kind='person_profile' AND b.model=$1 AND b.subject_id <> a.subject_id
      ORDER BY a.embedding <=> b.embedding LIMIT 1
    ) n
    JOIN canonical_persons cb ON cb.id = n.b_id::int
    WHERE a.content_kind='person_profile' AND a.model=$1
      AND n.sim >= $2
      AND a.subject_id::int < n.b_id::int
    ORDER BY n.sim DESC
    LIMIT $3`, [MODEL, THRESHOLD, LIMIT]);
  console.log(`\n${rows.length} candidate pair(s) (>= ${THRESHOLD}) — FOR REVIEW, never auto-merged:`);
  rows.forEach(r => console.log(
    `  sim ${(+r.sim).toFixed(3)}  #${r.a_id} "${r.a_name}" (${r.a_co || '?'}/${r.a_st || '?'})  ≈  #${r.b_id} "${r.b_name}" (${r.b_co || '?'}/${r.b_st || '?'})`));
  if (!rows.length) console.log('  (none above threshold in the current embedded slice)');
  await pool.end();
})();
