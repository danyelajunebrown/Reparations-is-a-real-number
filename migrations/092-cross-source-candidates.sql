-- Migration 092: Cross-source identity candidates (unconfirmed_persons -> canonical_persons)
--
-- The canonical<->canonical dedup (migration 091) handles duplicates WITHIN
-- canonical_persons. This table holds cross-SOURCE candidates: an
-- unconfirmed_persons lead that is probably the same historical person as an
-- existing canonical_persons row. First use: the ~24K ENSLAVER unconfirmed leads
-- that the promote/crossref pipelines never linked (confirmed_individual_id NULL).
-- Enslaver unconfirmed leads carry almost no birth/death, so scoring leans on
-- name + location (state/county from the locations array).
--
-- Reviewer actions (mirrors dedup_candidate_pairs): LINK (set the lead's
-- confirmed_individual_id to the canonical id + mark resolved) or DISTINCT/SKIP.
-- Links are HUMAN-confirmed (Biscoe rule), never auto-applied.

CREATE TABLE IF NOT EXISTS cross_source_candidates (
    id                   BIGSERIAL PRIMARY KEY,
    canonical_person_id  INTEGER NOT NULL REFERENCES canonical_persons(id) ON DELETE CASCADE,
    unconfirmed_lead_id  INTEGER NOT NULL,   -- unconfirmed_persons.lead_id (no FK: table churns)
    entity_kind          VARCHAR(16) NOT NULL DEFAULT 'enslaver',  -- 'enslaver' | 'enslaved' (phase B)
    score                NUMERIC(6,2) NOT NULL,
    route                VARCHAR(24) NOT NULL,   -- 'auto_link_candidate' | 'review'
    evidence             JSONB NOT NULL DEFAULT '[]'::jsonb,
    blocking_keys        TEXT[],
    canonical_name       TEXT,
    unconfirmed_name     TEXT,
    location             TEXT,                   -- normalized state/county snapshot
    status               VARCHAR(24) NOT NULL DEFAULT 'pending',  -- pending|linked|confirmed_distinct|skipped
    reviewed_by          TEXT,
    reviewed_at          TIMESTAMPTZ,
    reviewer_notes       TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT cross_source_pair_unique UNIQUE (canonical_person_id, unconfirmed_lead_id)
);
CREATE INDEX IF NOT EXISTS idx_xsrc_status ON cross_source_candidates (status, route, score DESC);
CREATE INDEX IF NOT EXISTS idx_xsrc_lead ON cross_source_candidates (unconfirmed_lead_id);
CREATE INDEX IF NOT EXISTS idx_xsrc_canon ON cross_source_candidates (canonical_person_id);
