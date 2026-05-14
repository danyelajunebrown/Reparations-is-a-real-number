-- Migration 068: compilation source tracking + Hynson books
-- Date: 2026-05-14
--
-- Three changes in this migration:
--
-- 1. Add compilation-tracking columns to regional_source_registry so that
--    sources that are compendiums of handwritten originals are declared as
--    such, with a machine-enforced max_evidence_tier ceiling.
--
-- 2. Add verification-tracking columns to enslaver_evidence_compendium so
--    that evidence rows derived from compilations can track their path
--    toward the underlying original.
--
-- 3. Register the Hynson DC Runaway and Fugitive Slave Cases books (both
--    1848–1863 and the 1862–1863 subset) with correct compilation flags,
--    and add the methodology row for Hynson-compiled evidence.
--
-- Methodology: evidence_strength in enslaver_evidence_compendium for any
-- row whose methodology_id resolves to a Hynson methodology row is capped
-- at 'secondary' (ICHEIC Tier C) by the application layer. It may only be
-- upgraded to 'indirect_primary' (Tier B) when verification_status is set
-- to 'original_located' or 'original_verified' by a researcher who has
-- independently consulted the NARA RG 21 originals.

-- ── 1. regional_source_registry: add compilation columns ─────────────────────

ALTER TABLE regional_source_registry
    ADD COLUMN IF NOT EXISTS is_compilation BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE regional_source_registry
    ADD COLUMN IF NOT EXISTS compiles_from_description TEXT;

ALTER TABLE regional_source_registry
    ADD COLUMN IF NOT EXISTS original_location_text TEXT;

ALTER TABLE regional_source_registry
    ADD COLUMN IF NOT EXISTS max_evidence_tier TEXT
        CHECK (max_evidence_tier IS NULL OR max_evidence_tier IN (
            'direct_primary', 'indirect_primary', 'secondary', 'inferred'
        ));

COMMENT ON COLUMN regional_source_registry.is_compilation IS
    'TRUE when this source is a secondary compilation (e.g., Heritage Books '
    'transcription of court records) rather than the original document itself.';

COMMENT ON COLUMN regional_source_registry.compiles_from_description IS
    'Free-text description of the primary source stream the compiler drew from. '
    'E.g. "NARA RG 21, DC Circuit Court Criminal Minutes, 1848-1863".';

COMMENT ON COLUMN regional_source_registry.original_location_text IS
    'Institution and call number (or URL) where the underlying originals live. '
    'Used to guide researcher verification.';

COMMENT ON COLUMN regional_source_registry.max_evidence_tier IS
    'Ceiling evidence_strength that evidence rows citing this source may carry '
    'without explicit reviewer override. Compilation sources cap at secondary '
    'until the underlying original is located and verified.';

-- ── 2. enslaver_evidence_compendium: add verification columns ────────────────

ALTER TABLE enslaver_evidence_compendium
    ADD COLUMN IF NOT EXISTS original_document_location TEXT;

ALTER TABLE enslaver_evidence_compendium
    ADD COLUMN IF NOT EXISTS verification_status TEXT
        NOT NULL DEFAULT 'not_applicable'
        CHECK (verification_status IN (
            'not_applicable',          -- evidence is from a direct primary; no compilation chain
            'unverified_compilation',  -- Tier C ceiling: from a compilation, original not yet sought
            'original_sought_not_found', -- tried to locate original; not available or digitized
            'original_located',        -- original found; URL or call number in original_document_location
            'original_verified'        -- original examined and confirms this claim → eligible for Tier B upgrade
        ));

COMMENT ON COLUMN enslaver_evidence_compendium.original_document_location IS
    'When evidence comes from a compilation source, the NARA call number, '
    'Ancestry.com URL, or institution reference for the underlying original. '
    'Set when verification_status reaches original_located or original_verified.';

COMMENT ON COLUMN enslaver_evidence_compendium.verification_status IS
    'Tracks progress toward verifying the underlying original when evidence '
    'derives from a compilation (is_compilation=TRUE in regional_source_registry). '
    'Governs whether the tier ceiling from max_evidence_tier can be lifted.';

-- ── 3a. Update existing Hynson entry ─────────────────────────────────────────

UPDATE regional_source_registry SET
    is_compilation             = TRUE,
    record_type                = 'court_record',
    compiles_from_description  = 'NARA, RG 21, Records of the District Courts of the United States: '
                                 'DC Circuit Court Criminal Minutes (runaway ordinance arrests) and '
                                 'US Commissioner hearings under the Fugitive Slave Act of 1850. '
                                 'Also incorporates DC Jail commitment and release log entries.',
    original_location_text     = 'National Archives Building, Washington DC. Record Group 21. '
                                 'Partially digitized on Ancestry.com as "Washington DC Criminal '
                                 'Courts Records 1838-1963".',
    max_evidence_tier          = 'secondary',
    coverage_notes             = 'Heritage Books 1999 printed compilation by Jerry M. Hynson of DC '
                                 'Circuit Court custody records 1848-1863. Covers: (1) runaway arrests '
                                 'under local ordinance, (2) Fugitive Slave Act Commissioner hearings '
                                 '1850-1862, (3) DC Jail commitments and releases. Claimant field '
                                 'records claimed owner, not court-adjudicated title — relationship_type '
                                 'must be possessed not owned. Selection criteria not fully documented '
                                 'by compiler; some cases may be omitted. Transcription errors possible '
                                 'especially in name spellings. Original handwritten records at NARA '
                                 'RG 21. NOT authoritative itself; pointer corpus to NARA originals.'
WHERE source_name = 'hynson_dc_runaway_fugitive_cases';

-- ── 3b. Register second Hynson book (Fugitive Slave Cases 1862-1863) ─────────

INSERT INTO regional_source_registry
    (source_name, citation, jurisdiction_text, era_start, era_end,
     record_type, axis_role, access_method, coverage_notes,
     estimated_completeness, is_compilation, compiles_from_description,
     original_location_text, max_evidence_tier)
VALUES (
    'hynson_dc_fugitive_slave_cases_1862_1863',
    'Hynson, Jerry M. District of Columbia Fugitive Slave Cases, 1862-1863. '
    'Heritage Books, Inc. (Heritage Books Transcriptions). '
    'Covers the transitional period from January 1862 through the end of '
    'the DC Compensated Emancipation Act implementation period.',
    'District of Columbia',
    1862, 1863,
    'court_record',
    ARRAY['trajectory'],
    'manual_lookup',
    'Heritage Books printed compilation covering DC Fugitive Slave Act '
    'Commissioner hearings in the transitional period. Pre-April 16 1862 '
    'cases are standard Fugitive Slave Act claims identical in format to '
    'the 1848-1863 volume. Post-April 16 1862 cases involve claimants from '
    'Maryland and Virginia asserting ownership of persons found in DC after '
    'DC emancipation — these cross-reference productively with civilwardc '
    'compensation petitions: any claimant appearing in BOTH sources receives '
    'Tier A (petition) + Tier C (Hynson) compendium corroboration. '
    'Claimant field records claim, not court-adjudicated title. '
    'Originals at NARA RG 21. NOT authoritative itself.',
    NULL,
    TRUE,
    'NARA, RG 21, DC Circuit Court records and US Commissioner Fugitive Slave '
    'Act hearing records, 1862-1863. DC Jail records for the same period.',
    'National Archives Building, Washington DC. Record Group 21. '
    'Partially digitized on Ancestry.com as "Washington DC Criminal '
    'Courts Records 1838-1963".',
    'secondary'
) ON CONFLICT (source_name) DO NOTHING;

-- ── 3c. Update MSA S1431 finding aid to declare it is a finding aid ───────────

UPDATE regional_source_registry SET
    is_compilation             = TRUE,
    compiles_from_description  = 'Personal-name index to deed and chancery libers in Maryland county '
                                 'court records. Each entry points to a Liber+folio in the original '
                                 'deed or chancery record series. The finding aid itself is secondary; '
                                 'the Libers are the primary source.',
    original_location_text     = 'Maryland State Archives, Annapolis. Deed and chancery libers '
                                 'accessible via mdsa.net by county and liber reference.',
    max_evidence_tier          = 'secondary'
WHERE source_name = 'maryland_state_archives_s1431';

-- ── 3d. Update Glover Park History to reinforce its secondary status ──────────
-- (Already has correct record_type = 'narrative_history'; adding formal flag.)

UPDATE regional_source_registry SET
    is_compilation             = TRUE,
    compiles_from_description  = 'Secondary narrative citing: 1865 Georgetown Assessments, '
                                 'William King Mortality Journal, DC Liber refs (JAS, AY, ECE series), '
                                 'Hynson 1999, Augusta Weaver Reminiscences ms (HSW), '
                                 'Charles Weaver of White Haven 1937 ms (HSW).',
    original_location_text     = 'Historical Society of Washington DC (HSW) for manuscript sources; '
                                 'DC Recorder of Deeds for Liber series; NARA for King journal.',
    max_evidence_tier          = 'secondary'
WHERE source_name = 'glover_park_history_carlton_fletcher';

-- ── 4. Methodology row for Hynson-compiled evidence ──────────────────────────

INSERT INTO estimation_methodology_registry
    (name, version, description, role_tags, assumptions_jsonb, citations, known_failure_modes)
VALUES (
    'hynson_dc_runaway_fugitive_cases_compilation',
    '1.0.0',
    'Evidence derived from the Hynson 1999 Heritage Books compilations of DC '
    'Circuit Court custody records (1848-1863 and 1862-1863 volumes). These are '
    'printed transcriptions of NARA RG 21 handwritten originals. Evidence tier '
    'is Tier C (secondary) because the immediate source is the compiler''s '
    'transcription, not the original court record. The relationship_type for '
    'all Hynson-derived slaveholding_relationships rows must be possessed (not '
    'owned): the court record documents a custody custody claim, not '
    'adjudicated title. Max tier upgrades to indirect_primary (Tier B) only '
    'when verification_status is set to original_located or original_verified '
    'after independent consultation of the NARA RG 21 originals. '
    'Cross-reference with civilwardc_compensation_petitions for the 1862 '
    'overlap period: any claimant in both sources gains Tier A corroboration '
    'from the petition independently of the Hynson Tier C row.',
    ARRAY['legacy_source_acknowledgment', 'evidence_strength', 'compilation_source'],
    '{
        "source_form": "printed_compilation",
        "compiler": "Hynson, Jerry M.",
        "publisher": "Heritage Books Inc., 1999",
        "underlying_originals": "NARA RG 21, DC Circuit Court Criminal Minutes and US Commissioner FSA hearings",
        "tier": "C",
        "max_tier_without_override": "secondary",
        "relationship_type_required": "possessed",
        "upgrade_path": "set verification_status=original_located in enslaver_evidence_compendium after consulting NARA RG 21"
    }'::jsonb,
    'Hynson, Jerry M. District of Columbia Runaway and Fugitive Slave Cases, '
    '1848-1863. Heritage Books, Inc., 1999. '
    'Hynson, Jerry M. District of Columbia Fugitive Slave Cases, 1862-1863. '
    'Heritage Books, Inc. '
    'NARA, Record Group 21, Records of the District Courts of the United States '
    '(DC Circuit), National Archives Building, Washington DC.',
    'Compiler selection criteria not fully documented — some cases may be omitted. '
    'Transcription errors possible, especially in name spellings and dates. '
    'Claimant field records claim not court-adjudicated title; do not infer '
    'ownership (relationship_type=owned) from these records. '
    'Post-April 16 1862 cases in the second volume involve interstate claimants '
    'whose enslavement documentation is outside DC jurisdiction.'
) ON CONFLICT (name, version) DO NOTHING;

-- ── 5. FK: wire methodology to enslaver_evidence_compendium (already exists
--    from M060 ALTER; just confirming the column is present) ─────────────────
-- No action needed — FK was added in M060.

COMMENT ON TABLE regional_source_registry IS
    'Dual-axis registry of horizontal data sources (position vs trajectory). '
    'is_compilation=TRUE flags sources that are secondary compilations of '
    'handwritten originals; max_evidence_tier enforces the ceiling that '
    'application-layer compiler services must respect. '
    'Per plan-apr29 §3.6 and Eltis JSDP 2021 methodology.';
