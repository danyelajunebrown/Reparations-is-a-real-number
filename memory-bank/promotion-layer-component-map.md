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

## Findings (2)(3)(4) — full layer audit, DONE Jun 26 2026 (4 parallel passes, verified)

### Person/identity tables (DB rowcounts, verified)
canonical_persons 676,875 · unconfirmed_persons 2,425,341 · enslaved_individuals 18,272 ·
**individuals MISSING (dead)** · free_persons 0 · person_external_ids 159,640 ·
name_variants **4** (NameResolver variant store barely used) · name_match_queue 26 ·
ancestor_climb_matches 582 · slavevoyages_past_people 169,065 · hall_slave_records 100,666 ·
person_facts 497,697 · dedup_candidate_pairs 7,056 · cross_source_candidates 10,901 ·
person_merge_log 18.

### THREE dedup systems (only one is the live spine)
1. **person_blocking_keys + resolve-canonical-dedup.mjs** — LIVE batch (Biscoe), 1.45M keys,
   now lead-aware (M101). The spine. NOT wired into any ingest/intake.
2. **NameResolver** — LIVE intake, JS soundex/lev, canonical-only, ignores blocking keys.
3. **EntityDeduplicator** — DEAD (own Levenshtein system on `individuals.internal_id`); plus
   **EntityManager** DEAD find-or-create. Conflicting ID schemes (uuid vs string).

### The dead `individuals` table is written by LIVE code in 3 places (runtime bombs)
- **OwnerPromotion** (LIVE via contribute /promote + /extraction/promote) → broken.
- **UnifiedScraper:1977** (LIVE via UniversalRouter ← contribute) writes `individuals` for
  ≥0.9-confidence owners → broken.
- **IndividualRepository** (LIVE via /api/research) READS `individuals` → broken.
- Plus DEAD writers: Orchestrator, EntityManager, EntityDeduplicator.

### Person-creation paths — match-before-create + gate status
- **Scrapers (UnifiedScraper, distributed-scraper, dead Orchestrators):** blind INSERT, NO
  match (ON CONFLICT DO NOTHING at best). Duplication time-bomb. distributed-scraper (LIVE,
  1860 multi-device) marks everything confidence 0.95 / source_type primary, no dedup.
- **wills.js /ingest (LIVE):** the GOOD one — sophisticated location+year+name-variant match
  before create; auto-creates canonical `verification_status='pending_review'` + person_documents
  with evidence_strength. Gate = docType==='will' only (no secondary-source rule).
- **review.js (LIVE, X-Admin-Token):** curator-driven. Creates canonical on approve
  (enslaver_candidates:379, unresolved_petitions:455 — hardcoded state='District of Columbia'),
  promotes unconfirmed (ambiguous), and has the FK-safe **merge** (duplicate_canonicals → merge
  script, Biscoe) + **link** (cross_source_enslavers). No programmatic doc-gate; no
  findCandidateMatches before create.
- **names.js /resolve(-batch) (LIVE):** uses NameResolver.resolveOrCreate → can mint canonical at
  conf 0.50, no doc-gate.
- **contribute review-queue/approve(-all) (LIVE):** blind INSERT enslaved_individuals, random ids,
  hardcoded Hopewell note, no match.
- **OwnerPromotion (LIVE):** broken (individuals).

### DEAD service classes (different/conflicting designs — remove or fold in)
Orchestrator, IntelligentOrchestrator, EntityManager, EntityDeduplicator, EnslavedManager,
DescendantCalculator (+ DocumentParser/LLMAssistant upstream).

## WIDE-VIEW SYNTHESIS → integration direction
The person layer has **5+ tables, 3 dedup systems, ~10 creation paths, 3 live writers of a dead
table, and NO consistent match-before-create or document-gate.** Good patterns exist but are
siloed: blocking-keys (lead-aware), wills.js location+year matcher, review.js FK-safe merge/link.
**Deep integration target: ONE `PersonService` (createOrFind + gate)** that every path routes
through — blocking-key match across leads+canonicals → link or create-as-lead → gate canonical
promotion on dedup + ≥secondary + proposition-doc. Kill the dead `individuals` table + dead
dedup/entity classes. This is the design to bring next (for review before build).
