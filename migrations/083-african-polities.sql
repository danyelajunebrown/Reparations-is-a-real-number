-- Migration 083: African Polities
-- Date: 2026-05-23
-- Purpose: Capture African political entities (kingdoms, empires, sultanates,
--          confederacies) involved in or affected by the transatlantic and
--          trans-Saharan slave trades. Modeled "both ways" per user direction
--          (May 23, 2026): a polity can appear simultaneously as a receiving
--          party (owed reparations for the trade's effects on its peoples)
--          and as a harm party (where evidence of agency in raiding/trading
--          exists). Reparations credit and debit are computed independently;
--          the user's prior is that credit will outweigh debit for most
--          polities, but the platform computes rather than assumes.
--
-- Involvement typology is NOT stored on this table. Role assignments live in
-- actor_roles (M086) keyed by (actor, period, role) so the same polity can
-- have different roles in different centuries with citations per role.
--
-- NO ROW INSERTS. Polities enter via contribute pipeline.

CREATE TABLE IF NOT EXISTS african_polities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identity
    entity_key VARCHAR(100) UNIQUE NOT NULL,           -- 'kingdom_of_kongo','kingdom_of_dahomey','asante_empire'
    display_name VARCHAR(300) NOT NULL,
    historical_names TEXT[],                           -- ['Manikongo','Wene wa Kongo']

    -- Geography
    region VARCHAR(100),                               -- 'West Africa','West Central Africa','Senegambia'
    modern_territorial_successors TEXT[],              -- ['Angola','DR Congo','Republic of Congo']
    capital_historical VARCHAR(200),                   -- 'Mbanza Kongo'

    -- Timeline
    peak_period_start INTEGER,
    peak_period_end INTEGER,
    dissolution_year INTEGER,

    -- Both-ways ledger flags (NOT mutually exclusive).
    -- DEFAULT FALSE on both: the platform is agnostic on entry — at least one
    -- side must be affirmatively asserted (with evidence) by the contributor.
    appears_as_harm_party BOOLEAN DEFAULT FALSE,
    appears_as_receiving_party BOOLEAN DEFAULT FALSE,

    -- Sources
    primary_citation TEXT,
    notes TEXT,

    -- Provenance through contribute pipeline
    contribution_status VARCHAR(30) DEFAULT 'pending_review',
    contributor_id UUID,
    approved_by UUID,
    approved_at TIMESTAMP,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT african_polities_contribution_status_valid CHECK (
        contribution_status IN ('pending_review', 'approved', 'rejected', 'needs_revision')
    ),
    CONSTRAINT african_polities_at_least_one_ledger_side CHECK (
        appears_as_harm_party OR appears_as_receiving_party
    )
);

CREATE INDEX IF NOT EXISTS idx_african_polities_region ON african_polities(region);
CREATE INDEX IF NOT EXISTS idx_african_polities_status ON african_polities(contribution_status);

COMMENT ON TABLE african_polities IS 'African political entities relevant to slave-trade reparations accounting. Modeled both-ways: a polity can simultaneously be owed reparations and bear documented harm responsibility. Role typology lives in actor_roles (M086) keyed by (actor, period, role).';
COMMENT ON COLUMN african_polities.appears_as_harm_party IS 'Polity has documented agency in raiding/trading. Must be supported by at least one provenance_evidence record AND at least one actor_role with appropriate role_type. Enforced by application layer in contribute pipeline.';
COMMENT ON COLUMN african_polities.appears_as_receiving_party IS 'Polity is owed reparations as source-side victim of the transatlantic trade. Default FALSE — the platform does not assume; the contributor must affirmatively assert with evidence. Credit and debit are computed independently from line_items.';
