-- Migration 120: typed LBS tables (stage-2 promotion targets for the UCL LBS scrape)
-- Date: 2026-07-04
--
-- WHY: lbs_raw_records (M118) holds raw HTML + parsed JSONB; these typed tables are the QUERYABLE
-- promotion targets that scripts/ingest-ucl-lbs.mjs writes from the parser (src/services/lbs/lbs-parser.js).
-- Persons go to the SPINE via PersonService.findOrCreateLead (full attrs, standard-external-source-ingest
-- rule #3) + person_external_ids id_system='ucl_lbs_person'; these tables carry the CLAIM / ESTATE / FIRM
-- structure that isn't a person.
--
-- DUAL-LEDGER (audit rule #3): lbs_claims.compensation_* = £ paid TO owners = EVIDENCE OF DEBT owed to
-- the enslaved, never a credit. Values are AS-TRANSCRIBED per claim — NOT summed/aggregated here (audit
-- rule #1; any roll-up is a separate cited step). enslaved_count is the per-claim enumeration.
--
-- Why NOT slave_economy_benchmarks: that table is for CITED jurisdiction-level aggregates (colony/parish
-- totals from published T71/BPP figures). Per-claim and per-estate counts are finer than a reference-class
-- denominator; summing our own estate rows would double-count and corrupt the benchmark semantics. The
-- per-colony control-total TRIPWIRE (rule #2) compares SUM(lbs_claims.enslaved_count) per colony to the
-- published BPP colony totals as a QUALITY GATE in the ingest — it does not write benchmark rows.
--
-- ext_id columns are TEXT (LBS person/firm ids can be negative/huge; claim/estate are small ints as text).

-- ── CLAIMS (the compensation record) ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lbs_claims (
    claim_ext_id     TEXT PRIMARY KEY,          -- /lbs/claim/view/{id}
    claim_no         TEXT,                       -- the SCC claim number (per colony, e.g. "770")
    colony           TEXT,
    parish           TEXT,
    estate_ext_id    TEXT,                       -- /lbs/estate/view/{id} of the primary associated estate
    estate_name      TEXT,
    contested        BOOLEAN,
    award_year       INTEGER,
    award_date_raw   TEXT,
    comp_pounds      INTEGER,                     -- £ s d as transcribed
    comp_shillings   INTEGER,
    comp_pence       INTEGER,
    comp_decimal     NUMERIC,                     -- £ decimalised (s/20 + d/240) for convenience, NOT summed
    enslaved_count   INTEGER,                     -- persons enumerated in the claim
    notes            TEXT,
    source_url       TEXT,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lbs_claims_colony ON lbs_claims (colony);
COMMENT ON COLUMN lbs_claims.comp_decimal IS
  'Decimalised £ compensation paid TO owners — dual-ledger DEBT evidence (audit #3). As-transcribed, never summed.';

-- claim ↔ person roles (awardee / claimant / trustee / mortgagee / previous owner …)
CREATE TABLE IF NOT EXISTS lbs_claim_persons (
    claim_ext_id   TEXT NOT NULL,
    person_ext_id  TEXT NOT NULL,                -- /lbs/person/view/{id}
    subject_table  TEXT,                          -- resolved spine ref (unconfirmed_persons | canonical_persons)
    subject_id     BIGINT,
    role_raw       TEXT NOT NULL DEFAULT '',      -- full role text, e.g. "Awardee (Mortgagee)"
    is_awardee     BOOLEAN NOT NULL DEFAULT FALSE,-- received the money (the debt-bearing party)
    PRIMARY KEY (claim_ext_id, person_ext_id, role_raw)
);
CREATE INDEX IF NOT EXISTS idx_lbs_claim_persons_person ON lbs_claim_persons (person_ext_id);

-- ── ESTATES + registration time-series (denominator / owner-continuity) ─────────────────────────────
CREATE TABLE IF NOT EXISTS lbs_estates (
    estate_ext_id  TEXT PRIMARY KEY,
    name           TEXT,
    colony         TEXT,
    parish         TEXT,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lbs_estate_registrations (
    estate_ext_id    TEXT NOT NULL,
    reg_year         INTEGER NOT NULL,
    enslaved_total   INTEGER,
    enslaved_female  INTEGER,
    enslaved_male    INTEGER,
    possessor        TEXT,                         -- named holder that year (owner-continuity thread)
    PRIMARY KEY (estate_ext_id, reg_year)
);

-- ── FIRMS (commercial legacies — continuity-of-holding substrate) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS lbs_firms (
    firm_ext_id  TEXT PRIMARY KEY,
    name         TEXT,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lbs_firm_people (
    firm_ext_id    TEXT NOT NULL,
    person_ext_id  TEXT NOT NULL,
    subject_table  TEXT,
    subject_id     BIGINT,
    role_raw       TEXT NOT NULL DEFAULT '',       -- Director / Founding Committee Member / Partner …
    PRIMARY KEY (firm_ext_id, person_ext_id, role_raw)
);
