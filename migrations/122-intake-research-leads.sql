-- 122-intake-research-leads.sql — structured directed research leads parsed from the intake's free-text
-- "anything else" field. That field carries actionable signals the pipeline was throwing away: named
-- slaveholder-family claims (oral history), enslaved-ancestor claims, adoption (biological vs legal
-- lineage), and name changes (identity continuity). A slaveholder-family claim becomes a DIRECTED
-- hypothesis: climb the named lineage branch and cross-reference against the named enslaver family we may
-- already hold — returning a verified match or an honest negative finding (per participant consent).
-- Origin: Adrian's intake — "my paternal grandmother's ancestors were owned by John McCain's ancestors"
-- (we already hold 43 McCain enslavers + 1,242 Carroll County MS enslavers).

CREATE TABLE IF NOT EXISTS intake_research_leads (
  id                  SERIAL PRIMARY KEY,
  participant_id      UUID,                       -- participants.id
  source_field        TEXT DEFAULT 'additional_info',
  raw_text            TEXT NOT NULL,              -- the verbatim claim (auditable provenance)
  claim_type          TEXT NOT NULL,             -- slaveholder_family | enslaved_ancestor | adoption | name_change | other
  lineage_branch      TEXT,                       -- paternal_grandmother | maternal_side | fathers_side | self | ...
  named_entity        TEXT,                       -- the surname/family named ('McCain')
  target_geography    TEXT,                       -- dominant geography of the matched enslavers (e.g. 'Carroll County, Mississippi')
  matched_enslaver_ids INTEGER[] DEFAULT '{}',    -- canonical_persons ids we ALREADY hold matching the entity
  matched_count       INTEGER DEFAULT 0,
  status              TEXT DEFAULT 'open',        -- open | climbing | verified | negative_finding | dismissed
  confidence          NUMERIC DEFAULT 0.5,        -- oral history = a hypothesis, not an assertion
  notes               TEXT,
  created_by          TEXT DEFAULT 'parse-intake-oral-history',
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intake_leads_participant ON intake_research_leads(participant_id);
CREATE INDEX IF NOT EXISTS idx_intake_leads_type ON intake_research_leads(claim_type);
CREATE INDEX IF NOT EXISTS idx_intake_leads_entity ON intake_research_leads(lower(named_entity));
