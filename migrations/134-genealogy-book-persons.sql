-- 134 — genealogy_book_persons: full-harvest staging for compiled genealogies (e.g. "Bowies and Their Kindred").
--
-- User directive (2026-08-09): "don't under-harvest… we may need EVERY person in the book! they are at least
-- all pre-deduped leads." A compiled genealogy is the ideal source: the author already SEPARATED the
-- individuals (pre-deduped) and stated the PARENTAGE (the Biscoe-rule primary key) explicitly. So we harvest
-- every named person + the kinship they state, into staging — THEN a review-gated promote turns them into
-- leads + canonical_family_edges. Book-people are IMPLICATED-FAMILY / DESCENDED leads (secondary tier,
-- requires_human_review) — NOT auto-asserted enslavers; slaveholding is confirmed by corroborating evidence.

CREATE TABLE IF NOT EXISTS genealogy_book_persons (
  id           BIGSERIAL PRIMARY KEY,
  book_id      TEXT,              -- archive.org identifier, e.g. 'bowiestheirkindr00bowi'
  book_title   TEXT,
  source_url   TEXT,              -- archive.org URL (free, public-domain full text)
  name         TEXT NOT NULL,
  birth        TEXT, death TEXT,  -- kept as free text (book gives "April 7, 1808", "abt 1799", etc.)
  father_name  TEXT, mother_name TEXT, spouse_name TEXT,   -- the stated kinship edges (parentage = the key)
  residence    TEXT,
  note         TEXT,              -- role/occupation/slavery mention if the book states one
  chunk_index  INT,
  promoted     BOOLEAN DEFAULT FALSE,   -- has a review-gated promote turned this into a lead + edges
  created_at   TIMESTAMPTZ DEFAULT now()
);
-- within-book dedup: the book is pre-deduped, so a repeated (book, name, birth) is the same person across chunks
CREATE UNIQUE INDEX IF NOT EXISTS uq_gbp_book_name_birth ON genealogy_book_persons(book_id, name, COALESCE(birth,''));
CREATE INDEX IF NOT EXISTS idx_gbp_book ON genealogy_book_persons(book_id);
CREATE INDEX IF NOT EXISTS idx_gbp_unprom ON genealogy_book_persons(promoted) WHERE promoted = FALSE;

COMMENT ON TABLE genealogy_book_persons IS
  'Full-harvest staging for compiled genealogies. Every named person + stated kinship. Review-gated promote → leads + canonical_family_edges. Secondary tier; slaveholding NOT asserted from book membership alone.';
