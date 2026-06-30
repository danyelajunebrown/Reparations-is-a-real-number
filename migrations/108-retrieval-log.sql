-- Migration 108: retrieval_log (Phase 2c — the retrieval-feedback loop / RAG-Ops)
-- Plan: memory-bank/plan-phase2-rag.md. Every RAG retrieval logs what it retrieved, the top
-- similarity (retrieval confidence), what the LLM cited, and whether the answer was grounded — so
-- aggregate metrics surface corpus gaps (low-similarity queries = thin coverage → what to embed/
-- ingest next) and groundedness trends. This is the measurement that lets retrieval improve from
-- every retrieval; a future re-ranker reads these signals.

CREATE TABLE IF NOT EXISTS retrieval_log (
  id             BIGSERIAL PRIMARY KEY,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  query_text     TEXT,
  k              INTEGER,
  retrieved      JSONB,            -- [{document_id, similarity}]
  top_similarity NUMERIC,          -- max retrieved similarity (retrieval confidence)
  cited          JSONB,            -- [document_id] the LLM actually cited
  cited_count    INTEGER,
  grounded       BOOLEAN,          -- cited_count > 0 (answer grounded in retrieved docs)
  provider       TEXT,             -- which LLM provider answered
  latency_ms     INTEGER
);

CREATE INDEX IF NOT EXISTS idx_retrieval_log_created ON retrieval_log (created_at);
CREATE INDEX IF NOT EXISTS idx_retrieval_log_weak ON retrieval_log (top_similarity) WHERE top_similarity < 0.5;

COMMENT ON TABLE retrieval_log IS
  'Phase-2c RAG-Ops feedback log (M108). One row per RAG retrieval: retrieved docs + similarities,
   citations, groundedness, provider, latency. Drives corpus-gap + groundedness metrics and a future
   re-ranker — the "improves from every retrieval" loop.';
