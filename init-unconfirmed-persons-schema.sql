-- Unconfirmed Persons Repository
-- Massive database of leads that need verification

CREATE TABLE IF NOT EXISTS unconfirmed_persons (
    lead_id SERIAL PRIMARY KEY,

    -- Person data
    full_name VARCHAR(255) NOT NULL,
    person_type VARCHAR(50), -- 'enslaved', 'owner', 'descendant', 'unknown'
    birth_year INTEGER,
    death_year INTEGER,
    gender VARCHAR(20),
    locations TEXT[], -- Array of locations mentioned

    -- Source and provenance
    source_url TEXT NOT NULL,
    source_page_title TEXT,
    source_type VARCHAR(50) DEFAULT 'secondary', -- 'primary', 'secondary', 'tertiary'
    extraction_method VARCHAR(50) DEFAULT 'ml', -- 'ml', 'manual', 'imported'
    scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Evidence
    context_text TEXT, -- Surrounding text where person was mentioned
    confidence_score DECIMAL(3,2) CHECK (confidence_score >= 0 AND confidence_score <= 1),

    -- Relationships (JSON array)
    relationships JSONB DEFAULT '[]'::jsonb,

    -- Status tracking
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'reviewing', 'confirmed', 'rejected', 'duplicate', 'merged'
    reviewed_by VARCHAR(255),
    reviewed_at TIMESTAMP,
    rejection_reason TEXT,

    -- Link to confirmed person (if promoted)
    confirmed_enslaved_id VARCHAR(255), -- Links to enslaved_individuals
    confirmed_individual_id VARCHAR(255), -- Links to individuals

    -- Deduplication
    duplicate_of_lead_id INTEGER REFERENCES unconfirmed_persons(lead_id),

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for fast querying
CREATE INDEX IF NOT EXISTS idx_unconfirmed_full_name ON unconfirmed_persons(full_name);
CREATE INDEX IF NOT EXISTS idx_unconfirmed_confidence ON unconfirmed_persons(confidence_score DESC);
CREATE INDEX IF NOT EXISTS idx_unconfirmed_status ON unconfirmed_persons(status);
CREATE INDEX IF NOT EXISTS idx_unconfirmed_type ON unconfirmed_persons(person_type);
CREATE INDEX IF NOT EXISTS idx_unconfirmed_source_url ON unconfirmed_persons(source_url);
CREATE INDEX IF NOT EXISTS idx_unconfirmed_birth_year ON unconfirmed_persons(birth_year);

-- Full text search on names
CREATE INDEX IF NOT EXISTS idx_unconfirmed_name_fulltext ON unconfirmed_persons USING gin(to_tsvector('english', full_name));

-- Scraped documents repository
CREATE TABLE IF NOT EXISTS scraped_documents (
    scraped_doc_id SERIAL PRIMARY KEY,

    -- Document metadata
    original_url TEXT NOT NULL,
    downloaded_filename VARCHAR(500),
    file_path TEXT,
    file_size BIGINT,
    mime_type VARCHAR(100),

    -- Auto-classification
    guessed_type VARCHAR(50), -- 'will', 'probate', 'census', etc.
    guessed_owner_name VARCHAR(255),

    -- Processing status
    download_status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'downloaded', 'failed'
    upload_status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'uploaded', 'processing', 'completed', 'failed'
    uploaded_document_id VARCHAR(255), -- Links to documents table after upload

    -- Source
    scraped_from_url TEXT,
    scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Errors
    error_message TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_scraped_docs_url ON scraped_documents(original_url);
CREATE INDEX IF NOT EXISTS idx_scraped_docs_status ON scraped_documents(download_status, upload_status);

-- Scraping sessions (track each URL you scrape)
CREATE TABLE IF NOT EXISTS scraping_sessions (
    session_id SERIAL PRIMARY KEY,

    -- URL scraped
    target_url TEXT NOT NULL,
    page_title TEXT,

    -- Results
    persons_found INTEGER DEFAULT 0,
    high_confidence_persons INTEGER DEFAULT 0, -- confidence >= 0.7
    documents_found INTEGER DEFAULT 0,
    documents_downloaded INTEGER DEFAULT 0,
    relationships_found INTEGER DEFAULT 0,

    -- Text stats
    text_length INTEGER,
    tables_found INTEGER,
    images_found INTEGER,

    -- Timing
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    duration_ms INTEGER,

    -- Status
    status VARCHAR(50) DEFAULT 'in_progress', -- 'in_progress', 'completed', 'failed'
    error_message TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_scraping_sessions_url ON scraping_sessions(target_url);
CREATE INDEX IF NOT EXISTS idx_scraping_sessions_date ON scraping_sessions(started_at DESC);

-- Verification queue view (for review UI)
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
    -- Priority score (higher = review first)
    (
        confidence_score * 100 +
        CASE WHEN person_type = 'enslaved' THEN 20 ELSE 0 END +
        CASE WHEN birth_year IS NOT NULL THEN 10 ELSE 0 END +
        CASE WHEN death_year IS NOT NULL THEN 10 ELSE 0 END
    ) as priority_score
FROM unconfirmed_persons
WHERE status = 'pending'
ORDER BY priority_score DESC, created_at DESC;

-- Statistics view
CREATE OR REPLACE VIEW unconfirmed_stats AS
SELECT
    COUNT(*) as total_leads,
    COUNT(*) FILTER (WHERE status = 'pending') as pending,
    COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed,
    COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
    COUNT(*) FILTER (WHERE confidence_score >= 0.7) as high_confidence,
    COUNT(*) FILTER (WHERE confidence_score >= 0.5 AND confidence_score < 0.7) as medium_confidence,
    COUNT(*) FILTER (WHERE confidence_score < 0.5) as low_confidence,
    COUNT(*) FILTER (WHERE person_type = 'enslaved') as enslaved_count,
    COUNT(*) FILTER (WHERE person_type = 'owner') as owner_count,
    COUNT(*) FILTER (WHERE person_type = 'descendant') as descendant_count
FROM unconfirmed_persons;

COMMENT ON TABLE unconfirmed_persons IS 'Repository of unconfirmed persons extracted from web pages - requires verification before promoting to main database';
COMMENT ON TABLE scraped_documents IS 'Documents automatically downloaded from web pages during scraping sessions';
COMMENT ON TABLE scraping_sessions IS 'Log of all web scraping sessions and their results';

COMMENT ON COLUMN unconfirmed_persons.source_type IS 'Source classification: primary (original historical documents like wills, deeds, slave schedules), secondary (books, articles about history), tertiary (Wikipedia, encyclopedias). Only primary sources can confirm slave ownership/enslaved status.';
COMMENT ON COLUMN unconfirmed_persons.status IS 'Status: pending (not reviewed), reviewing (under review), confirmed (verified with primary source), rejected (false positive), duplicate (merged with another lead), merged (combined into another record)';
COMMENT ON COLUMN unconfirmed_persons.confidence_score IS 'ML confidence 0.0-1.0. Web-scraped data capped at 0.75 - only primary sources can achieve 0.76-1.0. This is NOT a confirmation, just likelihood of being a real person worth investigating.';
