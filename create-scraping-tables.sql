-- ==========================================
-- SCRAPING QUEUE TABLES
-- Run this to add scraping tables to existing database
-- ==========================================

-- Web scraping queue for automated research submissions
CREATE TABLE IF NOT EXISTS scraping_queue (
    id SERIAL PRIMARY KEY,
    url TEXT NOT NULL UNIQUE,
    category VARCHAR(50) DEFAULT 'other',
    submitted_by VARCHAR(255) DEFAULT 'anonymous',
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    priority INTEGER DEFAULT 5,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processing_started_at TIMESTAMP,
    processing_completed_at TIMESTAMP,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    error_message TEXT,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_scraping_queue_status ON scraping_queue(status);
CREATE INDEX IF NOT EXISTS idx_scraping_queue_priority ON scraping_queue(priority DESC);
CREATE INDEX IF NOT EXISTS idx_scraping_queue_submitted_at ON scraping_queue(submitted_at);
CREATE INDEX IF NOT EXISTS idx_scraping_queue_category ON scraping_queue(category);

-- Scraping sessions tracking
CREATE TABLE IF NOT EXISTS scraping_sessions (
    id SERIAL PRIMARY KEY,
    queue_entry_id INTEGER REFERENCES scraping_queue(id),
    url TEXT NOT NULL,
    category VARCHAR(50),
    persons_extracted INTEGER DEFAULT 0,
    documents_extracted INTEGER DEFAULT 0,
    research_notes TEXT,
    raw_data JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_scraping_sessions_queue_entry ON scraping_sessions(queue_entry_id);
CREATE INDEX IF NOT EXISTS idx_scraping_sessions_created_at ON scraping_sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_scraping_sessions_category ON scraping_sessions(category);

-- View: Queue statistics
CREATE OR REPLACE VIEW queue_stats AS
SELECT
    COUNT(*) FILTER (WHERE status = 'pending') as pending_urls,
    COUNT(*) FILTER (WHERE status = 'processing') as processing_urls,
    COUNT(*) FILTER (WHERE status = 'completed') as completed_urls,
    COUNT(*) FILTER (WHERE status = 'failed') as failed_urls,
    COUNT(*) FILTER (WHERE submitted_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours') as submissions_24h,
    COUNT(DISTINCT i.individual_id) FILTER (WHERE i.created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours') as persons_24h,
    COUNT(ss.id) FILTER (WHERE ss.created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours') as sessions_24h
FROM scraping_queue sq
LEFT JOIN scraping_sessions ss ON sq.id = ss.queue_entry_id
LEFT JOIN individuals i ON i.created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours';

-- Test queries
SELECT 'Scraping tables created successfully!' AS status;
SELECT COUNT(*) as queue_count FROM scraping_queue;
SELECT COUNT(*) as sessions_count FROM scraping_sessions;
