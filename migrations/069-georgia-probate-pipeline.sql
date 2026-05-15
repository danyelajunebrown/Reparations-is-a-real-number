-- Migration 069: Georgia County Probate Pipeline infrastructure
-- Corrected column names to match actual schema (M056, M060)

-- Source registry entry for Liberty County GA probate volume
INSERT INTO regional_source_registry (
  source_name,
  citation,
  jurisdiction_text,
  era_start,
  era_end,
  record_type,
  axis_role,
  access_method,
  coverage_notes
) VALUES (
  'Liberty County GA Probate Records 1858-1867',
  'Georgia, Probate Records 1742-1990 (FamilySearch collection 1999178). Liberty County volume covering 1858-1860 and 1863-1867. Group ID: 9SYT-PT5, DGS: 267679901,268032901. Pre-transcribed full-text by FamilySearch volunteers.',
  'Liberty County, Georgia, United States',
  1858,
  1867,
  'probate',
  ARRAY['position','trajectory'],
  'web_query',
  'Contains wills, estate inventories, estate accounts, guardian accounts, and letters of administration. 555 images. Full-text transcription by FamilySearch volunteers — no OCR required. URL: https://www.familysearch.org/ark:/61903/3:1:3QS7-893L-P9FS?cc=1999178&wc=9SYT-PT5%3A267679901%2C268032901&lang=en&i=1'
) ON CONFLICT (source_name) DO NOTHING;

-- Methodology entry for this pipeline
INSERT INTO estimation_methodology_registry (
  name,
  version,
  description,
  role_tags,
  assumptions_jsonb,
  citations,
  known_failure_modes
) VALUES (
  'georgia_probate_liberty_county_1858_1867',
  'v1.0.0',
  'Direct extraction from pre-transcribed FamilySearch full-text probate records. Liberty County, GA 1858-1867. Evidence tier: direct_primary. Relationship type: owned (testamentary bequest of enslaved persons). No OCR required — volunteer transcriptions used. Scraper: scripts/scrapers/georgia-probate-scraper.js.',
  ARRAY['per_event_valuation', 'trace_linkage'],
  '{"source": "familysearch_full_text_transcript", "collection_id": "1999178", "group_id": "9SYT-PT5", "dgs": "267679901,268032901", "county": "Liberty", "state": "GA", "requires_ocr": false}'::jsonb,
  'FamilySearch. Georgia, Probate Records, 1742-1990. Collection 1999178. Liberty County volume 1858-1867. Volunteer transcriptions.',
  'Transcription errors from 19th-century handwriting may produce phonetic approximations of names. Abbreviated names (Thos., Jno., Wm.) expanded by normalizeName(). Mixed record types on one page may cause partial extraction.'
) ON CONFLICT (name, version) DO NOTHING;

-- Progress tracking table for the probate pipeline
CREATE TABLE IF NOT EXISTS probate_scrape_progress (
  id SERIAL PRIMARY KEY,
  collection_id TEXT NOT NULL,
  county TEXT NOT NULL,
  state TEXT NOT NULL,
  image_number INTEGER NOT NULL,
  ark_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'no_transcript', 'parsed', 'written', 'failed', 'skipped')),
  record_type TEXT,
  testator_name TEXT,
  enslaved_count INTEGER DEFAULT 0,
  person_document_id INTEGER,
  s3_key TEXT,
  error_text TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(collection_id, image_number)
);

CREATE INDEX IF NOT EXISTS idx_probate_scrape_progress_status
  ON probate_scrape_progress(collection_id, status);