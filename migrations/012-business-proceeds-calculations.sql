-- Migration 012: Business Proceeds Calculations System
-- Purpose: Track business/asset data to calculate enslaved person's portion of proceeds
-- 
-- CRITICAL CONCEPTUAL CORRECTION:
-- Compensation TO owners is NOT added to debt directly.
-- It is EVIDENCE of business VALUE at time of emancipation.
-- 
-- The actual reparations formula is:
-- Total Reparations = Wage Theft + Portion of Business Proceeds + Damages
-- 
-- To calculate "Portion of Business Proceeds":
-- 1. Research owner's assets and business reports from the time
-- 2. Determine what portion of business value came from enslaved person's labor
-- 3. That portion of ongoing business proceeds belongs to the enslaved person

-- Table 1: Business Asset Records
-- Stores historical business/asset data for calculating proceeds
CREATE TABLE IF NOT EXISTS business_asset_records (
    id SERIAL PRIMARY KEY,
    
    -- Link to owner/enslaver
    owner_individual_id VARCHAR(255) REFERENCES individuals(individual_id),
    owner_name VARCHAR(500) NOT NULL,
    
    -- Link to compensation claim (if applicable)
    compensation_claim_id INTEGER REFERENCES compensation_claims(id),
    
    -- Business details
    business_type VARCHAR(100), -- 'plantation', 'factory', 'shipping', 'banking', 'textile_mill', etc.
    business_name VARCHAR(500),
    business_location VARCHAR(500),
    
    -- Asset valuation at time of emancipation
    valuation_date DATE,
    total_asset_value NUMERIC(20,2), -- Total business value
    valuation_currency VARCHAR(10) DEFAULT 'USD',
    valuation_source TEXT, -- Where this valuation came from
    
    -- What the compensation represented
    compensation_amount NUMERIC(20,2), -- Amount paid to owner
    compensation_basis VARCHAR(100), -- 'per_enslaved_person', 'total_property_value', 'estate_value'
    
    -- Enslaved labor contribution
    enslaved_count INTEGER,
    enslaved_person_names TEXT[], -- Array of names if known
    labor_type VARCHAR(100), -- 'agricultural', 'domestic', 'skilled_craft', 'industrial'
    
    -- Business records
    historical_revenue NUMERIC(20,2), -- Annual revenue if known
    historical_profit NUMERIC(20,2), -- Annual profit if known
    financial_year INTEGER, -- Year of financial data
    
    -- Source documentation
    business_report_url TEXT, -- Link to historical business reports
    archive_source VARCHAR(500),
    archive_reference VARCHAR(255),
    document_path TEXT, -- S3 path to business documents
    
    -- Metadata
    notes TEXT,
    research_status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'in_progress', 'complete', 'verified'
    researched_by VARCHAR(255),
    research_date TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_bar_owner_id ON business_asset_records(owner_individual_id);
CREATE INDEX idx_bar_owner_name ON business_asset_records(owner_name);
CREATE INDEX idx_bar_compensation_claim_id ON business_asset_records(compensation_claim_id);
CREATE INDEX idx_bar_business_type ON business_asset_records(business_type);
CREATE INDEX idx_bar_valuation_date ON business_asset_records(valuation_date);
CREATE INDEX idx_bar_research_status ON business_asset_records(research_status);

-- Table 2: Proceeds Calculation Methodology
-- Stores the methodology for calculating enslaved person's portion of business proceeds
CREATE TABLE IF NOT EXISTS proceeds_calculation_methods (
    id SERIAL PRIMARY KEY,
    
    -- Link to business record
    business_record_id INTEGER REFERENCES business_asset_records(id) ON DELETE CASCADE,
    
    -- Calculation approach
    calculation_method VARCHAR(50) NOT NULL, 
    -- Options: 'labor_hours_ratio', 'human_capital_value', 'productivity_analysis', 
    --          'comparative_wages', 'business_proportion', 'custom'
    
    -- Parameters for calculation
    calculation_parameters JSONB, -- Flexible JSON for different methodologies
    
    -- Example parameters for different methods:
    -- labor_hours_ratio: { "enslaved_hours": 4000, "total_hours": 5000, "ratio": 0.80 }
    -- human_capital_value: { "skilled_labor_value": 50000, "unskilled_value": 20000 }
    -- productivity_analysis: { "output_per_enslaved": 1000, "market_value": 50 }
    
    -- Results
    enslaved_contribution_percentage DECIMAL(5,2), -- 0-100%
    enslaved_portion_of_assets NUMERIC(20,2), -- Dollar value of their contribution
    
    -- How proceeds should be calculated going forward
    ongoing_proceeds_formula TEXT, -- Formula for calculating future proceeds
    proceeds_period VARCHAR(50), -- 'annual', 'lifetime', 'generational'
    
    -- Justification
    methodology_rationale TEXT, -- Why this method was chosen
    supporting_research TEXT, -- Links to research supporting this approach
    comparable_cases TEXT[], -- Similar cases using this methodology
    
    -- Validation
    peer_reviewed BOOLEAN DEFAULT FALSE,
    reviewed_by VARCHAR(255),
    review_date TIMESTAMP,
    review_notes TEXT,
    
    -- Status
    status VARCHAR(50) DEFAULT 'draft', -- 'draft', 'proposed', 'approved', 'superseded'
    approved_by VARCHAR(255),
    approval_date TIMESTAMP,
    
    -- Metadata
    version INTEGER DEFAULT 1,
    superseded_by INTEGER REFERENCES proceeds_calculation_methods(id),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_pcm_business_record_id ON proceeds_calculation_methods(business_record_id);
CREATE INDEX idx_pcm_calculation_method ON proceeds_calculation_methods(calculation_method);
CREATE INDEX idx_pcm_status ON proceeds_calculation_methods(status);

-- Table 3: Research Needed
-- Tracks what historical research is needed to complete proceeds calculations
CREATE TABLE IF NOT EXISTS proceeds_research_needed (
    id SERIAL PRIMARY KEY,
    
    -- Link to business record
    business_record_id INTEGER REFERENCES business_asset_records(id) ON DELETE CASCADE,
    
    -- What's needed
    research_type VARCHAR(100) NOT NULL,
    -- Options: 'business_reports', 'asset_appraisals', 'financial_statements', 
    --          'tax_records', 'probate_records', 'corporate_records', 
    --          'plantation_records', 'labor_records'
    
    research_description TEXT NOT NULL,
    research_priority VARCHAR(20) DEFAULT 'medium', -- 'critical', 'high', 'medium', 'low'
    
    -- Where to look
    suggested_archives TEXT[],
    suggested_sources TEXT[],
    online_resources TEXT[],
    
    -- Status
    research_status VARCHAR(50) DEFAULT 'needed',
    -- Options: 'needed', 'in_progress', 'found', 'not_available', 'completed'
    
    assigned_to VARCHAR(255),
    assigned_date TIMESTAMP,
    
    -- Results
    findings TEXT,
    source_documents TEXT[], -- URLs or S3 paths
    completed_date TIMESTAMP,
    completed_by VARCHAR(255),
    
    -- Metadata
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_prn_business_record_id ON proceeds_research_needed(business_record_id);
CREATE INDEX idx_prn_research_type ON proceeds_research_needed(research_type);
CREATE INDEX idx_prn_research_status ON proceeds_research_needed(research_status);
CREATE INDEX idx_prn_research_priority ON proceeds_research_needed(research_priority);

-- Table 4: Calculated Reparations (Corrected Formula)
-- Final reparations calculation using the correct formula
CREATE TABLE IF NOT EXISTS calculated_reparations (
    id SERIAL PRIMARY KEY,
    
    -- Link to enslaved person
    enslaved_id VARCHAR(255) REFERENCES enslaved_individuals(enslaved_id),
    enslaved_name VARCHAR(500) NOT NULL,
    
    -- Link to enslaver
    enslaver_individual_id VARCHAR(255) REFERENCES individuals(individual_id),
    enslaver_name VARCHAR(500),
    
    -- Link to business record (if applicable)
    business_record_id INTEGER REFERENCES business_asset_records(id),
    
    -- Component 1: Wage Theft
    wage_theft_amount NUMERIC(20,2) NOT NULL DEFAULT 0,
    wage_theft_calculation_method VARCHAR(100),
    wage_theft_notes TEXT,
    
    -- Component 2: Portion of Business Proceeds
    business_proceeds_portion NUMERIC(20,2) DEFAULT 0,
    proceeds_calculation_method_id INTEGER REFERENCES proceeds_calculation_methods(id),
    proceeds_period_covered VARCHAR(100), -- 'lifetime', '1800-1865', etc.
    proceeds_notes TEXT,
    
    -- Component 3: Damages
    damages_amount NUMERIC(20,2) DEFAULT 0,
    damages_breakdown JSONB, -- { "human_dignity": 50000, "family_separation": 25000, etc. }
    damages_notes TEXT,
    
    -- Total (CORRECTED FORMULA)
    total_reparations NUMERIC(20,2) GENERATED ALWAYS AS 
        (wage_theft_amount + business_proceeds_portion + damages_amount) STORED,
    
    -- Modern value adjustments
    inflation_adjustment_factor DECIMAL(10,4),
    compound_interest_rate DECIMAL(6,4) DEFAULT 0.02, -- 2% annual
    years_delayed INTEGER,
    compound_interest_amount NUMERIC(20,2),
    
    total_with_interest NUMERIC(20,2),
    
    -- Calculation metadata
    calculation_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    calculation_version VARCHAR(50),
    calculated_by VARCHAR(255),
    
    -- Validation
    peer_reviewed BOOLEAN DEFAULT FALSE,
    reviewed_by VARCHAR(255),
    review_date TIMESTAMP,
    review_status VARCHAR(50), -- 'approved', 'needs_revision', 'rejected'
    review_notes TEXT,
    
    -- Status
    status VARCHAR(50) DEFAULT 'draft',
    -- Options: 'draft', 'pending_review', 'approved', 'challenged', 'final'
    
    -- Links to evidence
    compensation_claim_id INTEGER REFERENCES compensation_claims(id),
    petition_id INTEGER REFERENCES historical_reparations_petitions(id),
    evidence_documents TEXT[], -- Array of document URLs/paths
    
    -- Metadata
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_cr_enslaved_id ON calculated_reparations(enslaved_id);
CREATE INDEX idx_cr_enslaver_id ON calculated_reparations(enslaver_individual_id);
CREATE INDEX idx_cr_business_record_id ON calculated_reparations(business_record_id);
CREATE INDEX idx_cr_status ON calculated_reparations(status);
CREATE INDEX idx_cr_total_reparations ON calculated_reparations(total_reparations);

-- View: Complete Reparations Breakdown
-- Shows all components of the corrected formula
CREATE VIEW complete_reparations_breakdown AS
SELECT 
    cr.id,
    cr.enslaved_name,
    cr.enslaver_name,
    
    -- Component breakdown
    cr.wage_theft_amount,
    cr.business_proceeds_portion,
    cr.damages_amount,
    cr.total_reparations,
    
    -- Percentages
    ROUND((cr.wage_theft_amount / NULLIF(cr.total_reparations, 0)) * 100, 2) as wage_theft_percentage,
    ROUND((cr.business_proceeds_portion / NULLIF(cr.total_reparations, 0)) * 100, 2) as proceeds_percentage,
    ROUND((cr.damages_amount / NULLIF(cr.total_reparations, 0)) * 100, 2) as damages_percentage,
    
    -- With interest
    cr.total_with_interest,
    cr.compound_interest_amount,
    
    -- Business context
    bar.business_type,
    bar.business_name,
    bar.total_asset_value as business_value_at_emancipation,
    pcm.enslaved_contribution_percentage,
    
    -- Evidence links
    cr.compensation_claim_id,
    cr.petition_id,
    
    -- Status
    cr.status,
    cr.peer_reviewed,
    
    cr.calculation_date
FROM calculated_reparations cr
LEFT JOIN business_asset_records bar ON cr.business_record_id = bar.id
LEFT JOIN proceeds_calculation_methods pcm ON cr.proceeds_calculation_method_id = pcm.id
ORDER BY cr.total_reparations DESC;

-- View: Research Priority Summary
-- Shows what research is most urgently needed
CREATE VIEW research_priority_summary AS
SELECT 
    prn.research_type,
    prn.research_priority,
    COUNT(*) as cases_needing_research,
    STRING_AGG(DISTINCT bar.owner_name, '; ' ORDER BY bar.owner_name) as owners_affected,
    SUM(bar.total_asset_value) as total_asset_value_pending,
    STRING_AGG(DISTINCT prn.suggested_archives::text, '; ') as archives_to_check
FROM proceeds_research_needed prn
JOIN business_asset_records bar ON prn.business_record_id = bar.id
WHERE prn.research_status IN ('needed', 'in_progress')
GROUP BY prn.research_type, prn.research_priority
ORDER BY 
    CASE prn.research_priority
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
    END,
    cases_needing_research DESC;

-- Comments
COMMENT ON TABLE business_asset_records IS 'Stores historical business/asset data for calculating enslaved persons portion of business proceeds. Compensation TO owners is evidence of value, NOT added to debt directly.';

COMMENT ON TABLE proceeds_calculation_methods IS 'Methodologies for determining what portion of business value/proceeds came from enslaved labor. This is Component 2 of the corrected reparations formula.';

COMMENT ON TABLE calculated_reparations IS 'Final reparations calculations using CORRECTED FORMULA: Total = Wage Theft + Portion of Business Proceeds + Damages. Compensation to owners informs proceeds calculation but is NOT added directly.';

COMMENT ON COLUMN calculated_reparations.business_proceeds_portion IS 'Enslaved persons rightful share of business proceeds. Calculated by researching owners assets/business and determining what portion was attributable to enslaved labor.';

-- Initial example: Store methodology note for future improvement
INSERT INTO proceeds_calculation_methods (
    business_record_id,
    calculation_method,
    calculation_parameters,
    methodology_rationale,
    status
) VALUES (
    NULL, -- Placeholder - no specific business yet
    'placeholder_pending_research',
    '{"note": "This is a placeholder for future proceeds calculation methodology. Requires specific research on each owners business assets and reports from time of emancipation."}'::jsonb,
    'PLACEHOLDER: Compensation TO owners tells us business value at emancipation. We need to research: 1) Owners business assets/reports, 2) What portion of business value came from enslaved labor, 3) That portion of proceeds belongs to enslaved person. This methodology will be refined with specific research for each case.',
    'draft'
) ON CONFLICT DO NOTHING;
