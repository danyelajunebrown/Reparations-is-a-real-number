-- Migration 025: Enslaved Descendant Credit System
-- Purpose: Track descendants of enslaved people who are OWED reparations (CREDIT side)
--          Mirrors the slave_owner_descendants structure but for the opposite purpose
--
-- KEY CONCEPTS:
-- 1. Enslaved ancestors were owed wages, land, and compensation
-- 2. Their descendants inherit these CREDITS (unlike debts which don't transfer)
-- 3. Suspected descendants (private) → Confirmed descendants (opt-in)
-- 4. Same verification standards as slaveholder descendants
-- 5. Direct lineage only: children → grandchildren → great-grandchildren

-- Table 1: Suspected Enslaved Descendants (Private - Genealogy Research)
-- Contains genealogically-traced descendants who have NOT yet opted in
-- PRIVACY: This table should never be exposed publicly
CREATE TABLE IF NOT EXISTS enslaved_descendants_suspected (
    id SERIAL PRIMARY KEY,

    -- Link to enslaved ancestor
    enslaved_person_id INTEGER REFERENCES canonical_persons(id),
    enslaved_name VARCHAR(500) NOT NULL,
    enslaved_birth_year INTEGER,
    enslaved_death_year INTEGER,
    enslaved_location VARCHAR(500), -- Where they were held
    enslaver_name VARCHAR(500), -- Who enslaved them (for context)
    enslaver_id INTEGER REFERENCES canonical_persons(id),

    -- Descendant information
    descendant_name VARCHAR(500) NOT NULL,
    descendant_birth_year INTEGER,
    descendant_death_year INTEGER,
    generation_from_ancestor INTEGER NOT NULL, -- 1=child, 2=grandchild, etc.
    relationship_path TEXT, -- e.g., "child → grandchild → great-grandchild"
    parent_descendant_id INTEGER REFERENCES enslaved_descendants_suspected(id), -- Forms tree structure

    -- Genealogy proof (for internal verification)
    familysearch_person_id VARCHAR(100),
    genealogy_proof_urls TEXT[],
    source_documents TEXT[], -- ["Freedmen's Bureau Record", "1870 Census", etc.]
    source_document_paths TEXT[], -- S3 paths or URLs

    -- Confidence assessment
    status VARCHAR(50) DEFAULT 'suspected',
    -- Values: 'suspected', 'researching', 'probable', 'confirmed_lineage'
    confidence_score DECIMAL(3,2), -- 0.00-1.00
    confidence_factors JSONB, -- {"freedmens_bureau_match": 0.9, "census_1870": 0.8, etc.}

    -- Privacy protection
    is_living BOOLEAN DEFAULT true,
    estimated_living_probability DECIMAL(3,2),
    privacy_notes TEXT,

    -- Research tracking
    discovered_via VARCHAR(100), -- 'familysearch_api', 'freedmens_bureau', 'census_1870', 'manual'
    discovery_date DATE,
    researched_by VARCHAR(255),
    research_notes TEXT,
    last_verified_date DATE,

    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT valid_generation CHECK (generation_from_ancestor > 0),
    CONSTRAINT valid_confidence CHECK (confidence_score >= 0 AND confidence_score <= 1.00)
);

CREATE INDEX idx_eds_enslaved_id ON enslaved_descendants_suspected(enslaved_person_id);
CREATE INDEX idx_eds_enslaved_name ON enslaved_descendants_suspected(enslaved_name);
CREATE INDEX idx_eds_enslaver_id ON enslaved_descendants_suspected(enslaver_id);
CREATE INDEX idx_eds_generation ON enslaved_descendants_suspected(generation_from_ancestor);
CREATE INDEX idx_eds_is_living ON enslaved_descendants_suspected(is_living);
CREATE INDEX idx_eds_status ON enslaved_descendants_suspected(status);
CREATE INDEX idx_eds_confidence ON enslaved_descendants_suspected(confidence_score);
CREATE INDEX idx_eds_familysearch_id ON enslaved_descendants_suspected(familysearch_person_id);
CREATE INDEX idx_eds_parent_id ON enslaved_descendants_suspected(parent_descendant_id);

-- Table 2: Confirmed Enslaved Descendants (Public - Opt-In)
-- Descendants who have opted in and been verified
-- PUBLIC: Can be shown in listings (with consent)
CREATE TABLE IF NOT EXISTS enslaved_descendants_confirmed (
    id SERIAL PRIMARY KEY,

    -- Link back to suspected record (if came from research)
    suspected_descendant_id INTEGER REFERENCES enslaved_descendants_suspected(id),

    -- Link to enslaved ancestor
    enslaved_person_id INTEGER REFERENCES canonical_persons(id),
    enslaved_name VARCHAR(500) NOT NULL,

    -- Verified descendant information
    descendant_full_name VARCHAR(500) NOT NULL,
    descendant_preferred_name VARCHAR(255),
    descendant_email VARCHAR(255),
    descendant_phone VARCHAR(50),
    descendant_wallet_address VARCHAR(100), -- For receiving payments

    generation_from_ancestor INTEGER NOT NULL,
    relationship_path TEXT NOT NULL,

    -- Verification documents (REQUIRED)
    familysearch_person_id VARCHAR(100) NOT NULL,
    verification_documents TEXT[] NOT NULL,
    verification_document_paths TEXT[],
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

    -- Credit claim information
    claim_status VARCHAR(50) DEFAULT 'pending',
    -- Values: 'pending', 'filed', 'under_review', 'approved', 'partial_paid', 'fully_paid'
    claim_notes TEXT,

    -- Payment tracking (RECEIVING payments, not making them)
    total_credits_owed NUMERIC(20,2) DEFAULT 0, -- Calculated from enslaved ancestor's labor
    total_received NUMERIC(20,2) DEFAULT 0,
    last_payment_date TIMESTAMP,
    payment_history JSONB, -- Array of payment records

    -- Account status
    account_status VARCHAR(50) DEFAULT 'active',
    account_notes TEXT,

    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT unique_confirmed_enslaved_descendant UNIQUE(enslaved_person_id, descendant_email),
    CONSTRAINT valid_verification_status CHECK (
        verification_status IN ('pending', 'under_review', 'approved', 'rejected', 'needs_more_info')
    )
);

CREATE INDEX idx_edc_enslaved_id ON enslaved_descendants_confirmed(enslaved_person_id);
CREATE INDEX idx_edc_email ON enslaved_descendants_confirmed(descendant_email);
CREATE INDEX idx_edc_wallet ON enslaved_descendants_confirmed(descendant_wallet_address);
CREATE INDEX idx_edc_verification_status ON enslaved_descendants_confirmed(verification_status);
CREATE INDEX idx_edc_claim_status ON enslaved_descendants_confirmed(claim_status);
CREATE INDEX idx_edc_familysearch_id ON enslaved_descendants_confirmed(familysearch_person_id);

-- Table 3: Enslaved Credit Calculations
-- Calculates what is OWED to descendants based on enslaved ancestor's stolen labor
CREATE TABLE IF NOT EXISTS enslaved_credit_calculations (
    id SERIAL PRIMARY KEY,

    -- Links
    confirmed_descendant_id INTEGER REFERENCES enslaved_descendants_confirmed(id) ON DELETE CASCADE,
    enslaved_person_id INTEGER REFERENCES canonical_persons(id) NOT NULL,

    -- Enslaved person details
    enslaved_name VARCHAR(500) NOT NULL,
    years_enslaved INTEGER, -- Estimated years of unpaid labor
    start_year INTEGER, -- First documented year of enslavement
    end_year INTEGER, -- Emancipation or death

    -- Labor value calculation
    labor_type VARCHAR(100), -- 'field', 'domestic', 'skilled', 'unknown'
    annual_labor_value_1860 NUMERIC(10,2), -- Value in 1860 dollars
    total_labor_value_1860 NUMERIC(20,2), -- years_enslaved * annual_value

    -- Compound interest to present
    interest_rate DECIMAL(6,4) DEFAULT 0.02, -- 2% annual (conservative)
    years_of_interest INTEGER, -- From end_year to present
    compound_factor NUMERIC(10,4), -- (1 + rate)^years

    -- Final amounts
    principal_owed NUMERIC(20,2) NOT NULL, -- Original labor value
    interest_owed NUMERIC(20,2) DEFAULT 0,
    total_credit_owed NUMERIC(20,2) NOT NULL,

    -- Distribution among descendants
    share_percentage DECIMAL(5,4) DEFAULT 1.0, -- 1.0 = sole heir, 0.5 = split with sibling
    share_amount NUMERIC(20,2) NOT NULL, -- total_credit_owed * share_percentage

    -- Calculation metadata
    calculation_method VARCHAR(100), -- 'standard_labor_value', 'skilled_labor', 'custom'
    calculation_date DATE DEFAULT CURRENT_DATE,
    calculation_notes TEXT,

    -- Payment tracking
    amount_received NUMERIC(20,2) DEFAULT 0,
    amount_remaining NUMERIC(20,2) NOT NULL,
    payment_percentage DECIMAL(5,2) GENERATED ALWAYS AS
        (CASE WHEN share_amount > 0
         THEN (amount_received / share_amount) * 100
         ELSE 0 END) STORED,

    -- Source documentation
    source_documents TEXT[],
    enslaver_documented BOOLEAN DEFAULT false,
    labor_type_documented BOOLEAN DEFAULT false,

    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ecc_descendant ON enslaved_credit_calculations(confirmed_descendant_id);
CREATE INDEX idx_ecc_enslaved_id ON enslaved_credit_calculations(enslaved_person_id);
CREATE INDEX idx_ecc_amount_remaining ON enslaved_credit_calculations(amount_remaining);

-- Table 4: WikiTree Search Queue (for background processing)
-- Lightweight table for batch WikiTree searches
CREATE TABLE IF NOT EXISTS wikitree_search_queue (
    id SERIAL PRIMARY KEY,

    -- Person to search for
    person_id INTEGER REFERENCES canonical_persons(id),
    person_name VARCHAR(500) NOT NULL,
    person_type VARCHAR(50) NOT NULL, -- 'enslaver', 'enslaved', 'freedperson'

    -- Search parameters
    birth_year INTEGER,
    death_year INTEGER,
    primary_state VARCHAR(100),
    primary_county VARCHAR(100),

    -- Queue status
    status VARCHAR(50) DEFAULT 'pending',
    -- Values: 'pending', 'searching', 'found', 'not_found', 'multiple_matches', 'error'
    priority INTEGER DEFAULT 5, -- 1=highest, 10=lowest

    -- Results
    wikitree_id VARCHAR(100), -- e.g., "Hopewell-183"
    wikitree_url TEXT,
    match_confidence DECIMAL(3,2),
    multiple_candidates JSONB, -- If multiple possible matches

    -- Processing
    attempts INTEGER DEFAULT 0,
    last_attempt TIMESTAMP,
    next_attempt TIMESTAMP DEFAULT NOW(),
    error_message TEXT,

    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,

    CONSTRAINT valid_priority CHECK (priority BETWEEN 1 AND 10)
);

CREATE INDEX idx_wsq_status ON wikitree_search_queue(status);
CREATE INDEX idx_wsq_priority ON wikitree_search_queue(priority);
CREATE INDEX idx_wsq_next_attempt ON wikitree_search_queue(next_attempt);
CREATE INDEX idx_wsq_person_id ON wikitree_search_queue(person_id);
CREATE INDEX idx_wsq_person_type ON wikitree_search_queue(person_type);

-- View: Enslaved Descendants with Outstanding Credits
CREATE OR REPLACE VIEW enslaved_descendants_with_credits AS
SELECT
    edc.id as descendant_id,
    edc.descendant_full_name,
    edc.descendant_preferred_name,
    edc.enslaved_name,
    edc.generation_from_ancestor,
    edc.verification_status,
    edc.claim_status,
    edc.consent_to_public_listing,

    ecc.total_credit_owed,
    ecc.share_amount,
    ecc.amount_received,
    ecc.amount_remaining,
    ecc.payment_percentage,

    edc.descendant_email,
    edc.descendant_wallet_address
FROM enslaved_descendants_confirmed edc
JOIN enslaved_credit_calculations ecc ON edc.id = ecc.confirmed_descendant_id
WHERE edc.verification_status = 'approved'
  AND edc.account_status = 'active'
  AND ecc.amount_remaining > 0
ORDER BY ecc.total_credit_owed DESC;

-- View: WikiTree Search Progress
CREATE OR REPLACE VIEW wikitree_search_progress AS
SELECT
    person_type,
    status,
    COUNT(*) as count,
    ROUND(AVG(match_confidence)::numeric, 2) as avg_confidence
FROM wikitree_search_queue
GROUP BY person_type, status
ORDER BY person_type, status;

-- View: Combined Credit/Debt Summary
CREATE OR REPLACE VIEW reparations_summary AS
SELECT
    'credits_owed_to_enslaved_descendants' as category,
    COUNT(DISTINCT edc.id) as verified_claimants,
    COALESCE(SUM(ecc.total_credit_owed), 0) as total_amount,
    COALESCE(SUM(ecc.amount_received), 0) as amount_paid,
    COALESCE(SUM(ecc.amount_remaining), 0) as amount_outstanding
FROM enslaved_descendants_confirmed edc
LEFT JOIN enslaved_credit_calculations ecc ON edc.id = ecc.confirmed_descendant_id
WHERE edc.verification_status = 'approved'

UNION ALL

SELECT
    'debts_owed_by_slaveholder_descendants' as category,
    COUNT(DISTINCT sodc.id) as verified_claimants,
    COALESCE(SUM(dda.total_current_debt), 0) as total_amount,
    COALESCE(SUM(dda.amount_paid), 0) as amount_paid,
    COALESCE(SUM(dda.amount_remaining), 0) as amount_outstanding
FROM slave_owner_descendants_confirmed sodc
LEFT JOIN descendant_debt_assignments dda ON sodc.id = dda.confirmed_descendant_id
WHERE sodc.verification_status = 'approved';

-- Comments
COMMENT ON TABLE enslaved_descendants_suspected IS 'PRIVATE TABLE: Genealogically-traced descendants of enslaved people who have NOT opted in. Never expose publicly.';

COMMENT ON TABLE enslaved_descendants_confirmed IS 'PUBLIC TABLE (with consent): Descendants of enslaved people who have opted in and been verified. They are OWED credits.';

COMMENT ON TABLE enslaved_credit_calculations IS 'Calculates reparations OWED TO verified descendants based on their enslaved ancestors stolen labor value.';

COMMENT ON TABLE wikitree_search_queue IS 'Lightweight queue for background WikiTree searches. Designed for continuous low-priority processing.';

COMMENT ON VIEW reparations_summary IS 'Combined view showing both credits owed to enslaved descendants and debts owed by slaveholder descendants.';
