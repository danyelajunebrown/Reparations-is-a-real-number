-- 135 — farm_book_persons: staging for the Jefferson Farm Book roster (Stages 3-5 of the ingest program).
--
-- ONE ROW PER PERSON-MENTION-PER-PAGE (not per person). The same enslaved person appears on many pages/rolls
-- (1774 Wayles roll, 1774/1783/1794 rolls, birth registers) — creating a lead per mention would rebuild the
-- exact silo the precise audit exposed. So we STAGE every mention here, then Stage 5 RESOLVES mentions →
-- distinct people (owner=Jefferson + location + birth-year + parentage), validated vs Getting Word, and only
-- THEN creates one lead each + enslaved_owner edges + canonical_family_edges. Jefferson's own ledger ⇒ primary.

CREATE TABLE IF NOT EXISTS farm_book_persons (
  id                 BIGSERIAL PRIMARY KEY,
  person_document_id BIGINT,          -- the Farm Book page this mention came from
  page               INT,
  roll_year          INT,             -- year of the roll/register (1774, 1783, 1794…), when determinable
  name               TEXT NOT NULL,
  birth_year         INT,
  location           TEXT,            -- Monticello | Shadwell | Elk-hill | Poplar Forest | Bedford | Lego | …
  status             TEXT,            -- labourer_in_ground (*) | tradesperson (+) | discharged (-) | unknown
  occupation         TEXT,
  mother_name        TEXT,            -- from family brackets / birth registers (the parentage edge, staged as text)
  father_name        TEXT,
  note               TEXT,
  resolved_person_id BIGINT,          -- Stage 5 fills this: the distinct person this mention resolves to
  promoted           BOOLEAN DEFAULT FALSE,
  created_at         TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fbp_doc  ON farm_book_persons(person_document_id);
CREATE INDEX IF NOT EXISTS idx_fbp_name ON farm_book_persons(lower(name));
CREATE INDEX IF NOT EXISTS idx_fbp_unres ON farm_book_persons(resolved_person_id) WHERE resolved_person_id IS NULL;

COMMENT ON TABLE farm_book_persons IS
  'Per-mention staging of the Jefferson Farm Book roster. Stage 5 resolves mentions → distinct people (Biscoe-safe) before creating leads/edges. Prevents the same person becoming N siloed leads.';
