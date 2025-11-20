-- Schema Changes to Support Enslaved-Person-Primary Documents
-- Run this to update the database

-- Make owner_name optional (some documents center enslaved people)
ALTER TABLE documents
  ALTER COLUMN owner_name DROP NOT NULL;

-- Add fields to track document subject
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS primary_subject_type VARCHAR(50) DEFAULT 'owner', -- 'owner' or 'enslaved'
  ADD COLUMN IF NOT EXISTS enslaved_individual_id VARCHAR(255) REFERENCES enslaved_individuals(enslaved_id) ON DELETE SET NULL;

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_documents_enslaved_individual ON documents(enslaved_individual_id);
CREATE INDEX IF NOT EXISTS idx_documents_subject_type ON documents(primary_subject_type);

-- Add spouse tracking to enslaved_individuals if not exists
ALTER TABLE enslaved_individuals
  ADD COLUMN IF NOT EXISTS spouse_name VARCHAR(500);

COMMENT ON COLUMN documents.primary_subject_type IS 'Who this document primarily concerns: owner or enslaved person';
COMMENT ON COLUMN documents.enslaved_individual_id IS 'Direct link to enslaved_individuals when they are the primary subject';

-- View for enslaved-person-centric documents
CREATE OR REPLACE VIEW enslaved_person_documents AS
SELECT
  d.document_id,
  d.doc_type,
  d.filename,
  d.primary_subject_type,
  ei.enslaved_id,
  ei.full_name as enslaved_person_name,
  ei.birth_year,
  ei.death_year,
  ei.gender,
  ei.spouse_name,
  d.owner_name as enslaver_name,
  d.owner_location as location,
  d.created_at
FROM documents d
LEFT JOIN enslaved_individuals ei ON d.enslaved_individual_id = ei.enslaved_id
WHERE d.primary_subject_type = 'enslaved'
ORDER BY d.created_at DESC;

COMMENT ON VIEW enslaved_person_documents IS 'Documents where an enslaved person is the primary subject (tombstones, certificates, etc)';
