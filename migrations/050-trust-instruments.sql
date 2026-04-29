-- Migration 050: trust_instruments
-- Date: 2026-04-29
--
-- Per memory-bank/plan-apr29-will-source-registry-dual-ledger-daa.md §2.M050.
--
-- Captures multi-generational asset shielding mechanisms — life estates,
-- separate-use trusts, spendthrift trusts, simple remainders. The
-- canonical motivating example is the Biscoe 1859 will, which placed
-- enslaved persons (woman Mary, woman Caroline, Caroline's children)
-- in trust for daughter Emma's "sole and separate use … free, clear &
-- discharged of and from all liability for or on account of any husband
-- she may marry" — a shielding clause that protected enslaved chattel
-- across generations from a daughter's future spouse's creditors.
--
-- Trust instruments are first-class data because they materially affect
-- wealth-trace forward calculations: shielded assets often persist across
-- generations in ways that simple ownership transfer would not.

CREATE TABLE IF NOT EXISTS trust_instruments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Source document. Trust instruments come almost exclusively from wills
    -- and probate filings; other sources allowed via provenance_jsonb but
    -- not through a typed FK.
    source_will_extraction_id UUID REFERENCES will_extractions(id) ON DELETE SET NULL,

    -- Parties.
    testator_canonical_id INTEGER REFERENCES canonical_persons(id) ON DELETE SET NULL,
    trustee_canonical_id INTEGER REFERENCES canonical_persons(id) ON DELETE SET NULL,
    beneficiary_canonical_id INTEGER REFERENCES canonical_persons(id) ON DELETE SET NULL,

    trust_type TEXT NOT NULL
        CHECK (trust_type IN (
            'life_estate',
            'separate_use_trust',
            'spendthrift',
            'simple_remainder',
            'other'
        )),

    -- The verbatim shielding clause if present. Critical for wealth-trace
    -- because the language signals durability of the shielding (e.g.,
    -- "free from any husband she may marry" = multi-generational).
    shielded_from_text TEXT,

    -- Shape: [{asset_type, asset_id?, asset_description, ...}]
    -- Used to point at trust_instruments-shielded enslaved persons,
    -- real property, monetary instruments, etc.
    shielded_assets_jsonb JSONB NOT NULL DEFAULT '[]'::jsonb,

    date_established DATE,
    date_terminated DATE,

    provenance_jsonb JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (
        date_terminated IS NULL
        OR date_established IS NULL
        OR date_terminated >= date_established
    )
);

CREATE INDEX IF NOT EXISTS idx_trust_instruments_testator
    ON trust_instruments(testator_canonical_id);
CREATE INDEX IF NOT EXISTS idx_trust_instruments_beneficiary
    ON trust_instruments(beneficiary_canonical_id);
CREATE INDEX IF NOT EXISTS idx_trust_instruments_trustee
    ON trust_instruments(trustee_canonical_id);
CREATE INDEX IF NOT EXISTS idx_trust_instruments_source_will
    ON trust_instruments(source_will_extraction_id);
CREATE INDEX IF NOT EXISTS idx_trust_instruments_type
    ON trust_instruments(trust_type);
