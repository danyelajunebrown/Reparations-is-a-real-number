-- Migration 090: Secondary Source Compilations Registry
-- Tracks book-based and compiled documentary sources (e.g., plantation records, genealogical compilations)
-- Complements M068 (compilation tracking on regional_source_registry) with book-specific metadata
-- Date: 2026-06-08

CREATE TABLE IF NOT EXISTS secondary_source_compilations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Book identity
    source_title TEXT NOT NULL,
    source_subtitle TEXT,
    source_editors TEXT[] NOT NULL,  -- ARRAY of editor names
    source_publisher TEXT,
    publication_year INTEGER,
    
    -- Identifiers
    isbn VARCHAR(20),
    library_of_congress_id VARCHAR(50),
    worldcat_oclc_number VARCHAR(20),
    
    -- Physical description
    physical_pages INTEGER,
    physical_edition_year INTEGER,  -- if reprint, original year
    is_reprint BOOLEAN DEFAULT FALSE,
    original_publication_year INTEGER,
    
    -- Content scope
    geographic_scope TEXT[],  -- e.g., ['Florida', 'Georgia']
    date_range_start INTEGER,  -- earliest document in compilation
    date_range_end INTEGER,    -- latest document in compilation
    record_types TEXT[],       -- e.g., ['plantation_records', 'wills', 'correspondence']
    
    -- Reparations framework integration
    max_evidence_tier TEXT CHECK(max_evidence_tier IN ('direct_primary','indirect_primary','secondary','inferred')),
    is_compilation BOOLEAN DEFAULT TRUE,
    compiles_from_description TEXT,  -- "Compiled from original papers at..."
    original_location_text TEXT,     -- "Papers held at University of Florida Special Collections"
    
    -- Relationship to provenance
    provenance_evidence_id UUID REFERENCES provenance_evidence(id) ON DELETE SET NULL,
    
    -- Ingestion tracking
    ingested_by TEXT,
    ingested_at TIMESTAMPTZ DEFAULT NOW(),
    etl_script_version TEXT,
    
    -- Quality & review
    review_status TEXT CHECK(review_status IN ('pending_review', 'approved', 'flagged', 'archived')),
    review_notes TEXT,
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    
    -- Temporal tracking
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_secondary_source_compilations_title ON secondary_source_compilations(source_title);
CREATE INDEX idx_secondary_source_compilations_year ON secondary_source_compilations(publication_year);
CREATE INDEX idx_secondary_source_compilations_geographic ON secondary_source_compilations USING GIN(geographic_scope);
CREATE INDEX idx_secondary_source_compilations_date_range ON secondary_source_compilations(date_range_start, date_range_end);
CREATE INDEX idx_secondary_source_compilations_ingested_by ON secondary_source_compilations(ingested_by);

-- Foreign key: person_documents can reference this compilation
ALTER TABLE person_documents ADD COLUMN IF NOT EXISTS secondary_source_compilation_id UUID REFERENCES secondary_source_compilations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_person_documents_secondary_source_compilation_id ON person_documents(secondary_source_compilation_id);

-- Foreign key: unconfirmed_persons can reference source of extraction
ALTER TABLE unconfirmed_persons ADD COLUMN IF NOT EXISTS secondary_source_compilation_id UUID REFERENCES secondary_source_compilations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_unconfirmed_persons_secondary_source_compilation_id ON unconfirmed_persons(secondary_source_compilation_id);

-- Relationship edge metadata: track which compilation contained the relationship evidence
ALTER TABLE family_relationships ADD COLUMN IF NOT EXISTS source_compilation_id UUID REFERENCES secondary_source_compilations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_family_relationships_source_compilation_id ON family_relationships(source_compilation_id);

-- Inheritance edge metadata: track which compilation contained the bequest/inheritance
ALTER TABLE inheritance_edges ADD COLUMN IF NOT EXISTS source_compilation_id UUID REFERENCES secondary_source_compilations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_inheritance_edges_source_compilation_id ON inheritance_edges(source_compilation_id);

-- Insert George Noble Jones: Florida Plantation Records
INSERT INTO secondary_source_compilations (
    source_title,
    source_editors,
    source_publisher,
    publication_year,
    isbn,
    physical_pages,
    physical_edition_year,
    is_reprint,
    original_publication_year,
    geographic_scope,
    date_range_start,
    date_range_end,
    record_types,
    max_evidence_tier,
    is_compilation,
    compiles_from_description,
    original_location_text,
    ingested_by,
    review_status,
    etl_script_version
) VALUES (
    'Florida Plantation Records from the Papers of George Noble Jones',
    ARRAY['Ulrich Bonnell Phillips', 'James David Glunt'],
    'B. Franklin',
    1971,
    NULL,
    596,
    1927,
    TRUE,
    1927,
    ARRAY['Florida', 'Leon County', 'Jefferson County'],
    1811,
    1876,
    ARRAY['plantation_records', 'correspondence', 'financial_records'],
    'secondary',
    TRUE,
    'Compiled from original papers of George Noble Jones (1811-1876)',
    'Papers held at University of Florida Special Collections; original edition published 1927',
    'ingest-plantation-records.js',
    'pending_review',
    '1.0.0'
) ON CONFLICT DO NOTHING;

-- Insert Isaac Franklin: Slave Trader and Planter
INSERT INTO secondary_source_compilations (
    source_title,
    source_editors,
    source_publisher,
    publication_year,
    isbn,
    physical_pages,
    physical_edition_year,
    is_reprint,
    original_publication_year,
    geographic_scope,
    date_range_start,
    date_range_end,
    record_types,
    max_evidence_tier,
    is_compilation,
    compiles_from_description,
    original_location_text,
    ingested_by,
    review_status,
    etl_script_version
) VALUES (
    'Isaac Franklin, Slave Trader and Planter of the Old South, with Plantation Records',
    ARRAY['Wendell Holmes Stephenson'],
    'P. Smith',
    1968,
    NULL,
    368,
    1938,
    TRUE,
    1938,
    ARRAY['Alabama', 'Tennessee', 'Louisiana', 'Mississippi'],
    1789,
    1846,
    ARRAY['slave_trade_records', 'plantation_records', 'financial_records', 'correspondence'],
    'secondary',
    TRUE,
    'Biographical study of Isaac Franklin (1789-1846) with compiled plantation and trade records',
    'Archival sources cited; includes facsimiles and maps',
    'ingest-plantation-records.js',
    'pending_review',
    '1.0.0'
) ON CONFLICT DO NOTHING;