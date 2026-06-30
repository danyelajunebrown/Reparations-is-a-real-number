-- Migration 079: add will_extraction_id to person_documents
--
-- Audited as MISSING in Session 52 (docs/will-ingestion-audit-2026-05-12.md §4.2).
-- backfill-inheritance-edges-from-will-extractions.js and the will ingestion
-- pipeline both reference this column; they fail silently without it.
--
-- The column is nullable — not every person_document is a will, and not every
-- will has been run through the extraction pipeline yet.

ALTER TABLE person_documents
  ADD COLUMN IF NOT EXISTS will_extraction_id UUID
    REFERENCES will_extractions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_person_documents_will_extraction_id
  ON person_documents(will_extraction_id)
  WHERE will_extraction_id IS NOT NULL;
