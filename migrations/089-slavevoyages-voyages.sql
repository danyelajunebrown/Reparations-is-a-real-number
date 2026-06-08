-- SlaveVoyages voyage detail table.
--
-- Motivation: 51,019 person_documents reference SlaveVoyages voyages by
-- ID (the Bucket C1 backfill) but the voyage record itself has never been
-- stored in the DB. The .tab exports already sit in storage/population-data/.
-- Without the voyage row we cannot:
--   - verify a captain/owner identity against the source
--   - dedup canonical_persons by shared voyage_id
--   - render voyage detail on a person's profile
--   - forensic-account voyage-by-voyage trade involvement
--
-- This table holds the key extracted columns plus the entire .tab row in
-- `raw` (JSONB), so no column we didn't think to extract is ever lost.
-- A separate loader script (scripts/load-slavevoyages.mjs) populates it.

CREATE TABLE IF NOT EXISTS slavevoyages_voyages (
    voyageid                INTEGER PRIMARY KEY,
    voyage_type             VARCHAR(16) NOT NULL,  -- 'transatlantic' | 'intraamerican'
    shipname                TEXT,
    nationality             TEXT,
    captain_a               TEXT,
    captain_b               TEXT,
    captain_c               TEXT,
    owners                  TEXT[],                -- OWNERA..OWNERP collapsed
    port_departure          TEXT,
    port_arrival            TEXT,
    port_return             TEXT,
    year_departure          INTEGER,
    year_arrival            INTEGER,
    enslaved_embarked       INTEGER,               -- SLAS32 (slaves on first crossing)
    enslaved_disembarked    INTEGER,               -- SLAMIMP (imputed Americas disembark)
    enslaved_intended       INTEGER,               -- SLINTEND
    enslaved_died_crossing  INTEGER,               -- derived = embarked - disembarked
    voyage_mortality_rate   NUMERIC,               -- VYMRTRAT
    crew_died               INTEGER,
    tonnage                 INTEGER,
    raw                     JSONB NOT NULL,        -- full .tab row as an object
    created_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Indexed lookups we know we'll do.
CREATE INDEX IF NOT EXISTS idx_sv_voyages_shipname
    ON slavevoyages_voyages (lower(shipname)) WHERE shipname IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sv_voyages_year_dep
    ON slavevoyages_voyages (year_departure) WHERE year_departure IS NOT NULL;
-- "Which voyages did X own?" — owners as text array, GIN-indexed for ANY/@>.
CREATE INDEX IF NOT EXISTS idx_sv_voyages_owners
    ON slavevoyages_voyages USING gin (owners);
-- Free-form filters on any uncovered column live on raw.
CREATE INDEX IF NOT EXISTS idx_sv_voyages_raw
    ON slavevoyages_voyages USING gin (raw);
