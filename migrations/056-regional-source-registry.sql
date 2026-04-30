-- Migration 056: regional_source_registry
-- Date: 2026-04-29
--
-- Per memory-bank/plan-apr29-will-source-registry-dual-ledger-daa.md §2.M056
-- and §3.6.
--
-- Dual-axis registry of horizontal data sources. Per Eltis methodology
-- (JSDP 2021), a horizontal source can play one or both roles:
--   - position: enumerates WHO was WHERE/WHEN (deeds, slave schedules,
--               tax rolls, port arrival lists, censuses). Provides
--               positivity/comparison-group support.
--   - trajectory: enumerates MOVEMENTS between places/times (voyages,
--                 fugitive custody events, manumissions, sales,
--                 inheritance transfers). Provides chain-of-custody
--                 support.
-- A single source can play both roles (SlaveVoyages: voyages =
-- trajectories; ports = positions).
--
-- Note on Tolbert (2025) framing: this registry is for documentary-
-- completeness coverage, NOT for population-level causal coverage.
-- Tolbert's argument explicitly rules out causal counterfactual recovery
-- from pre-repair data. Per-cell coverage tracked here is documentary
-- completeness only.
--
-- Initial seed catalog: 16 sources spanning trans-Atlantic to local
-- archival corpora, with declared coverage cells, era windows, and
-- access methods. Sources without automated query paths register as
-- manual_lookup until ingestion is built.

CREATE TABLE IF NOT EXISTS regional_source_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Stable name for cross-references.
    source_name TEXT NOT NULL UNIQUE,

    -- Bibliographic citation. Multiple lines OK.
    citation TEXT NOT NULL,

    -- Jurisdictional scope. Free-text for now; geojson_id reserved for
    -- future spatial indexing.
    jurisdiction_text TEXT NOT NULL,
    jurisdiction_geojson_id UUID,

    -- Era covered. Both bounds optional (some corpora extend indefinitely
    -- in one direction).
    era_start INTEGER,
    era_end INTEGER,

    -- Record type per Eltis controlled vocabulary (JSDP 2021 + extensions).
    record_type TEXT NOT NULL CHECK (record_type IN (
        'deed','chancery','probate','tax','church','directory','newspaper',
        'voyage_log','runaway_advertisement','will_testament','inventory',
        'compensation_petition','manumission','marriage','census',
        'ship_manifest','estate_record','insurance_policy','court_record',
        'travel_account','financial_account','digital_data_repository',
        'narrative_history','custody_event','transaction_register'
    )),

    -- Axis role: position, trajectory, or both. Per plan §3.6.
    axis_role TEXT[] NOT NULL
        CHECK (
            axis_role <@ ARRAY['position','trajectory']
            AND array_length(axis_role, 1) >= 1
        ),

    -- How the system accesses this source. manual_lookup until automated
    -- ingestion is built; pdf_index for finding-aid-style sources;
    -- rest_api / web_query for live sources; batch_export for one-shot
    -- corpus loads.
    access_method TEXT NOT NULL CHECK (access_method IN (
        'pdf_index','web_query','rest_api','manual_lookup','batch_export'
    )),

    -- Free-text coverage notes (gaps, biases, what's known about
    -- completeness within the source's era).
    coverage_notes TEXT,

    -- Eltis-style estimated completeness 0..1 with derivation cited via
    -- methodology_id. Nullable when uncertainty itself is unknown.
    estimated_completeness NUMERIC(3,2)
        CHECK (estimated_completeness IS NULL OR (estimated_completeness >= 0.0 AND estimated_completeness <= 1.0)),

    -- Methodology citation (M060) — typically the source's own published
    -- methodology paper or our internal acknowledgment row.
    methodology_id UUID REFERENCES estimation_methodology_registry(id) ON DELETE SET NULL,

    registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_verified_at TIMESTAMPTZ,

    CHECK (era_end IS NULL OR era_start IS NULL OR era_end >= era_start)
);

CREATE INDEX IF NOT EXISTS idx_regional_source_registry_record_type
    ON regional_source_registry(record_type);
CREATE INDEX IF NOT EXISTS idx_regional_source_registry_axis_role
    ON regional_source_registry USING GIN (axis_role);
CREATE INDEX IF NOT EXISTS idx_regional_source_registry_era
    ON regional_source_registry(era_start, era_end);
CREATE INDEX IF NOT EXISTS idx_regional_source_registry_access_method
    ON regional_source_registry(access_method);

COMMENT ON TABLE regional_source_registry IS
    'Dual-axis registry of horizontal data sources (position vs trajectory). '
    'Sources are registered with declared coverage cells, era windows, and '
    'access methods. Per plan-apr29 §3.6 and Eltis JSDP 2021 methodology.';

-- Seed catalog: 16 sources. Each INSERT is its own statement to keep the
-- migration runner's splitter happy. Idempotent via UNIQUE(source_name)
-- + ON CONFLICT DO NOTHING.

INSERT INTO regional_source_registry
    (source_name, citation, jurisdiction_text, era_start, era_end, record_type, axis_role, access_method, coverage_notes, estimated_completeness)
VALUES (
    'slavevoyages_transatlantic',
    'Eltis, David. "The Trans-Atlantic Slave Trade Database: Origins, Development, Content." Journal of Slavery and Data Preservation 2:3 (2021). https://www.slavevoyages.org/voyage/about/',
    'Trans-Atlantic (Africa, Europe, North America, South America, Caribbean)',
    1514, 1866, 'voyage_log', ARRAY['position','trajectory'], 'rest_api',
    'Eltis et al. estimate ~80-90% coverage of all trans-Atlantic slave voyages. Worst gaps: pre-1620 Spanish/Portuguese trade and 1807-1867 illegal trade. Best coverage 1700-1820. 36,000 voyages, 258 variables in 7 categories. Already integrated for matching; expand to use voyage details (consignees, ports, dates) for chain-of-custody.',
    0.85
) ON CONFLICT (source_name) DO NOTHING;

INSERT INTO regional_source_registry
    (source_name, citation, jurisdiction_text, era_start, era_end, record_type, axis_role, access_method, coverage_notes, estimated_completeness)
VALUES (
    'slavevoyages_intraamerican',
    'SlaveVoyages.org Intra-American Slave Trade Database (Eltis et al.). 10,000 voyages within the Americas, often carrying recent survivors of the middle passage.',
    'Intra-American (United States internal, Caribbean, Brazil)',
    1620, 1866, 'voyage_log', ARRAY['position','trajectory'], 'rest_api',
    'Half of all disembarked captives faced a second middle passage within the Americas. DC/Maryland are upper-South export points to Louisiana/Mississippi import points — domestic slave trade where named consignees often resolve to canonical_persons enslavers. Currently UNDER-USED in our matching pipeline; should be queried alongside transatlantic for any DC/MD/Gulf-South enslaver.',
    0.70
) ON CONFLICT (source_name) DO NOTHING;

INSERT INTO regional_source_registry
    (source_name, citation, jurisdiction_text, era_start, era_end, record_type, axis_role, access_method, coverage_notes, estimated_completeness)
VALUES (
    'african_origins_project',
    'Eltis, David et al. African-Origins.org. Structural inference of African ethnic/linguistic origins from name patterns on ship manifests where home villages were never recorded.',
    'African embarkation regions',
    1808, 1862, 'ship_manifest', ARRAY['position'], 'web_query',
    'Inference-based recovery of ethnic clusters from ~95,000 captive name records. Methodology recovers ethnic groupings, not individual identities. Direct precedent for our trace_observations + linkage_candidates approach. See M060 eltis_african_origins_ethnic_inference methodology.',
    NULL
) ON CONFLICT (source_name) DO NOTHING;

INSERT INTO regional_source_registry
    (source_name, citation, jurisdiction_text, era_start, era_end, record_type, axis_role, access_method, coverage_notes, estimated_completeness)
VALUES (
    'hynson_dc_runaway_fugitive_cases',
    'Hynson, Jerry M. District of Columbia Runaway And Fugitive Slave Cases 1848-1863. Heritage Books, 1999. (Sourcing from Library of Congress; pending digitization.)',
    'District of Columbia',
    1848, 1863, 'custody_event', ARRAY['trajectory'], 'manual_lookup',
    'Custody/release events for fugitive enslaved persons (e.g., Patrick & Cato released to Henry Weaver 1849). Critical for the controlled_via_marriage / possessed slaveholding_relationship types — relationships without title that the standard ownership records miss. User sourcing physical copy from LoC; will register access_method=batch_export once digitized.',
    NULL
) ON CONFLICT (source_name) DO NOTHING;

INSERT INTO regional_source_registry
    (source_name, citation, jurisdiction_text, era_start, era_end, record_type, axis_role, access_method, coverage_notes, estimated_completeness)
VALUES (
    'maryland_state_archives_s1431',
    'Maryland State Archives, Series S1431 (personal-name index to deed/chancery libers). 2,554-page finding aid alphabetical by surname with Liber+folio pointers.',
    'Maryland (county-by-county; observed Prince George''s, Montgomery)',
    1700, 1900, 'deed', ARRAY['position'], 'pdf_index',
    'Finding aid pointing to primary-source deed and chancery libers. Each entry: surname, given name, role (Vendee/Grantee/Complainant), Liber+folio refs, date, county, occupation, lot/tract notes. Surfaces 70+ years of Biscoe transactions in Prince George''s alone. Not yet automated; surfaced via reviewer query when a participant lineage touches MD pre-1900.',
    NULL
) ON CONFLICT (source_name) DO NOTHING;

INSERT INTO regional_source_registry
    (source_name, citation, jurisdiction_text, era_start, era_end, record_type, axis_role, access_method, coverage_notes, estimated_completeness)
VALUES (
    'mdsa_sc2908_vol812',
    'Maryland State Archives, Special Collection 2908, Volume 812. 1864 Maryland Constitutional record of slaveholders by Montgomery County.',
    'Maryland, Montgomery County',
    1864, 1864, 'estate_record', ARRAY['position'], 'manual_lookup',
    'Single-volume snapshot of Montgomery County MD slaveholders at the time of the 1864 Maryland Constitution that abolished slavery in the state. Source for ~600 ungrounded enslavers backfilled in Stage 2.5. Compendium rows already cite this via mdsa_sc2908_vol812 in M053.',
    0.95
) ON CONFLICT (source_name) DO NOTHING;

INSERT INTO regional_source_registry
    (source_name, citation, jurisdiction_text, era_start, era_end, record_type, axis_role, access_method, coverage_notes, estimated_completeness)
VALUES (
    'dc_libers_deed_index',
    'District of Columbia Recorder of Deeds: Liber index covering land transactions, slave bills of sale, mortgages, manumissions. Cited inline in Glover Park History (Carlton Fletcher) and other secondary sources.',
    'District of Columbia',
    1800, 1900, 'deed', ARRAY['position','trajectory'], 'manual_lookup',
    'DC Liber JAS, AY, ECE etc. series. Citations appear in secondary sources (e.g., DC Liber AY49 (1820) ff.126 for Michael Weaver Beatty&Hawkins addition purchase). Not yet automated. Manual lookup per ancestor; reviewer-driven.',
    NULL
) ON CONFLICT (source_name) DO NOTHING;

INSERT INTO regional_source_registry
    (source_name, citation, jurisdiction_text, era_start, era_end, record_type, axis_role, access_method, coverage_notes, estimated_completeness)
VALUES (
    'us_census_slave_schedules_1850_1860',
    'United States Federal Census, Slave Schedules. 1850 and 1860 enumerations recording enslaved persons anonymized by age and sex per slaveholder.',
    'United States (slave states + DC)',
    1850, 1860, 'census', ARRAY['position'], 'batch_export',
    '1.68M unconfirmed_persons rows already ingested across pre_indexed + census_ocr_extraction + ocr_scrape paths. ~79.5% complete on scrapeable locations as of Mar 2026. Big gaps remaining: Virginia (285), Mississippi (162), Louisiana (155), Kentucky (101), Missouri (101). Source-of-truth tracker is familysearch_locations.scraped_at, NOT extraction_progress.',
    0.80
) ON CONFLICT (source_name) DO NOTHING;

INSERT INTO regional_source_registry
    (source_name, citation, jurisdiction_text, era_start, era_end, record_type, axis_role, access_method, coverage_notes, estimated_completeness)
VALUES (
    'freedmens_bank_records',
    'Freedmen''s Savings and Trust Company depositor records, 1865-1874. 28 branches, 200,000+ depositors. Reverse-engineered link from formerly-enslaved depositor to former-master via the depositor application form''s former-owner field.',
    'United States (28 Freedmen''s Bank branches)',
    1865, 1874, 'financial_account', ARRAY['position','trajectory'], 'batch_export',
    'Multi-branch scrape ~28 branches. Depositor form fields include former-master name, plantation, residence pre-emancipation. Critical for trace-linkage methodology (1860 anonymized → 1870 named freedperson under post-emancipation surname assumption). Branches with rich enslaver fields documented in memory-bank/project_freedmens_form_inventory.md. Bank corruption + branch reliability hierarchy in project_freedmens_bank_history.md.',
    0.65
) ON CONFLICT (source_name) DO NOTHING;

INSERT INTO regional_source_registry
    (source_name, citation, jurisdiction_text, era_start, era_end, record_type, axis_role, access_method, coverage_notes, estimated_completeness)
VALUES (
    'civilwardc_compensation_petitions',
    'civilwardc.org TEI corpus of 1862 District of Columbia Compensated Emancipation petitions. 1,041 petitions, 1,698 enslaved persons claimed, ~$352K total claimed.',
    'District of Columbia',
    1862, 1864, 'compensation_petition', ARRAY['position','trajectory'], 'batch_export',
    'Direct primary government compensation records — claimant is enslaver by document definition. 100% TEI ingested per project memory; populated historical_reparations_petitions (M041). 947 claimant_canonical_id rows already linked. Strong basis for many DC enslaver classifications (verification_status=civilwardc_primary_source).',
    0.95
) ON CONFLICT (source_name) DO NOTHING;

INSERT INTO regional_source_registry
    (source_name, citation, jurisdiction_text, era_start, era_end, record_type, axis_role, access_method, coverage_notes, estimated_completeness)
VALUES (
    'historical_reparations_petitions_table',
    'Internal: historical_reparations_petitions (M041) — generalized claimant table for civilwardc + analogous compensated-emancipation petitions.',
    'United States (currently DC; extensible)',
    1862, 1864, 'compensation_petition', ARRAY['position','trajectory'], 'batch_export',
    'Internal table holding civilwardc TEI ingest + extensible to other compensation programs. 1,041 rows, 947 claimant_canonical_id non-null. Already cited in compendium via historical_reparations_petitions_direct methodology row.',
    0.95
) ON CONFLICT (source_name) DO NOTHING;

INSERT INTO regional_source_registry
    (source_name, citation, jurisdiction_text, era_start, era_end, record_type, axis_role, access_method, coverage_notes, estimated_completeness)
VALUES (
    'louisiana_slave_database',
    'Louisiana Slave Database: state-aggregated transaction records (buyer, seller, year, location) for enslaved-person sales.',
    'Louisiana',
    1719, 1820, 'transaction_register', ARRAY['position','trajectory'], 'batch_export',
    '180,419 unconfirmed_persons rows already imported. Buyer/seller transactions by year are direct primary attestations of enslaver status. Already cited in compendium via louisiana_slave_db_transactions and louisiana_slave_db_1860_schedule_promotion patterns. Tier A.',
    0.75
) ON CONFLICT (source_name) DO NOTHING;

INSERT INTO regional_source_registry
    (source_name, citation, jurisdiction_text, era_start, era_end, record_type, axis_role, access_method, coverage_notes, estimated_completeness)
VALUES (
    'santos_brazil_enslaved_census',
    'Santos, Brazil enslaved census. Harvard Dataverse: doi:10.7910/DVN/GBDHNC.',
    'Brazil, Santos region',
    1872, 1888, 'census', ARRAY['position'], 'batch_export',
    'Brazilian regional census of enslaved persons. 3,649 canonical_persons promoted from this source per compendium notes pattern. Already integrated; tier A.',
    NULL
) ON CONFLICT (source_name) DO NOTHING;

INSERT INTO regional_source_registry
    (source_name, citation, jurisdiction_text, era_start, era_end, record_type, axis_role, access_method, coverage_notes, estimated_completeness)
VALUES (
    'natchez_district_probate',
    'Historic Natchez Enslaved Mississippians, Natchez District probate records. Hosted at Harvard.',
    'Mississippi, Natchez District',
    1750, 1865, 'probate', ARRAY['position'], 'batch_export',
    'Probate inventories naming enslaved persons in Natchez District estates. 713 enslavers grounded in M053 via natchez_district_probate pattern. Direct primary.',
    NULL
) ON CONFLICT (source_name) DO NOTHING;

INSERT INTO regional_source_registry
    (source_name, citation, jurisdiction_text, era_start, era_end, record_type, axis_role, access_method, coverage_notes, estimated_completeness)
VALUES (
    'book_of_negroes_1783_lac_carleton',
    'Book of Negroes (1783). Library and Archives Canada, Carleton Papers. Register of Black Loyalists who departed New York for Nova Scotia at the close of the Revolutionary War.',
    'British North America (departures from New York; arrivals in Nova Scotia and elsewhere)',
    1783, 1783, 'transaction_register', ARRAY['position','trajectory'], 'manual_lookup',
    'Single-year register of departures with named enslaved persons and their claimed slaveholders. 599 enslavers grounded in M053 via book_of_negroes_1783_lac_carleton pattern. Trajectory because each row records a movement (NYC departure to Nova Scotia or elsewhere).',
    0.95
) ON CONFLICT (source_name) DO NOTHING;

INSERT INTO regional_source_registry
    (source_name, citation, jurisdiction_text, era_start, era_end, record_type, axis_role, access_method, coverage_notes, estimated_completeness)
VALUES (
    'thomas_porcher_ravenel_papers',
    'Thomas Porcher Ravenel papers (manuscript collection). South Carolina personal/family papers documenting slave purchases, sales, and mortgages within the Ravenel family network.',
    'South Carolina',
    1750, 1865, 'estate_record', ARRAY['position','trajectory'], 'manual_lookup',
    'Family manuscript collection. Specific transactions documented (e.g., Stephen Ravenel purchased 6 enslaved persons from Daniel James Ravenel on 1804-01-30 for $700). 5 enslavers grounded in M053 via thomas_porcher_ravenel_papers pattern.',
    NULL
) ON CONFLICT (source_name) DO NOTHING;

INSERT INTO regional_source_registry
    (source_name, citation, jurisdiction_text, era_start, era_end, record_type, axis_role, access_method, coverage_notes, estimated_completeness)
VALUES (
    'ten_million_names_project',
    '10 Million Names Project, American Ancestors / New England Historic Genealogical Society. Initiative to identify the ~10M enslaved persons brought to the United States.',
    'United States',
    1619, 1865, 'digital_data_repository', ARRAY['position','trajectory'], 'web_query',
    'Active project (2023+) building the trace-database substrate for enslaved-person genealogy. Direct integration target as APIs become available. Methodology source for our trace_observations + linkage_candidates approach.',
    NULL
) ON CONFLICT (source_name) DO NOTHING;

INSERT INTO regional_source_registry
    (source_name, citation, jurisdiction_text, era_start, era_end, record_type, axis_role, access_method, coverage_notes, estimated_completeness)
VALUES (
    'glover_park_history_carlton_fletcher',
    'Fletcher, Carlton. Glover Park History: Historical Sketches of Glover Park, Upper Georgetown, and Georgetown Heights. https://gloverparkhistory.com',
    'District of Columbia, Georgetown / Glover Park',
    1700, 2000, 'narrative_history', ARRAY['position'], 'web_query',
    'Synthesizing secondary source citing primary sources (1865 Georgetown Assessments, William King Mortality Journal, DC Liber refs, Hynson 1999, Augusta Weaver Reminiscences ms HSW, Charles Weaver of White Haven 1937 ms HSW). Used in test cases (Henry Weaver 1893 cross-source enrichment). Not authoritative itself; pointer corpus to primary sources.',
    NULL
) ON CONFLICT (source_name) DO NOTHING;
