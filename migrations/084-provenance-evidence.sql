-- Migration 084: Provenance Evidence (generalized)
-- Date: 2026-05-23
-- Purpose: Every claim about any entity in the reparations graph needs to cite
--          a primary or secondary source. This generalized table replaces what
--          was originally scoped as coercion_evidence (only for African polities).
--          Now any entity type — chartered_company, african_polity,
--          harm_perpetrator_entity, corporate_entity, entity_succession,
--          actor_role, canonical_person, reparations_line_item — can have
--          provenance_evidence attached.
--
-- Polymorphic subject pattern (subject_entity_type + subject_entity_id):
-- cannot be enforced via FK; enforced by CHECK constraint on entity_type
-- and by application-level validation in the contribute pipeline.
--
-- Foundational example use: Afonso I of Kongo's July 6 + October 18, 1526
-- letters to João III of Portugal protesting Portuguese-driven slave raiding
-- of noble children. Archive: ANTT Lisbon, Corpo Cronológico Parte I maço 34.
-- Canonical secondary source: Thornton 2023, Afonso I Mvemba a Nzinga (Hackett).
-- These land here as rows with strength_assessment='unambiguous' attached to
-- the Kingdom of Kongo's actor_role of role_type='refuser_state'.
--
-- NO ROW INSERTS.

CREATE TABLE IF NOT EXISTS provenance_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Polymorphic subject
    subject_entity_type VARCHAR(50) NOT NULL,
    subject_entity_id UUID NOT NULL,

    -- What kind of evidence
    evidence_type VARCHAR(60) NOT NULL,                -- 'protest_letter','treaty_under_duress',
                                                       --  'manufactured_goods_dependency_record',
                                                       --  'european_instigated_war','refusal_record',
                                                       --  'royal_complaint','charter_document',
                                                       --  'corporate_acknowledgment','financial_record',
                                                       --  'archival_voyage_record','academic_secondary'

    -- The document
    document_title TEXT,
    document_date DATE,
    archive_reference TEXT,                            -- 'ANTT Lisbon, Corpo Cronológico, Parte I, maço 34'
    document_url TEXT,
    s3_key TEXT,                                       -- if uploaded copy held in our storage

    -- The citation
    canonical_secondary_source TEXT,                   -- 'Thornton 2023, Afonso I Mvemba a Nzinga (Hackett)'
    page_or_folio_reference TEXT,

    -- The substance
    excerpt TEXT,
    excerpt_language VARCHAR(40),                      -- 'Portuguese','English (Madureira translation)','Kikongo'
    excerpt_translation TEXT,                          -- if the original is non-English

    -- The strength
    strength_assessment VARCHAR(30) DEFAULT 'cited',

    -- Linked claim (what specific claim this evidence supports)
    supports_claim_type VARCHAR(80),                   -- 'role_classification','succession','founding',
                                                       --  'dissolution_pathway','sovereign_fold_in',
                                                       --  'capital_flow_step','dependency_commodity'
    supports_claim_id UUID,                            -- e.g., the actor_roles row this evidence backs

    notes TEXT,

    -- Provenance through contribute pipeline
    contribution_status VARCHAR(30) DEFAULT 'pending_review',
    contributor_id UUID,
    approved_by UUID,
    approved_at TIMESTAMP,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT provenance_subject_entity_type_valid CHECK (
        subject_entity_type IN (
            'chartered_company',
            'african_polity',
            'harm_perpetrator_entity',
            'corporate_entity',
            'entity_succession',
            'actor_role',
            'canonical_person',
            'reparations_line_item'
        )
    ),
    CONSTRAINT provenance_strength_assessment_valid CHECK (
        strength_assessment IN ('unambiguous','strong','circumstantial','contested','cited')
    ),
    CONSTRAINT provenance_contribution_status_valid CHECK (
        contribution_status IN ('pending_review', 'approved', 'rejected', 'needs_revision')
    )
);

CREATE INDEX IF NOT EXISTS idx_provenance_subject ON provenance_evidence(subject_entity_type, subject_entity_id);
CREATE INDEX IF NOT EXISTS idx_provenance_evidence_type ON provenance_evidence(evidence_type);
CREATE INDEX IF NOT EXISTS idx_provenance_status ON provenance_evidence(contribution_status);
CREATE INDEX IF NOT EXISTS idx_provenance_supports ON provenance_evidence(supports_claim_type, supports_claim_id);

COMMENT ON TABLE provenance_evidence IS 'Generalized citation table: any entity in the reparations graph can have evidence attached. Subject is polymorphic (entity_type + entity_id) and not enforced via FK. Replaces what was originally scoped as coercion_evidence — broadened so corporate acknowledgments, charter documents, archival voyage records, and refusal records all live in one table.';
COMMENT ON COLUMN provenance_evidence.strength_assessment IS 'Editorial assessment: unambiguous (e.g., Afonso 1526 letters), strong, circumstantial, contested, cited (default — neutral citation without strength claim).';
