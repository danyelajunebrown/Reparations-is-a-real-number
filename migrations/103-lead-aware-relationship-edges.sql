-- Migration 103: Lead-aware relationship/lineage edges (de-siloing fix #1)
-- Plan: memory-bank/plan-de-siloing-fixes.md (#1) + assessment-de-siloing-orphaning.md.
-- Decision (user, Jun 26): the M101 POLYMORPHIC (subject_table, subject_id) primitive — already
-- used by person_blocking_keys / cross_source_candidates / provenance_evidence — so ANY subject
-- (canonical OR a lead: unconfirmed_persons / slavevoyages_past_people / hall_slave_records /
-- future) can be a relationship endpoint. This fixes orphaning risk #1: the ~266K PAST+Hall leads
-- could not carry a single kin/lineage edge, so a future descendant's document had no graph path
-- to its enslaved-ancestor leads.
--
-- BACK-COMPAT: existing writers (5 scripts for canonical_family_edges; the live ancestor-climber
-- for person_relationships_verified) set the legacy canonical id columns. We KEEP those columns
-- (+ their FKs = integrity for canonical refs) and add polymorphic columns alongside, kept in sync
-- by a BEFORE INSERT/UPDATE trigger: legacy canonical id <-> ('canonical_persons', id). New
-- polymorphic writers set the subject_* columns directly (a lead endpoint leaves the legacy
-- canonical id NULL). NOT NULL on the legacy ids is relaxed so lead-only edges are possible.
-- Population of lead edges (from PAST enslavers[], Hall transfers, unconfirmed.relationships) is a
-- SEPARATE producer step; this migration makes the schema lead-capable (what #3 traversal needs).

BEGIN;

-- ============ canonical_family_edges (kinship; 1,658 rows) ============
ALTER TABLE canonical_family_edges
  ADD COLUMN IF NOT EXISTS a_subject_table TEXT,
  ADD COLUMN IF NOT EXISTS a_subject_id    INTEGER,
  ADD COLUMN IF NOT EXISTS b_subject_table TEXT,
  ADD COLUMN IF NOT EXISTS b_subject_id    INTEGER;
ALTER TABLE canonical_family_edges ALTER COLUMN person_a_id DROP NOT NULL;
ALTER TABLE canonical_family_edges ALTER COLUMN person_b_id DROP NOT NULL;

UPDATE canonical_family_edges
   SET a_subject_table = 'canonical_persons', a_subject_id = person_a_id,
       b_subject_table = 'canonical_persons', b_subject_id = person_b_id
 WHERE a_subject_id IS NULL OR b_subject_id IS NULL;

CREATE OR REPLACE FUNCTION sync_cfe_subject_refs() RETURNS trigger AS $$
BEGIN
  -- legacy canonical id -> polymorphic
  IF NEW.a_subject_id IS NULL AND NEW.person_a_id IS NOT NULL THEN
    NEW.a_subject_table := 'canonical_persons'; NEW.a_subject_id := NEW.person_a_id;
  END IF;
  IF NEW.b_subject_id IS NULL AND NEW.person_b_id IS NOT NULL THEN
    NEW.b_subject_table := 'canonical_persons'; NEW.b_subject_id := NEW.person_b_id;
  END IF;
  -- polymorphic canonical -> legacy id (keeps legacy readers + the canonical FK valid)
  IF NEW.person_a_id IS NULL AND NEW.a_subject_table = 'canonical_persons' THEN NEW.person_a_id := NEW.a_subject_id; END IF;
  IF NEW.person_b_id IS NULL AND NEW.b_subject_table = 'canonical_persons' THEN NEW.person_b_id := NEW.b_subject_id; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_cfe_sync_subject ON canonical_family_edges;
CREATE TRIGGER trg_cfe_sync_subject BEFORE INSERT OR UPDATE ON canonical_family_edges
  FOR EACH ROW EXECUTE FUNCTION sync_cfe_subject_refs();

CREATE INDEX IF NOT EXISTS idx_cfe_a_subject ON canonical_family_edges (a_subject_table, a_subject_id);
CREATE INDEX IF NOT EXISTS idx_cfe_b_subject ON canonical_family_edges (b_subject_table, b_subject_id);
-- dedup edges across ALL subject types (covers lead edges the legacy id-only unique can't)
CREATE UNIQUE INDEX IF NOT EXISTS uq_cfe_subject_edge
  ON canonical_family_edges (a_subject_table, a_subject_id, b_subject_table, b_subject_id, relationship_type)
  WHERE a_subject_id IS NOT NULL AND b_subject_id IS NOT NULL;

-- ============ person_relationships_verified (kinship; 12 rows; live climber writer) ============
ALTER TABLE person_relationships_verified
  ADD COLUMN IF NOT EXISTS person_subject_table  TEXT,
  ADD COLUMN IF NOT EXISTS person_subject_id     INTEGER,
  ADD COLUMN IF NOT EXISTS related_subject_table TEXT,
  ADD COLUMN IF NOT EXISTS related_subject_id    INTEGER;
ALTER TABLE person_relationships_verified ALTER COLUMN person_id DROP NOT NULL;
ALTER TABLE person_relationships_verified ALTER COLUMN related_person_id DROP NOT NULL;

UPDATE person_relationships_verified
   SET person_subject_table = 'canonical_persons', person_subject_id = person_id,
       related_subject_table = 'canonical_persons', related_subject_id = related_person_id
 WHERE person_subject_id IS NULL OR related_subject_id IS NULL;

CREATE OR REPLACE FUNCTION sync_prv_subject_refs() RETURNS trigger AS $$
BEGIN
  IF NEW.person_subject_id IS NULL AND NEW.person_id IS NOT NULL THEN
    NEW.person_subject_table := 'canonical_persons'; NEW.person_subject_id := NEW.person_id;
  END IF;
  IF NEW.related_subject_id IS NULL AND NEW.related_person_id IS NOT NULL THEN
    NEW.related_subject_table := 'canonical_persons'; NEW.related_subject_id := NEW.related_person_id;
  END IF;
  IF NEW.person_id IS NULL AND NEW.person_subject_table = 'canonical_persons' THEN NEW.person_id := NEW.person_subject_id; END IF;
  IF NEW.related_person_id IS NULL AND NEW.related_subject_table = 'canonical_persons' THEN NEW.related_person_id := NEW.related_subject_id; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_prv_sync_subject ON person_relationships_verified;
CREATE TRIGGER trg_prv_sync_subject BEFORE INSERT OR UPDATE ON person_relationships_verified
  FOR EACH ROW EXECUTE FUNCTION sync_prv_subject_refs();

CREATE INDEX IF NOT EXISTS idx_prv_person_subject  ON person_relationships_verified (person_subject_table, person_subject_id);
CREATE INDEX IF NOT EXISTS idx_prv_related_subject ON person_relationships_verified (related_subject_table, related_subject_id);

-- ============ enslaved_owner_relationships (ownership; 0 rows, empty) ============
-- Already has dual canonical+unconfirmed id columns (all nullable). Add polymorphic columns so a
-- PAST/Hall enslaved or owner LEAD can be an endpoint; trigger keeps the legacy canonical/
-- unconfirmed convenience columns in sync (so existing FK-based readers still work).
ALTER TABLE enslaved_owner_relationships
  ADD COLUMN IF NOT EXISTS enslaved_subject_table TEXT,
  ADD COLUMN IF NOT EXISTS enslaved_subject_id    INTEGER,
  ADD COLUMN IF NOT EXISTS owner_subject_table    TEXT,
  ADD COLUMN IF NOT EXISTS owner_subject_id       INTEGER;

CREATE OR REPLACE FUNCTION sync_eor_subject_refs() RETURNS trigger AS $$
BEGIN
  -- legacy ids -> polymorphic (canonical takes precedence, else unconfirmed)
  IF NEW.enslaved_subject_id IS NULL THEN
    IF NEW.enslaved_canonical_id IS NOT NULL THEN NEW.enslaved_subject_table := 'canonical_persons'; NEW.enslaved_subject_id := NEW.enslaved_canonical_id;
    ELSIF NEW.enslaved_person_id IS NOT NULL THEN NEW.enslaved_subject_table := 'unconfirmed_persons'; NEW.enslaved_subject_id := NEW.enslaved_person_id; END IF;
  END IF;
  IF NEW.owner_subject_id IS NULL THEN
    IF NEW.owner_canonical_id IS NOT NULL THEN NEW.owner_subject_table := 'canonical_persons'; NEW.owner_subject_id := NEW.owner_canonical_id;
    ELSIF NEW.owner_person_id IS NOT NULL THEN NEW.owner_subject_table := 'unconfirmed_persons'; NEW.owner_subject_id := NEW.owner_person_id; END IF;
  END IF;
  -- polymorphic -> legacy convenience columns (keeps existing FK-based readers working)
  IF NEW.enslaved_subject_table = 'canonical_persons'  AND NEW.enslaved_canonical_id IS NULL THEN NEW.enslaved_canonical_id := NEW.enslaved_subject_id; END IF;
  IF NEW.enslaved_subject_table = 'unconfirmed_persons' AND NEW.enslaved_person_id   IS NULL THEN NEW.enslaved_person_id   := NEW.enslaved_subject_id; END IF;
  IF NEW.owner_subject_table = 'canonical_persons'  AND NEW.owner_canonical_id IS NULL THEN NEW.owner_canonical_id := NEW.owner_subject_id; END IF;
  IF NEW.owner_subject_table = 'unconfirmed_persons' AND NEW.owner_person_id   IS NULL THEN NEW.owner_person_id   := NEW.owner_subject_id; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_eor_sync_subject ON enslaved_owner_relationships;
CREATE TRIGGER trg_eor_sync_subject BEFORE INSERT OR UPDATE ON enslaved_owner_relationships
  FOR EACH ROW EXECUTE FUNCTION sync_eor_subject_refs();

CREATE INDEX IF NOT EXISTS idx_eor_enslaved_subject ON enslaved_owner_relationships (enslaved_subject_table, enslaved_subject_id);
CREATE INDEX IF NOT EXISTS idx_eor_owner_subject    ON enslaved_owner_relationships (owner_subject_table, owner_subject_id);

COMMIT;
