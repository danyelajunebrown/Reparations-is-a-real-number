-- Migration 079: Add carry_forward_text and carry_forward_ark to probate_scrape_progress

ALTER TABLE probate_scrape_progress
  ADD COLUMN IF NOT EXISTS carry_forward_text TEXT,
  ADD COLUMN IF NOT EXISTS carry_forward_ark TEXT;