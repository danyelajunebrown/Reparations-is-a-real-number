-- Migration 113: person_documents.evidences_enslaved_holding
-- Enumeration-of-unnamed corroborator (#95) for the external-assertion slaveowner gate.
-- A STORED PRIMARY owner-document that a human has verified as evidencing an enslaved HOLDING
-- (e.g. an estate-inventory line valuing "Servants" as property; a bill of sale for "N Negro
-- servants") supports the OWNER's "was a slaveowner" flag EVEN WHEN no enslaved individual is
-- named. No person row is minted (Rule 5) — the fact lives on the document, human-verified.
-- Read by PersonService.assertableSlaveownerSQL (the OWNER_CONTENT corroborator, third branch).
-- Precipitating case: Alexander Hamilton — estate inventory "Servants £400" (1804), names no one.
ALTER TABLE person_documents
  ADD COLUMN IF NOT EXISTS evidences_enslaved_holding BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN person_documents.evidences_enslaved_holding IS
  'Human-verified flag: this stored PRIMARY owner-document evidences an enslaved HOLDING (an unnamed enumeration, e.g. an estate "Servants" valuation or a "N Negro servants" purchase). Corroborator for the slaveowner gate (M113; PersonService.assertableSlaveownerSQL). Does NOT mint a person row.';
