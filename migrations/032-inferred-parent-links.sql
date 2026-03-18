-- Migration 032: Inferred Parent Links
--
-- Tracks parent-child relationships discovered during ancestor climbing
-- when FamilySearch tree has no parent links. These are inferred from
-- historical records, census data, WikiTree, FindAGrave, participant info, etc.
--
-- Distinct from person_relationships_verified (migration 030) in that
-- this is climb-specific: tracks which session discovered each link,
-- the discovery method, and source URL for audit trail.

CREATE TABLE IF NOT EXISTS inferred_parent_links (
    id SERIAL PRIMARY KEY,
    session_id UUID REFERENCES ancestor_climb_sessions(id) ON DELETE SET NULL,
    child_fs_id TEXT,
    child_name TEXT NOT NULL,
    parent_name TEXT NOT NULL,
    parent_fs_id TEXT,          -- NULL if only found in records (no tree person)
    relationship TEXT NOT NULL,  -- 'father', 'mother'
    discovery_method TEXT NOT NULL,
        -- 'participant_provided' - participant gave parent names at kiosk intake
        -- 'record_search'       - found via FamilySearch historical record search
        -- 'census_household'    - inferred from census household structure
        -- 'research_hint'       - from FamilySearch Research Hints on person page
        -- 'tree_search'         - found by searching FamilySearch tree by name
        -- 'wikitree'            - cross-referenced from WikiTree profile
        -- 'findagrave'          - from FindAGrave family connections
        -- 'slavevoyages'        - from SlaveVoyages.org enslaver records
        -- 'ucl_lbs'             - from UCL Legacies of British Slavery
        -- 'ipums_census'        - from IPUMS census API data
    source_url TEXT,             -- URL of the source record/page
    source_type TEXT,            -- 'census', 'birth_record', 'marriage_record', 'death_record', 'profile', 'memorial'
    confidence NUMERIC(4,3) DEFAULT 0.500,
    verified BOOLEAN DEFAULT false,
    verified_at TIMESTAMP,
    verified_by TEXT,            -- operator who verified
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_inferred_parents_session ON inferred_parent_links(session_id);
CREATE INDEX IF NOT EXISTS idx_inferred_parents_child_fs ON inferred_parent_links(child_fs_id);
CREATE INDEX IF NOT EXISTS idx_inferred_parents_parent_fs ON inferred_parent_links(parent_fs_id);
CREATE INDEX IF NOT EXISTS idx_inferred_parents_method ON inferred_parent_links(discovery_method);
CREATE INDEX IF NOT EXISTS idx_inferred_parents_unverified ON inferred_parent_links(verified) WHERE verified = false;

-- Add source column to ancestor_climb_sessions to track which discovery methods were used
DO $$ BEGIN
    ALTER TABLE ancestor_climb_sessions ADD COLUMN IF NOT EXISTS discovery_methods_used TEXT[] DEFAULT '{}';
    ALTER TABLE ancestor_climb_sessions ADD COLUMN IF NOT EXISTS inferred_links_count INTEGER DEFAULT 0;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
