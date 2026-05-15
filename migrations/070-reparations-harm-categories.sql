CREATE TABLE reparations_harm_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_key TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  era TEXT NOT NULL CHECK (era IN ('antebellum', 'reconstruction', 'jim_crow', 'modern')),
  period_start INTEGER,
  period_end INTEGER, -- NULL = ongoing
  description TEXT,
  primary_citation TEXT,
  calculation_method_key TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);