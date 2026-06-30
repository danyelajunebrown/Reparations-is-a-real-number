-- Migration 107: pgvector + embeddings table (Phase 2 RAG foundation)
-- Plan: memory-bank/plan-phase2-rag.md. Source-agnostic (768-dim works for both ollama
-- nomic-embed-text and Gemini text-embedding-004), M101-style polymorphic subject so leads AND
-- canonicals embed into ONE space (semantic search + cross-pool dedup). `model` records which model
-- produced each row, so a re-embed with a different model coexists rather than clobbering.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS embeddings (
  id            BIGSERIAL PRIMARY KEY,
  subject_table TEXT NOT NULL,          -- canonical_persons | person_documents | unconfirmed_persons | ...
  subject_id    TEXT NOT NULL,
  content_kind  TEXT NOT NULL,          -- doc_ocr | person_profile | ...
  model         TEXT NOT NULL,          -- nomic-embed-text | text-embedding-004 | ...
  embedding     vector(768) NOT NULL,
  content_hash  TEXT,                   -- skip re-embed when source text unchanged
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subject_table, subject_id, content_kind, model)
);

-- Approximate-NN cosine index (HNSW). Empty-table create is instant; it fills as rows insert.
CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw ON embeddings USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_embeddings_subject ON embeddings (subject_table, subject_id);

COMMENT ON TABLE embeddings IS
  'Phase-2 RAG vector store (M107). One row per (subject, content_kind, model). Polymorphic subject
   embeds leads + canonicals in one space; model-tagged so re-embeds coexist. HNSW cosine index.';
