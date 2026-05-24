-- Migration 088: Wealth Transfer Events
-- Date: 2026-05-24
-- Purpose: First-class object for bankruptcy / foreclosure / estate-liquidation
--          / sheriff-sale / heir-partition / tax-sale events that transferred
--          slavery-derived wealth as a SINGLE EVENT touching multiple asset
--          classes simultaneously.
--
-- Motivating case (user direction, May 24, 2026): William Backhouse Astor Sr.
-- and similar Northern financiers who became enslaver-owners through mortgage
-- defaults on Southern planters. When a planter went insolvent, the creditor
-- typically took ALL the collateral in one event: enslaved persons + plantation
-- land + cotton gin + railroad stock + future-crop contracts. The non-chattel
-- portion was often a multiple of the enslaved-person appraised value, and that
-- non-chattel wealth (which was itself created by enslaved labor) flowed away
-- to creditors as additional unrecovered extraction beyond what the Brattle
-- person-year framework values.
--
-- This table is the parent/grouping object. entity_successions (M085) and
-- family_relationships rows tied to the event link back via FK so the platform
-- can ask: "In Planter X's 1842 bankruptcy, what fraction of the wealth
-- transferred to creditor Y was non-chattel?" — a question that currently has
-- no single-query answer.
--
-- NO ROW INSERTS.

CREATE TABLE IF NOT EXISTS wealth_transfer_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identity
    event_key VARCHAR(150) UNIQUE NOT NULL,            -- 'astor_planter_x_foreclosure_1842_adams_co_ms'
    display_name VARCHAR(300) NOT NULL,
    event_type VARCHAR(50) NOT NULL,

    -- When
    event_year INTEGER,
    event_date_precise DATE,

    -- Who lost the wealth (polymorphic — planter, corporate slaveholder, etc.)
    debtor_entity_type VARCHAR(50),
    debtor_entity_id UUID,
    debtor_name_denormalized VARCHAR(300),             -- snapshot at time of event, since names change

    -- Jurisdictional locus
    state_or_province VARCHAR(100),
    county VARCHAR(100),
    legal_jurisdiction_id UUID REFERENCES legal_jurisdictions(jurisdiction_id),
    court_or_authority VARCHAR(300),                   -- 'Chancery Court of Adams County, MS'
    docket_or_case_number VARCHAR(150),

    -- ASSET PROPORTIONS (the load-bearing fields — user's "great proportion" point)
    total_estate_value_usd DECIMAL(20, 2),
    total_estate_value_year INTEGER,                   -- year the valuation is denominated in
    enslaved_persons_count INTEGER,
    enslaved_persons_appraised_value_usd DECIMAL(20, 2),
    non_chattel_assets_value_usd DECIMAL(20, 2),       -- land + buildings + equipment + securities + futures
    debt_total_usd DECIMAL(20, 2),

    -- Itemized non-chattel description so the value isn't a black box
    non_chattel_assets_described TEXT,                 -- 'plantation house, 1200 acres improved + 800 woodland,
                                                       --  cotton gin, sawmill, 4 wagons, 22 mules,
                                                       --  $8,000 NO&C Railroad stock, $4,000 1843 cotton futures'

    -- Sources
    primary_archive VARCHAR(300),                      -- 'MDAH probate records, Adams County'
    primary_citation TEXT,
    notes TEXT,

    -- Provenance through contribute pipeline
    contribution_status VARCHAR(30) DEFAULT 'pending_review',
    contributor_id UUID,
    approved_by UUID,
    approved_at TIMESTAMP,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT wealth_transfer_event_type_valid CHECK (
        event_type IN (
            'mortgage_default',
            'bankruptcy',
            'estate_liquidation',
            'probate_sale',
            'sheriff_sale',
            'heir_partition',
            'tax_sale',
            'panic_forced_sale',
            'war_confiscation',
            'trust_dissolution',
            'corporate_insolvency'
        )
    ),
    CONSTRAINT wealth_transfer_debtor_type_valid CHECK (
        debtor_entity_type IS NULL OR debtor_entity_type IN (
            'canonical_person','corporate_entity','harm_perpetrator_entity','chartered_company'
        )
    ),
    CONSTRAINT wealth_transfer_contribution_status_valid CHECK (
        contribution_status IN ('pending_review','approved','rejected','needs_revision')
    ),
    CONSTRAINT wealth_transfer_proportions_sane CHECK (
        -- if all three are present, the parts shouldn't exceed the whole by more than rounding
        total_estate_value_usd IS NULL
        OR enslaved_persons_appraised_value_usd IS NULL
        OR non_chattel_assets_value_usd IS NULL
        OR (enslaved_persons_appraised_value_usd + non_chattel_assets_value_usd)
            <= (total_estate_value_usd * 1.05)
    )
);

-- Link transfers (entity successions + enslaved-person reassignments) to the
-- event that caused them. Nullable on both tables — events are an annotation
-- pattern, not a requirement.
ALTER TABLE entity_successions
    ADD COLUMN IF NOT EXISTS wealth_transfer_event_id UUID REFERENCES wealth_transfer_events(id);

ALTER TABLE family_relationships
    ADD COLUMN IF NOT EXISTS wealth_transfer_event_id UUID REFERENCES wealth_transfer_events(id);

CREATE INDEX IF NOT EXISTS idx_wealth_transfer_event_year ON wealth_transfer_events(event_year);
CREATE INDEX IF NOT EXISTS idx_wealth_transfer_debtor ON wealth_transfer_events(debtor_entity_type, debtor_entity_id);
CREATE INDEX IF NOT EXISTS idx_wealth_transfer_event_type ON wealth_transfer_events(event_type);
CREATE INDEX IF NOT EXISTS idx_wealth_transfer_status ON wealth_transfer_events(contribution_status);
CREATE INDEX IF NOT EXISTS idx_wealth_transfer_jurisdiction ON wealth_transfer_events(state_or_province, county);
CREATE INDEX IF NOT EXISTS idx_entity_successions_wte ON entity_successions(wealth_transfer_event_id);
CREATE INDEX IF NOT EXISTS idx_family_relationships_wte ON family_relationships(wealth_transfer_event_id);

COMMENT ON TABLE wealth_transfer_events IS 'First-class object for bankruptcy / foreclosure / probate sale / sheriff sale / heir partition / tax sale / panic forced sale events that transferred slavery-derived wealth. Parent to entity_successions and family_relationships rows that occurred under the same legal event. The asset-proportions columns (enslaved_persons_appraised_value_usd vs non_chattel_assets_value_usd) make recoverable the typically-larger non-chattel wealth that was itself created by enslaved labor and flowed to creditors as additional extraction.';
COMMENT ON COLUMN wealth_transfer_events.non_chattel_assets_value_usd IS 'Crystallized output of enslaved labor — buildings, drained swamps, levees, orchards, equipment, securities, future-crop contracts. Often a multiple of enslaved_persons_appraised_value_usd in any given insolvency. Brattle person-year framework values the labor itself; this column makes the labor-derived downstream wealth visible and recoverable in the reparations accounting.';
COMMENT ON COLUMN wealth_transfer_events.event_type IS 'probate_sale is included as a distinct event_type from estate_liquidation because the probate process (court-supervised sale of a decedent''s estate) is a major pattern in the Georgia probate scrape currently in progress and deserves its own bucket.';
