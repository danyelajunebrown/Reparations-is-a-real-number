-- Migration 009: British Colonial Slavery Data Model
--
-- Supports data from UCL Legacies of British Slavery database
-- and related sources on British colonial slavery
--
-- Key insight: Slavery was a GLOBAL system, not just American.
-- Britain paid £20 million (£17 billion today) in COMPENSATION TO SLAVE OWNERS
-- when abolishing slavery in 1833 - the enslaved received NOTHING.
--
-- This migration adds support for:
-- - British Caribbean colonies (Jamaica, Barbados, etc.)
-- - Compensation claims from the Slave Compensation Commission
-- - Estates/plantations in British colonies
-- - British slave-owners, merchants, and beneficiaries
-- - Geographic expansion beyond US-centric data

-- =============================================================================
-- BRITISH COLONIES
-- =============================================================================

CREATE TABLE IF NOT EXISTS british_colonies (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    region VARCHAR(100), -- Caribbean, Africa, Indian Ocean, etc.
    modern_country VARCHAR(200), -- What country is it today?

    -- Territory dates
    british_control_start INTEGER, -- Year
    british_control_end INTEGER,
    emancipation_date DATE, -- When slavery ended in this colony

    -- Geographic info
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),

    -- LBS reference
    lbs_colony_id VARCHAR(50),

    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed British colonies
INSERT INTO british_colonies (name, region, modern_country, british_control_start, emancipation_date, lbs_colony_id) VALUES
    ('Jamaica', 'Caribbean', 'Jamaica', 1655, '1834-08-01', 'jamaica'),
    ('Barbados', 'Caribbean', 'Barbados', 1627, '1834-08-01', 'barbados'),
    ('Antigua', 'Caribbean', 'Antigua and Barbuda', 1632, '1834-08-01', 'antigua'),
    ('Grenada', 'Caribbean', 'Grenada', 1763, '1834-08-01', 'grenada'),
    ('St Kitts', 'Caribbean', 'Saint Kitts and Nevis', 1623, '1834-08-01', 'st-kitts'),
    ('Nevis', 'Caribbean', 'Saint Kitts and Nevis', 1628, '1834-08-01', 'nevis'),
    ('Dominica', 'Caribbean', 'Dominica', 1763, '1834-08-01', 'dominica'),
    ('St Lucia', 'Caribbean', 'Saint Lucia', 1814, '1834-08-01', 'st-lucia'),
    ('St Vincent', 'Caribbean', 'Saint Vincent and the Grenadines', 1763, '1834-08-01', 'st-vincent'),
    ('Tobago', 'Caribbean', 'Trinidad and Tobago', 1763, '1834-08-01', 'tobago'),
    ('Trinidad', 'Caribbean', 'Trinidad and Tobago', 1797, '1834-08-01', 'trinidad'),
    ('British Guiana', 'South America', 'Guyana', 1796, '1834-08-01', 'british-guiana'),
    ('Honduras', 'Central America', 'Belize', 1638, '1834-08-01', 'honduras'),
    ('Bahamas', 'Caribbean', 'Bahamas', 1718, '1834-08-01', 'bahamas'),
    ('Bermuda', 'Atlantic', 'Bermuda', 1612, '1834-08-01', 'bermuda'),
    ('Virgin Islands', 'Caribbean', 'British Virgin Islands', 1672, '1834-08-01', 'virgin-islands'),
    ('Mauritius', 'Indian Ocean', 'Mauritius', 1810, '1834-08-01', 'mauritius'),
    ('Cape of Good Hope', 'Africa', 'South Africa', 1806, '1834-08-01', 'cape')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- ESTATES (PLANTATIONS) IN BRITISH COLONIES
-- =============================================================================

CREATE TABLE IF NOT EXISTS colonial_estates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(300) NOT NULL,
    alternate_names TEXT[], -- Historical name variations

    -- Location
    colony_id INTEGER REFERENCES british_colonies(id),
    parish VARCHAR(200), -- Sub-region within colony

    -- Estate type and production
    estate_type VARCHAR(100), -- sugar, coffee, cotton, livestock, etc.
    acreage INTEGER,

    -- Enslaved population (from compensation records)
    enslaved_count_1817 INTEGER, -- From slave registers
    enslaved_count_1832 INTEGER, -- At abolition

    -- Compensation claim info
    compensation_claim_number VARCHAR(100),
    compensation_amount DECIMAL(15, 2), -- In pounds sterling

    -- LBS database reference
    lbs_estate_id VARCHAR(100),
    lbs_url TEXT,

    -- Dates
    established_year INTEGER,
    ownership_start_year INTEGER,
    ownership_end_year INTEGER,

    notes TEXT,
    source_documents TEXT[],
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- COMPENSATION CLAIMS (from Slave Compensation Commission)
-- =============================================================================

CREATE TABLE IF NOT EXISTS compensation_claims (
    id SERIAL PRIMARY KEY,

    -- Claim identification
    claim_number VARCHAR(100) NOT NULL,
    colony_id INTEGER REFERENCES british_colonies(id),
    estate_id INTEGER REFERENCES colonial_estates(id),

    -- Claimant info
    claimant_name VARCHAR(500) NOT NULL,
    claimant_role VARCHAR(200), -- owner, mortgagee, legatee, trustee, etc.

    -- Claim details
    enslaved_count INTEGER, -- Number of enslaved people in claim
    original_claim_amount DECIMAL(15, 2), -- What they asked for
    awarded_amount DECIMAL(15, 2), -- What they received

    -- Status and dates
    claim_status VARCHAR(100), -- awarded, contested, rejected, etc.
    claim_date DATE,
    award_date DATE,

    -- Modern value (for context)
    modern_value_estimate DECIMAL(20, 2), -- Estimated value in today's pounds

    -- LBS reference
    lbs_claim_id VARCHAR(100),
    lbs_url TEXT,

    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- BRITISH SLAVE OWNERS
-- =============================================================================

CREATE TABLE IF NOT EXISTS british_slave_owners (
    id SERIAL PRIMARY KEY,

    -- Identity
    full_name VARCHAR(500) NOT NULL,
    title VARCHAR(100), -- Mr, Mrs, Sir, Lord, etc.
    gender VARCHAR(20),

    -- Birth/death
    birth_year INTEGER,
    death_year INTEGER,

    -- Residence (in Britain)
    residence_address TEXT,
    residence_parish VARCHAR(200),
    residence_county VARCHAR(200),
    residence_country VARCHAR(100) DEFAULT 'Britain',

    -- Occupation/status
    occupation VARCHAR(300),
    social_status VARCHAR(200), -- merchant, planter, professional, aristocrat

    -- Connections to slavery
    total_enslaved_owned INTEGER, -- Total across all estates
    total_compensation_received DECIMAL(15, 2),
    estates_owned TEXT[], -- List of estate names

    -- Parliamentary connections
    member_of_parliament BOOLEAN DEFAULT FALSE,
    parliamentary_constituencies TEXT[],
    parliamentary_years TEXT,

    -- Other colonial connections
    east_india_company_connection BOOLEAN DEFAULT FALSE,
    bank_of_england_connection BOOLEAN DEFAULT FALSE,
    other_colonial_investments TEXT,

    -- LBS reference
    lbs_person_id VARCHAR(100),
    lbs_url TEXT,

    notes TEXT,
    source_documents TEXT[],
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- ESTATE OWNERSHIP (linking owners to estates over time)
-- =============================================================================

CREATE TABLE IF NOT EXISTS estate_ownership (
    id SERIAL PRIMARY KEY,
    estate_id INTEGER REFERENCES colonial_estates(id),
    owner_id INTEGER REFERENCES british_slave_owners(id),

    -- Ownership details
    ownership_type VARCHAR(100), -- owner, part-owner, mortgagee, trustee, etc.
    ownership_share DECIMAL(5, 2), -- Percentage owned

    -- Dates
    start_year INTEGER,
    end_year INTEGER,

    -- How ownership changed
    acquisition_method VARCHAR(200), -- inheritance, purchase, marriage, etc.
    disposition_method VARCHAR(200), -- sale, death, foreclosure, etc.

    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- LEGACIES (how slave wealth persisted)
-- =============================================================================

CREATE TABLE IF NOT EXISTS slavery_legacies (
    id SERIAL PRIMARY KEY,

    -- Person/family who benefited
    owner_id INTEGER REFERENCES british_slave_owners(id),
    family_name VARCHAR(300),

    -- Type of legacy
    legacy_type VARCHAR(200), -- commercial, political, philanthropic, educational, etc.

    -- Institution/entity that benefited
    institution_name VARCHAR(500),
    institution_type VARCHAR(200), -- bank, university, church, business, etc.

    -- Value transferred
    monetary_value DECIMAL(15, 2),

    -- Time period
    legacy_year INTEGER,
    legacy_end_year INTEGER,

    -- Modern connections
    still_exists BOOLEAN, -- Does the institution still exist?
    modern_name VARCHAR(500), -- Current name if renamed

    -- Description
    description TEXT,

    -- LBS reference
    lbs_legacy_id VARCHAR(100),
    lbs_url TEXT,

    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- ENSLAVED REGISTERS (from colony slave registers 1817-1834)
-- =============================================================================

CREATE TABLE IF NOT EXISTS colonial_enslaved_registers (
    id SERIAL PRIMARY KEY,

    -- Registry info
    colony_id INTEGER REFERENCES british_colonies(id),
    estate_id INTEGER REFERENCES colonial_estates(id),
    register_year INTEGER,

    -- Enslaved person info (from registers)
    given_name VARCHAR(200),
    african_name VARCHAR(200), -- Original name if recorded
    age INTEGER,
    gender VARCHAR(20),
    colour VARCHAR(100), -- As recorded (black, mulatto, etc.)
    country_of_origin VARCHAR(200), -- Africa, Creole, etc.

    -- Condition
    occupation VARCHAR(200), -- field, domestic, tradesman, etc.
    physical_condition VARCHAR(200),

    -- Family relationships
    mother_name VARCHAR(200),
    father_name VARCHAR(200),
    children_names TEXT[],

    -- Value/sale
    appraised_value DECIMAL(10, 2),

    -- Registry reference
    register_number VARCHAR(100),
    page_number VARCHAR(50),

    -- Status changes
    manumitted BOOLEAN DEFAULT FALSE,
    manumission_date DATE,
    death_recorded BOOLEAN DEFAULT FALSE,
    death_date DATE,

    notes TEXT,
    source_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_colonial_estates_colony ON colonial_estates(colony_id);
CREATE INDEX IF NOT EXISTS idx_colonial_estates_lbs ON colonial_estates(lbs_estate_id);
CREATE INDEX IF NOT EXISTS idx_compensation_claims_colony ON compensation_claims(colony_id);
CREATE INDEX IF NOT EXISTS idx_compensation_claims_claimant ON compensation_claims(claimant_name);
CREATE INDEX IF NOT EXISTS idx_british_slave_owners_name ON british_slave_owners(full_name);
CREATE INDEX IF NOT EXISTS idx_british_slave_owners_lbs ON british_slave_owners(lbs_person_id);
CREATE INDEX IF NOT EXISTS idx_estate_ownership_estate ON estate_ownership(estate_id);
CREATE INDEX IF NOT EXISTS idx_estate_ownership_owner ON estate_ownership(owner_id);
CREATE INDEX IF NOT EXISTS idx_colonial_enslaved_colony ON colonial_enslaved_registers(colony_id);
CREATE INDEX IF NOT EXISTS idx_colonial_enslaved_estate ON colonial_enslaved_registers(estate_id);
CREATE INDEX IF NOT EXISTS idx_colonial_enslaved_name ON colonial_enslaved_registers(given_name);

-- =============================================================================
-- VIEWS
-- =============================================================================

-- View: Total compensation by colony
CREATE OR REPLACE VIEW compensation_by_colony AS
SELECT
    bc.name AS colony,
    bc.region,
    COUNT(DISTINCT cc.id) AS total_claims,
    SUM(cc.enslaved_count) AS total_enslaved,
    SUM(cc.awarded_amount) AS total_compensation,
    AVG(cc.awarded_amount / NULLIF(cc.enslaved_count, 0)) AS avg_per_person
FROM british_colonies bc
LEFT JOIN compensation_claims cc ON bc.id = cc.colony_id
GROUP BY bc.id, bc.name, bc.region
ORDER BY total_compensation DESC NULLS LAST;

-- View: Top slave owners by compensation
CREATE OR REPLACE VIEW top_compensated_owners AS
SELECT
    bso.full_name,
    bso.title,
    bso.occupation,
    bso.total_enslaved_owned,
    bso.total_compensation_received,
    bso.member_of_parliament,
    array_length(bso.estates_owned, 1) AS estates_count
FROM british_slave_owners bso
WHERE bso.total_compensation_received IS NOT NULL
ORDER BY bso.total_compensation_received DESC
LIMIT 100;

-- View: Estate summary with compensation
CREATE OR REPLACE VIEW estate_compensation_summary AS
SELECT
    ce.name AS estate_name,
    bc.name AS colony,
    ce.parish,
    ce.estate_type,
    ce.enslaved_count_1832 AS enslaved_at_abolition,
    cc.awarded_amount AS compensation_received,
    cc.claimant_name,
    ce.lbs_url
FROM colonial_estates ce
JOIN british_colonies bc ON ce.colony_id = bc.id
LEFT JOIN compensation_claims cc ON ce.id = cc.estate_id
ORDER BY cc.awarded_amount DESC NULLS LAST;

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON TABLE british_colonies IS 'British colonies where slavery was practiced until 1834 abolition';
COMMENT ON TABLE colonial_estates IS 'Plantations and estates in British colonies, from UCL LBS database';
COMMENT ON TABLE compensation_claims IS 'Claims made to the Slave Compensation Commission 1833-1843';
COMMENT ON TABLE british_slave_owners IS 'Individuals who owned enslaved people in British colonies or received compensation';
COMMENT ON TABLE slavery_legacies IS 'How wealth from slavery persisted in British institutions and families';
COMMENT ON TABLE colonial_enslaved_registers IS 'Records of enslaved people from colonial slave registers 1817-1834';
