-- Migration 040: Enslaver lineage ledger for rhizomatic distributed pledges.
--
-- PROBLEM this solves:
--   The current DAA pipeline assigns 100% of an enslaver ancestor's computed
--   debt to EACH descendant who presents. Adrian Brown's DAA → $88.7M full
--   ancestral debt. Her hypothetical sister's DAA would also show $88.7M
--   ancestral debt. All ~250 living gen-8 descendants of Angelica Chesley,
--   if they each filled out an intake, would each be assigned $88.7M.
--
--   That's mathematically wrong as attribution, even if defensible as a
--   voluntary-pledge ceiling. The RIGHT structure (per user's Apr 20, 2026
--   direction — see project_debt_distribution_architecture memory) is:
--
--     • Per enslaver-ancestor LINEAGE, track a SINGLE obligation total.
--     • Each descendant's DAA pledge contributes TOWARD that total.
--     • The blockchain smart contract aggregates pledges until the total
--       is satisfied — regardless of how many descendants participated.
--     • Rhizomatic: no central assignment of individual shares; descendants
--       self-organize voluntarily.
--
-- WHAT this migration creates:
--   `enslaver_lineage_ledger` — one row per (enslaver canonical_persons.id)
--     with the computed total obligation, rolling pledged/paid totals, and
--     a blockchain-ID pointer for on-chain aggregation.
--   `daa_lineage_contributions` — m:n link between debt_acknowledgment_
--     agreements rows and enslaver_lineage_ledger rows, with per-contribution
--     dollar amounts and confidence weights.
--
-- Migration is additive — safe to apply before Layer A (DAA two-number
-- display) and Layer 3 (inheritance-share weighting) land. Those layers
-- use this ledger's data.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. enslaver_lineage_ledger — per-enslaver obligation + aggregated pledges
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS enslaver_lineage_ledger (
    lineage_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The enslaver ancestor this lineage is about. One row per enslaver.
    enslaver_person_id INTEGER NOT NULL REFERENCES canonical_persons(id) ON DELETE CASCADE,
    enslaver_canonical_name TEXT,  -- denormalized for auditability

    -- Computed obligation. Populated by the pipeline from Craemer+D&M
    -- calculations across this enslaver's documented enslaved persons.
    total_obligation_usd         DECIMAL(14,2) DEFAULT 0,
    craemer_component_usd        DECIMAL(14,2),
    wealth_gap_component_usd     DECIMAL(14,2),
    calculation_methodology_note TEXT,
    calculated_at                TIMESTAMPTZ,

    -- Rolling totals across all descendant-DAA contributions.
    total_pledged_usd   DECIMAL(14,2) DEFAULT 0,  -- sum of DAA annual commitments extrapolated
    total_paid_usd      DECIMAL(14,2) DEFAULT 0,  -- actual escrow deposits
    contributor_count   INTEGER DEFAULT 0,        -- distinct descendants who pledged

    -- Blockchain pointer. When wired, the ReparationsEscrow smart contract
    -- hashes this lineage_id and stores the aggregate totals on-chain.
    blockchain_contract_address TEXT,
    blockchain_lineage_key      TEXT,  -- keccak256(lineage_id) or similar

    -- Descendant-count estimate for the naive-share fallback. Populated by
    -- a future heuristic that walks the FamilySearch tree. Used as the
    -- denominator for Layer A's "suggested individual share" when real
    -- inheritance-share data (Layer 3) isn't available yet.
    estimated_living_descendants INTEGER,
    descendants_estimate_method  TEXT,  -- 'generational_fanout_2_per_gen',
                                        -- 'famlysearch_tree_walk',
                                        -- 'manual_audit'

    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (enslaver_person_id)
);

CREATE INDEX IF NOT EXISTS idx_lineage_enslaver ON enslaver_lineage_ledger(enslaver_person_id);
CREATE INDEX IF NOT EXISTS idx_lineage_satisfied ON enslaver_lineage_ledger((total_paid_usd >= total_obligation_usd));

COMMENT ON TABLE enslaver_lineage_ledger IS
  'One row per enslaver ancestor. Tracks the total Craemer+D&M obligation '
  'and rolling pledged/paid totals aggregated across ALL descendants who '
  'have DAA pledges referencing this lineage. Blockchain smart contract '
  'syncs from this table and publishes aggregate progress per lineage.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. daa_lineage_contributions — m:n DAA × lineage with per-contribution amount
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daa_lineage_contributions (
    contribution_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    daa_id UUID NOT NULL REFERENCES debt_acknowledgment_agreements(daa_id) ON DELETE CASCADE,
    lineage_id UUID NOT NULL REFERENCES enslaver_lineage_ledger(lineage_id) ON DELETE CASCADE,

    -- How much of this DAA's total debt is attributed to this specific
    -- ancestor lineage. A single DAA can contribute to multiple lineages
    -- (Adrian's DAA touches 16 enslaver ancestors → 16 contributions).
    contribution_usd DECIMAL(14,2) NOT NULL,

    -- Share basis — HOW we computed this contribution's share:
    --   'full_obligation_ceiling'   → current default, 100% attributed
    --                                 (Layer A transitional)
    --   'naive_generational_split'  → obligation ÷ estimated_descendants
    --                                 (Layer A when estimate is present)
    --   'inheritance_share_probate' → computed from land_transfer_events
    --                                 + probate traces (Layer 3, future)
    --   'voluntary_pledge_amount'   → descendant self-declared, bypasses math
    share_basis TEXT NOT NULL DEFAULT 'full_obligation_ceiling',
    share_fraction DECIMAL(6,5),  -- 0.00000 to 1.00000, NULL for ceiling-basis
    share_methodology_note TEXT,

    -- Provenance
    source_calculation JSONB,     -- full math breakdown for transparency
    confidence DECIMAL(3,2) DEFAULT 0.80,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (daa_id, lineage_id)
);

CREATE INDEX IF NOT EXISTS idx_contrib_daa ON daa_lineage_contributions(daa_id);
CREATE INDEX IF NOT EXISTS idx_contrib_lineage ON daa_lineage_contributions(lineage_id);

COMMENT ON TABLE daa_lineage_contributions IS
  'Each DAA contribution toward a specific enslaver lineage. share_basis '
  'records which distribution methodology was used — from the current '
  '"100% ceiling" default up through the probate-derived inheritance share '
  'that the wealth-tracing framework targets. A DAA contributes to as many '
  'lineages as the participant has enslaver ancestors (Adrian: 16).';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Convenience view: per-lineage satisfaction status
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW enslaver_lineage_satisfaction AS
SELECT
    l.lineage_id,
    l.enslaver_person_id,
    l.enslaver_canonical_name,
    l.total_obligation_usd,
    l.total_pledged_usd,
    l.total_paid_usd,
    l.contributor_count,
    CASE
        WHEN l.total_obligation_usd IS NULL OR l.total_obligation_usd = 0 THEN NULL
        ELSE ROUND((l.total_paid_usd / l.total_obligation_usd * 100)::numeric, 2)
    END AS percent_paid,
    CASE
        WHEN l.total_obligation_usd IS NULL OR l.total_obligation_usd = 0 THEN NULL
        ELSE ROUND((l.total_pledged_usd / l.total_obligation_usd * 100)::numeric, 2)
    END AS percent_pledged,
    (l.total_paid_usd >= l.total_obligation_usd) AS is_satisfied,
    l.blockchain_contract_address,
    l.blockchain_lineage_key
FROM enslaver_lineage_ledger l;

COMMENT ON VIEW enslaver_lineage_satisfaction IS
  'Per-lineage progress: pledged + paid fraction of the total obligation. '
  'Public / blockchain-visible summary — anyone can audit whether a given '
  'enslaver ancestor lineage has been acknowledged and by how much.';
