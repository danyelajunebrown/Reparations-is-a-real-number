-- Migration: 018-enslaved-owner-relationships.sql
-- Purpose: Create explicit relationships between enslaved individuals and their owners
-- Currently enslaved and owners are stored separately in unconfirmed_persons with
-- only implicit linking via shared source_url. This creates explicit relationships.

-- ============================================================================
-- 1. CREATE ENSLAVED-OWNER RELATIONSHIP TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS enslaved_owner_relationships (
    id SERIAL PRIMARY KEY,

    -- The enslaved person
    enslaved_person_id INTEGER REFERENCES unconfirmed_persons(lead_id) ON DELETE CASCADE,
    enslaved_canonical_id INTEGER REFERENCES canonical_persons(id) ON DELETE SET NULL,
    enslaved_name VARCHAR(255) NOT NULL,

    -- The owner/enslaver
    owner_person_id INTEGER REFERENCES unconfirmed_persons(lead_id) ON DELETE CASCADE,
    owner_canonical_id INTEGER REFERENCES canonical_persons(id) ON DELETE SET NULL,
    owner_name VARCHAR(255) NOT NULL,

    -- Relationship metadata
    relationship_type VARCHAR(50) DEFAULT 'enslaved_by',  -- enslaved_by, hired_from, purchased_from, inherited_from
    start_year INTEGER,           -- Year relationship began
    end_year INTEGER,             -- Year relationship ended (sale, death, freedom)
    relationship_source VARCHAR(50) DEFAULT 'same_document',  -- same_document, explicit_mention, inferred

    -- Source documentation
    source_url TEXT,              -- Where this relationship was found
    source_document_id VARCHAR(255),
    source_context TEXT,          -- Relevant text snippet

    -- Confidence and verification
    confidence_score DECIMAL(3,2) DEFAULT 0.70,
    verification_status VARCHAR(30) DEFAULT 'unverified',  -- unverified, human_verified, confirmed
    verified_by VARCHAR(100),
    verified_at TIMESTAMP,

    -- Tracking
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(100) DEFAULT 'system',

    -- Prevent exact duplicates
    UNIQUE(enslaved_person_id, owner_person_id, relationship_type)
);

-- Add indexes for common queries
CREATE INDEX IF NOT EXISTS idx_eor_enslaved_person ON enslaved_owner_relationships(enslaved_person_id);
CREATE INDEX IF NOT EXISTS idx_eor_owner_person ON enslaved_owner_relationships(owner_person_id);
CREATE INDEX IF NOT EXISTS idx_eor_enslaved_canonical ON enslaved_owner_relationships(enslaved_canonical_id);
CREATE INDEX IF NOT EXISTS idx_eor_owner_canonical ON enslaved_owner_relationships(owner_canonical_id);
CREATE INDEX IF NOT EXISTS idx_eor_source_url ON enslaved_owner_relationships(source_url);
CREATE INDEX IF NOT EXISTS idx_eor_verification ON enslaved_owner_relationships(verification_status);

COMMENT ON TABLE enslaved_owner_relationships IS 'Links enslaved individuals to their owners/enslavers with source documentation';

-- ============================================================================
-- 2. ADD OWNER REFERENCE TO ENSLAVED_INDIVIDUALS TABLE
-- ============================================================================
-- Update the existing enslaved_individuals table to properly use enslaved_by_individual_id

-- First check if we need a separate owner table or use canonical_persons
-- Using canonical_persons for owners since they're already tracked there

COMMENT ON COLUMN enslaved_individuals.enslaved_by_individual_id IS 'References canonical_persons.id for the owner';

-- ============================================================================
-- 3. VIEW: ENSLAVED WITH THEIR OWNERS
-- ============================================================================

CREATE OR REPLACE VIEW enslaved_with_owners AS
SELECT
    eor.id as relationship_id,
    eor.enslaved_name,
    eor.owner_name,
    eor.relationship_type,
    eor.start_year,
    eor.end_year,
    eor.confidence_score,
    eor.verification_status,
    eor.source_url,
    eor.source_context,
    up_enslaved.lead_id as enslaved_lead_id,
    up_owner.lead_id as owner_lead_id,
    cp_enslaved.id as enslaved_canonical_id,
    cp_enslaved.canonical_name as enslaved_canonical_name,
    cp_owner.id as owner_canonical_id,
    cp_owner.canonical_name as owner_canonical_name
FROM enslaved_owner_relationships eor
LEFT JOIN unconfirmed_persons up_enslaved ON eor.enslaved_person_id = up_enslaved.lead_id
LEFT JOIN unconfirmed_persons up_owner ON eor.owner_person_id = up_owner.lead_id
LEFT JOIN canonical_persons cp_enslaved ON eor.enslaved_canonical_id = cp_enslaved.id
LEFT JOIN canonical_persons cp_owner ON eor.owner_canonical_id = cp_owner.id;

COMMENT ON VIEW enslaved_with_owners IS 'Shows enslaved individuals with their associated owners';

-- ============================================================================
-- 4. FUNCTION: LINK ENSLAVED TO OWNERS BY SOURCE URL
-- ============================================================================
-- This function can be called to retroactively link enslaved and owners
-- from the same source document

CREATE OR REPLACE FUNCTION link_enslaved_to_owners_by_source()
RETURNS TABLE (
    relationships_created INTEGER,
    documents_processed INTEGER
) AS $$
DECLARE
    v_relationships_created INTEGER := 0;
    v_documents_processed INTEGER := 0;
    v_source RECORD;
    v_enslaved RECORD;
    v_owner RECORD;
BEGIN
    -- Find all source URLs that have BOTH enslaved and slaveholders
    FOR v_source IN
        SELECT source_url
        FROM unconfirmed_persons
        WHERE source_url IS NOT NULL
        GROUP BY source_url
        HAVING COUNT(*) FILTER (WHERE person_type = 'enslaved') > 0
           AND COUNT(*) FILTER (WHERE person_type IN ('slaveholder', 'owner')) > 0
    LOOP
        v_documents_processed := v_documents_processed + 1;

        -- For each enslaved person in this document
        FOR v_enslaved IN
            SELECT lead_id, full_name, context_text
            FROM unconfirmed_persons
            WHERE source_url = v_source.source_url
            AND person_type = 'enslaved'
        LOOP
            -- Link to each slaveholder/owner in the same document
            FOR v_owner IN
                SELECT lead_id, full_name
                FROM unconfirmed_persons
                WHERE source_url = v_source.source_url
                AND person_type IN ('slaveholder', 'owner')
            LOOP
                -- Insert relationship if not exists
                INSERT INTO enslaved_owner_relationships (
                    enslaved_person_id,
                    enslaved_name,
                    owner_person_id,
                    owner_name,
                    relationship_type,
                    relationship_source,
                    source_url,
                    source_context,
                    confidence_score,
                    created_by
                )
                VALUES (
                    v_enslaved.lead_id,
                    v_enslaved.full_name,
                    v_owner.lead_id,
                    v_owner.full_name,
                    'enslaved_by',
                    'same_document',
                    v_source.source_url,
                    LEFT(v_enslaved.context_text, 500),
                    0.65,  -- Lower confidence for inferred relationships
                    'link_enslaved_to_owners_by_source'
                )
                ON CONFLICT (enslaved_person_id, owner_person_id, relationship_type)
                DO NOTHING;

                IF FOUND THEN
                    v_relationships_created := v_relationships_created + 1;
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;

    RETURN QUERY SELECT v_relationships_created, v_documents_processed;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION link_enslaved_to_owners_by_source IS 'Creates relationships between enslaved and owners who appear in the same source document';

-- ============================================================================
-- 5. FUNCTION: GET ENSLAVED BY OWNER
-- ============================================================================

CREATE OR REPLACE FUNCTION get_enslaved_by_owner(p_owner_name VARCHAR)
RETURNS TABLE (
    enslaved_name VARCHAR,
    relationship_type VARCHAR,
    confidence DECIMAL,
    source_url TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        eor.enslaved_name::VARCHAR,
        eor.relationship_type::VARCHAR,
        eor.confidence_score,
        eor.source_url
    FROM enslaved_owner_relationships eor
    WHERE eor.owner_name ILIKE '%' || p_owner_name || '%'
    ORDER BY eor.confidence_score DESC, eor.enslaved_name;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 6. FUNCTION: GET OWNERS OF ENSLAVED
-- ============================================================================

CREATE OR REPLACE FUNCTION get_owners_of_enslaved(p_enslaved_name VARCHAR)
RETURNS TABLE (
    owner_name VARCHAR,
    relationship_type VARCHAR,
    confidence DECIMAL,
    source_url TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        eor.owner_name::VARCHAR,
        eor.relationship_type::VARCHAR,
        eor.confidence_score,
        eor.source_url
    FROM enslaved_owner_relationships eor
    WHERE eor.enslaved_name ILIKE '%' || p_enslaved_name || '%'
    ORDER BY eor.confidence_score DESC, eor.owner_name;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 7. STATS VIEW
-- ============================================================================

CREATE OR REPLACE VIEW enslaved_owner_stats AS
SELECT
    COUNT(DISTINCT enslaved_person_id) as unique_enslaved_linked,
    COUNT(DISTINCT owner_person_id) as unique_owners_linked,
    COUNT(*) as total_relationships,
    COUNT(*) FILTER (WHERE verification_status = 'confirmed') as confirmed_relationships,
    COUNT(*) FILTER (WHERE verification_status = 'human_verified') as human_verified,
    COUNT(*) FILTER (WHERE verification_status = 'unverified') as unverified,
    AVG(confidence_score)::DECIMAL(3,2) as avg_confidence
FROM enslaved_owner_relationships;

-- Success message
SELECT 'Migration 018 completed: Enslaved-owner relationship system created' AS status;
