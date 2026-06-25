# PLAN — De-siloing Fixes 1–3 (build plan, Jun 25 2026)

_From `assessment-de-siloing-orphaning.md`. User: "digest fully then proceed with 1-3."
Grounded in firsthand schema/code reads. These are CORE/invasive and interdependent;
build incrementally, each as its own migration/PR, dry-run first._

## Digested ground truth (firsthand)
- Intake promotion (`OwnerPromotion.js:201`) writes the legacy **`individuals`** table,
  exact lower(full_name) match — touches neither canonical_persons nor leads nor
  `person_blocking_keys` nor `find_person_match`.
- `family_relationships` (**2.0M rows**): name + `person1_lead_id`/`person2_lead_id`
  (no canonical FK). The DAA reads enslaved by **name string** here.
- Kinship FK edges canonical-only + tiny: `canonical_family_edges` (1,658),
  `person_relationships_verified` (12).
- `enslaved_owner_relationships` / `slaveholding_relationships`: dual-keyed
  (canonical_id + unconfirmed lead_id) but **0 rows / unused**; know only
  `unconfirmed_persons`, not `slavevoyages_past_people` / `hall_slave_records`.
- `find_person_match(name,birth_year,location,person_type,external_id,id_system)` exists,
  canonical-only.

## Recommended BUILD ORDER (differs from 1-2-3 by dependency + active risk)
**#2 first** (stops the active bleed + leverages what we just built), then **#1**
(foundational schema), then **#3** (traversal, needs #1). Rationale: every new
contribution duplicates/orphans NOW (#2); #2's matching can use the M101 polymorphic
`person_blocking_keys` we already populated for PAST. #1 is the biggest/riskiest; #3
depends on #1.

### #2 — Wire intake to the matching + blocking layer (contained)
- Before insert, the promote path must search EXISTING people across canonical_persons
  AND lead tables via `find_person_match` + a `person_blocking_keys` lookup (now
  polymorphic), and LINK instead of duplicating.
- Reconcile the `individuals` silo: promotion should resolve/attach to the
  canonical/lead identity layer (gated per the canonical/document standard), not a
  separate `individuals` table. (Decide: migrate `individuals` usage, or bridge it.)
- Leverages M101 + the 637K PAST lead keys already written.

### #1 — Lead-aware relationship/lineage layer (foundational, invasive)
- Adopt the **M101 polymorphic person-ref** `(subject_table, subject_id)` for the
  kinship + ownership edge tables so ANY lead (PAST/Hall/unconfirmed) or canonical can
  be an endpoint. Tables: `canonical_family_edges`, `person_relationships_verified`
  (kinship); `enslaved_owner_relationships` / `slaveholding_relationships` (ownership —
  extend beyond unconfirmed). `family_relationships` (2.0M, name+lead_id): add a
  `lead_table` qualifier rather than rewrite — lower risk.
- Additive + backfill existing rows to `canonical_persons` / `unconfirmed_persons`.
  Decision to surface: polymorphic columns vs keep the dual-id-column style already in
  the unused ownership tables.

### #3 — Reverse descendant→enslaved-ancestor traversal (needs #1)
- Add an FK-graph path from a canonical descendant → (lead-aware) relationship edges →
  enslaved ancestors (lead or canonical), replacing the enslaver-NAME-string lookups in
  `DAAOrchestrator.aggregateEnslavedData`. So a descendant's document reaches enslaved
  ancestors that are leads.

## Guardrails
- No canonical minted without the standard (dedup + ≥secondary; gated until S3 doc).
- Dry-run + measure before each apply. Each fix its own commit, pushed (memory bank +
  GitHub stay in sync).
- These must precede exponential growth (user's explicit concern).
