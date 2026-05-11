-- Migration 067: inheritance_edges
-- Date: 2026-05-11
--
-- PURPOSE
-- -------
-- Records documentary inheritance chains: testator → heir(s), with
-- the specific asset transferred and the document that proves it.
--
-- This is the critical missing link for the wealth-tracing framework.
-- Without it, we can say "George Washington Biscoe owned enslaved persons"
-- but cannot trace the transmission of that accumulated wealth into
-- subsequent generations via wills and deeds.
--
-- RELATIONSHIP TO OTHER TABLES
-- ----------------------------
--   will_extractions (M048)   — structured OCR output from a will document
--   land_transfer_events (M038) — individual property transfers
--   enslaver_lineage_ledger (M040) — per-enslaver obligation totals
--   canonical_family_edges (M066) — who the heirs ARE (family graph)
--
-- An inheritance_edge answers: "What did this specific heir receive from
-- this specific testator, per what document?"
--
-- inheritance_edges + canonical_family_edges together give us:
--   1. Who inherited (family graph)
--   2. What they inherited (inheritance edge)
--   3. What that was worth (asset_value_usd_est)
--   4. Whether that wealth was already tainted (came from slave labor)
--
-- EVIDENCE TIER CONVENTION (mirrors canonical_family_edges)
-- ---------------------------------------------------------
--   tier 1 — primary document: the will/deed/trust itself
--   tier 2 — secondary document: newspaper probate notice, court record
--   tier 3 — inferred: no document, genealogical inference only
--
-- Wills are tier 1 by definition. Land deeds that reference a will
-- disposition are also tier 1. Most rows here should be tier 1.

CREATE TABLE IF NOT EXISTS inheritance_edges (
    id SERIAL PRIMARY KEY,

    -- Both ends must be canonical_persons
    testator_id INTEGER NOT NULL REFERENCES canonical_persons(id) ON DELETE CASCADE,
    heir_id     INTEGER NOT NULL REFERENCES canonical_persons(id) ON DELETE CASCADE,

    -- Relationship label as stated in the document ("wife", "eldest son", "nephew", etc.)
    relationship_to_testator TEXT,

    -- What was transferred
    asset_type TEXT
        CHECK (asset_type IN (
            'real_property',        -- land / house
            'enslaved_persons',     -- enslaved human beings (pre-emancipation only)
            'personal_estate',      -- furniture, livestock, tools, personal effects
            'monetary_bequest',     -- specific dollar/sterling bequest
            'residual_estate',      -- the remainder after specific bequests
            'trust_interest',       -- interest in a trust instrument
            'business_interest',    -- share of a business
            'mixed',                -- combination of the above
            'unspecified'           -- document mentions heir but doesn't itemize
        )),

    asset_description TEXT,         -- verbatim or paraphrased from source
    asset_value_usd_est DECIMAL(14,2),  -- estimated 2024 USD (NULL if not calculable)
    value_methodology_note TEXT,    -- how the dollar estimate was computed

    -- Number of enslaved persons transferred (populated for asset_type = 'enslaved_persons')
    enslaved_persons_count INTEGER,

    -- ── Documentary evidence (at least source_document_id or will_extraction_id should be set) ──

    -- The person_documents row for the will / deed / trust
    source_document_id INTEGER REFERENCES person_documents(id) ON DELETE SET NULL,

    -- The structured will extraction row (if OCR pipeline has processed it)
    -- NOTE: will_extractions.id is UUID, not INTEGER
    will_extraction_id UUID REFERENCES will_extractions(id) ON DELETE SET NULL,

    -- FK to land_transfer_events if this edge traces a specific parcel
    -- NOTE: land_transfer_events PK is transfer_id UUID, not id
    land_transfer_id UUID REFERENCES land_transfer_events(transfer_id) ON DELETE SET NULL,

    -- ── Document metadata ────────────────────────────────────────────────────
    document_year        INTEGER,
    document_jurisdiction TEXT,    -- e.g. "Montgomery County, Maryland"
    document_reference   TEXT,     -- e.g. "Will Book JMT-4, p. 122"

    -- evidence_tier: 1=primary doc, 2=secondary, 3=inferred
    evidence_tier INTEGER NOT NULL DEFAULT 1
        CHECK (evidence_tier BETWEEN 1 AND 3),

    confidence NUMERIC(4,3) NOT NULL DEFAULT 0.800
        CHECK (confidence >= 0.000 AND confidence <= 1.000),

    verified    BOOLEAN NOT NULL DEFAULT false,
    verified_by TEXT,
    verified_at TIMESTAMPTZ,

    notes TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- No self-loops
    CHECK (testator_id <> heir_id),

    -- Prevent exact duplicates on the same document
    UNIQUE (testator_id, heir_id, asset_type, source_document_id)
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ie_testator
    ON inheritance_edges(testator_id);

CREATE INDEX IF NOT EXISTS idx_ie_heir
    ON inheritance_edges(heir_id);

CREATE INDEX IF NOT EXISTS idx_ie_asset_type
    ON inheritance_edges(asset_type);

CREATE INDEX IF NOT EXISTS idx_ie_enslaved
    ON inheritance_edges(asset_type)
    WHERE asset_type = 'enslaved_persons';

CREATE INDEX IF NOT EXISTS idx_ie_document
    ON inheritance_edges(source_document_id)
    WHERE source_document_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ie_will_extraction
    ON inheritance_edges(will_extraction_id)
    WHERE will_extraction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ie_verified
    ON inheritance_edges(verified);

CREATE INDEX IF NOT EXISTS idx_ie_year
    ON inheritance_edges(document_year);

-- ── Trigger: updated_at ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ie_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ie_updated_at ON inheritance_edges;
CREATE TRIGGER trg_ie_updated_at
    BEFORE UPDATE ON inheritance_edges
    FOR EACH ROW
    EXECUTE FUNCTION ie_set_updated_at();

-- ── Views ─────────────────────────────────────────────────────────────────────

-- Full inheritance chain with resolved names
CREATE OR REPLACE VIEW inheritance_edges_resolved AS
SELECT
    ie.id,
    -- Testator
    t.id             AS testator_id,
    t.canonical_name AS testator_name,
    t.person_type    AS testator_type,
    t.birth_year_estimate AS testator_birth_year,
    t.death_year_estimate AS testator_death_year,
    -- Heir
    h.id             AS heir_id,
    h.canonical_name AS heir_name,
    h.person_type    AS heir_type,
    -- Transfer details
    ie.relationship_to_testator,
    ie.asset_type,
    ie.asset_description,
    ie.asset_value_usd_est,
    ie.enslaved_persons_count,
    ie.document_year,
    ie.document_jurisdiction,
    ie.document_reference,
    ie.evidence_tier,
    ie.confidence,
    ie.verified,
    -- Document link
    pd.title         AS document_title,
    pd.s3_key        AS document_s3_key,
    ie.created_at
FROM inheritance_edges ie
JOIN canonical_persons t  ON t.id = ie.testator_id
JOIN canonical_persons h  ON h.id = ie.heir_id
LEFT JOIN person_documents pd ON pd.id = ie.source_document_id;

-- Enslaver wealth propagation view: shows how slave-labor wealth moved
-- through inheritance lines from a known enslaver
CREATE OR REPLACE VIEW enslaver_inheritance_chains AS
SELECT
    ie.id,
    t.canonical_name AS enslaver_testator,
    h.canonical_name AS heir_name,
    ie.relationship_to_testator,
    ie.asset_type,
    ie.enslaved_persons_count,
    ie.asset_value_usd_est,
    ie.document_year,
    ie.document_jurisdiction,
    ie.document_reference,
    ie.evidence_tier,
    ie.verified,
    pd.title AS will_title,
    pd.s3_key AS will_s3_key
FROM inheritance_edges ie
JOIN canonical_persons t  ON t.id = ie.testator_id
JOIN canonical_persons h  ON h.id = ie.heir_id
LEFT JOIN person_documents pd ON pd.id = ie.source_document_id
WHERE t.person_type IN ('enslaver', 'slaveholder', 'owner',
                        'confirmed_owner', 'free_poc_slaveholder')
ORDER BY ie.document_year ASC, t.canonical_name;

-- Per-testator summary: total value and enslaved persons distributed
CREATE OR REPLACE VIEW inheritance_summary_by_testator AS
SELECT
    t.id             AS testator_id,
    t.canonical_name AS testator_name,
    t.person_type,
    COUNT(DISTINCT ie.heir_id)               AS heir_count,
    COUNT(*)                                  AS bequest_count,
    SUM(ie.enslaved_persons_count)            AS total_enslaved_bequeathed,
    SUM(ie.asset_value_usd_est)              AS total_value_usd_est,
    COUNT(*) FILTER (WHERE ie.verified)       AS verified_count,
    MAX(ie.document_year)                     AS latest_document_year
FROM inheritance_edges ie
JOIN canonical_persons t ON t.id = ie.testator_id
GROUP BY t.id, t.canonical_name, t.person_type
ORDER BY total_enslaved_bequeathed DESC NULLS LAST, total_value_usd_est DESC NULLS LAST;

-- ── Comments ──────────────────────────────────────────────────────────────────

COMMENT ON TABLE inheritance_edges IS
    'Documentary wealth transmission records: testator → heir, per document. '
    'Primary driver of the wealth-tracing framework. '
    'Each row should be anchored to at least one person_documents or will_extractions row. '
    'evidence_tier 1 = primary document (will/deed), 2 = secondary, 3 = inferred. '
    'asset_type = ''enslaved_persons'' rows are pre-emancipation only and record '
    'the transmission of enslaved human beings as property — this is intentional and '
    'necessary for the reparations accountability calculation.';

COMMENT ON COLUMN inheritance_edges.enslaved_persons_count IS
    'Number of enslaved persons transferred per this bequest. '
    'Populated only when asset_type = ''enslaved_persons''. '
    'Feeds into the enslaver_lineage_ledger obligation calculation.';

COMMENT ON COLUMN inheritance_edges.asset_value_usd_est IS
    'Estimated equivalent 2024 USD value of this bequest. '
    'Methodology recorded in value_methodology_note. '
    'NULL if no reliable estimate is available.';
