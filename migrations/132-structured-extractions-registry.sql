-- 132 — structured_extractions: the unified per-source-type extraction ledger.
--
-- WHY: reocr-holdings-monitor is filling ocr_text on ~236K de-siloed images. Nothing routes that text to a
-- per-source-type STRUCTURED extractor (the free analog of a custom DocAI processor per source type — user
-- directive 2026-08-08, "doc ai is the way [but] no paid"). This table is the single normalized landing zone
-- for text→typed-fields across ALL source types (freedmens depositor forms, probate/will estates, census
-- schedules, generic records), produced by the FREE multi-provider LLM router (probate-llm-extractor.callLLM).
-- Promotion to canonical_persons/edges stays with the gated, Biscoe-safe promoters — this table feeds them.

CREATE TABLE IF NOT EXISTS structured_extractions (
  id                 BIGSERIAL PRIMARY KEY,
  person_document_id BIGINT,                 -- person_documents.id the text came from
  s3_key             TEXT,
  source_type        TEXT NOT NULL,          -- freedmens | probate | will | census_slave_schedule | generic
  fields             JSONB NOT NULL,         -- the per-source structured output (schema varies by source_type)
  model              TEXT,                   -- provider:model that produced it (audit: no model output is summed)
  n_persons          INT DEFAULT 0,          -- quick count of named persons found (monitoring / validation)
  validated          BOOLEAN DEFAULT FALSE,  -- passed the light per-source validity check
  promoted           BOOLEAN DEFAULT FALSE,  -- has been turned into persons/edges by a downstream promoter
  note               TEXT,
  created_at         TIMESTAMPTZ DEFAULT now()
);
-- one extraction per (doc, source_type) — re-running is idempotent (the driver skips docs already present)
CREATE UNIQUE INDEX IF NOT EXISTS uq_structured_extractions_doc_type ON structured_extractions(person_document_id, source_type);
CREATE INDEX IF NOT EXISTS idx_structured_extractions_type     ON structured_extractions(source_type);
CREATE INDEX IF NOT EXISTS idx_structured_extractions_unprom   ON structured_extractions(promoted) WHERE promoted = FALSE;

COMMENT ON TABLE structured_extractions IS
  'Unified text→typed-fields ledger from run-source-extraction.mjs. One row per (person_document, source_type). Extraction is FREE (multi-provider LLM router); promotion to canonical_persons is a separate gated step.';
