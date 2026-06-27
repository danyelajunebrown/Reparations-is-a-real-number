-- Migration 102: External-assertion gate on canonical_persons
-- Plan: memory-bank/standard-canonical-person-and-document-gate.md (the gate),
--       memory-bank/design-person-service-consolidation.md (step 3).
--
-- The standard: a canonical person may be created from a verified SECONDARY source and is
-- fully usable INTERNALLY (DAA, climber, obligation, dedup), but is GATED — hidden from the
-- front-end search engine and we NEVER externally assert "was/wasn't a slaveowner / was
-- enslaved" — until a PROPOSITION-SPECIFIC corroborating document is stored in S3
-- (person_documents.s3_key present — a real archived file, NOT a secondary URL pointer),
-- and only for the proposition that document substantiates.
--
-- Gate model (user verdict Jun 26): two booleans on canonical_persons, DERIVED from
-- qualifying person_documents rows (s3_key present + document_type substantiating the
-- proposition). The audit trail of WHICH doc lifted the gate already lives in
-- person_documents. PersonService.recomputeGate() maintains them.
--
-- DEFAULT FALSE = conservatively gated. All 676,881 existing canonicals start gated; a
-- separate, measured recompute backfill (scripts/recompute-assertion-gates.mjs) un-gates the
-- ones that already have qualifying stored docs. NO consumer reads these columns yet, so this
-- migration is operationally inert until the search/API filter is wired (deliberate next step).
-- Adding a NOT NULL column with a constant default is a metadata-only change in PG11+ (fast).

ALTER TABLE canonical_persons
  ADD COLUMN IF NOT EXISTS assertable_slaveowner BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS assertable_enslaved   BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index for the public-search filter (search will show only assertable persons).
CREATE INDEX IF NOT EXISTS idx_canonical_assertable
  ON canonical_persons (id) WHERE assertable_slaveowner OR assertable_enslaved;

COMMENT ON COLUMN canonical_persons.assertable_slaveowner IS
  'External-assertion gate (M102): TRUE only when a person_documents row with s3_key present + a slaveowner-substantiating document_type exists. Derived by PersonService.recomputeGate. Public search + "was a slaveowner" UI filter on this; internal consumers ignore it.';
COMMENT ON COLUMN canonical_persons.assertable_enslaved IS
  'External-assertion gate (M102): TRUE only when a person_documents row with s3_key present + an enslaved/prior-enslaved-substantiating document_type exists. Derived by PersonService.recomputeGate.';
