# Active Context — Reparations Platform

_Last updated: 2026-06-28 (Session 67–68 — de-siloing the person layer: COMPLETE in code, #2→#1→producer→#3→①→②→④→③→⑤)_

---

## Phase-1 Retrieval-Integrity Harness + deploy gate (2026-06-29→30)
User directive: before merging/deploying the de-siloing+gate branch, build a system that "ongoingly
computes consistency/accessibility/availability of all persons and documents" (automated epistemology;
RAG-Ops framing) — suspicion of hidden bugs after the heavy churn. **Triggered by a live bug** the user
caught: `person/canonical_persons/487165` showed a **FamilySearch login wall as the "document."**
- **#1 (done):** the DocumentViewer external-URL guard already existed on `main` but the live github.io
  build was STALE → **redeployed frontend from main via an isolated git worktree** (didn't disturb the
  audit branch or the running climb session). Login-wall iframe gone; docs WITH an s3_key now serve the
  presigned S3 image. 487165 anomaly = stale deploy, not bad data (it has a real s3_key census image;
  live presign works). My earlier "0 docs" was an audit query bug.
- **Phase-1 design = integrity auditor first (chosen over full RAG now); RAG/pgvector feedback loop =
  Phase 2, later.** Built **M106 `retrieval_health_ledger`** + **`scripts/retrieval-health-audit.mjs`**
  (exercises the real frontend path; exits non-zero on any CRITICAL so deploy can gate). **Results:**
  `gate_assert_without_doc`=**0** (CRITICAL — gate sound), `doc_s3_unfetchable`=**0/400** on the Mini
  (CRITICAL — S3 archive intact), `doc_dead`=0; `gate_stale_lift`=160→**fixed to 0** (re-ran
  recompute-assertion-gates, +166 newly-documented assertable, now 41,155 assertable). **DEPLOY GATE:
  PASS (0 critical).** Non-blocking findings surfaced: **174,732 named canonicals with 0 blocking keys**
  (orphaned from the dedup/resolve pool — silo at scale, fix = blocking-key backfill across all
  canonicals like reconcile-climb did for 992) and **316,938 FS-only docs** (the #2 archiving gap).
- **NEXT:** (a) optional pre-deploy de-silo: blocking-key backfill for the 174,732 orphans; (b) the
  merge/deploy itself (branch → main + render backend + frontend) — gate is GREEN, awaiting user go;
  (c) schedule the harness on a cron (continuous) once the branch is on the Mini; (d) Phase-2 RAG.

## Session 67 — De-siloing the Person Layer: Audit + Unified PersonService (2026-06-25→26)

Branch: `audit/probate-classifier-and-source-documents`. Follows the canonical/document-gate standard (Session 66). User priority: BEFORE exponential growth, fix orphaning/siloing so already-verified info (e.g. an enslaved ancestor's data) is never lost when future inflow (a descendant's document) arrives. Method (user-directed): focused research pass per component, findings to the memory bank, design → review → build → verify; NEVER decide from context — ground in the memory bank.

### ✅ STATUS — de-siloing program COMPLETE in code (Jun 28 2026)
The whole program is built, verified, committed, and pushed. Canonical record (detail in the dated subsections below + `plan-de-siloing-fixes.md`):
- **#2 PersonService consolidation + document gate** — ONE `src/services/PersonService.js` (`resolve`/`findOrCreateLead`/`promoteToCanonical`+gate/`merge`/`link`); all 3 reachable dead-`individuals` writers rewired; the `individuals` table was already gone.
- **M101** polymorphic identity layer (blocking keys + cross_source_candidates); **M102** external-assertion gate cols + backfill (40,989 assertable / 635,896 gated); **M103** lead-aware relationship edges (cfe/prv/eor polymorphic + sync triggers); **M104** eor edge unique; **M105** family_relationships lead_table qualifier.
- **producer** `build-enslaved-owner-edges.mjs` → ~24.8K enslaved→owner edges (role-filtered; preload-optimized). **#3** DAA Source 4 reaches enslaved LEADS (PAST/Hall/unconfirmed) + Source-3 array-bug fix. **①** owner→canonical linking (10,902 review candidates) + Source-4 FK path. **②** merge/link folded in + IndividualRepository deleted (rest of "dead cluster" verified LIVE, kept). **④** gate live on public search/profile/names + frontend stub + id-search gap closed. **⑤** flagged 1,095 OCR-artifact enslaved names (descriptors spared) + DAA guard.
- **Standard upheld:** secondary-only canonicals exist + work internally but are hidden from public search & non-assertable until a stored proposition-specific doc; authenticated research view bypasses. Biscoe throughout (name-only never auto-merges/mints).
- **REMAINING = curation (team, not code):** review the 10,902 owner→canonical candidates (activates #3 FK traversal); attach documents to lift gates.
- **PARALLEL SESSION (Jun 27) — climb name/parent resolver, see `note-climb-resolution-producer-jun27.md`:** a worksheet session minted ~992 `canonical_persons` (`created_by='climb_name_resolver'`) OUTSIDE the identity layer, then RECONCILED them with this session's PersonService (`scripts/reconcile-climb-minted.js`): blocking keys backfilled 970/992 (silo closed), Biscoe dedup found 0 real duplicates (28 ambiguous → `worksheets/dedup-candidates.json`, not merged). RECONCILED FURTHER (Jun 29): **(#4)** climb toolset committed (`25b0d9c30`); **(#1)** `scripts/mirror-parent-links-to-edges.mjs` mirrored **3,256** child→parent links (both endpoints FS-id-resolvable to canonical) from `inferred_parent_links` into `canonical_family_edges` as `child_of` edges (M103 subject cols trigger-filled) → #3 kinship traversal/lineage now see them; name-only links left for identity resolution (Biscoe). **(#2/#4) route the climb scripts through PersonService — DEFERRED, coordination needed (Jun 29).** Confirmed `scrape-parents.js` is under ACTIVE iteration by a parallel agent (61-line uncommitted change adding login-detection + RETRY mode), so refactoring it now would CLOBBER in-flight WIP — left untouched. Mini SSH access dropped (key out of agent) so couldn't verify Mini-side running state — another reason to leave it. The refactor spec is already in `note-climb-resolution-producer-jun27.md` "FIX (remaining)": route `resolve-climb-ancestors.js`'s direct canonical INSERT through `PersonService.findOrCreateLead` (mint LEADS not canonicals, or `promoteToCanonical` gated) so it stops creating the silo. To be applied by the climb-session owner when their current iteration settles (or in a coordinated window). The post-hoc safety net already works: `reconcile-climb-minted.js` de-silos any direct-minted canonicals (blocking-key backfill + Biscoe dedup), and #1's mirror connects their parent edges. **(#3)** 28 ambiguous dedup candidates in `worksheets/dedup-candidates.json` await human review (never auto-merged). (a) minted-canonical-not-leads is practically safe (M102 gate defaults them hidden/non-assertable).

### De-siloing assessment (read-only) → 3 structural orphaning risks
`memory-bank/assessment-de-siloing-orphaning.md`: (1) relationship/lineage layer is canonical-(or-unconfirmed)-only → the 266K PAST+Hall leads can't carry ANY kin/lineage edge; (2) intake promotion bypasses the matcher (OwnerPromotion writes the DEAD `individuals` table by exact name); (3) no descendant→enslaved-ancestor traversal. Fixes sequenced **2→1→3** (`plan-de-siloing-fixes.md`).

### M101 — polymorphic identity layer (fix-#1 foundation, DONE)
`person_blocking_keys` + `cross_source_candidates` made polymorphic `(subject_table, subject_id)` so LEADS join canonicals in ONE dedup pool; 1.45M keys backfilled. PAST leads keyed (637K context keys, never bare-name; `populate-blocking-keys-slavevoyages-past.mjs`). Intra-PAST dedup measured ≈ all false (curated source) → NO review queue; value = discoverability for future cross-source matching.

### Full person-layer audit (4 parallel passes) → deep-integration design
`memory-bank/promotion-layer-component-map.md`: 5+ person tables (canonical 677K / unconfirmed 2.4M / enslaved 18K / `individuals` DEAD / PAST 169K / Hall 100K), 3 dedup systems (1 live spine, 1 live canonical-only NameResolver, 1 dead EntityDeduplicator), ~10 creation paths with NO consistent match-before-create or doc-gate, **3 LIVE writers of the dead `individuals` table** (OwnerPromotion, UnifiedScraper:1977, IndividualRepository = runtime bombs), many dead service classes.

### PersonService consolidation (fix #2) — design + STEP 1 DONE
`memory-bank/design-person-service-consolidation.md`: ONE `src/services/PersonService.js` every path routes through — `resolve / findOrCreateLead / promoteToCanonical(+gate) / merge / link`. **Step 1 `resolve` BUILT + broadly validated:** unified matcher over leads+canonicals (blocking keys + `find_person_match`), Biscoe **ambiguity guard** (never auto-match on common-name ties). `tests/unit/test-person-resolve.js` (committed regression): 10/10 curated + 800-sample statistical (400 canonical + 400 PAST first-name leads, the riskiest) = **0 false positives**. **Step 2a `findOrCreateLead` DONE** (resolve→link-or-create-lead, blocking keys, 7/7). **Step 2b DONE — both live scrapers rewired:** 2b/1 distributed-scraper `/submit-data` (`fb5c961ca`); 2b/2 `UnifiedScraper.saveResults` (dropped dead `individuals`+`slaveholder_records` writes; owners+enslaved → findOrCreateLead; enslaved carry `enslaved_by` via new `relationships` JSONB; scraper no longer self-confirms — leads are `'pending'`, confirmation = gated promote; verified end-to-end). **Kills 2 of 3 dead-`individuals` writes.** **Step 3 DONE — `promoteToCanonical` + external-assertion gate + OwnerPromotion rewire (3rd/3 dead-`individuals` write ELIMINATED):** M102 added `assertable_slaveowner`/`assertable_enslaved` to canonical_persons (default FALSE = gated; index added; operationally inert until search reads it). `PersonService.promoteToCanonical` = dedup (link existing / refuse ambiguous / else create ≥secondary gated canonical w/ soundex+metaphone+blocking keys) → person_documents (s3_key only for a real stored file) → `recomputeGate` (per-proposition booleans DERIVED from stored docs: s3_key + document_type ∈ DOC_PROP_*) → marks lead promoted + drops its blocking keys. OwnerPromotion keeps its channel/confidence gate, routes through findOrCreate+promote, getStats→canonical_persons. Tests: promote 11/11, OwnerPromotion e2e 5/5, regressions green. **FLAGGED next (deliberate): (a) measured `recompute-assertion-gates` backfill over 677K canonicals; (b) wire public search/API + UI to FILTER on the gate (consumer side — nothing reads the columns yet).** Then step 4 merge/link + delete dead table/classes → then #1 lead-aware relationships + #3 reverse traversal.

### De-siloing #1 — lead-aware relationship edges DONE (M103, Jun 27)
Decision (user): M101 POLYMORPHIC `(subject_table, subject_id)`. **M103** retrofitted `canonical_family_edges` (1,658 backfilled), `person_relationships_verified` (12), `enslaved_owner_relationships` (empty) with `*_subject_table`/`*_subject_id` + a per-table sync trigger (legacy canonical/unconfirmed id ⇄ polymorphic). Legacy NOT NULL relaxed (lead-only endpoints possible); legacy FKs kept; cfe polymorphic partial-unique dedups lead edges. Back-compat: the 5 cfe writers + the live climber (prv) unchanged. `tests/unit/test-lead-aware-edges.js` 6/6 (PAST lead as kinship + ownership endpoint, no FK violation, queryable). Schema now lead-CAPABLE; POPULATING lead edges (PAST enslavers[]/Hall transfers/unconfirmed.relationships) = separate producer step. `slaveholding_relationships` (redundant, empty) left for step-4 reconcile; `family_relationships` (2M, name+lead_id) deferred to its own migration (lead_table qualifier; the DAA reads it by name). **Producer + #3 DONE (Jun 27):** `scripts/build-enslaved-owner-edges.mjs` materialized `enslaved_owner_relationships` from unconfirmed enslaved_by + PAST ownership-role enslavers (Owner/Buyer/Seller only; captains excluded) — 24,814 statements, owner=name-only lead (reuse-by-name/create), idempotent (M104 unique). Mid-run fix: capped `person_blocking_keys.key_value` at 64 in `PersonService._queryKeys`. **#3:** `DAAOrchestrator.aggregateEnslavedData` += Source 4 (reads `enslaved_owner_relationships` by `owner_name=slaveholder_name`) reaching enslaved LEADS (PAST/Hall/unconfirmed) internally; also fixed Source 3's array-shape bug (was reading the JSONB array as an object → matched zero rows). Data-quality note: unconfirmed enslaved_by carries pre-existing OCR junk (surfaced, not introduced; gated leads; MatchVerifier re-checks). **DEFERRED:** owner-lead→canonical-enslaver linking (cross-source resolution) so #3 traverses by FK not name; `family_relationships` (2M) lead_table qualifier; step 4 cleanup (delete dead `individuals`/classes); held gate search-wiring. The full 2→1→3 de-siloing arc is now in place.

### ① Owner-lead→canonical-enslaver linking DONE (Jun 27)
Largely the pre-existing `resolve-cross-source-enslavers.mjs`: (a) extended person_type filter to include owner/suspected_owner (was enslaver/slaveholder only → missed producer owner leads); (b) fixed M101 fallout (cross_source_candidates unique is now (canonical_person_id, lead_table, unconfirmed_lead_id) → old 2-col ON CONFLICT errored). Applied: **10,902 candidates (5,159 review + 5,743 auto)** to the cross_source_enslavers review queue (links via unconfirmed_persons.confirmed_individual_id; never auto-links — Biscoe). **#3 Source 4 upgraded:** matches owner by FK (owner_subject=canonical / owner_canonical_id / o.confirmed_individual_id=slaveholder_id) AND name → once a candidate is review-confirmed, the DAA reaches that owner's enslaved by FK not name. REMAINING: (i) re-run resolver after the producer fully completes (PAST owners); (ii) human review confirms links.

### ② Step 4 cleanup DONE (Jun 27-28)
VERIFICATION: the `individuals` TABLE is already gone (no drop needed); the "3 live writers" were runtime bombs, 2 reachable ones rewired (OwnerPromotion/UnifiedScraper), `IndividualRepository.saveWithDocument` never called. No views/FKs depend on it. Producer FINISHED: 24,814 statements → ~24,793 edges (16,320 new + 8,473 prior), 2,958 owner leads created, 21,835 reused. **Chosen scope (safe deletes + merge/link):** deleted 4 zero-ref dead classes (EntityDeduplicator, EnslavedManager, DescendantCalculator, NLPAssistant); folded `PersonService.merge` (FK-safe canonical merge, from merge-canonical-persons.mjs which is now a thin wrapper) + `PersonService.link` (external-id upsert); tests 6/6. Resolver re-run after producer: 22,870 leads → 10,902 candidates. **DEFERRED:** require-chained dead cluster (IndividualRepository←ResearchService unused require; EntityManager/LLMAssistant/DocumentParser/Orchestrator/IntelligentOrchestrator + scripts); redundant empty `slaveholding_relationships`.

### ④ Gate search-wiring BACKEND DONE (Jun 28)
User decisions: Q1 neutral-stub for gated direct links; Q2 authenticated research bypass (admin token); Q3 isVerified treats gated as not-public; Q4 backend-first. Implemented: `isAdmin(req)` non-blocking helper in admin-auth; `contribute.js` search (id+text canonical WHERE) + `/person/:id` (fully-gated → `{gated:true, gatedMessage}` stub); `names.js` `/search`,`/candidates` pass `includeGated:isAdmin(req)`, `/canonical/:id` stub; `NameResolver` searchSimilarNames/findCandidateMatches got `includeGated` option (default internal sees all; OR-groups paren-wrapped). Verified: public hides gated / admin sees all / NameResolver internal-vs-public. Dev w/o ADMIN_TOKEN = open (sees all). enslaved_individuals + unconfirmed LEADS NOT gated by these canonical flags (NOTE: producer's suspected_owner leads still show in public search — leads-visibility question to raise). **FRONTEND FOLLOW-UP (deferred per Q4):** client.js isVerified(), PersonProfile gated-stub rendering + per-proposition labels, SearchPage.

④ FRONTEND POLISH DONE (Jun 28): PersonProfile renders the `{gated:true,gatedMessage}` stub; client.js isVerified() gates canonicals (gated/assertable_*); SearchPage needed no change; build ✓. **Leads-in-public-search RESOLVED:** public text search already hid leads via filterVerified(); user chose "close id-search gap only" → SearchPage now always filterVerified (id-search no longer bypasses the gate, still bypasses the classification toggle); backend /search still returns leads in payload (frontend is the public guard, accepted). ④ COMPLETE (backend + frontend + leads gap).

### ③/⑤/dead-purge DONE (Jun 28)
- **③** M105: family_relationships person1_lead_table/person2_lead_table (default 'unconfirmed_persons') — lead-aware qualifier on the 2M table (metadata-only, instant). Completes #1 lead-awareness.
- **Dead-class purge:** verification corrected the assumption — only **IndividualRepository** was safely deletable (ResearchService require unused; DELETED). The rest are NOT dead: Orchestrator ← continuous-scraper.js (LIVE `npm run worker`); UnifiedScraper ← UniversalRouter ← contribute (live); EntityManager/LLMAssistant/DocumentParser chain through test scripts. KEPT.
- **⑤** data-quality: `flag-junk-enslaved-names.mjs` flagged 1,095 enslaved leads (71 distinct names, all doc/OCR artifacts — Note/Estate/Act/months/…; descriptor-placeholders deliberately excluded per prior-mistake lesson) with `data_quality_flags->'name_artifact'`. DAA Source 4 guarded to exclude them (1,170 edges excluded, 29,397 legit remain). Reversible.

**REMAINING (curation/team, not code): human review of the 10,902 owner→canonical candidates (activates #3 FK path) + attach documents to lift gates. The whole de-siloing program (#2→#1→producer→#3→①→②→④→③→⑤) is COMPLETE in code.**

### Memory bank un-ignored + versioned (process fix)
`memory-bank/` was gitignored — 18 of 22 files (incl. projectbrief + the new standard) were local-only. Un-ignored + committed → durable, on GitHub for collaborators. Discipline: read memory-bank first; project knowledge → memory-bank ONLY (not `~/.claude`); CLAUDE.md was created then erased per user ("believe in the memory bank", no parallel rule surface).

---

## Session 66 — NY Scraper Recovery + SlaveVoyages PAST (LEADS) + Canonical/Document-Gate Standard (2026-06-22→24)

Branch: `audit/probate-classifier-and-source-documents`.

### NY probate scraper — recovered (root cause: stale cookie jar)
The scraper was frozen (SIGSTOP'd by a since-gone watchdog) and, on restart, kept hitting the "content-OK / index-walled" split (`SESSION LOST` → `ident.familysearch.org/login` on every roll-index). TRUE root cause: the scraper injects `<repo>/tmp/familysearch-cookies.json` at startup (`page.setCookie`, browser-wide), and that jar was 2 weeks stale — it OVERWROTE the live logged-in session every launch, re-walling the index endpoint. Fix: human VNC re-login on the Mini hitting an actual roll-index URL, re-capture the jar to the repo path (`_capture-fs-cookies.js` defaulted to `/tmp/` not repo `tmp/` — fixed + committed), relaunch → 0 SESSION LOST, marching Albany. Watchdog re-registered (pm2 `probate-watchdog-ny`), stale sentinel cleared. Also fixed the **drip wheel-spin** (`probate-drip.mjs`): old Mini drip was Liberty-only AND re-picked any 0-segment roll forever (blocked NY); new version covers all `%-probate-%`, prioritizes by real `document_year`, persists an empty-rolls set. Deployed.

### SlaveVoyages PAST ingest — built, staged as LEADS (169K)
First pre-1860 named-enslaved source (see `research/pre-1860-source-buildability.md`). PAST = African Origins/Trans-Atlantic + Oceans of Kinfolk + Texas Bound = **169,065 named records**, served by a paged token-authed API (no static file; the public frontend read token). Built: **M100** `slavevoyages_past_people` staging + reusable `source_artifacts` (S3 re-host + Wayback snapshot + sha256 + license + rehostable) archive registry; `scripts/lib/wayback.mjs`; `scripts/ingest-slavevoyages-past-api.mjs` (pages API → NDJSON → S3 + Wayback → staging, idempotent). Full pull run on the Mini → staged as LEADS with facts attached. Enslaved.org Q-ID cross-link deferred (its dump is NOT on the Mini — prior memory was wrong; fresh download later).

### THE STANDARD — canonical + external-assertion document gate (user verdict Jun 24)
**Overstep caught before damage:** `scripts/resolve-slavevoyages-past.mjs` would have minted ~169K **un-deduped, un-documented** canonical persons — violating the project's definition. It was only DRY-RUN; **nothing was minted**; resolver is SHELVED. The standard is now authoritative in **`memory-bank/standard-canonical-person-and-document-gate.md`**:
- **Canonical = (1) verified DISCRETE UNIQUE human (deduped) AND (2) ≥ a verified secondary source.** Secondary IS enough to create a canonical.
- **External-assertion GATE:** a secondary-only canonical exists + is fully usable INTERNALLY (DAA, climb, obligation) but is HIDDEN from front-end search, and we NEVER externally assert anyone was/wasn't a slaveowner / enslaved / prior-enslaved, until a **proposition-specific corroborating document is in S3** (`person_documents.s3_key`, a real file — not a URL pointer). Verifying doc types (so far): slave schedule · census-with-slaves · will/probate · Freedman's Bank deposit · DC compensated-emancipation petition · plantation records · correspondence from the person · slave/freedman narrative.
- **Debt flagged:** Bucket C1 (51,017 SlaveVoyages, URL-only docs) + Hall (~100K, no docs + no dedup) are non-compliant under this standard — reconcile later, do not act unprompted.

**Process failure + fix:** nothing forced reading the repo `memory-bank/` (Claude Code auto-loads only CLAUDE.md + `~/.claude` MEMORY.md; no CLAUDE.md existed; the repo memory bank where standards live was never auto-read — and `~/.claude/MEMORY.md` is over its size limit, loads partially). A CLAUDE.md was briefly created to enforce it; **user erased it — the memory bank is the SINGLE source of truth, no parallel rule surface.** Discipline adopted: read `memory-bank/` at the start of every task; ground decisions there, never in immediate context or model training; write project knowledge to the memory bank ONLY (not `~/.claude`).

### NEXT (agreed sequence)
1. **Dedup first** — design SlaveVoyages PAST lead dedup grounded in `plan-identity-resolution-completion.md` (tiered fingerprint; block on voyage_id + name, NOT bare first-names; Tier-3 never auto-merged; review queue, not auto-canonical). Bring for review before building.
2. **Then the gate mechanism** — `externally_assertable` flag + search/API filter + internal-consumer bypass.
3. Resume the ingestion under these rules (PAST stays LEADS with facts until dedup + a stored proposition-specific document promote + un-gate).

---

## Session 65 — Probate Year-Extraction Fix (#67) + Estate-Index Spine + Forensic-Estate UI (2026-06-21→22)

Branch: `audit/probate-classifier-and-source-documents`. This session's probate-layer work was found **applied-to-DB but uncommitted** after an interrupted prior session; this entry documents it and the cleanup. The Hall Louisiana ingest / Hall→canonical resolution / `chattel_transfer_events` work IS committed (`9938b98fa`, `c58ff3b6d`, `5b7eb996e`) but the whole branch is **22 commits unpushed**.

### What was built (the probate connective layer)
- **#67 year-extraction fix.** The scraper derived `document_year` with `/18\d{2}/` — matching ONLY 1800–1899, so every colonial (16xx/17xx) and 20th-c probate page was NULLed or clamped. Widened to `/1[6-9]\d{2}/` in `scripts/scrapers/georgia-probate-scraper.js` (`parseTranscript`) and `src/services/probate/probate-extractor.js` (`regexExtract`). `scripts/backfill-probate-document-year.mjs` re-derives the ~38k already-written pages with the corrected logic (Math.min = conservative earliest-stated-year proxy). **NY year coverage now 27,220/39,211 (69%), 11,879 slavery-era pages** (was ~63% NULL, the #67 symptom).
- **Probate estate index (migration 099 + `scripts/build-probate-estate-index.mjs`).** The CHEAP, DETERMINISTIC spine: one row per (roll_group_id, decedent) built directly from already-scraped carry-forward testator + corrected year, turning the 83%-orphan page pile into a queryable estate registry NOW (the LLM forensic drip is months behind). Sanity columns make it a corroboration tool: `slavery_era` (NY-1827 gate), `year_plausible` (OCR-noise dates), `name_suspect` (place-word / OCR-junk decedents — FLAG for review, never auto-drop; Biscoe rule). **Built: 11,231 rows.** LLM extraction attaches later by (roll, decedent_key).
- **Forensic estate accounting UI.** `src/api/routes/contribute.js` `GET /person/:id` now surfaces a `forensicEstate` payload (estate totals, enslaved-with-valuations, non-chattel assets, liabilities, heirs) from the latest non-rejected `will_extractions` row; `frontend/src/components/PersonModal/PersonProfile.jsx` renders it in a new "Forensic estate accounting" section.
- **NY drip scoping.** `scripts/probate-drip.mjs` gained `--prefix` (scope to one region's collection_keys) and now prioritizes by the REAL earliest `document_year` (reliable post-#67) instead of a name-parsed year — colonial NY estates with enslaved valuations process before post-emancipation rolls.
- **Hand-uploaded will re-extraction** (`scripts/reextract-hand-uploaded-wills.mjs`) — retro-applies the forensic extractor to curated hand-uploaded wills (Hopewell/Biscoe/Weaver) that predate the county pipeline and carry zero forensic financials. **Gemini OCR** (`src/services/probate/gemini-ocr.js`) — free Cloud-Vision replacement (Vision key suspended), uses `GEMINI_API_KEY`, gemini-2.5-flash vision.
- **inheritance-edges backfill schema fixes** (`scripts/backfill-inheritance-edges-from-will-extractions.js`) — reads counts/year from `structured_extraction_jsonb`, drops the missing `heir_name_as_written`/`document_date` columns, hardcodes `evidence_tier=1`/`confidence=0.80`, filters `status <> 'rejected'`.

### Migration hygiene (cleaned this session)
- **098 collision resolved**: `098-probate-estate-index.sql` → **renumbered `099`** (collided with the committed `098-chattel-transfer-events.sql`, both Jun 21).
- **schema_migrations drift fixed**: 093–099 objects all existed in the DB but were NOT recorded (the recurring applied-but-not-tracked issue). Backfilled all seven rows with correct `sha256` checksums of the final files, so `apply-migrations.js` won't re-run or abort on them. schema_migrations is now honest through 099.

### Operational / access
- **Pi is offline (last seen 31d ago)** → the `-J pi-ts` jump fallback is DEAD. The Mini (`danyelicas-mini`, 100.114.130.16) IS online on Tailscale, three FS tabs logged in. Laptop→Mini shell access is currently broken: direct SSH fails on `publickey` (laptop key not in the Mini's authorized_keys) and Tailscale SSH isn't enabled server-side (host-key fallback to OpenSSH). **To restore remote ops (read ntfy `OPS_NOTIFY_WEBHOOK`, check the scraper): either add the laptop pubkey to the Mini's `~/.ssh/authorized_keys`, or `tailscale set --ssh` on the Mini.** The NY scrape sitting at 39,211 imgs / 82 rolls is NOT "stalled" — it's between active write bursts (per the documented index-wall recover-on-VNC-relogin behavior); judge state by ntfy, not the DB row count.

---

## Session 64 — NY Probate Scraper Session-Loss Resilience (2026-06-12→13; verified live 06-21)

Branch: `audit/probate-classifier-and-source-documents` — committed `de940ebbf` (scraper + watchdog resilience) and `02db8e503` (watchdog false-positive fix). See [[project_ny_probate_run]].

### The incident
The NY full-state probate scrape (FS collection 1920234, pid 13669 on the Mini) entered a **captcha-hammering death spiral**. The FamilySearch session dropped mid-crawl (~00:38 UTC; "Execution context destroyed by a navigation"), FS began 302-redirecting every request to `ident.familysearch.org/identity/login` (hCaptcha-gated). Root cause: `scrapeOneRoll` (in `scripts/scrapers/georgia-probate-scraper.js`) had **no logged-out detection** — it read each login redirect as "No image thumbnail found", marked the roll failed, and immediately navigated to the next roll. ~3,000 rolls skipped in 3.5h; a fresh hCaptcha spawned on every ~4s navigation, so the operator could never finish logging in (each solve yanked away by the next `goto`) — the user's "passing the captcha twice." Diagnosed by reading `~/probate-newyork-full.log` + the Chrome debug port (`curl localhost:9222/json` showed the identity/login + hcaptcha frames).

### The fix (resilience, not a band-aid — user's framing)
- **Scraper**: `isSessionLostUrl()` + `waitForReauth()` — on logout, STOP navigating, write pause-sentinel `~/.probate-scraper-paused-<collection>.json`, ntfy-alert, then poll `page.url()` every 30s WITHOUT navigating (so the login page holds still to solve once) and auto-resume on re-auth. Wired into roll-index + mid-roll paths; mid-roll loss now marks the roll `failed` (re-scraped) instead of silently `complete` (a latent tail-truncation data-loss bug). Startup login-wait made captcha-aware (no reload while a challenge is on screen; 30m patient).
- **Watchdog** (`scripts/scrapers/probate-scrape-watchdog.js`, PM2 `probate-watchdog-ny`): reads the sentinel (self-paused → `awaiting-reauth`, never frozen); **auto-pause backstop** SIGSTOPs a scraper only when it stalls >30m **and the log shows the real spiral signature** (`logShowsSpiral()`: many "No image thumbnail" skips with zero S3/person_documents/RESUME lines). A bare DB-write stall is NOT enough.
- **Self-inflicted bug caught + fixed same session**: the first auto-pause cut froze a *healthy* scraper because it inherited a stale `lastProgressAt` and fired on pure DB-stall while the scraper was legitimately resume-SKIPPING 752 already-written images (~6s each ≈ 75m of no new rows). Fix = the spiral-signature gate above + reset the stall timer on watchdog startup.

### Outcome (verified live 06-21)
Failed rolls auto-retry (main loop skips only `status==='complete'`; per-image rows preserved → resume re-fetches only missing tails). Clean swap: kill old → clear sentinel → restart watchdog → relaunch `nohup /usr/local/bin/node ... --resume --apply`. The session-guard proved itself live (paused on logout → auto-recovered in 1m as valid cookies auto-redirected login→content). **8 days later the same pid 13669 is still running, DB written climbed 13,294 → 39,169, watchdog `stalled=0m incident=none` — zero false-freezes.**

### Follow-up polish (06-21, committed `fec42350d`)
Three scraper improvements: (1) **direct-jump resume** — `scrapeOneRoll` now builds the list of unwritten image numbers and jumps the viewer straight to each via the number-input, instead of stepping +1 through every already-written image (~6s each; a 750-img skip was ~75m dead time). Fully-written roll now ~0. (2) **Skip malformed sitemap rolls** — the stray `[https]` collection-level entry (first Albany roll) whose bad index URL redirected to login is now skipped (groupId not matching `^[0-9A-Z]{4}-[0-9A-Z]{2,5}$`). (3) **`waitForReauth` self-heal re-probe** — every 3m it gently navigates to `/home/portal/` to test+heal a transient redirect (the poll loop had no timeout → could hang forever).

**LESSON / OPEN OPERATIONAL ISSUE (06-21):** restarting the scraper 3× in ~20m to deploy the polish **degraded the FS session into a content-OK / index-walled split** — `/home/portal/` and `ark:` image pages load fine, but every `search/image/index?owc=…` roll-index page 302-redirects to `ident.familysearch.org/en/identity/login`. The portal re-probe makes the scraper *think* it recovered, then it re-walls on the index and defers the roll. Result: it churns ~1 roll/3m marking rolls `failed` (all retryable), no real progress, but **not hammering** (safe). **Fix = a human VNC re-login** (refreshes index-endpoint auth); portal-loads ≠ index-accessible. Takeaway: **don't rapid-restart the FS scraper** — each relaunch re-navigates portal→waypoints→index and the burst trips FS's index/search auth. Coverage at the time: collection is **12,890 rolls** (~7.7M images potential → multi-MONTH crawl), 39,211 images written across only **82 touched rolls / 18 complete**; within touched rolls 39,211/40,113 ≈ 98%.

---

## Session 63 — Probate LLM Extraction Pipeline + Forensic Accounting + Cron Drip (2026-06-09→12)

Branch: `audit/probate-classifier-and-source-documents` — committed + pushed (`fdb0c50e5`, `8d1c3e011`, `d42d3c9cb`, `f6660cd30`, `c95222389`, + the civilwardc/role-inversion + line-item-DAA commits earlier this session).

### The problem & the arc
Liberty probate was scraped/OCR'd (14,450 pp) but structured extraction was never done — the regex extractor scored **7.7% precision / 9.9% recall** on enslaved names. Built a real LLM extractor and discovered, in order: (1) the extractor is fine, **segmentation** was broken; (2) the name-recall ceiling is ~**55%** (cursive-OCR misses + estates spanning multiple roll series + first-name-only ambiguity — Fillis/Jane recur), NOT the model; (3) **the financial extraction is the strong product** — appraisements name FAR more enslaved-with-dollar-values than wills do. Pivoted to financial/forensic accounting (user: option 3 then 2).

### What was built (all in `src/services/probate/probate-llm-extractor.js` + `scripts/`)
- **Free multi-provider router** — OpenRouter(llama-3.3-70b:free) → OpenRouter(gpt-oss-120b:free) → Gemini-flash-lite → Cerebras gpt-oss-120b → Groq llama-70b, with 429/402/403 fall-through. Keys in `.env` (gitignored): OPENROUTER/GEMINI/CEREBRAS/GROQ. **Paid hosted ruled out** (user max $1-2/county; a county ~35M tokens ≈ $6 even cheapest). **Local ruled out empirically** — Mini is Intel i5/no-GPU/8GB; M1 MacBook 8GB swaps a 7B into a 5-min timeout. Good local needs Apple-Silicon ≥32GB (future hardware). User added **$10 OpenRouter** (one-time → 1,000 :free req/day, deposit not consumed by :free). NOTE OpenRouter :free models share *upstream* rate limits (llama-70b/qwen 429 intermittently) — gpt-oss-120b:free is the reliable workhorse.
- **Segmentation v2** (`scripts/segment-probate-v2.mjs` → `probate_estate_segments_v2`) — header-driven ("appraisement of the estate of NAME deceased"), groups a decedent's scattered will/appraisement pages by name; fixes v1 sequential carry-forward mis-attribution.
- **Estate-extraction runner** (`scripts/extract-probate-estates.mjs` → `probate_estate_extractions`) — single-estate (batching tanks recall), idempotent (UNIQUE segment_id), budget-resumable (stops on 4 consecutive provider failures). Schema: enslaved persons (name/age/appraised value/kin/bequeathed_to), non-chattel assets, liabilities, heirs, monetary_bequests, reconciling estate_totals.
- **Cron drip** (`scripts/probate-drip.mjs`) — one roll/tick, antebellum-first priority, segments+extracts, PID-locked, ntfy-notified. **Cron installed on Mini (every 3h).** Self-advances the corpus across daily free resets, hands-off, ~$0.

### Results (first roll, 9SYT-PT5 "Wills & appraisements 1790-1850")
**142/142 estates → 763 enslaved persons, 550 with individual dollar valuations, $224,857 total appraised.** Forensic accounting reconciles (Cooper: enslaved $4,341 + non-chattel $2,999 = stated total $7,340 — the chattel/non-chattel split M088 wealth_transfer_events needs). Drip now running the next antebellum roll (Accounts 1830-1858, 776pp).

### Also this session (earlier)
CivilWarDC enslaved↔enslaver **role-inversion** fixed (124 person_type flips + 117 petitions + 104 family_relationships; un-merged 2 collisions; promoted 75 petition persons) — DC petitions filed BY the enslaved under the July-12-1862 supplementary act had roles backwards. Line-item DAA Freedman's backfill (89,406 line items). Source-loading bug (enslaved canonical_persons own docs). Person-ID search. Mobile-Safari S3 image fix. Liberty probate scrape finished (last 171 images).

### Identity resolution / entity dedup (later in Session 63)
Triggered by the "how many Ann Biscoe?" problem. Resolved the **Biscoe/Briscoe DC cluster** by primary sources: **THREE distinct women** separated by FATHER (Ann Maria/Hopewell, Ann/Edward-Briscoe, Ann/Bennett-Biscoe) + daughters Angelica Chew & Emma. Hand-resolved (FK-safe merges of the FS-L64X-RH2/b.1799 matriarch dupes into 141015; 6 primary-source kinship edges; 1860-schedule link to Georgetown Ward 2). **Critical catch:** "Annie Maria Hopewell" #140344 (b.1844) is a DIFFERENT person — birth-year + father's FS ID kept her separate.
- **Methodology research** (`research/entity-resolution-methodology.md`, deep-research, 24/25 claims verified): Fellegi-Sunter scoring + Splink; phonetic-for-blocking-only / Jaro-Winkler-for-scoring; census one-to-one; discard multi-match; name-commonness. Parentage-primary + holding-trajectory are OUR extensions beyond published work.
- **First-pass resolver** (`scripts/resolve-canonical-dedup.mjs`, Biscoe-validated): block→score→route with shared-extid/shared-parent/CONFLICTING-parents/JW/birth-year/census-exclusion. Caught + fixed a sibling-merge bug (kinship is relational). GAP: phonetic blocking keys unpopulated → needs fixing before the full 565K/1.68M run.
- The 5 rules: **parentage is the primary disambiguation key**; **census-set mutual-exclusion** (one enumeration can't count a person twice); **completeness needs the relationship graph** not name search (married-name daughters/surname-bearing enslaved get missed); **holding-size is a trajectory** (inheritance), not a count match; **dedup runs both owner + enslaved sides**.

### Next
- Identity: fix blocking-key population, implement the resolver's full --all run → review table → MatchVerifier UI; then the cross-source 1.68M pass. Close the research gaps (Enslaved.org/Freedmen's methodology, kinship-primary weights).
- Probate: let the drip work the antebellum Liberty rolls (ntfy / `~/probate-drip.log`). Then option (2) data-layer breadth + (3) OCR quality on dense valuation pages. FINANCIAL extraction is the strong reconciling product; name-recall ceiling ~55%. Next county = one-line drip change.

---

## Session 62 — New York Probate Full-State Scrape (2026-06-10)

Branch: `audit/probate-classifier-and-source-documents` — **committed + pushed** (`1f88915bc` generic scraper; watchdog folded in this session).

### Goal / framing
Run **New York probate records 1629–1971** (FamilySearch collection **1920234**, 58 counties) end-to-end on the Mac Mini, the way Georgia was run. The point is **not** NY's brief direct slavery (abolished 1827) — it is full-population capture of the **northern merchant/financier wealth** built on slave-harvested products. Isaac Franklin's transaction ledgers give the southern side; the northern counterparties surface as testators across these probate files. Capturing the entire population reconciles both ledgers. Scope decision (user): **full collection, all counties.**

### Generic probate scraper (`scripts/scrapers/georgia-probate-scraper.js`, `1f88915bc`)
- Parameterized the (mis-named) Georgia scraper over any FS probate-by-county collection: `--collection --state --region --region-label --methodology-name`. **Defaults reproduce the Georgia run byte-for-byte**, so GA is unchanged.
- Derived `COLLECTION_ID/STATE/REGION_SLUG/REGION_LABEL/WAYPOINTS_URL/SITEMAP_FILE` from CLI; fixed a hardcoded `cc=1999178` inside a `page.evaluate` (browser-context closure couldn't see the constant — now passed as an arg); region/state-driven S3 prefix, collection labels, provenance, JSONB metadata keys, auto-created-person notes.
- NY launch: `--collection 1920234 --state NY --region new-york --region-label "New York" --apply --resume`.
- Filename kept as `georgia-probate-scraper.js` to avoid churning 7 references + the Mini deploy path; a rename is deferred.

### Run status (live on Mini, PID 50478, detached via nohup)
- Phase 0 complete: **58/58 counties, 12,948 rolls** indexed → `tmp/new-york-probate-sitemap.json`.
- Phase 1 writing, alphabetical from Albany. Verified in DB: `probate_scrape_progress` (collection 1920234) written-count climbing (35→116+ within minutes); `person_documents collection_key new-york-probate-%` with resolved testators; testators auto-promoted to `canonical_persons` (enslaver). S3 prefix `probate/new-york/…`.
- Multi-week crawl. Log: `~/probate-newyork-full.log` on the Mini.

### Operational gotchas hit & fixed
- **FS session was expired.** Old Chrome:9222 tabs *looked* logged in but every fresh nav hit the Sign-In wall (blocked Georgia too). User re-confirmed the Google login via VNC (`vnc://100.114.130.16`) → 58 counties enumerated. Captured a durable 61-cookie jar (`scripts/scrapers/_capture-fs-cookies.js` → `tmp/familysearch-cookies.json`, incl. `fssessionid`) and wired `FAMILYSEARCH_COOKIES` in the Mini `.env`. NOTE: `fssessionid` is a *session* cookie (no expiry, dies with the browser) — true durability = keep Chrome:9222 + the Google session alive; a weeks-long crawl may still need a periodic VNC re-login.
- **Mini repo was behind my branch** (on `main`): missing `src/services/probate/document-classifier.js` and `src/utils/person-name-validator.js` (both self-contained) — scp'd. Lesson: when deploying a branch scraper to the Mini, sync its new local requires too.
- Mini's non-login ssh shell lacks node on PATH — use `/usr/local/bin/node`.

### Scrape watchdog (`scripts/scrapers/probate-scrape-watchdog.js`, this session)
- Mini-local watchdog parameterized by `--collection`; alerts via existing `notify()`/ntfy (`OPS_NOTIFY_WEBHOOK`) on **state transitions only** (no spam): `died` (process gone), `login-wall` (no DB writes 30 min + log shows sign-in wall → "re-login via VNC"), `stall` (alive but no writes 30 min), and `recovered`. Keys off `probate_scrape_progress` written-count + `pgrep` + log tail; checks every 10 min.
- Registered under PM2 as `probate-watchdog-ny` (id 13, online) + `pm2 save` (resurrects on reboot). Host-level "Mini down" stays covered by the separate Pi `health-watchdog.js`. Test ntfy ping returned `{ok:true}`.

### Next
- Periodically confirm the crawl is advancing through the high-enslaved Hudson Valley / NYC-area counties (Kings, New York, Queens, Richmond, Ulster, Albany, Dutchess) and that the watchdog stays green.
- The session-cookie durability limitation is the main multi-week risk — watch for a `login-wall` ntfy alert.

---

## Session 61 — Line-Item DAA Backfill + Source-Loading Fixes (2026-06-07/08)

Branch: `audit/probate-classifier-and-source-documents` — **committed + pushed** (3 commits `438849671`, `a2eeeb7c9`, `32ad3bca6`; pushed to origin `7cf3c1265..32ad3bca6`).

### Line-item methodology — status
- **SlaveVoyages voyages (M089):** applied + loaded — 64,853 voyage rows in `slavevoyages_voyages`.
- **Framework seeds:** present — `harm_perpetrator_entities` (20), `legal_theory_registry` (5), `global_indicator_targets` (5).
- **Freedman's backfill: DONE** — `scripts/backfill-freedmans-line-items.mjs` had three bugs (all fixed): (1) `extraction_method='freedmans_bank_index'` typo vs data `freedmens_bank_index`/`_ocr` (matched 0/416,520); (2) citation `'Freedman\'s…'` — `\'` in a JS template literal collapsed to a bare quote and broke the string-concatenated SQL; (3) `canonical_person_id ← confirmed_individual_id` (varchar) violated the FK for non-numeric / dangling ids. Source query now filters `confirmed_individual_id ~ '^[0-9]+$' AND EXISTS(canonical_persons)`. **Inserted 89,406 line items across 83,442 people** ($47,501.29 each = $42 median × 0.75 recovery × 1.05^150; reconstruction era, domestic_us; 0 FK orphans). The line-item DAA now computes non-zero per person.
  - CAUTION: script builds INSERTs by string concat; only PK (uuid) constraint exists, so `ON CONFLICT DO NOTHING` does NOT dedupe — clear `WHERE calculation_method_key='freedmans_bank_direct_loss'` before any re-run.
- **Middle Passage backfill: DEFERRED.** 67,102 enslaved canonical_persons, 46,645 have birth year, **0 have death year** → Brattle person-years (death−birth) uncomputable. Decision: use a researched proxy (option b), assume children/elderly did not survive, and label proxies explicitly in output — but only after the proxy is research-justified. No constant hardcoded.
- **DAAOrchestrator:** `USE_LINE_ITEM_METHODOLOGY=true` but the line-item path is **dormant in production** — `daa.js` never passes `acknowledgerInfo.canonicalPersonId`, so live DAAs still use the legacy Craemer path (no $0 regression). `getLineItemsForPerson` Tier 1 works, **Tier 2 (geographic/state) is still a `[]` placeholder** (L66-69). LATENT: if the line-item branch is ever invoked, `DAADocumentGenerator.generateDOCX` (reads `slaveholderCalculations`/`totalEnslavedCount`/`totalDebt`) would crash, and `submitDAAOnChain` (daa.js:171) would submit `0`; `createDAARecord` + `upsertLineageLedger` handle both shapes.
- **Indicator wiring: DONE.** `GET /api/daa/global-indicators` serves `global_indicator_targets`; `client.js` `getGlobalIndicators`; `ReparationsBreakdown.jsx` `LineItemsView` now fetches via `useApi` (loading/error/empty states), replacing the hardcoded array. Frontend builds clean.

### Source-loading audit ("sources not loading on the canonical-persons front end")
- **Root cause #1 (broad blank):** transient AWS outage hit the Render backend's Neon/S3 calls. Self-healed when AWS recovered — verified prod healthy (enslaver 1170: 2 collections/122 pages, S3 presign 200 in 89ms). No code action.
- **Root cause #2 (persistent, FIXED):** enslaved/freedperson `canonical_persons` never loaded their OWN documents. In `contribute.js` the flat-`documents` loader had no `canonical_persons` branch for them, and the only `canonical_person_id` query (`documentCollections`) was gated by `!isFreedpersonType` (and `FREEDPERSON_TYPES` includes `'enslaved'`). Fix: a dedicated block loads their own `canonical_person_id` docs (no owner→enslaved lookup, no collection expansion). Scope was 12 canonical 'enslaved' persons.
- **Test harness:** `scripts/test-source-loading.mjs` — picks enslavers + enslaved/freedperson spanning every source type, hits `GET /api/contribute/person/:id` + S3 presign, prints per-source efficacy. Post-fix: **18/18 load, 0 zero-doc, 0 S3 failures** across DC compensated emancipation, SlaveVoyages, 1860 slave schedule, Georgia probate, FamilySearch.

### Migration renumber
- Resolved a duplicate `089` collision: `089-secondary-source-compilations.sql` (a separate probate/secondary-source effort, never applied, no `schema_migrations` row, table absent) renamed → `090-secondary-source-compilations.sql`. My `089-slavevoyages-voyages.sql` (applied + tracked) kept its number. The 090 file + `tests/fixtures/plantation-records/` + `tests/unit/test-plantation-record-extraction.js` are left UNTRACKED (belong to that other effort, not Session 61).

### Next
- Make the line-item DAA path end-to-end before wiring `canonicalPersonId` into `daa.js`: implement Tier 2 geographic query, and teach `DAADocumentGenerator`/`submitDAAOnChain` the line-item shape (else they crash / submit $0).
- Research-justify Middle Passage person-years proxy, then backfill with explicit proxy labeling.
- Commit the separate probate/secondary-source work (090 migration + plantation-record fixtures/tests).

---

## Session 60 — Global Reparations Schema Framework (2026-05-23/24)

Branch: `audit/probate-classifier-and-source-documents` (un-pushed; +1 commit `3117a284a`).

### Framing

User directed an expansion of the platform's schema beyond US-internal harm accounting toward a global framework that can sit on top of all three legs of the triangle trade. Reference reading: Vijay Prashad, *Washington Bullets* (Sankara's "debt of blood"; IMF as post-1945 CIA; tariff escalation as the modern continuation of manufactured-goods dependency). The schema landing is the scaffolding for that vision — no front-end work yet, no row data, just the tables and ALTERs needed so the platform can REPRESENT chartered companies, African polities, capital-flow successions, and bankruptcy-event wealth transfers as first-class objects.

User rule established this session and saved to auto-memory: **all harm_perpetrator_entities and similar reparations-domain row inserts must enter via the contribute pipeline on the front end, never via hardcoded seed scripts.** Schema CREATE TABLE migrations are fine to commit; row INSERTs are not. Examples raised: Bank of Bristol, Mount Hope Insurance Company, DeWolf family.

### Migrations landed (082-088, all applied to Neon, committed to git)

| # | Purpose | Key field / decision |
|---|---|---|
| 082 | `chartered_companies` (Royal African Company, WIC, East India, etc.) + bridge column on harm_perpetrator_entities | `sovereign_debt_fold_in_pathway` traces how modern obligations land on Treasuries when companies dissolved (RAC → Crown 1821 → modern FCDO/HM Treasury) |
| 083 | `african_polities` — both-ways modeling | `appears_as_harm_party` AND `appears_as_receiving_party` defaults BOTH FALSE — agnostic on entry, contributor must affirmatively assert with evidence. CHECK requires at least one. |
| 084 | `provenance_evidence` (generalized polymorphic citation table) | Subject is polymorphic (subject_entity_type + subject_entity_id, no FK enforcement). Replaces a polity-only `coercion_evidence` scope so corporate acknowledgments, charter documents, archival voyage records can all live in one table. Afonso I 1526 letters are the prototype use case. |
| 085 | `entity_successions` — unified corporate-merger AND capital-flow | `succession_kind` discriminator. `flow_path` JSONB required (CHECK constraint) when `capital_flow`. Lets DeWolf Bank of Bristol → Industrial Trust → Fleet → Bank of America be recorded as `attenuated` traceability, distinct from RAC → African Co. of Merchants → Crown `direct` succession. |
| 086 | `actor_roles` — polymorphic (actor, period, role) | `raider` is not exclusively a state role (EIC at Plassey 1757). Same actor can have multiple roles in same period or different roles across periods (Kongo: refuser 1500-1550 → coerced 1550-1800). `dependency_commodity` covers cowries, firearms, textiles, iron bars, copper manilas, glass beads, spirits, tobacco, mixed. |
| 087 | ALTER `reparations_harm_categories` — neocolonial extension | Adds `perpetrating_multilateral` (IMF / World Bank / BIS / WTO) + `extraction_mechanism` (currency_devaluation / tariff_escalation / reserve_seigniorage / sovereign_debt_buyback / structural_adjustment / vulture_litigation). Targets: Haiti double-debt, CFA franc seigniorage, IMF SAPs, tariff escalation, vulture funds. |
| 088 | `wealth_transfer_events` — first-class object for bankruptcy / foreclosure / probate sale events | Asset-proportion columns (`enslaved_persons_appraised_value_usd` vs `non_chattel_assets_value_usd`) make recoverable the typically-larger non-chattel wealth that flowed to creditors as additional extraction beyond what Brattle person-year valuation captures. Astor pattern (Northern financier-turned-enslaver-via-default). Adds nullable `wealth_transfer_event_id` FK on entity_successions AND family_relationships. `probate_sale` is a distinct event_type. |

### Research corrections incurred this session

- **NHM ≠ WIC successor.** NHM was a 1824 fresh creation, not a successor. ABN AMRO's actual slavery exposure runs through Hope & Co. and R. Mees & Zoonen per the IISH 2022 study (Pepijn Brandon, *Sporen van het slavernijverleden van de historische rechtsvoorgangers van ABN AMRO*).
- **Caisse des Dépôts ≠ Compagnie des Indes successor.** CDC founded 1816, post-dates 1790 Compagnie liquidation. Modern obligation sits with the French Republic.
- **Bank of Bristol → Bank of America is family-capital, not corporate succession.** James DeWolf wealth → grand-nephew Samuel Pomeroy Colt founded Industrial Trust (1886) → Industrial National → Fleet → BofA (2004). Recorded as `traceability='attenuated'`.
- **Adjua DeWolf confirmed enslaved African woman**, gifted by James DeWolf to his wife Nancy in 1803 along with Pauledore. Akan name from southern Ghana. PBS *Traces of the Trade*. Early-platform DB entry was a real person, not a stray.
- **South Sea Annuities → consols → finally redeemed by HM Treasury in 2015** — same year UK Treasury closed the 1833 abolition loan. Two slavery-derived British debts paid by UK taxpayers as recently as 2015.
- **Companhia Grão-Pará liquidation ran until 1914** (130 years).
- **Afonso I letters canonical citation:** Thornton 2023, *Afonso I Mvemba a Nzinga, King of Kongo* (Hackett). Archive: ANTT Lisbon, *Corpo Cronológico* Parte I, maço 34, July 6 + October 18, 1526.

### Probate work — unaffected

M082-M088 are additive (new tables + nullable column adds). The only intersection with probate-relevant tables is M088's nullable `wealth_transfer_event_id` FK addition on `family_relationships`, which doesn't require any existing INSERT to change. Forward-looking: the Georgia probate ETL is a natural source of `wealth_transfer_events` rows (every probated estate sale is `event_type='probate_sale'`), but that's an enhancement post-probate-rebuild, not a present requirement.

### Open / Next

- **Contribute pipeline extension** (the pipe — was originally going to be called M085 in conversation but is code, not a migration). Extend `/promote/:leadId` in `src/api/routes/contribute.js:3704` with a `target_table` discriminator so a single endpoint can land into `chartered_companies`, `african_polities`, `provenance_evidence`, `entity_successions`, `actor_roles`, or `wealth_transfer_events` (in addition to current `enslaved_individuals`). Plus per-entity-type validators. Reuse existing review-queue gating pattern at line 4294.
- **Front-end nomination form.** New contribute UI component that lets a contributor pick "I'm nominating a [perpetrator entity / chartered company / polity / succession / role / evidence / wealth transfer event]" and fill the appropriate fields.
- **Bank of Bristol, Mount Hope Insurance Company, DeWolf family, Royal African Company, Kingdom of Kongo (Afonso I evidence)** are queued for first-test entries through the contribute pipeline once the extension lands.
- **Probate ETL enrichment** to emit `wealth_transfer_events` rows from will/inventory records — deferred until probate rebuild stabilizes per Session 59 plan.

---

## Session 59 — Probate Data Quality + Canonical Audit + Extraction Rebuild (2026-05-20/21)

Branch: `audit/probate-classifier-and-source-documents` (un-pushed; 8 commits).

### 1. Probate document classifier
- The scraper tagged a page `will` whenever "executor" + "will" appeared anywhere — estate accounts, inventories, will-book index pages all swept in. New `src/services/probate/document-classifier.js` is the single shared classifier (scraper + segmenter both import it). `extraction_confidence` no longer inherits the schema-default 0.70 — it's a real signal weight.
- `scripts/reclassify-probate-documents.mjs` backfilled 12,699 probate `person_documents`: will count 2,085 → 1,054.

### 2. Canonical-person source-document audit
- Audited all 563k `canonical_persons`; only 7% served a document. `contribute.js` was discarding every S3-less `familysearch.org` doc — narrowed to `/tree/` profiles only so `/ark:/` record links serve.
- `scripts/backfill-bucketB-source-documents.mjs` (+320,354 FamilySearch ark rows) and `backfill-bucketC-slavevoyages-documents.mjs` (+51,017 SlaveVoyages rows). Coverage 7% → 73%.
- Bucket C2 (~72k, compendium-only, no stored URL) + D (~80k) not DB-repairable — see `plan-identity-resolution-completion.md`.

### 3. Junk cleanup + leak gate
- Deleted 3,271 `system`/`unknown` junk rows (Wikipedia + will-fragment OCR turned into persons) via `scripts/cleanup-system-unknown-junk.mjs` (FK-safe, scans all 42 FKs).
- New shared `src/utils/person-name-validator.js`; `NameResolver` and the probate scraper both gate person creation through `isValidPersonName`.
- Linked 4,970 ancestor-climb persons to their FamilySearch profile (`backfill-climb-fs-identity.mjs`).

### 4. Probate entity-extraction rebuild
- `src/services/probate/probate-entity-extractor.js` — testator / year / heirs / enslaved / estate value. Anchor + `leadingName`/`trailingName` trimming; spot-checked and debugged against stored OCR via `scripts/test-probate-extraction.mjs`.
- Measured vs the scraper's stored values: testator 37%→54%, year 63%→88%, heirs 44→959, enslaved 534→1,943 (false positives removed).
- `scripts/reparse-probate-entities.mjs` — applies the extractor to all 14,298 stored OCR pages, propagates testators across segmented documents, writes name/year/`canonical_person_id`/`inheritance_edges`/`unconfirmed_persons`/estate value. **APPLIED.** DB now: person_documents named 37%→81%, linked 30%→79%; `inheritance_edges` 44→2,637; 1,675 enslaved `unconfirmed_persons`; 447 estate values; 2,637 canonical_persons created/matched.

### 5. Heir-list extraction + front-end test
- `extractHeirs` rewritten with `parseHeirList` — captures full comma/and/&-separated lists ("to my Sons A, B, C, D"), not just the first name. `scripts/test-heir-extraction.mjs` 5/5. Heirs 959→2,789.
- `scripts/test-probate-frontend.mjs` drives the real HTTP API for 20 testators. **Found + fixed a critical bug:** the person-profile endpoint expanded probate `collection_key` to the whole roll — Mary #609577 served 10,606 documents for 43 linked. `contribute.js` now excludes `georgia-probate-%` from collection_key expansion; probate serves via direct `canonical_person_id` link. Re-test: 0 bugs, document counts exact.

### Open / Next
- **Land transfer events: NONE** — `land_transfer_events` has 1 row total; `inheritance_edges` asset_type all 'unspecified'. Wills bequeath land but it is not extracted — needs an asset-classification pass.
- Liberty scrape finishing on Mac Mini (171 pending images) — re-run `reparse-probate-entities.mjs` after.
- 133/2,130 reparse testators are single-word names (partial OCR) — dedup risk.
- Identity resolution completion (tiered fingerprint) — scoped (`plan-identity-resolution-completion.md`), not built.
- Probate covers 1 of ~130 Georgia counties — Liberty validated; ready to scale.
- Frontend groups probate pages by roll `collection_key`, not `probate_documents` (logical document) — cosmetic grouping refinement.

---

## Session 58 — Georgia Probate Scraper Transaction Safety — ✅ COMMITTED (2026-05-15)

### Problem
The `_jsonErr` try/catch added in Session 57 (commit `34a3b3fba`) caught the `invalid input syntax for type json` error and retried the `UPDATE canonical_persons SET notes = $1` — but did not issue a `ROLLBACK` first. Because Neon uses connection pooling, a failed query inside an open transaction leaves the connection in **"aborted" state**: every subsequent query on that `client` returns `ERROR: current transaction is aborted, commands ignored until end of transaction block`. This means all downstream writes (heir upserts, enslaved person inserts, COMMIT) silently failed even though the outer error handler never saw an error.

### Fix — SAVEPOINTs on all three inner catch blocks
A bare `ROLLBACK` was not used because it would destroy all prior work in the transaction (person_documents INSERT, testator canonical_person upsert, enslaver_evidence_compendium INSERT) and leave the client without an active transaction.

| Savepoint name | Lines | Purpose |
|---|---|---|
| `before_notes_update` | 794–807 | JSONB merge retry — rolls back only the notes cast; person_documents + testator rows preserved |
| `before_heir_upsert` | 822–847 | Per-heir loop — one bad heir name doesn't abort the rest |
| `before_enslaved_insert` | 857–907 | Per-enslaved loop — one constraint violation doesn't abort subsequent rows |

Pattern used in every case:
```js
await client.query('SAVEPOINT <name>');
try {
    // risky query
    await client.query('RELEASE SAVEPOINT <name>');
} catch (e) {
    try { await client.query('ROLLBACK TO SAVEPOINT <name>'); } catch (_) {}
    // log + continue, or retry with fallback query
}
```

### Commit
`node --check` passes. Pushed as commit after `34a3b3fba` to `origin/main`.

### Next Step on Mac Mini
```bash
cd ~/Desktop/Reparations-is-a-real-number && git pull origin main
/usr/local/opt/postgresql@18/bin/psql "$DATABASE_URL" -c "
  UPDATE probate_scrape_progress SET status='pending', error_text=NULL
  WHERE collection_id='1999178' AND status='failed';"
nohup node scripts/scrapers/georgia-probate-scraper.js \
  --county Liberty --apply --resume \
  > ~/probate-liberty-roll1-rerun.log 2>&1 &
```

---

## Session 57 — Georgia Probate Scraper Full Rewrite — ✅ COMMITTED & CONFIRMED WORKING (2026-05-15)

### What Was Done (4 major fixes + 1 bonus)

**Fix 1 — `buildSitemap()` stores `rollIndexUrl` per roll**
Each roll entry now carries the pre-computed URL:
`https://www.familysearch.org/search/image/index?owc=groupId:dgs?cc=1999178`

**Fix 2 — `buildImageUrl(arkId)` simplified**
Single-parameter helper; returns the fullText reference URL only (not used for navigation).

**Fix 3 — `scrapeOneRoll()` completely rewritten**
Old approach used `groupId:dgs` image index URL directly and a fragile multi-param `page.goto()`.
New approach:
1. Navigate to `roll.rollIndexUrl`
2. Click the first `a[href*="/ark:/61903/3:1:"]` thumbnail → viewer opens on image 1
3. Read image-1 ARK from `page.url()` (each image has a unique ARK, not the group ARK)
4. Advance images 2…N via viewer number-input field (`advanceViewerToImage` helper) — extracts per-image ARK from `page.url()` each time

**Fix 4 — `processImage()` streamlined**
- Removed `page.goto()` and `dgsEncoded` param — caller has already navigated
- 2s wait → `div[data-testid="full-text-transcript"]` extraction (unchanged from Session 56)
- Returns `status='no_transcript'` for empty/short text

**Bonus fix — `ensureLoggedIn` try/catch**
FamilySearch redirects `familysearch.org/` → `/en/home/portal/` during `sleep()`, destroying the page execution context. Added try/catch around `page.evaluate()`:
```js
const checkLoggedIn = async () => {
    try {
        const url = page.url();
        if (url.includes('/home/portal/') || url.includes('familysearch.org/home')) return true;
        return await page.evaluate(() =>
            document.querySelector('button[data-testid="user-menu-button"]') !== null ||
            document.querySelector('[data-testid="header-profile"]') !== null ||
            document.querySelector('a[href*="/account/"]') !== null
        );
    } catch (_) {
        const url = page.url();
        return url.includes('/home/portal/') || url.includes('familysearch.org/home');
    }
};
```

### Commits
| Commit | Description |
|--------|-------------|
| `0526ef8e8` | Session 56: data-testid selector fix |
| `9c00e32c3` | Session 57: full rewrite — rollIndexUrl sitemap, advanceViewerToImage, per-image ARK from page.url(), ensureLoggedIn try/catch, M078 auto-apply |

### Mac Mini Confirmed Working Output (commit `9c00e32c3`)
```
Starting Georgia Probate Scraper (multi-county/multi-roll)...
Found 131 county entries on waypoints page.
Found 71 rolls in Liberty.
Roll: "Wills, appraisements and bonds 1790-1850 vol B" [9SYT-PT5] in Liberty
Image count: 689
Image 1 ARK: 3QSQ-G93L-GHFK  ← real image-specific ARK
Image 2 ARK: 3QSQ-G93L-GHJ2 → status=parsed, rawText: "T ┃ S ┃ Swede"
Image 3 ARK: 3QS7-L93L-GH2J → status=parsed, rawText: "LIBERTY COUNTY STATE OF GEORGIA COURT BOOK..."
Image 4 ARK: 3QSQ-G93L-P9R2 → status=parsed, rawText: "AND DATE FILMED AUGED 1958 EXPOSURE..."
Image 5 ARK: 3QSQ-G93L-PSZZ → status=no_transcript
Scraping complete. Total images processed: 5
```

### Key Technical Facts (permanent notes)
- **FamilySearch SPA**: always `waitUntil: 'domcontentloaded'`; NEVER `networkidle0`
- **Per-image ARK**: extracted from `page.url()` after viewer navigation — NOT from the group ARK `9SYT-PT5`
- **Viewer input navigation**: triple-click `input[aria-label*="mage"]` / `input[class*="image-number"]` / `input[type="number"]`, type number, Enter, 6s sleep
- **puppeteer.connect()** to port 9222; fallback to `open -na "Google Chrome"` system launch; NEVER `puppeteer.launch()` (crashes on Intel Mac Sonoma)
- **`probate_scrape_progress`** UNIQUE constraint: `(collection_id, roll_group_id, image_number)` — migration 078
- **Sitemap**: `tmp/georgia-probate-sitemap.json`

### Files Changed
| File | Change |
|------|--------|
| `scripts/scrapers/georgia-probate-scraper.js` | Full rewrite — 4 major fixes + ensureLoggedIn try/catch |
| `migrations/078-probate-scrape-progress-roll-column.sql` | Adds `roll_group_id TEXT`, replaces UNIQUE constraint |

### Next Steps — Mac Mini
**Step 3 — Write to DB (limit 10, one roll)**
```bash
node scripts/scrapers/georgia-probate-scraper.js \
  --county Liberty \
  --roll-title "Wills, appraisements and bonds 1790" \
  --limit 10 --apply --verbose
```

**Step 4 — Full Liberty County**
```bash
node scripts/scrapers/georgia-probate-scraper.js --county Liberty --apply --resume
```

**Step 5 — All counties (only after Step 4 verified)**
```bash
node scripts/scrapers/georgia-probate-scraper.js --apply --resume
```

---

## Session 55 — Georgia Probate Scraper Schema Bug Fixes — ✅ COMMITTED (2026-05-15)

### What Was Built
`scripts/scrapers/georgia-probate-scraper.js` — Puppeteer scraper for Liberty County GA probate records (FamilySearch collection 1999178, group 9SYT-PT5, 555 images, 1858-1867). `migrations/069-georgia-probate-pipeline.sql` — pipeline infrastructure (progress table, source registry, methodology entries).

### Schema Bugs Fixed (commit 6bcdea8fa, pushed to origin main)
1. **`person_documents` INSERT**: Removed non-existent columns `extraction_method`, `title`. Added `source_url`, `source_type`, `image_number`. Used `ON CONFLICT DO NOTHING` with null-row guard.
2. **`inheritance_edges` asset_type**: `'general_bequest'` → `'unspecified'` (valid CHECK value per M067).
3. **`canonical_persons` INSERT**: No unique constraint on canonical_name column. Replaced `ON CONFLICT` clause with fuzzy-match SELECT-first, plain INSERT if no match (Levenshtein ≤ 2 + county + year window).
4. **`person_relationships_verified`**: Removed — `person_id` FK requires `canonical_persons(id)`, but enslaved persons live in `unconfirmed_persons`. Relationship stored in `unconfirmed_persons.relationships` JSONB instead.
5. **`estimation_methodology_registry` query**: Column is `name`, not `methodology_name`. Added `AND version = 'v1.0.0'` filter.
6. **Migration 069**: Rewrote both INSERTs with correct column names matching actual `regional_source_registry` (no `state`/`county`/`is_compilation`/`collection_id` columns) and `estimation_methodology_registry` (columns: `name`, `version`, `description`, `role_tags`, `assumptions_jsonb`, `citations`, `known_failure_modes`).

### Schema Facts Confirmed This Session
- `canonical_persons`: **NO UNIQUE** constraint on `canonical_name` — use SELECT-first approach
- `inheritance_edges.asset_type` valid values: `'real_property','enslaved_persons','personal_estate','monetary_bequest','residual_estate','trust_interest','business_interest','mixed','unspecified'`
- `inheritance_edges.confidence` NUMERIC(4,3) — column EXISTS (confirmed)
- `person_relationships_verified.person_id` → FK to `canonical_persons(id)` only
- `regional_source_registry` columns: `source_name, citation, jurisdiction_text, era_start, era_end, record_type, axis_role, access_method, coverage_notes, methodology_id` — NOT state/county/is_compilation/external_url/collection_id
- `estimation_methodology_registry` UNIQUE on `(name, version)` — conflict target for ON CONFLICT

### Next Steps — Mac Mini
```bash
cd ~/Reparations-is-a-real-number && git pull origin main

# Test transcript extraction on image 141 (known-transcribed):
node scripts/scrapers/georgia-probate-scraper.js \
  --county Liberty --state GA --collection 1999178 \
  --group-id 9SYT-PT5 --dgs "267679901,268032901" \
  --ark 3QS7-893L-P9FS --dry-run --verbose

# If transcript found, dry-run first 5:
node scripts/scrapers/georgia-probate-scraper.js \
  --county Liberty --state GA --collection 1999178 \
  --group-id 9SYT-PT5 --dgs "267679901,268032901" \
  --start-image 1 --limit 5 --dry-run --verbose

# Apply first 10:
node scripts/scrapers/georgia-probate-scraper.js \
  --county Liberty --state GA --collection 1999178 \
  --group-id 9SYT-PT5 --dgs "267679901,268032901" \
  --start-image 1 --limit 10 --apply
```

_Last updated: 2026-05-14 (Session 54 — Frontend 429 / Rate-Limit Bug Fix)_

---

## Session 54 — Frontend 429 / Rate-Limit Bug Fix — ✅ DEPLOYED (2026-05-14)

### What Was Done

Fixed three console errors (`429 × 2` + "You do not have permission") caused by the `GET /api/contribute/stats` endpoint being double-limited by the tight `generalLimiter` (100 req / 15 min). All users share the same upstream IP (GitHub Pages → Render reverse proxy), so the budget was regularly exhausted under normal page-load traffic.

### Files Changed

| File | Change |
|------|--------|
| `middleware/rate-limit.js` | Added `statsLimiter` (500 req/15 min, `skipFailedRequests: true`); added `skip: (req) => req.path === '/contribute/stats'` to `generalLimiter` so the two limiters don't stack; exported `statsLimiter` |
| `src/server.js` | Imported `statsLimiter`; registered `app.use('/api/contribute/stats', statsLimiter)` before the contribute router mounts |
| `frontend/src/components/Layout/StatsRibbon.jsx` | Replaced raw `useApi` call with `sessionStorage` cache (`CACHE_KEY='reparations.stats_cache'`, 5-min TTL matching server-side cache). Component reads from cache on remount / React StrictMode double-invocations — at most 1 network call per 5 min per browser session. Private-mode `sessionStorage` failures caught silently. |

### Root Cause Summary

- `app.use('/api', generalLimiter)` applied the 100 req/15 min limit to **all** API routes including stats.
- Since the frontend (GitHub Pages) calls Render from a shared egress IP, all users were counted against a single IP bucket.
- `express-rate-limit` stacks additively — adding a second limiter doesn't replace the first. The fix required both: (a) skip the stats path in `generalLimiter`, and (b) register `statsLimiter` for that path.
- The third console error ("You do not have permission") was Render's infrastructure responding to blocked requests after the rate limit was exhausted.

### Pattern to Remember
- `req.path` inside `app.use('/api', limiter)` is relative to the mount point: `/contribute/stats`, NOT `/api/contribute/stats`.
- Always add `skip` to the general limiter when exempting a path — don't just add a second limiter on top.

---

## Session 53 — Hynson Compilation Tracking + Multi-Doc Pipeline — ✅ DEPLOYED (2026-05-14)

### What Was Done

Full Day 1 of Hynson DC Runaway/Fugitive Slave Case Books intake pipeline. Three files written, M068 applied to Neon, all layers deployed (commit `9d47d0acc`).

#### M068 — `migrations/068-compilation-source-tracking.sql`
- Adds `is_compilation BOOLEAN`, `compiles_from_description TEXT`, `original_location_text TEXT`, `max_evidence_tier TEXT CHECK(IN 'direct_primary','indirect_primary','secondary','inferred')` to `regional_source_registry`
- Adds `original_document_location TEXT`, `verification_status TEXT DEFAULT 'not_applicable' CHECK(IN 'not_applicable','unverified_compilation','original_sought_not_found','original_located','original_verified')` to `enslaver_evidence_compendium`
- Updates Hynson 1848-1863 registry entry: `record_type='court_record'`, `is_compilation=TRUE`, `max_evidence_tier='secondary'`, originals at NARA RG 21
- Inserts new Hynson 1862-1863 registry entry (same flags)
- Updates MSA S1431 + Glover Park History / Carlton Fletcher to `is_compilation=TRUE`
- Inserts `hynson_dc_runaway_fugitive_cases_compilation` methodology row (Tier C, v1.0.0) into `estimation_methodology_registry`
- **Applied to Neon:** 4×ALTER TABLE, 2×UPDATE, 1×INSERT (registry), 1×INSERT (methodology)

#### `src/api/routes/wills.js` — fully rewritten
- File size cap: 25MB → **75MB** (Heritage Books PDFs can be 30-80MB)
- 5 document types: `will`, `case_register`, `deed`, `estate_inventory`, `other`
- S3 prefix routing by docType: `wills/`, `case-registers/`, `deeds/`, `estate-inventories/`, `archival-docs/`
- `person_documents.document_type` uses passed docType (not hardcoded 'will')
- Name resolution + `will_extractions` INSERT: **only for `docType === 'will'`**
- Candidate auto-linking: **only for `docType === 'will'`**
- `nextSteps` for `case_register` returns exact OCR + parse + fanout script commands with `person_documents.id`

#### `frontend/src/components/Intake/SubmitWillPage.jsx` — fully rewritten
- 5-option radio doc-type selector (will / case_register / deed / estate_inventory / other)
- Context-aware fields by type: registers show `documentTitle`, `eraStart`, `eraEnd`, `compiledBy` + **amber Tier C warning box**
- File size display: KB → MB
- Success screen: register type shows "Evidence tier: Tier C (secondary compilation)" + NARA upgrade note
- `result.nextSteps` rendered as `<code>` list

#### Deploy status
| Layer | Status |
|-------|--------|
| Neon DB (M068) | ✅ Applied (4 ALTERs, 2 UPDATEs, 1+1 INSERTs) |
| Backend (Render) | ✅ Auto-deploying from `9d47d0acc` push |
| Frontend (GitHub Pages) | ✅ Published `gh-pages-react` |

### Evidence Tier Architecture (Hynson)
- **Source ceiling**: Hynson 1999 Heritage Books = `max_evidence_tier='secondary'` (Tier C). Cannot be promoted to Tier A/B without locating NARA RG 21 originals.
- **Relationship type**: Always `possessed` (not `owned`) — claimant retained custody claim against enslaved person's movement, not ownership title.
- **verification_status upgrade path**: `unverified_compilation` → `original_located` → `original_verified` (update `enslaver_evidence_compendium.verification_status` when NARA originals are inspected)

### Next Steps — Day 2+ (Hynson pipeline)
1. **Upload Hynson PDFs** at `https://danyelajunebrown.github.io/Reparations-is-a-real-number/contribute/will`
   - Select "Case Register (runaway / fugitive cases)"
   - Fill: Document Title, Era Start, Era End, Compiled By = "Roger D. Hynson"
   - **Copy the `person_documents.id` from the success screen** — needed for Day 2 OCR
2. **Day 2 — OCR**: Generalize `scripts/ocr-hopewell-physical-scans.mjs` → `scripts/ocr-register-document.mjs` (accept `--doc-id`, page-chunked Vision API, write to `person_documents.ocr_text`)
3. **Day 3 — Parse**: `scripts/parse-hynson-case-entries.js` — regex case entry parser (claimant name, enslaved name, date, case outcome)
4. **Day 3 — Fanout**: `scripts/fanout-hynson-cases.js` — writes:
   - `unconfirmed_persons` (enslaved individuals)
   - `slaveholding_relationships` (`relationship_type='possessed'`, not 'owned')
   - `enslaver_evidence_compendium` (`evidence_strength='secondary'`, `verification_status='unverified_compilation'`, `methodology_id` = hynson methodology UUID)
5. **Day 4 — Cross-reference**: Hynson claimants ↔ `civilwardc_petitions` for dual-corroboration (upgrades Tier C → Tier B if matched)

### Still Pending from Session 52
1. Fix Will 3 EPIPE: change `-r 300` → `-r 150` in `ocrDocument()`, re-run `--apply` for Hugh Hopewell V only
2. Fix `test-daa-hopewell.js` Sarah/Such assignment error (audit §4.1)
3. Fix `backfill-inheritance-edges-from-will-extractions.js` 3 schema bugs (audit §4.2)
4. Backfill M063-M067 into `schema_migrations` table (audit §4.3)

---

## Session 52 — Hopewell Physical Scan OCR + Will Ingestion Audit — ✅ COMPLETE (2026-05-12)

### What Was Done

Ran `scripts/ocr-hopewell-physical-scans.mjs --apply` (Run 2, PID 40058) to OCR four St. Mary's County Register of Wills physical PDFs and write all evidence into the DB. APPLY COMPLETE confirmed at 1:37 AM UTC-4.

#### PDFs Processed (Run 2 confirmed)
| Slug | File | Pages | Status |
|------|------|-------|--------|
| james-hopewell-1817 | saint mary's will 1.pdf (11.3MB) | 3 | Classification: CONFIRMED, MEDIUM, 6518 chars |
| composite-1848 | saint mary's will 2.pdf (6.6MB) | 2 | Classification: UNKNOWN, MEDIUM, 6811 chars |
| hugh-hopewell-v-1777 | saint mary's will 3.pdf (23.7MB) | 6 rendered | OCR FAILED — write EPIPE (27MB PNG > 10MB Vision limit) |
| composite-1785 | saint mary's will 4.pdf (9.8MB) | 3 | Classification: UNKNOWN, MEDIUM, 7801 chars |

#### Phase 0 DB Pre-flight Results (live Neon, 2026-05-12 00:46 UTC-4)
- **Q1** — `person_relationships_verified` for cp 1070/140299/141015: 4 rows (ids 1788-1791). Spouse + parent edges confirmed.
- **Q2** — `will_extractions` for doc_id=19: 0 rows before run → INSERT on --apply
- **Q3** — `enslaver_evidence_compendium` cp=1070: 7 rows (person_documents + person_external_ids + 5x debt_acknowledgment_agreements)
- **Q4** — `inheritance_edges` table: EXISTS ✓
- **Q5** — `person_documents.will_extraction_id` column: MISSING ❌ (backfill script will fail)
- **Q6** — Hugh Hopewell canonical_persons (any type): id=193376 "Hugh Hopewell IV" born=1725 died=1777 type=descendant → UPDATE to enslaver
- **Q7** — cp=1070 James Hopewell: EXISTS ✓
- **Q8** — 4 will rows in person_documents (ids 19, 44165, 184161, 184162)
- **Q9** — 17 schema_migrations applied M040-M062; M063-M067 applied to Neon but NOT tracked

#### Phase 1 State Verification (--apply run, correct)
- James↔Angelica spouse edge: ✓ EXISTS
- James→Ann Maria parent edge: ✓ EXISTS
- will_extractions doc_id=19: ✗ MISSING — INSERT
- **Hugh V (GX1Q-ZMD, d.1777): ✓ EXISTS id=193376** (Bug 4 fixed — was falsely matching id=193559 Agnes Hopewell)
- Hugh VI (b.1758, d.1785): ✗ MISSING — INSERT

#### Bugs Fixed in Session 52 (all 5 in script)
1. **Q6 person_type filter** — removed `AND person_type IN ('enslaver',...)`. id=193376 (type=descendant) now returned.
2. **Q9 `migration_id` → `filename`** — schema_migrations uses `filename` column.
3. **Hugh V Phase 4 UPDATE vs INSERT** — `else` branch UPDATEs id=193376 to `person_type='enslaver'` instead of INSERT.
4. **verifyState false match** — id=193559 "Agnes Hopewell" has `mother_fs_id:GX1Q-ZMD` in notes (not a direct match). Fixed to check `"familysearch_id":"GX1Q-ZMD"` exactly → correctly finds id=193376.
5. **`insertUnconfirmedPerson` missing `source_url`** — `unconfirmed_persons.source_url TEXT NOT NULL` violated. Added `source_url` as 10th column/value in both INSERT variants + all 3 call sites.

#### DB Writes — Run 2 Actuals (confirmed 2026-05-12 01:37 UTC-4)
- `will_extractions` UPDATE × 1 — id=`08a21999-7236-4525-b478-78ddbd71831e` (doc=19, cp=1070, Will 1)
- `will_extractions` INSERT × 2 — id=`c40ee851-fd53-4518-9aa2-d0982de5d776` (doc=184163, cp=609495, Will 4); id=`9e6581f2-bf36-4446-8ba3-0f8fc203ab32` (doc=184164, cp=NULL, Will 2)
- `person_documents` INSERT × 2 — id=184163 (Hugh VI, cp=609495); id=184164 (composite 1848, cp=NULL)
- `person_documents` UPDATE × 1 — id=19 (collection metadata only, ocr_text preserved)
- `canonical_persons` INSERT × 1 — cp=609495 "Hugh Hopewell" (Hugh VI, b.1758, d.1785)
- `canonical_persons` UPDATE × 1 — cp=193376 person_type 'descendant' → 'enslaver'
- `person_relationships_verified` INSERT × 2 — id=1796 sibling_of (609495→1070); id=1797 parent_of (193376→609495)
- `unconfirmed_persons` INSERT × 36 — lead_ids 2790306–2790335 (30 × James 1817 enslaved); lead_ids 2790336–2790341 (6 × Burroughes enslaved)
- `enslaver_evidence_compendium` INSERT × 1 — cp=609495, source=will_extractions/`c40ee851-fd53-4518-9aa2-d0982de5d776`
- **Will 3 (Hugh V 1777) — 5 writes NOT performed** (EPIPE; see audit §4.8)

#### New Files (Session 52)
- `scripts/ocr-hopewell-physical-scans.mjs` — 1610-line OCR + DB ingestion script (5 bugs fixed)
- `docs/will-ingestion-audit-2026-05-12.md` — pipeline gap analysis + OCR quality findings + Run 2 confirmed IDs

### Remaining Next Steps (post-commit)
1. Fix Will 3 EPIPE: change `-r 300` → `-r 150` in `ocrDocument()`, re-run `--apply` for Will 3 only
2. Fix `test-daa-hopewell.js` Sarah/Such assignment error (audit §4.1)
3. Fix `backfill-inheritance-edges-from-will-extractions.js` 3 schema bugs (audit §4.2)
4. Backfill M063-M067 into `schema_migrations` table (audit §4.3)

---

## Session 51 — Weaver Family Edges + Full Deploy — COMPLETED (2026-05-11)

### What Was Fixed
1. **Mary Ann Weaver created** — `canonical_persons` id=609494. Washington DC, d.1883. person_type=enslaver, confidence=0.95, verification_status=verified.
2. **Henry Weaver ↔ Mary Ann Weaver spouse edge** — `canonical_family_edges` id=2. tier=1, verified=true, confidence=1.0.
3. **Frontend deployed to GitHub Pages** — `npm run deploy:gh-pages` (push to `gh-pages-react`). Deploy run 25687609071 succeeded.

### API Verification (live)
```
GET /api/contribute/person/196747?table=canonical_persons  (Henry Weaver)
familyMembers.spouse = {"id":609494,"full_name":"Mary Ann Weaver","death_year":1883,"evidence_tier":1,"verified":true}
```

### Commits
- `4e9c8b8cc` — create Mary Ann Weaver (id=609494) + spouse edge to Henry Weaver (id=196747)

---

## Session 50 — Spouse Field Fix + DB Deployment — COMPLETED (2026-05-11)

### What Was Fixed
1. **SPOUSE field showing "—"** — `PersonProfile.jsx` rendered `p.spouse_name` (nonexistent column). Fixed to `spouseFromFamily` from `data.familyMembers.spouse`.
2. **FamilySearch URL filter deployed**
3. **Descendant exclusion deployed**

### DB Changes
- M066 (`canonical_family_edges`) — applied to Neon ✅
- M067 (`inheritance_edges`) — fixed UUID FK types, applied ✅
- Spouse edge: Angelica Chew (141014) ↔ Frisby Freeland Chew I (193163), tier=1, verified=true

### Key DB Schema Facts
- `canonical_persons` does NOT have `spouse_name`. Spouse data via `canonical_family_edges`.
- `will_extractions.id` is UUID (not INTEGER)
- `land_transfer_events` PK is `transfer_id UUID`

### Commits
- `cf68b9b46` — PersonProfile.jsx spouse field + contribute.js 3 fixes + M066/M067 + scripts
- `ed44c5d5b` — fix M067 UUID FK types
- `d3a0a6a9d` — fix backfill script graceful exit for missing column

---

## Critical Schema Facts (always needed)

```
canonical_persons columns:
  id, canonical_name, first_name, middle_name, last_name,
  birth_year_estimate, death_year_estimate,   ← NOT birth_year / death_year
  sex,                                         ← NOT gender
  primary_state, primary_county, primary_plantation,
  person_type, verification_status, confidence_score, notes
  ← NO spouse_name column (use canonical_family_edges)

unconfirmed_persons columns:
  lead_id, full_name, person_type, birth_year, death_year,
  gender, locations (text[]), source_url, source_page_title,
  extraction_method, scraped_at, context_text, confidence_score,
  relationships (JSONB), status, reviewed_by, reviewed_at,
  rejection_reason, confirmed_enslaved_id, confirmed_individual_id,
  duplicate_of_lead_id, created_at, updated_at, source_type,
  review_notes, data_quality_flags
  ← NO branch_name column; branch is in locations[0]
  ← NO docai_data column; enrichment in relationships.docai_fields
  ← NO canonical_person_id; use confirmed_individual_id

// Freedman's Bank Specific Notes:
// - `last_master` IS NULL is NOT a reliable indicator of "always free" until the DocAI URL bug is fixed and all records are reprocessed against the 3:1: film images.
// - ALL Freedman's Bank depositors are legally free at the time of deposit.
// - Lexington, KY records may be stored under "Louisville, KY" in FamilySearch data due to upstream labeling errors.
// - Total entries in FamilySearch data table: 480,597 (includes primary + associated records). Our `unconfirmed_persons` count of 416,136 likely represents primary account holders.

person_relationships_verified columns:
  id, person_id, related_person_id, relationship_type,
  evidence_source_ids (ARRAY), evidence_strength (INT),
  has_conflicts (BOOL), verified_by, verified_at, created_at
  ← NOT person1_id/person2_id

will_extractions columns (M048):
  id (UUID), document_id (INT), canonical_person_id (INT),
  raw_pages_jsonb (JSONB), structured_extraction_jsonb (JSONB),
  extractor_version (TEXT), status (TEXT),
  review_sections_jsonb (JSONB), created_at, updated_at
  ← NO enslaved_persons_count / document_date / document_year columns

enslaver_evidence_compendium columns (M053):
  id (UUID), canonical_person_id (INT), evidence_source_table (TEXT),
  evidence_source_id (TEXT), evidence_strength (TEXT), claim_summary (TEXT),
  methodology_id (UUID), ingested_at (TIMESTAMPTZ), ingested_by (TEXT)
  ← ingested_at/ingested_by NOT created_at/created_by

schema_migrations: uses 'filename' column (NOT migration_id / migration_name)
```

## Key Person IDs
| Person | ID | Notes |
|--------|-----|-------|
| James Hopewell (enslaver, d.1817) | cp=1070 | FamilySearch MTRV-Z72 |
| Angelica Chesley (wife) | cp=140299 | née Chesley; married name Hopewell |
| Ann Maria Biscoe (daughter) | cp=141015 | née Hopewell |
| Hugh Hopewell V (father, d.1777) | cp=193376 | FamilySearch GX1Q-ZMD; was type=descendant, updated to type=enslaver in Session 52 |
| Hugh Hopewell VI (brother, d.1785) | cp=609495 | b.1758, wife Hannah; inserted Session 52; person_documents id=184163; will_extractions id=c40ee851 |
| Henry Weaver | cp=196747 | Washington DC enslaver, d.1847 |
| Mary Ann Weaver | cp=609494 | Henry's wife, d.1883 |
| Angelica Chew | cp=141014 | DC Emancipation petition |
| Frisby Freeland Chew I | cp=193163 | Angelica's husband, enslaver |

## Deployments
- **Backend (Render):** `main` branch → `https://reparations-platform.onrender.com` (auto-deploy on push)
- **Frontend (GitHub Pages):** `gh-pages-react` branch → `https://danyelajunebrown.github.io/Reparations-is-a-real-number/`
  - Deploy: `cd frontend && npm run deploy:gh-pages` (MANUAL — does NOT auto-deploy on push to main)
- **DB (Neon):** pg.Pool directly (`DATABASE_URL`) — NOT Neon serverless HTTP. rowCount works correctly.
- **S3:** `reparations-them` bucket, `us-east-2` region (IAM: `reparations-app` user, missing s3:GetBucketLocation but non-blocking)

## OCR / Probate Pipeline Facts
- **Google Vision DOCUMENT_TEXT_DETECTION** via `pdftoppm -r 300 -png` → base64 → Vision API
- **CONSTRAINT**: Do NOT overwrite `person_documents.ocr_text` for id=19 (FamilySearch transcription is higher quality)
- **person_documents.will_extraction_id** column MISSING — `backfill-inheritance-edges-from-will-extractions.js` will fail
- **WillPipeline.js** does NOT exist — `POST /api/wills/ingest` is a stub
