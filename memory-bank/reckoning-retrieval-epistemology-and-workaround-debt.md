# RECKONING — retrieval treated as UI, not epistemology + the workaround-debt pattern

_Prompted by the user (Jun 30, 2026) after the "RAG corpus is only 2% full" explanation: "why were we
attempting a functional search system without RAG in the first place? what else are we completely ignoring
operationally or covering over with unnecessary workarounds? are we overdue for downstream-aware
refactoring?" This file is the honest audit. It is a source-of-truth reflection, not a task log._

## The core epistemic error

This is a **reparations EVIDENCE system**. Its entire value proposition is: *can we find the right person /
document and stand behind the claim with a citation?* That makes retrieval **core epistemic
infrastructure**, not a UI feature. Yet retrieval was built as `canonical_name ILIKE` keyword SQL
(`contribute.js:311`) — the zero-infra path — because the project grew **genealogy-pipeline-first** (the
climber + match-verification is the historical strength). Search got bolted on for the frontend as an
afterthought. RAG (semantic + grounded + row-cited + measured) is what retrieval should have been from the
start given the audit mandate "every claim traces to a row." We are now **retrofitting the epistemology**
(Phase 2), the same correction already made on the financial side (see [[project_calibration_first_architecture]]:
max()/sum() → ObligationReconciler; unsourced constants → cited anchors). Same lesson, second domain.

## The recurring pattern: corrective layers over root causes

The project repeatedly ships a naive version, then builds a **second corrective layer** to contain its
failures, instead of fixing the root. Each layer is individually defensible; in aggregate they are debt that
hides the real problem. Evidence, grounded:

1. **Two uncontrolled doors into identity.** The climb scrapes FamilySearch's raw collaborative tree and
   **bypasses identity resolution, the canonical/document gate, and source-tier classification**
   (activeContext Session 69: Elizabeth Parker mis-asserted as an 1860 GA slaveholder via a name-only link).
   Fix so far = *another* corrective (worksheet reads only the verified layer). Root fix = route the climb
   THROUGH `PersonService` (the in-progress consolidation — the one place we ARE doing this right).
2. **The assertion gate itself is a corrective layer.** `assertable_slaveowner/enslaved` (M102) exists
   because persons were being externally asserted without proposition-specific documents. Good guardrail —
   but it compensates for a write-time discipline that should have existed from the first ingest.
3. **Identity spine is broken and worked around.** `identity_fingerprint` needs birth_year, NULL on ~99%
   of rows → 157/559,984 fingerprinted. Tiered fingerprint "scoped, not built." Blocking keys
   (`person_blocking_keys`) are a workaround AROUND the missing real spine, not the spine.
4. **Silent-degradation footguns.** (a) `EMBED_SOURCE` env drop → the embed run **silently** fell back to
   the 429-capped Gemini (hit TWICE on Jun 30; looked like a "stall"). (b) Two PG drivers with divergent
   `rowCount` → a `RETURNING id` dance required everywhere (CLAUDE.md "DB driver trap"). Both are
   fail-quiet where they should fail-loud.
5. **Deploy / versioning has no discipline.** Today's "search shows nothing" crisis was a **stale cached
   GitHub Pages bundle** — no cache-busting, no surfaced build version, so a stale client is
   indistinguishable from a broken backend (cost an hour of misdirected diagnosis). Worse: **the Mini runs
   production scrapers from a DIRTY, UNTRACKED `main` checkout** (46 dirty files; the embed scripts existed
   only as untracked copies that COLLIDED with the branch on pull). Code reaches the Mini via ad-hoc `scp`,
   not git → the always-on box drifts from version control and is not reproducible.
6. **Data-quality quarantines instead of fixes.** CivilWarDC role inversion (958 canonical persons
   mis-tagged enslaver↔enslaved, [[project_civilwardc_role_inversion]]) — UNFIXED; workaround = "don't
   feature them." NY probate contamination (#67–70) — 135 enslaved persons left unpromoted behind a
   quarantine. Name-recall ceiling ~55% accepted as-is.
7. **Migration/feature hygiene drift.** Orphaned half-features (issue #59); `historical_reparations_petitions`
   (M011) never created; the root README describes a scope that no longer exists.

## Are we overdue for downstream-aware refactoring? — Yes, in specific, nameable places.

> **STATUS (Jul 1, 2026): A, B, C executed this session** (commits 71892b69c → bf38dd3e6).
> A — 6/7 live bypass doors routed through PersonService (climb = door 7, handed off — see
> [[note-climb-resolution-producer-jun27]]). B — frontend build-version surfacing + stale-client
> detection shipped; Mini-runs-from-git codified in [[standard-deployment-and-versioning]] (physical
> cleanup deferred — don't clobber the Mini's uncommitted work). C — embed fail-loud preflight shipped.
> REMAINING under D/E + C's broader half: enslaved_individuals migrate-vs-deprecate decision (entry #3),
> delete/guard the dormant individuals-table bombs (entry #3), fix/retire the broken PM2 worker (entry #2),
> one-PG-driver enforcement, worker/process startup-health in the ops endpoint.

Not a grand rewrite (that would be its own anti-pattern). The high-leverage consolidations, in order:

- **A. Finish `PersonService` as the ONE door** (already in progress — the correct instinct). Every writer
  — climb, scrapers, ingests — goes through resolve/findOrCreateLead/gate. Kills workaround #1 and #2's
  root. This is the single most important one.
- **B. Deploy/versioning discipline.** Cache-bust the SPA + surface the build SHA in the UI (a stale client
  must be self-evident). **Make the Mini run from git** (checked-out branch, `git pull` deploy, CI-copied),
  not scp. Kills #5.
- **C. Fail-loud config.** No silent embedding-source fallback; assert the resolved source/model at startup.
  Pick ONE embedding space and ONE PG-driver pattern and enforce them. Shrinks #4.
- **D. Pay down the identity spine (#3) BEFORE more ingest.** Every new source added on a broken spine
  multiplies the dedup/attribution debt (the enslaved-canonicalization work is already straining it).
- **E. A standing workaround/debt registry.** When a corrective layer is built, log it here with its root
  cause and a trigger for paying it down — so layers are tracked as debt, not silently normalized.

## Debt-registry entry #1 — RAG/inference built but adopted NOWHERE (grounded Jun 30)

Direct code audit (the reckoning made concrete):
- **RagService is imported by ZERO live code** — only `scripts/rag-query.cjs` (CLI). No `/api/rag` route
  is mounted (`server.js`). The capability is validated and orphaned.
- **Every user-facing read surface is keyword `ILIKE`, no inference, no retrieval grounding:**
  `/api/chat` (`chat.js` — literally the Q&A surface — `full_name/canonical_name ILIKE`), `/api/research`
  (`ResearchService.js:236` `owner_name ILIKE`), `/api/contribute/search` (`contribute.js:311`),
  `/api/names` (soundex/keyword). The place a user asks a question grounds on nothing.
- **We call LLM inference for EXTRACTION only** (`probate-llm-extractor.callLLM` — OCR→fields), never to
  ANSWER or to ground user retrieval. The entire read/query side is inference-free string matching.
- **Embeddings also aren't in entity resolution** — 2d semantic dedup is report-only scripts, not wired
  into the `/review` dedup flow.

Partly deliberate (the public route was DEFERRED today until the corpus fills — correct). But the deeper
issue is the reckoning pattern: the capability was built as a side-service with **no adoption plan** — no
step says "replace ILIKE in chat/research/search with hybrid keyword+grounded retrieval." Adoption targets,
when the corpus is full: (1) `/api/chat` grounded RAG (highest — it's the Q&A surface); (2) `/api/research`
+ `/api/contribute/search` add a semantic option alongside keyword (hybrid, not replace); (3) semantic-dedup
candidates feed the `/review` queue. **BOUNDARY (audit rule):** RAG/inference must NEVER feed DAA
computation or any aggregated number — it may assist a HUMAN reviewer, but deterministic code + citations
compute the instrument. Keep RAG on the read/exploration side of the line.

## Debt-registry entry #2 — the PM2 "worker" has been silently broken (found Jul 1)

`src/services/scraping/Orchestrator.js:16` requires `./autonomous-web-scraper`, a file that **does not
exist and was NEVER tracked in git**. So Orchestrator has never been `require()`-able, and the PM2 `worker`
(`scripts/scrapers/continuous-scraper.js` requires it at :11, instantiates at :18) crashes on startup —
undetected. This reclassifies the "live worker bypass writer" (door A2) as effectively DEAD. Root cause is
the same fail-quiet pattern: no startup assertion, no health signal, so a crashing worker is invisible.
Fixes: (a) fail-loud startup + worker health in the ops endpoint (part of C); (b) decide whether the worker
is wanted — if yes, restore/rewrite `autonomous-web-scraper`; if no, delete Orchestrator + continuous-scraper
so the dead path can't mislead future audits. (A2's routing edit is committed regardless — future-proof.)

## Debt-registry entry #3 — `enslaved_individuals` legacy silo + real `individuals` bombs (Jul 1)

Found while routing door A6 (`contribute.js` review-queue approve):
- **`enslaved_individuals` (18,272 rows) is a legacy standalone table**, NOT in PersonService's unified
  pool (SUBJECT_TABLES = canonical/unconfirmed/PAST/Hall). Approvals write it directly. A6 now ALSO
  registers the person via `findOrCreateLead` (additive de-silo) so they're discoverable — but the real
  question is a DESIGN DECISION (user): migrate `enslaved_individuals` into the unified model (canonical/
  lead) and make it a read-view, or formally deprecate the approve→enslaved_individuals path. Half-state
  (dual-write) is transitional, not the destination.
- **`enslaved_by_individual_id` (varchar, NO FK) references the dropped `individuals` table** — writing
  `context.owner_id` there is harmless-but-stale dead data (won't throw). Left as-is (understand-before-
  delete); should be re-pointed to a canonical owner ref or dropped in the migration.
- **The genuine `individuals` latent BOMBS are the DORMANT writers** that INSERT the dropped table itself:
  `Orchestrator.addToConfirmedDB` (:423), `EntityManager` (:110/:171/:309), `LLMAssistant` (:777),
  `scripts/promote-primary-sources.js` (:201). They have no live callers now, but will THROW the instant
  one is wired. Action: delete or guard this dead code (ties to the A2 Orchestrator dead-worker finding).
- **Latent no-op bug (noted, not fixed):** `contribute.js` `review-queue/approve-all` filters
  `queue_status='pending_review'` but pending rows use `'pending'` → matches zero.

## The meta-rule to adopt

**When you catch yourself building a corrective/workaround layer, stop and log it as debt with its root
cause.** Periodically pay down before piling on. Retrieval-as-UI and the financial max()/sum() were both
this mistake caught late; the gate, blocking keys, quarantines, and scp-deploys are the same mistake still
live. The audit mandate demands the foundation be sound, not merely contained. See
[[project_direction_identity_over_payment]] (continuity-of-holding needs a sound identity spine) and
[[project_calibration_first_architecture]] (the epistemology correction already done once).
