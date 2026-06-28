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

### #1 — Lead-aware relationship/lineage layer — DONE (M103, Jun 27 2026)
**Built + verified.** Decision (user): M101 POLYMORPHIC `(subject_table, subject_id)` (not dual-id
columns). **Migration 103** retrofitted `canonical_family_edges` (kinship, 1,658 rows backfilled),
`person_relationships_verified` (kinship, 12 rows), and `enslaved_owner_relationships` (ownership,
empty) with `*_subject_table`/`*_subject_id` columns + a BEFORE INSERT/UPDATE **sync trigger** per
table (legacy canonical/unconfirmed id ⇄ polymorphic ref). Legacy `NOT NULL` on the canonical id
columns relaxed so a lead-only endpoint is possible; legacy FKs KEPT (integrity for the canonical
convenience columns); polymorphic partial-unique on cfe dedups lead edges. **Back-compat: the 5
cfe writers + the live ancestor-climber (prv) keep working unchanged** (trigger fills the new cols);
new polymorphic writers set `*_subject_*` directly and leave the legacy canonical id NULL for a lead.
`tests/unit/test-lead-aware-edges.js` 6/6 (legacy-compat, PAST lead as kinship + ownership endpoint
w/ no FK violation, queryable, legacy sync). **NOTE:** schema is now lead-CAPABLE; POPULATING lead
edges (from PAST enslavers[], Hall transfers, unconfirmed_persons.relationships JSONB) is a separate
producer step. `slaveholding_relationships` (redundant, empty, 1 writer) left as-is — reconcile/drop
in step 4. `family_relationships` (2M, name+lead_id, no FK) deferred to its own later migration (add
a `lead_table` qualifier) — the DAA reads it by name, so it needs a careful separate pass.

### #1 (original sketch) — Lead-aware relationship/lineage layer (foundational, invasive)
- Adopt the **M101 polymorphic person-ref** `(subject_table, subject_id)` for the
  kinship + ownership edge tables so ANY lead (PAST/Hall/unconfirmed) or canonical can
  be an endpoint. Tables: `canonical_family_edges`, `person_relationships_verified`
  (kinship); `enslaved_owner_relationships` / `slaveholding_relationships` (ownership —
  extend beyond unconfirmed). `family_relationships` (2.0M, name+lead_id): add a
  `lead_table` qualifier rather than rewrite — lower risk.
- Additive + backfill existing rows to `canonical_persons` / `unconfirmed_persons`.
  Decision to surface: polymorphic columns vs keep the dual-id-column style already in
  the unused ownership tables.

### Producer (between #1 and #3) — enslaved→owner edges — DONE (Jun 27 2026)
`scripts/build-enslaved-owner-edges.mjs` materializes `enslaved_owner_relationships` (the M103
lead-aware ownership table; M104 added a polymorphic unique for idempotent ON CONFLICT) from two
sources, keeping the enslaved person a LEAD: (1) `unconfirmed_persons.relationships` enslaved_by
(name OR related_to owner); (2) PAST `raw->enslavers`, **role-filtered to Owner/Buyer/Seller only**
(Captain/Shipper/Investor/Consignor excluded — a captain is not the owner). Owner resolution is
name-only: reuse an existing owner lead by exact normalized name, else create one
(findOrCreateLead — lead + blocking keys, NEVER a canonical); distinct same-name owner splitting +
owner-lead→canonical-enslaver linking DEFERRED to identity resolution. Dry-run measured **24,814
ownership statements** (≈14K unconfirmed + ≈10K PAST ownership-role). **Two bugs fixed during the run:** (1) `person_blocking_keys.key_value` is varchar(64); long owner
names overflowed → capped every key at 64 in `PersonService._queryKeys` (symmetric read/write,
matching preserved). (2) PERF: `getOwnerRef` did an unindexed `lower(regexp_replace(full_name))=$1`
per owner → a 2.4M-row seq-scan each → grindingly slow; replaced with a ONE-TIME preload of all
~371K owner-type leads into an in-memory Map (308,478 distinct names) → O(1) owner resolution.
Idempotent re-run (edge unique skips written edges; preload reuses prior owner leads → no dup leads).
**DATA-QUALITY NOTE:** the unconfirmed enslaved_by source carries pre-existing OCR/parse junk
(owner "William H.", enslaved "Act"/"And I") — surfaced, not introduced; MatchVerifier re-checks
before payment; these are gated leads.

### #3 — Reverse descendant→enslaved-ancestor traversal — DONE (name-matched Source 4, Jun 27 2026)
Decision (user): name-matched Source 4 now (proper owner-lead→canonical linking is the follow-up).
`DAAOrchestrator.aggregateEnslavedData` gained **Source 4**: reads `enslaved_owner_relationships`
WHERE `lower(owner_name)=lower(slaveholder_name)` AND `relationship_type='enslaved_by'`, returning
enslaved persons that are LEADS (SlaveVoyages PAST / Hall / unconfirmed) — the de-siloing payoff,
internal-only (the external-assertion gate doesn't apply to DAA computation). Merged + deduped by
name with Sources 1–3. **Also fixed Source 3's latent bug:** it read `relationships->>'enslaved_by'`
as an OBJECT, but the column is a JSONB ARRAY of `{type,name|related_to}` → it silently matched ZERO
array-shaped rows; now matches array elements. Verified: Source 4 returns enslaved leads for an
owner name (mechanism proven against the populated edges). Same name-ambiguity caveat as Source 2.

### #3 (original sketch) — Reverse descendant→enslaved-ancestor traversal (needs #1)
- Add an FK-graph path from a canonical descendant → (lead-aware) relationship edges →
  enslaved ancestors (lead or canonical), replacing the enslaver-NAME-string lookups in
  `DAAOrchestrator.aggregateEnslavedData`. So a descendant's document reaches enslaved
  ancestors that are leads.

## Next-item lineup (prioritized backlog, after 2→1→3 done — Jun 27 2026)
The full de-siloing arc (#2 PersonService consolidation + gate; #1 lead-aware edges; producer + #3
reverse reach) is COMMITTED. Remaining, in recommended order:

1. **Owner-lead → canonical-enslaver linking** (upgrades #3 from name-match to FK; the principled
   robustness win). Resolve the ~name-only owner leads the producer created to existing canonical
   enslavers via the cross-source layer (cross_source_candidates / resolve-cross-source-enslavers /
   issue #63), review-gated + Biscoe-safe. Then #3's Source 4 can also traverse by owner subject ref,
   not just name. **RECOMMENDED NEXT** — it makes the just-built #3 reliable and is squarely the
   identity-resolution spine the project prioritizes.
2. **Step 4 cleanup** — fold `merge`/`link` into PersonService; verify-then-DELETE the dead
   `individuals` table + dead classes (EntityDeduplicator, EntityManager, Orchestrator,
   IntelligentOrchestrator, EnslavedManager, DescendantCalculator, DocumentParser, LLMAssistant);
   reconcile/drop the redundant empty `slaveholding_relationships`. Hard-to-reverse deletions — verify
   each is truly unused first.
3. **`family_relationships` (2M) lead_table qualifier** — its own migration; the DAA reads it by name.
4. **Gate search-wiring** — the held outward 94% visibility flip (public search/API + UI filter on
   `assertable_*`); product decision, likely a 'public-assertion vs research' mode.
5. **Data-quality pass** — the unconfirmed `enslaved_by` OCR/parse junk (owner "William H.", enslaved
   "Act"/"And I") surfaced by the producer/#3; clean or quarantine (these are gated leads).

## Guardrails
- No canonical minted without the standard (dedup + ≥secondary; gated until S3 doc).
- Dry-run + measure before each apply. Each fix its own commit, pushed (memory bank +
  GitHub stay in sync).
- These must precede exponential growth (user's explicit concern).
