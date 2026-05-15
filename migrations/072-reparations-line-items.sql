CREATE TABLE reparations_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  beneficiary_type TEXT NOT NULL,  -- 'individual' | 'community'
  canonical_person_id INTEGER REFERENCES canonical_persons(id),
  community_identifier TEXT,
  harm_category_id UUID REFERENCES reparations_harm_categories(id) NOT NULL,
  evidence_tier INTEGER NOT NULL CHECK (evidence_tier IN (1,2,3)),
  evidence_source_table TEXT,
  evidence_source_id TEXT,
  base_amount_usd NUMERIC(20,2),
  base_year INTEGER,
  compounded_amount_usd NUMERIC(20,2),
  compound_rate NUMERIC(5,4),
  compound_to_year INTEGER DEFAULT 2024,
  calculation_method_key TEXT,
  perpetrator_entity_id UUID REFERENCES harm_perpetrator_entities(id),
  legal_theory_ids UUID[],
  brattle_head TEXT CHECK (brattle_head IN ('loss_of_life_and_labour', 'loss_of_liberty', 'personal_injury', 'mental_pain_anguish', 'gender_based_violence')),
  perpetrating_nation TEXT,
  citation TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);