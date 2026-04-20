-- Migration 043: Corporate slavery evidence + institutional debt model
--
-- Up until now the system has modeled debt as flowing from a specific
-- enslaver (cp=X) to the descendants of the people that enslaver held.
-- The Morgan-family thought experiment on Apr 20 surfaced that for
-- entire lineages, the debt is INSTITUTIONAL — Aetna insurance premiums,
-- JPMorgan Chase predecessor-bank slave-collateral loans, Confederate
-- bond issuances, cotton-trade financing.
--
-- This migration adds three tables:
--
--   slave_era_insurance_policies
--     One row per policy on an enslaved person's life. Seed source is
--     the California Slavery Era Insurance Registry (SB 2199, 2000) —
--     687 policies from 4 insurers covering 10 states + DC, published
--     via Harvard Dataverse (https://doi.org/10.7910/DVN/BP6JHQ).
--
--   corporate_slavery_disclosures
--     Formal institutional admissions of historical slavery involvement
--     (JPMorgan Chase 2005/2024, Aetna 2000, etc.). These are evidence
--     that a present-day corporate entity is the legal successor of a
--     historical debt originator. Acts as a Tier-B evidence source for
--     INSTITUTIONAL DAAs.
--
--   corporate_debt_acknowledgments
--     Mirrors debt_acknowledgment_agreements but for corporations. A
--     corporation-level DAA names the enslaved persons documented in the
--     disclosure + the modern successor company + the calculated debt.
--     Later work will wire a separate on-chain escrow contract for
--     these.
--
-- Each of these tables links into person_documents + canonical_persons
-- by standard FKs. The probate gate (DAAOrchestrator._enforceProbateGate)
-- will gain a Tier D for institutional evidence.

CREATE TABLE IF NOT EXISTS slave_era_insurance_policies (
    policy_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Policy identification
    policy_number        TEXT,                                -- as reported
    underwriter_name     TEXT NOT NULL,                       -- as at time of policy
                                                              -- ("Aetna Life Insurance Company",
                                                              --  "New York Life Insurance Company")
    modern_successor     TEXT,                                -- who owns that
                                                              -- underwriter today
                                                              -- ("CVS Health Corporation" for Aetna)
    policy_year          INTEGER,                             -- when known
    policy_date          DATE,                                -- when known exactly

    -- Slaveholder (premium payer, beneficiary)
    slaveholder_name     TEXT NOT NULL,
    slaveholder_state    TEXT,
    slaveholder_county   TEXT,
    slaveholder_canonical_id INTEGER REFERENCES canonical_persons(id) ON DELETE SET NULL,

    -- Enslaved person (insured life)
    enslaved_name        TEXT,
    enslaved_state       TEXT,
    enslaved_county      TEXT,
    enslaved_age         TEXT,                                -- "21", "24 yrs", etc. — keep as text
    enslaved_occupation  TEXT,                                -- "Waiter", "Washer", "House servant"
    enslaved_canonical_id INTEGER REFERENCES canonical_persons(id) ON DELETE SET NULL,

    -- Valuation (often absent from public disclosures — insurers rarely
    -- disclosed the face value directly)
    face_value_usd       DECIMAL(10,2),
    premium_usd          DECIMAL(10,2),

    -- Provenance
    registry_source      TEXT NOT NULL,                       -- 'california_seir_2000', 'sb2199',
                                                              -- 'aetna_2000_disclosure',
                                                              -- 'jpmc_2005_disclosure', etc.
    source_archive       TEXT,                                -- where the document lives
    source_citation      TEXT,
    submission_year      INTEGER,                             -- when the insurer submitted to the registry

    -- Raw row payload (for recall of fields we don't yet model)
    raw_data             JSONB,

    -- Review
    human_verified       BOOLEAN DEFAULT FALSE,
    reviewer_notes       TEXT,

    created_at           TIMESTAMPTZ DEFAULT NOW(),
    updated_at           TIMESTAMPTZ DEFAULT NOW(),

    -- Dedup: same underwriter + policy # should only exist once
    CONSTRAINT sei_policies_unique_policy UNIQUE (underwriter_name, policy_number)
);

CREATE INDEX IF NOT EXISTS idx_sei_slaveholder_canonical ON slave_era_insurance_policies(slaveholder_canonical_id);
CREATE INDEX IF NOT EXISTS idx_sei_enslaved_canonical   ON slave_era_insurance_policies(enslaved_canonical_id);
CREATE INDEX IF NOT EXISTS idx_sei_underwriter          ON slave_era_insurance_policies(underwriter_name);
CREATE INDEX IF NOT EXISTS idx_sei_slaveholder_lower    ON slave_era_insurance_policies(LOWER(slaveholder_name));
CREATE INDEX IF NOT EXISTS idx_sei_enslaved_lower       ON slave_era_insurance_policies(LOWER(enslaved_name));

COMMENT ON TABLE slave_era_insurance_policies IS
  'Life insurance policies written on enslaved persons, primarily drawn from '
  'the California Slavery Era Insurance Registry (SB 2199, 2000). Each row '
  'documents a slaveholder paying premiums on the life of an enslaved person — '
  'so the insurer profited from continued enslavement AND paid out on the '
  'enslaved person''s death. Provides institutional evidence for DAAs '
  'involving modern insurer-successor corporations (CVS Health for Aetna, '
  'Corebridge Financial for AIG, etc.).';


CREATE TABLE IF NOT EXISTS corporate_slavery_disclosures (
    disclosure_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Modern corporation + historical predecessor
    modern_entity_name   TEXT NOT NULL,                       -- "JPMorgan Chase & Co."
    historical_entity_name TEXT NOT NULL,                     -- "Citizens Bank of Louisiana"
                                                              -- (can be same as modern if the
                                                              --  corporation itself is antebellum)

    -- Nature of slavery involvement
    involvement_type     TEXT NOT NULL,                       -- 'loan_collateral', 'direct_ownership',
                                                              -- 'insurance_underwriting',
                                                              -- 'bond_issuance', 'cotton_financing',
                                                              -- 'ship_investment'
    involvement_period_start INTEGER,                         -- year
    involvement_period_end   INTEGER,                         -- year (1865 cap unless post-slavery)

    -- Documented scale
    enslaved_persons_count INTEGER,                           -- count disclosed (e.g. 13,000 for JPMC)
    enslaved_persons_direct_owned INTEGER,                    -- subset actually owned (1,250 for JPMC)
    documented_value_usd DECIMAL(14,2),                       -- if a dollar figure is given

    -- Disclosure mechanics
    disclosure_year      INTEGER NOT NULL,                    -- 2005 for JPMC, 2000 for Aetna
    triggered_by         TEXT,                                -- "Chicago 2003 ordinance",
                                                              -- "CA SB 2199 (2000)",
                                                              -- "voluntary"
    disclosure_document_url TEXT,
    disclosure_document_s3_key TEXT,
    has_names_list       BOOLEAN DEFAULT FALSE,               -- whether the disclosure includes
                                                              -- enslaved-person names
    formal_apology       BOOLEAN DEFAULT FALSE,               -- whether the company issued one
    remediation_funded   TEXT,                                -- e.g. "$5M Smart Start scholarship, 2005"

    -- Provenance + review
    source_notes         TEXT,
    review_status        TEXT DEFAULT 'pending',               -- 'pending', 'verified', 'disputed'
    reviewed_by          TEXT,
    reviewed_at          TIMESTAMPTZ,

    created_at           TIMESTAMPTZ DEFAULT NOW(),
    updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_corp_disc_modern   ON corporate_slavery_disclosures(LOWER(modern_entity_name));
CREATE INDEX IF NOT EXISTS idx_corp_disc_hist     ON corporate_slavery_disclosures(LOWER(historical_entity_name));
CREATE INDEX IF NOT EXISTS idx_corp_disc_type     ON corporate_slavery_disclosures(involvement_type);

COMMENT ON TABLE corporate_slavery_disclosures IS
  'Formal institutional admissions of historical slavery involvement filed '
  'by present-day corporations. Seed entries: JPMorgan Chase 2005 + 2024 '
  '(Citizens Bank of LA + Canal Bank, ~13,000 enslaved persons as loan '
  'collateral), Aetna 2000 (slave-era life insurance), NY Life, AIG. These '
  'act as Tier-B institutional evidence in a CORPORATE DAA — the modern '
  'entity has already admitted the historical debt. Downstream: a corporate '
  'DAA smart contract (separate from the personal ReparationsEscrow) could '
  'persist these acknowledgments on-chain as permanent public record of the '
  'obligation.';


CREATE TABLE IF NOT EXISTS corporate_debt_acknowledgments (
    corporate_daa_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Acknowledger
    corporate_entity     TEXT NOT NULL,                       -- "JPMorgan Chase & Co.", "CVS Health"
    corporate_jurisdiction TEXT,                              -- primary incorporation jurisdiction
    disclosure_id        UUID REFERENCES corporate_slavery_disclosures(disclosure_id) ON DELETE SET NULL,

    -- Scope of obligation
    base_claim_type      TEXT NOT NULL,                       -- 'loan_default_ownership',
                                                              -- 'insurance_premium_collection',
                                                              -- 'bond_profit', 'cotton_trade_profit'
    enslaved_persons_named JSONB,                             -- array of names extracted from the
                                                              -- disclosure or cross-referenced
    enslaved_persons_count INTEGER,
    documented_1860_value_usd DECIMAL(14,2),                  -- nominal value in 1860 dollars
    estimated_modern_value_usd DECIMAL(18,2),                 -- compound-grown to today

    -- Payment / execution (mirrors debt_acknowledgment_agreements pattern)
    status               TEXT DEFAULT 'draft',                 -- 'draft', 'published_onchain',
                                                              -- 'partially_satisfied', 'satisfied'
    on_chain_tx_hash     TEXT,                                 -- hash of the on-chain publication
    on_chain_contract    TEXT,                                 -- address of the corporate-DAA contract
    total_pledged_usd    DECIMAL(14,2) DEFAULT 0,
    total_paid_usd       DECIMAL(14,2) DEFAULT 0,

    -- Methodology + audit
    methodology_notes    TEXT,
    citations            TEXT[],

    created_at           TIMESTAMPTZ DEFAULT NOW(),
    updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_corp_daa_entity   ON corporate_debt_acknowledgments(LOWER(corporate_entity));
CREATE INDEX IF NOT EXISTS idx_corp_daa_status   ON corporate_debt_acknowledgments(status);

COMMENT ON TABLE corporate_debt_acknowledgments IS
  'Corporate-entity DAAs — NOT a separate kind of obligation, but the same '
  'class-obligation model applied to an institutional acknowledger instead '
  'of an individual. Every DAA is a class obligation: an enslaver who held '
  '100 people owes a class of descendants most of whom are not yet known, '
  'exactly as a corporation that held 13,000 people does. The only '
  'difference is the ACKNOWLEDGER — person or legal entity — not the shape '
  'of the debt. Descendants claim their portion as they''re verified over '
  'time. This table holds the institutional-acknowledger variant so the '
  'same escrow / smart-contract infrastructure can serve both.';
