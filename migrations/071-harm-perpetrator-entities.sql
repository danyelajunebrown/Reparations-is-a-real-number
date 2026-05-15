CREATE TABLE harm_perpetrator_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_key TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('federal_government', 'state_government', 'corporation', 'individual')),
  state_code TEXT,
  successor_of TEXT[],
  documented_involvement TEXT,
  primary_citation TEXT,
  corporate_entity_id UUID REFERENCES corporate_entities(entity_id), -- nullable
  created_at TIMESTAMPTZ DEFAULT NOW()
);