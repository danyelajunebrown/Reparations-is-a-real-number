-- 127-family-edge-information-type.sql — evidence-QUALITY typing on kinship edges.
--
-- Genealogical proof standards distinguish PRIMARY information (recorded by someone with direct
-- knowledge, at/near the event — a father naming his child in his own will, an enumerator recording a
-- household he visited) from SECONDARY information (recorded long after, by someone a step removed — a
-- descendant's recollection on a death certificate, a county history compiled decades later). A tier-1
-- document can still carry secondary information, and the DAA kinship gate (#72, edge-evidence standard
-- §7) must know the difference: a kinship EDGE is only as strong as the information behind it, not just
-- the paper it sits on.
--
-- Everything downstream keys off `information_type`. `event_to_record_gap_years` is the MECHANICAL proxy
-- that lets us assign it without a human on every edge: a large gap between when the event happened and
-- when the record was made downgrades the information to 'secondary' regardless of the document's tier
-- (a 1905 death certificate stating an 1850 birth = 55-year gap = secondary, even though the certificate
-- is a tier-1 government record). Rule of thumb: gap > ~5 years ⇒ 'secondary'.
--
-- Backfill note: the gap is derivable wherever an edge's source document carries a record year
-- (person_documents.document_year via source_document_id) AND the relationship event has a year. The edge
-- schema does not yet store an event year, so backfill is a follow-up (join source_document_id →
-- person_documents.document_year, subtract the event year once captured). Columns default to 'undetermined'
-- / NULL so nothing is silently asserted as primary. Idempotent (IF NOT EXISTS on every column).

ALTER TABLE canonical_family_edges
  ADD COLUMN IF NOT EXISTS information_type TEXT
    DEFAULT 'undetermined',
  ADD COLUMN IF NOT EXISTS informant_role TEXT,              -- 'testator','enumerator','self','descendant','clerk','compiler'
  ADD COLUMN IF NOT EXISTS event_to_record_gap_years INTEGER; -- record_year − event_year; > ~5 ⇒ secondary

-- CHECK added separately (not inline) so re-runs don't fail if the column already existed; NOT VALID keeps
-- it cheap on the 4,922 existing rows (all default 'undetermined', which satisfies it).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'canonical_family_edges_information_type_chk'
  ) THEN
    ALTER TABLE canonical_family_edges
      ADD CONSTRAINT canonical_family_edges_information_type_chk
      CHECK (information_type IN ('primary','secondary','undetermined')) NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN canonical_family_edges.information_type IS
  'Genealogical information quality of the edge: primary (direct-knowledge informant at/near the event) | secondary (a step removed / long after) | undetermined. Keys the DAA kinship gate; a tier-1 doc can still be secondary information.';
COMMENT ON COLUMN canonical_family_edges.informant_role IS
  'Who supplied the kinship information: testator | enumerator | self | descendant | clerk | compiler, etc. Drives the primary/secondary call.';
COMMENT ON COLUMN canonical_family_edges.event_to_record_gap_years IS
  'record_year − event_year. Mechanical downgrade proxy: gap > ~5 years ⇒ information_type should be secondary regardless of document tier.';
