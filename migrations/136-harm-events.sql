-- 136 — harm_events: first-class, retrievable record of DISTINCT HEADS OF HARM beyond stolen labour.
--
-- User directive (2026-08-09): the Freedmen's Bureau letters (and wills, petitions, etc.) are evidence of
-- GREATER HARM CATEGORIES — assault, tearing families apart, wrongful imprisonment, a beating causing a
-- miscarriage — which are ADDED PENALTIES on top of the labour-value debt. They must be caught, accounted for,
-- and retrievably stored, each tied to a VICTIM + PERPETRATOR + a primary-source citation.
--
-- AUDIT DISCIPLINE (RULE): this table stores the HARM as evidence + categorises it as reparations-relevant.
-- It does NOT assign a dollar penalty — the Craemer 2015 labour formula is canonical, and no new penalty
-- constant enters without a CITED methodology. `penalty_methodology`/`penalty_usd` stay NULL until a cited
-- valuation source (e.g. Darity & Mullen additional-damages framing, or a tort/wrongful-death schedule) is
-- attached and versioned. So the harm is never lost, never fabricated into a number, and ready for the
-- penalty layer the moment a citation exists.

CREATE TABLE IF NOT EXISTS harm_events (
  id                     BIGSERIAL PRIMARY KEY,
  harm_type              TEXT NOT NULL,     -- physical_assault | sexual_violence | wrongful_death | family_separation_by_sale |
                                            -- child_apprenticeship | denial_of_kin_reunion | wage_theft | property_theft |
                                            -- estate_withholding | false_imprisonment | forced_labor | destitution_neglect |
                                            -- political_persecution | racial_discrimination | other
  harm_category          TEXT,              -- bodily | familial | economic | legal | civic  (grouping for aggregation)
  -- WHO was harmed / WHO did it (either a canonical/lead person, or a name string when unresolved)
  victim_subject_table   TEXT, victim_subject_id TEXT, victim_name TEXT,
  perpetrator_subject_table TEXT, perpetrator_subject_id TEXT, perpetrator_name TEXT,
  narrative              TEXT NOT NULL,     -- THE VERBATIM ACCOUNT of the wrong (the "tea" — their words, not our summary)
  event_date             TEXT, location TEXT,
  source_document_id     BIGINT,            -- person_documents.id (the letter/record) — provenance
  source_citation        TEXT NOT NULL,     -- e.g. "Freedmen's Bureau Register of Letters, Amelia office, FS 1596147, p.121"
  reparations_relevant   BOOLEAN DEFAULT TRUE,   -- an added head of damage
  penalty_methodology    TEXT,              -- CITED valuation source; NULL until one exists (never invent)
  penalty_usd            NUMERIC,           -- NULL until penalty_methodology is set (audit: no unsourced numbers)
  confidence_score       NUMERIC,           -- provenance tier of the underlying source
  requires_human_review  BOOLEAN DEFAULT TRUE,
  created_at             TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_harm_type       ON harm_events(harm_type);
CREATE INDEX IF NOT EXISTS idx_harm_victim      ON harm_events(victim_subject_table, victim_subject_id);
CREATE INDEX IF NOT EXISTS idx_harm_perpetrator ON harm_events(perpetrator_subject_table, perpetrator_subject_id);
CREATE INDEX IF NOT EXISTS idx_harm_doc         ON harm_events(source_document_id);

COMMENT ON TABLE harm_events IS
  'Distinct heads of harm (assault, family separation, wrongful death, wage/property theft, false imprisonment…)
   as reparations-relevant evidence, tied to victim + perpetrator + citation. Narrative kept verbatim. No dollar
   penalty until a CITED methodology is attached (penalty_methodology). Retrievable: embedded via embeddings
   (subject_table=harm_events, content_kind=harm_narrative) so harms surface in RAG / DAA / person modals.';
