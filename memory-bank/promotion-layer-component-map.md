# Promotion / Person-Creation Layer — Component Map

_Inventory for de-siloing fix #2 (broad consolidation). User: consolidate the whole
promotion layer onto canonical + matching, but with a FOCUSED RESEARCH PASS per
component first so we don't break things or silo more. This is the map; each component
gets its own read-only research pass → findings here → design → build → verify, ONE at a
time. Nothing is changed until its component is researched._

## Components by table written (live src/, from grep Jun 26 2026)

### MATCHING CORE — consolidate ONTO this (research FIRST)
- `src/services/NameResolver.js` — INSERT canonical_persons:203, person_external_ids:736;
  wraps `find_person_match()` (resolveWithTiers / resolveByExternalId / linkExternalId).
- DB fn `find_person_match(name,birth_year,location,person_type,external_id,id_system)` —
  canonical-only (Tier1 ext-id / Tier2 name+date+loc / Tier3 name).
- `person_blocking_keys` — now polymorphic (M101), has PAST lead keys.

### DEAD `individuals` WRITERS (table does NOT exist — all broken/legacy; research each)
- `src/services/contribution/OwnerPromotion.js:243`
- `src/services/scraping/UnifiedScraper.js:1977`
- `src/services/scraping/Orchestrator.js:423`
- `src/services/genealogy/EntityManager.js:110`
- `src/services/genealogy/EntityDeduplicator.js:188`
- `src/repositories/IndividualRepository.js:78`
→ decide per component: truly dead (remove) vs rewire to canonical_persons.

### LEAD creators (unconfirmed_persons) — research dedup-before-create
- UnifiedScraper.js:2023,2048 · Orchestrator.js:450 · IntelligentOrchestrator.js:111,142
  · ExtractionWorker.js:1530,1592 · api/routes/distributed-scraper.js:182

### ENSLAVED creators (enslaved_individuals) — research dedup + gate
- Orchestrator.js:404 · genealogy/EnslavedManager.js:110 · genealogy/DescendantCalculator.js:90
  · api/routes/contribute.js:4466,4555

### CANONICAL creators (canonical_persons) — research matcher + gate routing
- NameResolver.js:203 · api/routes/wills.js:341 · api/routes/review.js:379,456

### INTAKE PROMOTE/APPROVE endpoints (the active surface)
- contribute.js: /:sessionId/confirm:3012 · /extraction/:id/promote:3794 · /promote/:leadId:3853
  · /review-queue/:id/approve:4443 · /review-queue/approve-all:4540
- review.js: enslaver_candidates/:id/approve:366 · unresolved_petitions/:id/approve:448
  · pending_climb_matches/:id/approve:476 · ambiguous_unconfirmed/:id/approve:515 · reject:536
- names.js: /resolve:153 · /resolve-batch:203 · /queue/:id/resolve:544

## Known facts already grounded
- OwnerPromotion (live-wired at contribute.js:3821/3858) writes the DEAD `individuals`
  table by exact lower(full_name) — owner promotion is broken; no matcher, no leads.
- `/review-queue/:id/approve` inserts enslaved_individuals, no dedup, hardcoded Hopewell.
- No promotion path uses find_person_match / person_blocking_keys / lead search.

## Research sequence (each = read-only pass, findings appended below)
1. **Matching core** (NameResolver + find_person_match + blocking) — IN PROGRESS.
2. The 6 dead-`individuals` writers.
3. Intake promote/approve endpoints.
4. Scraper + genealogy creators.

---
## Findings: (1) Matching core (NameResolver) — DONE Jun 26 2026

`src/services/NameResolver.js` (805 lines) is the live intake resolver. Key path
`resolveOrCreate(fullName, metadata)`:
1. `isValidPersonName` gate (rejects non-name fragments). ✓
2. `findCandidateMatches` → JS soundex/metaphone/levenshtein scoring against
   **canonical_persons + name_variants ONLY** (queries at :330/:355). Does NOT use
   `person_blocking_keys`; does NOT see leads.
3. confidence ≥0.85 → auto-`matched` (+name variant); 0.60–0.84 → `name_match_queue`
   (human review); **<0.60 or none → `createCanonicalPerson` (new canonical row)**.

Critical findings:
- **Two internal matchers, fragmented:** `findCandidateMatches` (JS, what
  `resolveOrCreate` actually uses) vs `resolveWithTiers` → DB `find_person_match`
  (canonical-only Tier1 ext-id/Tier2 name+date+loc/Tier3 name) — **NOT used by
  resolveOrCreate**. So the live path is the JS one.
- **Canonical-only:** neither matcher searches leads (unconfirmed_persons,
  slavevoyages_past_people, hall_slave_records). New intake can't find an existing lead.
- **No blocking-key use:** ignores the polymorphic `person_blocking_keys` (M101) entirely.
- **`createCanonicalPerson` (:193) mints canonical_persons with NO gate** — no
  dedup-vs-leads, no secondary-source/document check. Violates the canonical/document
  standard if used to create un-gated, un-documented canonicals.
- Auto-match at 0.85 on soundex risks Tier-3/name-only auto-merge (Biscoe-rule tension).
- Lots of graceful "migration 033 not applied" fallbacks — but 033 IS applied.

**Consolidation requirements (for the matching-core design pass — NOT built yet):**
(i) one matcher that searches LEADS + canonicals via `person_blocking_keys` (polymorphic);
(ii) unify the two internal matchers onto that blocking-backed matcher;
(iii) `createCanonicalPerson` must honor the gate (create lead / gated-canonical until
deduped + ≥secondary + proposition-doc); (iv) Tier-3/name-only never auto-match.
