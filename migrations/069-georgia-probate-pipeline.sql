-- Migration 069: Georgia County Probate Pipeline infrastructure

-- Source registry entry for Liberty County GA probate volume
INSERT INTO regional_source_registry (
  source_name, source_description, state, county,
  record_type, date_range_start, date_range_end,
  is_compilation, max_evidence_tier,
  external_url, collection_id
) VALUES (
  'Liberty County GA Probate Records 1858-1867',
  'Georgia, Probate Records 1742-1990 (FamilySearch collection 1999178). Liberty County volume covering 1858-1860 and 1863-1867. Contains wills, estate inventories, estate accounts, guardian accounts, and letters of administration. Pre-transcribed full-text by FamilySearch volunteers. Group ID: 9SYT-PT5, DGS: 267679901,268032901.',
  'GA', 'Liberty',
  'probate', 1858, 1867,
  FALSE, 'direct_primary',
  'https://www.familysearch.org/ark:/61903/3:1:3QS7-893L-P9FS?cc=1999178&wc=9SYT-PT5%3A267679901%2C268032901&lang=en&i=1',
  '1999178'
) ON CONFLICT DO NOTHING;

-- Methodology entry for this pipeline
INSERT INTO estimation_methodology_registry (
  id, methodology_name, methodology_version,
  description, relationship_type, evidence_tier,
  source_registry_id
) VALUES (
  gen_random_uuid(),
  'georgia_probate_liberty_county_1858_1867',
  'v1.0.0',
  'Direct extraction from pre-transcribed FamilySearch full-text probate records. Liberty County, GA 1858-1867. Evidence tier: direct_primary. Relationship type: owned (testamentary bequest of enslaved persons). No OCR required — volunteer transcriptions used.',
  'owned',
  'direct_primary',
  (SELECT id FROM regional_source_registry WHERE source_name = 'Liberty County GA Probate Records 1858-1867' LIMIT 1)
) ON CONFLICT DO NOTHING;

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
