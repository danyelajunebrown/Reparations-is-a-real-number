-- Migration 053: enslaver_evidence_compendium
-- Date: 2026-04-29
--
-- Per memory-bank/plan-apr29-will-source-registry-dual-ledger-daa.md §2.M053.
--
-- Per-canonical-person aggregate of every evidence claim about
-- enslaver status, additive-only. The whole architectural point of this
-- table is to make classification (canonical_persons.person_type) a
-- DETERMINISTIC ROLLUP of accumulated evidence rather than a single-
-- document verdict.
--
-- The Henry Weaver lesson (plan §6.2): his own 1893 will named zero
-- enslaved persons, BUT cross-source enrichment yielded —
--   - civilwardc_petitions row: claimed Jane Johnson 1862
--   - hynson 1849 custody record: Patrick & Cato released to him
--   - inheritance chain: Basil Barnes 1845 estate → wife's children
--   - 1860 census: documented enslavement records
-- Each is one row in this compendium. Rolled up, Henry Weaver's
-- person_type='enslaver'. The will-only path would have classified him
-- as not-enslaver — exactly the occlusion the project is built to avoid.
--
-- ADDITIVE-ONLY: corrections are new rows, not updates. Enforced at the
-- application layer (compiler service). A trigger could enforce it but
-- creates friction during legitimate schema evolution; we trust the
-- service layer + the explicit ingested_at audit trail.

CREATE TABLE IF NOT EXISTS enslaver_evidence_compendium (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    canonical_person_id INTEGER NOT NULL REFERENCES canonical_persons(id) ON DELETE CASCADE,

    -- Where this evidence came from. evidence_source_table values include:
    -- 'civilwardc_petitions','slaveholding_relationships','land_transfer_events',
    -- 'corporate_slavery_evidence','will_extractions','ship_manifest',
    -- 'slave_schedule_1850','slave_schedule_1860','hynson_runaway_cases',
    -- 'inheritance_chains','external_research_note', etc.
    evidence_source_table TEXT NOT NULL,
    evidence_source_id TEXT NOT NULL,    -- text to allow uuid+int mix across source tables

    evidence_strength TEXT NOT NULL
        CHECK (evidence_strength IN (
            'direct_primary',     -- ICHEIC Tier A: direct primary document (will, deed, petition)
            'indirect_primary',   -- ICHEIC Tier B: corroborating primary document
            'secondary',          -- ICHEIC Tier C: secondary source / kin testimony / indirect
            'inferred'            -- ICHEIC Tier D: methodology-derived inference
        )),

    -- Short human-readable summary of the claim, for reviewer dossiers
    -- and DAA methodology dossier surfacing.
    claim_summary TEXT NOT NULL,

    -- Methodology citation. REQUIRED when evidence_strength='inferred',
    -- nullable otherwise.
    methodology_id UUID,    -- FK added after M060 lands

    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ingested_by TEXT NOT NULL DEFAULT 'enslaver-evidence-compiler',

    -- ICHEIC tier requires methodology when inferred.
    CHECK (
        evidence_strength != 'inferred'
        OR methodology_id IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_enslaver_evidence_compendium_canonical_person
    ON enslaver_evidence_compendium(canonical_person_id);
CREATE INDEX IF NOT EXISTS idx_enslaver_evidence_compendium_strength
    ON enslaver_evidence_compendium(canonical_person_id, evidence_strength);
CREATE INDEX IF NOT EXISTS idx_enslaver_evidence_compendium_source
    ON enslaver_evidence_compendium(evidence_source_table, evidence_source_id);
CREATE INDEX IF NOT EXISTS idx_enslaver_evidence_compendium_ingested
    ON enslaver_evidence_compendium(ingested_at DESC);

-- A single canonical_person + source_table + source_id should be unique
-- (no double-ingestion of the same evidence row), but allowing duplicates
-- when methodology differs (e.g., re-evaluation under a new methodology).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_enslaver_evidence_compendium_per_source_method
    ON enslaver_evidence_compendium(
        canonical_person_id, evidence_source_table, evidence_source_id,
        COALESCE(methodology_id::text, '__null__')
    );

COMMENT ON TABLE enslaver_evidence_compendium IS
    'Additive-only aggregate of enslaver evidence per canonical_person. '
    'Drives canonical_persons.person_type via deterministic rollup. Never '
    'retract — corrections are new rows. See plan-apr29 §6.2 for the Henry '
    'Weaver case demonstrating why no single document can produce a '
    'classification verdict.';
