-- Migration 086: Actor Roles
-- Date: 2026-05-23
-- Purpose: Polymorphic role assignments keyed by (actor, period, role). Per
--          user direction May 23 2026: 'raider' is not exclusively a state
--          role. Chartered companies like the Royal African Company, the
--          East India Company, and the Dutch WIC raised and commanded their
--          own armies, conducted their own conquests (Plassey 1757, Buxar
--          1764), and acted as raiders independent of any sovereign. The
--          role taxonomy therefore applies across actor types (african_polity,
--          chartered_company, harm_perpetrator_entity, canonical_person),
--          with periodization so the same actor plays different roles in
--          different centuries (Kongo: refuser_state 1500–1550 →
--          coerced_supplier 1550–1800).
--
-- Also per user direction: gun_slave_cycle_dependent was too narrow. The
-- broader pattern is manufactured_goods_dependent with a commodity sub-type
-- (cowries, firearms, textiles, iron bars, copper manilas, glass beads,
-- spirits, tobacco, mixed). This is the schema acknowledgment that the
-- pattern your TikTok source described — raw materials out, finished goods
-- in, structurally unequal — has a direct lineage from 18th-c manufactured-
-- goods dependency to 21st-c tariff escalation. Same pattern, different scale.
--
-- Each actor_role row SHOULD be supported by at least one provenance_evidence
-- record (enforced at application layer in contribute pipeline, not DB level;
-- provenance_evidence.supports_claim_type='role_classification' +
-- supports_claim_id pointing back here).
--
-- NO ROW INSERTS.

CREATE TABLE IF NOT EXISTS actor_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Polymorphic actor
    actor_entity_type VARCHAR(50) NOT NULL,
    actor_entity_id UUID NOT NULL,

    -- The role
    role_type VARCHAR(60) NOT NULL,

    -- Periodization (a single actor can have multiple role rows across periods)
    period_start INTEGER,
    period_end INTEGER,

    -- For manufactured_goods_dependent role
    dependency_commodity VARCHAR(50),
    dependency_notes TEXT,

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

    CONSTRAINT actor_roles_actor_type_valid CHECK (
        actor_entity_type IN (
            'african_polity','chartered_company','harm_perpetrator_entity','canonical_person'
        )
    ),
    CONSTRAINT actor_roles_role_type_valid CHECK (
        role_type IN (
            'raider',
            'raiding_state',
            'middleman',
            'middleman_state',
            'coerced_supplier',
            'refuser_state',
            'sovereign_extractor',
            'manufactured_goods_dependent',
            'financier',
            'insurer',
            'transporter',
            'plantation_operator',
            'enslaver_owner'
        )
    ),
    CONSTRAINT actor_roles_dependency_commodity_valid CHECK (
        dependency_commodity IS NULL OR dependency_commodity IN (
            'cowries','firearms','textiles','iron_bars','copper_manilas',
            'glass_beads','spirits','tobacco','mixed'
        )
    ),
    CONSTRAINT actor_roles_dependency_commodity_only_for_dependent CHECK (
        dependency_commodity IS NULL OR role_type = 'manufactured_goods_dependent'
    ),
    CONSTRAINT actor_roles_contribution_status_valid CHECK (
        contribution_status IN ('pending_review', 'approved', 'rejected', 'needs_revision')
    ),
    CONSTRAINT actor_roles_period_range_valid CHECK (
        period_end IS NULL OR period_start IS NULL OR period_end >= period_start
    )
);

CREATE INDEX IF NOT EXISTS idx_actor_roles_actor ON actor_roles(actor_entity_type, actor_entity_id);
CREATE INDEX IF NOT EXISTS idx_actor_roles_role ON actor_roles(role_type);
CREATE INDEX IF NOT EXISTS idx_actor_roles_period ON actor_roles(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_actor_roles_status ON actor_roles(contribution_status);

COMMENT ON TABLE actor_roles IS 'Role assignments keyed by (actor, period, role). The same actor can play multiple roles in the same period (Asante was both raiding_state AND middleman_state 1700-1820) or different roles across periods (Kongo was refuser_state 1500-1550, then coerced_supplier 1550-1800). Role taxonomy applies across actor types because raider, middleman, and financier roles were played by polities, chartered companies, and individuals alike.';
COMMENT ON COLUMN actor_roles.dependency_commodity IS 'Only used when role_type=manufactured_goods_dependent. Tracks which European-manufactured good carried the load of unequal exchange in a given period and region: cowries (Bight of Biafra/Whydah 17th-18th c.), firearms (Senegambia + Gold Coast 18th c.), textiles (Bight of Biafra + Loango Coast), iron bars (Senegambia), copper manilas (Niger Delta), glass beads (Angola), spirits, tobacco. The patterns are direct ancestors of modern tariff-escalation regimes.';
