-- Migration: 017-document-deduplication.sql
-- Purpose: Add document deduplication detection to prevent split multi-page documents
-- This catches cases like James Hopewell's will being uploaded as 2 separate documents

-- ============================================================================
-- 1. ADD DOCUMENT GROUPING FIELDS
-- ============================================================================
-- These fields help identify when documents belong together

ALTER TABLE documents ADD COLUMN IF NOT EXISTS document_group_id VARCHAR(255);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS page_number INTEGER DEFAULT 1;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_primary_page BOOLEAN DEFAULT TRUE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64);  -- SHA-256 of content
ALTER TABLE documents ADD COLUMN IF NOT EXISTS filename_normalized VARCHAR(500);

COMMENT ON COLUMN documents.document_group_id IS 'Links pages of the same document together';
COMMENT ON COLUMN documents.page_number IS 'Page number within a multi-page document';
COMMENT ON COLUMN documents.is_primary_page IS 'TRUE for the main/first page that holds metadata';
COMMENT ON COLUMN documents.content_hash IS 'SHA-256 hash to detect duplicate content';
COMMENT ON COLUMN documents.filename_normalized IS 'Normalized filename for similarity detection';

-- ============================================================================
-- 2. DUPLICATE DETECTION VIEW
-- ============================================================================
-- Identifies potential duplicate documents based on multiple signals

CREATE OR REPLACE VIEW potential_duplicate_documents AS
SELECT
    d1.document_id AS doc1_id,
    d2.document_id AS doc2_id,
    d1.owner_name,
    d1.doc_type,
    d1.filename AS filename1,
    d2.filename AS filename2,
    d1.file_size AS size1,
    d2.file_size AS size2,
    d1.created_at AS created1,
    d2.created_at AS created2,
    CASE
        -- Same content hash = definite duplicate
        WHEN d1.content_hash IS NOT NULL AND d1.content_hash = d2.content_hash
        THEN 'content_match'

        -- Same owner + same doc type + similar filename = likely same document
        WHEN d1.owner_name = d2.owner_name
             AND d1.doc_type = d2.doc_type
             AND (
                 d1.filename ILIKE '%' || REPLACE(d2.filename, '.pdf', '') || '%'
                 OR d2.filename ILIKE '%' || REPLACE(d1.filename, '.pdf', '') || '%'
                 OR d1.filename ~ 'page.?[0-9]'
                 OR d2.filename ~ 'page.?[0-9]'
             )
        THEN 'filename_similarity'

        -- Same owner + same doc type + uploaded within 24 hours
        WHEN d1.owner_name = d2.owner_name
             AND d1.doc_type = d2.doc_type
             AND ABS(EXTRACT(EPOCH FROM (d1.created_at - d2.created_at))) < 86400
        THEN 'temporal_proximity'

        ELSE 'unknown'
    END AS match_reason,

    ROUND(ABS(d1.file_size - d2.file_size)::numeric / GREATEST(d1.file_size, d2.file_size, 1), 4) AS size_diff_ratio

FROM documents d1
JOIN documents d2 ON d1.document_id < d2.document_id
WHERE (
    -- Same content hash
    (d1.content_hash IS NOT NULL AND d1.content_hash = d2.content_hash)

    -- OR same owner + same doc type with suspicious patterns
    OR (
        d1.owner_name = d2.owner_name
        AND d1.doc_type = d2.doc_type
        AND (
            -- Filename contains page numbers
            d1.filename ~ '(?i)(page|pg|p)[\s\-_]?[0-9]+'
            OR d2.filename ~ '(?i)(page|pg|p)[\s\-_]?[0-9]+'
            -- Or similar base filename
            OR LOWER(REGEXP_REPLACE(d1.filename, '[\-_]?[0-9]+\.pdf$', '', 'i')) =
               LOWER(REGEXP_REPLACE(d2.filename, '[\-_]?[0-9]+\.pdf$', '', 'i'))
            -- Or uploaded same day
            OR DATE(d1.created_at) = DATE(d2.created_at)
        )
    )
);

COMMENT ON VIEW potential_duplicate_documents IS 'Identifies document pairs that may be pages of the same document';

-- ============================================================================
-- 3. DUPLICATE DETECTION FUNCTION
-- ============================================================================
-- Called before inserting new documents to check for potential duplicates

CREATE OR REPLACE FUNCTION check_document_duplicates(
    p_owner_name VARCHAR,
    p_doc_type VARCHAR,
    p_filename VARCHAR,
    p_content_hash VARCHAR DEFAULT NULL
)
RETURNS TABLE (
    existing_document_id VARCHAR,
    match_type VARCHAR,
    confidence DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        d.document_id,
        CASE
            WHEN p_content_hash IS NOT NULL AND d.content_hash = p_content_hash
            THEN 'exact_content_match'::VARCHAR
            WHEN d.owner_name = p_owner_name
                 AND d.doc_type = p_doc_type
                 AND (
                     d.filename ILIKE '%' || REPLACE(p_filename, '.pdf', '') || '%'
                     OR p_filename ILIKE '%' || REPLACE(d.filename, '.pdf', '') || '%'
                 )
            THEN 'filename_match'::VARCHAR
            WHEN d.owner_name = p_owner_name
                 AND d.doc_type = p_doc_type
            THEN 'owner_doctype_match'::VARCHAR
            ELSE 'possible_match'::VARCHAR
        END AS match_type,
        CASE
            WHEN p_content_hash IS NOT NULL AND d.content_hash = p_content_hash THEN 1.00
            WHEN d.owner_name = p_owner_name AND d.doc_type = p_doc_type THEN 0.85
            ELSE 0.50
        END::DECIMAL AS confidence
    FROM documents d
    WHERE
        -- Exact content match
        (p_content_hash IS NOT NULL AND d.content_hash = p_content_hash)
        -- Or same owner and doc type
        OR (d.owner_name ILIKE p_owner_name AND d.doc_type = p_doc_type)
    ORDER BY confidence DESC
    LIMIT 5;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_document_duplicates IS 'Checks for potential duplicate documents before insertion';

-- ============================================================================
-- 4. DOCUMENT MERGE FUNCTION
-- ============================================================================
-- Consolidates multiple pages into a single document record

CREATE OR REPLACE FUNCTION merge_document_pages(
    p_primary_document_id VARCHAR,
    p_page_document_ids VARCHAR[]
)
RETURNS BOOLEAN AS $$
DECLARE
    v_page_id VARCHAR;
    v_page_num INTEGER := 2;
    v_total_size BIGINT := 0;
BEGIN
    -- Get size of primary document
    SELECT file_size INTO v_total_size FROM documents WHERE document_id = p_primary_document_id;

    -- Mark primary as page 1
    UPDATE documents
    SET page_number = 1,
        is_primary_page = TRUE,
        document_group_id = p_primary_document_id
    WHERE document_id = p_primary_document_id;

    -- Update each page document
    FOREACH v_page_id IN ARRAY p_page_document_ids
    LOOP
        -- Add page size to total
        SELECT v_total_size + COALESCE(file_size, 0) INTO v_total_size
        FROM documents WHERE document_id = v_page_id;

        -- Mark as secondary page
        UPDATE documents
        SET page_number = v_page_num,
            is_primary_page = FALSE,
            document_group_id = p_primary_document_id
        WHERE document_id = v_page_id;

        v_page_num := v_page_num + 1;
    END LOOP;

    -- Update primary document with total page count and size
    UPDATE documents
    SET ocr_page_count = v_page_num - 1,
        file_size = v_total_size,
        updated_at = NOW()
    WHERE document_id = p_primary_document_id;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION merge_document_pages IS 'Merges multiple page documents into a single logical document';

-- ============================================================================
-- 5. TRIGGER TO WARN ON POTENTIAL DUPLICATES
-- ============================================================================
-- Logs a warning when a potentially duplicate document is inserted

CREATE OR REPLACE FUNCTION warn_on_potential_duplicate()
RETURNS TRIGGER AS $$
DECLARE
    v_duplicate_count INTEGER;
BEGIN
    -- Check for potential duplicates
    SELECT COUNT(*) INTO v_duplicate_count
    FROM documents d
    WHERE d.document_id != NEW.document_id
      AND d.owner_name = NEW.owner_name
      AND d.doc_type = NEW.doc_type
      AND (
          -- Filename similarity
          d.filename ILIKE '%' || SPLIT_PART(NEW.filename, '.', 1) || '%'
          OR NEW.filename ILIKE '%' || SPLIT_PART(d.filename, '.', 1) || '%'
          -- Or uploaded same day
          OR DATE(d.created_at) = DATE(NEW.created_at)
      );

    IF v_duplicate_count > 0 THEN
        -- Log warning (could also insert into a review queue)
        RAISE NOTICE 'DUPLICATE WARNING: Document % for owner % may be a duplicate of % existing document(s)',
            NEW.document_id, NEW.owner_name, v_duplicate_count;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger (if not exists)
DROP TRIGGER IF EXISTS trg_warn_duplicate_document ON documents;
CREATE TRIGGER trg_warn_duplicate_document
    AFTER INSERT ON documents
    FOR EACH ROW
    EXECUTE FUNCTION warn_on_potential_duplicate();

-- ============================================================================
-- 6. INDEXES FOR DEDUPLICATION QUERIES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_documents_content_hash ON documents(content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_group_id ON documents(document_group_id) WHERE document_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_owner_doctype ON documents(owner_name, doc_type);

-- ============================================================================
-- 7. EXAMPLE: HOW JAMES HOPEWELL CASE WOULD HAVE BEEN CAUGHT
-- ============================================================================
/*
When "Transcript-2.pdf" was uploaded for "James Hopewell" as a "will":

1. The check_document_duplicates() function would return:
   - existing_document_id: 'james-hopewell-will-1817'
   - match_type: 'owner_doctype_match'
   - confidence: 0.85

2. The trigger would log:
   "DUPLICATE WARNING: Document xxx for owner James Hopewell may be a duplicate of 1 existing document(s)"

3. The system could then:
   - Prompt user: "We found an existing will for James Hopewell. Is this an additional page?"
   - If yes: Call merge_document_pages() to combine them
   - If no: Proceed with separate document

4. The potential_duplicate_documents view would show the pair for manual review.
*/

-- Success message
SELECT 'Migration 017 completed: Document deduplication system created' AS status;
