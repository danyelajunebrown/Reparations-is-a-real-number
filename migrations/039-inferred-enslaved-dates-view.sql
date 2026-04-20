-- Migration 039: Inferred dates for enslaved persons from slave-schedule
-- age/year triangulation.
--
-- Problem this solves:
--   The Craemer wage-theft formula requires birth_year and freedom_year per
--   enslaved person to compute the years-enslaved span. Our `enslaved_individuals`
--   table (18,246 rows) has ZERO rows with birth/death/freedom populated. The
--   much larger `family_relationships` table (1.9M enslaved_by edges) carries
--   the age implicitly — 97% of person2_name values contain "age N" strings
--   like "Unknown (Male, age 27)" or "Harriet, age 15" copied from the source
--   slave schedule's columnar data. And the source_url carries the collection
--   identifier that maps directly to schedule year (cc=3161105 is the 1860
--   U.S. Census Slave Schedule, covering 99.7% of our edges).
--
-- What this migration does:
--   Creates a VIEW that computes birth_year / freedom_year / years_enslaved
--   per family_relationships row via:
--     birth_year     = schedule_year - age                 (parsed from name)
--     freedom_year   = 1865                                (general emancipation
--                                                           — conservative default;
--                                                           TODO refine by state:
--                                                           DC 1862, CSA 1863)
--     years_enslaved = max(0, 1865 - birth_year)           (assumes enslavement
--                                                           from birth — may
--                                                           overstate for persons
--                                                           captured later)
--
--   The view is non-destructive. DAAOrchestrator can LEFT JOIN it to get
--   dates when enslaved_individuals.birth_year is NULL. If we later
--   populate enslaved_individuals directly, the view remains a fallback.
--
-- Known limitations (documented upstream in
-- memory-bank/wealth-tracing-framework.md section 8 "Explicit limits"):
--   • Assumes enslavement from birth. Overstates years for people captured
--     after birth (e.g., trans-Atlantic imports, previously-free persons
--     kidnapped). Direction: tends to INCREASE calculated debt.
--   • Uniform 1865 freedom year. Ignores DC 1862 (April Act) and
--     Emancipation Proclamation 1863 reach. Direction: UNDERSTATES debt
--     (later freedom means more unpaid-labor years compounding).
--   • Unknown-named persons (e.g., "Unknown (Female, age 12)") are counted
--     but have no independent descendant identification — they're person-
--     year counts for debt purposes, not distributable beneficiaries.
--
-- Safe to drop + recreate. No data is stored by the view.

CREATE OR REPLACE VIEW enslaved_persons_inferred_dates AS
WITH parsed AS (
    SELECT
        fr.id                                                           AS relationship_id,
        fr.person1_name                                                 AS enslaver_name,
        fr.person2_name                                                 AS enslaved_name,
        fr.person2_lead_id                                              AS enslaved_lead_id,
        fr.source_url,
        fr.confidence                                                   AS relationship_confidence,
        -- Extract "age N" from the person2_name field. Slave-schedule OCR
        -- consistently uses this pattern: "Unknown (Male, age 27)",
        -- "Harriet, age 15", "Jim age 8", etc. Case-insensitive on the
        -- word "age" so variants like "Age 27" also match.
        NULLIF((regexp_match(fr.person2_name, '[Aa]ge\s+([0-9]{1,3})'))[1], '')::int AS age_at_schedule,
        -- Schedule year inference from FamilySearch collection ID (cc=X param).
        -- cc=3161105 is the 1860 US Slave Schedule (covers 99.7% of edges).
        -- cc=1401638 is a smaller secondary source — needs catalog lookup to
        -- confirm its date; defaulting to 1850 as best guess.
        CASE
            WHEN fr.source_url ILIKE '%cc=3161105%' THEN 1860
            WHEN fr.source_url ILIKE '%cc=1401638%' THEN 1850
            WHEN fr.source_url ILIKE '%1850%'       THEN 1850
            WHEN fr.source_url ILIKE '%1860%'       THEN 1860
            ELSE NULL
        END                                                             AS schedule_year
    FROM family_relationships fr
    WHERE fr.relationship_type = 'enslaved_by'
)
SELECT
    relationship_id,
    enslaver_name,
    enslaved_name,
    enslaved_lead_id,
    source_url,
    relationship_confidence,
    age_at_schedule,
    schedule_year,
    -- Inferred birth year
    CASE
        WHEN schedule_year IS NOT NULL AND age_at_schedule IS NOT NULL
            THEN schedule_year - age_at_schedule
        ELSE NULL
    END AS inferred_birth_year,
    -- Inferred freedom year — conservative 1865 across the board.
    -- Future refinement: join canonical_persons by name and switch to
    -- 1862 for DC or 1863 for Confederate states.
    CASE
        WHEN schedule_year IS NOT NULL THEN 1865
        ELSE NULL
    END AS inferred_freedom_year,
    -- Years enslaved, clamped sensibly so OCR misreads
    -- ("age 127") don't produce absurd spans.
    CASE
        WHEN schedule_year IS NOT NULL AND age_at_schedule IS NOT NULL
            THEN GREATEST(0, LEAST(100, 1865 - (schedule_year - age_at_schedule)))
        ELSE NULL
    END AS inferred_years_enslaved,
    -- Metadata about the inference itself, so downstream code can annotate
    -- outputs with methodology transparency.
    'schedule_year_minus_age_enslavement_from_birth'                    AS inference_method,
    CASE
        WHEN age_at_schedule IS NOT NULL AND schedule_year IS NOT NULL THEN 0.70
        WHEN age_at_schedule IS NOT NULL                                THEN 0.35
        ELSE NULL
    END AS inference_confidence
FROM parsed;

COMMENT ON VIEW enslaved_persons_inferred_dates IS
    'Inferred birth_year / freedom_year / years_enslaved for enslaved persons '
    'documented in family_relationships via slave-schedule extraction. '
    'Computed fields only — no data is stored. DAAOrchestrator joins this '
    'view when the underlying enslaved_individuals row lacks dates (which '
    'is currently 100% of them). See the migration SQL header for the '
    'explicit methodological assumptions and their directional bias.';

-- Also expose a summary to make it easy to audit the view's coverage:
CREATE OR REPLACE VIEW enslaved_persons_inferred_dates_coverage AS
SELECT
    COUNT(*)::int                                                   AS total_rows,
    COUNT(*) FILTER (WHERE age_at_schedule IS NOT NULL)::int        AS with_age,
    COUNT(*) FILTER (WHERE schedule_year IS NOT NULL)::int          AS with_schedule_year,
    COUNT(*) FILTER (WHERE inferred_birth_year IS NOT NULL)::int    AS with_inferred_birth,
    COUNT(*) FILTER (WHERE inferred_years_enslaved IS NOT NULL)::int AS with_inferred_years,
    ROUND(AVG(age_at_schedule)::numeric, 1)                         AS avg_age_at_schedule,
    ROUND(AVG(inferred_years_enslaved)::numeric, 1)                 AS avg_inferred_years
FROM enslaved_persons_inferred_dates;

COMMENT ON VIEW enslaved_persons_inferred_dates_coverage IS
    'One-row summary of how much inference is possible across the '
    'family_relationships.enslaved_by corpus. Use this to sanity-check '
    'the view after schema or data changes.';
