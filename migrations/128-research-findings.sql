-- 128-research-findings.sql — a first-class log of research ACTIONS, including the ones that found nothing.
--
-- The project's evidence model records what we FOUND (documents, edges, valuations). It has no place to
-- record what we LOOKED FOR and did not find — and a null result is evidence. "Searched the DC Recorder of
-- Deeds grantee index, surname KRICK, 1970-2024, Square 1232 — no hit" is a real finding: it narrows the
-- chain of title, and it stops the next session from re-running the same dead search.
--
-- The load-bearing value is 'truncated'. A search that CAPS (the DC publicsearch.us Square-1232 sweeps that
-- returned ~100 rows and stopped mid-alphabet at "BL" / "HO") is NOT a 'none'. A naive logger that records a
-- capped sweep as 'none' makes the reader conclude the OPPOSITE of the truth — that the record isn't there,
-- when in fact the search never reached it. 'truncated' forces that distinction into the schema.
--
-- Polymorphic subject (M103 pattern) so a finding can attach to a canonical person OR a lead OR nothing.
-- `supersedes` lets a later, wider search retire an earlier truncated/partial one without deleting the trail.
-- Idempotent (CREATE TABLE IF NOT EXISTS). No fabricated data — a finding is a logged action, not a claim.

CREATE TABLE IF NOT EXISTS research_findings (
  finding_id      BIGSERIAL PRIMARY KEY,
  question        TEXT NOT NULL,          -- 'deed into Olga H. Krick, Sq 1232 Lot 816'
  repository      TEXT NOT NULL,          -- 'DC Recorder of Deeds (publicsearch.us)'
  index_searched  TEXT NOT NULL,          -- 'grantee index, surname KRICK'
  scope_start     DATE,
  scope_end       DATE,
  scope_note      TEXT,                   -- 'square/lot blank; fuzzy surname'
  result          TEXT NOT NULL CHECK (result IN ('hit','none','partial','truncated','inaccessible')),
  hit_count       INTEGER,
  subject_table   TEXT,                   -- polymorphic (M103): 'canonical_persons' | 'unconfirmed_persons' | 'properties' | NULL
  subject_id      BIGINT,
  evidence_note   TEXT,                   -- what the null / partial proves
  searched_by     TEXT,
  searched_at     TIMESTAMPTZ DEFAULT now(),
  supersedes      BIGINT REFERENCES research_findings(finding_id)
);

CREATE INDEX IF NOT EXISTS idx_research_findings_subject
  ON research_findings (subject_table, subject_id);
CREATE INDEX IF NOT EXISTS idx_research_findings_result
  ON research_findings (result);

COMMENT ON TABLE research_findings IS
  'Log of research actions and their outcomes, INCLUDING null results. A null/truncated search is evidence and prevents re-running dead searches.';
COMMENT ON COLUMN research_findings.result IS
  'hit | none | partial | truncated | inaccessible. truncated is load-bearing: a capped/paginated-out sweep is NOT a none — recording it as none inverts the truth.';
