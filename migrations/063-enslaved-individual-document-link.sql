-- Migration 063: Direct FK from person_documents to enslaved_individuals
-- 
-- Context: The current query for enslaved_individual documents goes via
-- enslaved_by_individual_id → canonical_person_id → person_documents.
-- This two-hop join works but misses cases where an enslaved person has
-- documents linked by a different path (e.g. a different canonical_person_id).
--
-- This migration adds an enslaved_individual_id column to person_documents
-- and backfills it by name-matching name_as_appears against enslaved_individuals.
--
-- Usage: psql $DATABASE_URL -f migrations/063-enslaved-individual-document-link.sql

-- Step 1: Add column (idempotent)
ALTER TABLE person_documents
    ADD COLUMN IF NOT EXISTS enslaved_individual_id VARCHAR(50);

-- Step 2: Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_person_documents_enslaved_individual_id
    ON person_documents (enslaved_individual_id)
    WHERE enslaved_individual_id IS NOT NULL;

-- Step 3: Backfill by name match within the same enslaver's documents
-- Match: person_documents.name_as_appears ≈ enslaved_individuals.full_name
--        AND person_documents.canonical_person_id = enslaved_individuals.enslaved_by_individual_id
UPDATE person_documents pd
SET enslaved_individual_id = ei.enslaved_id
FROM enslaved_individuals ei
WHERE pd.enslaved_individual_id IS NULL
  AND pd.canonical_person_id = ei.enslaved_by_individual_id
  AND pd.name_as_appears ILIKE '%' || ei.full_name || '%';

-- Step 4: Report results
SELECT
    COUNT(*) FILTER (WHERE enslaved_individual_id IS NOT NULL) AS linked,
    COUNT(*) FILTER (WHERE enslaved_individual_id IS NULL)     AS unlinked,
    COUNT(*)                                                   AS total
FROM person_documents;
