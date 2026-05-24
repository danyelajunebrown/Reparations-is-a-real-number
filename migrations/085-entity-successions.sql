-- Migration 085: Entity Successions (generalized)
-- Date: 2026-05-23
-- Purpose: Unified successions table covering both corporate-merger successions
--          (Royal African Company → African Company of Merchants → Crown, via
--          legal continuity) and capital-flow successions (DeWolf Bank of
--          Bristol capital → Industrial Trust → Fleet → Bank of America via
--          family inheritance and serial mergers, NOT corporate continuity).
--          Distinguished by the succession_kind discriminator.
--
-- Capital-flow successions use the flow_path JSONB to record each step in the
-- chain (year, entity, citation per step). Corporate-merger and other direct
-- successions don't need flow_path.
--
-- Traceability levels:
--   direct      = legal continuity (e.g., RAC → African Company of Merchants)
--   attenuated  = multi-step capital flow with intervening generations/mergers
--                 (e.g., DeWolf → Colt → Industrial Trust → Fleet → BofA)
--   partial     = claim covers some but not all of the modern entity
--
-- NO ROW INSERTS.

CREATE TABLE IF NOT EXISTS entity_successions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The relationship (polymorphic on both sides)
    predecessor_entity_type VARCHAR(50) NOT NULL,
    predecessor_entity_id UUID NOT NULL,
    successor_entity_type VARCHAR(50) NOT NULL,
    successor_entity_id UUID NOT NULL,

    -- The kind
    succession_kind VARCHAR(50) NOT NULL,

    -- Direct succession fields (used when succession_kind != 'capital_flow')
    succession_year INTEGER,
    legal_instrument TEXT,                             -- 'Act 1&2 Geo IV c.28 (1821)'

    -- Capital-flow specific (used when succession_kind = 'capital_flow')
    flow_path JSONB,                                   -- [{"step":1,"entity":"James DeWolf estate","year":1837,"citation":"..."},
                                                       --  {"step":2,"entity":"Theodora DeWolf Colt inheritance",...}, ...]

    -- Traceability assessment
    traceability VARCHAR(30) DEFAULT 'partial',

    -- Sources (primary citation; supplementary evidence via provenance_evidence)
    primary_citation TEXT,
    notes TEXT,

    -- Provenance through contribute pipeline
    contribution_status VARCHAR(30) DEFAULT 'pending_review',
    contributor_id UUID,
    approved_by UUID,
    approved_at TIMESTAMP,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT entity_succession_kind_valid CHECK (
        succession_kind IN (
            'corporate_merger',
            'corporate_acquisition',
            'dissolution_to_sovereign',
            'renaming',
            'asset_transfer',
            'capital_flow',
            'spin_off'
        )
    ),
    CONSTRAINT entity_succession_predecessor_type_valid CHECK (
        predecessor_entity_type IN (
            'chartered_company','harm_perpetrator_entity','corporate_entity',
            'canonical_person','african_polity'
        )
    ),
    CONSTRAINT entity_succession_successor_type_valid CHECK (
        successor_entity_type IN (
            'chartered_company','harm_perpetrator_entity','corporate_entity',
            'canonical_person','african_polity'
        )
    ),
    CONSTRAINT entity_succession_traceability_valid CHECK (
        traceability IN ('direct','attenuated','partial')
    ),
    CONSTRAINT entity_succession_contribution_status_valid CHECK (
        contribution_status IN ('pending_review', 'approved', 'rejected', 'needs_revision')
    ),
    CONSTRAINT entity_succession_capital_flow_requires_path CHECK (
        succession_kind != 'capital_flow' OR flow_path IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_entity_successions_predecessor ON entity_successions(predecessor_entity_type, predecessor_entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_successions_successor ON entity_successions(successor_entity_type, successor_entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_successions_kind ON entity_successions(succession_kind);
CREATE INDEX IF NOT EXISTS idx_entity_successions_status ON entity_successions(contribution_status);

COMMENT ON TABLE entity_successions IS 'Generalized successions: covers both corporate succession (legal merger/dissolution/acquisition with legal_instrument cited) AND capital-flow succession (family wealth chains where modern entity inherits capital through generations and mergers, not corporate continuity). flow_path JSONB documents each step for capital_flow kind. Lets the platform distinguish "JPMorgan inherited the loans" (direct) from "Bank of America inherited the wealth" (attenuated).';
COMMENT ON COLUMN entity_successions.traceability IS 'direct = legal continuity. attenuated = multi-step capital flow. partial = claim covers some but not all of the modern entity. The platform should never overclaim — attenuated and partial successions must be presented as such, not as direct liability.';
