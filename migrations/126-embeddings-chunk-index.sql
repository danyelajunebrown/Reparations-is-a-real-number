-- 126-embeddings-chunk-index.sql — allow MULTIPLE passage vectors per document (chunked RAG).
-- The retrievability rubric proved whole-doc embedding of long noisy colonial-OCR wills produces diffuse
-- vectors (the Kniffen estate scored 0.45 against a query naming its own contents; it never surfaced).
-- The fix is to embed PASSAGES, not whole docs. But the unique key (subject_table, subject_id, content_kind,
-- model) permits only one vector per doc. Add chunk_index and widen the key so chunks coexist.
-- RagService.retrieve is UNCHANGED-compatible: it reads content_kind='doc_ocr' and returns subject_id
-- (the doc id) — chunks share the doc's subject_id, so retrieval returns the same doc, just with a better
-- (passage-level) match; callers dedupe by document_id.

ALTER TABLE embeddings ADD COLUMN IF NOT EXISTS chunk_index INTEGER NOT NULL DEFAULT 0;

-- widen the uniqueness to include the chunk so passages don't collide (whole-doc rows keep chunk_index=0)
ALTER TABLE embeddings DROP CONSTRAINT IF EXISTS embeddings_subject_table_subject_id_content_kind_model_key;
DROP INDEX IF EXISTS embeddings_subject_table_subject_id_content_kind_model_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_embeddings_subject_kind_model_chunk
  ON embeddings (subject_table, subject_id, content_kind, model, chunk_index);

-- keep the partial HNSW index (doc_ocr) covering the new chunk rows too (it indexes by embedding regardless
-- of chunk_index, so no index change is needed — this comment documents that it still applies).
