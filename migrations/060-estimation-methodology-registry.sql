-- Migration 060: estimation_methodology_registry
-- Date: 2026-04-29
--
-- Per memory-bank/plan-apr29-will-source-registry-dual-ledger-daa.md §2.M060
-- and §8.3 (methodology stack analysis).
--
-- Versioned registry of every estimation/inference/valuation methodology
-- the system uses. Every inferred row in slaveholding_relationships (M052),
-- estate_valuations (M049), trace_observations (M058, future),
-- linkage_candidates (M059, future), and DAA estimated-ledger events MUST
-- cite a row from this table.
--
-- Methodology stack per plan §8.3:
--   Per-event valuation:    Berry (life-stage), Darity-Mullen (fallback),
--                           Brattle/CARICOM (hours-based)
--   Compounding forward:    Brattle 3% real (default), Darity-Mullen 4%
--                           nominal (alternative)
--   Population sanity check: Darity-Mullen $11.2T / 40M
--   Evidence tiering:       ICHEIC-adapted (Tier A/B/C/D)
--   Trace linkage:          1850-1870 surname assumption,
--                           ship-manifest age-cohort,
--                           Freedmens Bureau labor contract kinship,
--                           Eltis African-Origins ethnic inference
--
-- Note: each seed row is its own INSERT statement (one statement per row)
-- because the migration runner uses a naive semicolon splitter that
-- mis-handles multi-row VALUES blocks. Idempotency via UNIQUE(name,version)
-- + ON CONFLICT DO NOTHING means re-runs are safe.

CREATE TABLE IF NOT EXISTS estimation_methodology_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT '1.0.0',
    description TEXT NOT NULL,
    role_tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    assumptions_jsonb JSONB NOT NULL DEFAULT '{}'::jsonb,
    citations TEXT NOT NULL,
    known_failure_modes TEXT,
    introduced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deprecated_at TIMESTAMPTZ,
    superseded_by_id UUID REFERENCES estimation_methodology_registry(id),
    UNIQUE (name, version)
);

CREATE INDEX IF NOT EXISTS idx_estimation_methodology_name ON estimation_methodology_registry(name);

CREATE INDEX IF NOT EXISTS idx_estimation_methodology_active ON estimation_methodology_registry(name, version) WHERE deprecated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_estimation_methodology_role_tags ON estimation_methodology_registry USING GIN (role_tags);

INSERT INTO estimation_methodology_registry (name, version, description, role_tags, assumptions_jsonb, citations, known_failure_modes) VALUES ('berry_lifecycle_valuation', '1.0.0', 'Per-event valuation of enslaved persons using documented life-stage market values from estate inventories, insurance valuations, and tax appraisals. Highest precision when the source document carries person + age + price together.', ARRAY['per_event_valuation'], '{"requires_age_at_event": true, "requires_documented_price_or_appraisal": true, "currency_year_assumed_to_match_document": true}'::jsonb, 'Berry, Daina Ramey. The Price for Their Pound of Flesh: The Value of the Enslaved, from Womb to Grave, in the Building of a Nation. Beacon Press, 2017.', 'Not applicable when life-stage data is absent from the source. Use darity_mullen_stolen_labor_fallback instead.') ON CONFLICT (name, version) DO NOTHING;

INSERT INTO estimation_methodology_registry (name, version, description, role_tags, assumptions_jsonb, citations, known_failure_modes) VALUES ('darity_mullen_stolen_labor_fallback', '1.0.0', 'Fallback per-event valuation: stolen-labor-per-year estimates derived from Darity-Mullen From Here to Equality (2nd ed., 2022) when an enslavement is documented but no Berry-grade per-event price exists. Lower precision than Berry; assumed where Berry-grade data is absent.', ARRAY['per_event_valuation'], '{"applies_when_berry_unavailable": true, "uses_population_average_labor_value": true}'::jsonb, 'Darity Jr., William A. and A. Kirsten Mullen. From Here to Equality: Reparations for Black Americans in the Twenty-First Century. 2nd ed. University of North Carolina Press, 2022.', 'Population average will systematically under- or over-estimate individual cases. Use Berry where life-stage data exists.') ON CONFLICT (name, version) DO NOTHING;

INSERT INTO estimation_methodology_registry (name, version, description, role_tags, assumptions_jsonb, citations, known_failure_modes) VALUES ('brattle_caricom_hours_wage_foregone', '1.0.0', 'Per-event valuation for hours-based claims: hours times wage-foregone, as in the Brattle Group reports for the CARICOM Reparations Commission. Used where labor-hours can be inferred from production records, plantation logs, or labor contracts.', ARRAY['per_event_valuation'], '{"requires_hours_inference": true, "wage_basis": "free_labor_market_rate_at_locality_and_era"}'::jsonb, 'Brattle Group reports for CARICOM Reparations Commission (various years). Adapted methodology used in slavery and forced-labor reparations claims literature.', 'Hours inference from production records can carry large uncertainty in pre-industrial agriculture. Pair with explicit confidence bounds.') ON CONFLICT (name, version) DO NOTHING;

INSERT INTO estimation_methodology_registry (name, version, description, role_tags, assumptions_jsonb, citations, known_failure_modes) VALUES ('brattle_compound_3pct_real', '1.0.0', 'Default compounding methodology for documented ledger: 3 percent real per year, conservative. ~50x multiplier over 150 years. Documented numbers should be defensible from below; we surface the alternative higher rate as a participant-requestable variant.', ARRAY['compounding_forward'], '{"rate_type": "real", "rate_pct": 3.0, "compounding_basis": "annual"}'::jsonb, 'Brattle Group reports for CARICOM Reparations Commission. Long-bond real-yield-based compounding, conservative.', 'A real rate ignores nominal-vs-real distinctions; for participant-facing display we still convert to current-year dollars via separate inflation series.') ON CONFLICT (name, version) DO NOTHING;

INSERT INTO estimation_methodology_registry (name, version, description, role_tags, assumptions_jsonb, citations, known_failure_modes) VALUES ('darity_mullen_compound_4pct_nominal', '1.0.0', 'Alternative compounding methodology: 4 percent nominal per year, higher multiplier (~150x over 150 years). Available as participant-requestable variant alongside the conservative Brattle 3 percent real default.', ARRAY['compounding_forward'], '{"rate_type": "nominal", "rate_pct": 4.0, "compounding_basis": "annual"}'::jsonb, 'Darity Jr., William A. and A. Kirsten Mullen. From Here to Equality (2nd ed., 2022).', 'Nominal rate confounds inflation and real return. Use only when explicitly comparing to Darity-Mullen aggregate figures.') ON CONFLICT (name, version) DO NOTHING;

INSERT INTO estimation_methodology_registry (name, version, description, role_tags, assumptions_jsonb, citations, known_failure_modes) VALUES ('darity_mullen_aggregate_sanity_check', '1.0.0', 'Population-level sanity check: Darity-Mullen 11.2 trillion (2020 dollars) divided by ~40 million eligible AADOS (American Descendants of Slavery), implying ~280K USD per person. Used as aggregate-level "is our system in the right order of magnitude" check, NOT a per-participant claim.', ARRAY['population_sanity_check'], '{"aggregate_total_2020_usd_trillions": 11.2, "eligible_population_millions": 40, "per_person_implied_usd": 280000}'::jsonb, 'Darity Jr., William A. and A. Kirsten Mullen. From Here to Equality (2nd ed., 2022).', 'Per-person implied figure is NOT a payment claim — it is a distributional sanity check at the system aggregate level only.') ON CONFLICT (name, version) DO NOTHING;

INSERT INTO estimation_methodology_registry (name, version, description, role_tags, assumptions_jsonb, citations, known_failure_modes) VALUES ('icheic_evidence_tier_adaptation', '1.0.0', 'Evidence-tier structure adapted from the International Commission on Holocaust Era Insurance Claims (ICHEIC) Holocaust Victim Asset Recovery framework. Tier A: direct primary document. Tier B: corroborated primary. Tier C: secondary, kin testimony, indirect. Tier D: methodology-derived inference. Maps to evidence_strength enum and gates DAA confidence bounds per tier.', ARRAY['evidence_strength', 'confidence_bound_gating'], '{"tier_A": "direct_primary", "tier_B": "indirect_primary", "tier_C": "secondary", "tier_D": "inferred", "tier_to_confidence_default": {"A": [0.95,1.0], "B": [0.75,0.95], "C": [0.4,0.75], "D": [0.1,0.4]}}'::jsonb, 'International Commission on Holocaust Era Insurance Claims (ICHEIC) and successor settlements. Adapted to U.S. slavery accountability context.', 'Tier-to-confidence default ranges are heuristic; specific evidence rows may carry tighter or wider bounds set by the compiler.') ON CONFLICT (name, version) DO NOTHING;

INSERT INTO estimation_methodology_registry (name, version, description, role_tags, assumptions_jsonb, citations, known_failure_modes) VALUES ('linkage_1850_to_1870_surname_assumption', '1.0.0', 'Trace linkage methodology: connect anonymized 1850/1860 slave-schedule observations (age + sex + plantation) to named 1870 census freedperson observations under the post-emancipation surname assumption (formerly enslaved persons commonly took former master surnames). Fragile; requires same county + plausible age increment + sex match + same household/property.', ARRAY['trace_linkage'], '{"requires_county_match": true, "requires_age_increment_within_3y": true, "requires_sex_match": true, "surname_assumption_basis": "post_emancipation_master_surname_pattern"}'::jsonb, 'Adapted from genealogy methodology literature; specific citation forthcoming. Related: 10 Million Names Project methodology (American Ancestors, 2023+).', 'Surname assumption fails for many enslaved persons who took different surnames or never had documented ones. Multiple candidates expected per trace; reviewer arbitrates.') ON CONFLICT (name, version) DO NOTHING;

INSERT INTO estimation_methodology_registry (name, version, description, role_tags, assumptions_jsonb, citations, known_failure_modes) VALUES ('linkage_ship_manifest_age_cohort', '1.0.0', 'Trace linkage methodology: connect ship-manifest enumerated captives (often by age and number, not name) to disembarkation port arrivals using age cohort + voyage date + arrival port + count consistency.', ARRAY['trace_linkage'], '{"requires_voyage_date_match": true, "requires_age_cohort_consistency": true, "uses_eltis_voyage_database": true}'::jsonb, 'Eltis, David. The Trans-Atlantic Slave Trade Database (2021 article); SlaveVoyages.org methodology.', 'Voyage records frequently anonymize captives; this methodology connects voyage-level cohorts to disembarkation events but rarely connects to specific named individuals downstream.') ON CONFLICT (name, version) DO NOTHING;

INSERT INTO estimation_methodology_registry (name, version, description, role_tags, assumptions_jsonb, citations, known_failure_modes) VALUES ('linkage_freedmens_bureau_kinship_inference', '1.0.0', 'Trace linkage methodology: kinship inference from cohabitation patterns in Freedmens Bureau labor contracts and marriage records. Recovers parent-child and sibling relationships that pre-1870 slave schedules systematically erase.', ARRAY['trace_linkage', 'kinship_inference'], '{"requires_freedmens_bureau_contract_or_marriage_record": true, "uses_household_cohabitation_signal": true}'::jsonb, 'Freedmens Bureau records (NARA M1875 et al.); Schermerhorn, Calvin. Money Over Mastery, Family Over Freedom (2011).', 'Cohabitation does not always imply kinship; reviewer-gated.') ON CONFLICT (name, version) DO NOTHING;

INSERT INTO estimation_methodology_registry (name, version, description, role_tags, assumptions_jsonb, citations, known_failure_modes) VALUES ('eltis_african_origins_ethnic_inference', '1.0.0', 'Structural inference of African ethnic/linguistic origins from name patterns and linguistic analysis on ship manifests where captives actual home villages were never recorded. The exemplar of structural inference from sparse data; methodology directly transferable to other trace-data domains.', ARRAY['ethnic_origin_inference', 'trace_linkage'], '{"input_signal": "captive_names_on_ship_manifests", "uses_african_linguistic_corpus": true}'::jsonb, 'Eltis, David et al. African-Origins.org project; SlaveVoyages methodology suite.', 'Names recorded on manifests were often imposed by captors and may not reflect African names. Methodology recovers ethnic clusters, not individual identities.') ON CONFLICT (name, version) DO NOTHING;

ALTER TABLE estate_valuations ADD CONSTRAINT fk_estate_valuations_methodology FOREIGN KEY (methodology_id) REFERENCES estimation_methodology_registry(id) ON DELETE SET NULL;

ALTER TABLE slaveholding_relationships ADD CONSTRAINT fk_slaveholding_relationships_methodology FOREIGN KEY (methodology_id) REFERENCES estimation_methodology_registry(id) ON DELETE SET NULL;

ALTER TABLE enslaver_evidence_compendium ADD CONSTRAINT fk_enslaver_evidence_compendium_methodology FOREIGN KEY (methodology_id) REFERENCES estimation_methodology_registry(id) ON DELETE SET NULL;

COMMENT ON TABLE estimation_methodology_registry IS 'Versioned registry of estimation/inference/valuation methodologies. Every inferred row in M049, M052, M053, M058, M059 must cite a row here. Default stack per plan-apr29 §8.3.';
