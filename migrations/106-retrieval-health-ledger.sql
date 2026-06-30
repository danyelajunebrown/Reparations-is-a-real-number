-- Migration 106: retrieval-health ledger (Phase 1 of automated retrieval epistemology)
-- Plan: catch UNMONITORED retrieval-integrity failures end-to-end (the FamilySearch-login-wall class:
-- a record that exists in the DB but is not actually retrievable/displayable to the front end).
-- scripts/retrieval-health-audit.mjs writes one row per (subject, check) per run; run-over-run diffs
-- surface regressions, and a deploy is gated on the score. This is the foundation the Phase-2
-- RAG/retrieval-feedback layer builds on.

CREATE TABLE IF NOT EXISTS retrieval_health_ledger (
  id            BIGSERIAL PRIMARY KEY,
  run_id        UUID NOT NULL,
  checked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  subject_type  TEXT NOT NULL,                 -- 'canonical_person' | 'person_document'
  subject_id    TEXT NOT NULL,                 -- id of the person/document checked
  check_name    TEXT NOT NULL,                 -- e.g. gate_consistency, s3_fetchable, has_blocking_keys
  status        TEXT NOT NULL,                 -- 'ok' | 'warn' | 'fail'
  severity      TEXT NOT NULL DEFAULT 'info',  -- 'info' | 'low' | 'high' | 'critical'
  detail        JSONB,
  CONSTRAINT retrieval_health_status_chk CHECK (status IN ('ok','warn','fail'))
);

-- Query the latest run fast; find failures fast.
CREATE INDEX IF NOT EXISTS idx_rhl_run ON retrieval_health_ledger (run_id);
CREATE INDEX IF NOT EXISTS idx_rhl_failures ON retrieval_health_ledger (check_name, status) WHERE status <> 'ok';
CREATE INDEX IF NOT EXISTS idx_rhl_subject ON retrieval_health_ledger (subject_type, subject_id);

COMMENT ON TABLE retrieval_health_ledger IS
  'Phase-1 retrieval-integrity ledger (M106). One row per (subject, check) per audit run. Exercises the real frontend retrieval path (resolve/gate/presign/S3-fetch) so silent availability bugs surface automatically and the deploy can be gated on the score.';
