CREATE TABLE calculation_method_registry (
  method_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT,
  formula_pseudocode TEXT,
  source_author TEXT,
  source_year INTEGER,
  source_citation TEXT,
  base_data_source TEXT,
  compound_rate_default NUMERIC(5,4),
  notes TEXT
);