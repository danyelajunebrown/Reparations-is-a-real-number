# DESIGN — Unified `PersonService` (one consolidation for the whole person layer)

_De-siloing fix #2, deep integration. Grounded in `promotion-layer-component-map.md`
(full audited layer) + `standard-canonical-person-and-document-gate.md`. ONE service every
person-creation/promotion path routes through. Review-first: this is the design; no code
until approved. The 3 live-broken `individuals` paths are fixed AS PART of this (not a
separate hotfix), per user._

## The contract — `src/services/PersonService.js`
One entry per concern; every path in the layer uses these and nothing else.

- **`resolve(query) → { match, candidates }`**
  query = {name, birthYear, location, sex, externalId, idSystem, contextKeys?}. Searches the
  UNIFIED pool: `person_blocking_keys` (polymorphic — leads + canonicals, M101) + the DB
  `find_person_match` (Tier-1 external-id, Tier-2 name+date+loc). Returns the best existing
  subject (canonical OR lead) with tier/confidence. **Tier-3 / name-only is NEVER an
  auto-match** — it comes back as `candidates` for review, never `match` (Biscoe rule).
- **`findOrCreateLead(record, source) → leadRef`**
  resolve → strong match returns existing; else CREATE A LEAD (default `unconfirmed_persons`,
  or the typed staging table for bulk sources), write its facts + blocking keys. **Never
  creates a canonical.** This is what scrapers/ingest call.
- **`promoteToCanonical(leadRef, evidence) → canonicalRef`**
  Promote a lead to `canonical_persons` ONLY when (per the standard): identity-resolved
  (deduped) AND ≥ a verified secondary source. Sets the **external-assertion gate**
  (`externally_assertable` per proposition, default FALSE) — lifted only when a
  proposition-specific `person_documents.s3_key` is attached. Writes person_documents +
  person_external_ids.
- **`link(ref, externalId, idSystem)`**, **`merge(a, b)`** (FK-safe, hand-confirmed — fold in
  `scripts/merge-canonical-persons.mjs` + review.js merge), **`addFact(ref, fact)`**.

## Rewire map (every audited path → PersonService)
| Path (audited) | Today | Rewire to |
|---|---|---|
| UnifiedScraper:1977, distributed-scraper | blind INSERT, writes `individuals`/unconfirmed | `findOrCreateLead` (leads only; dedup-on-ingest via blocking keys) |
| OwnerPromotion (LIVE, broken→individuals) | exact-name → `individuals` | `resolve` → `promoteToCanonical` (gated). Dead-table bug fixed here. |
| names.js /resolve(-batch) | NameResolver mints canonical @0.50 | `findOrCreateLead` (+ review for medium conf) |
| wills.js /ingest (good matcher) | location+year match → canonical pending_review | `resolve` (its matcher becomes a `resolve` contributor) → `promoteToCanonical` (has a doc → can lift gate) |
| review.js approve (enslaver_candidates, unresolved_petitions) | curator creates canonical | `promoteToCanonical` (curator-confirmed evidence) |
| review.js merge / cross_source link | FK-safe tools | become `PersonService.merge` / `link` |
| contribute review-queue/approve(-all) | blind enslaved_individuals + hardcoded note | `findOrCreateLead` / `promoteToCanonical` |
| IndividualRepository (/api/research, reads `individuals`) | broken read | repoint to `canonical_persons` (or remove if route dead) |
| NameResolver internals | 2 fragmented matchers, canonical-only | becomes the `resolve` implementation, extended to leads + blocking keys |

## Deletions (after repoint; verify each truly dead first)
Dead `individuals` table (after the 3 live paths repoint); dead classes EntityDeduplicator,
EntityManager, Orchestrator, IntelligentOrchestrator, EnslavedManager, DescendantCalculator,
DocumentParser, LLMAssistant.

## Build sequence (incremental, each verified; NOT yet built)
1. `PersonService.resolve` (read-only; blocking-keys + find_person_match over leads+canonicals).
2. `findOrCreateLead`; rewire the 2 LIVE scrapers (UnifiedScraper, distributed-scraper) → kills
   2 of the 3 live `individuals` writes + adds dedup-on-ingest.
3. `promoteToCanonical` + the gate flag; rewire OwnerPromotion (fixes the 3rd broken path) +
   names.js + wills.js + review.js approves.
4. `merge`/`link` fold-in; repoint IndividualRepository; delete dead table + dead classes.
5. Verify each step (no dup creation, gate respected, broken paths fixed).

## Interlock with #1 / #3 (sequence 2→1→3)
`findOrCreateLead` must produce leads that #1 can later hang relationship edges onto, and #3
can traverse to. So leads carry stable ids + blocking keys now (PAST already does). #1
(lead-aware relationship layer) + #3 (reverse traversal) build ON this.

## Guardrails
Standard-compliant throughout (dedup + ≥secondary + gate; Tier-3 never auto-merged). Each step
its own commit + push (memory bank stays synced). No canonical minted outside `promoteToCanonical`.

## BUILD STATUS
- **Step 1 — `PersonService.resolve` DONE + verified (read-only), Jun 26 2026.**
  `src/services/PersonService.js`. Searches the unified pool (`person_blocking_keys` polymorphic
  over leads+canonicals + `find_person_match` Tier-1 ext-id / Tier-2 name+date+loc), scores,
  ranks. **Key correctness fix caught by read-only test:** common-name false positive — "Mary
  f 1812" auto-matched one of SIX tied "Mary b.181x" PAST leads. Added an **ambiguity guard**:
  never auto-match when ≥1 other candidate ties/near-ties the top score (within 0.05). A MATCH
  now requires name_exact + a non-name corroborator (birth_year/location/external_id) AND no
  near-tie. Verified: "Mary 1812" → no match (candidates only); "Ann Maria Biscoe 1799" → clean
  unique match to canonical #141015; "Ann Biscoe" → no auto-match, surfaces the Biscoe/Briscoe
  cluster as candidates (s4:scoe bridges Biscoe~Briscoe). Has a CLI test mode.
  - Known refinement for later: name-frequency weighting (Fellegi-Sunter) + key-scheme
    harmonization so first-name leads can match first-name canonicals.
- **BROAD VALIDATION (`tests/unit/test-person-resolve.js`, committed regression test):**
  curated 10/10 (ambiguity, unique match, surname cluster, external-id Tier-1, no-match,
  placeholder) + statistical self-match over 800 random real samples = 400 canonicals
  (60.5% self / **0% false-pos** / 39.5% no-match) + 400 PAST first-name leads, the
  riskiest population (58.5% self / **0% false-pos** / 41.5% no-match). **TOTAL false
  positives across 800 = 0.** The ~40% no-match is the correct conservative behavior
  (common-name cases → review candidates, never auto-link). Matcher is SAFE.
- **Step 2a — `findOrCreateLead` + `_writeBlockingKeys` DONE + verified, Jun 26 2026.**
  resolve → confident-unambiguous match LINKS (never duplicates); else creates a LEAD in
  unconfirmed_persons + its blocking keys (never a canonical). `opts.dryRun` supported.
  `tests/unit/test-person-findorcreate.js` (self-cleaning, 7/7): dry-run, create,
  resolve-finds-it, **re-ingest LINKS (no dup)**, cleanup. **Two real bugs caught by testing
  (broad-test discipline paid off):** (1) `_fetchSubjects` read `name` from unconfirmed_persons
  but the column is `full_name` (+ has birth_year/gender); (2) **key-selectivity flooding** — a
  single `WHERE key_value = ANY(...) LIMIT` let common keys (`sn:harris`, `mp:UNKPRSN` ↔ every
  Henderson/Anderson) crowd out a selective key's matches (`nmsx:harriswilliam`), causing a
  self-match miss + 1 false positive. Fixed with PER-KEY lookup + per-key cap. Re-validated:
  resolve curated 10/10 + 800-sample statistical = **0 false positives** (recall ~61%/62%).
- **Step 2b — rewire the 2 live scrapers onto findOrCreateLead — DONE + verified, Jun 26 2026.**
  - 2b/1 `distributed-scraper.js` `/submit-data` (live 1860 multi-device path): blind
    unconfirmed_persons INSERT → `findOrCreateLead` (dedup + blocking keys), reports
    dedupedCount. Committed `fb5c961ca`.
  - 2b/2 `scraping/UnifiedScraper.js` `saveResults`: **dropped the dead `individuals` +
    `slaveholder_records` writes**; owners + enslaved now route through `findOrCreateLead`
    (enslaved carry the `enslaved_by` relationship via the new `relationships` JSONB on
    `findOrCreateLead`'s INSERT). **Behavior change (deliberate, standard-compliant):** the
    scraper no longer self-sets `status='confirmed'` for high-confidence owners — all leads are
    `'pending'`; confirmation is the separate gated `promoteToCanonical` step. Verified
    end-to-end: owner+enslaved created, relationship persisted, 5 blocking keys, re-ingest
    LINKS (no dup), findOrCreate regression 7/7.
  - **Kills 2 of the 3 live `individuals`-table writes.** The 3rd (OwnerPromotion) is fixed in
    step 3 (`promoteToCanonical` + gate) — NEXT.
- **Step 3 — `promoteToCanonical` + external-assertion gate + OwnerPromotion rewire — DONE +
  verified, Jun 26 2026.**
  - **M102** added `assertable_slaveowner` + `assertable_enslaved` booleans to canonical_persons
    (default FALSE = conservatively gated; index `idx_canonical_assertable`). Operationally inert
    until a consumer reads them (search filter = deliberate next step). All 676,881 existing
    canonicals start gated; a measured recompute backfill un-gates the documented ones (NOT yet
    run — flagged below).
  - **`PersonService.promoteToCanonical(leadRef, evidence, opts)`**: dedup via resolve (unambiguous
    existing canonical → LINK, never duplicate; ambiguous → `needs_review`, Biscoe); else CREATE
    canonical (≥secondary; writes soundex/metaphone + blocking keys so it's discoverable — better
    than the current `system` path which writes neither); writes person_documents (s3_key only for a
    real stored file) + optional external id; `recomputeGate`; marks the source lead 'promoted' AND
    deletes its blocking keys (so it stops competing with its own canonical → no false ambiguity).
  - **`recomputeGate(canonicalId)`**: per-proposition booleans DERIVED from person_documents —
    assertable only when a row has `s3_key` present AND a `document_type` in DOC_PROP_SLAVEOWNER /
    DOC_PROP_ENSLAVED. Bare profiles (familysearch_record/tree_profile), 'other', and URL-only
    secondary records substantiate NOTHING.
  - **OwnerPromotion rewired**: keeps its confirmatory-channel/confidence gate; routes through
    findOrCreateLead + promoteToCanonical (no more dead `individuals`/`slaveholder_records` writes);
    `getStats` repointed to canonical_persons; `contribute.js /promote/:leadId` returns canonicalId
    + gate. **3rd of 3 dead-`individuals` writes ELIMINATED.**
  - Tests: `tests/unit/test-person-promote.js` 11/11 (gated-by-default mint, dedup-link no-dup,
    blocking keys, lead-promoted, stored doc lifts slaveowner gate only). OwnerPromotion e2e 5/5.
    resolve + findOrCreateLead regressions still green (0 false positives).
  - **FLAGGED, not yet done (deliberate next steps):** (a) retroactive `recompute-assertion-gates`
    backfill over all 677K canonicals — a measured, reported visibility flip; (b) wiring the public
    search/API + "was a slaveowner/enslaved" UI strings to FILTER on the gate (the consumer side —
    until then the gate columns exist but nothing reads them). NEXT after these: step 4 merge/link +
    delete dead `individuals` table/classes; then #1 lead-aware relationships + #3 reverse traversal.
