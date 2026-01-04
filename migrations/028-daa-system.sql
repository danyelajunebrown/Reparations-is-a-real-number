-- Migration 028: Debt Acknowledgment Agreement (DAA) System
-- Date: December 31, 2025
-- Purpose: Track voluntary debt acknowledgments by slaveholder descendants
--          Legal mechanism based on Belinda Sutton (1783) precedent
--
-- Legal Framework:
-- - Belinda Sutton (1783): First successful reparations claim via seized loyalist estate
-- - Farmer-Paellmann v. Aetna (2002): Consumer fraud/unjust enrichment survived dismissal
-- - Voluntary acknowledgment bypasses statute of limitations and sovereign immunity
--
-- Academic Sources:
-- - Ager/Boustan/Eriksson (AER 2021): 2.5x wealth multiplier for slaveholders
-- - Darity & Mullen "From Here to Equality" (2020): Comprehensive framework
-- - Dagan (BU Law Review 2004): Unjust enrichment/disgorgement theory
-- - Posner & Vermeule (Columbia Law Review 2003): Reparations design

-- ============================================================================
-- SECTION 1: LEGAL PRECEDENTS
-- Store case law cited in DAA documents
-- ============================================================================

CREATE TABLE IF NOT EXISTS daa_legal_precedents (
    precedent_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Case identification
    case_name VARCHAR(500) NOT NULL,
    case_year INTEGER NOT NULL,
    jurisdiction VARCHAR(200),
    court VARCHAR(300),
    citation TEXT,
    
    -- Legal significance
    outcome VARCHAR(100),              -- 'successful', 'dismissed', 'settled', 'partial_victory'
    legal_mechanism VARCHAR(200),      -- 'seized_estate', 'unjust_enrichment', 'consumer_fraud'
    key_holding TEXT,                  -- Main legal principle established
    
    -- Relevance to DAA system
    precedent_type VARCHAR(100),       -- 'reparations_claim', 'statute_limitations', 'unjust_enrichment'
    citation_text TEXT,                -- Exact text to use in DAA documents
    
    -- Source documentation
    source_url TEXT,
    archive_reference TEXT,
    full_text_ipfs_hash TEXT,
    
    -- Metadata
    added_by VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_daa_precedents_year ON daa_legal_precedents(case_year);
CREATE INDEX idx_daa_precedents_type ON daa_legal_precedents(precedent_type);

-- ============================================================================
-- SECTION 2: ACADEMIC SOURCES
-- Store research supporting DAA calculation methodology
-- ============================================================================

CREATE TABLE IF NOT EXISTS daa_academic_sources (
    source_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Publication details
    authors TEXT[] NOT NULL,
    title TEXT NOT NULL,
    publication VARCHAR(500),
    publication_year INTEGER NOT NULL,
    publication_type VARCHAR(100),     -- 'journal_article', 'book', 'working_paper', 'law_review'
    
    -- Academic citation
    full_citation TEXT,
    doi VARCHAR(200),
    url TEXT,
    
    -- Key findings for DAA methodology
    key_finding TEXT,
    methodology_support VARCHAR(500),   -- 'wealth_multiplier', 'interest_rate', 'inflation_adjustment'
    quantitative_result DECIMAL(10,4), -- e.g., 2.5 for wealth multiplier
    
    -- Usage in DAA
    citation_text TEXT,                -- How to cite in DAA documents
    supports_calculation_step VARCHAR(200),
    
    -- Metadata
    added_by VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_daa_academic_year ON daa_academic_sources(publication_year);
CREATE INDEX idx_daa_academic_methodology ON daa_academic_sources(methodology_support);

-- ============================================================================
-- SECTION 3: DEBT ACKNOWLEDGMENT AGREEMENTS (Main Table)
-- ============================================================================

CREATE TABLE IF NOT EXISTS debt_acknowledgment_agreements (
    daa_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Agreement identification
    agreement_number VARCHAR(50) UNIQUE NOT NULL,  -- e.g., "DAA-2025-001"
    
    -- Acknowledger (slaveholder descendant)
    acknowledger_name VARCHAR(255) NOT NULL,
    acknowledger_email VARCHAR(255),
    acknowledger_address JSONB,        -- Full mailing address for petitions
    generation_from_slaveholder INTEGER,
    genealogy_proof_ipfs_hash TEXT,
    
    -- Slaveholder (ancestor)
    slaveholder_canonical_id INTEGER REFERENCES canonical_persons(id),
    slaveholder_name VARCHAR(255) NOT NULL,
    slaveholder_familysearch_id VARCHAR(50),
    
    -- Primary source documentation
    primary_source_ark TEXT,           -- FamilySearch ARK identifier
    primary_source_archive VARCHAR(500),
    primary_source_reference TEXT,     -- e.g., "LIBER JJ#3, FOLIO 480-481"
    primary_source_date DATE,
    primary_source_type VARCHAR(100),  -- 'will', 'probate', 'deed', 'census'
    
    -- Debt calculation
    total_debt DECIMAL(20,2) NOT NULL,
    calculation_methodology TEXT,
    calculation_breakdown JSONB,       -- Detailed calculation steps
    
    -- Payment terms
    annual_payment DECIMAL(12,2) NOT NULL,
    payment_percentage DECIMAL(5,4) DEFAULT 0.02,  -- 2% of income
    acknowledger_annual_income DECIMAL(12,2),
    
    -- Document management
    document_s3_key TEXT,              -- Unsigned .docx in S3
    signed_document_s3_key TEXT,       -- Signed .docx from DocuSign
    docusign_envelope_id VARCHAR(100),
    
    -- Blockchain integration
    blockchain_record_id INTEGER,      -- ReparationsEscrow.sol record ID
    blockchain_hash TEXT,              -- Transaction hash
    blockchain_network VARCHAR(50),    -- 'mainnet', 'goerli', 'sepolia'
    
    -- Status tracking
    status VARCHAR(50) DEFAULT 'draft', -- 'draft', 'pending_signature', 'signed', 'active', 'fulfilled'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    signed_at TIMESTAMP,
    blockchain_submitted_at TIMESTAMP,
    
    -- Notes
    notes TEXT
);

CREATE INDEX idx_daa_agreement_number ON debt_acknowledgment_agreements(agreement_number);
CREATE INDEX idx_daa_acknowledger ON debt_acknowledgment_agreements(acknowledger_name);
CREATE INDEX idx_daa_slaveholder ON debt_acknowledgment_agreements(slaveholder_canonical_id);
CREATE INDEX idx_daa_status ON debt_acknowledgment_agreements(status);
CREATE INDEX idx_daa_blockchain_id ON debt_acknowledgment_agreements(blockchain_record_id);

-- ============================================================================
-- SECTION 4: ENSLAVED PERSONS (Per DAA)
-- ============================================================================

CREATE TABLE IF NOT EXISTS daa_enslaved_persons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Link to DAA
    daa_id UUID REFERENCES debt_acknowledgment_agreements(daa_id) ON DELETE CASCADE,
    
    -- Enslaved person details
    enslaved_name VARCHAR(255) NOT NULL,
    enslaved_canonical_id INTEGER REFERENCES canonical_persons(id),
    
    -- Enslavement details
    years_enslaved INTEGER NOT NULL,
    start_year INTEGER NOT NULL,
    end_year INTEGER,
    
    -- Individual debt calculation
    individual_debt DECIMAL(20,2) NOT NULL,
    base_wage_theft DECIMAL(15,2),
    with_interest DECIMAL(18,2),
    with_wealth_multiplier DECIMAL(20,2),
    modern_value DECIMAL(20,2),
    
    -- Calculation details
    calculation_breakdown JSONB,
    
    -- Additional context
    relationship_to_slaveholder VARCHAR(200),  -- 'bequeathed_to', 'inherited_by', 'owned_directly'
    notes TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_daa_enslaved_daa ON daa_enslaved_persons(daa_id);
CREATE INDEX idx_daa_enslaved_name ON daa_enslaved_persons(enslaved_name);

-- ============================================================================
-- SECTION 5: ANNUAL PETITIONS (Belinda Sutton Model)
-- Track re-petitions to government
-- ============================================================================

CREATE TABLE IF NOT EXISTS daa_annual_petitions (
    petition_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Link to DAA
    daa_id UUID REFERENCES debt_acknowledgment_agreements(daa_id) ON DELETE CASCADE,
    
    -- Petition details
    petition_year INTEGER NOT NULL,
    petition_date DATE NOT NULL,
    
    -- Target government entity
    government_entity VARCHAR(200) NOT NULL,  -- 'U.S. Congress', 'Maryland Legislature', etc.
    recipient_name VARCHAR(300),
    recipient_address JSONB,
    
    -- Delivery tracking
    lob_letter_id VARCHAR(100),        -- Lob.com tracking ID
    tracking_number VARCHAR(100),
    expected_delivery_date DATE,
    delivered_at DATE,
    
    -- Email copy
    email_sent BOOLEAN DEFAULT FALSE,
    email_recipient VARCHAR(255),
    email_sent_at TIMESTAMP,
    
    -- Response tracking
    status VARCHAR(50) DEFAULT 'submitted',  -- 'submitted', 'delivered', 'acknowledged', 'denied', 'no_response'
    response_received_at DATE,
    response_text TEXT,
    
    -- Cost tracking
    physical_mail_cost DECIMAL(6,2),
    
    -- Metadata
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_daa_petitions_daa ON daa_annual_petitions(daa_id);
CREATE INDEX idx_daa_petitions_year ON daa_annual_petitions(petition_year);
CREATE INDEX idx_daa_petitions_status ON daa_annual_petitions(status);

-- ============================================================================
-- SECTION 6: PAYMENTS
-- Track 2% annual income payments
-- ============================================================================

CREATE TABLE IF NOT EXISTS daa_payments (
    payment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Link to DAA
    daa_id UUID REFERENCES debt_acknowledgment_agreements(daa_id) ON DELETE CASCADE,
    
    -- Payment details
    payment_year INTEGER NOT NULL,
    payment_date DATE NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    
    -- Income verification
    acknowledger_income_that_year DECIMAL(12,2),
    income_verification_document TEXT,  -- S3 key or IPFS hash
    
    -- Payment method
    payment_method VARCHAR(100),       -- 'blockchain_escrow', 'direct_transfer', 'check'
    payment_processor VARCHAR(100),    -- 'ethereum', 'stripe', 'paypal', 'bank_transfer'
    
    -- Blockchain tracking
    blockchain_tx_hash TEXT,
    blockchain_network VARCHAR(50),
    blockchain_confirmed_at TIMESTAMP,
    
    -- Distribution to descendants
    distributed BOOLEAN DEFAULT FALSE,
    distribution_date DATE,
    distribution_tx_hashes TEXT[],     -- Multiple txs for multiple descendants
    
    -- Metadata
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_daa_payments_daa ON daa_payments(daa_id);
CREATE INDEX idx_daa_payments_year ON daa_payments(payment_year);
CREATE INDEX idx_daa_payments_blockchain ON daa_payments(blockchain_tx_hash);

-- ============================================================================
-- SECTION 7: SEED LEGAL PRECEDENTS
-- ============================================================================

INSERT INTO daa_legal_precedents (
    case_name, case_year, jurisdiction, outcome, legal_mechanism,
    key_holding, precedent_type, citation_text
) VALUES
(
    'Belinda Sutton Petition',
    1783,
    'Massachusetts',
    'successful',
    'seized_loyalist_estate',
    'First successful reparations claim in America. Sutton successfully petitioned 5 times to receive payment from the estate of her former enslaver, Isaac Royall Jr., after his property was seized as a loyalist estate.',
    'reparations_claim',
    'Belinda Sutton''s successful 1783 petition to the Massachusetts General Court established precedent for persistent re-petition (5 attempts) and payment from seized assets. Key insight: Legal mechanism (targeting estate) > moral argument.'
),
(
    'Farmer-Paellmann v. Aetna (MDL 1491)',
    2002,
    'U.S. District Court, Northern District of Illinois',
    'partial_victory',
    'unjust_enrichment',
    'Consumer fraud and unjust enrichment theories survived initial dismissal motions, establishing that slavery-related corporate debt claims have legal standing under certain frameworks.',
    'unjust_enrichment',
    'In re African-American Slave Descendants Litigation, 304 F. Supp. 2d 1027 (N.D. Ill. 2004). Consumer fraud/unjust enrichment theory survived dismissal, establishing corporations can be held accountable for slavery-related profits.'
)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SECTION 8: SEED ACADEMIC SOURCES
-- ============================================================================

INSERT INTO daa_academic_sources (
    authors, title, publication, publication_year, publication_type,
    key_finding, methodology_support, quantitative_result, citation_text
) VALUES
(
    ARRAY['Ager, Philipp', 'Boustan, Leah Platt', 'Eriksson, Katherine'],
    'The Intergenerational Effects of a Large Wealth Shock: White Southerners After the Civil War',
    'American Economic Review',
    2021,
    'journal_article',
    'Slaveholders recovered wealth within 2 generations despite emancipation, demonstrating 2.5x wealth multiplication effect.',
    'wealth_multiplier',
    2.5,
    'Ager, Boustan & Eriksson (AER 2021) demonstrate slaveholders recovered and multiplied wealth within 2 generations, establishing a 2.5x wealth multiplier for inherited slave-derived wealth.'
),
(
    ARRAY['Darity, William A.', 'Mullen, A. Kirsten'],
    'From Here to Equality: Reparations for Black Americans in the Twenty-First Century',
    'University of North Carolina Press',
    2020,
    'book',
    'Comprehensive framework for calculating reparations debt including wage theft, compound interest, and intergenerational wealth transfer.',
    'comprehensive_framework',
    NULL,
    'Darity & Mullen (2020) provide comprehensive reparations calculation framework accounting for unpaid labor, lost wealth accumulation, and intergenerational economic harm.'
),
(
    ARRAY['Dagan, Hanoch'],
    'Restitution and Slavery: On Incomplete Commodification, Intergenerational Justice, and Legal Transitions',
    'Boston University Law Review',
    2004,
    'law_review',
    'Unjust enrichment and disgorgement theory provides legal basis for reparations claims based on retained profits from slavery.',
    'unjust_enrichment',
    NULL,
    'Dagan (BU Law Review 2004) establishes unjust enrichment/disgorgement as legal framework: slaveholders and their estates retained profits from stolen labor, creating ongoing debt obligation.'
),
(
    ARRAY['Posner, Eric A.', 'Vermeule, Adrian'],
    'Reparations for Slavery and Other Historical Injustices',
    'Columbia Law Review',
    2003,
    'law_review',
    'Design principles for reparations systems including calculation methodologies, payment structures, and legal mechanisms.',
    'payment_structure',
    NULL,
    'Posner & Vermeule (Columbia Law Review 2003) provide design framework for reparations systems, including voluntary acknowledgment as mechanism to bypass traditional legal barriers.'
)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SECTION 9: VIEWS
-- ============================================================================

-- View: DAA Summary
CREATE OR REPLACE VIEW daa_summary AS
SELECT
    daa.daa_id,
    daa.agreement_number,
    daa.acknowledger_name,
    daa.slaveholder_name,
    daa.total_debt,
    daa.annual_payment,
    daa.status,
    daa.signed_at,
    daa.blockchain_hash,
    COUNT(DISTINCT dep.id) as enslaved_count,
    COUNT(DISTINCT dp.petition_id) as petition_count,
    COUNT(DISTINCT dpay.payment_id) as payment_count,
    COALESCE(SUM(dpay.amount), 0) as total_paid,
    daa.created_at
FROM debt_acknowledgment_agreements daa
LEFT JOIN daa_enslaved_persons dep ON daa.daa_id = dep.daa_id
LEFT JOIN daa_annual_petitions dp ON daa.daa_id = dp.daa_id
LEFT JOIN daa_payments dpay ON daa.daa_id = dpay.daa_id
GROUP BY daa.daa_id, daa.agreement_number, daa.acknowledger_name, 
         daa.slaveholder_name, daa.total_debt, daa.annual_payment, 
         daa.status, daa.signed_at, daa.blockchain_hash, daa.created_at;

-- View: Annual petition tracking
CREATE OR REPLACE VIEW daa_petition_schedule AS
SELECT
    daa.daa_id,
    daa.agreement_number,
    daa.acknowledger_name,
    EXTRACT(YEAR FROM daa.signed_at)::INTEGER as first_petition_year,
    EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER as current_year,
    EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER - EXTRACT(YEAR FROM daa.signed_at)::INTEGER as years_active,
    COUNT(dp.petition_id) as petitions_filed,
    MAX(dp.petition_year) as last_petition_year,
    CASE
        WHEN MAX(dp.petition_year) < EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER 
        THEN TRUE
        ELSE FALSE
    END as petition_due
FROM debt_acknowledgment_agreements daa
LEFT JOIN daa_annual_petitions dp ON daa.daa_id = dp.daa_id
WHERE daa.status IN ('signed', 'active')
GROUP BY daa.daa_id, daa.agreement_number, daa.acknowledger_name, daa.signed_at;

-- ============================================================================
-- SECTION 10: FUNCTIONS
-- ============================================================================

-- Function: Generate next DAA agreement number
CREATE OR REPLACE FUNCTION generate_daa_agreement_number()
RETURNS VARCHAR(50) AS $$
DECLARE
    next_number INTEGER;
    new_agreement_number VARCHAR(50);
BEGIN
    -- Get the highest existing number
    SELECT COALESCE(MAX(CAST(SUBSTRING(agreement_number FROM 'DAA-\d{4}-(\d+)') AS INTEGER)), 0) + 1
    INTO next_number
    FROM debt_acknowledgment_agreements
    WHERE agreement_number ~ 'DAA-\d{4}-\d+';
    
    -- Generate new number with current year
    new_agreement_number := 'DAA-' || EXTRACT(YEAR FROM CURRENT_DATE)::TEXT || '-' || LPAD(next_number::TEXT, 3, '0');
    
    RETURN new_agreement_number;
END;
$$ LANGUAGE plpgsql;

-- Function: Calculate remaining debt
CREATE OR REPLACE FUNCTION daa_remaining_debt(p_daa_id UUID)
RETURNS DECIMAL(20,2) AS $$
DECLARE
    v_total_debt DECIMAL(20,2);
    v_total_paid DECIMAL(20,2);
BEGIN
    SELECT total_debt INTO v_total_debt
    FROM debt_acknowledgment_agreements
    WHERE daa_id = p_daa_id;
    
    SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
    FROM daa_payments
    WHERE daa_id = p_daa_id;
    
    RETURN GREATEST(v_total_debt - v_total_paid, 0);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- SECTION 11: TRIGGERS
-- ============================================================================

-- Trigger: Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_daa_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_daa_precedents_updated_at ON daa_legal_precedents;
CREATE TRIGGER update_daa_precedents_updated_at
    BEFORE UPDATE ON daa_legal_precedents
    FOR EACH ROW
    EXECUTE FUNCTION update_daa_updated_at();

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

SELECT 'Migration 028: DAA System Complete' AS status;
SELECT
    (SELECT COUNT(*) FROM daa_legal_precedents) as legal_precedents_seeded,
    (SELECT COUNT(*) FROM daa_academic_sources) as academic_sources_seeded;
