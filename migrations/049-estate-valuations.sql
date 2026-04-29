-- Migration 049: estate_valuations
-- Date: 2026-04-29
--
-- Per memory-bank/plan-apr29-will-source-registry-dual-ledger-daa.md §2.M049.
--
-- Captures the testator's total estate value at death, broken down by
-- category. Distinct from historical_reparations_payments (M011/M041)
-- which tracks government compensation paid to enslavers for emancipated
-- persons; this table is the testator-side wealth snapshot for wealth-trace
-- and DAA documented-ledger calculations.
--
-- Source can be a will extraction (typical) or another source (estate
-- inventory, tax appraisal, probate inventory) via source_other_*.
--
-- confidence_low_cents/high_cents adopt the Eltis methodology (JSDP 2021):
-- every quantitative claim carries an explicit uncertainty interval, with
-- the derivation cited via methodology_id (M060).

CREATE TABLE IF NOT EXISTS estate_valuations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Whose estate.
    canonical_person_id INTEGER NOT NULL REFERENCES canonical_persons(id) ON DELETE CASCADE,

    -- Source: either a will_extraction or another typed source.
    source_will_extraction_id UUID REFERENCES will_extractions(id) ON DELETE SET NULL,
    source_other_table TEXT,    -- e.g., 'estate_inventory', 'tax_appraisal', 'probate_inventory'
    source_other_id TEXT,       -- record id within that source table

    -- Total in cents to avoid floating-point drift. currency_year is the
    -- year for which the dollar value applies (compounding to present
    -- happens at DAA time, not stored here).
    total_estate_value_cents BIGINT NOT NULL,
    currency_year INTEGER NOT NULL CHECK (currency_year BETWEEN 1600 AND 2100),

    -- Breakdown shape:
    -- {real_property_cents, personal_property_cents, monetary_cents,
    --  enslaved_persons_cents, debts_owed_cents, debts_owing_cents,
    --  notes?}
    breakdown_jsonb JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Methodology citation (M060). Nullable because direct primary-source
    -- estate totals don't require an inference methodology — the document
    -- IS the methodology.
    methodology_id UUID,  -- FK added in a later migration after M060 lands

    -- Eltis-style explicit uncertainty bound. low and high in cents;
    -- equal to total when bound is unknown / direct primary.
    confidence_low_cents BIGINT,
    confidence_high_cents BIGINT,

    -- Provenance for arbitrary additional cite chain.
    provenance_jsonb JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- A row must come from at least one source.
    CHECK (
        source_will_extraction_id IS NOT NULL
        OR (source_other_table IS NOT NULL AND source_other_id IS NOT NULL)
    ),
    -- If both bounds are set, low <= high.
    CHECK (
        confidence_low_cents IS NULL
        OR confidence_high_cents IS NULL
        OR confidence_low_cents <= confidence_high_cents
    )
);

CREATE INDEX IF NOT EXISTS idx_estate_valuations_canonical_person_id
    ON estate_valuations(canonical_person_id);
CREATE INDEX IF NOT EXISTS idx_estate_valuations_source_will_extraction_id
    ON estate_valuations(source_will_extraction_id);
CREATE INDEX IF NOT EXISTS idx_estate_valuations_currency_year
    ON estate_valuations(currency_year);
