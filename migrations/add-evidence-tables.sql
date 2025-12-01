-- ==================== FLEXIBLE EVIDENCE MANAGEMENT ====================
-- Supports ANY type of evidence: headstones, photos, webpages, documents, DNA, etc.
-- System learns and adapts to new evidence types

CREATE TABLE IF NOT EXISTS evidence (
    evidence_id VARCHAR(255) PRIMARY KEY,

    -- Type (system learns these dynamically)
    evidence_type VARCHAR(100),  -- 'headstone', 'webpage', 'photo', 'document', 'dna', 'oral_history', etc.

    -- Core metadata
    title TEXT NOT NULL,
    description TEXT,

    -- Content (flexible - can have any combination)
    text_content TEXT,           -- Transcribed text, webpage content, etc.
    image_url TEXT,              -- URL to photo/scan
    source_url TEXT,             -- Original webpage, archive URL
    file_path TEXT,              -- Local storage path

    -- Subjects (who this evidence is about)
    subject_person_id VARCHAR(255), -- Primary subject
    subject_person_name TEXT,       -- Name if not yet in individuals table

    -- Provenance
    location TEXT,               -- Where found (cemetery, archive, website name)
    evidence_date DATE,          -- When evidence was created (headstone date, document date)
    collected_by VARCHAR(255),   -- Researcher who found this
    collected_date TIMESTAMP,    -- When collected

    -- What it proves
    proves JSONB,                -- Array of claims: ["ownership", "parentage", "death_date", "location"]
    confidence DECIMAL(3,2),     -- 0.00-1.00 confidence score

    -- Citations and notes
    citations JSONB,             -- Array of source citations
    notes TEXT,                  -- Research notes

    -- Completely flexible metadata
    custom_metadata JSONB,       -- Store ANYTHING else: cemetery plot, webpage author, DNA markers, etc.

    -- Audit
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_evidence_type ON evidence(evidence_type);
CREATE INDEX idx_evidence_subject ON evidence(subject_person_id);
CREATE INDEX idx_evidence_collected ON evidence(collected_date);
CREATE INDEX idx_evidence_proves ON evidence USING gin(proves);

-- Link evidence to multiple people (one piece of evidence can mention many people)
CREATE TABLE IF NOT EXISTS evidence_person_links (
    link_id SERIAL PRIMARY KEY,
    evidence_id VARCHAR(255) REFERENCES evidence(evidence_id) ON DELETE CASCADE,
    person_id VARCHAR(255) REFERENCES individuals(individual_id) ON DELETE CASCADE,

    relationship_type VARCHAR(100),  -- 'subject', 'owner', 'parent', 'child', 'mentioned', etc.
    role VARCHAR(100),               -- 'enslaved', 'enslaver', 'heir', 'witness', etc.
    notes TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(evidence_id, person_id, relationship_type)
);

CREATE INDEX idx_epl_evidence ON evidence_person_links(evidence_id);
CREATE INDEX idx_epl_person ON evidence_person_links(person_id);

-- Evidence chains (A proves B, B proves C)
CREATE TABLE IF NOT EXISTS evidence_chains (
    chain_id SERIAL PRIMARY KEY,
    source_evidence_id VARCHAR(255) REFERENCES evidence(evidence_id),
    derived_evidence_id VARCHAR(255) REFERENCES evidence(evidence_id),

    chain_type VARCHAR(100),     -- 'supports', 'contradicts', 'clarifies', 'extends'
    confidence_impact DECIMAL(3,2), -- How much this affects confidence
    notes TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(source_evidence_id, derived_evidence_id)
);

-- Debt/Credit tracking across generations
CREATE TABLE IF NOT EXISTS debt_lineage (
    lineage_id SERIAL PRIMARY KEY,

    -- Debtor (slave owner or heir)
    debtor_id VARCHAR(255) REFERENCES individuals(individual_id),
    debtor_generation INTEGER,   -- 0=owner, 1=child, 2=grandchild, etc.

    -- Creditor (enslaved person or descendant)
    creditor_id VARCHAR(255) REFERENCES individuals(individual_id),
    creditor_generation INTEGER,

    -- Debt details
    debt_amount NUMERIC(20,2),
    debt_basis VARCHAR(255),     -- 'direct_ownership', 'inherited', 'benefited_from'
    evidence_id VARCHAR(255) REFERENCES evidence(evidence_id),

    -- Status
    status VARCHAR(50) DEFAULT 'unpaid',  -- 'unpaid', 'acknowledged', 'paid', 'disputed'
    paid_amount NUMERIC(20,2) DEFAULT 0,
    paid_date DATE,

    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_debt_debtor ON debt_lineage(debtor_id);
CREATE INDEX idx_debt_creditor ON debt_lineage(creditor_id);
CREATE INDEX idx_debt_status ON debt_lineage(status);

-- View: Evidence summary by type
CREATE OR REPLACE VIEW evidence_summary AS
SELECT
    evidence_type,
    COUNT(*) as count,
    AVG(confidence) as avg_confidence,
    MIN(collected_date) as first_collected,
    MAX(collected_date) as last_collected
FROM evidence
GROUP BY evidence_type
ORDER BY count DESC;

-- View: Person evidence portfolio
CREATE OR REPLACE VIEW person_evidence AS
SELECT
    i.individual_id,
    i.full_name,
    COUNT(DISTINCT e.evidence_id) as evidence_count,
    ARRAY_AGG(DISTINCT e.evidence_type) as evidence_types,
    MAX(e.collected_date) as latest_evidence
FROM individuals i
LEFT JOIN evidence e ON e.subject_person_id = i.individual_id
LEFT JOIN evidence_person_links epl ON epl.person_id = i.individual_id
GROUP BY i.individual_id, i.full_name;

-- View: Debt totals by person
CREATE OR REPLACE VIEW debt_totals AS
SELECT
    debtor_id,
    i.full_name as debtor_name,
    debtor_generation,
    SUM(debt_amount) as total_debt,
    SUM(paid_amount) as total_paid,
    SUM(debt_amount - paid_amount) as balance_owed,
    COUNT(*) as debt_count
FROM debt_lineage dl
JOIN individuals i ON i.individual_id = dl.debtor_id
GROUP BY debtor_id, i.full_name, debtor_generation
ORDER BY total_debt DESC;

COMMENT ON TABLE evidence IS 'Flexible evidence storage - adapts to any evidence type';
COMMENT ON TABLE evidence_person_links IS 'Links evidence to multiple people';
COMMENT ON TABLE evidence_chains IS 'Tracks how evidence builds on other evidence';
COMMENT ON TABLE debt_lineage IS 'Tracks reparations debt across generations';
