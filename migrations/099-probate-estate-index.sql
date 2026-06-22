-- Migration 099: Probate Estate Index (the connective spine)
-- Date: 2026-06-21
-- NOTE: renumbered 098 → 099 to resolve a collision with
--       098-chattel-transfer-events.sql (both authored Jun 21).
--
-- The probate scrape lands ~39k+ NY pages (multi-month, growing) as person_documents,
-- but 83% are orphans: no estate grouping, no queryable registry. The LLM forensic
-- pipeline (probate_estate_segments_v2 + probate_estate_extractions) is expensive and
-- months behind the scrape. This table is the CHEAP, DETERMINISTIC index built directly
-- from already-scraped data (scraper carry-forward testator_name + the now-corrected
-- document_year, #67) so every estate is queryable NOW. The LLM extraction layer attaches
-- to it as it catches up (estate_extraction_id / enslaved_count_extracted columns).
--
-- One row per (roll_group_id, decedent_key). Sanity columns make it a corroboration tool,
-- not just an index: slavery_era gates the NY-1827 cutoff; year_plausible catches OCR-noise
-- dates (e.g. Liberty-GA "1600s"); name_suspect flags place-words/OCR-junk masquerading as
-- decedents (Biscoe rule: FLAG for review, never auto-drop).

CREATE TABLE IF NOT EXISTS probate_estate_index (
    id                       BIGSERIAL PRIMARY KEY,

    -- Provenance / geography
    region                   TEXT NOT NULL,          -- 'new-york' | 'georgia' (collection_key prefix)
    state                    TEXT,                   -- 'NY' | 'GA'
    county_name              TEXT,                   -- humanized, parsed from collection_name
    roll_group_id            TEXT NOT NULL,
    roll_title               TEXT,

    -- Estate identity
    decedent_name            TEXT NOT NULL,          -- cleaned display name
    decedent_key             TEXT NOT NULL,          -- normalized grouping key
    canonical_person_id      BIGINT,                 -- linked testator (no FK: resilient to id-type drift)

    -- Page span (turns orphan pages into a navigable estate file)
    page_count               INT,
    image_number_min         INT,
    image_number_max         INT,
    page_doc_ids             BIGINT[],

    -- Dates (post-#67 backfill)
    year_min                 INT,
    year_max                 INT,

    -- Content signal
    enslaved_count_scrape    INT,                    -- SUM(probate_scrape_progress.enslaved_count)
    has_will                 BOOLEAN DEFAULT FALSE,
    has_inventory            BOOLEAN DEFAULT FALSE,

    -- Sanity / corroboration
    slavery_era              BOOLEAN,                -- year_min < 1828 (NY) / < 1865 (GA)
    year_plausible           BOOLEAN,                -- within [region founding floor, 1971]
    name_suspect             BOOLEAN,                -- place-word / single-token / OCR-junk decedent
    review_status            TEXT DEFAULT 'unreviewed' CHECK (review_status IN ('unreviewed','confirmed','flagged','merged','rejected')),
    review_notes             TEXT,

    -- Link to the LLM forensic layer (attached as the drip catches up; NULL until then)
    estate_extraction_id     BIGINT,                 -- probate_estate_extractions.id
    enslaved_count_extracted INT,                    -- for scrape-vs-extraction reconciliation
    total_appraised_usd      NUMERIC,

    built_at                 TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (roll_group_id, decedent_key)
);

CREATE INDEX IF NOT EXISTS idx_probate_estate_index_region        ON probate_estate_index(region);
CREATE INDEX IF NOT EXISTS idx_probate_estate_index_county        ON probate_estate_index(county_name);
CREATE INDEX IF NOT EXISTS idx_probate_estate_index_slavery_era   ON probate_estate_index(slavery_era) WHERE slavery_era;
CREATE INDEX IF NOT EXISTS idx_probate_estate_index_canon         ON probate_estate_index(canonical_person_id);
CREATE INDEX IF NOT EXISTS idx_probate_estate_index_decedent_key  ON probate_estate_index(decedent_key);
CREATE INDEX IF NOT EXISTS idx_probate_estate_index_year          ON probate_estate_index(year_min);
CREATE INDEX IF NOT EXISTS idx_probate_estate_index_review        ON probate_estate_index(review_status);
CREATE INDEX IF NOT EXISTS idx_probate_estate_index_ensl          ON probate_estate_index(enslaved_count_scrape) WHERE enslaved_count_scrape > 0;
