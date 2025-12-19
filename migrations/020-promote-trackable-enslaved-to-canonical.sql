-- Migration: 020-promote-trackable-enslaved-to-canonical.sql
-- Purpose: Promote enslaved individuals with family connections to canonical_persons
-- Criterion: Must have at least ONE family link (spouse, parent, or child)
-- This enables descendant tracking for reparations distribution

-- Step 1: Promote enslaved_individuals with family data to canonical_persons
INSERT INTO canonical_persons (
    canonical_name,
    person_type,
    enslaved_person_id,
    birth_year_estimate,
    death_year_estimate,
    sex,
    verification_status,
    confidence_score,
    notes,
    created_by
)
SELECT
    ei.full_name,
    'enslaved',
    ei.enslaved_id,
    ei.birth_year,
    ei.death_year,
    ei.gender,
    'family_verified',  -- Has family connection
    0.90,  -- High confidence due to family links
    CONCAT(
        'Family connections: ',
        CASE WHEN ei.spouse_name IS NOT NULL AND ei.spouse_name != ''
             THEN 'Spouse: ' || ei.spouse_name || '. ' ELSE '' END,
        CASE WHEN ei.child_names IS NOT NULL AND array_length(ei.child_names, 1) > 0
             THEN 'Children: ' || array_to_string(ei.child_names, ', ') || '. ' ELSE '' END,
        CASE WHEN ei.spouse_ids IS NOT NULL AND array_length(ei.spouse_ids, 1) > 0
             THEN 'Spouse IDs: ' || array_to_string(ei.spouse_ids, ', ') || '. ' ELSE '' END,
        CASE WHEN ei.parent_ids IS NOT NULL AND array_length(ei.parent_ids, 1) > 0
             THEN 'Parent IDs: ' || array_to_string(ei.parent_ids, ', ') || '. ' ELSE '' END,
        CASE WHEN ei.child_ids IS NOT NULL AND array_length(ei.child_ids, 1) > 0
             THEN 'Child IDs: ' || array_to_string(ei.child_ids, ', ') || '. ' ELSE '' END
    ),
    'migration_020'
FROM enslaved_individuals ei
WHERE (
    -- Has spouse
    (ei.spouse_name IS NOT NULL AND ei.spouse_name != '')
    OR (ei.spouse_ids IS NOT NULL AND array_length(ei.spouse_ids, 1) > 0)
    -- Has parents
    OR (ei.parent_ids IS NOT NULL AND array_length(ei.parent_ids, 1) > 0)
    -- Has children
    OR (ei.child_names IS NOT NULL AND array_length(ei.child_names, 1) > 0)
    OR (ei.child_ids IS NOT NULL AND array_length(ei.child_ids, 1) > 0)
)
-- Don't duplicate if already in canonical
AND ei.enslaved_id NOT IN (
    SELECT enslaved_person_id FROM canonical_persons
    WHERE enslaved_person_id IS NOT NULL
);

-- Step 2: Update enslaved_individuals to link back to their canonical record
UPDATE enslaved_individuals ei
SET notes = COALESCE(notes, '') || ' [Promoted to canonical_persons]'
WHERE ei.enslaved_id IN (
    SELECT enslaved_person_id FROM canonical_persons
    WHERE enslaved_person_id IS NOT NULL
    AND person_type = 'enslaved'
);

-- Step 3: Create view for identifying more promotable enslaved from unconfirmed_persons
CREATE OR REPLACE VIEW promotable_enslaved_candidates AS
SELECT
    lead_id,
    full_name,
    context_text,
    source_url,
    confidence_score,
    -- Extract family relationship type from context
    CASE
        WHEN context_text ~* (full_name || ',?\s+(wife|husband)\s+of') THEN 'spouse'
        WHEN context_text ~* (full_name || ',?\s+(son|daughter|child)\s+of') THEN 'child_of'
        WHEN context_text ~* (full_name || ',?\s+(mother|father)\s+of') THEN 'parent_of'
        WHEN context_text ~* ('(wife|husband)\s+of\s+' || full_name) THEN 'spouse'
        ELSE 'unclear'
    END as relationship_type,
    -- Extract potential related person name
    SUBSTRING(context_text FROM (full_name || ',?\s+(?:wife|husband|son|daughter|child|mother|father)\s+of\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)')) as related_person
FROM unconfirmed_persons
WHERE person_type = 'enslaved'
AND confidence_score >= 0.7
AND LENGTH(full_name) > 3
AND full_name !~* '^(the|african|person|slave|negro|colored|district|service|labor|claim|unknown)'
AND (
    context_text ~* (full_name || ',?\s+(wife|husband|mother|father|son|daughter|child)\s+of')
    OR context_text ~* ('(wife|husband|mother|father)\s+of\s+' || full_name)
)
ORDER BY confidence_score DESC;

-- Step 4: Create helper function for manual promotion
CREATE OR REPLACE FUNCTION promote_enslaved_to_canonical(
    p_enslaved_id VARCHAR(255),
    p_family_note TEXT DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
    v_canonical_id INTEGER;
BEGIN
    -- Check if already promoted
    SELECT id INTO v_canonical_id
    FROM canonical_persons
    WHERE enslaved_person_id = p_enslaved_id;

    IF v_canonical_id IS NOT NULL THEN
        RAISE NOTICE 'Already promoted as canonical_persons.id = %', v_canonical_id;
        RETURN v_canonical_id;
    END IF;

    -- Promote
    INSERT INTO canonical_persons (
        canonical_name, person_type, enslaved_person_id,
        birth_year_estimate, death_year_estimate, sex,
        verification_status, confidence_score, notes, created_by
    )
    SELECT
        full_name, 'enslaved', enslaved_id,
        birth_year, death_year, gender,
        'manually_verified', 0.95,
        COALESCE(p_family_note, 'Manually promoted with family verification'),
        'manual_promotion'
    FROM enslaved_individuals
    WHERE enslaved_id = p_enslaved_id
    RETURNING id INTO v_canonical_id;

    RETURN v_canonical_id;
END;
$$ LANGUAGE plpgsql;

-- Comments
COMMENT ON VIEW promotable_enslaved_candidates IS 'Enslaved persons in unconfirmed_persons with parseable family relationships - candidates for promotion';
COMMENT ON FUNCTION promote_enslaved_to_canonical IS 'Manually promote an enslaved_individual to canonical_persons with family verification';
