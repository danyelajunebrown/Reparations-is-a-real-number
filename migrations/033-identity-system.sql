-- Migration 033: Identity System Overhaul
-- Enhances canonical_persons as the single authoritative identity system.
-- Adds UUID, identity fingerprinting, tiered matching, external ID tracking,
-- evidence tables, and the find_person_match() function.
--
-- Key decision: Enhance canonical_persons (192K rows), don't create a new table.
-- Migration 030 (unified_persons) was never applied — its useful concepts are folded in here.

-- =============================================================================
-- STEP 1: ADD UUID + IDENTITY COLUMNS TO canonical_persons
-- =============================================================================

ALTER TABLE canonical_persons ADD COLUMN IF NOT EXISTS uuid UUID DEFAULT gen_random_uuid();
ALTER TABLE canonical_persons ADD COLUMN IF NOT EXISTS identity_fingerprint VARCHAR(64);
ALTER TABLE canonical_persons ADD COLUMN IF NOT EXISTS match_tier INTEGER DEFAULT 3;
  -- 1 = external ID verified, 2 = name+date+location verified, 3 = name-only/unverified

-- Backfill UUIDs for existing rows
UPDATE canonical_persons SET uuid = gen_random_uuid() WHERE uuid IS NULL;

-- Enforce NOT NULL and uniqueness
ALTER TABLE canonical_persons ALTER COLUMN uuid SET NOT NULL;
DO $$ BEGIN
    ALTER TABLE canonical_persons ADD CONSTRAINT canonical_persons_uuid_unique UNIQUE (uuid);
EXCEPTION WHEN duplicate_table THEN NULL;
          WHEN duplicate_object THEN NULL;
END $$;

-- Backfill identity_fingerprint where all three key fields exist
-- Fingerprint = md5(lower(last_name) || '|' || birth_year_estimate || '|' || lower(primary_state))
-- This is a DEDUP DETECTION TOOL, not a unique constraint.
UPDATE canonical_persons
SET identity_fingerprint = md5(
    LOWER(COALESCE(last_name, '')) || '|' ||
    COALESCE(birth_year_estimate::text, '') || '|' ||
    LOWER(COALESCE(primary_state, ''))
)
WHERE last_name IS NOT NULL
  AND birth_year_estimate IS NOT NULL
  AND primary_state IS NOT NULL
  AND identity_fingerprint IS NULL;

-- Backfill match_tier for existing rows based on available data
UPDATE canonical_persons
SET match_tier = CASE
    -- Tier 1: Has an external ID in notes (FamilySearch, SlaveVoyages, etc.)
    WHEN notes::text LIKE '%familysearch_id%'
      OR notes::text LIKE '%slavevoyages_id%'
      OR notes::text LIKE '%wikitree_id%'
    THEN 1
    -- Tier 2: Has name + date + location
    WHEN last_name IS NOT NULL
      AND birth_year_estimate IS NOT NULL
      AND primary_state IS NOT NULL
    THEN 2
    -- Tier 3: Everything else
    ELSE 3
END
WHERE match_tier = 3 OR match_tier IS NULL;

-- Index for UUID lookups
CREATE INDEX IF NOT EXISTS idx_canonical_persons_uuid ON canonical_persons(uuid);

-- Index for fingerprint-based dedup detection
CREATE INDEX IF NOT EXISTS idx_canonical_persons_fingerprint ON canonical_persons(identity_fingerprint)
    WHERE identity_fingerprint IS NOT NULL;

-- Index for match_tier queries
CREATE INDEX IF NOT EXISTS idx_canonical_persons_match_tier ON canonical_persons(match_tier);

-- Trigger to auto-compute fingerprint on INSERT/UPDATE
CREATE OR REPLACE FUNCTION compute_identity_fingerprint()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.last_name IS NOT NULL
       AND NEW.birth_year_estimate IS NOT NULL
       AND NEW.primary_state IS NOT NULL
    THEN
        NEW.identity_fingerprint := md5(
            LOWER(COALESCE(NEW.last_name, '')) || '|' ||
            COALESCE(NEW.birth_year_estimate::text, '') || '|' ||
            LOWER(COALESCE(NEW.primary_state, ''))
        );
    ELSE
        NEW.identity_fingerprint := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_compute_fingerprint ON canonical_persons;
CREATE TRIGGER trg_compute_fingerprint
BEFORE INSERT OR UPDATE OF last_name, birth_year_estimate, primary_state
ON canonical_persons
FOR EACH ROW
EXECUTE FUNCTION compute_identity_fingerprint();


-- =============================================================================
-- STEP 2: CREATE person_external_ids TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS person_external_ids (
    id SERIAL PRIMARY KEY,
    canonical_person_id INTEGER NOT NULL REFERENCES canonical_persons(id) ON DELETE CASCADE,
    id_system VARCHAR(50) NOT NULL,     -- 'familysearch', 'wikitree', 'slavevoyages', 'findagrave'
    external_id VARCHAR(255) NOT NULL,
    external_url TEXT,
    confidence NUMERIC(4,3) DEFAULT 0.900,
    verified BOOLEAN DEFAULT false,
    discovered_by VARCHAR(100) DEFAULT 'system',
    discovered_at TIMESTAMP DEFAULT NOW(),
    session_id UUID,
    UNIQUE(id_system, external_id)      -- One FS ID can't belong to two people
);

CREATE INDEX IF NOT EXISTS idx_person_ext_ids_person ON person_external_ids(canonical_person_id);
CREATE INDEX IF NOT EXISTS idx_person_ext_ids_system ON person_external_ids(id_system, external_id);
CREATE INDEX IF NOT EXISTS idx_person_ext_ids_verified ON person_external_ids(verified);

-- Migrate existing FamilySearch IDs from canonical_persons.notes (TEXT column, cast to jsonb)
INSERT INTO person_external_ids (canonical_person_id, id_system, external_id, external_url, confidence, discovered_by)
SELECT
    id,
    'familysearch',
    notes::jsonb->>'familysearch_id',
    'https://www.familysearch.org/tree/person/details/' || (notes::jsonb->>'familysearch_id'),
    0.95,
    'migration_033'
FROM canonical_persons
WHERE notes IS NOT NULL
  AND notes::text LIKE '%familysearch_id%'
  AND notes::text LIKE '{%'  -- Only rows where notes is valid JSON
  AND (notes::jsonb->>'familysearch_id') IS NOT NULL
  AND length(notes::jsonb->>'familysearch_id') > 0
ON CONFLICT (id_system, external_id) DO NOTHING;

-- Migrate SlaveVoyages IDs from canonical_persons.notes (TEXT column, cast to jsonb)
INSERT INTO person_external_ids (canonical_person_id, id_system, external_id, external_url, confidence, discovered_by)
SELECT
    id,
    'slavevoyages',
    notes::jsonb->>'slavevoyages_id',
    'https://www.slavevoyages.org/past/database#' || (notes::jsonb->>'slavevoyages_id'),
    0.90,
    'migration_033'
FROM canonical_persons
WHERE notes IS NOT NULL
  AND notes::text LIKE '%slavevoyages_id%'
  AND notes::text LIKE '{%'  -- Only rows where notes is valid JSON
  AND (notes::jsonb->>'slavevoyages_id') IS NOT NULL
  AND length(notes::jsonb->>'slavevoyages_id') > 0
ON CONFLICT (id_system, external_id) DO NOTHING;


-- =============================================================================
-- STEP 3: EVIDENCE + RELATIONSHIP + MERGE LOG TABLES
-- Cherry-picked from migration 030, re-targeted at canonical_persons.id
-- =============================================================================

-- Person Evidence Sources — tracks documentary evidence per person
CREATE TABLE IF NOT EXISTS person_evidence_sources (
    id SERIAL PRIMARY KEY,
    canonical_person_id INTEGER NOT NULL REFERENCES canonical_persons(id) ON DELETE CASCADE,
    source_type VARCHAR(100) NOT NULL,  -- 'census', 'birth_cert', 'death_cert', 'marriage',
                                        -- 'familysearch', 'wikitree', 'probate', 'tax', etc.
    source_tier INTEGER NOT NULL,       -- 1=primary (created at time), 2=secondary (after), 3=tertiary (compiled)
    source_id VARCHAR(500),             -- External ID (WikiTree ID, FamilySearch PID, document ID, etc.)
    source_url TEXT,
    provides_birth_date BOOLEAN DEFAULT false,
    provides_death_date BOOLEAN DEFAULT false,
    provides_parent_relationship BOOLEAN DEFAULT false,
    provides_spouse_relationship BOOLEAN DEFAULT false,
    provides_location BOOLEAN DEFAULT false,
    provides_occupation BOOLEAN DEFAULT false,
    extracted_data JSONB,
    confidence_score NUMERIC(4,3) DEFAULT 0.5,
    ocr_confidence NUMERIC(4,3),
    extraction_method VARCHAR(100),     -- 'api', 'ocr', 'manual', 'pre-indexed'
    extracted_by VARCHAR(100),          -- 'familysearch_api', 'google_vision', 'volunteer', etc.
    added_at TIMESTAMP DEFAULT NOW(),
    verified_at TIMESTAMP,
    verified_by VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_evidence_sources_person ON person_evidence_sources(canonical_person_id);
CREATE INDEX IF NOT EXISTS idx_evidence_sources_type ON person_evidence_sources(source_type);
CREATE INDEX IF NOT EXISTS idx_evidence_sources_tier ON person_evidence_sources(source_tier);

-- Person Relationships Verified — family relationships backed by evidence
CREATE TABLE IF NOT EXISTS person_relationships_verified (
    id SERIAL PRIMARY KEY,
    person_id INTEGER NOT NULL REFERENCES canonical_persons(id) ON DELETE CASCADE,
    related_person_id INTEGER NOT NULL REFERENCES canonical_persons(id) ON DELETE CASCADE,
    relationship_type VARCHAR(50) NOT NULL,  -- 'parent', 'child', 'spouse', 'sibling', 'enslaver', 'enslaved'
    evidence_source_ids INTEGER[],          -- Array of FK to person_evidence_sources
    evidence_strength INTEGER DEFAULT 0,    -- 0-100 based on source quality
    has_conflicts BOOLEAN DEFAULT false,
    conflict_notes TEXT,
    verified_by VARCHAR(255),
    verified_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(person_id, related_person_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_relationships_person ON person_relationships_verified(person_id);
CREATE INDEX IF NOT EXISTS idx_relationships_related ON person_relationships_verified(related_person_id);
CREATE INDEX IF NOT EXISTS idx_relationships_type ON person_relationships_verified(relationship_type);

-- Person Merge Log — tracks merge decisions when duplicates are resolved
CREATE TABLE IF NOT EXISTS person_merge_log (
    id SERIAL PRIMARY KEY,
    surviving_person_id INTEGER NOT NULL REFERENCES canonical_persons(id),
    merged_person_id INTEGER NOT NULL,      -- The person that was merged away (may no longer exist)
    merge_reason TEXT,                       -- 'fingerprint_match', 'external_id_match', 'operator_confirmed'
    merge_details JSONB,                    -- Snapshot of merged person's data before deletion
    merged_by VARCHAR(100) DEFAULT 'system',
    merged_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_merge_log_surviving ON person_merge_log(surviving_person_id);
CREATE INDEX IF NOT EXISTS idx_merge_log_merged ON person_merge_log(merged_person_id);


-- =============================================================================
-- STEP 4: find_person_match() FUNCTION — TIERED MATCHING
-- =============================================================================

CREATE OR REPLACE FUNCTION find_person_match(
    p_name TEXT,
    p_birth_year INTEGER DEFAULT NULL,
    p_location TEXT DEFAULT NULL,
    p_person_type TEXT DEFAULT NULL,
    p_external_id TEXT DEFAULT NULL,
    p_id_system TEXT DEFAULT NULL
)
RETURNS TABLE (
    canonical_person_id INTEGER,
    canonical_uuid UUID,
    canonical_name TEXT,
    match_tier INTEGER,
    match_confidence NUMERIC(4,3),
    match_details TEXT,
    person_type TEXT,
    birth_year_estimate INTEGER,
    primary_state TEXT
) AS $$
BEGIN
    -- ═══ TIER 1: External ID Match (0.95+ confidence) ═══
    IF p_external_id IS NOT NULL AND p_id_system IS NOT NULL THEN
        RETURN QUERY
        SELECT
            cp.id AS canonical_person_id,
            cp.uuid AS canonical_uuid,
            cp.canonical_name::TEXT,
            1 AS match_tier,
            0.950::NUMERIC(4,3) AS match_confidence,
            ('External ID match: ' || p_id_system || '=' || p_external_id)::TEXT AS match_details,
            cp.person_type::TEXT,
            cp.birth_year_estimate,
            cp.primary_state::TEXT
        FROM person_external_ids pei
        JOIN canonical_persons cp ON cp.id = pei.canonical_person_id
        WHERE pei.id_system = p_id_system
          AND pei.external_id = p_external_id;

        -- If we got a Tier 1 hit, return it immediately
        IF FOUND THEN RETURN; END IF;
    END IF;

    -- ═══ TIER 2: Name + Birth Year (±5yr) + State Match (0.70+ confidence) ═══
    IF p_name IS NOT NULL AND p_birth_year IS NOT NULL AND p_location IS NOT NULL THEN
        RETURN QUERY
        SELECT
            cp.id AS canonical_person_id,
            cp.uuid AS canonical_uuid,
            cp.canonical_name::TEXT,
            2 AS match_tier,
            -- Confidence: 0.70 base + 0.10 if exact name + 0.10 if exact year + 0.05 if person_type matches
            (0.70 +
             CASE WHEN LOWER(cp.canonical_name) = LOWER(p_name) THEN 0.10 ELSE 0.00 END +
             CASE WHEN cp.birth_year_estimate = p_birth_year THEN 0.10 ELSE 0.00 END +
             CASE WHEN p_person_type IS NOT NULL AND cp.person_type = p_person_type THEN 0.05 ELSE 0.00 END
            )::NUMERIC(4,3) AS match_confidence,
            ('Name + date + location match')::TEXT AS match_details,
            cp.person_type::TEXT,
            cp.birth_year_estimate,
            cp.primary_state::TEXT
        FROM canonical_persons cp
        WHERE (
            LOWER(cp.canonical_name) = LOWER(p_name)
            OR (
                LOWER(cp.last_name) = LOWER(split_part(p_name, ' ', array_length(string_to_array(p_name, ' '), 1)))
                AND LOWER(cp.first_name) = LOWER(split_part(p_name, ' ', 1))
            )
        )
        AND cp.birth_year_estimate IS NOT NULL
        AND ABS(cp.birth_year_estimate - p_birth_year) <= 5
        AND cp.primary_state IS NOT NULL
        AND LOWER(cp.primary_state) = LOWER(p_location)
        ORDER BY
            CASE WHEN LOWER(cp.canonical_name) = LOWER(p_name) THEN 0 ELSE 1 END,
            ABS(COALESCE(cp.birth_year_estimate, 0) - COALESCE(p_birth_year, 0))
        LIMIT 5;

        IF FOUND THEN RETURN; END IF;
    END IF;

    -- ═══ TIER 3: Name-Only Match (0.50 confidence) ═══
    -- NEVER auto-accepted — flagged for operator review
    IF p_name IS NOT NULL THEN
        RETURN QUERY
        SELECT
            cp.id AS canonical_person_id,
            cp.uuid AS canonical_uuid,
            cp.canonical_name::TEXT,
            3 AS match_tier,
            -- Base 0.50, slight bonus for date/location proximity if available
            (0.50 +
             CASE WHEN p_birth_year IS NOT NULL AND cp.birth_year_estimate IS NOT NULL
                  AND ABS(cp.birth_year_estimate - p_birth_year) <= 15 THEN 0.10 ELSE 0.00 END +
             CASE WHEN p_location IS NOT NULL AND cp.primary_state IS NOT NULL
                  AND LOWER(cp.primary_state) = LOWER(p_location) THEN 0.10 ELSE 0.00 END
            )::NUMERIC(4,3) AS match_confidence,
            ('Name-only match — requires review')::TEXT AS match_details,
            cp.person_type::TEXT,
            cp.birth_year_estimate,
            cp.primary_state::TEXT
        FROM canonical_persons cp
        WHERE LOWER(cp.canonical_name) = LOWER(p_name)
           OR (
               LOWER(cp.last_name) = LOWER(split_part(p_name, ' ', array_length(string_to_array(p_name, ' '), 1)))
               AND LOWER(cp.first_name) = LOWER(split_part(p_name, ' ', 1))
           )
        ORDER BY
            CASE WHEN LOWER(cp.canonical_name) = LOWER(p_name) THEN 0 ELSE 1 END,
            ABS(COALESCE(cp.birth_year_estimate, 0) - COALESCE(p_birth_year, 0))
        LIMIT 10;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;


-- =============================================================================
-- DEDUP DETECTION VIEW
-- Shows clusters of potential duplicate persons sharing the same fingerprint
-- =============================================================================

CREATE OR REPLACE VIEW potential_duplicate_persons AS
SELECT
    identity_fingerprint,
    COUNT(*) AS cluster_size,
    array_agg(id ORDER BY id) AS person_ids,
    array_agg(canonical_name ORDER BY id) AS names,
    MIN(birth_year_estimate) AS min_birth_year,
    MAX(birth_year_estimate) AS max_birth_year,
    array_agg(DISTINCT primary_state) AS states
FROM canonical_persons
WHERE identity_fingerprint IS NOT NULL
GROUP BY identity_fingerprint
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC;


-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON COLUMN canonical_persons.uuid IS 'Globally unique identifier for cross-system references';
COMMENT ON COLUMN canonical_persons.identity_fingerprint IS 'md5(last_name|birth_year|state) — dedup detection, not unique constraint';
COMMENT ON COLUMN canonical_persons.match_tier IS '1=external ID verified, 2=name+date+location, 3=name-only/unverified';
COMMENT ON TABLE person_external_ids IS 'Junction table linking canonical_persons to external system IDs (FamilySearch, WikiTree, SlaveVoyages, etc.)';
COMMENT ON TABLE person_evidence_sources IS 'Documentary evidence supporting person records, re-targeted at canonical_persons';
COMMENT ON TABLE person_relationships_verified IS 'Family relationships backed by evidence with uniqueness constraint';
COMMENT ON TABLE person_merge_log IS 'Audit trail for duplicate person merges';
COMMENT ON FUNCTION find_person_match IS 'Tiered person matching: Tier 1 (external ID), Tier 2 (name+date+location), Tier 3 (name-only, needs review)';
