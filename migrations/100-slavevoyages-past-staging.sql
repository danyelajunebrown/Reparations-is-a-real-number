-- Migration 100: SlaveVoyages "People of the Atlantic Slave Trade" (PAST) staging
--                + source_artifacts (the reusable file-archive registry).
--
-- WHY (pre-1860 document-coverage expansion, Jun 2026): the U.S. census stack we
-- already hold names NO enslaved people (owner + counts only). The highest-yield
-- NAMED-enslaved sources are SlaveVoyages PAST — African Origins (~91,491 liberated
-- Africans, 1808-1862) and Oceans of Kinfolk (~63,562 people forced to New Orleans,
-- 1820-1860, WITH owner/shipper/consignor linkages). Both are CC BY-NC 3.0 → the
-- structured data is re-hostable to our S3 (NC is fine for this non-commercial
-- project). This stages the named records (lossless `raw`) so a later pass emits
-- person_facts + person_external_ids(slavevoyages_past) and, for Oceans of Kinfolk,
-- enslaver→enslaved chattel_transfer_events (same continuity substrate as Hall).
--
-- NO ROW INSERTS (loaded by scripts/ingest-slavevoyages-past.mjs). Additive.

-- ───────────────────────────────────────────────────────────────────────────
-- source_artifacts — one row per ingested SOURCE FILE. Records WHERE the file
-- lives (our S3 re-host + the Internet Archive/Wayback snapshot of its canonical
-- page), its sha256, license, and whether we may re-host it. This is the durable
-- provenance + archive spine for EVERY future bulk source, not just SlaveVoyages:
--   rehostable=TRUE  → file stored in our S3 (s3_key set), Wayback as backup.
--   rehostable=FALSE → link/Wayback-only (third-party rights) — s3_key stays NULL.
-- (Serve-order decision: our S3 is primary for files we're licensed to host;
--  Wayback is the provenance/backup snapshot. Wayback is rate-limited and not a
--  serving backend, so Wayback-primary is reserved for non-rehostable sources.)
CREATE TABLE IF NOT EXISTS source_artifacts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    artifact_key  TEXT NOT NULL UNIQUE,     -- stable slug, e.g. 'slavevoyages-african-origins'
    dataset_label TEXT NOT NULL,            -- human label
    source_name   TEXT NOT NULL,            -- 'SlaveVoyages'
    source_url    TEXT NOT NULL,            -- canonical dataset page (what we Wayback-snapshot)
    download_url  TEXT,                     -- the actual file URL, if known

    -- our re-host (NULL when link/Wayback-only)
    s3_bucket     TEXT,
    s3_key        TEXT,
    -- provenance backup
    wayback_url   TEXT,                     -- IA snapshot of source_url (or download_url)

    sha256        TEXT,                     -- of the downloaded file
    bytes         BIGINT,
    content_type  TEXT,

    license       TEXT,                     -- 'CC BY-NC 3.0', 'OGL v3.0', 'public domain', ...
    rehostable    BOOLEAN NOT NULL DEFAULT TRUE,
    record_count  INTEGER,
    retrieved_at  TIMESTAMPTZ,
    notes         TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE source_artifacts IS
  'Archive + provenance registry: one row per ingested source FILE — our S3 '
  're-host (s3_key) + Wayback snapshot (wayback_url) + sha256 + license + '
  'rehostable flag. Reusable across all bulk sources; feeds the serve-order '
  'routing (S3-primary when rehostable, Wayback/link-only otherwise).';

-- ───────────────────────────────────────────────────────────────────────────
-- slavevoyages_past_people — staged NAMED records from the two PAST datasets.
-- Lean typed columns (the queryable union of both schemas); full lossless record
-- in `raw`. Resolved to canonical persons in the Phase-2 step (NOT here).
CREATE TABLE IF NOT EXISTS slavevoyages_past_people (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset       TEXT NOT NULL CHECK (dataset IN ('african_origins','oceans_of_kinfolk')),
    record_index  INTEGER NOT NULL,        -- 0-based row in the source CSV (stable within dataset)
    sv_id         TEXT,                     -- SlaveVoyages record id if present

    -- person
    name              TEXT,
    name_modern       TEXT,                 -- normalized/modern spelling if provided
    sex               TEXT,                 -- decoded
    age               NUMERIC(5,1),
    age_category      TEXT,                 -- man/woman/boy/girl/infant (PAST sex-age)
    height_inches     NUMERIC(5,1),         -- Oceans of Kinfolk stature
    racial_descriptor TEXT,                 -- verbatim color/race
    origin            TEXT,                 -- African Origins: country/region of origin
    language_group    TEXT,                 -- African Origins suggested language origin

    -- voyage / document linkage
    voyage_id     TEXT,                     -- SlaveVoyages voyage id (joins slavevoyages_voyages)
    ship_name     TEXT,
    year          INTEGER,                  -- arrival year / manifest year
    embark_port   TEXT,
    disembark_port TEXT,                    -- New Orleans for Oceans of Kinfolk

    -- owner side (Oceans of Kinfolk) — feeds chattel_transfer_events later
    owner_name    TEXT,
    shipper_name  TEXT,
    consignor_name TEXT,

    raw               JSONB NOT NULL,
    source_artifact_id UUID REFERENCES source_artifacts(id),
    ingested_at       TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (dataset, record_index)
);

CREATE INDEX IF NOT EXISTS idx_svpast_name    ON slavevoyages_past_people(LOWER(name));
CREATE INDEX IF NOT EXISTS idx_svpast_dataset ON slavevoyages_past_people(dataset);
CREATE INDEX IF NOT EXISTS idx_svpast_year    ON slavevoyages_past_people(year);
CREATE INDEX IF NOT EXISTS idx_svpast_voyage  ON slavevoyages_past_people(voyage_id);
CREATE INDEX IF NOT EXISTS idx_svpast_owner   ON slavevoyages_past_people(LOWER(owner_name));

COMMENT ON TABLE slavevoyages_past_people IS
  'Staged NAMED enslaved records from SlaveVoyages PAST — African Origins '
  '(~91,491 liberated Africans) + Oceans of Kinfolk (~63,562 coastwise to New '
  'Orleans, with owner/shipper/consignor). CC BY-NC 3.0. Feeds person_facts + '
  'person_external_ids(slavevoyages_past) and (Oceans of Kinfolk) '
  'chattel_transfer_events; resolved to canonical persons in a later pass.';
