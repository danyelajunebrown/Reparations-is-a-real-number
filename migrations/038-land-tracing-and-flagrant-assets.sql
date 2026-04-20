-- Migration 038: Land Tracing + Flagrant Heirloom Assets
--
-- Operationalizes the 2026-04-18 wealth-tracing pivot (see
-- memory/project_wealth_tracing_pivot.md and
-- memory-bank/wealth-tracing-framework.md for full context).
--
-- Additive on top of migration 007's `properties` table, which captured
-- individual property holdings as point-in-time snapshots. This migration
-- adds the four pieces that were missing for lineage-specific wealth tracing:
--
--   1. land_transfer_events
--        Full chain of title: every documented grantor→grantee transfer for
--        a property. migration 007 recorded only the first and last owner
--        of a given `properties` row; this table captures EVERY step between
--        them, which is what a court-admissible wealth trace requires.
--
--   2. modern_parcel_links
--        Maps a historical `properties` row to modern parcel identifiers
--        (county assessor parcel number, geohash, modern address).
--        Enables "this 1850 plantation tract → this 2026 suburban
--        subdivision" closures where the title survived continuously.
--
--   3. top_landholder_flags
--        References `canonical_persons`. Flags a person as a top-tier
--        landholder in a specific (year, region) context — sourced from
--        1860 Agricultural Census, published state-level scholarship, or
--        curated secondary sources. Distinct from the "any-scale slaveholder"
--        tier: this is the upper-1% weighting signal.
--
--   4. flagrant_heirloom_assets
--        Other asset categories that appear in probate inventories with
--        enough documentation to trace: named trusts, individual stock
--        certificates with bearer chains, identifiable art/jewelry,
--        heirloom instruments, etc. Land is primary but not exclusive.
--
-- Design rules:
--   • Additive only — no column drops, no breaking changes to existing tables.
--   • Every record carries provenance (source_document_url + source_archive)
--     and a confidence decimal — matches the pattern set by migration 034
--     (match-verification) so the same MatchVerifier pipeline concepts apply.
--   • References to persons use `canonical_persons(person_id)` as the
--     canonical identity. Historical `individuals(individual_id)` references
--     kept only where they exist in `properties` already.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. land_transfer_events — chain of title
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS land_transfer_events (
    transfer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Which parcel this transfer concerns. Preferred link is to the
    -- existing properties.property_id; if the parcel isn't in properties
    -- yet (only a future transfer is documented), this can be NULL and the
    -- row is resolved later via property_description.
    -- Forward-compatible: will become a FK to properties(property_id) from
    -- migration 007 if/when that migration is applied. For now, a plain UUID
    -- that can hold a properties.property_id when the referenced table exists.
    property_id UUID,
    property_description TEXT,  -- free-text fallback when property_id is NULL

    -- When and how
    transfer_date DATE,
    transfer_year INTEGER,       -- when full date unknown (many colonial records)
    transfer_type TEXT NOT NULL, -- 'sale', 'inheritance', 'gift', 'grant',
                                 -- 'foreclosure', 'tax_sale', 'partition',
                                 -- 'marriage', 'escheat', 'compensation',
                                 -- 'reverse_mortgage', 'eminent_domain'
    instrument_type TEXT,        -- 'deed', 'will', 'administration', 'decree',
                                 -- 'patent', 'bond', 'quitclaim'

    -- Parties. Name fields are the LITERAL names as they appear in the record;
    -- the person_id UUID columns are our resolved identity link, nullable
    -- until resolution happens. Both sides carry the name for fidelity.
    grantor_name TEXT,
    grantor_person_id INTEGER REFERENCES canonical_persons(id) ON DELETE SET NULL,
    grantee_name TEXT,
    grantee_person_id INTEGER REFERENCES canonical_persons(id) ON DELETE SET NULL,

    -- Money (when recorded)
    consideration_usd DECIMAL(14,2),  -- nominal USD at transfer_year
    consideration_notes TEXT,         -- "1 dollar and love" / "£450 sterling" / "ten negroes"

    -- Provenance — every row carries its source
    source_document_url TEXT,   -- FamilySearch ARK, Ancestry doc URL, archive.org, etc.
    source_archive TEXT,        -- "Fairfax VA Circuit Court Deed Book T"
    source_page TEXT,           -- "pp. 342-345" or image identifier
    source_notes TEXT,

    -- Confidence and review (mirrors match-verification pattern)
    confidence DECIMAL(3,2) DEFAULT 0.80,  -- 0.00-1.00
    verification_status TEXT DEFAULT 'unverified',  -- 'unverified', 'confirmed',
                                                     -- 'disputed', 'needs_review'
    requires_human_review BOOLEAN DEFAULT FALSE,
    review_reason TEXT,

    -- This transfer can be flagged as part of an enslaver's disposition, which
    -- is the specific signal we care about for reparations tracing.
    implicates_enslaver BOOLEAN DEFAULT FALSE,
    enslaver_person_id INTEGER REFERENCES canonical_persons(id) ON DELETE SET NULL,
    -- Why flagged: grantor appears in slave_schedules, slave_imports, etc.

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transfer_property ON land_transfer_events(property_id);
CREATE INDEX IF NOT EXISTS idx_transfer_grantor ON land_transfer_events(grantor_person_id);
CREATE INDEX IF NOT EXISTS idx_transfer_grantee ON land_transfer_events(grantee_person_id);
CREATE INDEX IF NOT EXISTS idx_transfer_date ON land_transfer_events(transfer_date);
CREATE INDEX IF NOT EXISTS idx_transfer_year ON land_transfer_events(transfer_year);
CREATE INDEX IF NOT EXISTS idx_transfer_enslaver ON land_transfer_events(enslaver_person_id)
    WHERE implicates_enslaver = TRUE;

COMMENT ON TABLE land_transfer_events IS
  'Every documented grantor-to-grantee transfer for a land parcel. The chain '
  'of transfer_events for a given property_id, ordered by transfer_date, '
  'reconstructs the full title history. Admissible as a source for DAA '
  'calculations when confidence >= 0.80 and verification_status = confirmed.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. modern_parcel_links — historical property to current parcel
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS modern_parcel_links (
    link_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- See note above — plain UUID now, FK when migration 007 lands.
    property_id UUID NOT NULL,

    -- Modern identifiers (populate any that apply)
    modern_parcel_number TEXT,   -- County assessor's parcel ID / APN / folio
    modern_address TEXT,         -- Current street address
    modern_county TEXT,
    modern_state TEXT,
    modern_lat DECIMAL(9,6),     -- centroid if derivable
    modern_lng DECIMAL(9,6),
    geohash TEXT,                -- for coarse spatial join
    assessor_db_url TEXT,        -- deep link into county GIS if public

    -- Some historical parcels were SUBDIVIDED into many modern parcels;
    -- others were MERGED. One-to-many and many-to-one handled via this
    -- join table having multiple rows per property_id.
    cardinality TEXT DEFAULT '1_to_1',  -- '1_to_1', '1_to_many', 'many_to_1'
    cardinality_notes TEXT,

    -- Provenance and confidence
    trace_method TEXT,           -- 'continuous_chain_of_title',
                                 -- 'plat_overlay_gis', 'adjacency_inference',
                                 -- 'expert_attestation'
    source_document_url TEXT,
    source_notes TEXT,
    confidence DECIMAL(3,2) DEFAULT 0.70,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_parcel_link_property ON modern_parcel_links(property_id);
CREATE INDEX IF NOT EXISTS idx_parcel_link_modern ON modern_parcel_links(modern_parcel_number);
CREATE INDEX IF NOT EXISTS idx_parcel_link_geohash ON modern_parcel_links(geohash);

COMMENT ON TABLE modern_parcel_links IS
  'Maps a historical properties row to one or more modern parcel identifiers. '
  'Populated via continuous chain of title traced through land_transfer_events '
  '(best) or via plat-overlay GIS work (second best). Cardinality tracks '
  'whether the historical parcel was subdivided, merged, or preserved intact.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. top_landholder_flags — the "top 1%" reference layer
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS top_landholder_flags (
    flag_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id INTEGER NOT NULL REFERENCES canonical_persons(id) ON DELETE CASCADE,

    -- The flagged context. A person can carry multiple flags (top in VA 1860,
    -- top in TN 1880, etc.). Region can be a state, county, or transnational
    -- context for slave-trade-era merchants.
    reference_year INTEGER NOT NULL,
    region_type TEXT NOT NULL,       -- 'state', 'county', 'country', 'caribbean_colony'
    region_name TEXT NOT NULL,

    -- Metric that justifies the flag
    metric TEXT NOT NULL,            -- 'acreage', 'assessed_value_usd',
                                     -- 'improved_land_acres', 'enslaved_count'
    metric_value DECIMAL(14,2),
    metric_percentile DECIMAL(5,2),  -- 99.0 means top 1%. Always express as
                                     -- "top N%" not "bottom percentile."
    metric_rank INTEGER,             -- optional: actual rank in the source data

    -- Source — every flag carries it. The primary sources will be 1860 and
    -- 1870 U.S. Agricultural Census aggregated tables, plus published
    -- state-level scholarship (Gates, Baptist, Beckert, etc.).
    source_type TEXT NOT NULL,       -- 'agricultural_census_1860',
                                     -- 'agricultural_census_1870',
                                     -- 'published_scholarship',
                                     -- 'probate_inventory', 'tax_rolls'
    source_citation TEXT NOT NULL,   -- full bibliographic citation or archive ref
    source_url TEXT,

    confidence DECIMAL(3,2) DEFAULT 0.85,
    notes TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (person_id, reference_year, region_name, metric)
);

CREATE INDEX IF NOT EXISTS idx_top_holder_person ON top_landholder_flags(person_id);
CREATE INDEX IF NOT EXISTS idx_top_holder_region ON top_landholder_flags(region_type, region_name, reference_year);

COMMENT ON TABLE top_landholder_flags IS
  'Seeds the "top 1% landholder" reference tier. Distinct from any-scale '
  'slaveholder tier (which is captured via existing slave-schedule presence). '
  'Every ancestor climb checks against this table early — a match promotes '
  'the lineage into priority trace depth.';

-- ────────────────────────────────────────────────────────────────────────────
-- 4. flagrant_heirloom_assets — the "other documented assets" catch
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flagrant_heirloom_assets (
    asset_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Who held it (historically) and who holds it now
    original_holder_person_id INTEGER REFERENCES canonical_persons(id) ON DELETE SET NULL,
    original_holder_name TEXT,       -- literal name in record
    current_holder_person_id INTEGER REFERENCES canonical_persons(id) ON DELETE SET NULL,
    current_holder_name TEXT,

    -- What it is
    asset_category TEXT NOT NULL,    -- 'named_trust', 'stock_certificate',
                                     -- 'bond', 'art', 'jewelry', 'silver',
                                     -- 'instrument', 'furniture',
                                     -- 'manuscript', 'land_patent_document',
                                     -- 'slave_bill_of_sale' (as collectible),
                                     -- 'bearer_note', 'life_insurance_policy'
    asset_name TEXT,                 -- "Elijah Wood Trust" / "1847 Sèvres vase" /
                                     -- "50 shares Erie Railroad, 1855 certificate"
    asset_description TEXT,
    appraised_value_usd DECIMAL(14,2),
    appraised_year INTEGER,

    -- Documented in
    first_documented_year INTEGER,   -- year this asset first appears in records
    last_documented_year INTEGER,    -- most recent documented provenance
    provenance_gap_years INTEGER,    -- years unaccounted for in the chain

    -- Provenance
    source_document_url TEXT,
    source_archive TEXT,
    source_citation TEXT,
    source_notes TEXT,

    -- Does this touch the slave economy?
    implicates_enslaver BOOLEAN DEFAULT FALSE,
    enslaver_person_id INTEGER REFERENCES canonical_persons(id) ON DELETE SET NULL,
    slavery_connection_notes TEXT,   -- "Stock certificate issued by Southern
                                     -- Railway, built on leased convict labor
                                     -- of Black men 1880-1910"

    confidence DECIMAL(3,2) DEFAULT 0.75,
    verification_status TEXT DEFAULT 'unverified',
    requires_human_review BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_heirloom_original ON flagrant_heirloom_assets(original_holder_person_id);
CREATE INDEX IF NOT EXISTS idx_heirloom_current ON flagrant_heirloom_assets(current_holder_person_id);
CREATE INDEX IF NOT EXISTS idx_heirloom_category ON flagrant_heirloom_assets(asset_category);
CREATE INDEX IF NOT EXISTS idx_heirloom_enslaver ON flagrant_heirloom_assets(enslaver_person_id)
    WHERE implicates_enslaver = TRUE;

COMMENT ON TABLE flagrant_heirloom_assets IS
  'Catches other heirloom asset categories that show up in probate inventories '
  'with enough documentation to trace across generations. Land is the primary '
  'category (see land_transfer_events) but this table captures the rest — '
  'named trusts, individual stock certificates, art, jewelry, silver, '
  'bearer notes, etc. — when documented.';

-- ────────────────────────────────────────────────────────────────────────────
-- Convenience view: an enslaver's full documented material footprint
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW enslaver_material_footprint AS
SELECT
    cp.id,
    cp.canonical_name,
    cp.birth_year_estimate AS birth_year,
    cp.death_year_estimate AS death_year,
    -- Historical land holdings (from existing properties table joined via
    -- resolved individuals↔canonical_persons identity)
    (SELECT COUNT(*) FROM land_transfer_events WHERE enslaver_person_id = cp.id) AS transfer_events_count,
    (SELECT COUNT(*) FROM flagrant_heirloom_assets WHERE enslaver_person_id = cp.id) AS heirloom_assets_count,
    (SELECT COUNT(*) FROM top_landholder_flags WHERE person_id = cp.id) AS top_holder_flags_count,
    (SELECT MIN(reference_year) FROM top_landholder_flags WHERE person_id = cp.id) AS earliest_top_holder_year,
    (SELECT MAX(reference_year) FROM top_landholder_flags WHERE person_id = cp.id) AS latest_top_holder_year
FROM canonical_persons cp
WHERE cp.person_type = 'enslaver';

COMMENT ON VIEW enslaver_material_footprint IS
  'Summary row per enslaver of documented material wealth signals: land '
  'transfers implicating them, flagrant heirloom assets held, top-holder '
  'flag coverage. Used by DAAOrchestrator to prefer specific-asset traces '
  'over aggregate statistical estimates when available.';
