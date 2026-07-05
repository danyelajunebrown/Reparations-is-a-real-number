-- Migration 116: slave_economy_benchmarks — multi-theatre reference-class denominators (#116)
-- Date: 2026-07-03
--
-- WHY: national/colonial slave-population + slave-economy AGGREGATE benchmarks, generalized across
-- theatres via a `polity` discriminator (cuba_colonial, jamaica_colonial, brazil_imperial,
-- british_wi, french_wi, …). The Atlantic-world analog of census_holding_benchmarks (US). Provides
-- #90 calibration control totals per reference class, and the denominator that named enslaved cohorts
-- (SlaveVoyages PAST, #117) sit inside.
--
-- DISCIPLINE (same as the census benchmark):
--   * AGGREGATES ONLY — never person rows (audit rule 5). These are statistical REFERENCE data, not
--     actor records, so seeding via ETL is allowed (unlike harm_perpetrator_entities / named actors,
--     which must enter via the contribute pipeline).
--   * Every row cites its PRIMARY source; a tertiary/secondary conduit is named only where its figures
--     enter the reference class (see reference-benchmark-sources-register.md).
--   * Deterministic ETL over cited government/scholarly aggregates (audit rule 1 not implicated).

CREATE TABLE IF NOT EXISTS slave_economy_benchmarks (
    id BIGSERIAL PRIMARY KEY,

    polity              TEXT NOT NULL,          -- theatre discriminator (reference class root)
    jurisdiction        TEXT,                   -- parish/province/department/island; NULL = polity total
    jurisdiction_level  TEXT,                   -- 'colony' | 'parish' | 'province' | 'department' | 'island'
    benchmark_year      INTEGER NOT NULL,

    metric   TEXT NOT NULL,                     -- enslaved_count | free_count | white_count |
                                                -- free_colored_count | maroon_count | total_pop |
                                                -- capital_value | production | slave_export
    sector    TEXT DEFAULT 'all',              -- all | sugar | coffee | farm | tobacco | ...
    sub_group TEXT,                             -- male|female | lands|plants|buildings|slaves|animals | African-region

    value NUMERIC NOT NULL,
    unit  TEXT NOT NULL,                        -- persons | dollars | pesos | pounds_sterling | arrobas

    bucket_detail JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- provenance (primary-first; conduit only where figures enter the class)
    source_primary  TEXT NOT NULL,
    source_conduit  TEXT,
    secondary_source_compilation_id UUID REFERENCES secondary_source_compilations(id) ON DELETE SET NULL,
    evidence_tier   NUMERIC,                    -- 0.95 gov primary, 0.85-0.94 scholarly, …
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (polity, jurisdiction, benchmark_year, metric, sector, sub_group)
);

CREATE INDEX IF NOT EXISTS idx_seb_polity_year ON slave_economy_benchmarks(polity, benchmark_year);
CREATE INDEX IF NOT EXISTS idx_seb_metric ON slave_economy_benchmarks(metric, sector);
CREATE INDEX IF NOT EXISTS idx_seb_enslaved ON slave_economy_benchmarks(polity, benchmark_year, value DESC) WHERE metric = 'enslaved_count';

-- Register the conduit compilations (primary sources are cited per-row in source_primary).
INSERT INTO secondary_source_compilations
  (source_title, source_editors, publication_year, geographic_scope, date_range_start, date_range_end,
   record_types, max_evidence_tier, is_compilation, compiles_from_description, ingested_by, review_status, etl_script_version)
VALUES
  ('Return of the Inhabitants of Jamaica, 1788 (CO 137/87)', ARRAY['Colonial Office / Governor of Jamaica'],
   1788, ARRAY['Jamaica'], 1788, 1788, ARRAY['colonial_census_return'], 'secondary', FALSE,
   'Primary colonial return; TNA CO 137/87 p.173 (transcribed by Jamaican Family Search)', 'seed-slave-economy-benchmarks.mjs', 'approved', '1.0.0'),
  ('Minutes of the Committee of Privy Council on the Slave Trade (1789) / 1790 Jamaica Almanac',
   ARRAY['Committee of the Privy Council on the Slave Trade'], 1790, ARRAY['British West Indies','French West Indies'],
   1773, 1788, ARRAY['government_inquiry','colonial_census_return'], 'secondary', TRUE,
   'British government slave-trade inquiry; French islands via Necker 1784; reproduced in the 1790 Jamaica Almanac', 'seed-slave-economy-benchmarks.mjs', 'approved', '1.0.0'),
  ('Recenseamento Geral do Império do Brasil de 1872 (DGE)', ARRAY['Diretoria Geral de Estatística'],
   1872, ARRAY['Brazil'], 1872, 1872, ARRAY['national_census'], 'secondary', FALSE,
   'Brazil first national census; DGE (UFMG critical edition / IBGE)', 'seed-slave-economy-benchmarks.mjs', 'approved', '1.0.0')
ON CONFLICT DO NOTHING;
