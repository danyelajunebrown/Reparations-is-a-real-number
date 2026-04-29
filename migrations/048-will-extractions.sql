-- Migration 048: will_extractions
-- Date: 2026-04-29
--
-- Per memory-bank/plan-apr29-will-source-registry-dual-ledger-daa.md §2.M048.
--
-- Stores the extraction artifact produced by the will-ingestion pipeline:
-- raw per-page OCR + structured (typed) extraction + reviewer state. One
-- row per will-document processed. Composite PDFs (will narrative +
-- codicils + court forms) produce one row with raw_pages_jsonb carrying
-- per-page text and page-type classification.
--
-- structured_extraction_jsonb carries the WillExtraction schema documented
-- in plan §3.3 — testator, spouse, children, beneficiaries (kin/non-kin/
-- charitable), enslaved_persons, real_property, monetary_bequests,
-- heirlooms, corporate_holdings, trust_instruments, debts_acknowledged,
-- govt_compensation_references, witnesses, executors, registrar,
-- burial_location, court_jurisdiction, name_resolution_proposals.
--
-- Per-section reviewer approval (review_sections_jsonb) gates the fanout
-- service (plan §3.4) which writes downstream tables. Reviewer cannot mark
-- a will complete without confirming both within-document findings AND the
-- enslaver_evidence_compendium (M053) cross-source results — enforced at
-- the application layer (route handler), not via DB constraint.

CREATE TABLE IF NOT EXISTS will_extractions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Source document. The PDF that was ingested.
    document_id INTEGER NOT NULL REFERENCES person_documents(id) ON DELETE RESTRICT,

    -- Optional links surfaced once the testator is resolved. Both nullable
    -- because a will can be ingested before its testator is matched to a
    -- canonical_persons row, and not all wills tie to a registered participant.
    canonical_person_id INTEGER REFERENCES canonical_persons(id) ON DELETE SET NULL,
    participant_id UUID REFERENCES participants(id) ON DELETE SET NULL,

    -- Per-page OCR + page-type classification. Shape:
    -- [{index, page_type, confidence, ocr_text, ocr_method, form_fields_jsonb?}]
    raw_pages_jsonb JSONB NOT NULL,

    -- Typed WillExtraction payload (see plan §3.3).
    structured_extraction_jsonb JSONB NOT NULL,

    -- Track which extractor version produced this row so we can re-run
    -- selectively when extractor logic changes.
    extractor_version TEXT NOT NULL,

    -- Reviewer state. Not a CHECK constraint because the per-section
    -- granularity lives inside review_sections_jsonb.
    status TEXT NOT NULL DEFAULT 'extracted'
        CHECK (status IN ('extracted','review_in_progress','review_complete','rejected')),

    -- Per-section approval state. Shape:
    -- {enslaved_persons: 'approved'|'rejected'|'pending', real_property: ...,
    --  trust_instruments: ..., name_resolutions: ..., cross_source_dossier: ...}
    -- Application layer enforces "all sections approved before status=review_complete".
    review_sections_jsonb JSONB NOT NULL DEFAULT '{}'::jsonb,

    reviewed_at TIMESTAMPTZ,
    reviewed_by TEXT,
    review_notes TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_will_extractions_document_id
    ON will_extractions(document_id);
CREATE INDEX IF NOT EXISTS idx_will_extractions_canonical_person_id
    ON will_extractions(canonical_person_id);
CREATE INDEX IF NOT EXISTS idx_will_extractions_participant_id
    ON will_extractions(participant_id);
CREATE INDEX IF NOT EXISTS idx_will_extractions_status
    ON will_extractions(status) WHERE status != 'review_complete';
CREATE INDEX IF NOT EXISTS idx_will_extractions_created_at
    ON will_extractions(created_at DESC);
