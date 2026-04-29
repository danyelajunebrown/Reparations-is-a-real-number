-- Migration 052: slaveholding_relationships
-- Date: 2026-04-29
--
-- Per memory-bank/plan-apr29-will-source-registry-dual-ledger-daa.md §2.M052.
--
-- Replaces the binary family_relationships(enslaved_by) surface with a
-- typed relationship spectrum. Critical for closing the Henry Weaver
-- occlusion gap: Weaver's own will named zero enslaved persons, but
-- cross-source enrichment surfaced —
--   - Owned: Jane Johnson (1862 DC compensation petition)
--   - Possessed: Patrick & Cato (1849 Hynson custody record, no title)
--   - Controlled-via-marriage: Mary Ann's enslaved brought into household
--   - Controlled-via-stepfamily: Dennis/Cato/Sarah inherited by stepchildren
-- A binary enslaved_by could not represent these distinctions; this
-- typed table can.
--
-- Eltis methodology (JSDP 2021) inclusion gate: a row requires a
-- date window (or inferred era), relationship type, place, and at least
-- one source citation. Below this threshold no row, even if a name
-- appears. Enforced via CHECK + the application layer (compiler service).
--
-- family_relationships(enslaved_by) is retained but considered LEGACY;
-- new ingestion writes here. A future migration may backfill from
-- legacy into this table.

CREATE TABLE IF NOT EXISTS slaveholding_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Enslaver side: required.
    enslaver_canonical_id INTEGER NOT NULL REFERENCES canonical_persons(id) ON DELETE CASCADE,

    -- Enslaved side: at least one of these three references is required.
    -- enslaved_individuals uses VARCHAR(255) PK 'enslaved_id', not int.
    -- unconfirmed_persons uses 'lead_id' INT.
    -- trace_observations is added in M058; we forward-declare nullable text
    -- to avoid forward-FK dependency, then ALTER to add the FK in M058.
    enslaved_individual_id VARCHAR(255) REFERENCES enslaved_individuals(enslaved_id) ON DELETE SET NULL,
    enslaved_unconfirmed_id INTEGER REFERENCES unconfirmed_persons(lead_id) ON DELETE SET NULL,
    enslaved_trace_observation_id UUID,    -- FK added in M058

    relationship_type TEXT NOT NULL
        CHECK (relationship_type IN (
            'owned',                       -- title — direct ownership documented
            'possessed',                   -- custody without title (e.g., fugitive released to enslaver)
            'harbored',                    -- harbored a fugitive
            'hired',                       -- hired-out arrangement
            'used',                        -- working for enslaver without title
            'controlled_via_marriage',     -- enslaved brought in via spouse
            'controlled_via_stepfamily',   -- enslaved inherited by stepchildren in household
            'profited_from'                -- e.g., insurance, sale commission, hire fees
        )),

    -- Date window for the relationship. At least one bound or era_inferred required.
    date_window_start DATE,
    date_window_end DATE,
    era_inferred TEXT,                     -- e.g., 'antebellum_dc' when no precise dates exist

    place_text TEXT NOT NULL,              -- typed place_id reference deferred

    -- Source citation. Either a typed pointer to a source row or a methodology
    -- (for inferred relationships). At least one of (source, methodology) required.
    evidence_source_table TEXT,            -- e.g., 'civilwardc_petitions','will_extractions'
    evidence_source_id TEXT,               -- record id in that table (text to allow uuid+int mix)
    methodology_id UUID,                   -- FK added after M060 lands

    -- Eltis-style explicit uncertainty bound on the existence of the
    -- relationship itself (not the value of stolen labor — that's elsewhere).
    -- 0.0–1.0, nullable when irrelevant (direct primary).
    confidence_low NUMERIC(3,2)
        CHECK (confidence_low IS NULL OR (confidence_low >= 0.0 AND confidence_low <= 1.0)),
    confidence_high NUMERIC(3,2)
        CHECK (confidence_high IS NULL OR (confidence_high >= 0.0 AND confidence_high <= 1.0)),

    notes TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Inclusion gate: at least one enslaved-side reference.
    CHECK (
        enslaved_individual_id IS NOT NULL
        OR enslaved_unconfirmed_id IS NOT NULL
        OR enslaved_trace_observation_id IS NOT NULL
    ),

    -- Inclusion gate: at least one date bound or era_inferred.
    CHECK (
        date_window_start IS NOT NULL
        OR date_window_end IS NOT NULL
        OR era_inferred IS NOT NULL
    ),

    -- Inclusion gate: at least one source citation OR methodology.
    CHECK (
        (evidence_source_table IS NOT NULL AND evidence_source_id IS NOT NULL)
        OR methodology_id IS NOT NULL
    ),

    -- Date order if both set.
    CHECK (
        date_window_end IS NULL
        OR date_window_start IS NULL
        OR date_window_end >= date_window_start
    ),

    -- Confidence bound order if both set.
    CHECK (
        confidence_low IS NULL
        OR confidence_high IS NULL
        OR confidence_low <= confidence_high
    )
);

CREATE INDEX IF NOT EXISTS idx_slaveholding_relationships_enslaver
    ON slaveholding_relationships(enslaver_canonical_id);
CREATE INDEX IF NOT EXISTS idx_slaveholding_relationships_enslaved_indiv
    ON slaveholding_relationships(enslaved_individual_id) WHERE enslaved_individual_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_slaveholding_relationships_enslaved_unconf
    ON slaveholding_relationships(enslaved_unconfirmed_id) WHERE enslaved_unconfirmed_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_slaveholding_relationships_enslaved_trace
    ON slaveholding_relationships(enslaved_trace_observation_id) WHERE enslaved_trace_observation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_slaveholding_relationships_type
    ON slaveholding_relationships(relationship_type);
CREATE INDEX IF NOT EXISTS idx_slaveholding_relationships_evidence_source
    ON slaveholding_relationships(evidence_source_table, evidence_source_id)
    WHERE evidence_source_table IS NOT NULL;

COMMENT ON TABLE slaveholding_relationships IS
    'Typed enslaver-enslaved relationships. Replaces the binary '
    'family_relationships(enslaved_by) for nuanced cases. See plan-apr29 §6.2 '
    'for the Henry Weaver test case demonstrating why typed relationships '
    'matter (controlled_via_marriage, controlled_via_stepfamily, possessed '
    'without title via Hynson custody record).';
