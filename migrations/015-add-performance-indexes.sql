-- Migration: Add Performance Indexes
-- Purpose: Improve query performance for stats and search operations
-- Date: 2025-12-14

-- Index for person_type filtering in stats queries
CREATE INDEX IF NOT EXISTS idx_unconfirmed_persons_type 
ON unconfirmed_persons(person_type);

-- Index for full_name searches
CREATE INDEX IF NOT EXISTS idx_unconfirmed_persons_name 
ON unconfirmed_persons(full_name);

-- Combined index for common queries (type + name)
CREATE INDEX IF NOT EXISTS idx_unconfirmed_persons_type_name 
ON unconfirmed_persons(person_type, full_name);

-- Index for documents owner search
CREATE INDEX IF NOT EXISTS idx_documents_owner 
ON documents(owner_name);

-- Index for documents by type
CREATE INDEX IF NOT EXISTS idx_documents_type 
ON documents(doc_type);

-- Index for source_url grouping in stats
CREATE INDEX IF NOT EXISTS idx_unconfirmed_persons_source 
ON unconfirmed_persons(source_url);

COMMENT ON INDEX idx_unconfirmed_persons_type IS 'Speeds up stats queries filtering by person_type';
COMMENT ON INDEX idx_unconfirmed_persons_name IS 'Speeds up name-based searches';
COMMENT ON INDEX idx_unconfirmed_persons_type_name IS 'Composite index for filtered searches';
COMMENT ON INDEX idx_documents_owner IS 'Speeds up document search by owner name';
COMMENT ON INDEX idx_documents_type IS 'Speeds up document filtering by type';
COMMENT ON INDEX idx_unconfirmed_persons_source IS 'Speeds up stats queries counting unique sources';
