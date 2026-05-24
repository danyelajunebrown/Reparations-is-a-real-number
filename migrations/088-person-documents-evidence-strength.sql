-- Add evidence_strength to person_documents so the frontend can render
-- Primary vs Secondary sources distinctly.
--
-- Motivation: a May 2026 audit surfaced 314,045 FamilySearch /ark:/ records
-- that the live API was about to label as "Primary source." Every one is in
-- fact a transcribed index entry (secondary). This column lets the page
-- separate primary and secondary cleanly, and lets the upload form record an
-- explicit tier per contribution.
--
-- Vocabulary mirrors enslaver_evidence_compendium.evidence_strength so the
-- two can be joined or compared directly:
--   direct_primary       — original record: courthouse scan, ledger image,
--                          census scan, deed from the archive
--   indirect_primary     — indexed/transcribed-but-curated record citing an
--                          original (FamilySearch /ark:/ index, etc.)
--   secondary_published  — republished compilations: Heritage Books, scholarly
--                          editions, the Isaac Franklin estate book
--   secondary_database   — online datasets: SlaveVoyages, Hall Louisiana DB
--   tertiary_aggregate   — derivative summaries, our own derived records
--   unverified           — awaiting human review
-- NULL is permitted and is treated by the UI as "unverified."
--
-- See memory-bank/plan-source-classification.md for full design notes.

ALTER TABLE person_documents
    ADD COLUMN IF NOT EXISTS evidence_strength VARCHAR(32);

COMMENT ON COLUMN person_documents.evidence_strength IS
    'direct_primary | indirect_primary | secondary_published | secondary_database | tertiary_aggregate | unverified | NULL — see migrations/088 header for definitions';

-- Partial index — most existing rows will be NULL until the backfill runs.
CREATE INDEX IF NOT EXISTS idx_person_docs_evidence_strength
    ON person_documents(evidence_strength)
    WHERE evidence_strength IS NOT NULL;
