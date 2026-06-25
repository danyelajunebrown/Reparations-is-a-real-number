# PLAN — Lead Identity Resolution (one dedup layer across leads + canonicals)

_Plan doc, June 24 2026. Grounded in `plan-identity-resolution-completion.md`
(tiered fingerprint; collisions = candidates not confirmations; Tier-3 name-only
NEVER auto-merged; placeholder/unnamed never merged) and
`standard-canonical-person-and-document-gate.md` (dedup is a SEPARATE axis from
canonicalization; leads carry facts; nothing here mints canonicals). Decision (i),
user Jun 24: extend the EXISTING identity-resolution layer to operate on LEADS, not
build a parallel one._

## Existing infrastructure (verified present — extend, don't reinvent)
- `person_blocking_keys` (1,454,044 keys) — currently keyed to `canonical_persons`.
- `dedup_candidate_pairs` (7,056), `cross_source_candidates`, `person_merge_log`,
  `enslaver_candidates_review_queue` (review queues).
- `scripts/populate-blocking-keys.mjs`, `scripts/resolve-canonical-dedup.mjs`,
  `scripts/validate-blocking.mjs`, `scripts/lib/name-normalize.mjs`.
- (Verify these scripts' exact scoring/columns against code at build time — this plan
  is at design altitude.)

## Goal
Make leads (`slavevoyages_past_people` first; then `hall_slave_records`,
`unconfirmed_persons`) first-class participants in the dedup/identity-resolution layer:
blocking keys → candidate pairs → human review. **No auto-merge. No canonical
creation.** "Dedup well underway without canonicalization" (user).

## Why PAST needs context-blocking, not name-blocking
PAST is first-name-only (Bora, Pao), no surname, no US state (African Origins =
liberated Africans; Oceans of Kinfolk = LA; Texas Bound = TX). The plan's standard
tiers (last_name + birth_year + state) don't fit. Block on the strong context PAST
DOES carry: `voyage_id`, `ship_name`, `year`, ports, `sex`, `age`(→birth-year),
`language_group`, `owner_name`. Bare-name blocking is forbidden (Biscoe rule).

## Design
1. **Schema** — extend blocking keys + candidate tables to a POLYMORPHIC subject
   (`subject_table`, `subject_id`) so one layer spans canonical + every lead table.
   (Migration. Decide: widen `person_blocking_keys` vs a sibling `lead_blocking_keys`
   unioned in — lean toward widening for a single layer.)
2. **Blocking passes** (all → review, zero auto-merge, all Tier-3 by the plan's rule
   because first-name-based):
   - *Intra-PAST*: block on `voyage_id` (or `owner_name`+`year` for OOK) → within-block
     compare normalized name + sex + age(±2). Low expected yield (curated source).
   - *Cross-source*: PAST ↔ Hall ↔ 1860 ↔ existing persons, surfaced ONLY when MULTIPLE
     signals corroborate (name + sex + birth-year window + disembark region/owner) →
     `cross_source_candidates`.
   - *Exclude* generated "Unnamed enslaved person …" rows + numeric/placeholder names.
3. **Scoring/routing** — reuse `resolve-canonical-dedup.mjs` scoring; everything PAST
   routes to the review queue (`dedup_candidate_pairs` / `cross_source_candidates`),
   never auto-merge.

## De-siloing / surfacing — FIRST-CLASS REQUIREMENT (user: "very concerned")
The point of dedup-on-leads is that already-verified information NEVER orphans: when a
future document enters for, e.g., a grandchild/great-grandchild of an enslaved person,
the system must be able to TRAVERSE to the existing ancestor leads + facts + clusters
and proceed — not hit a dead end. This is the de-siloing imperative
([[project_direction_identity_over_payment]]). Bake in:
- **Every lead is reachable** via the blocking/candidate layer (that's why (i) — one
  layer, not a PAST silo).
- **Clusters link across the boundary** lead ↔ canonical ↔ relationships
  (`family_relationships` / kinship edges / `enslaver_lineage_ledger` /
  `chattel_transfer_events`), so descendant→ancestor traversal works.
- **Intake/contribute matching must search LEADS, not just canonicals** — a new
  document must be able to match an existing lead (else new inflow re-orphans).
- The single **evidence layer** (facts attach to leads + canonicals uniformly) keeps
  facts queryable across the boundary.

→ **Separate near-term ASSESSMENT (do NOT block this build):** audit the larger
codebase for orphaning/siloing risk before exponential growth — specifically the
contribute/intake matching scope, the relationship layer's lead-awareness, and the
descendant-linking path (ancestor climb → enslaved-ancestor lead). Track as its own
item; findings feed back here.

## Sequencing (then we build)
1. Migration: polymorphic subject on blocking keys + candidate tables.
2. Populate blocking keys for PAST leads (`populate-blocking-keys.mjs`, lead-aware).
3. Candidate generation (intra + cross-source) → review tables. Dry-run report first
   (measure yield) per the plan's "measure how bad dedup is" step.
4. Surface in the `/review` UI. NO auto-merge, NO canonicalization.
5. THEN (separate plan) the external-assertion gate mechanism.

## MEASURED OUTCOME (Jun 25 2026 — measure-first paid off)
M101 applied (blocking keys + cross_source_candidates polymorphic). PAST leads keyed:
`scripts/populate-blocking-keys-slavevoyages-past.mjs` wrote **637,001 context keys
across 165,715 leads** (voy/own/nmsx/nmsxb; never bare name). Intra-PAST dedup yield
**measured and rejected**: name signals are ~all false positives — `nmsx` ~6.7M pairs,
`nmsxb` ~1.2M (295 distinct "Mary/f/1810s", 239 "John"…); even **same-voyage** +
name+sex is contaminated (voyage 131071: 83 "Joe", 78 "Boy/f"…) = distinct people with
common/generic assigned names on large voyages. PAST is a CURATED source → no usable
internal duplication. **Decision: build NO intra-PAST candidate/review queue** (it would
be ~100% reviewer waste). The blocking keys' value is **discoverability for FUTURE
cross-source matching + de-siloing readiness**, not intra-PAST merging. Biscoe rule
empirically vindicated.

So for SlaveVoyages PAST the dedup step is COMPLETE (nothing to merge; leads blockable).
Next per the agreed sequence = the external-assertion GATE mechanism (separate plan);
that is also where the C1/Hall secondary-only-canonical debt is addressed.

## Out of scope
The gate mechanism; the broader codebase de-siloing assessment (tracked separately);
any canonical creation/promotion.
