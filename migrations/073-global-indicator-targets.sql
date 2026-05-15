CREATE TABLE global_indicator_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_author TEXT NOT NULL,
  source_year INTEGER,
  source_title TEXT,
  scope TEXT NOT NULL CHECK (scope IN ('us_ados', 'us_as_perpetrator', 'global_all_nations')),
  methodology TEXT NOT NULL CHECK (methodology IN ('racial_wealth_gap', 'itemization', 'cost_to_enslaved', 'international_law_violations')),
  total_usd_low NUMERIC(30,2),
  total_usd_high NUMERIC(30,2),
  per_capita_usd NUMERIC(20,2),
  reference_year INTEGER,
  interest_rate NUMERIC(5,4),
  notes TEXT,
  primary_citation TEXT,
  UNIQUE (source_author, source_year, scope, methodology)
);