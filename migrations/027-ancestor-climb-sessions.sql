-- Migration 024: Ancestor Climb Sessions
-- Purpose: Track ancestor climbing sessions for resume capability and results storage
--
-- The ancestor climber now:
-- 1. Finds ALL slaveholder matches (not just first)
-- 2. Saves progress to DB for resume after interruption
-- 3. Tracks credit vs debt classification per lineage path

-- Table: Climb Sessions (for resume and results)
CREATE TABLE IF NOT EXISTS ancestor_climb_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Starting person
    modern_person_name TEXT NOT NULL,
    modern_person_fs_id TEXT NOT NULL,

    -- Session status
    status TEXT DEFAULT 'in_progress',
    -- Values: 'in_progress', 'completed', 'failed', 'paused'

    -- Timestamps
    started_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP,
    last_activity TIMESTAMP DEFAULT NOW(),

    -- Progress tracking
    ancestors_visited INTEGER DEFAULT 0,
    max_generation_reached INTEGER DEFAULT 0,
    matches_found INTEGER DEFAULT 0,

    -- Resume state (JSONB for flexibility)
    current_queue JSONB DEFAULT '[]'::jsonb,
    -- Format: [{fs_id, generation, path: [names]}]

    visited_set TEXT[] DEFAULT ARRAY[]::TEXT[],
    -- Array of visited FamilySearch IDs

    -- Results
    all_matches JSONB DEFAULT '[]'::jsonb,
    -- Format: [{person: {...}, match: {...}, generation, path, classification}]

    -- Configuration used
    config JSONB DEFAULT '{}'::jsonb,
    -- Store: max_generations, historical_cutoff, match_mode, etc.

    -- Error tracking
    last_error TEXT,
    error_count INTEGER DEFAULT 0,

    -- Metadata
    created_by TEXT DEFAULT 'ancestor_climber',
    notes TEXT
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_acs_status ON ancestor_climb_sessions(status);
CREATE INDEX IF NOT EXISTS idx_acs_modern_person ON ancestor_climb_sessions(modern_person_fs_id);
CREATE INDEX IF NOT EXISTS idx_acs_started_at ON ancestor_climb_sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_acs_matches_found ON ancestor_climb_sessions(matches_found);

-- Table: Individual Matches (normalized from all_matches for easier querying)
CREATE TABLE IF NOT EXISTS ancestor_climb_matches (
    id SERIAL PRIMARY KEY,

    -- Link to session
    session_id UUID REFERENCES ancestor_climb_sessions(id) ON DELETE CASCADE,

    -- Modern person (start of climb)
    modern_person_name TEXT NOT NULL,
    modern_person_fs_id TEXT NOT NULL,

    -- Slaveholder found
    slaveholder_id INTEGER, -- References canonical_persons if exists
    slaveholder_name TEXT NOT NULL,
    slaveholder_fs_id TEXT,
    slaveholder_birth_year INTEGER,
    slaveholder_location TEXT,

    -- Connection details
    generation_distance INTEGER NOT NULL,
    lineage_path TEXT[] NOT NULL, -- Array of names from modern to slaveholder
    lineage_path_fs_ids TEXT[], -- Array of FS IDs

    -- Match quality
    match_type TEXT, -- 'exact_fs_match', 'exact_name_match', 'name_match', 'unconfirmed_owner'
    match_confidence DECIMAL(3,2),

    -- Credit vs Debt classification
    classification TEXT NOT NULL DEFAULT 'debt',
    -- Values: 'debt' (inheritance line), 'credit' (rape/violence victim line), 'mixed'
    classification_reason TEXT,

    -- Financial calculation
    credit_amount DECIMAL(20,2) DEFAULT 0,
    debt_amount DECIMAL(20,2) DEFAULT 0,
    net_amount DECIMAL(20,2) DEFAULT 0,

    -- Verification
    verified BOOLEAN DEFAULT false,
    verified_by TEXT,
    verified_at TIMESTAMP,

    -- Metadata
    found_at TIMESTAMP DEFAULT NOW(),
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_acm_session ON ancestor_climb_matches(session_id);
CREATE INDEX IF NOT EXISTS idx_acm_modern_person ON ancestor_climb_matches(modern_person_fs_id);
CREATE INDEX IF NOT EXISTS idx_acm_slaveholder ON ancestor_climb_matches(slaveholder_id);
CREATE INDEX IF NOT EXISTS idx_acm_slaveholder_name ON ancestor_climb_matches(slaveholder_name);
CREATE INDEX IF NOT EXISTS idx_acm_classification ON ancestor_climb_matches(classification);
CREATE INDEX IF NOT EXISTS idx_acm_generation ON ancestor_climb_matches(generation_distance);

-- View: Active/Resumable Sessions
CREATE OR REPLACE VIEW resumable_climb_sessions AS
SELECT
    id,
    modern_person_name,
    modern_person_fs_id,
    status,
    started_at,
    last_activity,
    ancestors_visited,
    matches_found,
    jsonb_array_length(current_queue) as queue_size,
    array_length(visited_set, 1) as visited_count,
    EXTRACT(EPOCH FROM (NOW() - last_activity))/3600 as hours_since_activity
FROM ancestor_climb_sessions
WHERE status IN ('in_progress', 'paused')
ORDER BY last_activity DESC;

-- View: Match Summary by Modern Person
CREATE OR REPLACE VIEW climb_match_summary AS
SELECT
    modern_person_name,
    modern_person_fs_id,
    COUNT(*) as total_matches,
    COUNT(*) FILTER (WHERE classification = 'debt') as debt_connections,
    COUNT(*) FILTER (WHERE classification = 'credit') as credit_connections,
    COUNT(*) FILTER (WHERE classification = 'mixed') as mixed_connections,
    MIN(generation_distance) as closest_connection,
    MAX(generation_distance) as furthest_connection,
    SUM(debt_amount) as total_debt,
    SUM(credit_amount) as total_credit,
    SUM(net_amount) as net_position,
    STRING_AGG(DISTINCT slaveholder_name, ', ' ORDER BY slaveholder_name) as slaveholders_found
FROM ancestor_climb_matches
GROUP BY modern_person_name, modern_person_fs_id;

-- Comments
COMMENT ON TABLE ancestor_climb_sessions IS 'Tracks ancestor climbing sessions for resume capability. Each session explores one modern person''s ancestry.';
COMMENT ON TABLE ancestor_climb_matches IS 'Individual slaveholder matches found during climbing. Normalized from session all_matches for easier querying.';
COMMENT ON COLUMN ancestor_climb_matches.classification IS 'debt = pure inheritance (owes reparations), credit = descended from rape/violence victim (owed reparations), mixed = both in lineage';
