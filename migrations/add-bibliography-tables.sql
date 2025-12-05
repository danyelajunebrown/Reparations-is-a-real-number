-- Bibliography Tables Migration
-- Tracks all intellectual sources, databases, archives, researchers, and contributors
-- Created: December 4, 2025

-- =============================================================================
-- BIBLIOGRAPHY TABLE
-- Main table for all cited sources
-- =============================================================================

CREATE TABLE IF NOT EXISTS bibliography (
    citation_id VARCHAR(255) PRIMARY KEY,

    -- Source identification
    title VARCHAR(500) NOT NULL,
    source_type VARCHAR(50) DEFAULT 'secondary', -- primary, secondary, tertiary, technology, intellectual
    category VARCHAR(100) DEFAULT 'general', -- archives, databases, researchers, technologies, participants

    -- Author/Creator information
    author VARCHAR(500),
    institution VARCHAR(255),

    -- Source location
    source_url TEXT,
    archive_name VARCHAR(255),
    collection_name VARCHAR(255),
    collection_id VARCHAR(255),
    location VARCHAR(255), -- Physical location (city, state)

    -- Dates
    publication_date DATE,
    access_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Content
    description TEXT,
    notes TEXT,

    -- Generated citation formats
    formatted_apa TEXT,
    formatted_chicago TEXT,
    formatted_mla TEXT,
    formatted_bibtex TEXT,

    -- Metadata
    confidence DECIMAL(3,2) DEFAULT 0.50,
    used_in JSONB DEFAULT '[]'::jsonb, -- Array of document_ids or locations where this source is used

    -- Tracking
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255) DEFAULT 'system'
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_bibliography_source_type ON bibliography(source_type);
CREATE INDEX IF NOT EXISTS idx_bibliography_category ON bibliography(category);
CREATE INDEX IF NOT EXISTS idx_bibliography_source_url ON bibliography(source_url);
CREATE INDEX IF NOT EXISTS idx_bibliography_archive_name ON bibliography(archive_name);
CREATE INDEX IF NOT EXISTS idx_bibliography_created_at ON bibliography(created_at);

-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_bibliography_search ON bibliography USING gin(
    to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(description, '') || ' ' || COALESCE(author, ''))
);

-- =============================================================================
-- PENDING CITATIONS TABLE
-- Sources that have been used/referenced but not yet fully cited
-- =============================================================================

CREATE TABLE IF NOT EXISTS pending_citations (
    pending_id VARCHAR(255) PRIMARY KEY,

    -- Source information (partial)
    title VARCHAR(500),
    citation_type VARCHAR(50) DEFAULT 'unknown', -- copy-paste, quote, document, data, methodology
    source_url TEXT,

    -- Context
    context TEXT, -- Where/how this was used
    used_in JSONB DEFAULT '[]'::jsonb, -- Files, functions, or locations where this appears
    detected_patterns JSONB DEFAULT '[]'::jsonb, -- Patterns that triggered the flag

    -- Status
    status VARCHAR(20) DEFAULT 'pending', -- pending, in_progress, resolved
    resolved_citation_id VARCHAR(255) REFERENCES bibliography(citation_id) ON DELETE SET NULL,

    -- Tracking
    flagged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    flagged_by VARCHAR(255) DEFAULT 'system',
    resolved_at TIMESTAMP,
    resolved_by VARCHAR(255)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pending_citations_status ON pending_citations(status);
CREATE INDEX IF NOT EXISTS idx_pending_citations_flagged_at ON pending_citations(flagged_at);
CREATE INDEX IF NOT EXISTS idx_pending_citations_type ON pending_citations(citation_type);

-- =============================================================================
-- PARTICIPANTS TABLE
-- Contributors, researchers, and other intellectual participants
-- =============================================================================

CREATE TABLE IF NOT EXISTS participants (
    participant_id VARCHAR(255) PRIMARY KEY,

    -- Identity
    name VARCHAR(255) NOT NULL,
    role VARCHAR(100) DEFAULT 'contributor', -- contributor, researcher, transcriber, reviewer, developer, advisor
    affiliation VARCHAR(255),

    -- Contribution details
    contribution TEXT, -- Description of their contribution
    start_date DATE,

    -- Record of contributions
    contributions JSONB DEFAULT '[]'::jsonb, -- Array of contribution records

    -- Tracking
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_participants_name ON participants(name);
CREATE INDEX IF NOT EXISTS idx_participants_role ON participants(role);

-- =============================================================================
-- COPY_PASTE_FLAGS TABLE
-- Detected copy/paste content that may need citation
-- =============================================================================

CREATE TABLE IF NOT EXISTS copy_paste_flags (
    flag_id VARCHAR(255) PRIMARY KEY,

    -- Detection info
    detected_text TEXT NOT NULL, -- The text that was detected
    pattern_matched VARCHAR(255), -- Which pattern triggered
    source_file VARCHAR(500), -- Where it was detected
    line_number INTEGER,

    -- Analysis
    suggested_source VARCHAR(255), -- If we can identify the source
    known_archive VARCHAR(255), -- If it matches a known archive

    -- Status
    status VARCHAR(20) DEFAULT 'pending', -- pending, reviewed, resolved, ignored
    resolved_citation_id VARCHAR(255) REFERENCES bibliography(citation_id) ON DELETE SET NULL,

    -- Tracking
    detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP,
    reviewed_by VARCHAR(255)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_copy_paste_flags_status ON copy_paste_flags(status);
CREATE INDEX IF NOT EXISTS idx_copy_paste_flags_detected_at ON copy_paste_flags(detected_at);

-- =============================================================================
-- CITATION_RELATIONSHIPS TABLE
-- Track how sources relate to each other (corroborates, contradicts, extends)
-- =============================================================================

CREATE TABLE IF NOT EXISTS citation_relationships (
    id SERIAL PRIMARY KEY,

    -- The two citations being related
    citing_citation_id VARCHAR(255) REFERENCES bibliography(citation_id) ON DELETE CASCADE,
    cited_citation_id VARCHAR(255) REFERENCES bibliography(citation_id) ON DELETE CASCADE,

    -- Relationship type
    relationship_type VARCHAR(50) NOT NULL, -- corroborates, contradicts, references, extends, derived_from

    -- Confidence and notes
    confidence_score DECIMAL(3,2),
    notes TEXT,

    -- Tracking
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_citation_rel_citing ON citation_relationships(citing_citation_id);
CREATE INDEX IF NOT EXISTS idx_citation_rel_cited ON citation_relationships(cited_citation_id);

-- =============================================================================
-- BIBLIOGRAPHY_EXPORTS TABLE
-- Track bibliography export history
-- =============================================================================

CREATE TABLE IF NOT EXISTS bibliography_exports (
    export_id VARCHAR(255) PRIMARY KEY,

    -- Export details
    export_format VARCHAR(50) NOT NULL, -- json, bibtex, apa, chicago, mla, csv, pdf
    citation_ids TEXT[], -- Array of citation IDs included
    filter_criteria JSONB, -- Any filters applied

    -- Content
    entry_count INTEGER,
    file_size INTEGER,

    -- Tracking
    exported_by VARCHAR(255),
    exported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- INITIAL DATA: Pre-populate with known sources from the project
-- =============================================================================

-- Government Archives
INSERT INTO bibliography (citation_id, title, source_type, category, source_url, archive_name, location, description, formatted_apa)
VALUES
('bib_maryland_state_archives', 'Maryland State Archives', 'primary', 'archives', 'https://msa.maryland.gov/', 'Maryland State Archives', 'Annapolis, MD', 'Official state repository for Maryland historical records including slave statistics, census records, probate records, and county court documents.', 'Maryland State Archives. "Slavery Resources." MSA, Annapolis, MD. https://msa.maryland.gov/')
ON CONFLICT (citation_id) DO NOTHING;

INSERT INTO bibliography (citation_id, title, source_type, category, source_url, archive_name, location, description, formatted_apa)
VALUES
('bib_civil_war_dc', 'Civil War Washington - DC Compensated Emancipation Petitions', 'primary', 'archives', 'http://civilwardc.org/', 'Civil War Washington', 'Washington, DC', 'Digital archive of the DC Compensated Emancipation Act (1862) petitions containing original petitions from slaveholders seeking compensation.', 'Civil War Washington. "DC Compensated Emancipation Petitions." George Washington University, Washington, DC. http://civilwardc.org/')
ON CONFLICT (citation_id) DO NOTHING;

INSERT INTO bibliography (citation_id, title, source_type, category, source_url, archive_name, location, description, formatted_apa)
VALUES
('bib_nara', 'National Archives and Records Administration', 'primary', 'archives', 'https://www.archives.gov/', 'NARA', 'Washington, DC', 'Federal repository for historical records including census records, slave schedules, military records, and freedmen bureau records.', 'National Archives and Records Administration. Washington, DC. https://www.archives.gov/')
ON CONFLICT (citation_id) DO NOTHING;

INSERT INTO bibliography (citation_id, title, source_type, category, source_url, archive_name, location, description, formatted_apa)
VALUES
('bib_library_of_virginia', 'Library of Virginia', 'primary', 'archives', 'https://www.lva.virginia.gov/', 'Library of Virginia', 'Richmond, VA', 'Virginia official state library and archives, containing probate records, wills, estate inventories, and county court records.', 'Library of Virginia. Richmond, VA. https://www.lva.virginia.gov/')
ON CONFLICT (citation_id) DO NOTHING;

-- Genealogy Databases
INSERT INTO bibliography (citation_id, title, source_type, category, source_url, archive_name, location, description, formatted_apa)
VALUES
('bib_familysearch', 'FamilySearch', 'secondary', 'databases', 'https://www.familysearch.org/', 'FamilySearch', 'Salt Lake City, UT', 'Free genealogical database operated by The Church of Jesus Christ of Latter-day Saints. Provides digitized historical records, census data, and family tree tools.', 'FamilySearch. The Church of Jesus Christ of Latter-day Saints. Salt Lake City, UT. https://www.familysearch.org/')
ON CONFLICT (citation_id) DO NOTHING;

INSERT INTO bibliography (citation_id, title, source_type, category, source_url, archive_name, location, description, formatted_apa)
VALUES
('bib_ancestry', 'Ancestry.com', 'secondary', 'databases', 'https://www.ancestry.com/', 'Ancestry.com', 'Lehi, UT', 'Commercial genealogy database with extensive digitized records including census records, slave schedules, wills, and probate records.', 'Ancestry.com. Lehi, UT. https://www.ancestry.com/')
ON CONFLICT (citation_id) DO NOTHING;

INSERT INTO bibliography (citation_id, title, source_type, category, source_url, archive_name, location, description, formatted_apa)
VALUES
('bib_find_a_grave', 'Find A Grave', 'secondary', 'databases', 'https://www.findagrave.com/', 'Find A Grave', NULL, 'Crowdsourced database of cemetery records and grave markers. Used for evidence collection including headstone photos and burial locations.', 'Find A Grave. Ancestry.com Operations, Inc. https://www.findagrave.com/')
ON CONFLICT (citation_id) DO NOTHING;

-- Research Compilations
INSERT INTO bibliography (citation_id, title, source_type, category, source_url, author, description, formatted_apa)
VALUES
('bib_tom_blake_1860', 'Large Slaveholders of 1860', 'secondary', 'databases', 'http://freepages.rootsweb.com/~ajac/', 'Tom Blake', 'Comprehensive compilation of 1860 slave schedule census data identifying large slaveholders (10+ enslaved persons). Provides structured tabular data of slaveholder names, enslaved counts, and locations.', 'Blake, Tom. "Large Slaveholders of 1860 and African American Surname Matches from 1870." RootsWeb. http://freepages.rootsweb.com/~ajac/')
ON CONFLICT (citation_id) DO NOTHING;

INSERT INTO bibliography (citation_id, title, source_type, category, source_url, archive_name, description, formatted_apa, confidence)
VALUES
('bib_beyond_kin', 'Beyond Kin Enslaved Populations Directory', 'secondary', 'databases', 'https://www.beyondkin.org/', 'Beyond Kin', 'Database connecting enslaved individuals with slaveholders. Contains suspected owner relationships requiring verification with primary sources.', 'Beyond Kin. "Enslaved Populations Directory." https://www.beyondkin.org/', 0.70)
ON CONFLICT (citation_id) DO NOTHING;

-- Technologies
INSERT INTO bibliography (citation_id, title, source_type, category, source_url, description, formatted_apa)
VALUES
('bib_google_vision', 'Google Cloud Vision API', 'technology', 'technologies', 'https://cloud.google.com/vision', 'Primary OCR service providing 90-95% accuracy for historical document text extraction.', 'Google Cloud. "Cloud Vision API." Google LLC. https://cloud.google.com/vision')
ON CONFLICT (citation_id) DO NOTHING;

INSERT INTO bibliography (citation_id, title, source_type, category, source_url, description, formatted_apa)
VALUES
('bib_tesseract', 'Tesseract.js', 'technology', 'technologies', 'https://github.com/naptha/tesseract.js', 'Open-source OCR engine providing 60-80% accuracy. Used as fallback when Google Vision API is unavailable.', 'Tesseract.js Contributors. "Tesseract.js." Apache License 2.0. https://github.com/naptha/tesseract.js')
ON CONFLICT (citation_id) DO NOTHING;

INSERT INTO bibliography (citation_id, title, source_type, category, source_url, description, formatted_apa)
VALUES
('bib_openzeppelin', 'OpenZeppelin Contracts', 'technology', 'technologies', 'https://github.com/OpenZeppelin/openzeppelin-contracts', 'Library of secure, audited smart contract components for Ethereum. Used for escrow patterns and payment distribution.', 'OpenZeppelin. "OpenZeppelin Contracts." MIT License. https://github.com/OpenZeppelin/openzeppelin-contracts')
ON CONFLICT (citation_id) DO NOTHING;

-- Project Leadership
INSERT INTO participants (participant_id, name, role, contribution)
VALUES
('participant_danyela_brown', 'Danyela Brown', 'project_lead', 'Project creator and lead developer. Conceived the blockchain-based reparations platform and directs the integration of genealogical research, document processing, and economic calculation systems.')
ON CONFLICT (participant_id) DO NOTHING;

-- Researcher
INSERT INTO participants (participant_id, name, role, contribution)
VALUES
('participant_tom_blake', 'Tom Blake', 'researcher', 'Genealogist who compiled the "Large Slaveholders of 1860" database, providing comprehensive census data linking slaveholders to enslaved population counts across multiple states.')
ON CONFLICT (participant_id) DO NOTHING;

-- =============================================================================
-- TRIGGER: Auto-update updated_at timestamp
-- =============================================================================

CREATE OR REPLACE FUNCTION update_bibliography_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bibliography_updated_at ON bibliography;
CREATE TRIGGER bibliography_updated_at
    BEFORE UPDATE ON bibliography
    FOR EACH ROW
    EXECUTE FUNCTION update_bibliography_timestamp();

DROP TRIGGER IF EXISTS participants_updated_at ON participants;
CREATE TRIGGER participants_updated_at
    BEFORE UPDATE ON participants
    FOR EACH ROW
    EXECUTE FUNCTION update_bibliography_timestamp();

-- =============================================================================
-- GRANT PERMISSIONS (adjust as needed for your database user)
-- =============================================================================

-- If using a specific database user:
-- GRANT ALL PRIVILEGES ON bibliography TO reparations_user;
-- GRANT ALL PRIVILEGES ON pending_citations TO reparations_user;
-- GRANT ALL PRIVILEGES ON participants TO reparations_user;
-- GRANT ALL PRIVILEGES ON copy_paste_flags TO reparations_user;
-- GRANT ALL PRIVILEGES ON citation_relationships TO reparations_user;
-- GRANT ALL PRIVILEGES ON bibliography_exports TO reparations_user;
-- GRANT USAGE, SELECT ON SEQUENCE citation_relationships_id_seq TO reparations_user;
