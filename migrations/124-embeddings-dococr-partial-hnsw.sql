-- Migration 124: partial HNSW index on embeddings for content_kind='doc_ocr'
-- Date: 2026-07-18
--
-- WHY: RagService.retrieve post-filters the vector search by content_kind='doc_ocr' AND model,
-- but the existing full index idx_embeddings_hnsw covers ALL content_kinds. person_profile rows are
-- ~62% of the 219k-row index, so they crowd the HNSW ANN candidate set and get filtered out AFTER
-- the search — leaving too few (often ZERO) doc_ocr rows for a query. Result: a doc that scores 0.79
-- on one query returns nothing on a closely-related one (observed 2026-07-18: "Lewis Morris
-- Morrisania enslaved" → 0 hits though the Morrisania doc is in the corpus).
--
-- A PARTIAL HNSW index whose graph contains ONLY doc_ocr vectors removes the post-filter loss: the
-- ANN search traverses just the retrievable set, so top-k are all valid doc_ocr candidates.
--
-- Companion fix (code): RagService now SETs hnsw.ef_search before the query — on Neon the GUC is
-- unset by default and an unset ef_search makes ANY hnsw index return 0 rows (the root RAG outage).
--
-- All doc_ocr embeddings are 768-dim (nomic-embed-text + gemini-embedding-001, both 768), so the
-- single-column vector index is dimension-consistent. Built CONCURRENTLY out-of-band (HNSW builds are
-- slow + take a heavy lock otherwise); this file documents the DDL and is idempotent/guarded.

CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw_dococr
    ON embeddings USING hnsw (embedding vector_cosine_ops)
    WHERE content_kind = 'doc_ocr';

COMMENT ON INDEX idx_embeddings_hnsw_dococr IS
  'Partial HNSW over doc_ocr embeddings only — the set RagService.retrieve filters to. Avoids the '
  'post-filter recall loss of the full idx_embeddings_hnsw (person_profile crowding). Query still '
  'needs hnsw.ef_search SET (RagService does this); unset ef_search returns 0 rows on Neon.';

-- Drop the over-broad full HNSW index. It covered ALL content_kinds; the planner PREFERRED it for
-- the doc_ocr query's ORDER BY, so its ANN candidate set (~62% person_profile) filtered down to ~0
-- doc_ocr rows — the recall failure this migration exists to fix. With it gone the planner uses the
-- partial index above and retrieval returns full top-k across the whole 83k doc_ocr corpus (verified
-- 2026-07-18: "Lewis Morris Morrisania enslaved" 0→6 hits, Morrisania doc at 0.70).
-- SAFE: person_profile embeddings have NO vector reader (orphan-audit finding #2 — 137k rows nothing
-- reads); RagService is doc_ocr-only. REVERSIBLE: if a person_profile RAG reader is ever added, give
-- IT its own partial index (WHERE content_kind='person_profile') rather than restoring this full one.
DROP INDEX IF EXISTS idx_embeddings_hnsw;
