-- Migration 126: linkage_verdicts — ground-truth verdicts for the Dutchess calibration case study
-- Date: 2026-07-19
--
-- WHY: the calibration study (Roth & Tolbert 2025 multicalibration) needs recorded ground-truth
-- verdicts F(e) to compare against the model's predicted confidence f(X,E) and estimate per-link
-- accuracy p / squared error E. Today there is NO verdict table: generate-climb-accuracy-audit.mjs
-- PRINTS verdicts on paper for participants and never writes them back, so only ~2 human verdicts
-- exist DB-wide (assessment-dutchess-calibration-case-study-jul19.md §1). This is that table.
--
-- The edge under calibration is the ENSLAVER-ANCHORED attribution (user decision 2026-07-19; the
-- child->mother micro-link is too sparse in the surviving records — assessment §6.4):
--   f(X,E | e) = P( person X descends from a documented enslaved person held by enslaver E | e ).
-- Each row stores the model's confidence at verdict time so predicted-vs-actual bins are computable —
-- that binning IS the calibration measurement. See plan-dutchess-calibration-stage1.md §2.
--
-- Additive, guarded, no data.

CREATE TABLE IF NOT EXISTS linkage_verdicts (
    id                 SERIAL PRIMARY KEY,

    -- The asserted edge under test (polymorphic — a climb match, an owner-edge, a parent link, or a
    -- whole modern-person->enslaver attribution). subject_ref is a free-form pointer into the source
    -- table (e.g. 'ancestor_climb_matches:1234', 'owner_edge:5678', 'lead:123->lead:456').
    subject_kind       TEXT NOT NULL CHECK (subject_kind IN
                         ('climb_match','owner_edge','parent_link','attribution')),
    subject_ref        TEXT NOT NULL,

    -- Endpoints (nullable — not every verdict has all three resolved).
    modern_person_ref  TEXT,        -- living/modern endpoint (FS id / lead ref)
    enslaver_ref       TEXT,        -- enslaver endpoint (canonical_persons id / lead ref)
    enslaved_ref       TEXT,        -- the documented enslaved person (lead ref), when known

    -- The verdict itself.
    verdict            TEXT NOT NULL CHECK (verdict IN ('confirmed','refuted','uncertain')),
    basis              TEXT NOT NULL CHECK (basis IN ('document','participant','researcher')),
    evidence_doc_id    INTEGER,     -- person_documents.id backing a documentary verdict
    evidence_note      TEXT,

    -- Calibration bookkeeping — the model's prediction at verdict time + how to bucket it.
    model_confidence   NUMERIC,     -- f(X,E) in [0,1] when the verdict was recorded
    model_version      TEXT,        -- climber/methodology version producing model_confidence
    reference_class    TEXT,        -- e.g. 'Rhinebeck|1755|holding_1_5' (town|decade|holding-size)

    verified_by        TEXT,
    created_at         TIMESTAMPTZ DEFAULT NOW(),
    updated_at         TIMESTAMPTZ DEFAULT NOW(),

    -- One standing verdict per (edge, basis) — re-verifying updates rather than duplicates.
    UNIQUE (subject_kind, subject_ref, basis)
);

CREATE INDEX IF NOT EXISTS idx_linkage_verdicts_subject ON linkage_verdicts(subject_kind, subject_ref);
CREATE INDEX IF NOT EXISTS idx_linkage_verdicts_verdict ON linkage_verdicts(verdict);
CREATE INDEX IF NOT EXISTS idx_linkage_verdicts_refclass ON linkage_verdicts(reference_class);
CREATE INDEX IF NOT EXISTS idx_linkage_verdicts_enslaver ON linkage_verdicts(enslaver_ref);

COMMENT ON TABLE linkage_verdicts IS
  'Ground-truth verdicts F(e) for the Dutchess enslaver-anchored calibration. Each row pairs an '
  'asserted attribution edge with a confirmed/refuted/uncertain verdict (document|participant|'
  'researcher) AND the model confidence f(X,E) at verdict time, so predicted-vs-actual bins → per-link '
  'p and E. Replaces the paper-only audit packet, which never wrote verdicts back.';
