# NOTE — Climb name/parent resolution session (Jun 27 2026) — SILO ALERT

_Cross-session awareness, written so the de-siloing/identity-resolution effort
(`plan-de-siloing-fixes.md`, `design-person-service-consolidation.md`) knows what a
parallel session produced. TL;DR: a worksheet session minted people OUTSIDE the
shared identity layer — they need blocking-key backfill + dedup._

## What this session ran (Adrian Brown climb, session f4a5b049)
1. `scripts/resolve-climb-ancestors.js` — re-queried FamilySearch for every visited
   ancestor; NAMED ~992 new people and backfilled birth/death place. Writes
   `canonical_persons` (created_by='climb_name_resolver', confidence 0.9) +
   `person_external_ids` **via direct INSERT**.
2. `scripts/scrape-parents.js` (NEW) — scrapes each visited person's PARENTS from the
   FS details page (data-testid `family-<father>_<mother>` + `focusPersonHighlight`),
   writing child→parent edges to `inferred_parent_links`
   (discovery_method='details-parent-scrape'). Running now (~3.9K persons).
3. `scripts/generate-lineage-worksheet.mjs` (NEW) — renders ancestors grouped by
   apical ancestor for inheritance tracing.

## THE SILO (must reconcile)
- **992 `canonical_persons` minted with 0 `person_blocking_keys`** → invisible to
  `find_person_match` / `PersonService.resolve` / every other producer. Verified:
  `created_by='climb_name_resolver'` count 992, blocking-key join = 0.
- Scripts **never call `find_person_match` before INSERT** → possible duplicates of
  existing canonical/lead identities (the exact de-siloing failure mode).
- These are minted as **canonical**, bypassing the "no canonical without the standard
  (dedup + ≥secondary, gated until S3 doc)" guardrail — arguably should have been
  **leads** (`unconfirmed_persons`) via `findOrCreateLead`.
- Parent edges land only in `inferred_parent_links`, NOT the lead-aware
  `canonical_family_edges` (M103) → the #3 reverse-traversal can't see them.

## RECONCILE DONE (Jun 27 2026, `scripts/reconcile-climb-minted.js`)
Ran PersonService against all 992. **Pass 1:** blocking keys backfilled for **970/992**
(+4,575 key rows) via `_writeBlockingKeys('canonical_persons',…)` — the silo is closed;
they now answer `find_person_match`/`resolve`. (22 unkeyed = no usable name.) **Pass 2**
(resolve, Biscoe-safe): **0 strong duplicates**, 28 ambiguous common-name collisions, 964
clean. So these were genuinely NEW identities, not duplicate canonical rows — **no merge
needed**. The 28 ambiguous are listed in `worksheets/dedup-candidates.json` for review
(NOT auto-merged). STILL OPEN: (a) they're minted canonical (not gated leads); (b) parent
edges still only in `inferred_parent_links`, not `canonical_family_edges`.

## FIX (remaining — coordinate)
1. **Backfill blocking keys** for the 992 via `PersonService._writeBlockingKeys('canonical_persons', id, {name,sex,birthYear})` so they join the shared layer.
2. **Dedup pass**: run each through `PersonService.resolve()`; merge/link matches to
   existing canonical/lead persons instead of leaving parallel rows.
3. **Forward**: route both scripts' writes through `PersonService` (resolve-before-
   insert; mint leads not canonical unless gated). Mirror parent edges into
   `canonical_family_edges` (polymorphic subject ref) so #3 reaches them.
4. Re-run the lineage worksheet after reconciliation.

## DE-SILOING STATUS — climb is the LAST bypass door (Jul 1, 2026) — COORDINATE

The "finish PersonService as the ONE door" refactor (A of
[[reckoning-retrieval-epistemology-and-workaround-debt]]) routed **6 of 7 live bypass writers** through
PersonService: ExtractionWorker, Orchestrator, NameResolver, wills.js, review.js, contribute.js
(commits 71892b69c → 44d40d384). **The climb writers are the ONLY remaining live silo**, left UNTOUCHED
on purpose because they're the parallel climb session's active files (avoid collision).

**When the climb work next pauses, close the door here** (the forward-fix from the FIX list above):
- `scripts/resolve-climb-ancestors.js:220` — mints `canonical_persons` directly (created_by=
  'climb_name_resolver'), no blocking keys → born a silo. Route through PersonService: prefer minting a
  LEAD (findOrCreateLead) unless a gate-qualifying document exists; if a canonical is genuinely warranted,
  at minimum call `PersonService._writeBlockingKeys('canonical_persons', id, {name,sex,birthYear})` right
  after insert (the pattern doors 3–5 use).
- `scripts/scrapers/familysearch-ancestor-climber.js:2091/2116/3317` — same: canonical INSERTs with no
  keys (uses find_person_match but that doesn't write keys). Same fix.
- Mirror parent edges into `canonical_family_edges` (polymorphic ref) so #3 reverse-traversal reaches them.
- Interim safety-net remains `scripts/reconcile-climb-minted.js` (backfills keys after the fact).

## "How to be aware everywhere" (the mechanism, for future producers)
- **Single source of truth = the Neon DB**, but only if writes go through the shared
  identity layer: `PersonService` → `find_person_match` + `person_blocking_keys`
  (polymorphic `subject_table`/`subject_id`). A producer that bypasses it (like the two
  scripts above) creates a silo no matter how correct its data is.
- **`person_blocking_keys` is the cross-table index** (key_types: sn, mp, s4, nmsx, voy,
  nmsxb, own). Populate it for every person and all producers can find all people.
- **This memory-bank is the cross-session/agent log** — register long-running producers
  here when you start them, so parallel sessions don't duplicate or collide.
