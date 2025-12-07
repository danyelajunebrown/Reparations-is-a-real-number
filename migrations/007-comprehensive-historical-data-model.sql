-- Migration 007: Comprehensive Historical Data Model Enhancement
-- Date: December 6, 2025
-- Purpose: Add support for household structures, hierarchical geography, occupations,
--          legal/racial status, property systems, enhanced name handling, and data provenance
--
-- Based on analysis of 1733 Talbot County Tax Assessment and similar historical documents

-- ============================================================================
-- ENHANCEMENT 1: HOUSEHOLD SYSTEM
-- Enables grouping individuals into households as recorded in tax lists, censuses
-- ============================================================================

-- Geographic subdivisions (needed for households)
-- Creating this first as households reference it
CREATE TABLE IF NOT EXISTS geographic_subdivisions (
    subdivision_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    subdivision_type VARCHAR(50) NOT NULL,  -- 'country', 'state', 'county', 'hundred', 'parish', 'district', 'township', 'ward'
    parent_id INTEGER REFERENCES geographic_subdivisions(subdivision_id),
    state VARCHAR(100),
    country VARCHAR(100) DEFAULT 'USA',
    -- When this subdivision existed (NULL means still exists or unknown)
    established_year INTEGER,
    dissolved_year INTEGER,
    -- Modern equivalent if subdivision no longer exists
    modern_equivalent VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for hierarchical queries
CREATE INDEX IF NOT EXISTS idx_geo_parent ON geographic_subdivisions(parent_id);
CREATE INDEX IF NOT EXISTS idx_geo_type ON geographic_subdivisions(subdivision_type);
CREATE INDEX IF NOT EXISTS idx_geo_name ON geographic_subdivisions(name);

-- Households table - groups of people living/taxed together
CREATE TABLE IF NOT EXISTS households (
    household_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Head of household (nullable initially, set after members added)
    head_of_household_id VARCHAR(255) REFERENCES individuals(individual_id) ON DELETE SET NULL,
    -- Document ordering
    household_seq INTEGER,              -- Position in original document
    document_seq_identifier VARCHAR(50), -- e.g., "3-042" for hundred 3, household 42
    -- Geographic location
    subdivision_id INTEGER REFERENCES geographic_subdivisions(subdivision_id),
    location_description TEXT,          -- Free text for additional location info
    -- Household composition counts (as recorded)
    total_taxables INTEGER,
    free_white_males INTEGER,
    free_white_females INTEGER,
    free_black_males INTEGER,
    free_black_females INTEGER,
    free_mulatto_males INTEGER,
    free_mulatto_females INTEGER,
    enslaved_males INTEGER,
    enslaved_females INTEGER,
    -- Source information
    source_document_id VARCHAR(255) REFERENCES documents(document_id) ON DELETE SET NULL,
    source_year INTEGER NOT NULL,
    source_type VARCHAR(100),           -- 'tax_list', 'census', 'poll_list', 'militia_roster'
    -- Metadata
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_households_head ON households(head_of_household_id);
CREATE INDEX IF NOT EXISTS idx_households_subdivision ON households(subdivision_id);
CREATE INDEX IF NOT EXISTS idx_households_source_year ON households(source_year);
CREATE INDEX IF NOT EXISTS idx_households_source_doc ON households(source_document_id);

-- Household members junction table
CREATE TABLE IF NOT EXISTS household_members (
    id SERIAL PRIMARY KEY,
    household_id UUID NOT NULL REFERENCES households(household_id) ON DELETE CASCADE,
    -- Can reference either free individuals or enslaved individuals
    individual_id VARCHAR(255) REFERENCES individuals(individual_id) ON DELETE CASCADE,
    enslaved_id VARCHAR(255) REFERENCES enslaved_individuals(enslaved_id) ON DELETE CASCADE,
    -- Status within household
    member_status VARCHAR(50) NOT NULL,  -- 'head', 'spouse', 'dependent', 'kin', 'servant', 'apprentice', 'orphan', 'boarder', 'enslaved'
    relationship_to_head VARCHAR(100),   -- 'self', 'wife', 'son', 'daughter', 'nephew', 'stepson', 'mother-in-law', etc.
    -- Tax status
    is_taxable BOOLEAN DEFAULT true,
    tax_reason VARCHAR(100),             -- Why taxable/not taxable (e.g., 'free_mulatto', 'under_16', 'over_60')
    -- Ordering within household in source document
    member_seq INTEGER,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    -- Ensure either individual_id or enslaved_id is set, not both
    CONSTRAINT check_member_type CHECK (
        (individual_id IS NOT NULL AND enslaved_id IS NULL) OR
        (individual_id IS NULL AND enslaved_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_hh_members_household ON household_members(household_id);
CREATE INDEX IF NOT EXISTS idx_hh_members_individual ON household_members(individual_id);
CREATE INDEX IF NOT EXISTS idx_hh_members_enslaved ON household_members(enslaved_id);
CREATE INDEX IF NOT EXISTS idx_hh_members_status ON household_members(member_status);

-- ============================================================================
-- ENHANCEMENT 2: HIERARCHICAL GEOGRAPHY (table created above)
-- Pre-populate with Maryland hundreds from the 1733 document
-- ============================================================================

-- Insert Maryland and Talbot County structure
INSERT INTO geographic_subdivisions (name, subdivision_type, parent_id, state, country, established_year, notes)
VALUES
    ('Maryland', 'state', NULL, 'Maryland', 'USA', 1632, 'Colony founded 1632, state 1776'),
    ('Talbot County', 'county', 1, 'Maryland', 'USA', 1661, 'Established 1661 from portion of Kent County')
ON CONFLICT DO NOTHING;

-- Insert Talbot County hundreds (these existed in 1733)
-- Parent ID 2 assumes Talbot County got ID 2
INSERT INTO geographic_subdivisions (name, subdivision_type, parent_id, state, country, notes)
SELECT name, 'hundred',
       (SELECT subdivision_id FROM geographic_subdivisions WHERE name = 'Talbot County' LIMIT 1),
       'Maryland', 'USA', notes
FROM (VALUES
    ('Island Hundred', 'Eastern shore of county, includes Oxford'),
    ('Third Haven Hundred', 'Named after Third Haven Meeting (Quaker)'),
    ('Bay Hundred', 'Along Chesapeake Bay'),
    ('Bullenbrook Hundred', 'Also spelled Bullenbrooke'),
    ('Mill Hundred', 'Named for mills in the area'),
    ('Tuckahoe Hundred', 'Named after Tuckahoe Creek')
) AS hundreds(name, notes)
WHERE EXISTS (SELECT 1 FROM geographic_subdivisions WHERE name = 'Talbot County')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- ENHANCEMENT 3: OCCUPATION AND HONORIFIC FIELDS
-- ============================================================================

ALTER TABLE individuals
ADD COLUMN IF NOT EXISTS occupation VARCHAR(255),
ADD COLUMN IF NOT EXISTS occupation_category VARCHAR(100),  -- 'planter', 'craftsman', 'merchant', 'professional', 'laborer', 'maritime'
ADD COLUMN IF NOT EXISTS honorific VARCHAR(50),             -- 'Gent', 'Esq', 'Dr', 'Capt', 'Col', 'Rev'
ADD COLUMN IF NOT EXISTS title VARCHAR(100);                -- 'Justice of the Peace', 'Sheriff', 'Constable'

-- Add occupation to enslaved individuals too (they had skills/roles)
ALTER TABLE enslaved_individuals
ADD COLUMN IF NOT EXISTS occupation VARCHAR(255),           -- 'field_hand', 'domestic', 'blacksmith', 'carpenter', 'cook'
ADD COLUMN IF NOT EXISTS skill_level VARCHAR(50);           -- 'skilled', 'semi_skilled', 'unskilled', 'child'

-- Create index for occupation queries
CREATE INDEX IF NOT EXISTS idx_individuals_occupation ON individuals(occupation);
CREATE INDEX IF NOT EXISTS idx_individuals_occupation_cat ON individuals(occupation_category);
CREATE INDEX IF NOT EXISTS idx_enslaved_occupation ON enslaved_individuals(occupation);

-- ============================================================================
-- ENHANCEMENT 4: LEGAL AND RACIAL STATUS FIELDS
-- ============================================================================

-- For free individuals
ALTER TABLE individuals
ADD COLUMN IF NOT EXISTS racial_designation VARCHAR(100),   -- As recorded in historical documents (may use period terminology)
ADD COLUMN IF NOT EXISTS racial_designation_modern VARCHAR(100), -- Modern equivalent terminology
ADD COLUMN IF NOT EXISTS legal_status VARCHAR(50) DEFAULT 'free',  -- 'free', 'indentured', 'apprenticed', 'convict_servant', 'redemptioner'
ADD COLUMN IF NOT EXISTS legal_status_start_year INTEGER,
ADD COLUMN IF NOT EXISTS legal_status_end_year INTEGER,
ADD COLUMN IF NOT EXISTS is_taxable BOOLEAN,
ADD COLUMN IF NOT EXISTS taxable_reason TEXT;               -- Explanation of tax status

-- For enslaved individuals - add more status nuance
ALTER TABLE enslaved_individuals
ADD COLUMN IF NOT EXISTS racial_designation VARCHAR(100),   -- As recorded: 'negro', 'mulatto', 'mustee', etc.
ADD COLUMN IF NOT EXISTS enslaved_status VARCHAR(50) DEFAULT 'enslaved', -- 'enslaved', 'term_slave', 'hired_out'
ADD COLUMN IF NOT EXISTS term_years INTEGER,                -- For term slavery
ADD COLUMN IF NOT EXISTS is_taxable BOOLEAN DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_individuals_racial ON individuals(racial_designation);
CREATE INDEX IF NOT EXISTS idx_individuals_legal_status ON individuals(legal_status);
CREATE INDEX IF NOT EXISTS idx_enslaved_racial ON enslaved_individuals(racial_designation);

-- ============================================================================
-- ENHANCEMENT 5: PROPERTY AND QUARTER SYSTEM
-- ============================================================================

-- Properties table - land holdings, plantations, quarters
CREATE TABLE IF NOT EXISTS properties (
    property_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Property identification
    property_name VARCHAR(255),          -- Tract name as recorded
    alternate_names TEXT[],              -- Other names used for same property
    property_type VARCHAR(50) NOT NULL,  -- 'plantation', 'quarter', 'farm', 'lot', 'tract', 'tenement'
    -- Ownership
    owner_id VARCHAR(255) REFERENCES individuals(individual_id) ON DELETE SET NULL,
    ownership_type VARCHAR(50),          -- 'fee_simple', 'life_estate', 'leasehold', 'tenant'
    -- For quarters - link to parent plantation
    parent_property_id UUID REFERENCES properties(property_id) ON DELETE SET NULL,
    -- Location
    subdivision_id INTEGER REFERENCES geographic_subdivisions(subdivision_id),
    location_description TEXT,
    -- Size
    acreage DECIMAL(10,2),
    acreage_source VARCHAR(255),         -- Where acreage info came from
    -- Dates
    acquired_date DATE,
    acquired_year INTEGER,               -- When full date unknown
    acquisition_method VARCHAR(100),     -- 'patent', 'purchase', 'inheritance', 'grant', 'marriage'
    disposed_date DATE,
    disposed_year INTEGER,
    disposition_method VARCHAR(100),     -- 'sale', 'bequest', 'escheat', 'partition'
    -- Source
    source_document_id VARCHAR(255) REFERENCES documents(document_id) ON DELETE SET NULL,
    source_description TEXT,
    -- Metadata
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_properties_owner ON properties(owner_id);
CREATE INDEX IF NOT EXISTS idx_properties_parent ON properties(parent_property_id);
CREATE INDEX IF NOT EXISTS idx_properties_type ON properties(property_type);
CREATE INDEX IF NOT EXISTS idx_properties_subdivision ON properties(subdivision_id);
CREATE INDEX IF NOT EXISTS idx_properties_name ON properties(property_name);

-- Property residents - who lived/worked on properties
CREATE TABLE IF NOT EXISTS property_residents (
    id SERIAL PRIMARY KEY,
    property_id UUID NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,
    -- Can be free individual or enslaved
    individual_id VARCHAR(255) REFERENCES individuals(individual_id) ON DELETE CASCADE,
    enslaved_id VARCHAR(255) REFERENCES enslaved_individuals(enslaved_id) ON DELETE CASCADE,
    -- Role on property
    resident_role VARCHAR(50) NOT NULL,  -- 'owner', 'overseer', 'tenant', 'field_worker', 'domestic', 'craftsman'
    -- Time period
    start_year INTEGER,
    end_year INTEGER,
    start_date DATE,
    end_date DATE,
    -- Source
    source_document_id VARCHAR(255) REFERENCES documents(document_id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    -- Ensure either individual_id or enslaved_id is set
    CONSTRAINT check_resident_type CHECK (
        (individual_id IS NOT NULL AND enslaved_id IS NULL) OR
        (individual_id IS NULL AND enslaved_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_prop_residents_property ON property_residents(property_id);
CREATE INDEX IF NOT EXISTS idx_prop_residents_individual ON property_residents(individual_id);
CREATE INDEX IF NOT EXISTS idx_prop_residents_enslaved ON property_residents(enslaved_id);
CREATE INDEX IF NOT EXISTS idx_prop_residents_role ON property_residents(resident_role);

-- ============================================================================
-- ENHANCEMENT 6: ENHANCED NAME HANDLING FOR ENSLAVED INDIVIDUALS
-- ============================================================================

ALTER TABLE enslaved_individuals
ADD COLUMN IF NOT EXISTS given_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS surname VARCHAR(255),
ADD COLUMN IF NOT EXISTS name_type VARCHAR(50) DEFAULT 'given_only',  -- 'given_only', 'full', 'surname_only', 'descriptive'
ADD COLUMN IF NOT EXISTS name_origin VARCHAR(100),                     -- 'african', 'english', 'biblical', 'classical', 'descriptive'
ADD COLUMN IF NOT EXISTS gender_source VARCHAR(50) DEFAULT 'inferred', -- 'explicit', 'inferred_from_name', 'unknown'
ADD COLUMN IF NOT EXISTS gender_confidence DECIMAL(3,2);               -- Confidence in gender assignment

-- Update existing records to populate given_name from full_name where possible
UPDATE enslaved_individuals
SET given_name = full_name
WHERE given_name IS NULL AND full_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_enslaved_given_name ON enslaved_individuals(given_name);
CREATE INDEX IF NOT EXISTS idx_enslaved_surname ON enslaved_individuals(surname);

-- ============================================================================
-- ENHANCEMENT 7: DATA ATTRIBUTION AND PROVENANCE SYSTEM
-- ============================================================================

-- Source types reference table
CREATE TABLE IF NOT EXISTS source_types (
    source_type_id SERIAL PRIMARY KEY,
    source_type_code VARCHAR(50) UNIQUE NOT NULL,
    source_type_name VARCHAR(255) NOT NULL,
    description TEXT,
    reliability_weight DECIMAL(3,2) DEFAULT 1.00  -- How much to weight this source type
);

-- Pre-populate source types
INSERT INTO source_types (source_type_code, source_type_name, description, reliability_weight)
VALUES
    ('tax_list', 'Tax List/Assessment', 'Annual or periodic tax assessments', 0.95),
    ('census', 'Census Record', 'Federal or state census', 0.90),
    ('probate', 'Probate Record', 'Wills, inventories, administrations', 0.95),
    ('land_record', 'Land Record', 'Deeds, patents, surveys', 0.95),
    ('court_record', 'Court Record', 'Civil and criminal proceedings', 0.90),
    ('parish_register', 'Parish Register', 'Church records: baptisms, marriages, burials', 0.85),
    ('military', 'Military Record', 'Muster rolls, pension applications', 0.85),
    ('newspaper', 'Newspaper', 'Advertisements, notices, obituaries', 0.75),
    ('family_bible', 'Family Bible', 'Family-recorded vital events', 0.70),
    ('oral_history', 'Oral History', 'Family traditions and interviews', 0.50),
    ('secondary', 'Secondary Source', 'Published genealogies, histories', 0.60),
    ('transcription', 'Modern Transcription', 'Scholarly transcription of primary source', 0.90),
    ('database', 'Database/Index', 'Compiled database or index', 0.80)
ON CONFLICT (source_type_code) DO NOTHING;

-- Data attributions - tracks where each piece of information came from
CREATE TABLE IF NOT EXISTS data_attributions (
    attribution_id SERIAL PRIMARY KEY,
    -- What record/field this attribution applies to
    target_table VARCHAR(100) NOT NULL,  -- 'individuals', 'enslaved_individuals', 'households', etc.
    target_id VARCHAR(255) NOT NULL,      -- The record ID
    field_name VARCHAR(100),              -- Specific field, or NULL if for whole record
    -- Source information
    source_type_id INTEGER REFERENCES source_types(source_type_id),
    source_document_id VARCHAR(255) REFERENCES documents(document_id) ON DELETE SET NULL,
    source_description TEXT,              -- Free text description of source
    source_citation TEXT,                 -- Formatted citation
    source_url TEXT,                      -- If available online
    source_date DATE,                     -- Date of the source document
    source_date_text VARCHAR(100),        -- When exact date unknown: "circa 1733", "before 1750"
    -- Attribution metadata
    attributed_value TEXT,                -- The actual value from this source
    is_primary_source BOOLEAN DEFAULT true,
    confidence DECIMAL(3,2) DEFAULT 1.00,
    confidence_reason TEXT,               -- Why this confidence level
    -- Who made this attribution
    attributed_by VARCHAR(255),           -- Researcher/contributor
    attribution_date TIMESTAMP DEFAULT NOW(),
    -- Verification
    verified BOOLEAN DEFAULT false,
    verified_by VARCHAR(255),
    verified_at TIMESTAMP,
    -- Notes
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attributions_target ON data_attributions(target_table, target_id);
CREATE INDEX IF NOT EXISTS idx_attributions_field ON data_attributions(field_name);
CREATE INDEX IF NOT EXISTS idx_attributions_source_type ON data_attributions(source_type_id);
CREATE INDEX IF NOT EXISTS idx_attributions_source_doc ON data_attributions(source_document_id);
CREATE INDEX IF NOT EXISTS idx_attributions_verified ON data_attributions(verified);

-- Inference log - tracks when data was inferred/derived rather than directly recorded
CREATE TABLE IF NOT EXISTS inference_log (
    inference_id SERIAL PRIMARY KEY,
    -- What was inferred
    target_table VARCHAR(100) NOT NULL,
    target_id VARCHAR(255) NOT NULL,
    field_name VARCHAR(100) NOT NULL,
    inferred_value TEXT NOT NULL,
    -- How it was inferred
    inference_type VARCHAR(100) NOT NULL,  -- 'name_gender', 'age_from_tax_status', 'relationship_from_context', etc.
    inference_method TEXT,                  -- Description of method used
    inference_rule TEXT,                    -- The rule applied
    -- Basis for inference
    basis_records JSONB,                    -- Array of records used as basis
    -- Confidence
    confidence DECIMAL(3,2) NOT NULL,
    confidence_reason TEXT,
    -- Audit
    inferred_by VARCHAR(100),               -- 'system' or username
    inferred_at TIMESTAMP DEFAULT NOW(),
    reviewed BOOLEAN DEFAULT false,
    reviewed_by VARCHAR(255),
    reviewed_at TIMESTAMP,
    review_decision VARCHAR(50),            -- 'accepted', 'rejected', 'modified'
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_inference_target ON inference_log(target_table, target_id);
CREATE INDEX IF NOT EXISTS idx_inference_type ON inference_log(inference_type);
CREATE INDEX IF NOT EXISTS idx_inference_reviewed ON inference_log(reviewed);

-- ============================================================================
-- ADDITIONAL RELATIONSHIP TYPES
-- Expand the relationship vocabulary
-- ============================================================================

-- Add relationship categories to existing table
ALTER TABLE individual_relationships
ADD COLUMN IF NOT EXISTS relationship_category VARCHAR(50);  -- 'kinship', 'legal', 'economic', 'residential', 'ecclesiastical'

-- Create a reference table for valid relationship types
CREATE TABLE IF NOT EXISTS relationship_types (
    relationship_type_id SERIAL PRIMARY KEY,
    relationship_code VARCHAR(50) UNIQUE NOT NULL,
    relationship_name VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL,
    inverse_code VARCHAR(50),              -- The inverse relationship
    is_directed BOOLEAN DEFAULT false,     -- Does direction matter?
    description TEXT
);

-- Populate relationship types
INSERT INTO relationship_types (relationship_code, relationship_name, category, inverse_code, is_directed, description)
VALUES
    -- Kinship (undirected)
    ('spouse', 'Spouse', 'kinship', 'spouse', false, 'Married couple'),
    ('sibling', 'Sibling', 'kinship', 'sibling', false, 'Brothers/sisters'),
    -- Kinship (directed)
    ('parent', 'Parent', 'kinship', 'child', true, 'Parent of'),
    ('child', 'Child', 'kinship', 'parent', true, 'Child of'),
    ('grandparent', 'Grandparent', 'kinship', 'grandchild', true, 'Grandparent of'),
    ('grandchild', 'Grandchild', 'kinship', 'grandparent', true, 'Grandchild of'),
    ('uncle_aunt', 'Uncle/Aunt', 'kinship', 'niece_nephew', true, 'Uncle or aunt of'),
    ('niece_nephew', 'Niece/Nephew', 'kinship', 'uncle_aunt', true, 'Niece or nephew of'),
    ('cousin', 'Cousin', 'kinship', 'cousin', false, 'Cousins'),
    ('step_parent', 'Step-Parent', 'kinship', 'step_child', true, 'Step-parent of'),
    ('step_child', 'Step-Child', 'kinship', 'step_parent', true, 'Step-child of'),
    ('in_law', 'In-Law', 'kinship', 'in_law', false, 'Related by marriage'),
    -- Legal
    ('guardian', 'Guardian', 'legal', 'ward', true, 'Legal guardian of'),
    ('ward', 'Ward', 'legal', 'guardian', true, 'Ward of guardian'),
    ('master', 'Master', 'legal', 'apprentice', true, 'Master of apprentice'),
    ('apprentice', 'Apprentice', 'legal', 'master', true, 'Apprenticed to'),
    ('indentured_to', 'Indentured To', 'legal', 'holds_indenture', true, 'Indentured servant of'),
    ('holds_indenture', 'Holds Indenture', 'legal', 'indentured_to', true, 'Holds indenture of'),
    ('enslaver', 'Enslaver', 'legal', 'enslaved_by', true, 'Enslaved this person'),
    ('enslaved_by', 'Enslaved By', 'legal', 'enslaver', true, 'Was enslaved by'),
    ('executor', 'Executor', 'legal', 'testator', true, 'Executor of estate'),
    ('testator', 'Testator', 'legal', 'executor', true, 'Whose estate was administered'),
    ('witness', 'Witness', 'legal', 'witnessed_for', true, 'Witnessed document for'),
    -- Economic
    ('employer', 'Employer', 'economic', 'employee', true, 'Employed this person'),
    ('employee', 'Employee', 'economic', 'employer', true, 'Employed by'),
    ('business_partner', 'Business Partner', 'economic', 'business_partner', false, 'Business partners'),
    ('creditor', 'Creditor', 'economic', 'debtor', true, 'Creditor of'),
    ('debtor', 'Debtor', 'economic', 'creditor', true, 'Debtor to'),
    ('overseer_of', 'Overseer Of', 'economic', 'supervised_by', true, 'Oversaw workers for'),
    ('supervised_by', 'Supervised By', 'economic', 'overseer_of', true, 'Supervised by overseer'),
    -- Residential
    ('head_of_household', 'Head of Household', 'residential', 'household_member', true, 'Head of household containing'),
    ('household_member', 'Household Member', 'residential', 'head_of_household', true, 'Member of household headed by'),
    ('neighbor', 'Neighbor', 'residential', 'neighbor', false, 'Neighbors'),
    ('landlord', 'Landlord', 'residential', 'tenant', true, 'Landlord of'),
    ('tenant', 'Tenant', 'residential', 'landlord', true, 'Tenant of'),
    -- Ecclesiastical
    ('godparent', 'Godparent', 'ecclesiastical', 'godchild', true, 'Godparent of'),
    ('godchild', 'Godchild', 'ecclesiastical', 'godparent', true, 'Godchild of'),
    ('minister_of', 'Minister Of', 'ecclesiastical', 'congregant_of', true, 'Minister/pastor of'),
    ('congregant_of', 'Congregant Of', 'ecclesiastical', 'minister_of', true, 'Congregant of')
ON CONFLICT (relationship_code) DO NOTHING;

-- ============================================================================
-- VIEWS FOR COMMON QUERIES
-- ============================================================================

-- View: Full household with all members
CREATE OR REPLACE VIEW household_full AS
SELECT
    h.household_id,
    h.source_year,
    h.household_seq,
    h.document_seq_identifier,
    gs.name AS subdivision_name,
    gs.subdivision_type,
    head.full_name AS head_of_household_name,
    h.total_taxables,
    h.enslaved_males,
    h.enslaved_females,
    h.notes,
    -- Aggregate members
    (SELECT json_agg(json_build_object(
        'name', COALESCE(i.full_name, e.full_name),
        'status', hm.member_status,
        'relationship', hm.relationship_to_head,
        'is_enslaved', hm.enslaved_id IS NOT NULL
    ) ORDER BY hm.member_seq)
    FROM household_members hm
    LEFT JOIN individuals i ON hm.individual_id = i.individual_id
    LEFT JOIN enslaved_individuals e ON hm.enslaved_id = e.enslaved_id
    WHERE hm.household_id = h.household_id
    ) AS members
FROM households h
LEFT JOIN individuals head ON h.head_of_household_id = head.individual_id
LEFT JOIN geographic_subdivisions gs ON h.subdivision_id = gs.subdivision_id;

-- View: Geographic hierarchy
CREATE OR REPLACE VIEW geographic_hierarchy AS
WITH RECURSIVE geo_tree AS (
    SELECT
        subdivision_id,
        name,
        subdivision_type,
        parent_id,
        name::text AS full_path,
        1 AS depth
    FROM geographic_subdivisions
    WHERE parent_id IS NULL

    UNION ALL

    SELECT
        g.subdivision_id,
        g.name,
        g.subdivision_type,
        g.parent_id,
        gt.full_path || ' > ' || g.name,
        gt.depth + 1
    FROM geographic_subdivisions g
    JOIN geo_tree gt ON g.parent_id = gt.subdivision_id
)
SELECT * FROM geo_tree ORDER BY full_path;

-- View: Property with residents
CREATE OR REPLACE VIEW property_with_residents AS
SELECT
    p.property_id,
    p.property_name,
    p.property_type,
    p.acreage,
    owner.full_name AS owner_name,
    gs.name AS subdivision_name,
    parent_prop.property_name AS parent_property_name,
    (SELECT json_agg(json_build_object(
        'name', COALESCE(i.full_name, e.full_name),
        'role', pr.resident_role,
        'is_enslaved', pr.enslaved_id IS NOT NULL,
        'years', pr.start_year || '-' || COALESCE(pr.end_year::text, 'present')
    ))
    FROM property_residents pr
    LEFT JOIN individuals i ON pr.individual_id = i.individual_id
    LEFT JOIN enslaved_individuals e ON pr.enslaved_id = e.enslaved_id
    WHERE pr.property_id = p.property_id
    ) AS residents
FROM properties p
LEFT JOIN individuals owner ON p.owner_id = owner.individual_id
LEFT JOIN geographic_subdivisions gs ON p.subdivision_id = gs.subdivision_id
LEFT JOIN properties parent_prop ON p.parent_property_id = parent_prop.property_id;

-- View: Data provenance summary
CREATE OR REPLACE VIEW data_provenance_summary AS
SELECT
    da.target_table,
    da.target_id,
    COUNT(*) AS attribution_count,
    array_agg(DISTINCT st.source_type_name) AS source_types,
    AVG(da.confidence) AS avg_confidence,
    MIN(da.source_date) AS earliest_source,
    MAX(da.source_date) AS latest_source,
    bool_and(da.verified) AS fully_verified
FROM data_attributions da
LEFT JOIN source_types st ON da.source_type_id = st.source_type_id
GROUP BY da.target_table, da.target_id;

-- ============================================================================
-- UPDATE TIMESTAMPS TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply to new tables
DO $$
DECLARE
    t text;
BEGIN
    FOR t IN SELECT unnest(ARRAY[
        'geographic_subdivisions',
        'households',
        'properties',
        'data_attributions'
    ])
    LOOP
        EXECUTE format('
            DROP TRIGGER IF EXISTS update_%s_updated_at ON %s;
            CREATE TRIGGER update_%s_updated_at
            BEFORE UPDATE ON %s
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
        ', t, t, t, t);
    END LOOP;
END $$;

-- ============================================================================
-- SUMMARY OF CHANGES
-- ============================================================================

-- Display what was created
SELECT 'Migration 007 Complete. Created/Modified:' AS status;
SELECT table_name, table_type
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN (
    'geographic_subdivisions',
    'households',
    'household_members',
    'properties',
    'property_residents',
    'source_types',
    'data_attributions',
    'inference_log',
    'relationship_types'
)
ORDER BY table_name;
