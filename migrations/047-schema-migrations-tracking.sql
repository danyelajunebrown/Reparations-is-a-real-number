-- Migration 047: schema_migrations tracking table
-- Date: 2026-04-28
--
-- Until this migration, there was no source-of-truth for which migrations
-- had been applied to the live database. Migrations were run by hand —
-- some completed, some were partially applied, some were documented as
-- "intentionally retired" in commits but never tracked anywhere queryable.
--
-- This table lets `scripts/apply-migrations.js` distinguish:
--   - applied (filename present, checksum matches)
--   - unapplied (filename absent → run it)
--   - modified-after-apply (checksum mismatch → refuse, requires intervention)
--   - retired (applied_by='retired' → skip permanently, documented why)
--
-- Backfill of pre-existing migrations is done by
-- `scripts/backfill-migrations.js`, which marks observed-applied migrations
-- as applied without re-running them.

CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT NOW(),
    checksum TEXT NOT NULL,
    applied_by TEXT NOT NULL DEFAULT 'apply-migrations.js',
    runtime_ms INTEGER,
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied_at
    ON schema_migrations(applied_at);

COMMENT ON TABLE schema_migrations IS
'Tracks which migration files have been applied to this database. applied_by values: apply-migrations.js (normal), backfill (retroactively recorded by backfill-migrations.js for pre-runner state), retired (file exists in migrations/ but was intentionally never applied, see notes). checksum is SHA-256 of the file contents at apply time, mismatch on a later run means the file was edited after being applied, which is disallowed and the runner refuses to proceed.';

COMMENT ON COLUMN schema_migrations.checksum IS
'SHA-256 hex of the migration file contents at apply time.';

COMMENT ON COLUMN schema_migrations.applied_by IS
'Source: apply-migrations.js (normal apply), backfill (retroactive), retired
(documented non-application).';

COMMENT ON COLUMN schema_migrations.notes IS
'Free-text. For retired migrations: explain why retired. For backfilled:
note any caveats (e.g. "M011 partial — only historical_reparations_petitions").';
