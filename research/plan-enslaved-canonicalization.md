# Plan: Enslaved-Population Canonicalization (Cross-Source Phase B + External Anchors)

Date: 2026-06-21
Status: PLANNING — for review before build.

## Why this is the unlock

Three high-value things are blocked on the same root cause — the enslaved
population isn't canonicalized:
- the **1.88M wage_theft line items** have `canonical_person_id` NULL (keyed to evidence, not persons),
- the **Freedman's Bank depositors** can't resolve their kin,
- descendants can't trace to **named** enslaved ancestors.

Canonicalizing the enslaved population links all three to real people.

## What already exists (REUSE — do not rebuild)

The enslaver side and the dedup machinery are largely built (Biscoe work, Jun 12):
- **Blocking**: `person_blocking_keys` (M091, 1.45M keys: `sn:`/`s4:`/`mp:`) + `scripts/lib/name-normalize.mjs` (`deriveSurnames`, `normalizeState`, `isOrgName`).
- **Scored resolver**: `scripts/resolve-canonical-dedup.mjs` — Fellegi-Sunter (block→score→route), Biscoe-validated. Rules baked in: shared-extid +10, shared-parent+name +6, **conflicting-parents −8**, JW name, name-commonness penalty, hard excludes (birth-Δ>7, enslaver↔enslaved, **same-1860-census**).
- **Review + merge**: `dedup_candidate_pairs` (7,056) + review UI (`review.js`/`review.html`); `merge-canonical-persons.mjs` (FK-safe, 45 cols, `person_merge_log`). Merges stay HAND-confirmed.
- **Cross-source Phase A (enslaver)**: `cross_source_candidates` (M092, 10,901 links); ~93% enslavers already linked.
- **Identity spine**: `person_external_ids` (58,974; FS/SlaveVoyages id_systems), `find_person_match()`, `person_relationships_verified`, `canonical_family_edges`.
- **Methodology**: `research/entity-resolution-methodology.md` (24 sources). Fellegi-Sunter, Splink, phonetics-for-blocking-only, over-merge defenses (route >1-candidate to review).
- **The 5 Biscoe rules**: parentage primary; census mutual-exclusion = hard non-merge; completeness needs the kin graph; holding-size = trajectory; dedup both sides.

## The verified data landscape (Jun 21)

- **Phase B target**: 1,602,654 enslaved `unconfirmed_persons`. Owner-anchor coverage is strong: **owner 1.51M, age 1.55M, year 1.56M, county 1.46M** (in the `relationships` JSONB). Most are first-name-only → surname blocking useless → **owner-anchored blocking is the key** (designed, not built).
- **Parallel-population split (critical)**: the wage_theft substrate (`family_relationships`/`epi`, 2.0M `enslaved_by` edges) and the 1.6M `unconfirmed_persons` are PARALLEL slave-schedule representations — only **32,584 linked** (1.6%, via `person2_lead_id`). Canonicalization must unify BOTH so the wage_theft items get person ids.

## External named-individual databases — assessment (NEW; not previously consulted)

We integrated SlaveVoyages (the *trade*). We had NOT considered the *named-individual* databases. Assessed:

| Source | Scale / fields | Access | Fit |
|---|---|---|---|
| **Enslaved.org** (MSU Matrix + UMD) | **~750K** people/events/places/sources, 15th c.–1888 | **Linked Open Data (Wikibase); periodic RDF + JSON dumps** at docs.enslaved.org/lod/ | **HIGHEST** — a linked-data hub that AGGREGATES discrete slavery DBs; persistent Q-IDs = strong cross-source anchors (Fellegi-Sunter +10, like FS IDs). Bulk-ingestible NOW. |
| **Liberated Africans** (MSU Matrix) | **~200K** registered by **name, age, sex, height, description, scarification**; ~1,000 trials; slave-ship registers | Structured; open-source frontend (GitHub `walkwithweb/liberatedafricans.org`); no documented API | **HIGH** — rich bio fields for resolution AND **named people off intercepted slave ships → repairs the corrupted middle_passage data (#91)**. |
| **10 Million Names** (American Ancestors + FamilySearch) | aspirational ~10M US enslaved; "small but growing datasets" | Free site 10MillionNames.org; **no bulk API yet**; FamilySearch-AI-driven | **STRATEGIC** — the reference target + an aligned partner (same mission). Monitor + ingest published datasets; potential reciprocal contribution of our resolved data. |
| **Valongo Wharf** (UNESCO, Rio) | disembarkation site | n/a (heritage site) | **PROVENANCE/PLACE** — a location node for the global/Brazil dimension, not an identity source. |

Takeaway: **Enslaved.org's LOD dumps are the missing cross-source anchor** — they turn the enslaved ER from name-only-internal into externally-anchored (the same leap FS IDs gave the enslaver side). Liberated Africans doubles as the middle_passage fix.

## Proposed build — phased, gold-validated, human-in-loop

**B.0 — Gold validation.** Hand-resolve a documented owner cluster (extend Biscoe; or Isaac Franklin — large, well-documented) as ground truth before scaling. (Biscoe rule: validate before `--all`.)

**B.1 — Owner-anchored blocking.** New blocking pass for enslaved `unconfirmed_persons`: key = (normalized owner-surname [resolve owner→canonical enslaver via Phase A] + state + county + schedule-year). Disambiguate within block by age + sex + given-name. Reuse `name-normalize.mjs`; new key namespace in `person_blocking_keys` or a sibling table.

**B.2 — Scored resolution + census mutual-exclusion.** Extend `resolve-canonical-dedup.mjs` for the enslaved case: within an owner+year block, two rows with different age = DIFFERENT people (hard non-merge, Biscoe rule 2). Score by given-name JW + age proximity + owner-match. Route multi-match to review.

**B.3 — Promote + backfill (the payoff).** Promote resolved clusters → `canonical_persons` (person_type='enslaved'); write `person_external_ids` + `canonical_family_edges`. Then **backfill `reparations_line_items.canonical_person_id`** (the 1.88M wage_theft items) and `family_relationships.person2_lead_id` — closing the loop so the harm figures attach to named people.

**B.4 — Cross-source identity.** Link the same enslaved person across 1860 schedule ↔ probate inventory (the de-siloed `probate_estate_extractions.enslaved_persons`) ↔ Freedman's Bank, via owner + given-name + age + location. (This is also where the probate enslaved-name lists finally connect.)

**B.5 — External anchoring.** Ingest **Enslaved.org** RDF/JSON dumps → `person_external_ids` (id_system='enslaved_org'); these Q-IDs anchor clusters (strong signal). Ingest **Liberated Africans** (named + ship) → enslaved persons + middle_passage repair. **Monitor 10MN**; design a reciprocal contribution path. Add **Valongo** + disembarkation sites as place nodes for the global dimension.

## Promotion threshold (tiered — 1.6M can't be hand-reviewed)

Per the Biscoe hand-confirm rule, but scaled: **auto-promote** only single-block, high-score, externally-anchored (Enslaved.org Q-ID or unique owner+name+age) clusters; **route** multi-match / soft-only to the review queue; **never** auto-merge across a census-set boundary. Tunable thresholds, validated on B.0 gold.

## Open decisions for review

1. **Scope first cut**: full 1.6M, or start with the **documented-enslaver lineages** (the 248K ledger enslavers' enslaved — directly improves the obligation) or **one state**?
2. **External-first vs internal-first**: ingest Enslaved.org/Liberated Africans dumps FIRST (anchor, then resolve) or run internal owner-anchored ER first then anchor?
3. **Promotion autonomy**: how aggressive is auto-promote vs review, given 1.6M volume?
4. **Mini vs MacBook**: ER refresh runs nightly on the Mini (`er-refresh.sh`); Phase B at 1.6M scale — extend that cron or run as a one-time MacBook batch?

## DECISIONS LOCKED (Jun 21) + Louisiana first-build

**Scope = Louisiana. Sequence = external-anchor first.**

Why Louisiana (verified): it is the ONLY state with a substantial CANONICAL enslaved
population already — **57,261 canonical 'enslaved' + 38,865 enslavers** — because of the
`louisiana_slave_db_import` (113,500 records = the **Gwendolyn Midlo Hall Louisiana Slave
Database**). Plus ~58K enslaved `unconfirmed_persons` for LA, and it's Isaac Franklin
territory (the northern-financier-counterparty goal). Decisive: **the Hall database is
itself a primary Enslaved.org dataset**, so external-anchor-first is natural — our LA
records and Enslaved.org share a common source, giving a built-in cross-source key.

External access (verified): Enslaved.org publishes periodic **RDF + JSON `.gz` dumps**
(docs.enslaved.org/lod/), refreshed when datasets are added. Q-ID scheme / exact dataset
list / license NOT yet confirmed from the dump files — first execution step resolves these.

**Louisiana build order (external-anchor first):**
1. **B.5-LA (FIRST)**: fetch + parse the Enslaved.org RDF/JSON dump; filter to Louisiana /
   the Hall dataset; stage to a holding table; confirm Q-ID scheme + license. Anchor our
   `louisiana_slave_db_import` rows to Enslaved.org Q-IDs via `person_external_ids`
   (id_system='enslaved_org'). Also pull Liberated Africans LA-relevant records.
2. **B.0-LA**: gold-validate on one well-documented LA owner (Isaac Franklin, or a Hall
   cluster) — hand-resolve as ground truth.
3. **B.1–B.2-LA**: owner-anchored blocking + scored resolution + census mutual-exclusion
   over LA enslaved (canonical 57K + unconfirmed 58K), now anchored by Enslaved.org Q-IDs.
4. **B.3-LA**: promote/merge clusters; **backfill `reparations_line_items.canonical_person_id`**
   for LA wage_theft items + `family_relationships.person2_lead_id`.
5. **B.4-LA**: cross-source link LA schedule ↔ probate ↔ Freedman's (New Orleans branch).

Open before execution: confirm Enslaved.org dump schema + reuse license (academic LOD —
likely CC, but verify); decide staging-table shape for the dump.

### B.5 inspection RESULTS (Jun 21) + licensing refinement

- **Dump confirmed**: Wikibase RDF + JSON, Q-ID identifiers, refreshed Mar 31 2026.
  JSON dump = **~464 MB compressed** (`manta.matrix.msu.edu/.../latest.wikibase.dump.json.gz`)
  → multi-GB decompressed → the parse runs on the **Mac Mini**, not inline.
- **License**: Enslaved.org's journal (JSDP) is **CC BY-NC-SA 4.0** (non-commercial +
  share-alike); the data license isn't stated separately → treat as NC-SA. Our platform's
  payment/blockchain layer makes "non-commercial" a gray area.
- **REFINEMENT (licensing-safe AND cleaner) — ANCHOR BY REFERENCE, don't bulk-copy:**
  - We ALREADY HOLD the Hall Louisiana data (`louisiana_slave_db_import`, 113,500) — and
    **Hall is a primary Enslaved.org SOURCE dataset.** So for LA facts we use OUR Hall
    import (no license issue — our data), extracting it into `person_facts`
    (source_external_system='hall_louisiana').
  - We use Enslaved.org only for the **persistent-ID anchor**: match our Hall rows →
    Enslaved.org Q-IDs (via shared Hall record-ID in the dump, else name+date+place) →
    `person_external_ids` (id_system='enslaved_org'). Storing a Q-ID + link is
    attribution/reference, clearly permissible; we do NOT redistribute their NC-SA data.
  - Net: facts from our own Hall import; cross-source IDENTITY anchor from Enslaved.org.
    The 464MB dump is downloaded/filtered on the Mini only to build the Hall-ID ↔ Q-ID
    crosswalk.
- **Revised B.5-LA steps:** (1) extract `louisiana_slave_db_import` → `person_facts`
  (doable now, our data); (2) on the Mini, download + stream-filter the Enslaved.org dump
  to the Hall-ID↔Q-ID crosswalk; (3) write Q-IDs to `person_external_ids` (anchor by
  reference). Liberated Africans: check its license similarly (MSU Matrix, likely same).

## Richer spine: the genealogical EVIDENCE layer (person_facts, M096 — BUILT)

The spine was too thin: `canonical_persons` is flat — birth/death YEAR only (**10% / 3%
filled**, sex 12%, plantation 0%) — and the person modal already shows fields the spine
can't supply (Occupation, Spouse, Racial designation, Freedom year — not even columns),
so those sections render empty. Genealogical convention (GEDCOM / Genealogical Proof
Standard) models a person as a bundle of dated, placed, SOURCED events + attributes.

**`person_facts` (migration 096, applied)** is that layer: `(person_id, fact_type, date_*,
place_*, value_text, related_person_id, source_*, confidence, contested)`. fact_type spans
birth/baptism/death/burial/marriage/residence/census/migration/military_service/occupation/
business_affiliation/will/enslavement/sale/manumission/emancipation + attributes
(sex/race_designation/physical_description/ethnicity_origin/...). `canonical_persons` keeps
the stable id + a RECONCILED SUMMARY derived from the facts.

It does four jobs at once: (1) fills the modal; (2) gives the resolver MANY more match
vectors (birth/death dates, marriage, residence, occupation, military) → more rigorous,
fewer false merges (fixes the "simplistic spine"); (3) makes disagreement FACT-level
(two sources differ on birth date → keep BOTH, flag contested); (4) makes mass ingestion
LOSSLESS. Per the en-masse principle: facts come from the AGGREGATED datasets
(Enslaved.org events, Hall dates/origins, FamilySearch vitals, Liberated Africans
registers) — NOT from re-harvesting census/municipal records one by one.

**Integration:** B.5 ingestion writes Enslaved.org/Hall/Liberated-Africans events →
person_facts (with source_external_system + Q-ID). The resolver (B.1–B.2) gains fact-based
comparison vectors. Disagreement detection runs at fact level. A later pass recomputes the
canonical_persons reconciled summary from person_facts and backfills the empty modal
sections.

## Identity model: multiple IDs and what happens when they DISAGREE

Each canonical person will accumulate MANY external IDs (FS, SlaveVoyages, Enslaved.org
Q-ID, Hall, Liberated Africans, eventually 10MN). They WILL disagree. The model mirrors
the obligation reconciliation: disagreement is surfaced, not collapsed; no source is
authoritative.

**Principle.** `canonical_persons.id` is the stable internal spine, DEFINED by the
kin-graph + primary-source evidence — NOT derived from any external ID. External IDs are
attached EVIDENCE/anchors (in `person_external_ids`, each with confidence + match
evidence), never competing masters. So there is no "which ID is real" — ours is; the rest
corroborate.

**Three disagreement types:**
1. **Clustering disagreement (load-bearing — external IDs as ERROR DETECTORS):**
   - two external IDs on one of our persons, but the source treats them as distinct → we
     likely OVER-merged → flag + route to review.
   - two of our persons share one external ID → UNDER-merged (or they over-merged) → review.
   - transitivity violation (P=Q1 via Enslaved.org, P=F1 via FS, but Q1≠F1, OR a Biscoe
     hard constraint forbids) → **hard constraint WINS**, soft external link demoted +
     flagged. NO forced transitive closure.
2. **Attribute disagreement** (birth year/place differ across sources): keep ALL values
   with source + confidence; NEVER overwrite. Displayed value = reconciliation
   (primary-source-wins → highest-confidence); alternatives stay visible.
3. **Match-quality disagreement**: each external ID has a confidence + evidence; a
   low-confidence link CANNOT drive a merge — it corroborates, it doesn't decide.

**Governing rule:** no single source is authoritative; disagreement is surfaced not
collapsed; hard constraints (parentage, census mutual-exclusion — the Biscoe rules)
override soft external agreement; genuine conflicts route to a **"contested identity"
review state** (they do not auto-resolve in either direction). This makes multiple
disagreeing IDs a STRENGTH — external sources cross-check our merges (self-correcting),
the same way the four obligation predictors cross-check each other (Reconcile, applied to
identity).

**Schema implications:** `person_external_ids` gets per-ID confidence + match-evidence +
`agrees_with_canonical` / `contested` flags; a disagreement-detection pass writes
many-to-one / one-to-many / transitivity-violation findings to a review queue; external
agreement never auto-merges across a Biscoe hard constraint.

## Risks
- Over-merge (common given-names like "Mary"/"Tom"): mitigated by owner+census mutual-exclusion + route-on-ambiguity.
- Parallel-population double-canonicalization (epi vs unconfirmed same person twice): resolve both into the same blocks.
- External-source licensing/citation: Enslaved.org/Liberated Africans are academic LOD — confirm reuse terms; carry provenance.
- 10MN has no bulk API — don't block on it; treat as monitor + partnership.
