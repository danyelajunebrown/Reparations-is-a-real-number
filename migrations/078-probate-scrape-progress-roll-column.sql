-- Migration 078: Add roll_group_id to probate_scrape_progress
-- Needed for multi-county, multi-roll pipeline (image_number alone is not unique across rolls).

ALTER TABLE probate_scrape_progress
  ADD COLUMN IF NOT EXISTS roll_group_id TEXT;

-- Drop the old single-roll UNIQUE constraint (collection_id, image_number).
-- If it was created with the default Postgres name, drop it. Safe to ignore if already removed.
ALTER TABLE probate_scrape_progress
  DROP CONSTRAINT IF EXISTS probate_scrape_progress_collection_id_image_number_key;

-- Add the correct multi-roll UNIQUE constraint.
-- Uses IF NOT EXISTS-equivalent: wrapped in a DO block to avoid duplicate error.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'probate_scrape_progress_collection_roll_image_unique'
  ) THEN
    ALTER TABLE probate_scrape_progress
      ADD CONSTRAINT probate_scrape_progress_collection_roll_image_unique
      UNIQUE (collection_id, roll_group_id, image_number);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_probate_scrape_progress_roll
  ON probate_scrape_progress(roll_group_id);
