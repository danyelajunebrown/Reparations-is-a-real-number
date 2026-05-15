CREATE TABLE daa_line_item_junction (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daa_id UUID REFERENCES debt_acknowledgment_agreements(daa_id) NOT NULL,
  line_item_id UUID REFERENCES reparations_line_items(id) NOT NULL,
  UNIQUE (daa_id, line_item_id)
);