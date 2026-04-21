-- Migration 044: Parse failure queue for human-in-loop QA on OCR / Document AI
--
-- Rather than silently discarding documents the parser couldn't extract,
-- every miss lands in this queue with enough context for a reviewer to
-- either (a) manually fill the fields in the /review UI, or (b) mark the
-- document for re-processing after a better model version is trained.
--
-- Design per user direction 2026-04-20: "lets be methodical and see if we
-- can systematize this: (b) human-in-loop QA for each miss, such that we
-- can up our chances." Each human correction becomes training data for
-- the next Document AI fine-tune cycle.

CREATE TABLE IF NOT EXISTS parse_failure_queue (
    failure_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- What was being processed
    document_type        TEXT NOT NULL,            -- 'freedmens_bank_ledger_page',
                                                   -- 'dc_petition_page', 'slave_schedule_page',
                                                   -- 'will', 'probate_inventory', etc.
    source_identifier    TEXT,                     -- e.g. 'charleston-r21/acct-102.png',
                                                   -- 'cww.00431.002.jpg', etc.
    s3_key               TEXT,                     -- if image is archived
    source_url           TEXT,                     -- original URL (FS ARK, civilwardc, etc.)

    -- Which engine attempted (we want to know if document AI or Vision failed)
    engine_attempted     TEXT NOT NULL,            -- 'google_vision', 'document_ai_custom_extractor',
                                                   -- 'internal_regex_parser'
    engine_processor_id  TEXT,                     -- processor ID / processor version used
    engine_confidence    DECIMAL(3,2),             -- aggregate confidence, if any
    extracted_fields     JSONB,                    -- whatever partial extraction returned

    -- Why it's here
    failure_reason       TEXT NOT NULL,            -- 'sub_threshold_confidence',
                                                   -- 'required_fields_empty',
                                                   -- 'parse_exception',
                                                   -- 'no_records_found',
                                                   -- 'template_mismatch'
    required_fields_missing TEXT[],                -- which required fields the parser
                                                   -- didn't populate
    error_message        TEXT,

    -- Reviewer action (null until human intervenes)
    reviewer_fields      JSONB,                    -- human-entered field values
    review_status        TEXT DEFAULT 'pending',   -- 'pending', 'in_progress', 'resolved',
                                                   -- 'unreviewable', 'escalated'
    reviewer_notes       TEXT,
    reviewed_by          TEXT,
    reviewed_at          TIMESTAMPTZ,

    -- Training-data eligibility
    training_eligible    BOOLEAN DEFAULT FALSE,    -- true when reviewer has filled enough
                                                   -- fields to use this as a labeled example
                                                   -- for the next fine-tune
    training_exported_at TIMESTAMPTZ,              -- when we fed this into Document AI
                                                   -- training dataset

    created_at           TIMESTAMPTZ DEFAULT NOW(),
    updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_parse_fail_status     ON parse_failure_queue(review_status);
CREATE INDEX IF NOT EXISTS idx_parse_fail_doc_type   ON parse_failure_queue(document_type);
CREATE INDEX IF NOT EXISTS idx_parse_fail_engine     ON parse_failure_queue(engine_attempted);
CREATE INDEX IF NOT EXISTS idx_parse_fail_training   ON parse_failure_queue(training_eligible)
    WHERE training_eligible = TRUE AND training_exported_at IS NULL;

COMMENT ON TABLE parse_failure_queue IS
  'Documents that neither Google Vision nor Document AI could extract '
  'cleanly. Surfaces in the /review UI for human intervention. Completed '
  'reviewer entries feed back into the Document AI training dataset as '
  'additional labeled examples, iteratively improving yield.';
