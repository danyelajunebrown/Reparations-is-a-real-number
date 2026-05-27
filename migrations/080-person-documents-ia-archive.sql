-- Migration 080: Internet Archive redundancy columns on person_documents
--
-- Every person_document with an S3 asset should also have a parallel copy
-- on the Internet Archive. Two columns track this:
--
--   ia_item_id  — the IA item identifier (Strategy A/B: content we uploaded)
--                 e.g. "reparations-probate-ga-liberty-9syt-pt5-img-0042-pd12345"
--                 View at: https://archive.org/details/{ia_item_id}
--
--   wayback_url — a Wayback Machine snapshot URL (Strategy C: public source pages)
--                 e.g. "https://web.archive.org/web/20260527143201/https://..."
--                 Used for public-URL sources where Save Page Now applies.
--
-- Both are nullable — most rows will have exactly one or the other, not both.
-- Neither blocks the main pipeline; IA uploads are always async and best-effort.

ALTER TABLE person_documents
  ADD COLUMN IF NOT EXISTS ia_item_id  TEXT,
  ADD COLUMN IF NOT EXISTS wayback_url TEXT;

CREATE INDEX IF NOT EXISTS idx_person_documents_ia_item_id
  ON person_documents(ia_item_id)
  WHERE ia_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_person_documents_wayback_url
  ON person_documents(wayback_url)
  WHERE wayback_url IS NOT NULL;
