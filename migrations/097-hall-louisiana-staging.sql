-- Migration 097: hall_slave_records — staging for the FULL Gwendolyn Midlo Hall
--                Louisiana Slave Database (ibiblio.org/laslave, freely released).
--
-- WHY: our prior `louisiana_slave_db_import` (113,500 unconfirmed_persons) captured
-- only {year, location} — the rich Hall fields were dropped. The authoritative DBF
-- (SLAVE.DBF, 100,666 records, 114 fields) carries per-person sex/race/age, African
-- birthplace+ethnicity, skills/occupation, health, character, KINSHIP (mother/father/
-- mate/children/grandparents), the OWNER side (seller/buyer + prices+currency), and
-- maritime arrival (ship/captain/port). This stages the fully-DECODED records
-- (lossless, our copy of Hall's open release) so we can (next) emit person_facts +
-- kinship edges + transfer events and resolve to canonical persons WITHOUT re-parsing.
--
-- Lean columns for query/join; the full 114-field decoded record lives in `raw`.
-- NO ROW INSERTS (loaded by scripts/ingest-hall-louisiana.mjs).

CREATE TABLE IF NOT EXISTS hall_slave_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    record_index INTEGER NOT NULL,          -- 0-based row in SLAVE.DBF (stable key)
    docno TEXT,                              -- document number (Hall)
    estate TEXT,                             -- estate id (groups slaves in one estate)

    -- person
    name TEXT,
    sex TEXT,                                -- decoded: female/male/unidentified
    race TEXT,                               -- decoded racial designation
    age NUMERIC(5,1),
    birthplace TEXT,                         -- decoded BIRTHPL (origin / African ethnicity)
    african_nation_spelling TEXT,            -- SPELL (verbatim)
    brut BOOLEAN,                            -- newly arrived from Africa
    skills TEXT,                             -- verbatim
    has_family BOOLEAN,

    -- document / when / where
    year INTEGER,
    doc_date TEXT,
    doc_type TEXT,                           -- decoded
    location TEXT,                           -- decoded parish

    -- owner side + valuation
    seller_name TEXT,
    buyer_name TEXT,
    inv_value NUMERIC(14,2),
    inv_currency TEXT,
    sale_value NUMERIC(14,2),
    sale_currency TEXT,
    sale_date TEXT,

    -- maritime
    ship TEXT,
    captain TEXT,
    arrive_date TEXT,
    embark_from TEXT,                        -- decoded STPORT / verbatim FROM

    -- events
    emancipated BOOLEAN,
    dead BOOLEAN,
    runaway BOOLEAN,

    -- everything, decoded, lossless
    raw JSONB NOT NULL,

    source_citation TEXT DEFAULT 'Gwendolyn Midlo Hall, Louisiana Slave Database (ibiblio.org/laslave); freely released.',
    ingested_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (record_index)
);

CREATE INDEX IF NOT EXISTS idx_hall_name ON hall_slave_records(LOWER(name));
CREATE INDEX IF NOT EXISTS idx_hall_year ON hall_slave_records(year);
CREATE INDEX IF NOT EXISTS idx_hall_location ON hall_slave_records(location);
CREATE INDEX IF NOT EXISTS idx_hall_seller ON hall_slave_records(LOWER(seller_name));
CREATE INDEX IF NOT EXISTS idx_hall_estate ON hall_slave_records(estate);

COMMENT ON TABLE hall_slave_records IS
  'Staged, fully-decoded Gwendolyn Midlo Hall Louisiana Slave Database (100,666 '
  'records). Source of rich per-person facts (sex/race/age/origin/skills/health), '
  'kinship (mother/father/mate/children/grandparents), owner-side transfers '
  '(seller/buyer+prices), and maritime arrival. Feeds person_facts + '
  'canonical_family_edges + the enslaver/transfer side; resolved to canonical '
  'persons in the Phase-B step. Hall released this dataset freely.';
