-- Migration 022: IPUMS Census Integration
-- Date: December 18, 2025
-- Purpose: Tables for storing IPUMS Full Count Slave Census data (1850/1860)
--
-- IPUMS Data Summary:
-- - 1850 Slave Schedule: 3,203,109 enslaved persons in 358,095 holdings
-- - 1860 Slave Schedule: 3,936,602 enslaved persons in 400,898 holdings
-- - Total: 7,139,711 enslaved persons + ~395,000 named slaveholders
--
-- Status: Request submitted to ipumsres@umn.edu for restricted slaveholder names
--
-- This migration creates the storage infrastructure; data import will occur
-- when restricted access is granted.

-- ============================================================================
-- SECTION 1: IPUMS CENSUS RECORDS
-- Core table for storing slave schedule census data
-- ============================================================================

CREATE TABLE IF NOT EXISTS ipums_census_records (
    id SERIAL PRIMARY KEY,

    -- Census identification
    census_year INTEGER NOT NULL CHECK (census_year IN (1850, 1860)),
    census_type VARCHAR(50) DEFAULT 'slave_schedule',

    -- Geographic identifiers (FIPS codes)
    state_fip VARCHAR(2) NOT NULL,
    state_name VARCHAR(100),
    county_fip VARCHAR(3),
    county_name VARCHAR(100),

    -- Enumeration district (if available)
    enumeration_district VARCHAR(20),
    dwelling_number INTEGER,
    family_number INTEGER,

    -- Holding identifiers (IPUMS specific)
    holding_number INTEGER NOT NULL,            -- Groups enslaved under same owner
    slave_number INTEGER NOT NULL,              -- Sequence within holding

    -- Enslaved person demographics
    age INTEGER,
    sex VARCHAR(10),                            -- 'Male', 'Female'
    color VARCHAR(20),                          -- 'Black', 'Mulatto'

    -- Additional census fields
    fugitive_from_state BOOLEAN DEFAULT FALSE,
    manumitted INTEGER,                         -- Number manumitted
    deaf_dumb_blind_insane_idiotic VARCHAR(50),
    number_slave_houses INTEGER,

    -- Slaveholder info (RESTRICTED ACCESS - requires approval from ipumsres@umn.edu)
    slaveholder_name VARCHAR(500),
    slaveholder_fp_link VARCHAR(50),            -- Link to Free Population census record

    -- Platform integration
    linked_to_unconfirmed_id UUID,              -- Link to unconfirmed_persons table
    linked_to_enslaved_id VARCHAR(255),         -- Link to enslaved_individuals table
    linked_to_canonical_id INTEGER,             -- Link to canonical_persons table
    debt_calculated BOOLEAN DEFAULT FALSE,
    debt_calculation_id UUID,                   -- Reference to debt calculation

    -- Import metadata
    import_batch_id VARCHAR(100),
    import_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    raw_record JSONB,                           -- Original IPUMS record

    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Unique constraint to prevent duplicates
    UNIQUE(census_year, holding_number, slave_number)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_ipums_year ON ipums_census_records(census_year);
CREATE INDEX IF NOT EXISTS idx_ipums_state ON ipums_census_records(state_fip);
CREATE INDEX IF NOT EXISTS idx_ipums_county ON ipums_census_records(state_fip, county_fip);
CREATE INDEX IF NOT EXISTS idx_ipums_holding ON ipums_census_records(census_year, holding_number);
CREATE INDEX IF NOT EXISTS idx_ipums_slaveholder ON ipums_census_records(slaveholder_name);
CREATE INDEX IF NOT EXISTS idx_ipums_linked_unconfirmed ON ipums_census_records(linked_to_unconfirmed_id);
CREATE INDEX IF NOT EXISTS idx_ipums_linked_enslaved ON ipums_census_records(linked_to_enslaved_id);
CREATE INDEX IF NOT EXISTS idx_ipums_age ON ipums_census_records(age);
CREATE INDEX IF NOT EXISTS idx_ipums_sex ON ipums_census_records(sex);

-- ============================================================================
-- SECTION 2: IPUMS SLAVEHOLDER SUMMARY
-- Aggregated view of slaveholders for debt calculation
-- ============================================================================

CREATE TABLE IF NOT EXISTS ipums_slaveholder_summary (
    summary_id SERIAL PRIMARY KEY,

    -- Identification
    slaveholder_name VARCHAR(500) NOT NULL,
    census_year INTEGER NOT NULL,
    state_fip VARCHAR(2) NOT NULL,
    state_name VARCHAR(100),
    county_fip VARCHAR(3),
    county_name VARCHAR(100),
    holding_number INTEGER,

    -- Aggregate counts
    enslaved_count INTEGER DEFAULT 0,
    male_count INTEGER DEFAULT 0,
    female_count INTEGER DEFAULT 0,
    children_under_12 INTEGER DEFAULT 0,
    adults_12_plus INTEGER DEFAULT 0,

    -- Demographics
    avg_age DECIMAL(5,2),
    min_age INTEGER,
    max_age INTEGER,
    mulatto_count INTEGER DEFAULT 0,
    black_count INTEGER DEFAULT 0,

    -- Linkage to platform
    linked_to_canonical_id INTEGER,             -- canonical_persons table
    linked_to_corporate_id UUID,                -- corporate_entities (if corporation)

    -- Debt calculation
    debt_calculated BOOLEAN DEFAULT FALSE,
    calculated_debt DECIMAL(20,2),
    debt_calculation_id UUID,

    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Unique per slaveholder per census per holding
    UNIQUE(slaveholder_name, census_year, state_fip, holding_number)
);

CREATE INDEX IF NOT EXISTS idx_ipums_summary_name ON ipums_slaveholder_summary(slaveholder_name);
CREATE INDEX IF NOT EXISTS idx_ipums_summary_year ON ipums_slaveholder_summary(census_year);
CREATE INDEX IF NOT EXISTS idx_ipums_summary_state ON ipums_slaveholder_summary(state_fip);
CREATE INDEX IF NOT EXISTS idx_ipums_summary_count ON ipums_slaveholder_summary(enslaved_count DESC);

-- ============================================================================
-- SECTION 3: FIPS CODE REFERENCE TABLES
-- State and county codes for geographic lookups
-- ============================================================================

CREATE TABLE IF NOT EXISTS fips_states (
    state_fip VARCHAR(2) PRIMARY KEY,
    state_name VARCHAR(100) NOT NULL,
    state_abbrev VARCHAR(2),
    is_slave_state_1850 BOOLEAN DEFAULT FALSE,
    is_slave_state_1860 BOOLEAN DEFAULT FALSE,
    notes TEXT
);

-- Seed slave states with FIPS codes
INSERT INTO fips_states (state_fip, state_name, state_abbrev, is_slave_state_1850, is_slave_state_1860) VALUES
('01', 'Alabama', 'AL', TRUE, TRUE),
('05', 'Arkansas', 'AR', TRUE, TRUE),
('10', 'Delaware', 'DE', TRUE, TRUE),
('11', 'District of Columbia', 'DC', TRUE, TRUE),
('12', 'Florida', 'FL', TRUE, TRUE),
('13', 'Georgia', 'GA', TRUE, TRUE),
('21', 'Kentucky', 'KY', TRUE, TRUE),
('22', 'Louisiana', 'LA', TRUE, TRUE),
('24', 'Maryland', 'MD', TRUE, TRUE),
('28', 'Mississippi', 'MS', TRUE, TRUE),
('29', 'Missouri', 'MO', TRUE, TRUE),
('37', 'North Carolina', 'NC', TRUE, TRUE),
('45', 'South Carolina', 'SC', TRUE, TRUE),
('47', 'Tennessee', 'TN', TRUE, TRUE),
('48', 'Texas', 'TX', TRUE, TRUE),
('51', 'Virginia', 'VA', TRUE, TRUE)
ON CONFLICT (state_fip) DO NOTHING;

CREATE TABLE IF NOT EXISTS fips_counties (
    id SERIAL PRIMARY KEY,
    state_fip VARCHAR(2) NOT NULL REFERENCES fips_states(state_fip),
    county_fip VARCHAR(3) NOT NULL,
    county_name VARCHAR(100) NOT NULL,
    notes TEXT,
    UNIQUE(state_fip, county_fip)
);

CREATE INDEX IF NOT EXISTS idx_fips_counties_state ON fips_counties(state_fip);

-- ============================================================================
-- SECTION 4: IMPORT BATCHES
-- Track data imports from IPUMS
-- ============================================================================

CREATE TABLE IF NOT EXISTS ipums_import_batches (
    batch_id VARCHAR(100) PRIMARY KEY,

    -- Import details
    import_type VARCHAR(50),                    -- 'full_count', 'sample', 'update'
    census_year INTEGER,
    state_filter VARCHAR(2)[],                  -- If import was filtered by state

    -- Counts
    records_imported INTEGER DEFAULT 0,
    records_skipped INTEGER DEFAULT 0,
    records_errored INTEGER DEFAULT 0,

    -- Timing
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,

    -- Source file info
    source_filename VARCHAR(500),
    source_checksum VARCHAR(64),                -- SHA-256 of source file

    -- Status
    status VARCHAR(50) DEFAULT 'pending',       -- 'pending', 'running', 'completed', 'failed'
    error_message TEXT,

    -- Metadata
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- SECTION 5: VIEWS FOR ANALYSIS
-- ============================================================================

-- View: Aggregated slaveholder summary from census records
CREATE OR REPLACE VIEW ipums_slaveholder_aggregated AS
SELECT
    slaveholder_name,
    census_year,
    state_fip,
    holding_number,
    COUNT(*) as enslaved_count,
    AVG(age) as avg_age,
    MIN(age) as min_age,
    MAX(age) as max_age,
    SUM(CASE WHEN sex = 'Male' THEN 1 ELSE 0 END) as male_count,
    SUM(CASE WHEN sex = 'Female' THEN 1 ELSE 0 END) as female_count,
    SUM(CASE WHEN age < 12 THEN 1 ELSE 0 END) as children_count,
    SUM(CASE WHEN color = 'Mulatto' THEN 1 ELSE 0 END) as mulatto_count
FROM ipums_census_records
WHERE slaveholder_name IS NOT NULL
GROUP BY slaveholder_name, census_year, state_fip, holding_number
ORDER BY enslaved_count DESC;

-- View: State-level enslaved population summary
CREATE OR REPLACE VIEW ipums_state_summary AS
SELECT
    census_year,
    state_fip,
    fs.state_name,
    COUNT(*) as total_enslaved,
    COUNT(DISTINCT holding_number) as total_holdings,
    COUNT(DISTINCT slaveholder_name) as named_slaveholders,
    AVG(age) as avg_age,
    ROUND(100.0 * SUM(CASE WHEN sex = 'Male' THEN 1 ELSE 0 END) / COUNT(*), 1) as male_pct
FROM ipums_census_records icr
LEFT JOIN fips_states fs USING (state_fip)
GROUP BY census_year, state_fip, fs.state_name
ORDER BY census_year, total_enslaved DESC;

-- View: Large slaveholders (50+ enslaved)
CREATE OR REPLACE VIEW ipums_large_slaveholders AS
SELECT
    slaveholder_name,
    census_year,
    state_fip,
    fs.state_name,
    holding_number,
    COUNT(*) as enslaved_count
FROM ipums_census_records icr
LEFT JOIN fips_states fs USING (state_fip)
WHERE slaveholder_name IS NOT NULL
GROUP BY slaveholder_name, census_year, state_fip, fs.state_name, holding_number
HAVING COUNT(*) >= 50
ORDER BY enslaved_count DESC;

-- View: Census year comparison
CREATE OR REPLACE VIEW ipums_census_comparison AS
SELECT
    state_fip,
    fs.state_name,
    SUM(CASE WHEN census_year = 1850 THEN 1 ELSE 0 END) as enslaved_1850,
    SUM(CASE WHEN census_year = 1860 THEN 1 ELSE 0 END) as enslaved_1860,
    SUM(CASE WHEN census_year = 1860 THEN 1 ELSE 0 END) -
    SUM(CASE WHEN census_year = 1850 THEN 1 ELSE 0 END) as change,
    ROUND(100.0 *
        (SUM(CASE WHEN census_year = 1860 THEN 1 ELSE 0 END) -
         SUM(CASE WHEN census_year = 1850 THEN 1 ELSE 0 END)) /
        NULLIF(SUM(CASE WHEN census_year = 1850 THEN 1 ELSE 0 END), 0), 1) as pct_change
FROM ipums_census_records icr
LEFT JOIN fips_states fs USING (state_fip)
GROUP BY state_fip, fs.state_name
ORDER BY enslaved_1860 DESC;

-- ============================================================================
-- SECTION 6: FUNCTIONS FOR DATA PROCESSING
-- ============================================================================

-- Function: Populate slaveholder summary from census records
CREATE OR REPLACE FUNCTION refresh_ipums_slaveholder_summary()
RETURNS void AS $$
BEGIN
    -- Insert or update summary records
    INSERT INTO ipums_slaveholder_summary (
        slaveholder_name, census_year, state_fip, state_name,
        county_fip, county_name, holding_number,
        enslaved_count, male_count, female_count,
        children_under_12, adults_12_plus,
        avg_age, min_age, max_age,
        mulatto_count, black_count
    )
    SELECT
        slaveholder_name,
        census_year,
        state_fip,
        fs.state_name,
        county_fip,
        fc.county_name,
        holding_number,
        COUNT(*) as enslaved_count,
        SUM(CASE WHEN sex = 'Male' THEN 1 ELSE 0 END),
        SUM(CASE WHEN sex = 'Female' THEN 1 ELSE 0 END),
        SUM(CASE WHEN age < 12 THEN 1 ELSE 0 END),
        SUM(CASE WHEN age >= 12 THEN 1 ELSE 0 END),
        AVG(age),
        MIN(age),
        MAX(age),
        SUM(CASE WHEN color = 'Mulatto' THEN 1 ELSE 0 END),
        SUM(CASE WHEN color = 'Black' THEN 1 ELSE 0 END)
    FROM ipums_census_records icr
    LEFT JOIN fips_states fs USING (state_fip)
    LEFT JOIN fips_counties fc USING (state_fip, county_fip)
    WHERE slaveholder_name IS NOT NULL
    GROUP BY slaveholder_name, census_year, state_fip, fs.state_name,
             county_fip, fc.county_name, holding_number
    ON CONFLICT (slaveholder_name, census_year, state_fip, holding_number)
    DO UPDATE SET
        enslaved_count = EXCLUDED.enslaved_count,
        male_count = EXCLUDED.male_count,
        female_count = EXCLUDED.female_count,
        children_under_12 = EXCLUDED.children_under_12,
        adults_12_plus = EXCLUDED.adults_12_plus,
        avg_age = EXCLUDED.avg_age,
        min_age = EXCLUDED.min_age,
        max_age = EXCLUDED.max_age,
        mulatto_count = EXCLUDED.mulatto_count,
        black_count = EXCLUDED.black_count,
        updated_at = CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

-- Function: Link IPUMS records to existing unconfirmed_persons by name matching
CREATE OR REPLACE FUNCTION link_ipums_to_unconfirmed()
RETURNS TABLE(linked_count INTEGER, unlinked_count INTEGER) AS $$
DECLARE
    v_linked INTEGER := 0;
    v_unlinked INTEGER := 0;
BEGIN
    -- Link by matching slaveholder name to unconfirmed_persons
    WITH matches AS (
        UPDATE ipums_census_records icr
        SET linked_to_unconfirmed_id = up.lead_id
        FROM unconfirmed_persons up
        WHERE icr.slaveholder_name IS NOT NULL
        AND icr.linked_to_unconfirmed_id IS NULL
        AND LOWER(up.full_name) = LOWER(icr.slaveholder_name)
        AND up.person_type = 'slaveholder'
        RETURNING icr.id
    )
    SELECT COUNT(*) INTO v_linked FROM matches;

    SELECT COUNT(*) INTO v_unlinked
    FROM ipums_census_records
    WHERE slaveholder_name IS NOT NULL
    AND linked_to_unconfirmed_id IS NULL;

    RETURN QUERY SELECT v_linked, v_unlinked;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- SECTION 7: TRIGGERS
-- ============================================================================

-- Updated_at triggers
DROP TRIGGER IF EXISTS update_ipums_census_updated_at ON ipums_census_records;
CREATE TRIGGER update_ipums_census_updated_at
    BEFORE UPDATE ON ipums_census_records
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_ipums_summary_updated_at ON ipums_slaveholder_summary;
CREATE TRIGGER update_ipums_summary_updated_at
    BEFORE UPDATE ON ipums_slaveholder_summary
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

SELECT 'Migration 022: IPUMS Census Integration Complete' AS status;
SELECT
    (SELECT COUNT(*) FROM fips_states WHERE is_slave_state_1860 = TRUE) as slave_states_configured,
    'Awaiting IPUMS data access approval from ipumsres@umn.edu' as data_status;
