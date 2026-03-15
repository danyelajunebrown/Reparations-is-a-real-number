-- Migration 030: Multi-Source Genealogy Evidence System
-- Unified person graph with cross-source verification

-- =============================================================================
-- UNIFIED PERSONS TABLE
-- Consolidates persons from all sources into single canonical records
-- =============================================================================

CREATE TABLE IF NOT EXISTS unified_persons (
  id SERIAL PRIMARY KEY,
  canonical_name VARCHAR(500) NOT NULL,
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  person_type VARCHAR(50), -- 'enslaver', 'enslaved', 'descendant', 'unknown'
  
  -- Date ranges (evidence may give ranges, not exact dates)
  birth_date_min DATE,
  birth_date_max DATE,
  birth_date_best_estimate DATE,
  birth_date_confidence NUMERIC(4,3) DEFAULT 0,
  
  death_date_min DATE,
  death_date_max DATE,
  death_date_best_estimate DATE,
  death_date_confidence NUMERIC(4,3) DEFAULT 0,
  
  -- Location
  birth_location VARCHAR(500),
  death_location VARCHAR(500),
  primary_state VARCHAR(100),
  primary_county VARCHAR(100),
  
  -- Evidence strength (0-100 score based on source quality & quantity)
  evidence_strength INTEGER DEFAULT 0,
  num_primary_sources INTEGER DEFAULT 0,
  num_secondary_sources INTEGER DEFAULT 0,
  num_tertiary_sources INTEGER DEFAULT 0,
  
  -- Cross-reference to legacy tables (nullable for migration)
  canonical_person_id INTEGER REFERENCES canonical_persons(id),
  enslaved_individual_id INTEGER,
  
  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_verified_at TIMESTAMP
);

CREATE INDEX idx_unified_persons_name ON unified_persons(canonical_name);
CREATE INDEX idx_unified_persons_type ON unified_persons(person_type);
CREATE INDEX idx_unified_persons_evidence ON unified_persons(evidence_strength DESC);
CREATE INDEX idx_unified_persons_dates ON unified_persons(birth_date_best_estimate, death_date_best_estimate);
CREATE INDEX idx_unified_persons_location ON unified_persons(primary_state, primary_county);

-- =============================================================================
-- PERSON EVIDENCE SOURCES
-- Tracks all sources (documents, records, databases) for each person
-- =============================================================================

CREATE TABLE IF NOT EXISTS person_evidence_sources (
  id SERIAL PRIMARY KEY,
  unified_person_id INTEGER REFERENCES unified_persons(id) ON DELETE CASCADE,
  
  -- Source identification
  source_type VARCHAR(100) NOT NULL, -- 'census', 'birth_cert', 'death_cert', 'marriage', 
                                      -- 'familysearch', 'wikitree', 'probate', 'tax', etc.
  source_tier INTEGER NOT NULL, -- 1=primary (created at time), 2=secondary (after), 3=tertiary (compiled)
  source_id VARCHAR(500), -- External ID (WikiTree ID, FamilySearch PID, document ID, etc.)
  source_url TEXT,
  
  -- What facts this source provides
  provides_birth_date BOOLEAN DEFAULT false,
  provides_death_date BOOLEAN DEFAULT false,
  provides_parent_relationship BOOLEAN DEFAULT false,
  provides_spouse_relationship BOOLEAN DEFAULT false,
  provides_location BOOLEAN DEFAULT false,
  provides_occupation BOOLEAN DEFAULT false,
  
  -- Extracted data (flexible JSON storage)
  extracted_data JSONB,
  
  -- Quality metrics
  confidence_score NUMERIC(4,3) DEFAULT 0.5,
  ocr_confidence NUMERIC(4,3), -- NULL if not OCR-derived
  
  -- Processing metadata
  extraction_method VARCHAR(100), -- 'api', 'ocr', 'manual', 'pre-indexed'
  extracted_by VARCHAR(100), -- 'familysearch_api', 'google_vision', 'volunteer', etc.
  
  added_at TIMESTAMP DEFAULT NOW(),
  verified_at TIMESTAMP,
  verified_by VARCHAR(255)
);

CREATE INDEX idx_evidence_sources_person ON person_evidence_sources(unified_person_id);
CREATE INDEX idx_evidence_sources_type ON person_evidence_sources(source_type);
CREATE INDEX idx_evidence_sources_tier ON person_evidence_sources(source_tier);
CREATE INDEX idx_evidence_sources_confidence ON person_evidence_sources(confidence_score DESC);

-- =============================================================================
-- PERSON RELATIONSHIPS WITH EVIDENCE
-- Family relationships backed by documentary evidence
-- =============================================================================

CREATE TABLE IF NOT EXISTS person_relationships_verified (
  id SERIAL PRIMARY KEY,
  person_id INTEGER REFERENCES unified_persons(id) ON DELETE CASCADE,
  related_person_id INTEGER REFERENCES unified_persons(id) ON DELETE CASCADE,
  relationship_type VARCHAR(50) NOT NULL, -- 'parent', 'child', 'spouse', 'sibling', 'enslaver', 'enslaved'
  
  -- Evidence supporting this relationship
  evidence_source_ids INTEGER[], -- Array of FK to person_evidence_sources
  evidence_strength INTEGER DEFAULT 0, -- 0-100 based on source quality
  
  -- Conflict tracking
  has_conflicts BOOLEAN DEFAULT false,
  conflict_notes TEXT,
  
  -- Verification
  verified_by VARCHAR(255),
  verified_at TIMESTAMP,
  
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_relationships_person ON person_relationships_verified(person_id);
CREATE INDEX idx_relationships_related ON person_relationships_verified(related_person_id);
CREATE INDEX idx_relationships_type ON person_relationships_verified(relationship_type);
CREATE INDEX idx_relationships_strength ON person_relationships_verified(evidence_strength DESC);

-- =============================================================================
-- EVIDENCE VERIFICATION LOG
-- Tracks cross-source verification results
-- =============================================================================

CREATE TABLE IF NOT EXISTS evidence_verification_log (
  id SERIAL PRIMARY KEY,
  unified_person_id INTEGER REFERENCES unified_persons(id) ON DELETE CASCADE,
  
  verification_type VARCHAR(100) NOT NULL, -- 'birth_date_match', 'name_variant', 'location_match', 
                                            -- 'relationship_confirmed', 'conflict_detected'
  sources_compared INTEGER[], -- Array of FK to person_evidence_sources
  
  agreement BOOLEAN, -- true=sources agree, false=conflict
  confidence_before NUMERIC(4,3),
  confidence_after NUMERIC(4,3),
  confidence_delta NUMERIC(5,2), -- Change in confidence
  
  details JSONB, -- Detailed comparison results
  notes TEXT,
  
  verified_at TIMESTAMP DEFAULT NOW(),
  verified_by VARCHAR(100) -- 'cross_verifier_agent', 'manual_review', etc.
);

CREATE INDEX idx_verification_log_person ON evidence_verification_log(unified_person_id);
CREATE INDEX idx_verification_log_type ON evidence_verification_log(verification_type);
CREATE INDEX idx_verification_log_date ON evidence_verification_log(verified_at DESC);

-- =============================================================================
-- AGENT PROCESSING QUEUE
-- Tracks which persons need verification/processing by which agents
-- =============================================================================

CREATE TABLE IF NOT EXISTS agent_processing_queue (
  id SERIAL PRIMARY KEY,
  unified_person_id INTEGER REFERENCES unified_persons(id) ON DELETE CASCADE,
  
  agent_type VARCHAR(100) NOT NULL, -- 'cross_verifier', 'familysearch_api', 'wikitree', 'nara', etc.
  priority INTEGER DEFAULT 5, -- 1=highest, 10=lowest
  status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'error'
  
  task_details JSONB, -- Agent-specific task data
  
  attempts INTEGER DEFAULT 0,
  last_attempt TIMESTAMP,
  next_attempt TIMESTAMP DEFAULT NOW(),
  error_message TEXT,
  
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE INDEX idx_agent_queue_status ON agent_processing_queue(status, next_attempt);
CREATE INDEX idx_agent_queue_agent ON agent_processing_queue(agent_type, status);
CREATE INDEX idx_agent_queue_person ON agent_processing_queue(unified_person_id);

-- =============================================================================
-- VIEWS FOR REPORTING
-- =============================================================================

-- Persons needing verification (multiple sources, not yet verified)
CREATE OR REPLACE VIEW persons_needing_verification AS
SELECT 
  up.id,
  up.canonical_name,
  up.person_type,
  up.evidence_strength,
  COUNT(DISTINCT pes.id) as source_count,
  COUNT(DISTINCT CASE WHEN pes.source_tier = 1 THEN pes.id END) as primary_source_count,
  COUNT(DISTINCT CASE WHEN pes.source_tier = 2 THEN pes.id END) as secondary_source_count,
  MAX(pes.added_at) as most_recent_source_added
FROM unified_persons up
LEFT JOIN person_evidence_sources pes ON pes.unified_person_id = up.id
WHERE up.last_verified_at IS NULL
  OR up.last_verified_at < (NOW() - INTERVAL '30 days')
GROUP BY up.id, up.canonical_name, up.person_type, up.evidence_strength
HAVING COUNT(DISTINCT pes.id) >= 2
ORDER BY COUNT(DISTINCT pes.id) DESC;

-- High-confidence persons (90+ evidence strength)
CREATE OR REPLACE VIEW high_confidence_persons AS
SELECT 
  up.*,
  COUNT(DISTINCT pes.id) as total_sources,
  array_agg(DISTINCT pes.source_type) as source_types
FROM unified_persons up
LEFT JOIN person_evidence_sources pes ON pes.unified_person_id = up.id
WHERE up.evidence_strength >= 90
GROUP BY up.id
ORDER BY up.evidence_strength DESC;

-- Evidence conflicts needing human review
CREATE OR REPLACE VIEW evidence_conflicts AS
SELECT 
  up.canonical_name,
  up.person_type,
  evl.verification_type,
  evl.details,
  evl.verified_at
FROM evidence_verification_log evl
JOIN unified_persons up ON up.id = evl.unified_person_id
WHERE evl.agreement = false
ORDER BY evl.verified_at DESC;

-- =============================================================================
-- FUNCTIONS
-- =============================================================================

-- Calculate evidence strength for a person
CREATE OR REPLACE FUNCTION calculate_evidence_strength(p_unified_person_id INTEGER)
RETURNS INTEGER AS $$
DECLARE
  v_score INTEGER := 0;
  v_primary_count INTEGER;
  v_secondary_count INTEGER;
  v_tertiary_count INTEGER;
  v_has_conflicts BOOLEAN;
BEGIN
  -- Count sources by tier
  SELECT 
    COUNT(*) FILTER (WHERE source_tier = 1),
    COUNT(*) FILTER (WHERE source_tier = 2),
    COUNT(*) FILTER (WHERE source_tier = 3)
  INTO v_primary_count, v_secondary_count, v_tertiary_count
  FROM person_evidence_sources
  WHERE unified_person_id = p_unified_person_id;
  
  -- Calculate base score
  v_score := (v_primary_count * 30) + (v_secondary_count * 15) + (v_tertiary_count * 5);
  
  -- Agreement bonus (if multiple sources agree)
  IF (v_primary_count + v_secondary_count) >= 2 THEN
    v_score := v_score + 20;
  END IF;
  
  -- Check for conflicts
  SELECT EXISTS(
    SELECT 1 FROM evidence_verification_log
    WHERE unified_person_id = p_unified_person_id
    AND agreement = false
  ) INTO v_has_conflicts;
  
  -- Conflict penalty
  IF v_has_conflicts THEN
    v_score := v_score - 10;
  END IF;
  
  -- Normalize to 0-100
  RETURN LEAST(100, GREATEST(0, v_score));
END;
$$ LANGUAGE plpgsql;

-- Update evidence strength for a person
CREATE OR REPLACE FUNCTION update_evidence_strength(p_unified_person_id INTEGER)
RETURNS VOID AS $$
DECLARE
  v_strength INTEGER;
  v_primary INTEGER;
  v_secondary INTEGER;
  v_tertiary INTEGER;
BEGIN
  v_strength := calculate_evidence_strength(p_unified_person_id);
  
  SELECT 
    COUNT(*) FILTER (WHERE source_tier = 1),
    COUNT(*) FILTER (WHERE source_tier = 2),
    COUNT(*) FILTER (WHERE source_tier = 3)
  INTO v_primary, v_secondary, v_tertiary
  FROM person_evidence_sources
  WHERE unified_person_id = p_unified_person_id;
  
  UPDATE unified_persons
  SET 
    evidence_strength = v_strength,
    num_primary_sources = v_primary,
    num_secondary_sources = v_secondary,
    num_tertiary_sources = v_tertiary,
    updated_at = NOW()
  WHERE id = p_unified_person_id;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update evidence strength when sources added
CREATE OR REPLACE FUNCTION trigger_update_evidence_strength()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM update_evidence_strength(NEW.unified_person_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_evidence_added
AFTER INSERT OR UPDATE ON person_evidence_sources
FOR EACH ROW
EXECUTE FUNCTION trigger_update_evidence_strength();

-- =============================================================================
-- INITIAL DATA MIGRATION (Comment out after first run)
-- =============================================================================

-- This will be run separately to migrate existing canonical_persons
-- COMMENT OUT after first successful run to avoid duplicates

/*
INSERT INTO unified_persons (
  canonical_name, 
  first_name, 
  last_name, 
  person_type,
  birth_date_best_estimate,
  death_date_best_estimate,
  primary_state,
  primary_county,
  canonical_person_id,
  evidence_strength
)
SELECT 
  canonical_name,
  first_name,
  last_name,
  person_type,
  birth_year_estimate::text::date,
  death_year_estimate::text::date,
  primary_state,
  primary_county,
  id,
  LEAST(100, CAST(confidence_score * 100 AS INTEGER))
FROM canonical_persons
WHERE canonical_name IS NOT NULL
ON CONFLICT DO NOTHING;
*/

COMMENT ON TABLE unified_persons IS 'Consolidated person records from all sources with evidence tracking';
COMMENT ON TABLE person_evidence_sources IS 'Documentary evidence supporting person records';
COMMENT ON TABLE person_relationships_verified IS 'Family relationships backed by evidence';
COMMENT ON TABLE evidence_verification_log IS 'Cross-source verification audit trail';
COMMENT ON TABLE agent_processing_queue IS 'Work queue for genealogy agents';
