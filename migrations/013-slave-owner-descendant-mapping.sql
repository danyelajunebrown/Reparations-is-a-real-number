-- Migration 013: Slave Owner Descendant Mapping System
-- Purpose: Track descendants of slave owners from 1700s-1800s to present day
--          Support both government and individual descendant payment obligations
--
-- KEY CONCEPTS:
-- 1. Individual owners retain individual debts (debts don't transfer via inheritance)
-- 2. Government entities OR direct descendants can make payments on those debts
-- 3. Suspected descendants (private) → Confirmed descendants (opt-in)
-- 4. Same verification standards as enslaved descendants
-- 5. Direct lineage only: children → grandchildren → great-grandchildren

-- Table 1: Suspected Descendants (Private - Genealogy Research)
-- Contains genealogically-traced descendants who have NOT yet opted in
-- PRIVACY: This table should never be exposed publicly
CREATE TABLE IF NOT EXISTS slave_owner_descendants_suspected (
    id SERIAL PRIMARY KEY,
    
    -- Link to slave owner
    owner_individual_id VARCHAR(255) REFERENCES individuals(individual_id),
    owner_name VARCHAR(500) NOT NULL,
    owner_birth_year INTEGER,
    owner_death_year INTEGER,
    
    -- Descendant information
    descendant_name VARCHAR(500) NOT NULL,
    descendant_birth_year INTEGER,
    descendant_death_year INTEGER,
    generation_from_owner INTEGER NOT NULL, -- 1=child, 2=grandchild, 3=great-grandchild, etc.
    relationship_path TEXT, -- e.g., "child → grandchild → great-grandchild"
    parent_descendant_id INTEGER REFERENCES slave_owner_descendants_suspected(id), -- Forms tree structure
    
    -- Genealogy proof (for internal verification)
    familysearch_person_id VARCHAR(100),
    genealogy_proof_urls TEXT[],
    source_documents TEXT[], -- ["1850 Census", "Birth Certificate", "Marriage Record"]
    source_document_paths TEXT[], -- S3 paths or URLs
    
    -- Confidence assessment
    status VARCHAR(50) DEFAULT 'suspected', 
    -- Values: 'suspected', 'researching', 'probable', 'confirmed_lineage'
    confidence_score DECIMAL(3,2), -- 0.00-1.00
    confidence_factors JSONB, -- {"census_match": 0.8, "birth_record": 0.9, etc.}
    
    -- Privacy protection
    is_living BOOLEAN DEFAULT true,
    estimated_living_probability DECIMAL(3,2), -- Based on birth year (e.g., born 1990 = 0.99)
    privacy_notes TEXT, -- Reminders about privacy obligations
    
    -- Research tracking
    discovered_via VARCHAR(100), -- 'familysearch_api', 'census_scraping', 'public_records', 'manual'
    discovery_date DATE,
    researched_by VARCHAR(255),
    research_notes TEXT,
    last_verified_date DATE,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CONSTRAINT valid_generation CHECK (generation_from_owner > 0),
    CONSTRAINT valid_confidence CHECK (confidence_score >= 0 AND confidence_score <= 1.00)
);

CREATE INDEX idx_sods_owner_id ON slave_owner_descendants_suspected(owner_individual_id);
CREATE INDEX idx_sods_owner_name ON slave_owner_descendants_suspected(owner_name);
CREATE INDEX idx_sods_generation ON slave_owner_descendants_suspected(generation_from_owner);
CREATE INDEX idx_sods_is_living ON slave_owner_descendants_suspected(is_living);
CREATE INDEX idx_sods_status ON slave_owner_descendants_suspected(status);
CREATE INDEX idx_sods_confidence ON slave_owner_descendants_suspected(confidence_score);
CREATE INDEX idx_sods_familysearch_id ON slave_owner_descendants_suspected(familysearch_person_id);
CREATE INDEX idx_sods_parent_id ON slave_owner_descendants_suspected(parent_descendant_id);

-- Table 2: Confirmed Descendants (Public - Opt-In)
-- Descendants who have opted in and been verified
-- PUBLIC: Can be shown in listings (with consent)
CREATE TABLE IF NOT EXISTS slave_owner_descendants_confirmed (
    id SERIAL PRIMARY KEY,
    
    -- Link back to suspected record (if came from research)
    suspected_descendant_id INTEGER REFERENCES slave_owner_descendants_suspected(id),
    
    -- Link to slave owner
    owner_individual_id VARCHAR(255) REFERENCES individuals(individual_id),
    owner_name VARCHAR(500) NOT NULL,
    
    -- Verified descendant information
    descendant_full_name VARCHAR(500) NOT NULL,
    descendant_preferred_name VARCHAR(255), -- What they want to be called publicly
    descendant_email VARCHAR(255),
    descendant_phone VARCHAR(50),
    descendant_wallet_address VARCHAR(100), -- Ethereum/crypto wallet for payments
    
    generation_from_owner INTEGER NOT NULL,
    relationship_path TEXT NOT NULL,
    
    -- Verification documents (REQUIRED - same standard as enslaved descendants)
    familysearch_person_id VARCHAR(100) NOT NULL,
    verification_documents TEXT[] NOT NULL, -- Must have at least one document
    verification_document_paths TEXT[], -- S3 paths
    genealogy_narrative TEXT, -- Their explanation of the lineage
    
    -- Verification status
    verification_status VARCHAR(50) DEFAULT 'pending',
    -- Values: 'pending', 'under_review', 'approved', 'rejected', 'needs_more_info'
    verified_by VARCHAR(255),
    verification_date TIMESTAMP,
    verification_notes TEXT,
    rejection_reason TEXT,
    
    -- Opt-in details
    opted_in_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    opt_in_ip_address INET,
    opt_in_user_agent TEXT,
    consent_to_public_listing BOOLEAN DEFAULT false,
    consent_to_contact BOOLEAN DEFAULT false,
    
    -- Payment information
    payment_intent VARCHAR(50), -- 'will_pay', 'considering', 'researching_only', 'declined'
    payment_plan_requested BOOLEAN DEFAULT false,
    preferred_payment_method VARCHAR(50), -- 'crypto', 'wire', 'check', 'payment_plan'
    
    -- Payment tracking
    total_payments_made NUMERIC(20,2) DEFAULT 0,
    last_payment_date TIMESTAMP,
    payment_history JSONB, -- Array of payment records
    
    -- Account status
    account_status VARCHAR(50) DEFAULT 'active',
    -- Values: 'active', 'inactive', 'suspended', 'opted_out'
    account_notes TEXT,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CONSTRAINT unique_confirmed_descendant UNIQUE(owner_individual_id, descendant_email),
    CONSTRAINT valid_verification_status CHECK (
        verification_status IN ('pending', 'under_review', 'approved', 'rejected', 'needs_more_info')
    )
);

CREATE INDEX idx_sodc_owner_id ON slave_owner_descendants_confirmed(owner_individual_id);
CREATE INDEX idx_sodc_owner_name ON slave_owner_descendants_confirmed(owner_name);
CREATE INDEX idx_sodc_email ON slave_owner_descendants_confirmed(descendant_email);
CREATE INDEX idx_sodc_wallet ON slave_owner_descendants_confirmed(descendant_wallet_address);
CREATE INDEX idx_sodc_verification_status ON slave_owner_descendants_confirmed(verification_status);
CREATE INDEX idx_sodc_payment_intent ON slave_owner_descendants_confirmed(payment_intent);
CREATE INDEX idx_sodc_familysearch_id ON slave_owner_descendants_confirmed(familysearch_person_id);

-- Table 3: Descendant Debt Assignments
-- Links confirmed descendants to their ancestors' outstanding debts
CREATE TABLE IF NOT EXISTS descendant_debt_assignments (
    id SERIAL PRIMARY KEY,
    
    -- Links
    confirmed_descendant_id INTEGER REFERENCES slave_owner_descendants_confirmed(id) ON DELETE CASCADE,
    owner_individual_id VARCHAR(255) REFERENCES individuals(individual_id) NOT NULL,
    calculated_reparations_id INTEGER REFERENCES calculated_reparations(id),
    
    -- Debt summary
    owner_name VARCHAR(500) NOT NULL,
    debt_basis TEXT, -- "Owned 15 enslaved people 1820-1850"
    
    -- Financial details
    original_debt_amount NUMERIC(20,2) NOT NULL,
    compound_interest_amount NUMERIC(20,2) DEFAULT 0,
    total_current_debt NUMERIC(20,2) NOT NULL,
    interest_rate DECIMAL(6,4) DEFAULT 0.02, -- 2% annual
    debt_calculation_date DATE DEFAULT CURRENT_DATE,
    
    -- Payment tracking
    amount_paid NUMERIC(20,2) DEFAULT 0,
    amount_remaining NUMERIC(20,2) NOT NULL,
    payment_percentage DECIMAL(5,2) GENERATED ALWAYS AS 
        (CASE WHEN total_current_debt > 0 
         THEN (amount_paid / total_current_debt) * 100 
         ELSE 0 END) STORED,
    
    -- Payment plan
    payment_plan_active BOOLEAN DEFAULT false,
    payment_plan_terms JSONB, -- {"monthly_amount": 500, "start_date": "2025-01-01", etc.}
    next_payment_due DATE,
    
    -- Status
    assignment_status VARCHAR(50) DEFAULT 'active',
    -- Values: 'active', 'paid_in_full', 'payment_plan', 'defaulted', 'disputed'
    
    -- Notifications
    last_notification_sent TIMESTAMP,
    notification_preferences JSONB,
    
    -- Metadata
    assignment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT
);

CREATE INDEX idx_dda_confirmed_descendant ON descendant_debt_assignments(confirmed_descendant_id);
CREATE INDEX idx_dda_owner_id ON descendant_debt_assignments(owner_individual_id);
CREATE INDEX idx_dda_calc_reparations ON descendant_debt_assignments(calculated_reparations_id);
CREATE INDEX idx_dda_status ON descendant_debt_assignments(assignment_status);
CREATE INDEX idx_dda_payment_plan ON descendant_debt_assignments(payment_plan_active);

-- Table 4: Government Debt Obligations
-- Tracks government entities responsible for debt
-- (e.g., US Gov paid compensation TO owners, should have paid TO enslaved)
CREATE TABLE IF NOT EXISTS government_debt_obligations (
    id SERIAL PRIMARY KEY,
    
    -- Government entity
    government_level VARCHAR(50) NOT NULL, -- 'federal', 'state', 'county', 'municipal'
    government_name VARCHAR(500) NOT NULL, -- 'United States', 'Massachusetts', 'Washington DC'
    jurisdiction VARCHAR(500), -- Geographic area of responsibility
    government_entity_type VARCHAR(100), -- 'legislative', 'executive', 'judicial', 'agency'
    
    -- Related to owner/enslaver
    owner_individual_id VARCHAR(255) REFERENCES individuals(individual_id),
    owner_name VARCHAR(500),
    
    -- Debt basis (WHY government owes this)
    basis VARCHAR(100) NOT NULL,
    -- Values: 'compensation_paid_to_owner', 'enforcement_of_slavery_laws', 
    --         'broken_promise', 'fugitive_slave_enforcement', 'military_protection'
    basis_description TEXT,
    
    -- Historical context
    historical_payment_to_owner NUMERIC(20,2), -- What government paid TO owner
    historical_payment_date DATE,
    historical_payment_currency VARCHAR(10), -- 'USD', 'GBP', etc.
    historical_payment_program VARCHAR(255), -- 'DC Compensated Emancipation 1862'
    
    -- What SHOULD have been paid TO enslaved
    debt_owed_to_enslaved NUMERIC(20,2) NOT NULL,
    enslaved_count INTEGER,
    enslaved_individuals TEXT[], -- Names if known
    
    -- Current obligation calculation
    original_debt_amount NUMERIC(20,2) NOT NULL,
    compound_interest_amount NUMERIC(20,2) DEFAULT 0,
    total_current_obligation NUMERIC(20,2) NOT NULL,
    interest_rate DECIMAL(6,4) DEFAULT 0.02,
    obligation_calculation_date DATE DEFAULT CURRENT_DATE,
    
    -- Payment tracking
    amount_paid NUMERIC(20,2) DEFAULT 0,
    payment_history JSONB, -- Array of payment records with dates
    last_payment_date TIMESTAMP,
    
    -- Legal basis
    legal_authority TEXT, -- What law/ruling establishes this obligation
    court_case_references TEXT[],
    legislative_references TEXT[],
    legal_status VARCHAR(50), -- 'acknowledged', 'disputed', 'litigation', 'settled'
    
    -- Documentation
    source_documents TEXT[], -- Archive references, court docs, etc.
    source_document_paths TEXT[], -- S3 paths
    compensation_claim_id INTEGER REFERENCES compensation_claims(id),
    petition_id INTEGER REFERENCES historical_reparations_petitions(id),
    
    -- Status
    obligation_status VARCHAR(50) DEFAULT 'documented',
    -- Values: 'documented', 'acknowledged', 'negotiating', 'payment_plan', 'paid', 'disputed'
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT
);

CREATE INDEX idx_gdo_government_level ON government_debt_obligations(government_level);
CREATE INDEX idx_gdo_government_name ON government_debt_obligations(government_name);
CREATE INDEX idx_gdo_owner_id ON government_debt_obligations(owner_individual_id);
CREATE INDEX idx_gdo_basis ON government_debt_obligations(basis);
CREATE INDEX idx_gdo_status ON government_debt_obligations(obligation_status);
CREATE INDEX idx_gdo_compensation_claim ON government_debt_obligations(compensation_claim_id);
CREATE INDEX idx_gdo_petition ON government_debt_obligations(petition_id);

-- View: Living Confirmed Descendants with Outstanding Debts
CREATE VIEW living_descendants_with_debt AS
SELECT 
    sodc.id as descendant_id,
    sodc.descendant_full_name,
    sodc.descendant_preferred_name,
    sodc.owner_name,
    sodc.generation_from_owner,
    sodc.verification_status,
    sodc.payment_intent,
    sodc.consent_to_public_listing,
    
    dda.total_current_debt,
    dda.amount_paid,
    dda.amount_remaining,
    dda.payment_percentage,
    dda.payment_plan_active,
    
    sodc.descendant_email,
    sodc.descendant_wallet_address
FROM slave_owner_descendants_confirmed sodc
JOIN descendant_debt_assignments dda ON sodc.id = dda.confirmed_descendant_id
WHERE sodc.verification_status = 'approved'
  AND sodc.account_status = 'active'
  AND dda.amount_remaining > 0
ORDER BY dda.total_current_debt DESC;

-- View: Government Obligations Summary by Level
CREATE VIEW government_obligations_by_level AS
SELECT 
    government_level,
    COUNT(*) as obligation_count,
    COUNT(DISTINCT owner_individual_id) as unique_owners,
    SUM(total_current_obligation) as total_obligation,
    SUM(amount_paid) as total_paid,
    SUM(total_current_obligation - amount_paid) as total_outstanding,
    ROUND(AVG(CASE WHEN total_current_obligation > 0 
         THEN (amount_paid / total_current_obligation) * 100 
         ELSE 0 END), 2) as avg_payment_percentage
FROM government_debt_obligations
GROUP BY government_level
ORDER BY total_obligation DESC;

-- View: Descendant Research Progress
CREATE VIEW descendant_research_progress AS
SELECT 
    owner_name,
    owner_individual_id,
    COUNT(*) as total_suspected_descendants,
    COUNT(*) FILTER (WHERE is_living = true) as living_descendants,
    COUNT(*) FILTER (WHERE status = 'confirmed_lineage') as confirmed_lineage,
    MAX(generation_from_owner) as max_generation_mapped,
    STRING_AGG(DISTINCT discovered_via, ', ') as discovery_methods,
    MAX(last_verified_date) as most_recent_verification
FROM slave_owner_descendants_suspected
GROUP BY owner_name, owner_individual_id
ORDER BY total_suspected_descendants DESC;

-- View: Opt-In Conversion Funnel
CREATE VIEW optin_conversion_funnel AS
SELECT 
    COUNT(DISTINCT sods.owner_individual_id) as owners_with_suspected_descendants,
    COUNT(DISTINCT sods.id) as total_suspected_descendants,
    COUNT(DISTINCT sods.id) FILTER (WHERE sods.is_living = true) as living_suspected,
    COUNT(DISTINCT sodc.id) as total_opted_in,
    COUNT(DISTINCT sodc.id) FILTER (WHERE sodc.verification_status = 'approved') as verified_descendants,
    COUNT(DISTINCT sodc.id) FILTER (WHERE sodc.payment_intent = 'will_pay') as willing_to_pay,
    COUNT(DISTINCT sodc.id) FILTER (WHERE sodc.total_payments_made > 0) as have_paid,
    ROUND(
        (COUNT(DISTINCT sodc.id)::DECIMAL / NULLIF(COUNT(DISTINCT sods.id) FILTER (WHERE sods.is_living = true), 0)) * 100, 
        2
    ) as optin_conversion_rate
FROM slave_owner_descendants_suspected sods
LEFT JOIN slave_owner_descendants_confirmed sodc ON sods.id = sodc.suspected_descendant_id;

-- Comments
COMMENT ON TABLE slave_owner_descendants_suspected IS 'PRIVATE TABLE: Genealogically-traced descendants of slave owners who have NOT opted in. Never expose publicly. Used for research purposes only.';

COMMENT ON TABLE slave_owner_descendants_confirmed IS 'PUBLIC TABLE (with consent): Descendants who have opted in and been verified. Can be shown in listings if consent_to_public_listing = true.';

COMMENT ON TABLE descendant_debt_assignments IS 'Links verified descendants to their ancestors outstanding debts. Tracks payment progress and plans.';

COMMENT ON TABLE government_debt_obligations IS 'Tracks government entities responsible for reparations debt (e.g., paid compensation TO owners instead of TO enslaved).';

COMMENT ON COLUMN slave_owner_descendants_suspected.is_living IS 'Estimated based on birth year. Used to filter for privacy protection. Living people should never be publicly identified without consent.';

COMMENT ON COLUMN slave_owner_descendants_confirmed.verification_status IS 'Must be "approved" before descendant can make payments or be publicly listed. Same verification standard as enslaved descendants.';

COMMENT ON COLUMN government_debt_obligations.basis IS 'Legal/historical basis for government obligation. Most common: compensation_paid_to_owner (paid wrong party), broken_promise (awarded reparations but did not pay).';
