-- 131 — OCR provenance + re-OCR ledger. Powers scripts/reocr-holdings-monitor.mjs (RULE 0.7 internal QC).
--
-- WHY: 236,421 of 341,790 s3-backed person_documents have NULL/short ocr_text (2026-08-08 census) — a huge
-- retrieval silo: no ocr_text ⇒ not embeddable ⇒ invisible to RAG/search/modals (RULE 0.5). The re-OCR monitor
-- drips through them, transcribes each archived image with the current best vision model (Qwen2.5-VL-72B via the
-- multi-provider vision-router), fills ocr_text, and re-embeds (local nomic). These columns let the monitor know
-- WHAT model OCR'd each doc and WHEN, so it can re-run when the model improves — "re-OCR everything again and
-- again" is itself the internal monitoring. The ledger is the append-only audit trail of every pass.

ALTER TABLE person_documents ADD COLUMN IF NOT EXISTS ocr_model  TEXT;         -- e.g. 'openrouter-qwen:qwen/qwen2.5-vl-72b-instruct'
ALTER TABLE person_documents ADD COLUMN IF NOT EXISTS ocr_ran_at TIMESTAMPTZ;  -- when ocr_text was last (re)written by the monitor

CREATE TABLE IF NOT EXISTS document_ocr_runs (
  id                 BIGSERIAL PRIMARY KEY,
  person_document_id BIGINT,        -- person_documents.id (not FK-constrained; docs churn during backfills)
  s3_key             TEXT,
  ocr_model          TEXT,          -- provider:model that produced this run's text
  char_len           INT,           -- chars produced this run (0 if the model returned nothing)
  prev_len           INT,           -- chars present before this run (0 if ocr_text was NULL)
  action             TEXT,          -- ocr_filled | ocr_improved | ocr_kept | ocr_failed | skipped
  note               TEXT,
  ran_at             TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doc_ocr_runs_doc ON document_ocr_runs(person_document_id);
CREATE INDEX IF NOT EXISTS idx_doc_ocr_runs_ran ON document_ocr_runs(ran_at DESC);

COMMENT ON TABLE document_ocr_runs IS
  'Append-only audit trail of reocr-holdings-monitor.mjs passes. One row per (doc, run). action=ocr_failed with a recent ran_at is how the monitor avoids re-hammering un-OCRable images (poison-pill guard).';
