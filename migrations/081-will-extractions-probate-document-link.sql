-- Migration 081: link will_extractions to probate_documents
-- will_extractions.document_id references a single person_documents row (the
-- design for single-file PDF uploads). A segmented probate document spans
-- several person_documents image rows, so the hybrid extractor (Phase B) also
-- records which probate_documents row it extracted. document_id is still set
-- to the document's first image for back-compat and a valid FK.

ALTER TABLE will_extractions
  ADD COLUMN IF NOT EXISTS probate_document_id UUID REFERENCES probate_documents (id);

CREATE INDEX IF NOT EXISTS idx_will_extractions_probate_document
  ON will_extractions (probate_document_id);
