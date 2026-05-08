-- Migration 065: Add missing columns to person_documents table
-- Fixes: "column "filename" of relation "person_documents" does not exist"
-- Required by src/api/routes/wills.js INSERT statement

ALTER TABLE person_documents
    ADD COLUMN IF NOT EXISTS filename   TEXT,
    ADD COLUMN IF NOT EXISTS file_size  BIGINT,
    ADD COLUMN IF NOT EXISTS mime_type  TEXT,
    ADD COLUMN IF NOT EXISTS s3_url     TEXT;

-- Index for fast lookups by S3 key / URL
CREATE INDEX IF NOT EXISTS idx_person_documents_s3_url
    ON person_documents (s3_url);
