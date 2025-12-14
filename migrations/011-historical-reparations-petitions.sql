-- Migration 011: Historical Reparations Petitions System
-- Purpose: Track reparations petitions, awards, payments, and broken promises
-- Example: Belinda Sutton's 1783 petition - awarded but only 23% paid

-- =====================================================================
-- CORE CONCEPT: Track the gap between what was PROMISED vs what was PAID
-- =====================================================================

-- Table 1: Reparations Petitions and Awards
-- Records petitions filed by enslaved people or their descendants
CREATE TABLE IF NOT EXISTS historical_reparations_petitions (
    id SERIAL PRIMARY KEY,
    
    -- Petitioner (enslaved person or descendant)
    petitioner_name VARCHAR(500) NOT NULL,
    petitioner_enslaved_id VARCHAR(255) REFERENCES enslaved_individuals(enslaved_id),
    petitioner_relationship VARCHAR(100), -- 'self', 'child', 'grandchild', 'descendant'
    
    -- Who enslaved them (creates link to debt system)
    enslaver_name VARCHAR(500),
    enslaver_individual_id VARCHAR(255) REFERENCES individuals(individual_id),
    
    -- Petition details
    petition_date DATE NOT NULL,
    petition_number VARCHAR(100), -- Official filing number if any
    petition_title TEXT,
    petition_summary TEXT,
    petition_full_text TEXT, -- OCR text from petition document
    
    -- What was requested
    amount_requested NUMERIC(20,2),
    currency VARCHAR(10) DEFAULT 'USD',
    request_type VARCHAR(50), -- 'lump_sum', 'annual_pension', 'land_grant', 'back_wages'
    years_of_service INTEGER, -- Years enslaved (for calculating back wages)
    
    -- Authority petitioned
    petitioned_authority VARCHAR(500), -- 'Massachusetts General Court', 'US Congress', 'State Legislature'
    jurisdiction VARCHAR(100), -- 'Massachusetts', 'Federal', 'Virginia', etc.
    case_reference VARCHAR(255), -- Court case number or legislative reference
    
    -- Outcome
    petition_status VARCHAR(50) NOT NULL DEFAULT 'pending', 
    -- Options: 'granted', 'denied', 'pending', 'ignored', 'partially_granted'
    decision_date DATE,
    decision_text TEXT,
    
    -- If granted - what was awarded
    amount_awarded NUMERIC(20,2),
    awarded_currency VARCHAR(10),
    award_terms TEXT, -- e.g., "£15 annually plus £12 back payment"
    award_duration VARCHAR(100), -- 'lifetime', 'one_time', '10 years', 'indefinite'
    award_conditions TEXT, -- Any conditions attached to the award
    
    -- Modern value calculations
    modern_value_requested NUMERIC(20,2), -- Inflation-adjusted request
    modern_value_awarded NUMERIC(20,2), -- Inflation-adjusted award
    
    -- Source documents
    primary_source_url TEXT,
    archive_source VARCHAR(500),
    archive_reference VARCHAR(255),
    
    -- Related documents in S3
    document_path TEXT, -- Path in S3: multi-purpose-evidence/{case-name}/
    
    -- Verification
    verified BOOLEAN DEFAULT FALSE,
    verified_by VARCHAR(255),
    verification_date TIMESTAMP,
    
    -- Metadata
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_hrp_petitioner_name ON historical_reparations_petitions(petitioner_name);
CREATE INDEX idx_hrp_petitioner_enslaved_id ON historical_reparations_petitions(petitioner_enslaved_id);
CREATE INDEX idx_hrp_enslaver_name ON historical_reparations_petitions(enslaver_name);
CREATE INDEX idx_hrp_enslaver_individual_id ON historical_reparations_petitions(enslaver_individual_id);
CREATE INDEX idx_hrp_petition_status ON historical_reparations_petitions(petition_status);
CREATE INDEX idx_hrp_petition_date ON historical_reparations_petitions(petition_date);
CREATE INDEX idx_hrp_jurisdiction ON historical_reparations_petitions(jurisdiction);

-- Table 2: Actual Payments Made on Petitions
-- Tracks every payment (or non-payment) on an awarded petition
CREATE TABLE IF NOT EXISTS historical_reparations_payments (
    id SERIAL PRIMARY KEY,
    
    -- Which petition/award this pays
    petition_id INTEGER REFERENCES historical_reparations_petitions(id) ON DELETE CASCADE,
    
    -- Recipient
    recipient_name VARCHAR(500) NOT NULL,
    recipient_enslaved_id VARCHAR(255) REFERENCES enslaved_individuals(enslaved_id),
    
    -- Payment details
    payment_amount NUMERIC(20,2) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    payment_date DATE,
    payment_year INTEGER,
    
    -- Modern value
    modern_value_estimate NUMERIC(20,2),
    inflation_rate_used DECIMAL(6,4), -- e.g., 0.0234 for 2.34%
    conversion_rate NUMERIC(10,2), -- For historical currency (e.g., GBP to USD)
    
    -- Payment method
    payment_method VARCHAR(100), -- 'cash', 'treasury_warrant', 'land_deed', 'promissory_note'
    payment_record_reference VARCHAR(500), -- Voucher number, warrant number, etc.
    payment_source VARCHAR(500), -- 'Isaac Royall Estate', 'State Treasury', 'Federal Fund'
    
    -- Verification
    payment_verified BOOLEAN DEFAULT FALSE,
    verification_source TEXT,
    document_proof_url TEXT,
    
    -- Was this the full amount due, or partial?
    payment_type VARCHAR(50), -- 'full', 'partial', 'installment', 'back_payment'
    amount_due NUMERIC(20,2), -- What should have been paid
    shortfall NUMERIC(20,2), -- Difference if underpaid
    
    -- Metadata
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_hrpay_petition_id ON historical_reparations_payments(petition_id);
CREATE INDEX idx_hrpay_recipient_name ON historical_reparations_payments(recipient_name);
CREATE INDEX idx_hrpay_recipient_enslaved_id ON historical_reparations_payments(recipient_enslaved_id);
CREATE INDEX idx_hrpay_payment_date ON historical_reparations_payments(payment_date);
CREATE INDEX idx_hrpay_payment_year ON historical_reparations_payments(payment_year);
CREATE INDEX idx_hrpay_payment_verified ON historical_reparations_payments(payment_verified);

-- Table 3: Fulfillment Analysis - "Wrap Around Check"
-- Compares what was PROMISED vs what was actually PAID
CREATE TABLE IF NOT EXISTS petition_fulfillment_analysis (
    id SERIAL PRIMARY KEY,
    
    petition_id INTEGER REFERENCES historical_reparations_petitions(id) ON DELETE CASCADE UNIQUE,
    
    -- What was awarded
    total_amount_awarded NUMERIC(20,2),
    awarded_currency VARCHAR(10),
    award_duration_years INTEGER, -- For annual payments
    expected_payment_count INTEGER, -- How many payments should have been made
    expected_total_payments NUMERIC(20,2), -- Total expected if all payments made
    
    -- What was actually paid
    total_amount_paid NUMERIC(20,2),
    payment_count INTEGER DEFAULT 0,
    first_payment_date DATE,
    last_payment_date DATE,
    
    -- The gap (THE CRITICAL MEASURE)
    amount_unpaid NUMERIC(20,2),
    fulfillment_percentage DECIMAL(5,2), -- 0-100%
    payments_missed INTEGER, -- How many expected payments never came
    
    -- Modern values
    unpaid_modern_value NUMERIC(20,2), -- What's still owed in today's dollars
    paid_modern_value NUMERIC(20,2), -- What was actually paid in today's dollars
    
    -- Analysis
    fulfillment_status VARCHAR(50), 
    -- Options: 'fully_paid', 'partially_paid', 'never_paid', 'payments_stopped', 'abandoned'
    
    failure_reason TEXT, -- Why payments stopped (e.g., "Estate depleted", "Petitioner died", "Ignored")
    years_until_payments_stopped INTEGER, -- How long did payments continue?
    
    -- This is ADDITIONAL debt (broken promise penalty)
    broken_promise_penalty NUMERIC(20,2), -- Penalty for breach of governmental promise
    compound_interest_owed NUMERIC(20,2), -- Interest on unpaid amounts
    total_additional_debt NUMERIC(20,2), -- unpaid + penalty + interest
    
    -- Timeline
    petition_filed_date DATE,
    award_granted_date DATE,
    payments_started_date DATE,
    payments_stopped_date DATE,
    petitioner_death_date DATE,
    
    -- Metadata
    calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    notes TEXT
);

CREATE INDEX idx_pfa_petition_id ON petition_fulfillment_analysis(petition_id);
CREATE INDEX idx_pfa_fulfillment_status ON petition_fulfillment_analysis(fulfillment_status);
CREATE INDEX idx_pfa_fulfillment_percentage ON petition_fulfillment_analysis(fulfillment_percentage);
CREATE INDEX idx_pfa_amount_unpaid ON petition_fulfillment_analysis(amount_unpaid);

-- Table 4: Petition Documents
-- Links petition documents to S3 storage and provides multi-purpose tagging
CREATE TABLE IF NOT EXISTS petition_documents (
    id SERIAL PRIMARY KEY,
    
    -- Link to petition
    petition_id INTEGER REFERENCES historical_reparations_petitions(id) ON DELETE CASCADE,
    
    -- Document classification
    document_type VARCHAR(50), 
    -- Options: 'original_petition', 'legislative_response', 'court_order', 
    --          'payment_voucher', 'follow_up_petition', 'denial_letter', 'historical_analysis'
    
    document_title VARCHAR(500),
    document_date DATE,
    document_sequence INTEGER DEFAULT 1, -- For ordering multiple petitions
    
    -- File storage (S3)
    filename VARCHAR(500) NOT NULL,
    file_path TEXT NOT NULL, -- Full S3 path
    file_size BIGINT,
    mime_type VARCHAR(100),
    
    -- IPFS immutability proof
    ipfs_hash VARCHAR(255),
    sha256_hash VARCHAR(64),
    ipfs_gateway_url TEXT,
    ipfs_pinned BOOLEAN DEFAULT FALSE,
    
    -- OCR if applicable
    ocr_text TEXT,
    ocr_confidence DECIMAL(3,2),
    ocr_service VARCHAR(50),
    ocr_processed_at TIMESTAMP,
    
    -- Source and authenticity
    archive_source VARCHAR(500), -- 'Massachusetts State Archives', 'Royall House Museum'
    archive_reference VARCHAR(255), -- Catalog number, box/folder
    original_url TEXT,
    digitized_by VARCHAR(255),
    
    authenticity_verified BOOLEAN DEFAULT FALSE,
    verified_by VARCHAR(255),
    verification_date TIMESTAMP,
    
    -- Multi-purpose evidence flags
    -- This document may serve multiple purposes:
    proves_enslavement BOOLEAN DEFAULT FALSE, -- Evidence of ownership
    proves_debt_request BOOLEAN DEFAULT FALSE, -- Petition for reparations
    proves_award_granted BOOLEAN DEFAULT FALSE, -- Government acknowledgment
    proves_payment_made BOOLEAN DEFAULT FALSE, -- Actual payment record
    proves_payment_failure BOOLEAN DEFAULT FALSE, -- Evidence payments stopped
    proves_broken_promise BOOLEAN DEFAULT FALSE, -- Systematic abandonment
    
    -- Cross-reference to main documents table (if applicable)
    document_id VARCHAR(255), -- Links to documents.document_id if also stored there
    
    -- Metadata
    notes TEXT,
    uploaded_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_pd_petition_id ON petition_documents(petition_id);
CREATE INDEX idx_pd_document_type ON petition_documents(document_type);
CREATE INDEX idx_pd_document_date ON petition_documents(document_date);
CREATE INDEX idx_pd_proves_enslavement ON petition_documents(proves_enslavement);
CREATE INDEX idx_pd_proves_broken_promise ON petition_documents(proves_broken_promise);
CREATE INDEX idx_pd_ipfs_hash ON petition_documents(ipfs_hash);

-- =====================================================================
-- VIEWS FOR ANALYSIS
-- =====================================================================

-- View: Broken Promises Summary
-- Shows all cases where payments were promised but not delivered
CREATE VIEW broken_promises_summary AS
SELECT 
    hrp.id as petition_id,
    hrp.petitioner_name,
    hrp.enslaver_name,
    hrp.petition_date,
    hrp.petition_status,
    hrp.amount_awarded,
    hrp.awarded_currency,
    hrp.award_duration,
    
    pfa.total_amount_paid,
    pfa.amount_unpaid,
    pfa.fulfillment_percentage,
    pfa.fulfillment_status,
    pfa.failure_reason,
    pfa.unpaid_modern_value,
    pfa.broken_promise_penalty,
    pfa.total_additional_debt,
    
    hrp.petitioned_authority,
    hrp.jurisdiction
FROM historical_reparations_petitions hrp
LEFT JOIN petition_fulfillment_analysis pfa ON hrp.id = pfa.petition_id
WHERE hrp.petition_status IN ('granted', 'partially_granted')
  AND pfa.fulfillment_status IN ('partially_paid', 'payments_stopped', 'abandoned')
ORDER BY pfa.amount_unpaid DESC;

-- View: Successfully Paid Reparations
-- Shows the rare cases where payments were actually made in full
CREATE VIEW successful_reparations_payments AS
SELECT 
    hrp.id as petition_id,
    hrp.petitioner_name,
    hrp.enslaver_name,
    hrp.petition_date,
    hrp.amount_awarded,
    hrp.awarded_currency,
    
    pfa.total_amount_paid,
    pfa.payment_count,
    pfa.fulfillment_percentage,
    pfa.paid_modern_value,
    
    hrp.petitioned_authority,
    hrp.jurisdiction
FROM historical_reparations_petitions hrp
LEFT JOIN petition_fulfillment_analysis pfa ON hrp.id = pfa.petition_id
WHERE hrp.petition_status = 'granted'
  AND pfa.fulfillment_status = 'fully_paid'
  AND pfa.fulfillment_percentage >= 95.0
ORDER BY pfa.paid_modern_value DESC;

-- View: Petition Statistics by Jurisdiction
CREATE VIEW petition_stats_by_jurisdiction AS
SELECT 
    jurisdiction,
    COUNT(*) as total_petitions,
    SUM(CASE WHEN petition_status = 'granted' THEN 1 ELSE 0 END) as granted_count,
    SUM(CASE WHEN petition_status = 'denied' THEN 1 ELSE 0 END) as denied_count,
    SUM(CASE WHEN petition_status = 'ignored' THEN 1 ELSE 0 END) as ignored_count,
    
    AVG(pfa.fulfillment_percentage) as avg_fulfillment_rate,
    SUM(pfa.unpaid_modern_value) as total_unpaid_modern_value,
    SUM(pfa.broken_promise_penalty) as total_broken_promise_penalties
FROM historical_reparations_petitions hrp
LEFT JOIN petition_fulfillment_analysis pfa ON hrp.id = pfa.petition_id
GROUP BY jurisdiction
ORDER BY total_petitions DESC;

-- View: Comprehensive Debt Including Broken Promises
-- Shows total debt owed = original debt + broken promises
CREATE VIEW comprehensive_debt_with_broken_promises AS
SELECT 
    i.individual_id,
    i.full_name as enslaver_name,
    i.total_enslaved,
    i.total_reparations as original_calculated_debt,
    
    -- Add broken promise penalties
    COALESCE(SUM(pfa.unpaid_modern_value), 0) as unpaid_awarded_reparations,
    COALESCE(SUM(pfa.broken_promise_penalty), 0) as broken_promise_penalties,
    COALESCE(SUM(pfa.compound_interest_owed), 0) as interest_on_unpaid,
    
    -- Total comprehensive debt
    i.total_reparations + 
    COALESCE(SUM(pfa.unpaid_modern_value), 0) + 
    COALESCE(SUM(pfa.broken_promise_penalty), 0) +
    COALESCE(SUM(pfa.compound_interest_owed), 0) as total_comprehensive_debt,
    
    COUNT(DISTINCT hrp.id) as broken_promises_count
FROM individuals i
LEFT JOIN historical_reparations_petitions hrp ON i.individual_id = hrp.enslaver_individual_id
LEFT JOIN petition_fulfillment_analysis pfa ON hrp.id = pfa.petition_id
WHERE i.total_enslaved > 0
GROUP BY i.individual_id, i.full_name, i.total_enslaved, i.total_reparations
ORDER BY total_comprehensive_debt DESC;

-- =====================================================================
-- HELPER FUNCTIONS
-- =====================================================================

-- Function: Calculate fulfillment analysis for a petition
CREATE OR REPLACE FUNCTION calculate_petition_fulfillment(p_petition_id INTEGER)
RETURNS void AS $$
DECLARE
    v_petition RECORD;
    v_total_paid NUMERIC(20,2);
    v_payment_count INTEGER;
    v_first_payment DATE;
    v_last_payment DATE;
    v_expected_total NUMERIC(20,2);
    v_expected_count INTEGER;
    v_fulfillment_pct DECIMAL(5,2);
    v_status VARCHAR(50);
BEGIN
    -- Get petition details
    SELECT * INTO v_petition 
    FROM historical_reparations_petitions 
    WHERE id = p_petition_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Petition ID % not found', p_petition_id;
    END IF;
    
    -- Calculate payments made
    SELECT 
        COALESCE(SUM(payment_amount), 0),
        COUNT(*),
        MIN(payment_date),
        MAX(payment_date)
    INTO v_total_paid, v_payment_count, v_first_payment, v_last_payment
    FROM historical_reparations_payments
    WHERE petition_id = p_petition_id;
    
    -- Calculate expected payments based on award terms
    -- This is simplified - real calculation would parse award_duration
    IF v_petition.award_duration = 'lifetime' THEN
        -- Estimate based on historical life expectancy after petition
        v_expected_count := 7; -- Rough estimate
        v_expected_total := v_petition.amount_awarded * v_expected_count;
    ELSIF v_petition.award_duration = 'one_time' THEN
        v_expected_count := 1;
        v_expected_total := v_petition.amount_awarded;
    ELSE
        -- Default: annual payment
        v_expected_count := 10; -- Rough estimate
        v_expected_total := v_petition.amount_awarded * v_expected_count;
    END IF;
    
    -- Calculate fulfillment percentage
    IF v_expected_total > 0 THEN
        v_fulfillment_pct := (v_total_paid / v_expected_total) * 100;
    ELSE
        v_fulfillment_pct := 0;
    END IF;
    
    -- Determine status
    IF v_fulfillment_pct >= 95 THEN
        v_status := 'fully_paid';
    ELSIF v_fulfillment_pct > 0 AND v_payment_count > 0 THEN
        IF v_last_payment < v_petition.petition_date + INTERVAL '3 years' THEN
            v_status := 'payments_stopped';
        ELSE
            v_status := 'partially_paid';
        END IF;
    ELSIF v_petition.petition_status = 'granted' THEN
        v_status := 'never_paid';
    ELSE
        v_status := 'abandoned';
    END IF;
    
    -- Insert or update fulfillment analysis
    INSERT INTO petition_fulfillment_analysis (
        petition_id,
        total_amount_awarded,
        expected_total_payments,
        expected_payment_count,
        total_amount_paid,
        payment_count,
        first_payment_date,
        last_payment_date,
        amount_unpaid,
        fulfillment_percentage,
        fulfillment_status,
        unpaid_modern_value,
        broken_promise_penalty
    ) VALUES (
        p_petition_id,
        v_petition.amount_awarded,
        v_expected_total,
        v_expected_count,
        v_total_paid,
        v_payment_count,
        v_first_payment,
        v_last_payment,
        v_expected_total - v_total_paid,
        v_fulfillment_pct,
        v_status,
        (v_expected_total - v_total_paid) * 850, -- Rough modern value conversion
        (v_expected_total - v_total_paid) * 850 * 0.5 -- 50% penalty
    )
    ON CONFLICT (petition_id) DO UPDATE SET
        total_amount_paid = EXCLUDED.total_amount_paid,
        payment_count = EXCLUDED.payment_count,
        last_payment_date = EXCLUDED.last_payment_date,
        amount_unpaid = EXCLUDED.amount_unpaid,
        fulfillment_percentage = EXCLUDED.fulfillment_percentage,
        fulfillment_status = EXCLUDED.fulfillment_status,
        updated_at = CURRENT_TIMESTAMP;
        
END;
$$ LANGUAGE plpgsql;

-- Trigger: Auto-update fulfillment analysis when payments change
CREATE OR REPLACE FUNCTION trigger_update_fulfillment()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM calculate_petition_fulfillment(NEW.petition_id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_fulfillment_on_payment
AFTER INSERT OR UPDATE ON historical_reparations_payments
FOR EACH ROW
EXECUTE FUNCTION trigger_update_fulfillment();

-- =====================================================================
-- COMMENTS
-- =====================================================================

COMMENT ON TABLE historical_reparations_petitions IS 'Tracks petitions for reparations filed by enslaved people or descendants. Records both the request and the governmental response.';
COMMENT ON TABLE historical_reparations_payments IS 'Records actual payments made (or not made) on awarded reparations petitions. Critical for tracking broken promises.';
COMMENT ON TABLE petition_fulfillment_analysis IS 'Analyzes the gap between promised reparations and actual payments. The "wrap around check" that proves systemic failure.';
COMMENT ON TABLE petition_documents IS 'Multi-purpose documents that prove enslavement, debt, awards, payments, and broken promises simultaneously.';

COMMENT ON COLUMN petition_fulfillment_analysis.broken_promise_penalty IS 'Additional debt incurred when government awards reparations but fails to pay. Penalizes breach of trust.';
COMMENT ON COLUMN petition_fulfillment_analysis.fulfillment_percentage IS 'Percentage of promised payments actually made. <100% = broken promise.';

-- =====================================================================
-- INITIAL DATA: Belinda Sutton Case (Example)
-- =====================================================================
-- This will be populated via the PetitionTracker service
-- See: src/services/reparations/PetitionTracker.js
