-- Migration: 016-person-documents-index.sql
-- Purpose: Create junction table linking persons to their source documents (S3 archives)
-- This allows retrieval of ALL documents mentioning a specific individual
-- Example: Find all 15 Ravenel diary pages where "Cato" is mentioned

-- ============================================================================
-- PERSON DOCUMENTS JUNCTION TABLE
-- ============================================================================
-- Links canonical_persons (and unconfirmed_persons) to archived documents
-- Each row = one appearance of a person in a document

CREATE TABLE IF NOT EXISTS person_documents (
    id SERIAL PRIMARY KEY,

    -- Link to canonical identity (preferred, after name resolution)
    canonical_person_id INT REFERENCES canonical_persons(id) ON DELETE SET NULL,

    -- Link to unconfirmed_persons (before resolution, or if never resolved)
    unconfirmed_person_id INT,

    -- The name as it appeared in THIS document (may differ from canonical)
    name_as_appears VARCHAR(255) NOT NULL,

    -- Document archive location
    s3_url TEXT,                          -- Full S3 URL to archived image
    s3_key TEXT,                          -- S3 key for programmatic access

    -- Original source reference
    source_url TEXT,                      -- Original source URL (e.g., FamilySearch page)
    source_type VARCHAR(100),             -- familysearch, msa_archive, ancestry, etc.

    -- Document identification within collection
    collection_name VARCHAR(255),         -- e.g., "Thomas Porcher Ravenel papers - Film 7"
    film_number VARCHAR(50),              -- e.g., "008891450"
    image_number INT,                     -- Image number within film/collection
    page_reference VARCHAR(100),          -- Page number if available

    -- Content extracted from document
    ocr_text TEXT,                        -- Full OCR text from this document
    context_snippet TEXT,                 -- Text immediately surrounding the name mention

    -- Classification
    person_type VARCHAR(50),              -- enslaved, enslaver, freedperson, witness, etc.
    document_type VARCHAR(100),           -- diary, ledger, will, deed, inventory, census, etc.

    -- Document date (if determinable)
    document_date DATE,
    document_year INT,

    -- Confidence and verification
    extraction_confidence DECIMAL(3,2) DEFAULT 0.70,
    human_verified BOOLEAN DEFAULT FALSE,
    verified_by VARCHAR(100),
    verified_at TIMESTAMP,

    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    created_by VARCHAR(100) DEFAULT 'system'
);

-- Unique index that handles NULL values properly
CREATE UNIQUE INDEX IF NOT EXISTS idx_person_documents_unique
ON person_documents (
    COALESCE(canonical_person_id, -1),
    COALESCE(unconfirmed_person_id, -1),
    COALESCE(s3_url, ''),
    name_as_appears
);

-- ============================================================================
-- INDEXES FOR EFFICIENT QUERYING
-- ============================================================================

-- Find all documents for a canonical person
CREATE INDEX IF NOT EXISTS idx_person_docs_canonical
ON person_documents(canonical_person_id) WHERE canonical_person_id IS NOT NULL;

-- Find all documents for an unconfirmed person
CREATE INDEX IF NOT EXISTS idx_person_docs_unconfirmed
ON person_documents(unconfirmed_person_id) WHERE unconfirmed_person_id IS NOT NULL;

-- Search by name as it appears
CREATE INDEX IF NOT EXISTS idx_person_docs_name
ON person_documents(name_as_appears);

-- Search by S3 URL (find who's in a document)
CREATE INDEX IF NOT EXISTS idx_person_docs_s3
ON person_documents(s3_url) WHERE s3_url IS NOT NULL;

-- Filter by collection
CREATE INDEX IF NOT EXISTS idx_person_docs_collection
ON person_documents(collection_name);

-- Filter by film and image
CREATE INDEX IF NOT EXISTS idx_person_docs_film_image
ON person_documents(film_number, image_number);

-- Filter by source type
CREATE INDEX IF NOT EXISTS idx_person_docs_source_type
ON person_documents(source_type);

-- Filter by document year
CREATE INDEX IF NOT EXISTS idx_person_docs_year
ON person_documents(document_year) WHERE document_year IS NOT NULL;

-- Full-text search on OCR content
CREATE INDEX IF NOT EXISTS idx_person_docs_ocr_gin
ON person_documents USING gin(to_tsvector('english', COALESCE(ocr_text, '')));

-- ============================================================================
-- HELPER VIEWS
-- ============================================================================

-- View: All documents for a person with canonical name
CREATE OR REPLACE VIEW person_documents_with_names AS
SELECT
    pd.id,
    pd.canonical_person_id,
    cp.canonical_name,
    pd.unconfirmed_person_id,
    pd.name_as_appears,
    pd.s3_url,
    pd.source_url,
    pd.collection_name,
    pd.film_number,
    pd.image_number,
    pd.document_type,
    pd.document_year,
    pd.context_snippet,
    pd.person_type,
    pd.extraction_confidence,
    pd.human_verified,
    pd.created_at
FROM person_documents pd
LEFT JOIN canonical_persons cp ON pd.canonical_person_id = cp.id;

-- View: Document count per canonical person
CREATE OR REPLACE VIEW person_document_counts AS
SELECT
    cp.id AS canonical_person_id,
    cp.canonical_name,
    cp.person_type,
    COUNT(pd.id) AS document_count,
    MIN(pd.document_year) AS earliest_year,
    MAX(pd.document_year) AS latest_year,
    array_agg(DISTINCT pd.collection_name) AS collections,
    array_agg(DISTINCT pd.s3_url) AS s3_urls
FROM canonical_persons cp
LEFT JOIN person_documents pd ON cp.id = pd.canonical_person_id
GROUP BY cp.id, cp.canonical_name, cp.person_type;

-- View: All persons mentioned in a specific document (by S3 URL)
CREATE OR REPLACE VIEW document_persons AS
SELECT
    pd.s3_url,
    pd.collection_name,
    pd.film_number,
    pd.image_number,
    array_agg(DISTINCT pd.name_as_appears) AS names_mentioned,
    array_agg(DISTINCT COALESCE(cp.canonical_name, pd.name_as_appears)) AS canonical_names,
    COUNT(DISTINCT pd.id) AS person_mentions
FROM person_documents pd
LEFT JOIN canonical_persons cp ON pd.canonical_person_id = cp.id
GROUP BY pd.s3_url, pd.collection_name, pd.film_number, pd.image_number;

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function: Get all S3 documents for a person by name (fuzzy search)
CREATE OR REPLACE FUNCTION get_person_documents(search_name TEXT)
RETURNS TABLE (
    canonical_person_id INT,
    canonical_name VARCHAR,
    s3_url TEXT,
    collection_name VARCHAR,
    image_number INT,
    document_year INT,
    context_snippet TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT
        pd.canonical_person_id,
        cp.canonical_name,
        pd.s3_url,
        pd.collection_name,
        pd.image_number,
        pd.document_year,
        pd.context_snippet
    FROM person_documents pd
    LEFT JOIN canonical_persons cp ON pd.canonical_person_id = cp.id
    WHERE
        pd.name_as_appears ILIKE '%' || search_name || '%'
        OR cp.canonical_name ILIKE '%' || search_name || '%'
    ORDER BY pd.collection_name, pd.image_number;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE person_documents IS 'Junction table linking persons to archived documents. Enables retrieval of all documents mentioning an individual.';
COMMENT ON COLUMN person_documents.canonical_person_id IS 'Link to canonical_persons after name resolution';
COMMENT ON COLUMN person_documents.unconfirmed_person_id IS 'Link to unconfirmed_persons before resolution';
COMMENT ON COLUMN person_documents.name_as_appears IS 'The exact name as it appeared in this document (may differ from canonical due to OCR/spelling)';
COMMENT ON COLUMN person_documents.s3_url IS 'Full S3 URL to the archived document image';
COMMENT ON COLUMN person_documents.context_snippet IS 'Text immediately surrounding the name mention for quick preview';

-- Success message
SELECT 'Migration 016 completed: person_documents junction table created' AS status;
