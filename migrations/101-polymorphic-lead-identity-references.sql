-- Migration 101: Polymorphic person references — make LEADS first-class in the
--                identity-resolution layer (one dedup layer across leads + canonicals).
--
-- Plan: memory-bank/plan-lead-identity-resolution.md (decision (i), user Jun 24 2026).
-- A "subject" becomes (subject_table, subject_id) so a lead (slavevoyages_past_people,
-- hall_slave_records, unconfirmed_persons, …) lives in the SAME blocking/candidate pool
-- as canonical_persons — so already-verified info never orphans when future inflow
-- (e.g. a descendant's document) needs to find an existing ancestor lead.
--
-- SCOPE (first step, minimal + safe): blocking keys go polymorphic; lead↔canonical
-- candidates (cross_source_candidates) become lead-table-safe. DEFERRED (separate
-- migration, low-yield for curated PAST + would destabilize the working canonical
-- dedup + its /review UI): generalizing dedup_candidate_pairs to lead↔lead pairs.
--
-- Additive + backfill. No data dropped. Polymorphic tables carry NO cross-parent FK
-- (project precedent: provenance_evidence) — losing ON DELETE CASCADE on blocking keys
-- is an accepted tradeoff; the dedup/merge process owns cleanup.

-- ───────────────────────────────────────────────────────────────────────────
-- 1) person_blocking_keys: canonical-only → polymorphic subject.
--    Was: PK (canonical_person_id, key_value), FK canonical_person_id→canonical CASCADE.
ALTER TABLE person_blocking_keys ADD COLUMN IF NOT EXISTS subject_table VARCHAR(48);
ALTER TABLE person_blocking_keys ADD COLUMN IF NOT EXISTS subject_id    INTEGER;

UPDATE person_blocking_keys
   SET subject_table = 'canonical_persons', subject_id = canonical_person_id
 WHERE subject_table IS NULL;

ALTER TABLE person_blocking_keys ALTER COLUMN subject_table SET NOT NULL;
ALTER TABLE person_blocking_keys ALTER COLUMN subject_id    SET NOT NULL;

-- drop the canonical-only PK + FK so lead rows (no canonical_person_id) are allowed;
-- keep canonical_person_id as a nullable convenience for existing canonical reads.
ALTER TABLE person_blocking_keys DROP CONSTRAINT person_blocking_keys_pkey;
ALTER TABLE person_blocking_keys DROP CONSTRAINT person_blocking_keys_canonical_person_id_fkey;
ALTER TABLE person_blocking_keys ALTER COLUMN canonical_person_id DROP NOT NULL;

-- new polymorphic identity (preserves the old "one key_value per subject" semantics)
ALTER TABLE person_blocking_keys
  ADD CONSTRAINT person_blocking_keys_pkey PRIMARY KEY (subject_table, subject_id, key_value);
CREATE INDEX IF NOT EXISTS idx_pbk_subject ON person_blocking_keys(subject_table, subject_id);
-- idx_pbk_key_value (existing) still serves the blocking lookup by key_value.

-- ───────────────────────────────────────────────────────────────────────────
-- 2) cross_source_candidates: lead↔canonical candidates become lead-table-safe.
--    unconfirmed_lead_id has no FK (already source-agnostic); add lead_table so a
--    PAST-lead id can't collide with an unconfirmed_persons id of the same integer.
ALTER TABLE cross_source_candidates
  ADD COLUMN IF NOT EXISTS lead_table VARCHAR(48) NOT NULL DEFAULT 'unconfirmed_persons';

ALTER TABLE cross_source_candidates DROP CONSTRAINT IF EXISTS cross_source_pair_unique;
ALTER TABLE cross_source_candidates
  ADD CONSTRAINT cross_source_pair_unique UNIQUE (canonical_person_id, lead_table, unconfirmed_lead_id);
CREATE INDEX IF NOT EXISTS idx_xsrc_lead_table ON cross_source_candidates(lead_table, unconfirmed_lead_id);

-- (dedup_candidate_pairs unchanged this migration — canonical↔canonical only for now.)
