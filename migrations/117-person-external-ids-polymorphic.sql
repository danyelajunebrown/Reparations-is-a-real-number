-- Migration 117: person_external_ids overhaul — polymorphic (lead-capable) + product-specific id_system (#123)
-- Date: 2026-07-03
--
-- WHY (two findings from the #117 SlaveVoyages de-siloing):
--  (1) The FK was canonical-only, so a GATED LEAD had nowhere to store its source id (it lived in a
--      context string — unqueryable). Make it polymorphic (subject_table, subject_id), mirroring M101
--      (blocking keys) / M103 (edges). canonical_person_id kept + trigger-synced for legacy readers.
--  (2) id_system='slavevoyages' was a COARSE label spanning two products: the migration_033 enslaver
--      ingest (51,109 enslavers) and, going forward, African-Origins persons. Their integer external_ids
--      COLLIDE (6,972 of the enslaver ids equal a past_people.sv_id), and resolve() tier-1 (name-blind
--      external match) bolted enslaved onto enslavers (the 5,275 false links). id_system must name the
--      PRODUCT. Re-tag the existing enslaver ids → 'slavevoyages_enslaver'; future PAST leads use
--      'slavevoyages_africanorigins'. See standard-external-source-ingest.md §4-5.

-- (1) polymorphic columns
ALTER TABLE person_external_ids
  ADD COLUMN IF NOT EXISTS subject_table TEXT,
  ADD COLUMN IF NOT EXISTS subject_id INTEGER;

UPDATE person_external_ids
   SET subject_table = 'canonical_persons', subject_id = canonical_person_id
 WHERE subject_table IS NULL AND canonical_person_id IS NOT NULL;

-- lead-only external ids can now exist (canonical_person_id NULL)
ALTER TABLE person_external_ids ALTER COLUMN canonical_person_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pei_subject ON person_external_ids(subject_table, subject_id);

-- keep canonical_person_id <-> subject_* consistent for BOTH legacy writers (set canonical_person_id)
-- and new writers (set subject_table/subject_id)
CREATE OR REPLACE FUNCTION sync_person_external_ids_subject() RETURNS trigger AS $$
BEGIN
  IF NEW.subject_table IS NULL AND NEW.canonical_person_id IS NOT NULL THEN
    NEW.subject_table := 'canonical_persons'; NEW.subject_id := NEW.canonical_person_id;
  ELSIF NEW.subject_table = 'canonical_persons' AND NEW.canonical_person_id IS NULL THEN
    NEW.canonical_person_id := NEW.subject_id;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_pei_subject ON person_external_ids;
CREATE TRIGGER trg_sync_pei_subject BEFORE INSERT OR UPDATE ON person_external_ids
  FOR EACH ROW EXECUTE FUNCTION sync_person_external_ids_subject();

-- (2) re-tag the coarse slavevoyages enslaver ids to a product-specific namespace.
-- All 51,111 are the migration_033 enslaver ingest (distinct namespace from African-Origins persons).
UPDATE person_external_ids SET id_system = 'slavevoyages_enslaver' WHERE id_system = 'slavevoyages';
