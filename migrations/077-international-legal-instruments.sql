CREATE TABLE international_legal_instruments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_key TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  instrument_type TEXT CHECK (instrument_type IN ('un_resolution', 'icj_proceeding', 'treaty', 'academic_report', 'symposium_proceedings')),
  adopting_body TEXT,
  adoption_date DATE,
  vote_for INTEGER,
  vote_against INTEGER,
  vote_abstain INTEGER,
  us_position TEXT CHECK (us_position IN ('voted_for', 'voted_against', 'abstained', 'not_applicable')),
  significance TEXT,
  url TEXT,
  notes TEXT
);