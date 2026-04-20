-- Migration 041: historical_reparations_petitions table
--
-- Creates the long-planned table that was specified in migration 011's
-- spirit but never actually applied to the production DB. Gives DC
-- compensated-emancipation petition records (1862) — and similar historical
-- petition instruments from other jurisdictions — a first-class home.
--
-- Primary use cases:
--   • DC 1862 Act petitions (Maria Angelica Biscoe a.k.a. Angelica Chew's
--     claim is the immediate driver per user's Apr 20, 2026 research).
--   • UK 1833 compensation claims (parallel — already have a uk_1833_compensation
--     table, but this is the unified model).
--   • Any future class of "reparations / compensation / restitution petition"
--     historical record.
--
-- The table is a primary-source entry, not a financial calculation. It
-- records the EXISTENCE of a petition and what claims it documented, and
-- points to the underlying archive. Calculations downstream consume this.
--
-- Links into the DAA probate gate as a tier-B evidence source for the
-- enslaver named in the petition.

CREATE TABLE IF NOT EXISTS historical_reparations_petitions (
    petition_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Petition identity + timing
    petition_type            TEXT NOT NULL,           -- 'dc_compensated_emancipation_1862',
                                                      -- 'uk_slave_compensation_1833',
                                                      -- 'california_compensated_labor_claim',
                                                      -- 'freedmens_bureau_claim',
                                                      -- 'belinda_sutton_style_petition'
    jurisdiction             TEXT,                    -- 'District of Columbia', 'United Kingdom', etc.
    filed_date               DATE,
    filed_year               INTEGER,                 -- when full date unknown
    docket_number            TEXT,                    -- "Petition No. 374" or similar
    petition_status          TEXT,                    -- 'filed', 'approved', 'denied', 'partial',
                                                      -- 'withdrawn'

    -- Who filed (the enslaver / claimant seeking compensation)
    claimant_name            TEXT NOT NULL,
    claimant_canonical_id    INTEGER REFERENCES canonical_persons(id) ON DELETE SET NULL,
    claimant_residence       TEXT,                    -- e.g. "Washington, DC, 15th St NW"

    -- What was claimed (the enslaved people named in the petition and their
    -- valuations — the whole indignity on the record in one row)
    enslaved_persons_claimed JSONB,                   -- [{name, age, sex, claimed_value_usd,
                                                      --   approved_value_usd, notes}, ...]
    total_claimed_usd        DECIMAL(14,2),           -- sum of claimed valuations
    total_approved_usd       DECIMAL(14,2),           -- sum of government-approved valuations

    -- Provenance — every row carries its source
    source_document_url      TEXT,
    source_archive           TEXT,                    -- e.g. "National Archives RG 21, DC District Court",
                                                      --      "UK National Archives T71"
    source_citation          TEXT,                    -- full bibliographic citation
    source_notes             TEXT,

    -- Confidence and review
    confidence               DECIMAL(3,2) DEFAULT 0.90, -- high — these are primary docs
    verification_status      TEXT DEFAULT 'unverified',
    requires_human_review    BOOLEAN DEFAULT FALSE,
    review_reason            TEXT,

    created_at               TIMESTAMPTZ DEFAULT NOW(),
    updated_at               TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_petitions_type        ON historical_reparations_petitions(petition_type);
CREATE INDEX IF NOT EXISTS idx_petitions_claimant_id ON historical_reparations_petitions(claimant_canonical_id);
CREATE INDEX IF NOT EXISTS idx_petitions_claimant    ON historical_reparations_petitions(claimant_name);
CREATE INDEX IF NOT EXISTS idx_petitions_year        ON historical_reparations_petitions(filed_year);
CREATE INDEX IF NOT EXISTS idx_petitions_review      ON historical_reparations_petitions(requires_human_review) WHERE requires_human_review = TRUE;

COMMENT ON TABLE historical_reparations_petitions IS
  'Primary-source entries for historical reparations/compensation/restitution '
  'petitions. The seed use case is the DC 1862 Compensated Emancipation Act '
  'petitions (enslavers petitioning for reimbursement after emancipation). '
  'The same schema carries UK 1833 claims and any similar instrument. Links '
  'to canonical_persons via claimant_canonical_id — the named enslaver. '
  'Counts as Tier B evidence in the DAA probate gate.';

COMMENT ON COLUMN historical_reparations_petitions.enslaved_persons_claimed IS
  'JSON array of the persons named in the petition as enslaved property, with '
  'age/sex/valuation. This is the list of people the claimant was seeking '
  'compensation FOR losing as chattel — documented individually on the record.';
