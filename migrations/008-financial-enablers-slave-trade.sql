-- Migration 008: Financial Enablers of the Slave Trade
-- Date: December 10, 2025
-- Purpose: Add support for tracking financial institutions, underwriters, insurers,
--          banks, and merchants who profited from and enabled the slave trade
--
-- Based on research from Underwriting Souls project (Johns Hopkins/Black Beyond Data)
-- Documenting Lloyd's of London insurance market and transatlantic slave trade finance
--
-- Key entities: Insurance underwriters, banks, trading companies, merchants, ship captains
-- Key documents: Insurance policies, risk books, bills of lading, ship manifests

-- ============================================================================
-- SECTION 1: FINANCIAL INSTITUTIONS
-- Organizations that enabled and profited from slave trade financing
-- ============================================================================

CREATE TABLE IF NOT EXISTS financial_institutions (
    institution_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Basic identification
    name VARCHAR(500) NOT NULL,
    alternate_names TEXT[],                     -- Other names used
    institution_type VARCHAR(100) NOT NULL,     -- See institution_types table
    -- Location
    headquarters_city VARCHAR(255),
    headquarters_country VARCHAR(100),
    -- Operating period
    founded_year INTEGER,
    founded_date DATE,
    dissolved_year INTEGER,
    dissolved_date DATE,
    is_still_operating BOOLEAN DEFAULT false,
    -- Modern successor (if applicable)
    modern_successor VARCHAR(500),              -- e.g., "Lloyd's of London still operates"
    modern_successor_notes TEXT,
    -- Scope of slave trade involvement
    involvement_type VARCHAR(100)[],            -- ['insurance', 'financing', 'trading', 'brokerage']
    involvement_description TEXT,
    involvement_start_year INTEGER,
    involvement_end_year INTEGER,
    -- Estimated scale
    estimated_policies_written INTEGER,
    estimated_voyages_financed INTEGER,
    estimated_enslaved_insured INTEGER,
    -- External references
    tastdb_id VARCHAR(100),                     -- Trans-Atlantic Slave Trade Database ID
    lloyds_reference_id VARCHAR(100),
    external_ids JSONB,                         -- Other database IDs
    -- Source and provenance
    source_document_id VARCHAR(255),
    source_notes TEXT,
    -- Metadata
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fin_inst_name ON financial_institutions(name);
CREATE INDEX IF NOT EXISTS idx_fin_inst_type ON financial_institutions(institution_type);
CREATE INDEX IF NOT EXISTS idx_fin_inst_country ON financial_institutions(headquarters_country);
CREATE INDEX IF NOT EXISTS idx_fin_inst_involvement ON financial_institutions USING GIN(involvement_type);

-- Institution types reference table
CREATE TABLE IF NOT EXISTS institution_types (
    type_code VARCHAR(100) PRIMARY KEY,
    type_name VARCHAR(255) NOT NULL,
    description TEXT,
    examples TEXT[]
);

INSERT INTO institution_types (type_code, type_name, description, examples)
VALUES
    ('insurance_market', 'Insurance Market', 'Marketplace for marine and slave trade insurance', ARRAY['Lloyds Coffee House', 'Royal Exchange']),
    ('insurance_company', 'Insurance Company', 'Formal insurance corporation', ARRAY['Royal African Company Insurance']),
    ('bank', 'Bank', 'Banking institution providing credit and financing', ARRAY['Bank of England', 'Barclays']),
    ('trading_company', 'Trading Company', 'Chartered or private trading enterprises', ARRAY['Royal African Company', 'South Sea Company']),
    ('merchant_house', 'Merchant House', 'Family or partnership trading firm', ARRAY['Thomas & John Backhouse', 'Clagett & Pratt']),
    ('shipping_company', 'Shipping Company', 'Companies owning or operating slave ships', ARRAY['Liverpool slave traders']),
    ('brokerage', 'Brokerage', 'Insurance brokers connecting underwriters and clients', ARRAY['Lloyds brokers']),
    ('plantation_company', 'Plantation Company', 'Colonial plantation investment companies', ARRAY['Jamaica plantation companies']),
    ('factor_house', 'Factor House', 'Colonial agents and factors', ARRAY['West India factors'])
ON CONFLICT (type_code) DO NOTHING;

-- ============================================================================
-- SECTION 2: UNDERWRITERS AND FINANCIAL ACTORS
-- Individuals who wrote insurance policies or engaged in slave trade finance
-- ============================================================================

CREATE TABLE IF NOT EXISTS financial_actors (
    actor_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Basic identification
    full_name VARCHAR(500) NOT NULL,
    given_name VARCHAR(255),
    surname VARCHAR(255),
    alternate_names TEXT[],
    -- Role
    primary_role VARCHAR(100) NOT NULL,         -- 'underwriter', 'broker', 'merchant', 'banker', 'captain', 'factor'
    roles VARCHAR(100)[],                       -- All roles held
    -- Institutional affiliations
    primary_institution_id UUID REFERENCES financial_institutions(institution_id),
    -- Lloyd's specific
    lloyds_subscriber_number VARCHAR(50),
    lloyds_subscriber_year INTEGER,
    lloyds_committee_member BOOLEAN DEFAULT false,
    -- Location
    city VARCHAR(255),
    country VARCHAR(100),
    -- Active period
    birth_year INTEGER,
    death_year INTEGER,
    active_start_year INTEGER,
    active_end_year INTEGER,
    -- Scale of involvement
    estimated_policies_signed INTEGER,
    estimated_voyages_backed INTEGER,
    estimated_enslaved_insured INTEGER,
    -- For ship captains
    voyages_captained INTEGER,
    ships_commanded TEXT[],
    -- Wealth/status indicators
    honorific VARCHAR(50),                      -- 'Esq', 'Gent', 'Sir', 'Captain'
    profession_additional VARCHAR(255),         -- Other professions
    -- External references
    tastdb_person_id VARCHAR(100),
    external_ids JSONB,
    -- Source
    source_document_id VARCHAR(255),
    source_notes TEXT,
    -- Metadata
    notes TEXT,
    biography TEXT,
    portrait_url TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fin_actors_name ON financial_actors(full_name);
CREATE INDEX IF NOT EXISTS idx_fin_actors_surname ON financial_actors(surname);
CREATE INDEX IF NOT EXISTS idx_fin_actors_role ON financial_actors(primary_role);
CREATE INDEX IF NOT EXISTS idx_fin_actors_roles ON financial_actors USING GIN(roles);
CREATE INDEX IF NOT EXISTS idx_fin_actors_institution ON financial_actors(primary_institution_id);
CREATE INDEX IF NOT EXISTS idx_fin_actors_lloyds ON financial_actors(lloyds_subscriber_number);

-- Actor role types
CREATE TABLE IF NOT EXISTS actor_role_types (
    role_code VARCHAR(100) PRIMARY KEY,
    role_name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100)                       -- 'insurance', 'maritime', 'merchant', 'financial'
);

INSERT INTO actor_role_types (role_code, role_name, description, category)
VALUES
    ('underwriter', 'Insurance Underwriter', 'Individual who signed insurance policies, assuming financial risk', 'insurance'),
    ('broker', 'Insurance Broker', 'Agent who arranged insurance between shipowners and underwriters', 'insurance'),
    ('lloyds_agent', 'Lloyds Agent', 'Overseas representative of Lloyds providing intelligence', 'insurance'),
    ('captain', 'Ship Captain', 'Commander of slaving vessel', 'maritime'),
    ('ship_owner', 'Ship Owner', 'Owner of vessels used in slave trade', 'maritime'),
    ('supercargo', 'Supercargo', 'Agent aboard ship responsible for cargo and trade', 'maritime'),
    ('merchant', 'Merchant', 'Trader in enslaved persons and slave-produced goods', 'merchant'),
    ('planter', 'Planter', 'Colonial plantation owner', 'merchant'),
    ('factor', 'Factor', 'Colonial agent handling sales and purchases', 'merchant'),
    ('banker', 'Banker', 'Provider of credit and financial services', 'financial'),
    ('investor', 'Investor', 'Financial backer of slaving voyages', 'financial'),
    ('commissioner', 'Commissioner', 'Agent managing sales of enslaved people in colonies', 'merchant')
ON CONFLICT (role_code) DO NOTHING;

-- ============================================================================
-- SECTION 3: VESSELS (SLAVE SHIPS)
-- Ships used in the transatlantic slave trade
-- ============================================================================

CREATE TABLE IF NOT EXISTS vessels (
    vessel_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Identification
    vessel_name VARCHAR(255) NOT NULL,
    alternate_names TEXT[],                     -- Ships were often renamed
    -- Classification
    vessel_type VARCHAR(100),                   -- 'ship', 'snow', 'brig', 'schooner', 'sloop'
    rig_type VARCHAR(100),                      -- Rigging configuration
    -- Physical characteristics
    tonnage INTEGER,                            -- Registered tonnage
    tonnage_type VARCHAR(50),                   -- 'builders_measure', 'registered'
    guns INTEGER,                               -- Number of guns/armament
    deck_count INTEGER,
    -- Construction
    build_year INTEGER,
    build_location VARCHAR(255),
    -- Registration
    registration_port VARCHAR(255),
    registration_country VARCHAR(100),
    registration_number VARCHAR(100),
    -- Ownership
    primary_owner_id UUID REFERENCES financial_actors(actor_id),
    owner_names TEXT[],                         -- When owner isn't in actors table
    -- Operations
    home_port VARCHAR(255),
    operating_years VARCHAR(50),                -- e.g., "1780-1795"
    total_voyages INTEGER,
    slave_voyages INTEGER,
    -- TASTDB reference
    tastdb_vessel_id INTEGER,
    -- Source
    source_document_id VARCHAR(255),
    source_notes TEXT,
    -- Metadata
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vessels_name ON vessels(vessel_name);
CREATE INDEX IF NOT EXISTS idx_vessels_port ON vessels(registration_port);
CREATE INDEX IF NOT EXISTS idx_vessels_owner ON vessels(primary_owner_id);
CREATE INDEX IF NOT EXISTS idx_vessels_tastdb ON vessels(tastdb_vessel_id);

-- ============================================================================
-- SECTION 4: SLAVING VOYAGES
-- Individual transatlantic slaving voyages
-- ============================================================================

CREATE TABLE IF NOT EXISTS slaving_voyages (
    voyage_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Identification
    voyage_reference VARCHAR(100),              -- Internal reference
    tastdb_voyage_id INTEGER,                   -- Trans-Atlantic Slave Trade Database ID
    -- Vessel
    vessel_id UUID REFERENCES vessels(vessel_id),
    vessel_name VARCHAR(255),                   -- Denormalized for convenience
    -- Personnel
    captain_id UUID REFERENCES financial_actors(actor_id),
    captain_name VARCHAR(255),                  -- Denormalized
    owner_id UUID REFERENCES financial_actors(actor_id),
    owner_name VARCHAR(255),
    -- Ports and route
    departure_port VARCHAR(255),
    departure_region VARCHAR(100),              -- 'Britain', 'France', 'Portugal', 'Americas'
    african_port VARCHAR(255),
    african_region VARCHAR(100),                -- 'Senegambia', 'Gold Coast', 'Bight of Benin', etc.
    destination_port VARCHAR(255),
    destination_region VARCHAR(100),            -- 'Jamaica', 'Barbados', 'Virginia', etc.
    -- Dates
    departure_date DATE,
    departure_year INTEGER,
    african_arrival_date DATE,
    african_departure_date DATE,
    destination_arrival_date DATE,
    destination_year INTEGER,
    return_date DATE,
    -- Human cargo
    enslaved_embarked INTEGER,                  -- Number taken from Africa
    enslaved_disembarked INTEGER,               -- Number arriving at destination
    enslaved_died INTEGER,                      -- Deaths during Middle Passage
    mortality_rate DECIMAL(5,2),                -- Calculated percentage
    -- Cargo details
    cargo_notes TEXT,                           -- Description of other cargo
    -- Outcome
    voyage_outcome VARCHAR(100),                -- 'completed', 'captured', 'wrecked', 'revolted'
    outcome_notes TEXT,
    -- Insurance
    was_insured BOOLEAN,
    insured_value DECIMAL(15,2),
    insured_currency VARCHAR(20),               -- 'GBP', 'USD', etc.
    -- Financial
    profit_estimate DECIMAL(15,2),
    profit_currency VARCHAR(20),
    -- Source
    source_document_id VARCHAR(255),
    source_notes TEXT,
    -- Metadata
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voyages_vessel ON slaving_voyages(vessel_id);
CREATE INDEX IF NOT EXISTS idx_voyages_captain ON slaving_voyages(captain_id);
CREATE INDEX IF NOT EXISTS idx_voyages_year ON slaving_voyages(departure_year);
CREATE INDEX IF NOT EXISTS idx_voyages_dest ON slaving_voyages(destination_region);
CREATE INDEX IF NOT EXISTS idx_voyages_tastdb ON slaving_voyages(tastdb_voyage_id);

-- ============================================================================
-- SECTION 5: INSURANCE POLICIES
-- Documents insuring enslaved people and slaving voyages
-- ============================================================================

CREATE TABLE IF NOT EXISTS insurance_policies (
    policy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Identification
    policy_number VARCHAR(100),
    policy_reference VARCHAR(255),              -- Archive reference
    -- Policy details
    policy_date DATE,
    policy_year INTEGER,
    policy_type VARCHAR(100),                   -- 'voyage', 'time', 'mixed'
    -- Coverage
    coverage_type VARCHAR(100)[],               -- ['hull', 'cargo', 'enslaved_persons', 'freight']
    insured_value DECIMAL(15,2),
    premium DECIMAL(15,2),
    premium_rate DECIMAL(5,2),                  -- As percentage
    currency VARCHAR(20) DEFAULT 'GBP',
    -- Parties
    insured_party_id UUID REFERENCES financial_actors(actor_id),
    insured_party_name VARCHAR(500),            -- Denormalized
    broker_id UUID REFERENCES financial_actors(actor_id),
    broker_name VARCHAR(255),
    -- Voyage/vessel (if applicable)
    voyage_id UUID REFERENCES slaving_voyages(voyage_id),
    vessel_id UUID REFERENCES vessels(vessel_id),
    vessel_name VARCHAR(255),
    -- Route covered
    from_port VARCHAR(255),
    to_port VARCHAR(255),
    route_description TEXT,
    -- Enslaved persons covered
    enslaved_covered INTEGER,                   -- Number of enslaved people insured
    value_per_person DECIMAL(10,2),
    -- Risk book reference (Lloyd's)
    risk_book_volume VARCHAR(50),
    risk_book_page VARCHAR(50),
    risk_book_entry VARCHAR(100),
    -- Claims
    claim_made BOOLEAN DEFAULT false,
    claim_amount DECIMAL(15,2),
    claim_reason TEXT,
    claim_paid BOOLEAN,
    claim_paid_amount DECIMAL(15,2),
    -- Source document
    source_document_id VARCHAR(255),
    archive_reference VARCHAR(255),
    digitized_image_url TEXT,
    iiif_manifest_url TEXT,                     -- IIIF viewer link
    -- Metadata
    transcription TEXT,                         -- OCR or manual transcription
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_policies_number ON insurance_policies(policy_number);
CREATE INDEX IF NOT EXISTS idx_policies_year ON insurance_policies(policy_year);
CREATE INDEX IF NOT EXISTS idx_policies_insured ON insurance_policies(insured_party_id);
CREATE INDEX IF NOT EXISTS idx_policies_voyage ON insurance_policies(voyage_id);
CREATE INDEX IF NOT EXISTS idx_policies_vessel ON insurance_policies(vessel_id);

-- ============================================================================
-- SECTION 6: POLICY UNDERWRITERS (Junction Table)
-- Links underwriters to the policies they signed
-- ============================================================================

CREATE TABLE IF NOT EXISTS policy_underwriters (
    id SERIAL PRIMARY KEY,
    policy_id UUID NOT NULL REFERENCES insurance_policies(policy_id) ON DELETE CASCADE,
    underwriter_id UUID REFERENCES financial_actors(actor_id),
    underwriter_name VARCHAR(500),              -- When underwriter not in actors table
    -- Amount underwritten
    amount_subscribed DECIMAL(15,2),
    percentage_subscribed DECIMAL(5,2),
    -- Position in policy
    subscription_order INTEGER,                 -- Order of signing (1=first, etc.)
    is_lead_underwriter BOOLEAN DEFAULT false,
    -- Signature details
    signature_mark TEXT,                        -- Description of signature/mark
    -- Source
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pol_uw_policy ON policy_underwriters(policy_id);
CREATE INDEX IF NOT EXISTS idx_pol_uw_underwriter ON policy_underwriters(underwriter_id);

-- ============================================================================
-- SECTION 7: INSTITUTION AFFILIATIONS
-- Links financial actors to institutions over time
-- ============================================================================

CREATE TABLE IF NOT EXISTS institution_affiliations (
    id SERIAL PRIMARY KEY,
    actor_id UUID NOT NULL REFERENCES financial_actors(actor_id) ON DELETE CASCADE,
    institution_id UUID NOT NULL REFERENCES financial_institutions(institution_id) ON DELETE CASCADE,
    -- Role at institution
    role VARCHAR(100),                          -- 'subscriber', 'committee_member', 'partner', 'employee'
    title VARCHAR(255),
    -- Period
    start_year INTEGER,
    end_year INTEGER,
    start_date DATE,
    end_date DATE,
    -- Source
    source_document_id VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inst_aff_actor ON institution_affiliations(actor_id);
CREATE INDEX IF NOT EXISTS idx_inst_aff_institution ON institution_affiliations(institution_id);

-- ============================================================================
-- SECTION 8: FINANCIAL TRANSACTIONS
-- Tracks financial flows related to slave trade
-- ============================================================================

CREATE TABLE IF NOT EXISTS financial_transactions (
    transaction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Transaction type
    transaction_type VARCHAR(100) NOT NULL,     -- 'insurance_premium', 'insurance_claim', 'slave_sale', 'loan', 'investment'
    transaction_subtype VARCHAR(100),
    -- Parties
    payer_id UUID REFERENCES financial_actors(actor_id),
    payer_name VARCHAR(500),
    payer_institution_id UUID REFERENCES financial_institutions(institution_id),
    payee_id UUID REFERENCES financial_actors(actor_id),
    payee_name VARCHAR(500),
    payee_institution_id UUID REFERENCES financial_institutions(institution_id),
    -- Amount
    amount DECIMAL(15,2),
    currency VARCHAR(20) DEFAULT 'GBP',
    amount_usd_equivalent DECIMAL(15,2),        -- Converted to USD for comparison
    -- Date
    transaction_date DATE,
    transaction_year INTEGER,
    -- Related records
    policy_id UUID REFERENCES insurance_policies(policy_id),
    voyage_id UUID REFERENCES slaving_voyages(voyage_id),
    -- Description
    description TEXT,
    -- Source
    source_document_id VARCHAR(255),
    source_notes TEXT,
    -- Metadata
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fin_trans_type ON financial_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_fin_trans_payer ON financial_transactions(payer_id);
CREATE INDEX IF NOT EXISTS idx_fin_trans_payee ON financial_transactions(payee_id);
CREATE INDEX IF NOT EXISTS idx_fin_trans_year ON financial_transactions(transaction_year);

-- ============================================================================
-- SECTION 9: ENSLAVED PERSONS ON VOYAGES
-- Links enslaved individuals to voyages when known
-- ============================================================================

CREATE TABLE IF NOT EXISTS voyage_enslaved (
    id SERIAL PRIMARY KEY,
    voyage_id UUID NOT NULL REFERENCES slaving_voyages(voyage_id) ON DELETE CASCADE,
    -- Can link to our enslaved_individuals table if matched
    enslaved_id VARCHAR(255) REFERENCES enslaved_individuals(enslaved_id),
    -- Otherwise store what we know
    recorded_name VARCHAR(255),
    african_name VARCHAR(255),
    age_at_embarkation INTEGER,
    gender VARCHAR(20),
    ethnicity VARCHAR(100),                     -- As recorded
    region_of_origin VARCHAR(255),
    -- Outcome
    survived_voyage BOOLEAN,
    sold_at VARCHAR(255),                       -- Location where sold
    purchaser_name VARCHAR(500),
    sale_price DECIMAL(10,2),
    sale_currency VARCHAR(20),
    -- Source
    source_document_id VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voyage_enslaved_voyage ON voyage_enslaved(voyage_id);
CREATE INDEX IF NOT EXISTS idx_voyage_enslaved_person ON voyage_enslaved(enslaved_id);

-- ============================================================================
-- SECTION 10: DOCUMENT TYPES FOR FINANCIAL RECORDS
-- Add new document types to source_types if they don't exist
-- ============================================================================

INSERT INTO source_types (source_type_code, source_type_name, description, reliability_weight)
VALUES
    ('insurance_policy', 'Insurance Policy', 'Marine or slave trade insurance policy', 0.95),
    ('risk_book', 'Risk Book Entry', 'Lloyd''s risk book subscription record', 0.95),
    ('ship_manifest', 'Ship Manifest', 'Cargo and passenger/enslaved manifest', 0.90),
    ('bill_of_lading', 'Bill of Lading', 'Shipping receipt for cargo', 0.90),
    ('ship_log', 'Ship Log', 'Captain''s log or journal', 0.85),
    ('merchant_letter', 'Merchant Correspondence', 'Business letters between traders', 0.80),
    ('account_book', 'Account Book', 'Financial ledger or account book', 0.90),
    ('slave_sale_record', 'Slave Sale Record', 'Record of sale of enslaved persons', 0.90),
    ('parliamentary_record', 'Parliamentary Record', 'British Parliamentary papers', 0.95),
    ('admiralty_record', 'Admiralty Record', 'Naval or maritime court record', 0.95),
    ('lloyds_list', 'Lloyd''s List', 'Lloyd''s shipping news publication', 0.85),
    ('plantation_record', 'Plantation Record', 'Plantation account or inventory', 0.90)
ON CONFLICT (source_type_code) DO NOTHING;

-- ============================================================================
-- SECTION 11: RELATIONSHIP TYPES FOR FINANCIAL ACTORS
-- Add new relationship types for economic/financial relationships
-- ============================================================================

INSERT INTO relationship_types (relationship_code, relationship_name, category, inverse_code, is_directed, description)
VALUES
    ('underwrote', 'Underwrote', 'financial', 'insured_by', true, 'Underwrote insurance for'),
    ('insured_by', 'Insured By', 'financial', 'underwrote', true, 'Was insured by'),
    ('brokered_for', 'Brokered For', 'financial', 'used_broker', true, 'Acted as insurance broker for'),
    ('used_broker', 'Used Broker', 'financial', 'brokered_for', true, 'Used as insurance broker'),
    ('financed', 'Financed', 'financial', 'financed_by', true, 'Provided financing for'),
    ('financed_by', 'Financed By', 'financial', 'financed', true, 'Was financed by'),
    ('ship_owner_of', 'Ship Owner Of', 'economic', 'ship_owned_by', true, 'Owned this vessel'),
    ('ship_owned_by', 'Ship Owned By', 'economic', 'ship_owner_of', true, 'Vessel was owned by'),
    ('captained_for', 'Captained For', 'economic', 'employed_captain', true, 'Served as captain for'),
    ('employed_captain', 'Employed Captain', 'economic', 'captained_for', true, 'Employed this captain'),
    ('agent_for', 'Agent For', 'economic', 'used_agent', true, 'Acted as agent for'),
    ('used_agent', 'Used Agent', 'economic', 'agent_for', true, 'Used this person as agent'),
    ('subscribed_with', 'Subscribed With', 'financial', 'subscribed_with', false, 'Co-subscribed on policies'),
    ('traded_with', 'Traded With', 'economic', 'traded_with', false, 'Business trading partners')
ON CONFLICT (relationship_code) DO NOTHING;

-- ============================================================================
-- SECTION 12: VIEWS FOR FINANCIAL DATA ANALYSIS
-- ============================================================================

-- View: Underwriter activity summary
CREATE OR REPLACE VIEW underwriter_summary AS
SELECT
    fa.actor_id,
    fa.full_name,
    fa.lloyds_subscriber_number,
    fi.name AS institution_name,
    COUNT(DISTINCT pu.policy_id) AS policies_signed,
    SUM(pu.amount_subscribed) AS total_subscribed,
    SUM(CASE WHEN pu.is_lead_underwriter THEN 1 ELSE 0 END) AS times_lead,
    MIN(ip.policy_year) AS earliest_policy,
    MAX(ip.policy_year) AS latest_policy,
    SUM(ip.enslaved_covered) AS total_enslaved_insured
FROM financial_actors fa
LEFT JOIN financial_institutions fi ON fa.primary_institution_id = fi.institution_id
LEFT JOIN policy_underwriters pu ON fa.actor_id = pu.underwriter_id
LEFT JOIN insurance_policies ip ON pu.policy_id = ip.policy_id
WHERE fa.primary_role = 'underwriter' OR 'underwriter' = ANY(fa.roles)
GROUP BY fa.actor_id, fa.full_name, fa.lloyds_subscriber_number, fi.name;

-- View: Voyage with financial details
CREATE OR REPLACE VIEW voyage_financial_summary AS
SELECT
    sv.voyage_id,
    sv.tastdb_voyage_id,
    v.vessel_name,
    sv.captain_name,
    sv.departure_year,
    sv.african_region,
    sv.destination_region,
    sv.enslaved_embarked,
    sv.enslaved_disembarked,
    sv.mortality_rate,
    COUNT(DISTINCT ip.policy_id) AS policies_count,
    SUM(ip.insured_value) AS total_insured_value,
    SUM(ip.premium) AS total_premiums,
    sv.profit_estimate
FROM slaving_voyages sv
LEFT JOIN vessels v ON sv.vessel_id = v.vessel_id
LEFT JOIN insurance_policies ip ON sv.voyage_id = ip.voyage_id
GROUP BY sv.voyage_id, sv.tastdb_voyage_id, v.vessel_name, sv.captain_name,
         sv.departure_year, sv.african_region, sv.destination_region,
         sv.enslaved_embarked, sv.enslaved_disembarked, sv.mortality_rate, sv.profit_estimate;

-- View: Institution involvement summary
CREATE OR REPLACE VIEW institution_involvement_summary AS
SELECT
    fi.institution_id,
    fi.name,
    fi.institution_type,
    fi.involvement_type,
    COUNT(DISTINCT fa.actor_id) AS associated_actors,
    COUNT(DISTINCT pu.policy_id) AS policies_through_actors,
    fi.estimated_voyages_financed,
    fi.estimated_enslaved_insured,
    fi.involvement_start_year,
    fi.involvement_end_year
FROM financial_institutions fi
LEFT JOIN financial_actors fa ON fa.primary_institution_id = fi.institution_id
LEFT JOIN policy_underwriters pu ON fa.actor_id = pu.underwriter_id
GROUP BY fi.institution_id, fi.name, fi.institution_type, fi.involvement_type,
         fi.estimated_voyages_financed, fi.estimated_enslaved_insured,
         fi.involvement_start_year, fi.involvement_end_year;

-- ============================================================================
-- SECTION 13: SAMPLE DATA - Lloyd's of London
-- ============================================================================

-- Insert Lloyds of London as foundational institution
INSERT INTO financial_institutions (
    name,
    alternate_names,
    institution_type,
    headquarters_city,
    headquarters_country,
    founded_year,
    is_still_operating,
    modern_successor,
    involvement_type,
    involvement_description,
    involvement_start_year,
    involvement_end_year,
    notes
)
VALUES (
    'Lloyds of London',
    ARRAY['Lloyds Coffee House', 'Lloyds', 'Society of Lloyds'],
    'insurance_market',
    'London',
    'United Kingdom',
    1688,
    true,
    'Lloyds of London (continues operating)',
    ARRAY['insurance', 'brokerage'],
    'Primary marketplace for marine insurance including extensive underwriting of slave ships and their human cargo. Underwriters at Lloyds insured thousands of slaving voyages between 1688 and 1807.',
    1688,
    1807,
    'The Lloyds archive at Lloyds of London contains extensive records of slave trade insurance. The Underwriting Souls project documents these records.'
)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SECTION 14: UPDATE TRIGGERS
-- ============================================================================

-- Apply updated_at trigger to new tables
DO $$
DECLARE
    t text;
BEGIN
    FOR t IN SELECT unnest(ARRAY[
        'financial_institutions',
        'financial_actors',
        'vessels',
        'slaving_voyages',
        'insurance_policies',
        'financial_transactions'
    ])
    LOOP
        EXECUTE format('
            DROP TRIGGER IF EXISTS update_%s_updated_at ON %s;
            CREATE TRIGGER update_%s_updated_at
            BEFORE UPDATE ON %s
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
        ', t, t, t, t);
    END LOOP;
END $$;

-- ============================================================================
-- MIGRATION SUMMARY
-- ============================================================================

SELECT 'Migration 008: Financial Enablers Complete' AS status;
SELECT table_name, table_type
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN (
    'financial_institutions',
    'institution_types',
    'financial_actors',
    'actor_role_types',
    'vessels',
    'slaving_voyages',
    'insurance_policies',
    'policy_underwriters',
    'institution_affiliations',
    'financial_transactions',
    'voyage_enslaved'
)
ORDER BY table_name;
