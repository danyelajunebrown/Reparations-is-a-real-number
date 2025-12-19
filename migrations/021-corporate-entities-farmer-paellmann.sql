-- Migration 021: Corporate Entities & Farmer-Paellmann Defendants
-- Date: December 18, 2025
-- Purpose: Track corporate entities involved in slavery, specifically the 17 defendants
--          from the Farmer-Paellmann v. FleetBoston litigation (N.D. Ill. 2004)
--
-- Legal Reference: In re African-American Slave Descendants Litigation, 304 F. Supp. 2d 1027
-- Second Consolidated and Amended Complaint (SCAC)
--
-- This migration adds:
-- 1. corporate_entities - Modern corporations with slavery involvement
-- 2. corporate_succession - Historical predecessor → modern successor chains
-- 3. financial_instruments - Insurance policies, loans, mortgages with enslaved as collateral
-- 4. corporate_slaveholding - Direct ownership of plantations/enslaved by corporations

-- ============================================================================
-- SECTION 1: CORPORATE ENTITIES TABLE
-- Core table for tracking modern corporations with historical slavery involvement
-- ============================================================================

CREATE TABLE IF NOT EXISTS corporate_entities (
    entity_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Modern corporate identity
    modern_name VARCHAR(500) NOT NULL,
    historical_name VARCHAR(500),           -- Period name (e.g., "Brown Brothers & Co.")
    entity_type VARCHAR(100),               -- 'bank', 'insurer', 'railroad', 'tobacco', 'factor'

    -- Farmer-Paellmann case specific
    is_farmer_paellmann_defendant BOOLEAN DEFAULT FALSE,
    scac_paragraph_reference VARCHAR(100),  -- e.g., "¶¶ 125-128"

    -- Current corporate status
    stock_ticker VARCHAR(20),
    is_active BOOLEAN DEFAULT TRUE,
    headquarters_location VARCHAR(200),

    -- Documented slavery involvement
    documented_activity TEXT,               -- Direct quote from SCAC or other source
    involvement_category VARCHAR(100)[],    -- ['insurance', 'lending', 'trading', 'construction']

    -- Legal allegations
    self_concealment_alleged BOOLEAN DEFAULT FALSE,
    misleading_statements_alleged BOOLEAN DEFAULT FALSE,

    -- Data provenance
    source_document VARCHAR(500),
    source_url TEXT,
    research_notes TEXT,

    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_corp_entities_modern_name ON corporate_entities(modern_name);
CREATE INDEX IF NOT EXISTS idx_corp_entities_historical ON corporate_entities(historical_name);
CREATE INDEX IF NOT EXISTS idx_corp_entities_type ON corporate_entities(entity_type);
CREATE INDEX IF NOT EXISTS idx_corp_entities_farmer_paellmann ON corporate_entities(is_farmer_paellmann_defendant);

-- ============================================================================
-- SECTION 2: CORPORATE SUCCESSION CHAINS
-- Track how historical entities became modern corporations
-- ============================================================================

CREATE TABLE IF NOT EXISTS corporate_succession (
    succession_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The chain
    predecessor_name VARCHAR(500) NOT NULL,     -- Historical entity
    successor_entity_id UUID REFERENCES corporate_entities(entity_id),

    -- Type of succession
    succession_type VARCHAR(100),               -- 'merger', 'acquisition', 'renamed', 'bankruptcy_purchase', 'spinoff'
    succession_year INTEGER,
    succession_date DATE,

    -- Intermediate steps (for multi-hop successions)
    intermediate_entities TEXT[],               -- Array of entity names in chain

    -- Documentation
    court_records TEXT,                         -- e.g., "Louisiana court records dating back to the 1840s"
    source_document TEXT,
    source_url TEXT,

    -- Metadata
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_corp_succession_predecessor ON corporate_succession(predecessor_name);
CREATE INDEX IF NOT EXISTS idx_corp_succession_successor ON corporate_succession(successor_entity_id);
CREATE INDEX IF NOT EXISTS idx_corp_succession_year ON corporate_succession(succession_year);

-- ============================================================================
-- SECTION 3: CORPORATE FINANCIAL INSTRUMENTS
-- Insurance policies, loans, mortgages involving enslaved persons
-- ============================================================================

CREATE TABLE IF NOT EXISTS corporate_financial_instruments (
    instrument_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Type of instrument
    instrument_type VARCHAR(100) NOT NULL,      -- 'slave_insurance_policy', 'slave_trader_loan',
                                                -- 'plantation_mortgage', 'customs_collection',
                                                -- 'cotton_advance', 'ship_insurance'

    -- Issuing entity
    issuer_entity_id UUID REFERENCES corporate_entities(entity_id),
    issuer_name VARCHAR(500),                   -- For records where entity not yet in table

    -- For insurance policies (Aetna, New York Life, Lloyd's, Southern Mutual, AIG)
    policy_type VARCHAR(100),                   -- 'life_insurance_on_enslaved', 'marine_cargo', 'property_loss'
    insured_party VARCHAR(500),                 -- Slave owner name
    enslaved_count INTEGER,                     -- Number of enslaved persons covered
    premium_amount DECIMAL(15,2),
    coverage_amount DECIMAL(15,2),
    premium_currency VARCHAR(20) DEFAULT 'USD',

    -- For loans/advances (FleetBoston, Brown Brothers, JP Morgan)
    loan_recipient VARCHAR(500),                -- Planter, merchant, cotton broker
    principal_amount DECIMAL(15,2),
    interest_rate DECIMAL(5,2),
    collateral_type VARCHAR(100),               -- 'enslaved_persons', 'plantation', 'cotton_crop'
    collateral_enslaved_count INTEGER,
    collateral_value DECIMAL(15,2),

    -- For customs/duties (FleetBoston/Providence Bank)
    vessel_name VARCHAR(200),
    voyage_type VARCHAR(100),                   -- 'slave_trade', 'cotton_export'
    duties_collected DECIMAL(15,2),

    -- Dating
    instrument_year INTEGER,
    instrument_date DATE,
    maturity_date DATE,

    -- Geographic context
    state_territory VARCHAR(100),
    county_parish VARCHAR(100),

    -- Source documentation
    source_archive VARCHAR(500),
    archive_reference VARCHAR(255),
    source_document TEXT,
    digitized_url TEXT,

    -- Metadata
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_corp_fin_inst_type ON corporate_financial_instruments(instrument_type);
CREATE INDEX IF NOT EXISTS idx_corp_fin_inst_issuer ON corporate_financial_instruments(issuer_entity_id);
CREATE INDEX IF NOT EXISTS idx_corp_fin_inst_year ON corporate_financial_instruments(instrument_year);
CREATE INDEX IF NOT EXISTS idx_corp_fin_inst_policy_type ON corporate_financial_instruments(policy_type);

-- ============================================================================
-- SECTION 4: CORPORATE SLAVEHOLDING
-- Direct ownership of enslaved persons by corporations
-- E.g., Brown Brothers Harriman owned 4,614 acres and 346 enslaved in Louisiana
-- ============================================================================

CREATE TABLE IF NOT EXISTS corporate_slaveholding (
    holding_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Corporate entity
    entity_id UUID REFERENCES corporate_entities(entity_id),
    entity_name VARCHAR(500),                   -- Denormalized for convenience

    -- Property details
    plantation_name VARCHAR(300),
    plantation_location VARCHAR(300),           -- State/territory
    county_parish VARCHAR(200),
    acreage INTEGER,

    -- Enslaved persons
    enslaved_count INTEGER,
    enslaved_names TEXT[],                      -- If known

    -- Valuation
    property_value DECIMAL(15,2),
    enslaved_value DECIMAL(15,2),
    total_value DECIMAL(15,2),
    valuation_currency VARCHAR(20) DEFAULT 'USD',
    valuation_year INTEGER,

    -- Documentation
    court_record_reference TEXT,                -- e.g., "Louisiana court records dating back to the 1840s"
    record_year INTEGER,
    source_archive VARCHAR(500),
    archive_reference VARCHAR(255),

    -- Metadata
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_corp_slaveholding_entity ON corporate_slaveholding(entity_id);
CREATE INDEX IF NOT EXISTS idx_corp_slaveholding_location ON corporate_slaveholding(plantation_location);
CREATE INDEX IF NOT EXISTS idx_corp_slaveholding_year ON corporate_slaveholding(record_year);

-- ============================================================================
-- SECTION 5: CORPORATE DEBT CALCULATIONS
-- Calculated reparations debt for corporate entities
-- ============================================================================

CREATE TABLE IF NOT EXISTS corporate_debt_calculations (
    calculation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Entity
    entity_id UUID REFERENCES corporate_entities(entity_id),

    -- Calculation type
    debt_type VARCHAR(100),                     -- 'insurance_premiums', 'slave_trader_loans',
                                                -- 'cotton_factoring', 'railroad_labor', 'direct_slaveholding'

    -- Historical amounts
    historical_value DECIMAL(20,2),
    historical_currency VARCHAR(20) DEFAULT 'USD',
    base_year INTEGER,

    -- Modern value calculation
    appreciation_rate DECIMAL(5,4),             -- e.g., 0.065 for 6.5%
    years_elapsed INTEGER,
    modern_value DECIMAL(20,2),

    -- Methodology
    methodology TEXT,
    calculation_formula TEXT,

    -- Source instruments
    instrument_ids UUID[],                      -- References to corporate_financial_instruments
    slaveholding_ids UUID[],                    -- References to corporate_slaveholding

    -- Verification
    verified BOOLEAN DEFAULT FALSE,
    verified_by VARCHAR(255),
    verified_at TIMESTAMP,

    -- Metadata
    calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_corp_debt_entity ON corporate_debt_calculations(entity_id);
CREATE INDEX IF NOT EXISTS idx_corp_debt_type ON corporate_debt_calculations(debt_type);

-- ============================================================================
-- SECTION 6: SEED FARMER-PAELLMANN DEFENDANTS (17 Entities)
-- ============================================================================

-- Banking & Finance (4 entities)
INSERT INTO corporate_entities (
    modern_name, historical_name, entity_type, is_farmer_paellmann_defendant,
    scac_paragraph_reference, documented_activity, involvement_category,
    self_concealment_alleged, misleading_statements_alleged, source_document
) VALUES
(
    'Bank of America (FleetBoston successor)',
    'Providence Bank',
    'bank',
    TRUE,
    '¶¶ 125-128',
    'Made loans to slave traders and collected custom duties and fees on ships engaged in the slave trade',
    ARRAY['lending', 'customs'],
    TRUE, TRUE,
    'Second Consolidated and Amended Complaint, Farmer-Paellmann v. FleetBoston'
),
(
    'JPMorgan Chase & Co.',
    'Two predecessor banks (consortium)',
    'bank',
    TRUE,
    '¶¶ 181-182',
    'Behind a consortium to raise money to insure slavery',
    ARRAY['insurance', 'consortium'],
    TRUE, TRUE,
    'Second Consolidated and Amended Complaint, Farmer-Paellmann v. FleetBoston'
),
(
    'Brown Brothers Harriman & Company',
    'Brown Brothers & Co.',
    'factor',
    TRUE,
    '¶¶ 145-152',
    'Loaned millions directly to planters, merchants and cotton brokers throughout the South; Louisiana court records from 1840s reveal ownership of two cotton plantations totaling 4,614 acres and 346 slaves',
    ARRAY['lending', 'factoring', 'direct_slaveholding'],
    TRUE, TRUE,
    'Second Consolidated and Amended Complaint, Farmer-Paellmann v. FleetBoston'
),
(
    'Barclays (Lehman successor)',
    'Henry Lehman & Brothers',
    'factor',
    TRUE,
    '¶¶ 168-171',
    'Grew rich as middlemen in the slave-grown cotton trade; owned slaves',
    ARRAY['factoring', 'direct_slaveholding'],
    FALSE, FALSE,
    'Second Consolidated and Amended Complaint, Farmer-Paellmann v. FleetBoston'
)
ON CONFLICT DO NOTHING;

-- Insurance (5 entities)
INSERT INTO corporate_entities (
    modern_name, historical_name, entity_type, is_farmer_paellmann_defendant,
    scac_paragraph_reference, documented_activity, involvement_category,
    self_concealment_alleged, misleading_statements_alleged, source_document
) VALUES
(
    'CVS Health (Aetna successor)',
    'Aetna predecessor-in-interest',
    'insurer',
    TRUE,
    '¶¶ 136-143',
    'Provided the instrumentality of slavery by underwriting insurance policies for slave owners against the loss of their African slaves',
    ARRAY['insurance'],
    TRUE, TRUE,
    'Second Consolidated and Amended Complaint, Farmer-Paellmann v. FleetBoston'
),
(
    'New York Life Insurance Company',
    'Nautilus Insurance',
    'insurer',
    TRUE,
    '¶¶ 155-162',
    'Earned premiums from its sale of life insurance to slave owners',
    ARRAY['insurance'],
    TRUE, TRUE,
    'Second Consolidated and Amended Complaint, Farmer-Paellmann v. FleetBoston'
),
(
    'Lloyd''s of London',
    'Lloyd''s of London',
    'insurer',
    TRUE,
    '¶¶ 173-174',
    'Insured ships utilized for the Trans-Atlantic slave trade',
    ARRAY['insurance', 'maritime'],
    TRUE, FALSE,
    'Second Consolidated and Amended Complaint, Farmer-Paellmann v. FleetBoston'
),
(
    'Southern Mutual Insurance Company',
    'Southern Mutual Insurance',
    'insurer',
    TRUE,
    '¶¶ 218-219',
    'Issued policies on the lives of slaves in Louisiana; aided and abetted those who engaged in the maintenance of slavery',
    ARRAY['insurance'],
    FALSE, FALSE,
    'Second Consolidated and Amended Complaint, Farmer-Paellmann v. FleetBoston'
),
(
    'American International Group (AIG)',
    'AIG predecessors',
    'insurer',
    TRUE,
    '¶¶ 221-223',
    'Sold insurance policies to cover the lives of enslaved Africans with slave owners as beneficiaries; aided and abetted those who engaged in the maintenance of slavery',
    ARRAY['insurance'],
    FALSE, FALSE,
    'Second Consolidated and Amended Complaint, Farmer-Paellmann v. FleetBoston'
)
ON CONFLICT DO NOTHING;

-- Railroads (4 entities)
INSERT INTO corporate_entities (
    modern_name, historical_name, entity_type, is_farmer_paellmann_defendant,
    scac_paragraph_reference, documented_activity, involvement_category,
    self_concealment_alleged, misleading_statements_alleged, source_document
) VALUES
(
    'CSX Corporation',
    'Numerous predecessor railroad lines',
    'railroad',
    TRUE,
    '¶¶ 129-133',
    'Successor-in-interest to numerous predecessor railroad lines that were constructed or run, at least in part, by slave labor',
    ARRAY['construction', 'labor'],
    TRUE, TRUE,
    'Second Consolidated and Amended Complaint, Farmer-Paellmann v. FleetBoston'
),
(
    'Norfolk Southern Corporation',
    'Numerous predecessor railroad lines',
    'railroad',
    TRUE,
    '¶¶ 163-165',
    'Successor-in-interest to numerous railroad lines constructed or run by slave labor; derived the benefits of unpaid slave labor; provided financial support to slave owners and slave traders',
    ARRAY['construction', 'labor', 'lending'],
    FALSE, FALSE,
    'Second Consolidated and Amended Complaint, Farmer-Paellmann v. FleetBoston'
),
(
    'Union Pacific Corporation',
    'Numerous predecessor railroad lines',
    'railroad',
    TRUE,
    '¶¶ 177-179',
    'Successor-in-interest to numerous predecessor railroad lines that were constructed or run in part by slave labor',
    ARRAY['construction', 'labor'],
    TRUE, TRUE,
    'Second Consolidated and Amended Complaint, Farmer-Paellmann v. FleetBoston'
),
(
    'Canadian National Railway',
    'Seven predecessor railroad lines',
    'railroad',
    TRUE,
    '¶¶ 213-215',
    'Successor-in-interest to seven predecessor railroad lines that were constructed and/or run in part by slave labor',
    ARRAY['construction', 'labor'],
    TRUE, FALSE,
    'Second Consolidated and Amended Complaint, Farmer-Paellmann v. FleetBoston'
)
ON CONFLICT DO NOTHING;

-- Tobacco - American Tobacco Company successors (4 entities)
INSERT INTO corporate_entities (
    modern_name, historical_name, entity_type, is_farmer_paellmann_defendant,
    scac_paragraph_reference, documented_activity, involvement_category,
    self_concealment_alleged, misleading_statements_alleged, source_document
) VALUES
(
    'R.J. Reynolds Tobacco Company',
    'American Tobacco Company',
    'tobacco',
    TRUE,
    '¶¶ 185, 197',
    'Beneficiary of assets acquired through the forced and uncompensated labors of enslaved African-Americans',
    ARRAY['manufacturing', 'labor'],
    FALSE, FALSE,
    'Second Consolidated and Amended Complaint, Farmer-Paellmann v. FleetBoston'
),
(
    'British American Tobacco (Brown & Williamson successor)',
    'American Tobacco Company',
    'tobacco',
    TRUE,
    '¶¶ 197, 201',
    'Beneficiary of assets acquired through the forced and uncompensated labors of enslaved African-Americans',
    ARRAY['manufacturing', 'labor'],
    FALSE, FALSE,
    'Second Consolidated and Amended Complaint, Farmer-Paellmann v. FleetBoston'
),
(
    'Vector Group (Liggett successor)',
    'American Tobacco Company',
    'tobacco',
    TRUE,
    '¶¶ 197, 204',
    'Beneficiary of assets acquired through the forced and uncompensated labors of enslaved African-Americans',
    ARRAY['manufacturing', 'labor'],
    FALSE, FALSE,
    'Second Consolidated and Amended Complaint, Farmer-Paellmann v. FleetBoston'
),
(
    'Loews Corporation',
    'American Tobacco Company (Lorillard Tobacco Company parent)',
    'tobacco',
    TRUE,
    '¶¶ 197, 210',
    'Beneficiary of assets acquired through the forced and uncompensated labors of enslaved African-Americans',
    ARRAY['manufacturing', 'labor'],
    FALSE, FALSE,
    'Second Consolidated and Amended Complaint, Farmer-Paellmann v. FleetBoston'
)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SECTION 7: SEED BROWN BROTHERS HARRIMAN DIRECT SLAVEHOLDING
-- The most documented case from SCAC: 4,614 acres and 346 enslaved
-- ============================================================================

INSERT INTO corporate_slaveholding (
    entity_id,
    entity_name,
    plantation_location,
    acreage,
    enslaved_count,
    court_record_reference,
    record_year,
    notes
)
SELECT
    entity_id,
    'Brown Brothers & Co.',
    'Louisiana',
    4614,
    346,
    'Louisiana court records dating back to the 1840s',
    1840,
    'Two cotton plantations totaling 4,614 acres. Per SCAC ¶¶ 145-152: "Louisiana court records dating back to the 1840s reveal that the Brown Brothers predecessors owned two cotton plantations totaling 4,614 acres and 346 slaves."'
FROM corporate_entities
WHERE modern_name = 'Brown Brothers Harriman & Company'
LIMIT 1
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SECTION 8: VIEWS FOR ANALYSIS
-- ============================================================================

-- View: Farmer-Paellmann defendants summary
CREATE OR REPLACE VIEW farmer_paellmann_defendants AS
SELECT
    ce.entity_id,
    ce.modern_name,
    ce.historical_name,
    ce.entity_type,
    ce.scac_paragraph_reference,
    ce.documented_activity,
    ce.involvement_category,
    ce.self_concealment_alleged,
    ce.misleading_statements_alleged,
    COALESCE(cs.enslaved_count, 0) as direct_enslaved_count,
    COALESCE(cs.acreage, 0) as direct_acreage,
    (SELECT COUNT(*) FROM corporate_financial_instruments cfi
     WHERE cfi.issuer_entity_id = ce.entity_id) as financial_instruments_count
FROM corporate_entities ce
LEFT JOIN corporate_slaveholding cs ON ce.entity_id = cs.entity_id
WHERE ce.is_farmer_paellmann_defendant = TRUE
ORDER BY ce.entity_type, ce.modern_name;

-- View: Corporate debt summary
CREATE OR REPLACE VIEW corporate_debt_summary AS
SELECT
    ce.entity_id,
    ce.modern_name,
    ce.entity_type,
    COUNT(DISTINCT cdc.calculation_id) as calculation_count,
    SUM(cdc.historical_value) as total_historical_value,
    SUM(cdc.modern_value) as total_modern_value,
    ARRAY_AGG(DISTINCT cdc.debt_type) as debt_types
FROM corporate_entities ce
LEFT JOIN corporate_debt_calculations cdc ON ce.entity_id = cdc.entity_id
GROUP BY ce.entity_id, ce.modern_name, ce.entity_type;

-- View: Defendants by sector
CREATE OR REPLACE VIEW defendants_by_sector AS
SELECT
    entity_type as sector,
    COUNT(*) as defendant_count,
    ARRAY_AGG(modern_name ORDER BY modern_name) as defendants,
    SUM(CASE WHEN self_concealment_alleged THEN 1 ELSE 0 END) as concealment_alleged_count,
    SUM(CASE WHEN misleading_statements_alleged THEN 1 ELSE 0 END) as misleading_alleged_count
FROM corporate_entities
WHERE is_farmer_paellmann_defendant = TRUE
GROUP BY entity_type
ORDER BY defendant_count DESC;

-- ============================================================================
-- SECTION 9: TRIGGERS
-- ============================================================================

-- Updated_at trigger for corporate_entities
DROP TRIGGER IF EXISTS update_corporate_entities_updated_at ON corporate_entities;
CREATE TRIGGER update_corporate_entities_updated_at
    BEFORE UPDATE ON corporate_entities
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Updated_at trigger for corporate_financial_instruments
DROP TRIGGER IF EXISTS update_corp_fin_inst_updated_at ON corporate_financial_instruments;
CREATE TRIGGER update_corp_fin_inst_updated_at
    BEFORE UPDATE ON corporate_financial_instruments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

SELECT 'Migration 021: Corporate Entities & Farmer-Paellmann Defendants Complete' AS status;
SELECT
    (SELECT COUNT(*) FROM corporate_entities WHERE is_farmer_paellmann_defendant = TRUE) as farmer_paellmann_defendants,
    (SELECT COUNT(*) FROM corporate_entities WHERE entity_type = 'bank') as banks,
    (SELECT COUNT(*) FROM corporate_entities WHERE entity_type = 'insurer') as insurers,
    (SELECT COUNT(*) FROM corporate_entities WHERE entity_type = 'railroad') as railroads,
    (SELECT COUNT(*) FROM corporate_entities WHERE entity_type = 'tobacco') as tobacco,
    (SELECT COUNT(*) FROM corporate_entities WHERE entity_type = 'factor') as factors,
    (SELECT COALESCE(SUM(enslaved_count), 0) FROM corporate_slaveholding) as direct_enslaved_documented;
