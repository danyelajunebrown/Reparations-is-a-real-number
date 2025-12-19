-- Migration 023: Expand person_type for census vs slave schedule distinction
-- Date: December 18, 2025
-- Issue: Regular census data was misidentified as slave schedule data

-- ============================================================================
-- 1. DOCUMENT NEW PERSON TYPES
-- ============================================================================
--
-- Existing types:
--   - 'enslaved'     - From slave schedule
--   - 'slaveholder'  - From slave schedule
--   - 'owner'        - Alias for slaveholder
--
-- New types:
--   - 'census_person'      - From regular census, status unknown
--   - 'free_black'         - Confirmed free Black person
--   - 'free_person_of_color' - Free person of color (may include mixed race)
--   - 'non_slaveholder'    - Confirmed non-slaveholder
--   - 'indentured'         - Indentured servant (any race)
--   - 'native_slaveholder' - Native American slaveholder
--   - 'black_slaveholder'  - Free Black slaveholder
--
-- Note: PostgreSQL doesn't require enum expansion for varchar columns

-- ============================================================================
-- 2. ADD COLLECTION TYPE TO FAMILYSEARCH_LOCATIONS
-- ============================================================================

ALTER TABLE familysearch_locations
ADD COLUMN IF NOT EXISTS collection_type VARCHAR(50) DEFAULT 'unknown';

ALTER TABLE familysearch_locations
ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN familysearch_locations.collection_type IS
'Type of document: slave_schedule, regular_census, mortality_schedule, etc.';

COMMENT ON COLUMN familysearch_locations.verified IS
'Whether the collection type has been manually verified';

-- Update known collections
UPDATE familysearch_locations
SET collection_type = 'regular_census',
    verified = true
WHERE collection_id = '1401638';

UPDATE familysearch_locations
SET collection_type = 'slave_schedule_1860',
    verified = false  -- Needs verification
WHERE collection_id = '3161105';

-- ============================================================================
-- 3. CREATE COLLECTION REFERENCE TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS census_collections (
    collection_id VARCHAR(20) PRIMARY KEY,
    source VARCHAR(50) NOT NULL,  -- 'familysearch', 'ancestry', 'archive_org', etc.
    collection_name TEXT NOT NULL,
    document_type VARCHAR(50) NOT NULL,  -- 'slave_schedule', 'regular_census', 'mortality'
    census_year INTEGER NOT NULL,
    coverage_area TEXT,  -- 'national', 'Alabama', etc.
    notes TEXT,
    archive_url TEXT,  -- Archive.org or other backup URL
    verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert known collections
INSERT INTO census_collections (collection_id, source, collection_name, document_type, census_year, coverage_area, verified, notes)
VALUES
    ('1401638', 'familysearch', 'United States Census, 1850', 'regular_census', 1850, 'national', true, 'Regular population census, NOT slave schedule'),
    ('3161105', 'familysearch', 'United States Census (Slave Schedule), 1860', 'slave_schedule', 1860, 'national', false, 'Needs format verification'),
    ('1420440', 'familysearch', 'United States Census (Slave Schedule), 1850', 'slave_schedule', 1850, 'national', false, 'Not yet crawled - CORRECT 1850 slave schedule')
ON CONFLICT (collection_id) DO UPDATE SET
    verified = EXCLUDED.verified,
    notes = EXCLUDED.notes;

-- ============================================================================
-- 4. CREATE FREE PERSONS TRACKING TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS free_persons (
    id SERIAL PRIMARY KEY,
    unconfirmed_person_id INTEGER REFERENCES unconfirmed_persons(lead_id),
    canonical_person_id INTEGER REFERENCES canonical_persons(id),
    full_name VARCHAR(255) NOT NULL,

    -- Status
    freedom_status VARCHAR(50) NOT NULL,  -- 'free_born', 'manumitted', 'self_purchased', 'escaped'
    freedom_year INTEGER,
    freedom_documentation TEXT,

    -- Demographics
    race_designation VARCHAR(50),  -- 'black', 'mulatto', 'colored', etc. (historical terms)
    gender VARCHAR(20),
    birth_year INTEGER,
    death_year INTEGER,

    -- Location
    state VARCHAR(50),
    county VARCHAR(100),
    city VARCHAR(100),

    -- Occupation (free Blacks often had trades)
    occupation VARCHAR(255),

    -- Source
    source_type VARCHAR(50),  -- 'census', 'manumission_record', 'free_negro_register'
    source_url TEXT,
    source_reference TEXT,

    -- For disambiguation
    is_slaveholder BOOLEAN DEFAULT FALSE,  -- Free Blacks could own slaves
    slaveholder_notes TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_free_persons_name ON free_persons(full_name);
CREATE INDEX IF NOT EXISTS idx_free_persons_state ON free_persons(state);
CREATE INDEX IF NOT EXISTS idx_free_persons_status ON free_persons(freedom_status);

-- ============================================================================
-- 5. CREATE VIEW FOR CENSUS PERSONS NEEDING CLASSIFICATION
-- ============================================================================

CREATE OR REPLACE VIEW census_persons_pending_classification AS
SELECT
    lead_id,
    full_name,
    person_type,
    context_text,
    source_url,
    relationships->>'state' as state,
    relationships->>'county' as county,
    relationships->>'year' as census_year,
    SUBSTRING(source_url FROM 'cc=([0-9]+)') as collection_id
FROM unconfirmed_persons
WHERE person_type = 'census_person'
ORDER BY relationships->>'state', relationships->>'county';

-- ============================================================================
-- 6. ADD DATA QUALITY TRACKING
-- ============================================================================

ALTER TABLE unconfirmed_persons
ADD COLUMN IF NOT EXISTS data_quality_flags JSONB DEFAULT '{}';

COMMENT ON COLUMN unconfirmed_persons.data_quality_flags IS
'Tracks data quality issues: {misidentified_source: true, needs_verification: true, etc.}';

-- Mark the records we just fixed
UPDATE unconfirmed_persons
SET data_quality_flags = '{"was_misidentified_as_slavery_data": true, "corrected_date": "2025-12-18"}'::jsonb
WHERE extraction_method = 'census_ocr_extraction'
AND source_url LIKE '%cc=1401638%';
