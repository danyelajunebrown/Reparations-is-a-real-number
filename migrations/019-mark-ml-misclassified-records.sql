-- Migration 019: Mark ML-extracted records as needs_review
--
-- Problem: The ML extractor incorrectly classifies person_type for Civil War DC petitions:
--   - Petitioners (slaveholders) are labeled as "enslaved"
--   - Witnesses are labeled as "enslaved"
--   - Justices of the Peace are labeled as "enslaved"
--   - Actual enslaved persons sometimes labeled as "owner"
--
-- This migration:
--   1. Adds 'needs_review' to status options
--   2. Marks all ML-extracted CivilWarDC records for review
--   3. Sets confidence_score to 0.3 to prevent them from appearing prominently
--   4. Adds a review_notes column to track why records need review

-- Step 1: Add review_notes column if it doesn't exist
ALTER TABLE unconfirmed_persons
ADD COLUMN IF NOT EXISTS review_notes TEXT;

-- Step 2: Mark ALL CivilWarDC ML-extracted records as needs_review
-- These have systematic person_type misclassification
UPDATE unconfirmed_persons
SET
    status = 'needs_review',
    confidence_score = LEAST(confidence_score, 0.30),
    review_notes = 'ML person_type classification unreliable for Civil War DC petitions. Petitioners labeled as enslaved, witnesses labeled as enslaved. Needs manual review or domain-specific re-processing.',
    updated_at = CURRENT_TIMESTAMP
WHERE
    source_url LIKE '%civilwardc.org%'
    AND extraction_method = 'ml'
    AND status = 'pending';

-- Step 3: Also mark records with obvious garbage names
UPDATE unconfirmed_persons
SET
    status = 'rejected',
    rejection_reason = 'Garbage extraction: common word, form header, or OCR artifact',
    updated_at = CURRENT_TIMESTAMP
WHERE
    status IN ('pending', 'needs_review')
    AND (
        -- Common English words
        LOWER(full_name) IN ('the', 'he', 'she', 'it', 'that', 'this', 'with', 'from', 'for', 'and', 'but', 'not', 'years', 'year', 'month', 'day', 'filed', 'signed', 'note', 'county', 'city', 'state', 'peace', 'justice', 'witness', 'petition', 'petitioner')
        -- Too short
        OR LENGTH(full_name) <= 2
        -- Contains newlines (OCR artifacts)
        OR full_name LIKE E'%\n%'
        -- All caps longer than 3 chars (likely headers)
        OR (full_name = UPPER(full_name) AND LENGTH(full_name) > 3)
        -- Pure numbers
        OR full_name ~ '^[0-9]+$'
        -- Form field patterns
        OR LOWER(full_name) LIKE '%participant%'
        OR LOWER(full_name) LIKE '%researcher%'
        OR LOWER(full_name) LIKE '%filed may%'
        OR LOWER(full_name) LIKE '%note (%'
    );

-- Step 4: Mark records where context suggests wrong classification
-- If context mentions "Petition of X" and X is labeled enslaved, flag it
UPDATE unconfirmed_persons
SET
    review_notes = COALESCE(review_notes, '') || ' Context suggests this may be a petitioner (owner), not enslaved.',
    status = 'needs_review',
    confidence_score = LEAST(confidence_score, 0.25),
    updated_at = CURRENT_TIMESTAMP
WHERE
    source_url LIKE '%civilwardc.org%'
    AND person_type = 'enslaved'
    AND status NOT IN ('rejected', 'confirmed')
    AND (
        context_text ILIKE '%petition of%' || full_name || '%'
        OR context_text ILIKE '%petitioner%' || full_name || '%'
        OR context_text ILIKE '%witness%' || full_name || '%'
        OR context_text ILIKE '%justice of the peace%'
        OR context_text ILIKE '%signed by%' || full_name || '%'
        OR context_text ILIKE '%sworn to%' || full_name || '%'
    );

-- Step 5: Create index on status for faster filtering
CREATE INDEX IF NOT EXISTS idx_unconfirmed_needs_review
ON unconfirmed_persons(status)
WHERE status = 'needs_review';

-- Step 6: Update the verification queue view to exclude needs_review
CREATE OR REPLACE VIEW unconfirmed_verification_queue AS
SELECT
    lead_id,
    full_name,
    person_type,
    birth_year,
    death_year,
    confidence_score,
    source_url,
    context_text,
    status,
    created_at,
    (
        confidence_score * 100 +
        CASE WHEN person_type = 'enslaved' THEN 20 ELSE 0 END +
        CASE WHEN birth_year IS NOT NULL THEN 10 ELSE 0 END +
        CASE WHEN death_year IS NOT NULL THEN 10 ELSE 0 END
    ) as priority_score
FROM unconfirmed_persons
WHERE status = 'pending'  -- Excludes needs_review and rejected
ORDER BY priority_score DESC, created_at DESC;

-- Step 7: Create a view specifically for ML review queue
CREATE OR REPLACE VIEW ml_review_queue AS
SELECT
    lead_id,
    full_name,
    person_type,
    confidence_score,
    source_url,
    context_text,
    review_notes,
    created_at
FROM unconfirmed_persons
WHERE status = 'needs_review'
ORDER BY created_at DESC;

-- Step 8: Report on changes
DO $$
DECLARE
    needs_review_count INTEGER;
    rejected_count INTEGER;
    remaining_pending INTEGER;
BEGIN
    SELECT COUNT(*) INTO needs_review_count FROM unconfirmed_persons WHERE status = 'needs_review';
    SELECT COUNT(*) INTO rejected_count FROM unconfirmed_persons WHERE status = 'rejected';
    SELECT COUNT(*) INTO remaining_pending FROM unconfirmed_persons WHERE status = 'pending';

    RAISE NOTICE '========================================';
    RAISE NOTICE 'ML Records Cleanup Complete';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Records marked needs_review: %', needs_review_count;
    RAISE NOTICE 'Records rejected (garbage): %', rejected_count;
    RAISE NOTICE 'Remaining pending records: %', remaining_pending;
    RAISE NOTICE '========================================';
END $$;

COMMENT ON COLUMN unconfirmed_persons.review_notes IS 'Notes explaining why this record needs review, e.g., ML misclassification issues';
