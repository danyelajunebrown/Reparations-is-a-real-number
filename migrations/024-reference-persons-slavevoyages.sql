-- Migration 024: Reference Persons table for external scholarly databases
-- Date: December 18, 2025
-- Purpose: Store data from SlaveVoyages.org and similar reference databases
-- Note: This data is for CROSS-REFERENCE only, NOT for direct reparations calculation

-- ============================================================================
-- 1. REFERENCE PERSONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS reference_persons (
    id SERIAL PRIMARY KEY,

    -- Source identification
    source_database VARCHAR(100) NOT NULL,      -- 'slavevoyages_african_origins', 'slavevoyages_names', etc.
    source_id VARCHAR(100),                      -- Original ID from source database
    source_url TEXT,                             -- Direct link to record

    -- Personal information
    full_name VARCHAR(255),
    african_name VARCHAR(255),                   -- Original African name if different
    given_name VARCHAR(100),
    surname VARCHAR(100),

    -- Demographics
    age_recorded INTEGER,
    age_category VARCHAR(50),                    -- 'child', 'adult', 'man', 'woman', 'boy', 'girl'
    gender VARCHAR(20),
    height_inches DECIMAL(5,2),
    physical_description TEXT,

    -- African origins
    country_of_origin VARCHAR(100),
    region_of_origin VARCHAR(100),
    ethnic_group VARCHAR(100),
    language_group VARCHAR(100),

    -- Voyage/transport details
    embarkation_port VARCHAR(255),
    embarkation_region VARCHAR(100),
    disembarkation_port VARCHAR(255),
    disembarkation_region VARCHAR(100),
    destination_country VARCHAR(100),

    -- Vessel information
    vessel_name VARCHAR(255),
    vessel_id VARCHAR(50),                       -- SlaveVoyages voyage ID
    voyage_year INTEGER,
    capture_date DATE,

    -- Status
    status_at_record VARCHAR(100),               -- 'liberated', 'enslaved', 'died_in_transit', etc.
    fate_notes TEXT,

    -- Linking to our canonical data
    canonical_person_id INTEGER REFERENCES canonical_persons(id),
    unconfirmed_person_id INTEGER REFERENCES unconfirmed_persons(lead_id),
    match_confidence DECIMAL(3,2),               -- 0.00 to 1.00
    match_method VARCHAR(50),                    -- 'name_exact', 'name_fuzzy', 'demographics', 'manual'
    potential_matches JSONB,                     -- AI-suggested matches

    -- Metadata
    citation TEXT,
    notes TEXT,
    imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    UNIQUE(source_database, source_id)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_ref_persons_source ON reference_persons(source_database);
CREATE INDEX IF NOT EXISTS idx_ref_persons_name ON reference_persons(full_name);
CREATE INDEX IF NOT EXISTS idx_ref_persons_african_name ON reference_persons(african_name);
CREATE INDEX IF NOT EXISTS idx_ref_persons_origin ON reference_persons(country_of_origin);
CREATE INDEX IF NOT EXISTS idx_ref_persons_vessel ON reference_persons(vessel_id);
CREATE INDEX IF NOT EXISTS idx_ref_persons_year ON reference_persons(voyage_year);
CREATE INDEX IF NOT EXISTS idx_ref_persons_canonical ON reference_persons(canonical_person_id);

-- ============================================================================
-- 2. BIBLIOGRAPHY SOURCES TABLE (if not exists)
-- ============================================================================

CREATE TABLE IF NOT EXISTS bibliography_sources (
    id SERIAL PRIMARY KEY,
    source_type VARCHAR(50) NOT NULL,            -- 'database', 'archive', 'book', 'article', 'website'
    title TEXT NOT NULL,
    subtitle TEXT,

    -- Attribution
    authors TEXT[],
    editors TEXT[],
    institution VARCHAR(255),
    publisher VARCHAR(255),

    -- Location
    url TEXT,
    archive_url TEXT,                            -- Our archived copy
    doi VARCHAR(100),
    isbn VARCHAR(20),

    -- Description
    description TEXT,
    data_type VARCHAR(50),                       -- 'primary', 'secondary', 'compiled_scholarly'
    coverage_period VARCHAR(100),                -- '1808-1862'
    geographic_scope TEXT,

    -- Statistics
    record_count INTEGER,
    last_updated DATE,

    -- Usage tracking
    records_imported INTEGER DEFAULT 0,
    last_import TIMESTAMP,

    -- Metadata
    verified BOOLEAN DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 3. INSERT SLAVEVOYAGES BIBLIOGRAPHY ENTRY
-- ============================================================================

INSERT INTO bibliography_sources (
    source_type, title, subtitle, institution, url,
    description, data_type, coverage_period, geographic_scope, record_count
) VALUES (
    'database',
    'SlaveVoyages - African Origins Database',
    'Personal details of Africans from captured slave ships',
    'Emory University / Rice University',
    'https://www.slavevoyages.org/past/enslaved/african-origins',
    'Contains names, ages, genders, heights, African origins, embarkation/disembarkation ports, and vessel information for 91,491+ Africans taken from slave ships captured by British anti-slave-trade patrols between 1808-1862. Data sourced from Courts of Mixed Commission records and Registers of Liberated Africans.',
    'compiled_scholarly',
    '1808-1862',
    'Trans-Atlantic (West Africa to Americas)',
    91491
) ON CONFLICT DO NOTHING;

INSERT INTO bibliography_sources (
    source_type, title, subtitle, institution, url,
    description, data_type, coverage_period, geographic_scope, record_count
) VALUES (
    'database',
    'SlaveVoyages - Trans-Atlantic Slave Trade Database',
    'Records of slave ship voyages',
    'Emory University / Rice University',
    'https://www.slavevoyages.org/voyage/database',
    'Documents over 36,000 slave ship voyages with details on vessels, routes, captains, mortality, and cargo. Primary sources include shipping records, port records, and naval documentation.',
    'compiled_scholarly',
    '1514-1866',
    'Trans-Atlantic',
    36000
) ON CONFLICT DO NOTHING;

-- ============================================================================
-- 4. CROSS-REFERENCE VIEW
-- ============================================================================

CREATE OR REPLACE VIEW reference_person_matches AS
SELECT
    rp.id as reference_id,
    rp.source_database,
    rp.full_name as reference_name,
    rp.african_name,
    rp.voyage_year,
    rp.country_of_origin,
    cp.id as canonical_id,
    cp.canonical_name,
    rp.match_confidence,
    rp.match_method
FROM reference_persons rp
LEFT JOIN canonical_persons cp ON rp.canonical_person_id = cp.id
WHERE rp.canonical_person_id IS NOT NULL;

COMMENT ON TABLE reference_persons IS
'External scholarly database records for cross-reference. NOT for direct reparations calculation.';

COMMENT ON TABLE bibliography_sources IS
'Documentation of all data sources used in the project with proper academic citation.';
