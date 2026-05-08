-- Migration 064: Collection grouping for person_documents
--
-- Context: person_documents currently stores individual pages/files with no
-- indication that multiple rows belong to the same physical source document.
-- A DC Emancipation petition may have 8 image pages archived to S3; they all
-- appear as unlabeled anonymous boxes on the person page.
--
-- This migration adds:
--   collection_name       — human-readable document title shown in the UI
--   collection_key        — machine key for grouping (docket number, ARK slug, etc.)
--   collection_page_number — page position within the collection (1-based)
--   collection_page_count — total pages in the collection (denormalized for speed)
--   source_type_label     — friendly label for the source type (shown in UI)
--
-- Usage: psql $DATABASE_URL -f migrations/064-person-documents-collection-grouping.sql

-- Step 1: Add columns (all idempotent)
ALTER TABLE person_documents
    ADD COLUMN IF NOT EXISTS collection_name        TEXT,
    ADD COLUMN IF NOT EXISTS collection_key         TEXT,
    ADD COLUMN IF NOT EXISTS collection_page_number INTEGER DEFAULT 1,
    ADD COLUMN IF NOT EXISTS collection_page_count  INTEGER DEFAULT 1,
    ADD COLUMN IF NOT EXISTS source_type_label      TEXT;

-- Step 2: Index for grouping queries
CREATE INDEX IF NOT EXISTS idx_person_documents_collection_key
    ON person_documents (collection_key)
    WHERE collection_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_person_documents_collection_canonical
    ON person_documents (canonical_person_id, collection_key)
    WHERE collection_key IS NOT NULL;

-- Step 3: Report current state
SELECT
    COUNT(*)                                                   AS total_rows,
    COUNT(*) FILTER (WHERE collection_name IS NOT NULL)        AS already_has_collection_name,
    COUNT(*) FILTER (WHERE title IS NOT NULL)                  AS already_has_title,
    COUNT(*) FILTER (WHERE s3_key IS NOT NULL)                 AS has_s3_key,
    COUNT(*) FILTER (WHERE document_type = 'certificate_of_freedom') AS msa_certs,
    COUNT(*) FILTER (WHERE document_type = 'freedmens_bank')   AS freedmens_bank
FROM person_documents;
