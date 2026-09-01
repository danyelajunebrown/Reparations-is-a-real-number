-- Migration 123: trigram index on slave-schedule leads' owner name (#142 build 3).
-- Makes owner-name aggregation of the 1.4M owner-referenced enslaved leads FAST (was a full
-- JSONB seq-scan per holder). Consumed by scripts/link-distributed-enslaved-edges.mjs (persists the
-- distributed count as enslaved_owner_relationships edges) and enslaved-count.js includeIndexLeads.
--
-- APPLY OFF-PEAK, CONCURRENTLY: unconfirmed_persons is written live by the scrapers; a plain
-- CREATE INDEX would lock writes for the duration of a 1.4M-row build. CONCURRENTLY cannot run
-- inside a transaction — run this statement standalone (not via a wrapping migration txn).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_unconfirmed_enslaved_owner_trgm
  ON unconfirmed_persons USING gin ((relationships->>'owner') gin_trgm_ops)
  WHERE person_type = 'enslaved';
