-- Migration 069: Georgia County Probate Pipeline infrastructure

-- Source registry entry for Liberty County GA probate volume
-- Schema: regional_source_registry (migration 056)
-- Required NOT NULL: source_name, citation, jurisdiction_text, record_type, axis_role, access_method
INSERT INTO regional_source_registry (
  source_name,
  citation,
  jurisdiction_text,
  era_start, era_end,
  record_type,
  axis_role,
  access_method,
  coverage_notes
) VALUES (
  'Liberty County GA Probate Records 1858-1867',
  'FamilySearch. "Georgia, Probate Records, 1742-1990." Collection ID 1999178. Liberty County volume: 1858-1860 and 1863-1867. Group ID: 9SYT-PT5, DGS: 267679901,268032901. https://www.familysearch.org/ark:/61903/3:1:3QS7-893L-P9FS?cc=1999178&wc=9SYT-PT5%3A267679901%2C268032901&lang=en&i=1',
  'Georgia, Liberty County',
  1858, 1867,
  'probate',
  ARRAY['position', 'trajectory'],
  'web_query',
  'Contains wills, estate inventories, estate accounts, guardian accounts, and letters of administration. 555 images. Pre-transcribed by FamilySearch volunteers — no OCR required. Covers 1858-1860 and 1863-1867 (wartime gap 1861-1862).'
) ON CONFLICT (source_name) DO NOTHING;

-- Methodology entry for this pipeline
-- Schema: estimation_methodology_registry (migration 060)
-- Required NOT NULL: name, version, description, citations
-- UNIQUE constraint: (name, version)
INSERT INTO estimation_methodology_registry (
  id, name, version,
  description, role_tags, assumptions_jsonb, citations, known_failure_modes
) VALUES (
  gen_random_uuid(),
  'georgia_probate_liberty_county_1858_1867',
  'v1.0.0',
  'Direct extraction from pre-transcribed FamilySearch full-text probate records. Liberty County, GA 1858-1867. Evidence tier: direct_primary. Relationship type: testamentary bequest of enslaved persons. No OCR required — FamilySearch volunteer transcriptions used.',
  ARRAY['direct_primary', 'probate_extraction'],
  '{"county": "Liberty", "state": "GA", "collection_id": "1999178", "group_id": "9SYT-PT5", "dgs": "267679901,268032901", "evidence_tier": "direct_primary", "relationship_type": "owned"}'::jsonb,
  'FamilySearch. "Georgia, Probate Records, 1742-1990." Collection 1999178. Liberty County volume 1858-1867.',
  'Transcript quality varies by volunteer accuracy. Handwritten records may have transcription errors. Some images have no transcript (not yet transcribed by volunteers).'
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
