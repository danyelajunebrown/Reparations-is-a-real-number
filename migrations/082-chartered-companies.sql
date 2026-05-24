-- Migration 082: Chartered Companies
-- Date: 2026-05-23
-- Purpose: Capture sovereign-backed chartered monopolies (Royal African Company,
--          South Sea Company, Dutch WIC, Compagnie des Indes, Casa de Contratación,
--          Companhia Grão-Pará, Brandenburg African Company, East India Company,
--          etc.) that operated forts, ran armies, and conducted the actual
--          extraction. Distinguished from harm_perpetrator_entities (modern
--          corporations) because their distinctive feature is the sovereign-debt
--          fold-in pathway when they dissolved — that pathway is how modern
--          obligations land (e.g., Royal African Company assets vested in Crown
--          1821 → modern obligation sits with HM Treasury / FCDO).
--
-- NO ROW INSERTS. Per feedback_no_hardcoded_perpetrator_seeds.md (May 23, 2026),
-- all chartered company rows must enter through the contribute pipeline.

CREATE TABLE IF NOT EXISTS chartered_companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identity
    entity_key VARCHAR(100) UNIQUE NOT NULL,           -- 'royal_african_company','east_india_company'
    display_name VARCHAR(300) NOT NULL,
    alternate_names TEXT[],

    -- Founding sovereign
    founding_sovereign_jurisdiction_id UUID REFERENCES legal_jurisdictions(jurisdiction_id),
    founding_sovereign_name VARCHAR(200),              -- denormalized for archived sovereigns
                                                       -- ('Kingdom of Great Britain','Dutch Republic')

    -- Operating timeline
    charter_year INTEGER,
    monopoly_lost_year INTEGER,                        -- RAC lost monopoly 1698
    dissolution_year INTEGER,
    liquidation_completed_year INTEGER,                -- Companhia Grão-Pará lingered to 1914

    -- Sovereign-debt fold-in pathway (the central column for reparations claims)
    sovereign_debt_fold_in_pathway TEXT,               -- 'Assets vested in Crown 1821 via Act 1&2 Geo IV c.28;
                                                       --  obligations to FCDO via former Colonial Office'
    modern_obligation_holder_entity_key VARCHAR(200),  -- 'uk_hm_treasury_fcdo','french_republic',
                                                       --  'kingdom_of_spain','portuguese_republic'

    -- Operational footprint
    forts_factories TEXT[],                            -- ['Cape Coast Castle','Anomabu','James Island']
    operating_regions TEXT[],                          -- ['Gold Coast','Bight of Benin','Caribbean']

    -- Sources
    primary_archive VARCHAR(300),                      -- 'TNA Kew T 70'
    primary_citation TEXT,

    notes TEXT,

    -- Provenance through contribute pipeline
    contribution_status VARCHAR(30) DEFAULT 'pending_review',
    contributor_id UUID,
    approved_by UUID,
    approved_at TIMESTAMP,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chartered_companies_contribution_status_valid CHECK (
        contribution_status IN ('pending_review', 'approved', 'rejected', 'needs_revision')
    )
);

-- Bridge to existing perpetrator graph: a chartered company can ALSO appear in
-- harm_perpetrator_entities if it has modern obligations needing calculation.
ALTER TABLE harm_perpetrator_entities
    ADD COLUMN IF NOT EXISTS chartered_company_id UUID REFERENCES chartered_companies(id);

CREATE INDEX IF NOT EXISTS idx_chartered_companies_sovereign ON chartered_companies(founding_sovereign_jurisdiction_id);
CREATE INDEX IF NOT EXISTS idx_chartered_companies_status ON chartered_companies(contribution_status);
CREATE INDEX IF NOT EXISTS idx_perpetrator_chartered_company ON harm_perpetrator_entities(chartered_company_id);

COMMENT ON TABLE chartered_companies IS 'Sovereign-backed chartered companies that operated the slave trade and other colonial extraction. The sovereign_debt_fold_in_pathway column traces how the modern obligation lands when the company dissolved.';
