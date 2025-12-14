-- Migration: 010-name-resolution-system.sql
-- Purpose: Create tables for canonical person identity and name variant resolution
-- This handles the reality that the same person appears with different spellings across documents
-- e.g., "Sally Swailes" in census vs "Sally Swailer" in OCR vs "Sarah Swales" in family records

-- Canonical persons table: represents the TRUE identity of a person
CREATE TABLE IF NOT EXISTS canonical_persons (
    id SERIAL PRIMARY KEY,

    -- Best-known name (chosen as primary after review)
    canonical_name VARCHAR(255) NOT NULL,

    -- Normalized search fields
    first_name VARCHAR(100),
    middle_name VARCHAR(100),
    last_name VARCHAR(100),
    suffix VARCHAR(20),

    -- Phonetic codes for fuzzy matching (Soundex/Metaphone)
    first_name_soundex VARCHAR(10),
    last_name_soundex VARCHAR(10),
    first_name_metaphone VARCHAR(20),
    last_name_metaphone VARCHAR(20),

    -- Demographic info (aggregated from evidence)
    birth_year_estimate INT,
    death_year_estimate INT,
    sex VARCHAR(20),

    -- Status
    person_type VARCHAR(50) DEFAULT 'enslaved', -- enslaved, enslaver, freedperson, unknown
    confidence_score DECIMAL(3,2) DEFAULT 0.50, -- 0.00 to 1.00
    verification_status VARCHAR(50) DEFAULT 'auto_created', -- auto_created, human_verified, confirmed

    -- Location context (where this person appears)
    primary_state VARCHAR(100),
    primary_county VARCHAR(100),
    primary_plantation VARCHAR(255),

    -- Linked records (foreign key added later when enslaved_persons table exists)
    enslaved_person_id INT,

    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    created_by VARCHAR(100) DEFAULT 'system',
    notes TEXT
);

-- Name variants table: all the different spellings that refer to the same person
CREATE TABLE IF NOT EXISTS name_variants (
    id SERIAL PRIMARY KEY,

    -- Link to canonical identity (will cascade on delete via application logic)
    canonical_person_id INT,

    -- The variant name as it appears in the source
    variant_name VARCHAR(255) NOT NULL,

    -- Normalized/parsed fields
    variant_first_name VARCHAR(100),
    variant_last_name VARCHAR(100),

    -- Phonetic codes
    first_name_soundex VARCHAR(10),
    last_name_soundex VARCHAR(10),

    -- Source information
    source_document_id INT, -- Links to documents table if available
    source_url TEXT,
    source_type VARCHAR(100), -- census, probate, tax_list, family_archive, ocr_extract

    -- Link to original unconfirmed record (soft FK - app maintains integrity)
    unconfirmed_person_id INT,

    -- Match quality
    match_method VARCHAR(50), -- exact, soundex, metaphone, levenshtein, human_confirmed
    match_confidence DECIMAL(3,2), -- 0.00 to 1.00
    levenshtein_distance INT, -- edit distance from canonical name

    -- Audit
    created_at TIMESTAMP DEFAULT NOW(),
    linked_at TIMESTAMP DEFAULT NOW(),
    linked_by VARCHAR(100) DEFAULT 'system'
);

-- Name matching queue for human review
CREATE TABLE IF NOT EXISTS name_match_queue (
    id SERIAL PRIMARY KEY,

    -- The unconfirmed person needing identity resolution (soft FK)
    unconfirmed_person_id INT,
    unconfirmed_name VARCHAR(255) NOT NULL,

    -- Candidate canonical persons (can be multiple)
    candidate_canonical_ids INT[], -- Array of potential matches
    candidate_scores DECIMAL(3,2)[], -- Corresponding confidence scores

    -- Context to help reviewer
    source_url TEXT,
    source_context TEXT, -- Surrounding text from document
    location_context VARCHAR(255),
    date_context VARCHAR(50),

    -- Queue status
    queue_status VARCHAR(50) DEFAULT 'pending', -- pending, assigned, resolved, skipped
    priority INT DEFAULT 5, -- 1-10, higher = more urgent

    -- Resolution (soft FK to canonical_persons)
    resolved_canonical_id INT,
    resolution_type VARCHAR(50), -- linked_existing, created_new, marked_duplicate, not_a_person
    resolved_by VARCHAR(100),
    resolved_at TIMESTAMP,
    resolution_notes TEXT,

    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for fast phonetic searching
CREATE INDEX IF NOT EXISTS idx_canonical_soundex_first ON canonical_persons(first_name_soundex);
CREATE INDEX IF NOT EXISTS idx_canonical_soundex_last ON canonical_persons(last_name_soundex);
CREATE INDEX IF NOT EXISTS idx_canonical_metaphone_first ON canonical_persons(first_name_metaphone);
CREATE INDEX IF NOT EXISTS idx_canonical_metaphone_last ON canonical_persons(last_name_metaphone);
CREATE INDEX IF NOT EXISTS idx_canonical_name ON canonical_persons(canonical_name);
CREATE INDEX IF NOT EXISTS idx_canonical_state_county ON canonical_persons(primary_state, primary_county);

CREATE INDEX IF NOT EXISTS idx_variant_soundex_first ON name_variants(first_name_soundex);
CREATE INDEX IF NOT EXISTS idx_variant_soundex_last ON name_variants(last_name_soundex);
CREATE INDEX IF NOT EXISTS idx_variant_name ON name_variants(variant_name);
CREATE INDEX IF NOT EXISTS idx_variant_canonical ON name_variants(canonical_person_id);
CREATE INDEX IF NOT EXISTS idx_variant_unconfirmed ON name_variants(unconfirmed_person_id);

CREATE INDEX IF NOT EXISTS idx_match_queue_status ON name_match_queue(queue_status);
CREATE INDEX IF NOT EXISTS idx_match_queue_priority ON name_match_queue(priority DESC);

-- Trigger to update updated_at on canonical_persons
CREATE OR REPLACE FUNCTION update_canonical_person_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_canonical_person_updated ON canonical_persons;
CREATE TRIGGER trigger_canonical_person_updated
    BEFORE UPDATE ON canonical_persons
    FOR EACH ROW
    EXECUTE FUNCTION update_canonical_person_timestamp();

-- Comments explaining the system
COMMENT ON TABLE canonical_persons IS 'The TRUE identity of a person - may be linked from multiple name_variants';
COMMENT ON TABLE name_variants IS 'Different spellings/appearances of the same person across documents';
COMMENT ON TABLE name_match_queue IS 'Queue for human review of ambiguous name matches';
COMMENT ON COLUMN canonical_persons.confidence_score IS 'How confident we are this is a real distinct person (0.00-1.00)';
COMMENT ON COLUMN name_variants.match_method IS 'How this variant was matched: exact, soundex, metaphone, levenshtein, human_confirmed';
