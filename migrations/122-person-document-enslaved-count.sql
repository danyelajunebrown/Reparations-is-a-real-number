-- Migration 114: person_documents.enslaved_count — the count-holding path for UNNAMED enslaved.
-- A slave schedule (and similar count-of-unnamed documents) names the owner and ENUMERATES the
-- enslaved, but does not name them. Rule 5 forbids minting placeholder unnamed person rows, so the
-- accounting lives as a COUNT on the document that evidences it, per owner. This is the analogue of
-- probate_scrape_progress.enslaved_count, generalized onto person_documents.
--
--   enslaved_count          — how many enslaved this document evidences for its linked owner.
--   enslaved_count_partial  — TRUE when the document is one page/fragment of a larger holding
--                             (a schedule PAGE rarely captures a large planter's full run) — so the
--                             count is a documented MINIMUM, never asserted as the total.
--   enslaved_demographics   — optional {age_bands, sex} jsonb when reliably extracted (NOT the buggy
--                             DOM-panel sex; only when image-OCR verified).
--
-- Consumers: the profile enslaved-accounting + reparations read SUM(enslaved_count) over a person's
-- docs; the DAA/obligation layer reads it as a holding. Feeds Craemer per-person on a DOCUMENTED count.
ALTER TABLE person_documents
  ADD COLUMN IF NOT EXISTS enslaved_count INTEGER,
  ADD COLUMN IF NOT EXISTS enslaved_count_partial BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS enslaved_demographics JSONB;

COMMENT ON COLUMN person_documents.enslaved_count IS
  'Count of enslaved this document evidences for its linked owner (unnamed enumeration, e.g. a slave-schedule page). Rule-5-safe: a count, not fabricated person rows. Reparations/DAA read SUM over a person''s docs.';
COMMENT ON COLUMN person_documents.enslaved_count_partial IS
  'TRUE when this document is one page/fragment of a larger holding — the count is a documented MINIMUM, never asserted as the total.';
