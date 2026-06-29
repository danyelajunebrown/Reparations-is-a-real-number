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

1. **Owner-lead → canonical-enslaver linking — DONE (Jun 27 2026).** Turned out to be largely the
   PRE-EXISTING `resolve-cross-source-enslavers.mjs` (name+location scoring, Jaro-Winkler, multi-match
   → review, Biscoe-safe, writes `cross_source_candidates`, links via
   `unconfirmed_persons.confirmed_individual_id`). Two changes: (a) extended its person_type filter to
   include `owner`/`suspected_owner` (it only covered `enslaver`/`slaveholder` → missed the producer's
   owner leads); (b) fixed an **M101 fallout** — `cross_source_candidates` went polymorphic so its
   unique is now `(canonical_person_id, lead_table, unconfirmed_lead_id)`; the resolver's old 2-col
   ON CONFLICT no longer matched an arbiter index (errored). Applied: **10,902 candidates (5,159
   review + 5,743 auto_link_candidate)** to the `cross_source_enslavers` review queue. **#3 Source 4
   upgraded** (DAAOrchestrator): now matches owner by the FK link too —
   `owner_subject=canonical` / `owner_canonical_id` / `o.confirmed_individual_id = slaveholder_id` —
   in addition to name; so once a candidate is human-reviewed/confirmed, the DAA reaches that owner's
   enslaved by FK, not name. REMAINING DATA STEPS: (i) re-run the resolver after the producer fully
   completes (to include PAST owners); (ii) human review of the candidates confirms the links →
   activates FK traversal. NEVER auto-links (Biscoe).
2. **Step 4 cleanup — VERIFICATION DONE (Jun 27 2026); deletions awaiting user confirmation.**
   Read-only audit findings:
   - **The `individuals` TABLE ALREADY DOES NOT EXIST** in the DB (dropped previously). So there is
     NOTHING to drop. The audit's "3 live writers" were runtime BOMBS (would error — table absent).
     The 2 reachable writers were rewired (OwnerPromotion step 3, UnifiedScraper step 2b/2);
     `IndividualRepository.saveWithDocument` is the 3rd but is **never called** (dormant). No live
     `individuals` write can execute. **No views/FKs depend on `individuals`.** (Correction to the
     earlier "eliminated all 3 writers" wording: precisely, the 2 reachable writers were rewired; the
     table itself was already gone.)
   - **Dead classes — SAFE to delete now (required by ZERO files):** `EntityDeduplicator`,
     `EnslavedManager`, `DescendantCalculator`, `NLPAssistant`.
   - **Dead classes — REQUIRE-CHAINED (cut the require first):** `IndividualRepository` ← LIVE
     `ResearchService` (but ResearchService's getStatistics uses the `stats_dashboard` view, not the
     repo — the require looks UNUSED; confirm, then drop the require + the file). `EntityManager` ←
     `LLMAssistant` + demo. `LLMAssistant` ← `DocumentParser`. `DocumentParser` ← train-parser test.
     `Orchestrator` ← 2 scraper scripts. `IntelligentOrchestrator` ← `scraping/index.js` (itself
     required by nothing). These are all DEAD from the live server (only standalone scripts/tests
     reach them); deleting requires removing those script requires too.
   - **DONE (Jun 27-28, user chose "safe deletes + merge/link"):** Deleted the 4 zero-reference dead
     classes (`EntityDeduplicator`, `EnslavedManager`, `DescendantCalculator`, `NLPAssistant`) — no
     dangling refs remain in src/. Folded **`PersonService.merge(survivorId, victimId, {dryRun})`**
     (FK-safe: enrich survivor, re-point every FK canonical_persons ref victim→survivor with
     unique-collision row-walk, mark victim person_type='merged', log to person_merge_log) +
     **`PersonService.link(ref, externalId, idSystem)`** (person_external_ids upsert, canonical-only).
     `scripts/merge-canonical-persons.mjs` is now a thin CLI wrapper around PersonService.merge (one
     implementation). Tested 6/6 (dry-run, apply, FK re-point, victim merged, log, link). The
     individuals TABLE needed no drop (already absent).
   - **STILL TODO (deferred, needs require-cuts first / own pass):** the require-chained dead cluster
     (`IndividualRepository`←ResearchService unused require; `EntityManager`/`LLMAssistant`/
     `DocumentParser`/`Orchestrator`/`IntelligentOrchestrator` + their standalone scripts);
     reconcile/drop redundant empty `slaveholding_relationships`.
3. **`family_relationships` (2M) lead_table qualifier** — its own migration; the DAA reads it by name.
4. **Gate search-wiring — BACKEND DONE (Jun 28); frontend polish follows.** User decisions:
   Q1=neutral stub for gated direct links; Q2=yes authenticated research/curator bypass (admin
   token); Q3=yes isVerified treats gated as not-public; Q4=backend-first. **Implemented (backend):**
   `middleware/admin-auth.js` gained non-blocking `isAdmin(req)` (research-view bypass; dev w/o
   ADMIN_TOKEN = open). `contribute.js`: `canonicalGateClause(req)` appended to the search id-query
   + text-search canonical WHERE; `GET /person/:id` returns a name-only NEUTRAL STUB
   (`{gated:true, gatedMessage}`) for a fully-gated canonical to non-admin. `names.js` `/search` +
   `/candidates` pass `includeGated: isAdmin(req)`; `/canonical/:id` returns the stub. `NameResolver`
   `searchSimilarNames`/`findCandidateMatches` got an `includeGated` option (default = internal sees
   all; `false` = public filter; WHERE OR-groups wrapped so the AND binds correctly). **Verified:**
   public search hides gated / admin sees all; isAdmin token logic; NameResolver internal-vs-public.
   Insight: the assertable flag that's true matches the person's role, so the fully-gated stub
   (neither flag) is the decisive guarantee — partial cases are self-consistent (slaveowner-only
   33,524; enslaved-only 121). enslaved_individuals + unconfirmed LEADS are a separate tier (NOT
   gated by these canonical flags — NOTE: producer's `suspected_owner` leads still show in public
   search; flag for the leads-visibility question). **FRONTEND POLISH — DONE (Jun 28):**
   `PersonProfile.jsx` renders the `{gated:true}` stub (name + gatedMessage, no claim) before the
   verified check; `client.js isVerified()` treats a canonical as not-public-verified when
   `gated===true` or `assertable_*` present-and-false (defense-in-depth; public API already filters).
   `SearchPage.jsx` needed NO change (API-filtered results are inherently safe). Frontend `npm run
   build` ✓. ④ COMPLETE (backend + frontend). **Backend public paths to filter** (add
   `AND (assertable_slaveowner OR assertable_enslaved)`): `contribute.js` `GET /search/:query`
   (id query ~L190, text query WHERE ~L305) + `GET /person/:id` (~L858); `NameResolver.js`
   searchSimilarNames (~L546) via `names.js` `/search`,`/candidates`; `names.js` `GET /canonical/:id`
   (~L280). **Already excludes** person_type IN (descendant,modern_person,participant,merged) —
   same pattern. **Frontend**: `client.js isVerified()` (~L193) treats ALL canonical as verified →
   must AND the gate; `SearchPage.jsx` (~L164) + `PersonProfile.jsx` person_type header (~L101) +
   enslaved-persons list (~L170) must render per-proposition (PersonProfile already has an
   `adminOverride` prop ~L26 to bypass). **Do NOT gate** (internal): DAAOrchestrator, ancestor-climber,
   wills.js lookupCanonicalByName, review.js (admin-token). **OPEN QUESTIONS (await user):**
   (Q1) direct public `/person/:id` to a gated person → 404/"unavailable" vs name-only neutral stub
   w/ "documentation pending"; (Q2) authenticated research/curator view that bypasses the gate (via
   existing admin token / a researcher role) so the team can see gated persons internally; (Q3)
   confirm per-proposition display (show only the documented proposition, suppress the other);
   (Q4) make `isVerified()` treat gated canonicals as NOT publicly-verified (align verified-only
   filters with the gate). Standard MANDATES: hidden from public search + never externally assert
   until a stored proposition-specific doc; internal/authenticated use is fine.
5. **Data-quality pass** — the unconfirmed `enslaved_by` OCR/parse junk (owner "William H.", enslaved
   "Act"/"And I") surfaced by the producer/#3; clean or quarantine (these are gated leads).

## Guardrails
- No canonical minted without the standard (dedup + ≥secondary; gated until S3 doc).
- Dry-run + measure before each apply. Each fix its own commit, pushed (memory bank +
  GitHub stay in sync).
- These must precede exponential growth (user's explicit concern).
