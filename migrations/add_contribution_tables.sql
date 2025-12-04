-- Migration: Add Contribution Pipeline Tables
-- Date: 2025-12-02
-- Purpose: Support conversational human-guided contribution flow

-- Contribution sessions (conversation state)
CREATE TABLE IF NOT EXISTS contribution_sessions (
    session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    url TEXT NOT NULL,
    contributor_id TEXT,

    -- Conversation state
    current_stage TEXT DEFAULT 'url_analysis',
    conversation_history JSONB DEFAULT '[]',

    -- Gathered metadata (see CONTRIBUTE_PIPELINE_DESIGN.md for schema)
    source_metadata JSONB,
    content_structure JSONB,
    extraction_guidance JSONB,
    processing_instructions JSONB,

    -- Status
    status TEXT DEFAULT 'in_progress',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- Index for session lookups
CREATE INDEX IF NOT EXISTS idx_contribution_sessions_status
    ON contribution_sessions(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contribution_sessions_contributor
    ON contribution_sessions(contributor_id)
    WHERE contributor_id IS NOT NULL;

-- Extraction jobs (OCR/parsing work)
CREATE TABLE IF NOT EXISTS extraction_jobs (
    extraction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES contribution_sessions(session_id) ON DELETE CASCADE,

    -- Source
    content_url TEXT NOT NULL,
    content_type TEXT,

    -- Processing configuration
    method TEXT NOT NULL,  -- 'auto_ocr', 'guided_entry', 'sample_learn', 'csv_upload'
    ocr_engine TEXT,       -- 'tesseract', 'google_vision', 'aws_textract', etc.
    ocr_config JSONB,

    -- Raw results
    raw_ocr_text TEXT,
    parsed_rows JSONB,     -- Array of {columns: {...}, confidence: 0.x}
    row_count INTEGER DEFAULT 0,

    -- Quality metrics
    avg_confidence DECIMAL(3,2),
    human_corrections INTEGER DEFAULT 0,
    illegible_count INTEGER DEFAULT 0,

    -- Status tracking
    status TEXT DEFAULT 'pending',  -- 'pending', 'processing', 'completed', 'failed', 'reviewing'
    progress INTEGER DEFAULT 0,     -- 0-100
    error_message TEXT,

    -- Timing
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_extraction_jobs_session
    ON extraction_jobs(session_id);

CREATE INDEX IF NOT EXISTS idx_extraction_jobs_status
    ON extraction_jobs(status);

-- Human corrections (learning data!)
CREATE TABLE IF NOT EXISTS extraction_corrections (
    correction_id SERIAL PRIMARY KEY,
    extraction_id UUID REFERENCES extraction_jobs(extraction_id) ON DELETE CASCADE,

    row_index INTEGER,
    field_name TEXT,
    original_value TEXT,
    corrected_value TEXT,

    -- Context for ML training
    raw_image_region TEXT,     -- Base64 of the specific cell (for future ML)
    ocr_confidence DECIMAL(3,2),

    -- Metadata
    corrected_by TEXT,
    corrected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_extraction_corrections_extraction
    ON extraction_corrections(extraction_id);

-- Learned patterns (from corrections over time)
CREATE TABLE IF NOT EXISTS learned_patterns (
    pattern_id SERIAL PRIMARY KEY,
    domain TEXT,               -- Source domain this pattern applies to
    document_type TEXT,        -- Type of document

    -- Pattern details
    pattern_type TEXT,         -- 'name_format', 'abbreviation', 'column_header', 'ocr_correction'
    raw_pattern TEXT,          -- What was seen (OCR output or structure)
    interpreted_as TEXT,       -- What it means

    -- Confidence tracking
    occurrences INTEGER DEFAULT 1,
    corrections INTEGER DEFAULT 0,
    confidence DECIMAL(3,2),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_learned_patterns_domain
    ON learned_patterns(domain, document_type);

CREATE INDEX IF NOT EXISTS idx_learned_patterns_type
    ON learned_patterns(pattern_type);

-- Contributor stats (track accuracy for trust scoring)
CREATE TABLE IF NOT EXISTS contributor_stats (
    contributor_id TEXT PRIMARY KEY,

    -- Activity counts
    sessions_started INTEGER DEFAULT 0,
    sessions_completed INTEGER DEFAULT 0,
    total_corrections INTEGER DEFAULT 0,
    total_rows_validated INTEGER DEFAULT 0,

    -- Quality metrics (calculated from verified contributions)
    accuracy_score DECIMAL(3,2),  -- 0.00 to 1.00
    expertise_areas TEXT[],       -- ['genealogy', 'ocr', 'cursive', etc.]

    -- Engagement
    first_contribution TIMESTAMP,
    last_contribution TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Document extractions (final committed data from contribution sessions)
CREATE TABLE IF NOT EXISTS contributed_extractions (
    extraction_id UUID PRIMARY KEY,
    session_id UUID REFERENCES contribution_sessions(session_id),

    -- Source information
    source_url TEXT NOT NULL,
    source_domain TEXT,
    archive_name TEXT,
    document_title TEXT,
    document_date TEXT,

    -- Classification
    source_type TEXT,          -- 'primary', 'secondary', 'tertiary'
    document_type TEXT,        -- 'slave_schedule', 'petition', etc.

    -- Geographic context
    state TEXT,
    county TEXT,
    location_notes TEXT,

    -- Extraction summary
    total_rows INTEGER,
    owner_count INTEGER,
    enslaved_count INTEGER,
    relationship_count INTEGER,

    -- Quality
    avg_confidence DECIMAL(3,2),
    human_review_percentage DECIMAL(3,2),
    verification_status TEXT DEFAULT 'pending',  -- 'pending', 'verified', 'rejected'

    -- Contributor
    contributor_id TEXT,
    contributor_notes TEXT,

    -- Timestamps
    extracted_at TIMESTAMP,
    verified_at TIMESTAMP,
    verified_by TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_contributed_extractions_source
    ON contributed_extractions(source_domain, document_type);

CREATE INDEX IF NOT EXISTS idx_contributed_extractions_location
    ON contributed_extractions(state, county);

CREATE INDEX IF NOT EXISTS idx_contributed_extractions_status
    ON contributed_extractions(verification_status);

-- Promotion log (audit trail for auto-promoted owners)
CREATE TABLE IF NOT EXISTS promotion_log (
    promotion_id SERIAL PRIMARY KEY,
    individual_id TEXT NOT NULL,           -- ID in individuals table
    original_lead_id INTEGER,              -- ID from unconfirmed_persons if applicable
    extraction_id UUID,                    -- Link to extraction job

    -- Person details at time of promotion
    full_name TEXT NOT NULL,
    source_url TEXT,
    confidence_score DECIMAL(3,2),

    -- Promotion details
    promotion_type TEXT NOT NULL,          -- 'auto_high_confidence', 'human_verified', 'manual_review'
    promotion_reason TEXT,

    -- Audit
    promoted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    promoted_by TEXT DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS idx_promotion_log_individual
    ON promotion_log(individual_id);

CREATE INDEX IF NOT EXISTS idx_promotion_log_date
    ON promotion_log(promoted_at DESC);

-- Ensure individuals table has needed columns (add if missing)
DO $$
BEGIN
    -- Add source_url if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'individuals' AND column_name = 'source_url') THEN
        ALTER TABLE individuals ADD COLUMN source_url TEXT;
    END IF;

    -- Add confidence_score if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'individuals' AND column_name = 'confidence_score') THEN
        ALTER TABLE individuals ADD COLUMN confidence_score DECIMAL(3,2);
    END IF;

    -- Add source_type if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'individuals' AND column_name = 'source_type') THEN
        ALTER TABLE individuals ADD COLUMN source_type TEXT;
    END IF;

    -- Add verified if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'individuals' AND column_name = 'verified') THEN
        ALTER TABLE individuals ADD COLUMN verified BOOLEAN DEFAULT false;
    END IF;

    -- Add first_name if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'individuals' AND column_name = 'first_name') THEN
        ALTER TABLE individuals ADD COLUMN first_name TEXT;
    END IF;

    -- Add last_name if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'individuals' AND column_name = 'last_name') THEN
        ALTER TABLE individuals ADD COLUMN last_name TEXT;
    END IF;

    -- Add location if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'individuals' AND column_name = 'location') THEN
        ALTER TABLE individuals ADD COLUMN location TEXT;
    END IF;
END $$;

-- Add comments explaining the tables
COMMENT ON TABLE contribution_sessions IS
    'Tracks conversational contribution sessions where humans guide the system in understanding documents';

COMMENT ON TABLE extraction_jobs IS
    'Individual OCR/extraction jobs spawned from contribution sessions';

COMMENT ON TABLE extraction_corrections IS
    'Human corrections to OCR output - used as training data for pattern learning';

COMMENT ON TABLE learned_patterns IS
    'Patterns learned from human corrections, used to improve future extractions';

COMMENT ON TABLE contributor_stats IS
    'Statistics about contributors for trust/accuracy scoring';

COMMENT ON TABLE contributed_extractions IS
    'Final committed extraction results ready for integration into main database';

COMMENT ON TABLE promotion_log IS
    'Audit trail for slave owners auto-promoted from federal documents to the individuals table';

-- =============================================================================
-- HUMAN KNOWLEDGE PRESERVATION TABLES
-- =============================================================================
-- These tables capture ALL human-provided information, even details not
-- immediately used by the system. Principle: Human input is precious training
-- data and research context that should NEVER be discarded.

-- Human readings: Ground truth for OCR training
CREATE TABLE IF NOT EXISTS human_readings (
    id SERIAL PRIMARY KEY,
    session_id UUID REFERENCES contribution_sessions(session_id) ON DELETE SET NULL,
    document_url TEXT NOT NULL,

    -- What the human read
    reading_type TEXT NOT NULL,     -- 'column_headers', 'row_entry', 'name', 'date', 'printer_text', etc.
    exact_text JSONB NOT NULL,      -- The exact text as provided by human (can be string or array)
    confidence TEXT DEFAULT 'human_provided',

    -- Full context
    metadata JSONB,                 -- Any additional context about the reading
    image_region TEXT,              -- If available: base64 of the image region for ML training

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_human_readings_url ON human_readings(document_url);
CREATE INDEX IF NOT EXISTS idx_human_readings_type ON human_readings(reading_type);
CREATE INDEX IF NOT EXISTS idx_human_readings_session ON human_readings(session_id);

COMMENT ON TABLE human_readings IS
    'Ground truth human readings of document text - used for OCR validation and training';

-- Document auxiliary data: Stockpile of all captured information
CREATE TABLE IF NOT EXISTS document_auxiliary_data (
    id SERIAL PRIMARY KEY,
    session_id UUID REFERENCES contribution_sessions(session_id) ON DELETE SET NULL,
    document_url TEXT NOT NULL,

    -- What type of data this is
    data_type TEXT NOT NULL,        -- 'parsed_auxiliary', 'physical_description', 'military_context', etc.
    data_content JSONB NOT NULL,    -- The structured data

    -- Raw human input that produced this (sacred - never modified)
    raw_input TEXT,

    -- For linking related data
    individual_id TEXT,             -- If this data relates to a specific person
    document_page INTEGER,          -- If this data is page-specific

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_doc_aux_url ON document_auxiliary_data(document_url);
CREATE INDEX IF NOT EXISTS idx_doc_aux_type ON document_auxiliary_data(data_type);
CREATE INDEX IF NOT EXISTS idx_doc_aux_individual ON document_auxiliary_data(individual_id)
    WHERE individual_id IS NOT NULL;

COMMENT ON TABLE document_auxiliary_data IS
    'Stockpile of all auxiliary data from documents - printers, dimensions, military columns, etc. - for future use';

-- Document structure templates: Learned document layouts
CREATE TABLE IF NOT EXISTS document_templates (
    template_id SERIAL PRIMARY KEY,
    template_name TEXT NOT NULL,

    -- Source pattern matching
    domain_pattern TEXT,            -- e.g., 'msa.maryland.gov'
    document_type TEXT,             -- e.g., 'slave_compensation_record'

    -- Structure definition
    column_structure JSONB,         -- Array of {position, name, dataType, subcolumns}
    physical_layout JSONB,          -- Page layout, dimensions, etc.

    -- Source of this template
    derived_from_session UUID REFERENCES contribution_sessions(session_id),
    human_confirmed BOOLEAN DEFAULT false,

    -- Usage tracking
    times_used INTEGER DEFAULT 0,
    success_rate DECIMAL(3,2),

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_templates_domain ON document_templates(domain_pattern);
CREATE INDEX IF NOT EXISTS idx_templates_type ON document_templates(document_type);

COMMENT ON TABLE document_templates IS
    'Learned document structure templates from human descriptions - speeds up future extractions of similar documents';

-- OCR training pairs: Human reading vs OCR output for model improvement
CREATE TABLE IF NOT EXISTS ocr_training_pairs (
    id SERIAL PRIMARY KEY,
    document_url TEXT,
    image_hash TEXT,                -- Hash of the image region for deduplication

    -- The pair
    ocr_output TEXT NOT NULL,       -- What the OCR engine produced
    human_reading TEXT NOT NULL,    -- What the human said it should be

    -- Context
    ocr_engine TEXT,                -- 'tesseract', 'google_vision', etc.
    field_type TEXT,                -- 'name', 'date', 'location', etc.
    handwriting_type TEXT,          -- 'cursive', 'print', 'mixed'

    -- Quality metrics
    edit_distance INTEGER,          -- Levenshtein distance between OCR and human
    character_error_rate DECIMAL(5,4),

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ocr_training_engine ON ocr_training_pairs(ocr_engine);
CREATE INDEX IF NOT EXISTS idx_ocr_training_field ON ocr_training_pairs(field_type);
CREATE INDEX IF NOT EXISTS idx_ocr_training_handwriting ON ocr_training_pairs(handwriting_type);

COMMENT ON TABLE ocr_training_pairs IS
    'Pairs of OCR output vs human corrections - training data for improving OCR accuracy';
