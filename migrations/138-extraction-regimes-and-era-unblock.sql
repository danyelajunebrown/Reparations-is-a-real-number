-- Migration 136: Extraction regimes + unblock the neocolonial era value
-- Date: 2026-08-09
-- Standard: memory-bank/standard-obligation-ledger.md §1.5.6 (DEFECT 1, DEFECT 2)
--
-- WHY (DEFECT 1 — blocking, verified live 2026-08-09):
--   Migration 087 added `perpetrating_multilateral` + `extraction_mechanism` to
--   reparations_harm_categories and documented 'neocolonial' as an accepted `era`
--   value IN A COLUMN COMMENT -- but never altered the CHECK constraint created by
--   migration 070. Live constraint on this date was, verbatim:
--
--     reparations_harm_categories_era_check ::
--       CHECK ((era = ANY (ARRAY['antebellum','reconstruction','jim_crow','modern'])))
--
--   So every harm category M087 was written to enable -- haiti_double_debt,
--   cfa_franc_seigniorage, imf_sap_extraction, tariff_escalation,
--   vulture_fund_litigation -- is REJECTED ON INSERT. That is why the neocolonial
--   extension has never populated. This migration adds the missing value.
--
-- WHY (DEFECT 2 — structural):
--   The `era` vocabulary is US-periodized. 'antebellum' / 'reconstruction' /
--   'jim_crow' cannot hold the Hawaiian Kingdom overthrow, the Porfiriato, the
--   Mandate period, or any non-US regime. Per the standard, harm categories move to
--   a (regime_key, period_start, period_end) model, with the US era labels demoted
--   to a display attribute of the US regime.
--
--   This migration lays that groundwork NON-BREAKINGLY: it creates the regime table
--   and adds nullable columns. It does NOT add a NOT NULL, does NOT add an FK yet,
--   and does NOT drop `era`. Existing readers are unaffected.
--
-- NO ROW INSERTS. Per the Session-60 rule (2026-05-24) and
-- memory/feedback_no_hardcoded_perpetrator_seeds.md: schema CREATE TABLE migrations
-- are fine; row INSERTs are not. Regimes are NOMINATED through the contribute
-- pipeline with evidence, never declared in code. This migration therefore seeds
-- nothing -- not even the US regime.
--
-- Idempotent. Additive. Safe to re-run.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. DEFECT 1 -- allow the neocolonial era value (unblocks M087 entirely)
-- ---------------------------------------------------------------------------

ALTER TABLE reparations_harm_categories
    DROP CONSTRAINT IF EXISTS reparations_harm_categories_era_check;

ALTER TABLE reparations_harm_categories
    ADD CONSTRAINT reparations_harm_categories_era_check
    CHECK (era IN ('antebellum', 'reconstruction', 'jim_crow', 'modern', 'neocolonial'));

-- ---------------------------------------------------------------------------
-- 2. DEFECT 2 -- the regime layer (empty; rows arrive via the contribute pipe)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS extraction_regimes (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    regime_key              TEXT UNIQUE NOT NULL,      -- 'us_chattel_slavery', 'hawaii_kingdom_overthrow', ...
    display_name            TEXT NOT NULL,
    jurisdiction            TEXT,                      -- polity/state whose law made the taking lawful
    period_start            INTEGER,
    period_end              INTEGER,                   -- NULL = ongoing

    -- The four predicates (standard-obligation-ledger.md §1.5.1). Each is a
    -- DOCUMENTED assertion, not an opinion: the *_evidence_id columns point at
    -- provenance_evidence (M084, polymorphic). Defaults are FALSE -- a regime is
    -- admissible only when a contributor affirmatively evidences all four, the
    -- same posture african_polities (M083) takes for harm/receiving party.
    predicate_extractor_identified      BOOLEAN NOT NULL DEFAULT FALSE,
    predicate_counterparty_coerced      BOOLEAN NOT NULL DEFAULT FALSE,
    predicate_value_persisted           BOOLEAN NOT NULL DEFAULT FALSE,
    predicate_no_share_returned         BOOLEAN NOT NULL DEFAULT FALSE,
    predicate_evidence_ids              UUID[],        -- -> provenance_evidence (M084)

    -- The instrument that made the taking lawful. This is what distinguishes an
    -- admissible regime from ordinary theft, and it is usually what caused the
    -- record to exist at all (§1.5.1 predicate 2).
    legality_instrument     TEXT,                      -- e.g. 'US Const. amend. XIII sec. 1 (exception clause)'

    -- §1.5.3: per-regime valuation is MANDATORY and never transferred across
    -- regimes. A regime cannot be admitted without one.
    valuation_methodology_id UUID REFERENCES estimation_methodology_registry(id),

    -- §1.5.2: an account requires a priced, dated, documented origination entry.
    origination_entry_available BOOLEAN NOT NULL DEFAULT FALSE,
    origination_source_notes    TEXT,                  -- what corpus would supply it, or what is missing

    status                  TEXT NOT NULL DEFAULT 'candidate'
                            CHECK (status IN ('candidate', 'admitted', 'rejected', 'superseded')),
    status_reason           TEXT,
    admitted_at             TIMESTAMPTZ,
    contribution_status     VARCHAR(30) DEFAULT 'pending_review',
    notes                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_extraction_regimes_status ON extraction_regimes(status);

COMMENT ON TABLE extraction_regimes IS
  'Registered extraction regimes (standard-obligation-ledger.md §1.5). The obligation ACCOUNT is regime-agnostic; the VALUATION is regime-specific and lives in estimation_methodology_registry (M060). A regime is ADMITTED only when all four predicates are documented AND a priced, dated, documented origination entry is available. Rows enter via the contribute pipeline, never a seed script.';

COMMENT ON COLUMN extraction_regimes.predicate_counterparty_coerced IS
  'Predicate 2: value taken from identified people or their land under a legal regime that made the taking lawful AND the extracted party unable to refuse. For structural-financial regimes (IMF SAPs, tariff escalation, CFA franc) this predicate is CONTESTED and must be argued per case with evidence -- never assumed.';

COMMENT ON COLUMN extraction_regimes.valuation_methodology_id IS
  'Mandatory before admission (§1.5.3). Craemer 2015 is US-chattel-slavery-specific and does NOT travel to Hawaiian contract labor, Mexican enganche peonage, or convict leasing. Cross-regime constant reuse is a defect under CLAUDE.md audit rule 4.';

-- ---------------------------------------------------------------------------
-- 3. Point harm categories at the regime layer (nullable; FK deferred)
-- ---------------------------------------------------------------------------

ALTER TABLE reparations_harm_categories
    ADD COLUMN IF NOT EXISTS regime_key          TEXT,
    ADD COLUMN IF NOT EXISTS jurisdiction        TEXT,
    ADD COLUMN IF NOT EXISTS legality_instrument TEXT;

COMMENT ON COLUMN reparations_harm_categories.regime_key IS
  'Supersedes `era` for regime typing (standard-obligation-ledger.md §1.5.6 DEFECT 2). Intentionally NOT an FK yet: extraction_regimes is empty by design and regimes arrive through the contribute pipeline. Add the FK once the /promote/:leadId target_table pipe lands and the first regimes are nominated.';

COMMENT ON COLUMN reparations_harm_categories.era IS
  'US-periodized DISPLAY label only. Accepted: antebellum, reconstruction, jim_crow, modern, neocolonial. DO NOT add further era strings -- non-US regimes are typed by regime_key + period_start/period_end instead. Retained for backward compatibility with existing readers (DAAOrchestrator, reparations_line_items joins).';

COMMIT;
