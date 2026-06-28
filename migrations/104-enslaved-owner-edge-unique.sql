-- Migration 104: idempotency unique for the polymorphic ownership edge table.
-- The producer (scripts/build-enslaved-owner-edges.mjs) materializes enslaved_owner_relationships
-- from existing sources (unconfirmed_persons.relationships enslaved_by; PAST ownership-role
-- enslavers). A partial unique on the polymorphic endpoints + relationship_type makes the producer
-- safely re-runnable (ON CONFLICT DO NOTHING) and prevents duplicate edges. Partial: only when both
-- endpoints are resolved (a valid edge always has both).

CREATE UNIQUE INDEX IF NOT EXISTS uq_eor_subject_edge
  ON enslaved_owner_relationships
     (enslaved_subject_table, enslaved_subject_id, owner_subject_table, owner_subject_id, relationship_type)
  WHERE enslaved_subject_id IS NOT NULL AND owner_subject_id IS NOT NULL;
