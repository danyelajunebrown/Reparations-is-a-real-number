-- Migration 115: back-link slavevoyages_past_people to the person spine (#117 de-siloing)
-- Date: 2026-07-03
--
-- WHY: all 169,065 slavevoyages_past_people rows are orphaned (canonical_person_id linked = 0).
-- Promotion through PersonService.findOrCreateLead lands each on the spine as a gated lead
-- (unconfirmed_persons) OR links to an existing canonical. This adds a POLYMORPHIC back-link so
-- the side-table row records which spine subject it became — making the promotion idempotent
-- (skip already-linked) and the numerator↔denominator join (Cuba disembarkations within the
-- Cuba benchmark) traversable. canonical_person_id (canonical-only) can't hold a lead id, hence
-- the polymorphic (table,id) pair.

ALTER TABLE slavevoyages_past_people
  ADD COLUMN IF NOT EXISTS linked_subject_table TEXT,
  ADD COLUMN IF NOT EXISTS linked_subject_id INTEGER,
  ADD COLUMN IF NOT EXISTS linked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_svpast_linked ON slavevoyages_past_people(linked_subject_table, linked_subject_id);
CREATE INDEX IF NOT EXISTS idx_svpast_disembark ON slavevoyages_past_people(disembark_port);
