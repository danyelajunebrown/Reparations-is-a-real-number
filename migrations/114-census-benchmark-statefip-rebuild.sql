-- Migration 114: Rebuild census_holding_benchmarks on VALIDATED geography (statefip)
-- Date: 2026-07-03
--
-- WHY (auditor-facing): M113 keyed on `stateicp` from the IPUMS "household" CSVs. That
-- column is UNCERTIFIED (IPUMS's availability table marks STATEICP unavailable for every
-- year 1790-1840) and is empirically CORRUPT: Virginia and Tennessee's ICPSR codes are
-- TRANSPOSED across 1810-1840 (VA's ~450k enslaved landed under stateicp=40 "Tennessee").
-- A VA<->TN swap conserves the national total, so it passed the national-total gate while
-- the per-state strata were 60-200% wrong. Caught by a per-state control-total audit; the
-- corrupt 1830/1840 rows were rolled back. See plan-ipums-census-benchmark.md.
--
-- THE FIX: the IPUMS COUNTY-level file (C_*.csv) carries `statefip` (validated FIPS) AND is
-- already county-aggregated. Under statefip, 1840 GA/MD/SC/TN match published to 0.0% and VA
-- to -4.1% (real mild coverage). This migration rebuilds the table keyed on (year, statefip,
-- countyicp), sourced from the C file, so the reference-class stratification (#90) rests on
-- correct geography. stateicp is retained for reference only, flagged known-corrupt.
--
-- NOTE: household-distribution stats (slaveholding-household count, max single holding) came
-- from the household file and are DROPPED here — the C file is county-aggregate only. They
-- can be recovered later by fixing the H file's geography via the statefip<->stateicp county
-- crosswalk the C file provides. The essential #90 product (county enslaved/free/pop
-- denominators + demographic buckets) is fully present and now correct.

DROP TABLE IF EXISTS census_holding_benchmarks;

CREATE TABLE census_holding_benchmarks (
    id BIGSERIAL PRIMARY KEY,

    census_year INTEGER NOT NULL,
    statefip    INTEGER NOT NULL,   -- VALIDATED FIPS state code (authoritative geography)
    countyicp   INTEGER NOT NULL,   -- ICPSR county code (unique within state)
    stateicp    INTEGER,            -- reference only; KNOWN-CORRUPT (VA<->TN transposed pre-1850)
    region      INTEGER,            -- IPUMS census region code

    -- Year-invariant population denominators (SUM of government census counts; deterministic
    -- ETL over a primary aggregate, not model output — audit rule 1 not implicated)
    enslaved_total BIGINT NOT NULL, -- nslave_c
    free_total     BIGINT NOT NULL, -- numperhh_c
    pop_total      BIGINT NOT NULL, -- ntotal_c

    -- IPUMS's own county population totals (independent cross-check vs the sums above)
    county_pop_free  BIGINT,        -- cntypopf
    county_pop_slave BIGINT,        -- cntypops

    -- Full demographic breakdown verbatim (year-dependent age/sex/race buckets; empty pre-1830)
    bucket_sums JSONB NOT NULL DEFAULT '{}'::jsonb,

    secondary_source_compilation_id UUID REFERENCES secondary_source_compilations(id) ON DELETE SET NULL,
    ipums_note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (census_year, statefip, countyicp)
);

CREATE INDEX idx_chb_year ON census_holding_benchmarks(census_year);
CREATE INDEX idx_chb_year_enslaved ON census_holding_benchmarks(census_year, enslaved_total DESC);
CREATE INDEX idx_chb_geo ON census_holding_benchmarks(statefip, countyicp);
