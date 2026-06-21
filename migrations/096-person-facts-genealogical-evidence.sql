-- Migration 096: person_facts — the genealogical EVIDENCE layer (dated, placed,
--                sourced life-events/attributes). Enriches the thin identity spine.
--
-- WHY (Jun 21): canonical_persons is a flat record — birth/death YEAR only (10%/3%
-- filled), one primary location, no events. The person modal already shows fields the
-- spine can't supply (Occupation, Spouse, Racial designation, Freedom year — not even
-- columns), so those sections render empty. Genealogical convention (GEDCOM / the
-- Genealogical Proof Standard) models a person as a bundle of EVENTS + ATTRIBUTES,
-- each with date, place, SOURCE, and confidence. That richer record (a) fills the modal,
-- (b) gives the entity resolver many more match vectors → more rigorous, fewer false
-- merges (the spine was "too simplistic"), (c) makes identity disagreement FACT-level
-- (two sources differ on a birth date → keep BOTH with provenance, flag contested),
-- (d) makes mass ingestion LOSSLESS — Enslaved.org events, Hall dates/origins,
-- FamilySearch vitals land here instead of on the floor.
--
-- canonical_persons keeps the STABLE id + a RECONCILED summary (best birth year, etc.)
-- DERIVED from these facts; person_facts is the truth-bearing, provenance-carrying layer.
--
-- Additive. NO ROW INSERTS (populated by ingestion + resolution).

CREATE TABLE IF NOT EXISTS person_facts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id INTEGER NOT NULL REFERENCES canonical_persons(id) ON DELETE CASCADE,

    -- WHAT kind of fact. Genealogical event + attribute vocabulary (GEDCOM-aligned,
    -- extended for the slavery domain). Not a hard CHECK — new types arrive with new
    -- sources; an enum-as-table can come later if we need to constrain.
    fact_type TEXT NOT NULL,
        -- events:    birth, baptism, death, burial, marriage, divorce, residence,
        --            census, migration, immigration, military_service, education,
        --            occupation, business_affiliation, will, probate,
        --            enslavement, sale, manumission, emancipation, escape, redemption
        -- attributes: sex, race_designation, religion, physical_description,
        --            name_variant, ethnicity_origin, height, literacy

    -- WHEN (genealogical date precision: exact / year / circa / before / after / range).
    date_text       TEXT,            -- verbatim as recorded ("abt 1820", "Spring 1849")
    date_year       INTEGER,         -- parsed primary year (for matching/sorting)
    date_end_year   INTEGER,         -- for ranges / residence spans
    date_precision  TEXT,            -- 'exact'|'year'|'circa'|'before'|'after'|'range'

    -- WHERE.
    place_text      TEXT,            -- verbatim
    place_state     TEXT,
    place_county    TEXT,
    place_locality  TEXT,            -- city/parish/plantation/ship

    -- VALUE / WHO (occupation name, unit, business, description, race term, name variant;
    -- related person for marriage/relationship-bearing events).
    value_text          TEXT,
    related_person_id   INTEGER REFERENCES canonical_persons(id) ON DELETE SET NULL,
    related_name_text   TEXT,        -- when the related party isn't canonical (yet)

    -- PROVENANCE — every fact carries its source (project rule: no unsourced data).
    source_table          TEXT,      -- internal origin table
    source_external_system TEXT,     -- 'enslaved_org','familysearch','hall_louisiana','liberated_africans',...
    source_external_id    TEXT,      -- the source's record/Q-ID
    source_url            TEXT,
    source_citation       TEXT,
    confidence            NUMERIC(3,2) DEFAULT 0.70,
    verification_status   TEXT DEFAULT 'unverified',

    -- DISAGREEMENT (identity-reconciliation): set when sources conflict on this fact
    -- for this person; the reconciled summary on canonical_persons picks one but both
    -- facts persist.
    contested BOOLEAN DEFAULT FALSE,
    contested_reason TEXT,

    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_person_facts_person ON person_facts(person_id);
CREATE INDEX IF NOT EXISTS idx_person_facts_type ON person_facts(fact_type);
CREATE INDEX IF NOT EXISTS idx_person_facts_person_type ON person_facts(person_id, fact_type);
CREATE INDEX IF NOT EXISTS idx_person_facts_year ON person_facts(date_year);
CREATE INDEX IF NOT EXISTS idx_person_facts_extid ON person_facts(source_external_system, source_external_id);
-- Idempotent ingestion: one fact per (person, type, source record).
CREATE UNIQUE INDEX IF NOT EXISTS uq_person_facts_provenance
    ON person_facts(person_id, fact_type, source_external_system, source_external_id, date_year)
    WHERE source_external_system IS NOT NULL;

COMMENT ON TABLE person_facts IS
  'Genealogical evidence layer: dated, placed, sourced life-events + attributes per '
  'canonical person (GEDCOM/GPS-aligned). The truth-bearing, provenance-carrying, '
  'disagreement-aware record. canonical_persons holds the stable id + a reconciled '
  'summary DERIVED from these facts. Populated by mass ingestion (Enslaved.org, Hall, '
  'FamilySearch, Liberated Africans) and the entity resolver, which also USES these '
  'facts as match vectors.';
