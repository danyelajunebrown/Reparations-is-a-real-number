-- ========================================
-- CONFIRMING DOCUMENTS SYSTEM
-- ========================================
-- Links unconfirmed persons to primary source documents that can confirm their existence
-- Supports hybrid promotion pipeline (auto-promote high confidence, queue medium for human review)

CREATE TABLE IF NOT EXISTS confirming_documents (
    id SERIAL PRIMARY KEY,

    -- Link to person
    unconfirmed_person_id INTEGER REFERENCES unconfirmed_persons(lead_id) ON DELETE CASCADE,

    -- Document source
    document_url TEXT NOT NULL,
    document_type VARCHAR(50), -- 'compensation_petition', 'will', 'slave_schedule', 'census', 'probate', etc.
    page_number INTEGER, -- For multi-page docs (JPG 1, JPG 2, JPG 3)

    -- LLM analysis metadata
    llm_confidence DECIMAL(3,2), -- How confident LLM is this is a primary source
    llm_reasoning TEXT, -- Why LLM classified this way

    -- Download tracking
    downloaded_file_path TEXT,
    download_status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'downloading', 'downloaded', 'failed'
    download_error TEXT,
    downloaded_at TIMESTAMP,
    file_size BIGINT,

    -- Upload to system tracking
    uploaded_document_id VARCHAR(255), -- Links to documents.document_id after successful upload
    upload_status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'uploading', 'uploaded', 'processing', 'completed', 'failed'
    upload_error TEXT,
    uploaded_at TIMESTAMP,

    -- Promotion tracking
    promotion_status VARCHAR(50) DEFAULT 'pending_review',
        -- 'pending_review': Initial state, waiting for evaluation
        -- 'auto_promoted': Confidence >= 0.9, automatically moved to confirmed
        -- 'manual_review_queue': Confidence 0.7-0.9, needs human review
        -- 'promoted': Human approved, moved to confirmed
        -- 'rejected': Human or system rejected

    confidence_boost DECIMAL(3,2), -- How much this document increases person confidence (e.g., 0.25 = +25%)
    final_confidence DECIMAL(3,2), -- Person confidence after applying boost

    promoted_at TIMESTAMP,
    promoted_to_table VARCHAR(50), -- 'documents', 'enslaved_people', 'individuals'
    promoted_to_id VARCHAR(255), -- ID in the promoted table

    -- Review tracking (for manual review queue)
    reviewed_by VARCHAR(255),
    reviewed_at TIMESTAMP,
    review_notes TEXT,

    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for fast querying
CREATE INDEX idx_confirming_docs_person ON confirming_documents(unconfirmed_person_id);
CREATE INDEX idx_confirming_docs_promotion_status ON confirming_documents(promotion_status);
CREATE INDEX idx_confirming_docs_download_status ON confirming_documents(download_status);
CREATE INDEX idx_confirming_docs_upload_status ON confirming_documents(upload_status);
CREATE INDEX idx_confirming_docs_url ON confirming_documents(document_url);
CREATE INDEX idx_confirming_docs_type ON confirming_documents(document_type);

-- Comments
COMMENT ON TABLE confirming_documents IS 'Primary source documents that can confirm unconfirmed person leads - supports hybrid auto/manual promotion pipeline';
COMMENT ON COLUMN confirming_documents.promotion_status IS 'pending_review (initial), auto_promoted (>=0.9 confidence), manual_review_queue (0.7-0.9), promoted (human approved), rejected';
COMMENT ON COLUMN confirming_documents.confidence_boost IS 'How much this document increases person confidence. Primary sources give +0.20 to +0.40 boost depending on quality';
COMMENT ON COLUMN confirming_documents.final_confidence IS 'Person original confidence + boost = final confidence. Used to determine auto-promotion eligibility';

-- View for manual review queue (0.7-0.9 confidence)
CREATE OR REPLACE VIEW confirming_documents_review_queue AS
SELECT
    cd.id,
    cd.unconfirmed_person_id,
    up.full_name as person_name,
    up.person_type,
    cd.document_url,
    cd.document_type,
    cd.llm_confidence,
    cd.final_confidence,
    cd.uploaded_document_id,
    cd.created_at,
    EXTRACT(DAY FROM (CURRENT_TIMESTAMP - cd.created_at)) as days_pending
FROM confirming_documents cd
JOIN unconfirmed_persons up ON cd.unconfirmed_person_id = up.lead_id
WHERE cd.promotion_status = 'manual_review_queue'
ORDER BY cd.final_confidence DESC, cd.created_at ASC;

COMMENT ON VIEW confirming_documents_review_queue IS 'Documents with 0.7-0.9 confidence that need human review before promotion';

-- View for auto-promoted documents (audit trail)
CREATE OR REPLACE VIEW confirming_documents_auto_promoted AS
SELECT
    cd.id,
    cd.unconfirmed_person_id,
    up.full_name as person_name,
    up.person_type,
    cd.document_type,
    cd.final_confidence,
    cd.promoted_to_table,
    cd.promoted_to_id,
    cd.promoted_at,
    cd.document_url
FROM confirming_documents cd
JOIN unconfirmed_persons up ON cd.unconfirmed_person_id = up.lead_id
WHERE cd.promotion_status = 'auto_promoted'
ORDER BY cd.promoted_at DESC;

COMMENT ON VIEW confirming_documents_auto_promoted IS 'Audit trail of automatically promoted documents (confidence >= 0.9)';

-- Statistics view
CREATE OR REPLACE VIEW confirming_documents_stats AS
SELECT
    COUNT(*) as total_confirming_docs,
    COUNT(*) FILTER (WHERE promotion_status = 'pending_review') as pending_review,
    COUNT(*) FILTER (WHERE promotion_status = 'auto_promoted') as auto_promoted,
    COUNT(*) FILTER (WHERE promotion_status = 'manual_review_queue') as needs_human_review,
    COUNT(*) FILTER (WHERE promotion_status = 'promoted') as manually_promoted,
    COUNT(*) FILTER (WHERE promotion_status = 'rejected') as rejected,
    COUNT(*) FILTER (WHERE download_status = 'downloaded') as downloaded,
    COUNT(*) FILTER (WHERE upload_status = 'completed') as uploaded,
    AVG(final_confidence) FILTER (WHERE promotion_status IN ('auto_promoted', 'promoted')) as avg_promoted_confidence
FROM confirming_documents;

COMMENT ON VIEW confirming_documents_stats IS 'Statistics for confirming documents and promotion pipeline';

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_confirming_documents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_confirming_documents_timestamp
    BEFORE UPDATE ON confirming_documents
    FOR EACH ROW
    EXECUTE FUNCTION update_confirming_documents_updated_at();

SELECT 'Confirming documents table created successfully!' as status;
SELECT * FROM confirming_documents_stats;
