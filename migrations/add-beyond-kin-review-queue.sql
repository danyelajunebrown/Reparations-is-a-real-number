-- ========================================
-- BEYOND KIN REVIEW QUEUE
-- ========================================
-- High-priority document queue for Beyond Kin submissions
-- These documents explicitly document slaveholder/enslaved person connections
-- with evidentiary sources and should be reviewed for promotion to confirmed

CREATE TABLE IF NOT EXISTS beyond_kin_review_queue (
    id SERIAL PRIMARY KEY,
    source_url TEXT NOT NULL,
    source_type VARCHAR(100) DEFAULT 'beyondkin',
    scraping_session_id VARCHAR(100),

    -- Beyond Kin specific fields
    slaveholder_name VARCHAR(255),
    institution_name VARCHAR(255), -- e.g., "JN Mayberry Plantation", "Patricia Coleman Farm"

    -- Enslaved person details (Beyond Kin format)
    enslaved_persons JSONB DEFAULT '[]'::jsonb, -- Array of {given_name, surname, description, source_detail}

    -- Source document details
    document_type VARCHAR(100), -- e.g., "1850 slave census", "property inventory", "will", "university records"
    document_description TEXT,
    document_url TEXT,
    document_date VARCHAR(50),
    document_location VARCHAR(255),

    -- Extraction metadata
    extraction_confidence DECIMAL(3,2),
    extracted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Review status
    review_status VARCHAR(50) DEFAULT 'pending', -- pending, approved, rejected, needs_document
    reviewed_by VARCHAR(255),
    reviewed_at TIMESTAMP,
    review_notes TEXT,

    -- Link to confirmed records (if approved)
    promoted_document_id VARCHAR(255), -- Links to documents table
    promoted_at TIMESTAMP,

    -- Metadata
    submitted_by VARCHAR(255) DEFAULT 'anonymous',
    priority INTEGER DEFAULT 10, -- Beyond Kin always high priority
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_bk_review_status ON beyond_kin_review_queue(review_status);
CREATE INDEX idx_bk_priority ON beyond_kin_review_queue(priority DESC, created_at ASC);
CREATE INDEX idx_bk_slaveholder ON beyond_kin_review_queue(slaveholder_name);
CREATE INDEX idx_bk_institution ON beyond_kin_review_queue(institution_name);
CREATE INDEX idx_bk_created ON beyond_kin_review_queue(created_at DESC);

COMMENT ON TABLE beyond_kin_review_queue IS 'High-priority review queue for Beyond Kin submissions with explicit evidentiary documentation';
COMMENT ON COLUMN beyond_kin_review_queue.enslaved_persons IS 'Array of enslaved persons in Beyond Kin format: [{given_name: "Jim boy $250", surname: "(Patricia Coleman Farm)", description: "Negro boy valued at $250", source_detail: "bequeathed to Patricia Coleman"}]';
COMMENT ON COLUMN beyond_kin_review_queue.review_status IS 'pending (awaiting review), approved (promoted to confirmed), rejected (invalid), needs_document (need to obtain source document)';

-- View for pending Beyond Kin reviews
CREATE OR REPLACE VIEW beyond_kin_pending_reviews AS
SELECT
    id,
    slaveholder_name,
    institution_name,
    document_type,
    document_description,
    jsonb_array_length(enslaved_persons) as enslaved_count,
    extraction_confidence,
    source_url,
    created_at,
    EXTRACT(DAY FROM (CURRENT_TIMESTAMP - created_at)) as days_pending
FROM beyond_kin_review_queue
WHERE review_status = 'pending'
ORDER BY priority DESC, created_at ASC;

COMMENT ON VIEW beyond_kin_pending_reviews IS 'All Beyond Kin submissions awaiting program lead review';

-- Stats view
CREATE OR REPLACE VIEW beyond_kin_stats AS
SELECT
    COUNT(*) FILTER (WHERE review_status = 'pending') as pending_reviews,
    COUNT(*) FILTER (WHERE review_status = 'approved') as approved_total,
    COUNT(*) FILTER (WHERE review_status = 'rejected') as rejected_total,
    COUNT(*) FILTER (WHERE review_status = 'needs_document') as needs_document,
    COUNT(*) FILTER (WHERE review_status = 'approved' AND promoted_at >= CURRENT_TIMESTAMP - INTERVAL '7 days') as approved_last_7_days,
    COALESCE(SUM(jsonb_array_length(enslaved_persons)) FILTER (WHERE review_status = 'pending'), 0) as total_enslaved_pending,
    COALESCE(SUM(jsonb_array_length(enslaved_persons)) FILTER (WHERE review_status = 'approved'), 0) as total_enslaved_approved
FROM beyond_kin_review_queue;

COMMENT ON VIEW beyond_kin_stats IS 'Statistics for Beyond Kin review queue';

SELECT 'Beyond Kin review queue created successfully!' as status;
SELECT * FROM beyond_kin_stats;
