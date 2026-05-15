CREATE TABLE legal_theory_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  theory_key TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  jurisdiction TEXT NOT NULL CHECK (jurisdiction IN ('domestic_us', 'international')),
  legal_basis TEXT,
  key_instrument TEXT,
  notes TEXT
);