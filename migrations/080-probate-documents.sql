-- Migration 080: probate_documents
-- A logical probate document = an ordered set of consecutive person_documents
-- image rows within one roll. The FamilySearch scraper writes one person_documents
-- row per page-image; a will/inventory/account routinely spans several images.
-- This table is produced by src/services/probate/document-segmenter.js and is the
-- unit the hybrid extractor (Phase B) operates on.
-- No DO-blocks: the migration runner splits on ';', so every statement is plain DDL.

CREATE TABLE IF NOT EXISTS probate_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id TEXT,
  collection_key TEXT NOT NULL,
  county TEXT,
  state TEXT,
  roll_group_id TEXT,
  first_image_number INTEGER NOT NULL,
  last_image_number INTEGER NOT NULL,
  page_count INTEGER NOT NULL DEFAULT 1,
  document_type TEXT NOT NULL DEFAULT 'other',
  title TEXT,
  person_document_ids INTEGER[] NOT NULL DEFAULT '{}',
  segmentation_method TEXT NOT NULL DEFAULT 'heuristic',
  segmentation_confidence NUMERIC(3,2),
  needs_review BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (collection_key, first_image_number)
);

CREATE INDEX IF NOT EXISTS idx_probate_documents_collection_key ON probate_documents (collection_key);

CREATE INDEX IF NOT EXISTS idx_probate_documents_county ON probate_documents (county);

CREATE INDEX IF NOT EXISTS idx_probate_documents_type ON probate_documents (document_type);
