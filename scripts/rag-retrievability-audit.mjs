// rag-retrievability-audit.mjs — THE RUBRIC for "is this cohort of documents actually retrievable by the
// rest of the system?" Embedding is NOT retrievability (the platform-wide RAG outage + the 136k orphaned
// person_profile embeddings proved that). This runs the FULL chain end-to-end on a document cohort and
// reports where it breaks:
//
//   STAGE 1 LOGGED     — the person_documents row exists with the fields the system needs:
//                        ocr_text (>50 chars), s3_key (serves an image), source_url, name_as_appears,
//                        and it is LINKED to a person (canonical or lead). Anything unlinked/textless is
//                        invisible downstream.
//   STAGE 2 EMBEDDED   — an embeddings row exists for the doc.
//   STAGE 3 READABLE   — that embedding's content_kind is one RagService actually reads ('doc_ocr').
//                        person_profile embeddings are embedded-but-unread → fail here.
//   STAGE 4 RETRIEVED  — the LIVE proof: query RagService with a distinctive phrase from the doc and
//                        confirm the doc's own id comes back in the top-K. This is the only stage that
//                        proves the retrieval path (index, ef_search, content_kind filter) actually works.
//
// A cohort is "retrievable" only when STAGE 4 passes at a real rate — not because it was embedded.
// Usage: node scripts/rag-retrievability-audit.mjs --like dutchess [--doc-type will] [--sample 12] [--k 6]

import 'dotenv/config';
import { createRequire } from 'node:module';
import pg from 'pg';
const require = createRequire(import.meta.url);
const RagService = require('../src/services/rag/RagService');

const A = process.argv.slice(2);
const li = A.indexOf('--like'); const LIKE = li > -1 ? A[li + 1] : null;
const dt = A.indexOf('--doc-type'); const DOCTYPE = dt > -1 ? A[dt + 1] : null;
const si = A.indexOf('--sample'); const SAMPLE = si > -1 ? +A[si + 1] : 12;
const ki = A.indexOf('--k'); const K = ki > -1 ? +A[ki + 1] : 8;
if (!LIKE && !DOCTYPE) { console.error('usage: --like <substr> [--doc-type T] [--sample N] [--k N]'); process.exit(1); }

const pct = (n, d) => d ? (100 * n / d).toFixed(1) + '%' : 'n/a';
const distinctivePhrase = (doc) => {
  // build a query the doc should uniquely answer: its named person + a rare token from its text
  const name = (doc.name_as_appears || '').replace(/\s+/g, ' ').trim();
  const toks = (doc.ocr_text || '').split(/\s+/).filter((w) => /^[A-Za-z]{5,}$/.test(w));
  const rare = toks.slice(0, 40).sort(() => 0).find((w) => !/estate|county|which|there|their|shall|being|personal/i.test(w)) || toks[0] || '';
  return [name, rare].filter(Boolean).join(' ').slice(0, 80) || name;
};

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const where = [];
  const params = [];
  if (LIKE) { params.push('%' + LIKE + '%'); where.push(`(d.collection_key ILIKE $${params.length} OR d.source_url ILIKE $${params.length} OR d.ocr_text ILIKE $${params.length})`); }
  if (DOCTYPE) { params.push('%' + DOCTYPE + '%'); where.push(`d.document_type ILIKE $${params.length}`); }
  const W = where.join(' AND ');

  // ── STAGE 1: LOGGED ──
  const s1 = (await pool.query(
    `SELECT count(*)::int total,
       count(*) FILTER (WHERE length(COALESCE(ocr_text,'')) > 50)::int has_text,
       count(*) FILTER (WHERE s3_key IS NOT NULL)::int has_image,
       count(*) FILTER (WHERE COALESCE(source_url,'') <> '')::int has_source,
       count(*) FILTER (WHERE COALESCE(name_as_appears,'') <> '')::int has_name,
       count(*) FILTER (WHERE canonical_person_id IS NOT NULL OR unconfirmed_person_id IS NOT NULL)::int linked
     FROM person_documents d WHERE ${W}`, params)).rows[0];
  const N = s1.total;
  console.log(`\n=== RETRIEVABILITY RUBRIC — cohort: ${LIKE ? 'like "' + LIKE + '"' : ''}${DOCTYPE ? ' doc-type "' + DOCTYPE + '"' : ''} (${N} docs) ===`);
  console.log(`STAGE 1 LOGGED:    text ${pct(s1.has_text, N)} · image ${pct(s1.has_image, N)} · source ${pct(s1.has_source, N)} · named ${pct(s1.has_name, N)} · LINKED-to-person ${pct(s1.linked, N)}`);

  // ── STAGE 2/3: EMBEDDED + READABLE ──
  const s23 = (await pool.query(
    `SELECT
       count(DISTINCT d.id) FILTER (WHERE em.subject_id IS NOT NULL)::int embedded,
       count(DISTINCT d.id) FILTER (WHERE em.content_kind = 'doc_ocr')::int readable
     FROM person_documents d
     LEFT JOIN embeddings em ON em.subject_table='person_documents' AND em.subject_id = d.id::text
     WHERE ${W}`, params)).rows[0];
  console.log(`STAGE 2 EMBEDDED:  ${pct(s23.embedded, N)} (${s23.embedded}/${N})`);
  console.log(`STAGE 3 READABLE:  ${pct(s23.readable, N)} embedded as content_kind='doc_ocr' (what RagService reads)`);
  if (s23.embedded > s23.readable) console.log(`   ⚠ ${s23.embedded - s23.readable} embedded but NOT readable (wrong content_kind → invisible to RAG)`);

  // ── STAGE 4: RETRIEVED (live end-to-end) ──
  const samp = (await pool.query(
    `SELECT d.id, d.name_as_appears, d.ocr_text FROM person_documents d
     JOIN embeddings em ON em.subject_table='person_documents' AND em.subject_id=d.id::text AND em.content_kind='doc_ocr'
     WHERE ${W} AND length(COALESCE(d.ocr_text,'')) > 80
     ORDER BY d.id LIMIT $${params.length + 1}`, [...params, SAMPLE])).rows;
  console.log(`STAGE 4 RETRIEVED: live-querying ${samp.length} sampled docs (k=${K})…`);
  let hits = 0, tested = 0;
  if (samp.length) {
    const rag = new RagService(pool);
    for (const doc of samp) {
      const q = distinctivePhrase(doc); if (!q) continue;
      tested++;
      try {
        const r = await rag.retrieve(q, K);   // RagService.retrieve(question, k) — k is a number
        const ids = (r || []).map((x) => String(x.document_id ?? x.subject_id ?? x.id));
        if (ids.includes(String(doc.id))) hits++;
      } catch (e) { if (tested <= 2) console.log(`   retrieve err: ${e.message.slice(0, 50)}`); }
    }
  }
  console.log(`   → doc found in its own top-${K}: ${hits}/${tested} = ${pct(hits, tested)}`);

  // ── VERDICT ──
  const verdict = s1.has_text < N * 0.7 ? 'FAIL@LOGGED (text missing — extraction gap)'
    : s1.linked < N * 0.5 ? 'FAIL@LOGGED (unlinked to persons)'
    : s23.readable < N * 0.7 ? 'FAIL@READABLE (embedded wrong content_kind or not embedded)'
    : (tested && hits < tested * 0.6) ? 'FAIL@RETRIEVED (in RAG but query does not surface it)'
    : 'RETRIEVABLE';
  console.log(`VERDICT: ${verdict}`);
  await pool.end();
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
