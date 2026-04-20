-- Migration 042: Enslaver candidates review queue
--
-- Previously: the crossref-freedmens-to-canonical script auto-created
-- canonical_persons entries for enslaver names extracted from Freedmens'
-- Bank ledgers that didn't already have canonical rows. That approach
-- risked polluting canonical_persons with OCR-distorted names like
-- "rss Grace Wood-" or "Dacob Wells Columbine" where the name is
-- probably real but the spelling is wrong.
--
-- This table holds proposed new canonical enslavers pending human review.
-- A curator can look at each row's original Freedmens Bank ledger image
-- (via the S3 URL and the ARK link) and either:
--   - Approve → spawn canonical_persons row, create family_relationships
--     edges for linked depositors, mark row resolved
--   - Reject → mark resolved with reject reason
--   - Edit → correct the name (OCR misreads like Dacob→Jacob) before approval
--
-- This is the first operational piece of the human review system the
-- project needs (previously only a `requires_human_review` flag existed
-- with no UI or workflow).

CREATE TABLE IF NOT EXISTS enslaver_candidates_review_queue (
    candidate_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Proposed enslaver identity
    proposed_name          TEXT NOT NULL,          -- as extracted from OCR
    proposed_role          TEXT,                   -- 'master', 'mistress', 'employer_post_1865'
    proposed_primary_state TEXT,                   -- inferred from depositor branch
    proposed_confidence    DECIMAL(3,2) DEFAULT 0.70,

    -- Evidence supporting the proposal
    corroborating_depositor_count INTEGER DEFAULT 1,   -- how many Freedmen's
                                                       -- Bank depositors named
                                                       -- this person as their
                                                       -- former enslaver
    source_ledger_arks     TEXT[],                 -- FS ARK URLs of the ledger
                                                   -- pages where the name appears
    depositor_lead_ids     INTEGER[],              -- unconfirmed_persons.lead_id
                                                   -- of each depositor
    depositor_names        TEXT[],                 -- depositor names (for context)
    source_s3_keys         TEXT[],                 -- S3 keys of the archived
                                                   -- ledger images

    -- Review metadata
    review_status          TEXT DEFAULT 'pending',  -- 'pending', 'approved',
                                                    -- 'rejected', 'edited'
    review_reason_code     TEXT,                   -- 'ocr_noise', 'duplicate',
                                                   -- 'not_a_person', 'approved',
                                                   -- 'approved_with_edit'
    reviewer_notes         TEXT,
    reviewed_by            TEXT,
    reviewed_at            TIMESTAMPTZ,

    -- If approved: the canonical_persons row that was spawned
    resolved_canonical_id  INTEGER REFERENCES canonical_persons(id) ON DELETE SET NULL,

    created_at             TIMESTAMPTZ DEFAULT NOW(),
    updated_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enslaver_candidates_status ON enslaver_candidates_review_queue(review_status);
CREATE INDEX IF NOT EXISTS idx_enslaver_candidates_name   ON enslaver_candidates_review_queue(LOWER(proposed_name));

COMMENT ON TABLE enslaver_candidates_review_queue IS
  'Proposed new canonical_persons enslaver entries extracted from '
  'Freedmens Bank ledgers, awaiting human review before promotion. Rows '
  'with 2+ corroborating depositors or an honorific prefix are the best '
  'candidates. The review workflow is minimal initially — a curator runs '
  'a query, inspects each candidate''s ledger image, and updates '
  'review_status. Downstream: when review_status=''approved'', a separate '
  'job creates the canonical_persons row and the family_relationships '
  'edges for the depositor_lead_ids.';
