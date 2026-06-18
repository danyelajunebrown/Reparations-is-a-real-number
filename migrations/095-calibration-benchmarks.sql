-- Migration 095: calibration_benchmarks — auditable record of each population-
--                SCOPED benchmark (GitHub #90).
--
-- WHY: benchmarking a DOCUMENTED subset to a national control total
-- (Brattle $36T / Darity $14T) inflates it to cover the undocumented population
-- (the coverage/denominator bug). The fix is a SCOPED control total that scales
-- with OUR documented population — e.g. Brattle's $96k/person-year × the
-- person-years WE have documented. This table records each such benchmark so the
-- factor is auditable and downstream layers apply a transparent, cited control.
--
-- Each row: a (model, population-scope) → control_total + raw_sum + factor, with
-- the denominator (person-years / persons / lineages) that makes the scope explicit.
--
-- NO ROW INSERTS (written by scripts/scoped-benchmark.mjs).

CREATE TABLE IF NOT EXISTS calibration_benchmarks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    model_key          TEXT NOT NULL,        -- 'wage_theft', 'lineage_ledger', ...
    population_scope   TEXT NOT NULL,        -- human description of WHICH population
    scope_denominator  TEXT,                 -- 'person_years' | 'persons' | 'lineages'
    scope_denominator_value NUMERIC(20,2),   -- e.g. 48.9e6 documented person-years

    -- The control the model is benchmarked TO, and where it came from.
    control_total_usd  NUMERIC(30,2) NOT NULL,
    control_basis      TEXT NOT NULL,        -- 'brattle_per_person_year_x_documented_PY', ...
    control_citation   TEXT,

    -- The model's RAW (pre-benchmark) aggregate and the resulting factor.
    raw_sum_usd        NUMERIC(30,2) NOT NULL,
    benchmark_factor   NUMERIC(12,8) NOT NULL,   -- control / raw
    benchmarked_sum_usd NUMERIC(30,2),           -- = control_total_usd (post-benchmark)

    -- Diagnostics (consistency report across reference classes, etc.)
    metadata JSONB,

    computed_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (model_key, population_scope)
);

CREATE INDEX IF NOT EXISTS idx_calib_bench_model ON calibration_benchmarks(model_key);

COMMENT ON TABLE calibration_benchmarks IS
  'Auditable population-SCOPED benchmarks. control_total scales with the documented '
  'population (scope_denominator × a cited per-unit standard), NOT the national '
  'total — avoiding the coverage/denominator inflation bug. benchmark_factor = '
  'control_total / raw_sum disciplines the raw model estimate to the scoped control.';
