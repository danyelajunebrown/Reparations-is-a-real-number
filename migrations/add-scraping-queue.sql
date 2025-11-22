-- ========================================
-- SCRAPING QUEUE SYSTEM MIGRATION
-- ========================================
-- This migration adds tables for the continuous web scraping system
-- Run with: psql $DATABASE_URL -f migrations/add-scraping-queue.sql

-- 1. URL Submission Queue
CREATE TABLE IF NOT EXISTS scraping_queue (
    id SERIAL PRIMARY KEY,
    url TEXT NOT NULL,
    category VARCHAR(100) DEFAULT 'other',
    submitted_by VARCHAR(255) DEFAULT 'anonymous',
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'pending',
    priority INTEGER DEFAULT 5,
    processing_started_at TIMESTAMP,
    processing_completed_at TIMESTAMP,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    session_id VARCHAR(100),
    metadata JSONB DEFAULT '{}'::jsonb,
    CONSTRAINT unique_url_pending UNIQUE (url, status)
);

CREATE INDEX idx_scraping_queue_status ON scraping_queue(status);
CREATE INDEX idx_scraping_queue_priority ON scraping_queue(priority DESC, submitted_at ASC);
CREATE INDEX idx_scraping_queue_submitted_at ON scraping_queue(submitted_at DESC);

COMMENT ON TABLE scraping_queue IS 'Queue for public URL submissions to be scraped and processed';
COMMENT ON COLUMN scraping_queue.status IS 'pending, processing, completed, failed, duplicate';
COMMENT ON COLUMN scraping_queue.priority IS '1-10 scale, higher = more urgent';
COMMENT ON COLUMN scraping_queue.category IS 'wikipedia, findagrave, ancestry, familysearch, archive, newspaper, academic, other';

-- 2. Person Duplicate Detection
CREATE TABLE IF NOT EXISTS person_duplicates (
    id SERIAL PRIMARY KEY,
    person1_id INTEGER REFERENCES unconfirmed_persons(id) ON DELETE CASCADE,
    person2_id INTEGER REFERENCES unconfirmed_persons(id) ON DELETE CASCADE,
    similarity_score DECIMAL(3,2) CHECK (similarity_score >= 0 AND similarity_score <= 1),
    matching_fields TEXT[],
    merge_status VARCHAR(50) DEFAULT 'pending_review',
    merged_into_id INTEGER REFERENCES unconfirmed_persons(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP,
    reviewed_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT no_self_match CHECK (person1_id != person2_id),
    CONSTRAINT unique_person_pair UNIQUE (person1_id, person2_id)
);

CREATE INDEX idx_person_duplicates_similarity ON person_duplicates(similarity_score DESC);
CREATE INDEX idx_person_duplicates_status ON person_duplicates(merge_status);

COMMENT ON TABLE person_duplicates IS 'Tracks potential duplicate persons found across different sources';
COMMENT ON COLUMN person_duplicates.similarity_score IS '0.0-1.0, calculated from name, dates, locations';
COMMENT ON COLUMN person_duplicates.merge_status IS 'pending_review, merged, rejected, auto_merged';

-- 3. Canonical Person Identifiers
CREATE TABLE IF NOT EXISTS person_identifiers (
    id SERIAL PRIMARY KEY,
    canonical_person_id INTEGER REFERENCES unconfirmed_persons(id) ON DELETE CASCADE,
    duplicate_person_id INTEGER REFERENCES unconfirmed_persons(id) ON DELETE CASCADE,
    confidence VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT no_self_reference CHECK (canonical_person_id != duplicate_person_id)
);

CREATE INDEX idx_person_identifiers_canonical ON person_identifiers(canonical_person_id);
CREATE INDEX idx_person_identifiers_duplicate ON person_identifiers(duplicate_person_id);

COMMENT ON TABLE person_identifiers IS 'Maps duplicate person records to their canonical version';
COMMENT ON COLUMN person_identifiers.confidence IS 'high, medium, low';

-- 4. Queue Statistics View
CREATE OR REPLACE VIEW queue_stats AS
SELECT
    COUNT(*) FILTER (WHERE status = 'pending') as pending_urls,
    COUNT(*) FILTER (WHERE status = 'processing') as processing_urls,
    COUNT(*) FILTER (WHERE status = 'completed') as completed_urls,
    COUNT(*) FILTER (WHERE status = 'failed') as failed_urls,
    COUNT(*) FILTER (WHERE status = 'duplicate') as duplicate_urls,
    (
        SELECT COUNT(*)
        FROM unconfirmed_persons
        WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
    ) as persons_24h,
    (
        SELECT COUNT(*)
        FROM scraping_sessions
        WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
    ) as sessions_24h
FROM scraping_queue;

COMMENT ON VIEW queue_stats IS 'Real-time statistics for scraping queue and recent activity';

-- 5. Grant permissions (if using role-based access)
-- GRANT SELECT, INSERT, UPDATE ON scraping_queue TO reparations_user;
-- GRANT SELECT, INSERT, UPDATE ON person_duplicates TO reparations_user;
-- GRANT SELECT, INSERT, UPDATE ON person_identifiers TO reparations_user;
-- GRANT SELECT ON queue_stats TO reparations_user;

-- 6. Initial test data (optional - comment out for production)
-- INSERT INTO scraping_queue (url, category, submitted_by, priority) VALUES
-- ('https://en.wikipedia.org/wiki/George_Washington', 'wikipedia', 'system_test', 10),
-- ('https://en.wikipedia.org/wiki/Thomas_Jefferson', 'wikipedia', 'system_test', 10);

SELECT 'Migration completed successfully!' as status;
SELECT * FROM queue_stats;
