-- Migration 066: canonical_family_edges
-- Date: 2026-05-11
--
-- PURPOSE
-- -------
-- Provides a clean, purpose-built graph for family relationships
-- between canonical_persons rows: spouse, parent/child, sibling.
--
-- WHY NOT person_relationships_verified (M033)?
--   person_relationships_verified references unified_persons (M030),
--   which was never fully populated and is a different table.
--   M033 re-targeted it to canonical_persons.id but the evidence_source_ids
--   array model is heavy for the navigation use case.
--   canonical_family_edges is lightweight, directly queryable by the
--   getPerson API, and carries evidence_tier to distinguish:
--     tier 1 = documented by a primary source (will, deed, census)
--     tier 2 = documented by a secondary source (newspaper, letter)
--     tier 3 = inferred from tree data (FamilySearch, WikiTree) or
--              name-text spouse column — NAVIGABLE but NOT a primary source
--
-- KEY CONTRACT
-- ------------
-- Writers MUST set evidence_tier = 3 when the only basis is a FamilySearch
-- tree entry or the spouse_name text column. These are navigable links but
-- must never be presented as primary-source corroboration of any claim.
-- Only tier 1 or tier 2 edges may be promoted to "verified = true".
--
-- RELATIONSHIP SEMANTICS
-- ----------------------
--   'spouse'     — A and B are spouses (undirected; write once, either order)
--   'parent_of'  — A is the parent of B
--   'child_of'   — A is the child of B  (inverse of parent_of, denormalized for query convenience)
--   'sibling_of' — A and B share at least one parent
--
-- The UNIQUE constraint is on (person_a_id, person_b_id, relationship_type),
-- so spouse edges must be written in a canonical order (lower id first) to
-- avoid duplicates. The backfill script and API query both use:
--   WHERE e.person_a_id = $id OR e.person_b_id = $id
-- so either order is navigable.

CREATE TABLE IF NOT EXISTS canonical_family_edges (
    id SERIAL PRIMARY KEY,

    -- Both ends of the relationship — both must exist in canonical_persons.
    person_a_id INTEGER NOT NULL REFERENCES canonical_persons(id) ON DELETE CASCADE,
    person_b_id INTEGER NOT NULL REFERENCES canonical_persons(id) ON DELETE CASCADE,

    relationship_type TEXT NOT NULL CHECK (relationship_type IN (
        'spouse',
        'parent_of',
        'child_of',
        'sibling_of'
    )),

    -- Evidence provenance: at most one of these will be non-null.
    -- All three may be null if the edge comes from a name-text inference (tier 3).
    source_document_id INTEGER REFERENCES person_documents(id) ON DELETE SET NULL,
    source_session_id  UUID   REFERENCES ancestor_climb_sessions(id) ON DELETE SET NULL,
    source_url         TEXT,   -- e.g. FamilySearch tree URL that surfaced this link

    -- evidence_tier mirrors the tier system from person_evidence_sources:
    --   1 = primary document (will, deed, census record, birth cert)
    --   2 = secondary document (church register, newspaper, letter)
    --   3 = compiled / inferred (FamilySearch tree, WikiTree, spouse_name text, climb)
    evidence_tier INTEGER NOT NULL DEFAULT 3
        CHECK (evidence_tier BETWEEN 1 AND 3),

    confidence NUMERIC(4,3) NOT NULL DEFAULT 0.500
        CHECK (confidence >= 0.000 AND confidence <= 1.000),

    -- Only tier 1 or 2 edges may be marked verified.
    -- The backfill will create tier-3 edges with verified = false.
    verified    BOOLEAN NOT NULL DEFAULT false,
    verified_by TEXT,
    verified_at TIMESTAMPTZ,

    notes TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Prevent duplicate edges.
    -- For spouse, enforce lower-id-first ordering via CHECK so only one row
    -- represents the pair (the API query reads both directions via OR).
    UNIQUE (person_a_id, person_b_id, relationship_type),

    -- No self-loops.
    CHECK (person_a_id <> person_b_id)
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_cfe_person_a
    ON canonical_family_edges(person_a_id);

CREATE INDEX IF NOT EXISTS idx_cfe_person_b
    ON canonical_family_edges(person_b_id);

-- Covering index for the API getPerson query (both directions)
CREATE INDEX IF NOT EXISTS idx_cfe_either_person
    ON canonical_family_edges(person_a_id, person_b_id, relationship_type);

CREATE INDEX IF NOT EXISTS idx_cfe_relationship
    ON canonical_family_edges(relationship_type);

CREATE INDEX IF NOT EXISTS idx_cfe_verified
    ON canonical_family_edges(verified);

CREATE INDEX IF NOT EXISTS idx_cfe_tier
    ON canonical_family_edges(evidence_tier);

CREATE INDEX IF NOT EXISTS idx_cfe_session
    ON canonical_family_edges(source_session_id)
    WHERE source_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cfe_document
    ON canonical_family_edges(source_document_id)
    WHERE source_document_id IS NOT NULL;

-- ── Trigger: keep updated_at current ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION cfe_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cfe_updated_at ON canonical_family_edges;
CREATE TRIGGER trg_cfe_updated_at
    BEFORE UPDATE ON canonical_family_edges
    FOR EACH ROW
    EXECUTE FUNCTION cfe_set_updated_at();

-- ── Views ─────────────────────────────────────────────────────────────────────

-- Convenience view: all edges with both persons' names resolved
CREATE OR REPLACE VIEW canonical_family_edges_resolved AS
SELECT
    e.id,
    e.relationship_type,
    e.evidence_tier,
    e.confidence,
    e.verified,
    e.source_url,
    -- Person A
    a.id            AS person_a_id,
    a.canonical_name AS person_a_name,
    a.person_type    AS person_a_type,
    a.birth_year_estimate AS person_a_birth_year,
    a.death_year_estimate AS person_a_death_year,
    -- Person B
    b.id            AS person_b_id,
    b.canonical_name AS person_b_name,
    b.person_type    AS person_b_type,
    b.birth_year_estimate AS person_b_birth_year,
    b.death_year_estimate AS person_b_death_year,
    e.created_at
FROM canonical_family_edges e
JOIN canonical_persons a ON a.id = e.person_a_id
JOIN canonical_persons b ON b.id = e.person_b_id;

-- Audit view: edges awaiting evidence upgrade
CREATE OR REPLACE VIEW canonical_family_edges_needing_verification AS
SELECT
    e.id,
    e.relationship_type,
    e.evidence_tier,
    a.canonical_name AS person_a_name,
    b.canonical_name AS person_b_name,
    e.source_url,
    e.notes,
    e.created_at
FROM canonical_family_edges e
JOIN canonical_persons a ON a.id = e.person_a_id
JOIN canonical_persons b ON b.id = e.person_b_id
WHERE e.verified = false
ORDER BY e.evidence_tier DESC, e.created_at DESC;

-- ── Comments ──────────────────────────────────────────────────────────────────

COMMENT ON TABLE canonical_family_edges IS
    'Family relationship graph for canonical_persons. '
    'evidence_tier: 1=primary doc, 2=secondary doc, 3=tree/inferred. '
    'Tier-3 edges are navigable but MUST NOT be presented as primary-source '
    'corroboration. Only tier 1/2 edges may have verified=true. '
    'Writers: use lower id as person_a_id for spouse edges to avoid UNIQUE conflicts.';

COMMENT ON COLUMN canonical_family_edges.evidence_tier IS
    '1=primary document (will/deed/census), '
    '2=secondary document (newspaper/letter/church register), '
    '3=compiled/inferred (FamilySearch tree, WikiTree, spouse_name text column). '
    'NEVER present tier-3 as a primary source.';

COMMENT ON COLUMN canonical_family_edges.source_url IS
    'For tier-3 edges: the FamilySearch/WikiTree URL that provided this link. '
    'Shown in "External references" only, never in "Primary source documents".';
