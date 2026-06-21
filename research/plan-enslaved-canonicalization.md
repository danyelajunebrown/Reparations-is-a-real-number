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

## Risks
- Over-merge (common given-names like "Mary"/"Tom"): mitigated by owner+census mutual-exclusion + route-on-ambiguity.
- Parallel-population double-canonicalization (epi vs unconfirmed same person twice): resolve both into the same blocks.
- External-source licensing/citation: Enslaved.org/Liberated Africans are academic LOD — confirm reuse terms; carry provenance.
- 10MN has no bulk API — don't block on it; treat as monitor + partnership.
