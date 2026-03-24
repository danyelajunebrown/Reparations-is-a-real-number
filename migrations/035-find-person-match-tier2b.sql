-- Migration 035: Add Tier 2b to find_person_match()
-- Relaxes matching when birth_year is NULL on either side.
-- Tier 2b: name + state match (birth year NULL on either side), confidence 0.60
-- Only matches person_type IN ('enslaver', 'slaveholder', 'owner')
-- Runs AFTER Tier 2 but BEFORE Tier 3.

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
    -- ====== TIER 1: External ID Match (0.95+ confidence) ======
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

    -- ====== TIER 2: Name + Birth Year (+-5yr) + State Match (0.70+ confidence) ======
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

    -- ====== TIER 2b: Name + State Match when birth year NULL on either side (0.60 confidence) ======
    -- Catches cases where canonical_persons.birth_year_estimate IS NULL or caller has no birth year,
    -- but we still have a name + state match. Restricted to enslavers/slaveholders/owners only.
    IF p_name IS NOT NULL AND p_location IS NOT NULL THEN
        RETURN QUERY
        SELECT
            cp.id AS canonical_person_id,
            cp.uuid AS canonical_uuid,
            cp.canonical_name::TEXT,
            2 AS match_tier,
            -- Base 0.60, +0.05 if exact canonical_name match, +0.05 if person_type matches
            (0.60 +
             CASE WHEN LOWER(cp.canonical_name) = LOWER(p_name) THEN 0.05 ELSE 0.00 END +
             CASE WHEN p_person_type IS NOT NULL AND cp.person_type = p_person_type THEN 0.05 ELSE 0.00 END
            )::NUMERIC(4,3) AS match_confidence,
            ('Name + location match (birth year NULL — Tier 2b)')::TEXT AS match_details,
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
        AND cp.primary_state IS NOT NULL
        AND LOWER(cp.primary_state) = LOWER(p_location)
        AND cp.person_type IN ('enslaver', 'slaveholder', 'owner')
        -- Only activate when birth year is NULL on at least one side
        AND (cp.birth_year_estimate IS NULL OR p_birth_year IS NULL)
        ORDER BY
            CASE WHEN LOWER(cp.canonical_name) = LOWER(p_name) THEN 0 ELSE 1 END
        LIMIT 5;

        IF FOUND THEN RETURN; END IF;
    END IF;

    -- ====== TIER 3: Name-Only Match (0.50 confidence) ======
    -- NEVER auto-accepted -- flagged for operator review
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

COMMENT ON FUNCTION find_person_match IS 'Tiered person matching: Tier 1 (external ID), Tier 2 (name+date+location), Tier 2b (name+location when birth year NULL, enslavers only), Tier 3 (name-only, needs review)';
