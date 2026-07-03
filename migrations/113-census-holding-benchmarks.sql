-- Migration 113: Census Holding Benchmarks (IPUMS 1790–1840 complete-count denominators)
-- Date: 2026-07-02
--
-- WHAT / WHY (auditor-facing):
-- County×year AGGREGATE denominators derived from the IPUMS USA complete-count
-- household files (1790–1840). This is a BENCHMARK layer, NOT a person layer:
--   * NO person rows are ever created from this source. The 1790–1840 census named
--     only the head of household; enslaved persons were tallied, never named. Turning
--     a tally into person rows would be the forbidden "Unnamed enslaved person(s)"
--     placeholder (CLAUDE.md audit rule 5, "real or absent"). So this NEVER touches
--     unconfirmed_persons / canonical_persons and skips identity resolution + the
--     canonical/document gate entirely — those doors are for persons, not aggregates.
--   * The stored numbers are deterministic SUMS of GOVERNMENT-PUBLISHED census counts
--     (SUM of nslave/numperhh/ntotal over a county's households). Audit rule 1 ("no
--     model output summed") is not implicated: no model produced these; deterministic
--     ETL aggregates a primary government enumeration. Every cell traces to a
--     (census_year, stateicp, countyicp) group in a cited IPUMS extract.
--   * Evidence tier: SECONDARY (0.85–0.94). IPUMS complete-count is a scholarly
--     transcription/aggregation; the PRIMARY document is the NARA / FamilySearch
--     population-schedule image, located later per county by the scrape this table
--     prioritizes.
--
-- Consumers (none read it yet — operationally inert on apply):
--   1. Calibration #90 scoped-benchmark control totals.
--   2. Coverage metric: documented_enslaved(county,year) / enslaved_total.
--   3. Scrape targeting: rank un-scraped county-years by enslaved density.

CREATE TABLE IF NOT EXISTS census_holding_benchmarks (
    id BIGSERIAL PRIMARY KEY,

    -- Geography / period (ICPSR codes, stored VERBATIM; crosswalk to our
    -- primary_state/primary_county deferred to a separate mapping artifact so a
    -- lossy join is never baked in at ingest time).
    census_year INTEGER NOT NULL,
    stateicp    INTEGER NOT NULL,
    countyicp   INTEGER NOT NULL,

    -- Household aggregates
    household_count              INTEGER NOT NULL,  -- households enumerated in the county-year
    slaveholding_household_count INTEGER NOT NULL,  -- households with nslave > 0

    -- Year-invariant population denominators (present every census 1790–1840)
    enslaved_total BIGINT NOT NULL,  -- SUM(nslave)   — the reparations-critical denominator
    free_total     BIGINT NOT NULL,  -- SUM(numperhh) — total FREE persons
    pop_total      BIGINT NOT NULL,  -- SUM(ntotal)   — total persons

    -- Inequality / targeting signal
    max_household_enslaved INTEGER NOT NULL,  -- largest single holding in the county-year

    -- Full demographic breakdown preserved verbatim (year-dependent age/sex/race
    -- buckets summed per column; empty for 1790 which carries totals only). JSONB so
    -- the queryable columns above stay year-invariant while nothing is discarded.
    bucket_sums JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Provenance
    secondary_source_compilation_id UUID REFERENCES secondary_source_compilations(id) ON DELETE SET NULL,
    ipums_note TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (census_year, stateicp, countyicp)
);

CREATE INDEX IF NOT EXISTS idx_chb_year ON census_holding_benchmarks(census_year);
-- scrape-targeting: densest un-covered county-years first
CREATE INDEX IF NOT EXISTS idx_chb_year_enslaved ON census_holding_benchmarks(census_year, enslaved_total DESC);
CREATE INDEX IF NOT EXISTS idx_chb_geo ON census_holding_benchmarks(stateicp, countyicp);

-- Register the IPUMS source in the M090 compilation registry (secondary-tier ceiling).
INSERT INTO secondary_source_compilations (
    source_title,
    source_editors,
    source_publisher,
    publication_year,
    geographic_scope,
    date_range_start,
    date_range_end,
    record_types,
    max_evidence_tier,
    is_compilation,
    compiles_from_description,
    original_location_text,
    ingested_by,
    review_status,
    etl_script_version
) VALUES (
    'IPUMS USA Complete Count Household Data, 1790–1840',
    ARRAY['Steven Ruggles et al.', 'IPUMS USA, University of Minnesota'],
    'IPUMS USA, University of Minnesota',
    2024,
    ARRAY['United States'],
    1790,
    1840,
    ARRAY['census_household_aggregate'],
    'secondary',
    TRUE,
    'Complete-count transcription/aggregation of the U.S. federal population census, 1790–1840 (household-level counts; heads named only, enslaved persons tallied not named)',
    'IPUMS USA (ipums.org); primary manuscript schedules held at NARA (microfilm) / FamilySearch',
    'ingest-ipums-census-benchmark.mjs',
    'approved',
    '1.0.0'
) ON CONFLICT DO NOTHING;
