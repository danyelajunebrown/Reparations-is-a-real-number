# Consolidated Plan — Will Ingestion + Source Registry + Dual-Ledger DAA

**Date**: 2026-04-29
**Status**: Plan, pending final user review before code/migrations
**Supersedes**: all prior partial plans from this session

This document consolidates a multi-turn architectural conversation that produced several corrections to my initial framings. It is the artifact for review *before* I write migrations or services. If anything below is wrong, fix it here — not in code.

---

## 0. Reading Frame

Three load-bearing source readings shape every section below.

**Tolbert (2025), *Synthese* — "An epistemic argument for reparations"**
Forward-looking-only: reparations as intervention create post-repair conditions where causal inference about race becomes valid. Pre-repair counterfactual ("what would Adrian's family wealth be without slavery?") is **structurally unanswerable from current data** in his framing. Argument is methodological, not normative — he does not propose a repair amount.
**Implication**: DAA values are *documentary accounting*, not causal estimates. Tolbert is cited as meta-justification for why this work matters for future epistemology, **not** as a coverage metric on this work's outputs. Drop the "positivity coverage score" I earlier proposed — it doesn't correspond to anything Tolbert's argument supports.

**Tolbert (2024), *Philosophy of Science* — "Causal Agnosticism about Race"**
Race is an ambiguous macrovariable in the Sen-Wasow "bundle of sticks" sense — constitutive of microvariables (specific ancestry, immigration history, wealth, neighborhood, dialect, religion, region of origin). Disaggregated microvariables are more stable than the macrovariable. The "Black" category aggregates a recent Nigerian immigrant and a U.S. descendant of enslaved Africans into one cell, masking causally distinct trajectories.
**Implication**: no `participant.race` field driving DAA logic. Aggregate over typed ancestor-level documented events. This validates the per-event microvariable architecture committed to elsewhere in this plan.

**Eltis (2021), *JSDP* — "The Trans-Atlantic Slave Trade Database"**
Voyage-as-canonical-entity ontology. 258 variables in 7 categories. Per-row source citations. Minimum-row inclusion criteria. Coverage estimates published with downloadable derivations. Controlled document-type vocabulary. Versioned releases with prior versions accessible.
**Implication**: schema patterns for `regional_source_registry`, `slaveholding_relationships`, and DAA emissions adopt these conventions verbatim where they fit.

### User-supplied corrections that bind this plan

- **Adrian's case** (mixed-heritage participant): both ledgers — documented theft from Black ancestral lines AND documented benefit/inheritance from white ancestral lines — are in his own tree. The DAA must surface both transparently and never collapse them. Statistically common, not edge case.
- **Documentary asymmetry**: for participants descending largely from slavery, the documentary record is intentionally destroyed or never created. Trace data + linkage candidates + estimation methodology are **first-class architecture**, not edge-case retrofit.
- **Henry Weaver occlusion lesson**: never write "no enslaved found" as a closing claim from a single document. His will mentions zero enslaved persons; cross-source enrichment finds 1862 DC compensation petition (Jane Johnson), 1849 Hynson custody record (Patrick & Cato), and inheritance chain via wife's prior husband (Basil Barnes 1845 estate → 5 enslaved persons brought into Weaver household via marriage). Cross-source enrichment is mandatory before any classification.

---

## 1. Core Commitments

These bind every design choice below. If a proposed design violates any of these, it's wrong.

1. **No causal claims about race.** DAA is documentation, not causal inference about race-as-cause.
2. **No `participant.race` field driving logic.** Race aggregates microvariables; we model microvariables directly per ancestor.
3. **No "not-an-enslaver" classification from a single document.** Only additive evidence rows. Classification is a deterministic rollup over the compendium.
4. **Dual-ledger DAA per participant**: documented + estimated, surfaced separately, never collapsed.
5. **Trace data is data.** Anonymous and fragmentary records get first-class storage with provenance.
6. **Per-row provenance, per-claim citation.** Eltis pattern.
7. **Versioned outputs.** DAA emissions are dated, reference registry version, reproducible.
8. **Cross-source enrichment is mandatory.** Compendium runs before any classification or DAA emission.
9. **Source registry is dual-axis**: position sources (who-was-where-when) and trajectory sources (movements between).
10. **Tolbert as meta-justification, not metric.** No positivity-coverage score on DAA outputs.

---

## 2. Migrations (M048–M060)

Schemas are skeletons sufficient for review; final SQL produced when each migration is written. All migrations apply via existing `scripts/apply-migrations.js` and register in `schema_migrations` (M047).

### M048 — `will_extractions`
Composite-document extractions; raw OCR + structured fields + reviewer state.
```
id (uuid pk), document_id (fk person_documents),
canonical_person_id (fk canonical_persons, nullable until linked),
participant_id (fk participants, nullable),
raw_pages_jsonb,                 -- per-page OCR text + page-type classification
structured_extraction_jsonb,     -- WillExtraction typed payload (see §4)
extractor_version,
status enum('extracted','review_in_progress','review_complete','rejected'),
reviewed_at, reviewed_by,
review_notes,
created_at, updated_at
```

### M049 — `estate_valuations`
Testator-level wealth at death, separate from M011/M041 govt compensation.
```
id, canonical_person_id (fk),
source_will_extraction_id (fk M048, nullable),
source_other_id (text, source-typed),
total_estate_value_cents bigint,
currency_year int,                -- year for which dollar values apply
breakdown_jsonb,                   -- {real_property, personal_property, monetary, debts}
methodology_id (fk M060),
confidence_low, confidence_high,   -- Eltis-style uncertainty bound
created_at
```

### M050 — `trust_instruments`
Multi-generational asset shielding; e.g., Biscoe trust ("sole and separate use… shielded from any husband she may marry").
```
id, source_will_extraction_id (fk M048),
testator_canonical_id, trustee_canonical_id, beneficiary_canonical_id,
trust_type enum('life_estate','separate_use_trust','spendthrift','simple_remainder','other'),
shielded_from_text,                -- the explicit shielding clause if present
shielded_assets_jsonb,             -- ids/refs to enslaved/property/monetary
date_established, date_terminated,
provenance_jsonb,
created_at
```

### M051 — `social_network_edges`
Witnesses, executors, registrars, neighbors named in wills/deeds. **Role-typed; never auto-promoted to enslaver.**
```
id, person_a_canonical_id, person_b_canonical_id,
edge_type enum('witnessed','executor_of','attested','co_signed','neighbor_of','named_in_document'),
context_document_id, context_event_date,
provenance_jsonb,
created_at
```

### M052 — `slaveholding_relationships`
Typed enslaver↔enslaved relationships. Replaces `family_relationships(enslaved_by)` for nuanced cases without removing it. **Critical — closes the Henry Weaver gap.**
```
id, enslaver_canonical_id, enslaved_individual_id (or unconfirmed_persons_id),
relationship_type enum(
  'owned',                         -- title
  'possessed',                     -- custody w/o title (Patrick/Cato → Weaver via Hynson)
  'harbored',                      -- fugitive harboring
  'hired',                         -- hired-out
  'used',                          -- working without title
  'controlled_via_marriage',       -- Henry Weaver over Mary Ann's brought-in enslaved
  'controlled_via_stepfamily',     -- Henry Weaver over stepchildren's inherited enslaved
  'profited_from'                  -- e.g., insurance, sale commission
),
date_window_start, date_window_end,
place_id (fk places or text),
evidence_source_table, evidence_source_id,
methodology_id (fk M060, for inferred relationships),
confidence_low, confidence_high,
notes,
created_at
```
**Inclusion gate (Eltis pattern)**: row requires `(date_window OR era_inferred) + relationship_type + place + at-least-one-source-citation`. Below this threshold no row, even if a name appears.

### M053 — `enslaver_evidence_compendium`
Per-canonical-person aggregate of every evidence claim, additive-only.
```
id, canonical_person_id,
evidence_source_table,             -- civilwardc_petitions, slaveholding_relationships, etc.
evidence_source_id,
evidence_strength enum('direct_primary','indirect_primary','secondary','inferred'),
claim_summary,
ingested_at,
methodology_id (fk M060)
```
Drives `canonical_persons.person_type` via deterministic rollup. **No row may be retracted; corrections are new rows.**

### M054 — `inheritance_chains`
Multi-step transmission of enslaved persons across estates.
Example: Basil Barnes (d.1845) → Horatio Barnes → Mary Ann's children → Henry Weaver's household.
```
id, chain_id (uuid groups all hops in one chain),
hop_order int,
transmitter_canonical_id, recipient_canonical_id,
enslaved_individuals_jsonb,        -- list of ids transmitted at this hop
transmission_event enum('inheritance','sale','gift','marriage_brought','distribution'),
transmission_date, transmission_document_id,
provenance_jsonb,
created_at
```

### M055 — `corporate_descent_chains`
Wealth-tracing forward; enslaver wealth → modern firms.
Example: Drovers Rest cattle market (Patrick & Cato labored 1849+) → Weaver butchering → Robert Weaver's Metropolitan RR / Washington Gas Light / Farmers & Mechanics Bank → Weaver Bros (1888–1989) → BancOne → JPM Chase ancestry.
```
id, predecessor_entity_id, successor_entity_id,
relationship_type enum('successor','acquired','spun_off','renamed','wealth_inherited','wealth_invested'),
transition_date, source_citation,
provenance_jsonb,
created_at
```

### M056 — `regional_source_registry`
Registered horizontal sources. **Dual-axis** per Eltis methodology.
```
id, source_name, citation,
jurisdiction_text, jurisdiction_geojson_id (nullable),
era_start, era_end,
record_type enum('deed','chancery','probate','tax','church','directory','newspaper',
                 'voyage_log','runaway_advertisement','will_testament','inventory',
                 'compensation_petition','manumission','marriage','census','ship_manifest'),
axis_role text[] check (axis_role <@ ARRAY['position','trajectory']),  -- one or both
access_method enum('pdf_index','web_query','rest_api','manual_lookup','batch_export'),
coverage_notes,
estimated_completeness numeric(3,2),    -- Eltis-style 0..1 with derivation cited
methodology_id (fk M060),
registered_at,
last_verified_at
```
Initial registry rows include: SlaveVoyages TSTD (trajectory + position), SlaveVoyages Intra-American (trajectory), Hynson DC Runaway/Fugitive Cases 1848–63 (trajectory), Maryland S1431 personal-name index (position), DC Libers (position), 1850/1860 slave schedules (position, already partially ingested), Freedmen's Bank (position + partial trajectory), civilwardc petitions (position + partial trajectory). Each registers with declared coverage cells.

### M057 — `participant_documentary_coverage`
Per-participant lineage cell coverage tracking. **Renamed and reframed from earlier "positivity coverage" — this is documentary completeness, not causal counterfactual.**
```
id, participant_id,
ancestor_canonical_id,
cell_place, cell_era,
coverage_status enum('exhausted','registered_sources_pending','no_registered_source','manual_lookup_required'),
last_checked_at,
sources_checked_jsonb,             -- registry ids that were queried
hits_found int,
notes
```
Drives a "documentary completeness" indicator on the DAA. **Does not** claim causal coverage.

### M058 — `trace_observations`
Anonymous or fragmentary records with provenance. **Critical for documentary asymmetry.**
```
id,
source_table,                      -- 1850_slave_schedule, ship_manifest, runaway_ad, undertaker_journal
source_record_id,
attributes_jsonb,                  -- {age?, sex?, color?, height?, condition?, named_first?, occupation?}
place_id, era_window,
implicating_canonical_id (nullable), -- e.g., owner column on slave schedule row
ingested_at,
methodology_id (fk M060)
```
Existing ~1.68M `unconfirmed_persons` rows from slave schedules will be reviewed; many of those are really trace observations and should migrate into M058 with the unconfirmed_persons row marked deprecated. Migration plan in §7.

### M059 — `linkage_candidates`
Probabilistic links between trace observations and named persons, or between traces.
```
id,
left_table, left_id,               -- trace_observations | canonical_persons | unconfirmed_persons
right_table, right_id,
linkage_type enum('same_person_candidate','parent_child_candidate','sibling_candidate','prior_owner_candidate'),
methodology_id (fk M060),
confidence_low, confidence_high,
features_jsonb,                    -- the actual matching signals
status enum('proposed','reviewed_accepted','reviewed_rejected','superseded'),
reviewed_at, reviewed_by,
created_at
```
Multiple candidates per trace are fine. Review-gated promotion.

### M060 — `estimation_methodology_registry`
Versioned methodologies with documented assumptions, citations, known failure modes.
```
id, name, version,
description,
assumptions_jsonb,
citations,                         -- e.g., Berry "Price for Their Pound of Flesh", Eltis "African Origins"
known_failure_modes,
introduced_at, deprecated_at (nullable)
```
Initial methodologies registered: "1850→1870 surname assumption linkage", "ship-manifest age-cohort tracking", "kinship inference from Freedmen's Bureau labor contracts", "estate inventory enslaved-person valuation (Berry method)", "African-name-pattern ethnic-origin inference (Eltis African Origins method)". Every estimate row in M052/M058/M059 cites a methodology row.

---

## 3. Services

### 3.1 `src/services/probate/will-package-splitter.js`
Input: PDF path. Output: `{pages: [{index, image_path, page_type, confidence}]}`.
Page types: `narrative_will | codicil | oath_form_30 | witness_form_2 | registry_proof | unknown`.
Classifier: form-number regex (`FORM 30`, `FORM 2`, `Supreme Court of the District of Columbia`) + Vision-based handwritten-vs-printed heuristic.

### 3.2 `src/services/probate/will-ocr.js`
Input: split package from §3.1. Output: per-page text + page-level confidence.
Routes: handwritten/narrative pages → Vision DOCUMENT_TEXT_DETECTION; printed forms → Document AI Form Parser. Generalized from `scripts/ocr-hopewell-will.mjs` — fully parameterized, no hardcoded CP IDs or S3 keys.

### 3.3 `src/services/probate/will-extractor.js`
Input: OCR output + optional participant lineage hint. Output: typed `WillExtraction` JSON.
Hybrid: (a) deterministic lineage-name scanner (cheap, proven on Hopewell); (b) Claude Haiku JSON-schema extraction over full OCR text + form fields.

`WillExtraction` schema:
```
{
  testator: {name, place, occupation?, signing_date, death_date?, proved_dates[]},
  spouse: {name, prior_marriages?},
  children: [{name, role, share_described}],
  beneficiaries_kin: [...], beneficiaries_non_kin: [...], beneficiaries_charitable: [...],
  enslaved_persons: [{name?, age?, sex?, bequeathed_to, manumitted?, context_quote}],
  real_property: [{description, acres?, location, value?, bequeathed_to, deed_refs[]}],
  monetary_bequests: [{amount, currency_year, beneficiary, conditions?}],
  heirlooms: [{description, value?, beneficiary, context_quote}],
  corporate_holdings: [{entity_name, share_count?, value?}],
  trust_instruments: [{kind, beneficiary, trustee, asset_refs[], shielding_clause_quote?}],
  debts_acknowledged: [{amount, creditor, context}],
  govt_compensation_references: [{event_quote, amount, year, parties}],
  witnesses: [{name, signing_date}],
  executors: [{name}],
  registrar: {name, court},
  burial_location?,
  court_jurisdiction,
  raw_quotes_per_field_jsonb              -- traceability back to OCR
}
```
Plus: `name_resolution_proposals[]` for fuzzy matches against `canonical_persons` + `ancestor_climb_matches` in supplied lineage.

### 3.4 `src/services/probate/will-fanout.js`
Gated on per-section reviewer approval in `/review`. Writes:
- enslaved_persons → `enslaved_individuals` + `slaveholding_relationships` (M052)
- manumissions → `free_persons` (M023)
- real_property → `land_transfer_events` (M038) + (if acres ≥ threshold) `top_landholder_flags`
- heirlooms → `flagrant_heirloom_assets` (M038)
- corporate_holdings → `corporate_slavery_evidence` (M043)
- monetary_bequests + estate total → `estate_valuations` (M049)
- trust_instruments → `trust_instruments` (M050)
- spouse/children → `person_relationships_verified`
- govt_compensation_references → `historical_reparations_payments` (M011/M041)
- witnesses/executors/registrar → `social_network_edges` (M051) — **never enslaver promotion**
- always: full OCR text → `person_documents`; original PDF → S3 `s3://reparations-them/wills/<participant_id>/<filename>.pdf`

### 3.5 `src/services/enslaver-evidence-compiler.js`
Mandatory pre-classification step. Input: canonical_person_id (or candidate name/era/place). Compiles evidence from:
1. canonical_persons fuzzy match
2. civilwardc_petitions claimant search
3. enslaved_individuals + family_relationships(enslaved_by) reverse lookup
4. slaveholding_relationships (M052) reverse lookup
5. unconfirmed_persons by surname + era
6. 1850/1860 slave schedules cross-ref
7. land_transfer_events as buyer/seller
8. corporate_slavery_evidence (M043)
9. SlaveVoyages voyage participants (TSTD + Intra-American)
10. Person's siblings'/parents'/spouse's records (kin-graph traversal)
11. Spouse's prior marriages → enslaved persons brought in via remarriage
12. Children's records → enslaved inherited but living in this household
13. Registered horizontal sources via §3.6

Writes `enslaver_evidence_compendium` (M053) rows. Never retracts; corrections are new rows.

### 3.6 `src/services/horizontal-calibrator.js`
Invoked at compiler time. Input: `(canonical_person, era, places[])`. Asks `regional_source_registry` (M056) "which sources cover this scope?" Queries each source per its `access_method`; surfaces "manual lookup needed" for ones that don't yet have automated paths. Updates `participant_documentary_coverage` (M057).

### 3.7 `src/services/trace-linkage.js`
Probabilistic linker over `trace_observations` (M058) ↔ `canonical_persons` ↔ `unconfirmed_persons`. Each linkage cites a methodology row (M060). Multiple candidates allowed per trace. Reviewer promotes via `/review`.

### 3.8 `src/services/reparations/dual-ledger-daa.js`
Replaces/wraps existing DAAOrchestrator. Per ancestor in participant lineage, computes:
- **Documented ledger**: events from primary sources, source-cited.
- **Estimated ledger**: events derived via M058 + M059 + M060, methodology-cited, with Eltis-style uncertainty bounds.
- **Net per ancestral line**: documented + estimated, presented separately.
- **Participant-level rollup**: sum across ancestral lines, both ledgers presented, never collapsed.

### 3.9 API endpoints
- `POST /api/canonical-persons/:id/probate` — upload + run pipeline
- `GET /api/canonical-persons/:id/probate/:extractionId` — full structured extraction for review
- `POST /api/wills/:extractionId/review/:section` — per-section approval triggers fanout
- `POST /api/source-registry/lookup` — invoke calibrator for a person/era/place
- `POST /api/trace-linkage/propose` — manual linkage proposal
- `POST /api/daa/generate` — already exists; updated to emit dual-ledger payload (§4.5)

---

## 4. DAA Dual-Ledger Design

### 4.1 Per-ancestor accounting unit

```
{
  ancestor_canonical_id,
  participant_lineage_path: [...],            -- how the participant connects
  heritage_indicators: [
    {indicator_type, source_event_id, evidence_strength, claim_quote}
    // typed events, NOT a single 'race' attribute
  ],
  documented_events: [
    {event_type, date_window, place, value_at_event, value_methodology,
     source_table, source_id, source_quote}
  ],
  estimated_events: [
    {event_type, date_window, place, value_estimate,
     methodology_id, confidence_low, confidence_high,
     supporting_traces[], supporting_linkages[]}
  ],
  documented_subtotal_cents,
  estimated_subtotal_cents_low,
  estimated_subtotal_cents_high,
  ledger_direction enum('owed_to_descendant','benefited_descendant')  // dual-ledger key
}
```

### 4.2 Documented ledger
Aggregates only events with `evidence_strength ∈ {direct_primary, indirect_primary}` and at least one source citation. Computes a single value per event using a documented valuation methodology (Berry, Brattle, Darity-Mullen, etc.) cited per row. Compounds forward to present using documented inflation/interest series.

### 4.3 Estimated ledger
Aggregates events derived from `trace_observations` + `linkage_candidates` + `enslaver_evidence_compendium` rows with `evidence_strength ∈ {secondary, inferred}`. Each event cites a methodology row (M060). Carries explicit `(confidence_low, confidence_high)` interval per Eltis methodology. Compounds forward with the same series, propagating uncertainty.

### 4.4 Net per ancestral line
For mixed-heritage participants (Adrian's case):
- For each ancestral line, classify as `owed_to_descendant` (documented theft from this line) or `benefited_descendant` (documented enslaver wealth flowing through this line to participant).
- **Lines are summed by direction, not netted at the line level** — the participant sees both directions and the explicit net at the participant level.

### 4.5 Participant-facing claim grammar

Every DAA emission carries:

```
{
  participant_id,
  emission_date,
  registry_version_id,                     // which M056 snapshot was used
  documented_owed_total_cents,
  documented_benefited_total_cents,
  documented_net_cents,
  estimated_owed_low_cents, estimated_owed_high_cents,
  estimated_benefited_low_cents, estimated_benefited_high_cents,
  estimated_net_low_cents, estimated_net_high_cents,
  per_ancestor_breakdown: [...],
  documentary_completeness: {
    cells_covered, cells_pending, cells_unknown,
    next_highest_value_lookups: [...]      // what would close the largest gaps
  },
  methodology_dossier_url,                 // links to the cited methodologies
  claim_grammar: {
    asserted: "documented historical theft and benefit events traceable through your lineage, valued and compounded per cited methodologies",
    explicitly_not_claimed: [
      "a causal estimate of what your wealth would have been absent slavery",
      "a population-level claim about the racial wealth gap",
      "a final or unrevisable accounting"
    ],
    tolbert_meta_note: "Per Tolbert 2025, the population-level counterfactual is structurally unanswerable from pre-repair data. This DAA documents specific events; it does not estimate the counterfactual. The act of repair itself is what enables future causal social science about race."
  }
}
```

---

## 5. Will-Ingestion Pipeline End-to-End

```
Upload PDF
  → S3 archive (s3://reparations-them/wills/<participant_id>/<filename>.pdf)
  → person_documents row created
  → will-package-splitter (§3.1)
  → will-ocr (§3.2) per page
  → will-extractor (§3.3) over all pages
  → will_extractions row (M048) status='extracted'
  → enslaver-evidence-compiler (§3.5) runs over testator + spouse + every named kin
       → emits enslaver_evidence_compendium (M053) rows
       → triggers horizontal-calibrator (§3.6) for each (canonical_person, era, places)
  → /review queue surfaces will_extraction with both:
       (a) what THIS will alone shows
       (b) what cross-source enrichment surfaced about this testator
       reviewer cannot mark complete without confirming both
  → per-section approvals trigger will-fanout (§3.4)
       → writes to enslaved_individuals, slaveholding_relationships, free_persons,
         land_transfer_events, flagrant_heirloom_assets, corporate_slavery_evidence,
         estate_valuations, trust_instruments, person_relationships_verified,
         historical_reparations_payments, social_network_edges, person_external_ids
  → name_resolution_proposals routed to merge-review queue
  → kin-graph updates trigger re-run of dual-ledger-daa (§3.8) for any affected participants
```

---

## 6. Test Cases

These three documents drive end-to-end testing. None are hardcoded in code; they are test fixtures.

### 6.1 Biscoe (1859, clear pre-emancipation enslaver)
Source: `~/Downloads/George Biscose 1859.pdf`. 3 pages: handwritten will narrative + handwritten witness affidavit + DC Orphans' Court proving form.

Expected extraction outputs:
- testator: George W. Biscoe, Georgetown DC, signed 1859-07-19, proved 1859-08-27
- spouse: Ann Maria Biscoe (named executrix; trustee)
- children: Angelica Chew (received gift by way of advancement), Emma (gets share via trust)
- enslaved_persons: 3 rows — "woman Mary", "woman Caroline", "Caroline's children" (count unspecified)
- trust_instruments: 1 row — separate_use_trust, beneficiary=Emma, trustee=Ann Maria, shielding_clause="free, clear & discharged of and from all liability for or on account of any husband she may marry"
- witnesses: Walter H.S. Taylor, Margaret S.B. Tuck, John Calvert
- registrar: Ed N. Roach
- name_resolution_proposals: "Angelica Chew" ↔ canonical_persons "Angelica Chesley" (Adrian's lineage), confidence ~0.7, requires_review

Expected fanout:
- George W. Biscoe → enslaver_evidence_compendium row, person_type rolls up to enslaver
- 3 slaveholding_relationships rows, type='owned'
- 1 trust_instruments row
- 4 social_network_edges rows (witnesses + registrar)
- merge proposal Angelica Chew ↔ Angelica Chesley to /review
- horizontal-calibrator: searches Maryland S1431 index, DC Libers, 1850/1860 DC slave schedules for Biscoe surname → surfaces additional candidate evidence

### 6.2 Weaver (1893, occlusion-trap post-emancipation)
Source: `~/Downloads/Henry Weaver 1893.pdf`. 5+ pages: handwritten will + Form 30 oath + Form 2 witness depositions x2.

Expected extraction outputs from will alone:
- testator: Henry Weaver, Georgetown DC, signed 1884-06-17, died 1893-12-08, proved 1893-12-14/16/18
- enslaved_persons: **0** (post-emancipation will, none named)
- monetary_bequests: $500 to Angeline Drinkhouse, $500 + gold watch to Theodore Barnes
- debts_acknowledged: $12,250.34 to wife Mary Ann Weaver (composite)
- govt_compensation_references: 1 row — "dower money from the land sold to the United States from the estate of the late Horatio Barn[es]", $1,937.12
- witnesses: Frederick L. Moore, William K. Grimes, William P. Mayfield
- burial_location: Oak Hill Cemetery
- registrar: D. Wright (likely)

**Expected cross-source enrichment** (this is the load-bearing test):
- compiler queries civilwardc_petitions for Henry Weaver → expected hit: Jane Johnson, age 34, 1862 claim
- compiler queries Hynson DC Runaway/Fugitive Cases for Henry Weaver → expected hit: Patrick & Cato released to him 1849 (relationship_type='possessed')
- compiler traces spouse Mary Ann's prior marriage to Horatio Barnes (1845) → triggers inheritance-chain construction → Basil Barnes 1845 estate (Dennis, Cators, Patrick, Jude, Linda) → Mary Ann's children (Henry, Theodore, Angeline Barnes) inherit → Henry Weaver's household via 1848 marriage → 5 slaveholding_relationships rows with type='controlled_via_marriage' or 'controlled_via_stepfamily'
- wealth-genealogy crawler: Robert D. Weaver (son) → Metropolitan RR, Old Dominion RR, Washington Gas Light, Georgetown Gas, Farmers & Mechanics Bank → Weaver Bros (1888–1989) → BancOne → corporate_descent_chains rows

Reviewer sees: "what this will alone shows" (testator NOT enslaver from this doc) **side by side with** "what cross-sources show" (testator IS enslaver via 4 independent sources). Cannot close without confirming both.

Final classification: Henry Weaver `person_type='enslaver'` with M053 compendium showing ≥4 evidence rows, **none of which are this will**.

### 6.3 Hopewell (existing pipeline, generalize)
Source: `scripts/ocr-hopewell-will.mjs` — currently hardcoded for HOPEWELL_CP=1070, CHESLEY_CP=140299, S3 key. Refactor into the §3.1–§3.4 chain with no hardcoded IDs. Re-run against the original Hopewell PDF and confirm output matches existing person_documents and person_relationships_verified rows (regression test for the generalization).

---

## 7. Build Order

Stages with explicit dependencies. Each stage gated on the prior unless noted parallel.

**Stage 1 — Foundation migrations.** M048, M049, M050, M051, M052, M053, M060. Apply via `apply-migrations.js`. Idempotency check.

**Stage 2 — Ontology migration of existing data.**
- Backfill `slaveholding_relationships` (M052) from existing `family_relationships(enslaved_by)` rows; mark legacy table as superseded but not dropped.
- Bootstrap `enslaver_evidence_compendium` (M053) from existing person_documents + family_relationships + civilwardc_petitions for already-classified canonical_persons (audit-only, idempotent).

**Stage 3 — Source registry.** M056 + M060 seed methodologies + initial registry rows for: SlaveVoyages TSTD, SlaveVoyages Intra-American, Hynson DC Runaway/Fugitive 1848–63 (load corpus), Maryland S1431 (registered, no automated query yet), DC Libers (registered, manual_lookup), 1850/1860 slave schedules (already partial, register coverage), Freedmen's Bank (register coverage), civilwardc petitions.

**Stage 4 — Will-ingestion services.** §3.1 → §3.2 → §3.3 → §3.4. Test against Biscoe + Weaver + Hopewell. Hopewell is regression test for §3.5 cross-source compiler (not fully — but its kin-graph should match prior outputs).

**Stage 5 — Cross-source compiler.** §3.5 + §3.6. Run over all existing canonical_persons with person_type='enslaver' to populate M053. This will surface canonical_persons whose enslaver classification was based on a single document and whose compendium therefore has only one row — those are flagged for additional source-registry queries.

**Stage 6 — Trace observations + linkage.** M058 + M059. Begin migration of subset of unconfirmed_persons (slave-schedule rows) into M058 with deprecation marker. Pilot trace-linkage (§3.7) on Charleston 1850 → Charleston 1860 → Freedmen's Bank Charleston 1865+ surname-assumption chain.

**Stage 7 — Documentary coverage.** M057. Compute per-participant cells. Surface coverage indicator on existing DAA outputs (no DAA shape change yet).

**Stage 8 — Dual-ledger DAA.** §3.8 replaces existing DAAOrchestrator output shape. New emissions carry §4.5 grammar. Old emissions kept frozen, accessible by version.

**Stage 9 — Review UI.** Per-section will-extraction approval; cross-source dossier display; trace-linkage promotion. Routes integrated into existing `/review` queue.

**Stage 10 — Inheritance + corporate descent.** M054 + M055. Wired into compiler and into participant-facing wealth-genealogy display.

**Stage 11 — Frontend integration.** PersonProfile.jsx upload + extraction tree; DAA dual-ledger display; documentary completeness indicator; methodology dossier links.

---

## 8. User Decisions (filed 2026-04-29)

1. **Trace observations migration scope** → **wholesale, unconfirmed_persons rows marked deprecated not deleted.** Stage 6 migrates the ~1.68M slave-schedule rows into M058 in batch. The unconfirmed_persons rows remain accessible for legacy joins but carry a `deprecated_at` timestamp + `succeeded_by_trace_observation_id` pointer.

2. **Hynson corpus access** → **user is sourcing from Library of Congress; will arrive digitized.** Other similar compendiums anticipated as user makes archive visits. Pipeline registers Hynson and similar as `access_method='batch_export'` once digitized; until then `access_method='manual_lookup'`. **Do not pre-build automation for sources we don't have.** Users delivers digitized files; we ingest per the pattern proven for Freedmen's Bank.

3. **Methodology stack for documented valuation (resolved by analysis below):**

   The right answer is not a single default — it's a stack. Each role registered as its own methodology row in M060. All four sources inform the system; they do different jobs.

   | Role | Methodology | Why germane |
   |---|---|---|
   | **Per-event valuation (life-stage)** | Berry, *The Price for Their Pound of Flesh* (2017) | Provides documented life-stage market values of enslaved people from estate inventories, insurance, tax appraisals. Direct input when an estate inventory or sale document gives us a person + age + price. Highest precision when source documents have it. |
   | **Per-event valuation (no life-stage data)** | Darity-Mullen, *From Here to Equality* Table-equivalent stolen-labor-per-year estimates | Default when an enslavement is documented but no per-event valuation exists. Lower precision; assumed where Berry-grade data is absent. |
   | **Per-event valuation (hours-based claims)** | Brattle Group / CARICOM methodology — hours × wage-foregone | Used where labor-hours can be inferred (plantation production records, labor contracts). Complements Berry for working-life-extraction not captured in market price. |
   | **Compounding forward** | Brattle 3% real per year (conservative) | Documented numbers should be defensible from below. ~50x multiplier over 150 years vs. Darity-Mullen's 4% nominal (~150x). We pick the conservative side and surface the alternative as a methodology variant the participant can request. |
   | **Population-level sanity check** | Darity-Mullen $11.2T (2020 dollars) ÷ ~40M eligible AADOS ≈ $280K/person | Aggregate-level "is our system in the right order of magnitude" check, NOT a per-participant claim. Surfaces if our per-lineage outputs are systematically far above or below the population framework. |
   | **Evidence tiering** | ICHEIC-adapted (Holocaust Victim Asset Recovery) | Tiered claims by evidence strength. Tier A direct primary doc, Tier B corroborated, Tier C kin testimony / indirect, Tier D estimated/inferred. Maps to our `evidence_strength` enum and gates DAA confidence bounds per tier. |

   **Default for documented ledger**: Berry-where-data-permits + Darity-Mullen-Table fallback, compounded at Brattle 3% real, tiered ICHEIC-style. Darity-Mullen aggregate as sanity-check. Each row carries methodology_id pointing to one of these M060 rows.

4. **Reviewer authority** → **same reviewer for both within-document and cross-source sections.** Simpler; reviewer must internalize both epistemic operations rather than splitting cognitive load. Open future option to split if reviewer-load becomes a bottleneck.

5. **DAA reissue** → **reissue all prior emissions to new shape; end-to-end bugginess is mine to fix.** Old emissions are NOT frozen in their old shape; they are recomputed against the new dual-ledger schema with current data. Each participant sees only the current emission. Internal versioning preserves the prior shape for audit but is not surfaced.

6. **Tolbert citation visibility** → **summarized in participant-facing UI, full note in methodology dossier behind link.** As proposed.

---

## 9. References

Read in full this session:
- Tolbert, A. W. (2025). "An epistemic argument for reparations: A solution to the problem of social stratification in causal modeling." *Synthese* 205:179. DOI: 10.1007/s11229-024-04901-8
- Tolbert, A. W. (2024). "Causal Agnosticism About Race: Variable Selection Problems in Causal Inference." *Philosophy of Science* 91(5):1098–1108. DOI: 10.1017/psa.2023.166
- Eltis, D. (2021). "The Trans-Atlantic Slave Trade Database: Origins, Development, Content." *Journal of Slavery and Data Preservation* 2(3):1–8. DOI: 10.25971/R9H6-QX59

Cited but not yet read; flagged for research agenda:
- Eltis, D. & Richardson, D. (2010). *Atlas of the Transatlantic Slave Trade.* Yale University Press. (Methodology chapter for missing-voyage estimation formalism — would deepen M060 methodologies.)
- Berry, D. R. (2017). *The Price for Their Pound of Flesh.* (Lifecycle valuation methodology for documented ledger.)
- Schermerhorn, C. (2015). *The Business of Slavery and the Rise of American Capitalism.* (Domestic slave trade trajectory data.)
- Block, S. (2018). *Colonial Complexions.* (Sparse-record race/heritage inference.)
- Beckert, S. & Rockman, S. eds. (2016). *Slavery's Capitalism.* (Wealth-tracing forward complement to Eltis.)
- Sen, M. & Wasow, O. (2016). "Race as a Bundle of Sticks." *Annual Review of Political Science.* (Microvariable framework grounding.)
- Darity Jr, W. & Mullen, A. K. (2022). *From Here to Equality* (2nd ed.). (Documented-ledger compounding methodology candidate.)
- Hamilton, D. & Darity Jr, W. (2010). "Can 'Baby Bonds' Eliminate the Racial Wealth Gap?" *Review of Black Political Economy.* (Wealth-gap baseline.)

Primary sources test-fixture for §6:
- George W. Biscoe will, 1859, DC Orphans' Court (PDF in user's Downloads)
- Henry Weaver will, 1884/1893, DC Orphans' Court (PDF in user's Downloads)
- Carlton Fletcher, "Weaver and Barnes Family Notes," Glover Park History (secondary source documenting the Weaver cross-source enrichment expected for §6.2)
- James Hopewell will, 1817 (existing OCR'd via `scripts/ocr-hopewell-will.mjs`)

---

## 10. Status

**Approved 2026-04-29** with all six §8 questions resolved (see §8 above).

Beginning Stage 1: migrations M048–M053 + M060.
