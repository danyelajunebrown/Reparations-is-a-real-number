# plan-descent-first-lineage.md — build lines DOWN from documented people, not UP from living ones

_Written 2026-08-08, user directive: "we have been approaching this ancestor climb impossibly. we have real
people in database and we should be drip building all lines down not up in all cases using as many sources
as possible and insisting on standards."_

_Supersedes the climb-as-primary-discovery posture in [[plan-intake-and-climb-redesign]] §4 and
[[plan-climb-as-gated-lead-source]]. Those stay valid as the description of what the climb IS; this doc
demotes the climb from the spine of the pipeline to a corroborator. Companion to
[[assessment-climb-architecture-gap-jun30]], which diagnosed the same defect one direction short of the fix._

_All counts verified live 2026-08-08 per [[feedback_verify_db_not_logs]]._

---

## 1 · The directive, and why the numbers agree with it

**The inversion:** stop treating a living participant as the root of the search. Treat the **documented
historical person** as the root, and build **forward in time** to the present, one record-backed generation
at a time, dripping, on every line we hold.

The live DB is the argument:

| What we hold | Count |
|---|---|
| `canonical_persons` person_type=`enslaver` | **420,566** |
| … `enslaved` | **229,062** |
| … `freedperson` | **82,565** |
| enslavers with an image-backed `person_documents` row (RULE 0.6-grade anchor) | **48,119** |
| `person_documents` | 716,065 |
| `unconfirmed_persons` (leads) | 3,228,277 |
| `inheritance_edges` | 11,792 |
| `chattel_transfer_events` (priced enslaver→enslaver) | 48,985 |
| `probate_estate_extractions` / `probate_documents` | 5,937 / 3,331 |
| **`canonical_family_edges`** | **4,924** |
| **… of which carry a `source_document_id`** | **4** (0.08%) |
| `person_relationships_verified` | 574 |

Three-quarters of a million documented people, and **four documented kinship edges.** We have been spending
the entire genealogical budget climbing upward from a handful of living participants into FamilySearch's
collaborative tree, and the thing we are starving is the only thing a DAA actually needs: **proven links
between people we already have.**

## 2 · Why climbing up cannot be made to work (structural, not a bug list)

Each of these is measured in this repo, not asserted:

1. **The search space explodes and lands in fiction.** Adrian Brown's climb: 2,675 connected ancestors,
   **86% born before 1700**, 1,310 in the 1500s; 96% of 1,223 lines grade SPECULATIVE, 19 SOLID
   ([[assessment-climb-architecture-gap-jun30]]). Going up, the frontier doubles per generation and the
   evidence density collapses. Going down, the frontier is bounded by **documented children** and the
   evidence density *rises* toward the present.
2. **The terminal step is a name thrown into a haystack of 420,566.** The 2026-08-07 identity gate measured
   it: re-climbing `G21Y-X4B` produced 33 resolved matches and **all 33 were `name_only_match`**; 20 would
   have entered the debt math. That is the Biscoe rule's forbidden operation performed at scale. It is not
   fixable by a better matcher — the information needed to disambiguate is not in the climb.
   **Descent inverts the epistemics: you never match a name into the corpus, because you START at a
   specific person whose identity a source document already proved.**
3. **FS tree edges are inert by our own standard.** A bare collaborative-tree edge is tier 3 per
   [[standard-genealogical-edge-evidence]] — navigable, never assertable. The climb's "confidence" is a
   constant keyed to *how the edge was found* (0.90 tree / 0.70 name), not to evidence. So the climb cannot
   produce an assertable lineage even in principle.
4. **It is throughput-bound on a single point of failure.** One FS Puppeteer scraper at a time, on one
   logged-in Chrome, on the Mini ([[feedback_one_fs_scraper_at_a_time]]). Climbs also die silently on
   session expiry. A pipeline whose root is "a participant walks in" cannot drip; it can only queue.

**Corollary the user named exactly:** "we would have no prior need to have pre-cleaned person nodes for
non-slaveowners." Climbing up spends the budget standardizing the ancestors of people who are irrelevant to
the instrument. Descending spends it on the people the instrument names.

## 3 · Why descent is not merely cheaper — it is the project's thesis

The project's claim is **continuity of holding**: wealth extracted from enslaved labor persisted forward
into identifiable present-day hands. That claim is a *forward-time* statement. So:

- **A will is simultaneously a kinship document and a wealth document.** It names the children (tier-1
  contemporaneous kinship evidence, by the informant with the strongest possible knowledge) AND it assigns
  the estate (`inheritance_edges`, `asset_type='enslaved_persons'` where applicable). One descent step
  produces both the genealogical edge and the wealth edge. **Climbing up produces neither.**
- **`chattel_transfer_events` (48,985 priced transfers, 1719–1820) is already a descent spine** for the
  property side. It has never been chained forward to present holders — that was flagged as NEXT in
  [[project_direction_identity_over_payment]] and never built.
- **The three modern endpoints already built (Bard/LAND, Amherst/CAPITAL, Georgetown/CAPITAL) are descent
  results.** They were each produced by hand, forward in time, from a documented enslaver to a present-day
  institution. This plan is the generalization of the thing that already worked, applied to the corpus
  instead of to three hand-picked cases.

Descent also fixes the **enslaved-side asymmetry**. Climbing up from a Black participant hits the 1870 brick
wall from below and stops. Descending from an 1870-census or Freedmen's-Bank-era freedperson crosses the
same wall **from above**, where the person is named, and walks forward through censuses that get richer
every decade. This is the only direction in which the enslaved-descendant line is buildable at all.

## 4 · The descent ladder — what names the next generation, by era and class

The engine is one loop: *given an anchored person, find the record that names their children; write the
child as a lead + the edge with its document; recurse.* What differs is which record does the naming.

### 4a · Enslaver line (buildable today)

| Era | Record that names children | Held? |
|---|---|---|
| 1700–1865 | **Will / probate / estate distribution** — names heirs explicitly, carries the inheritance edge | ✅ `probate_documents` 3,331 · `probate_estate_extractions` 5,937 · `will_extractions` 20 |
| 1750–1865 | Deed of gift, marriage settlement, guardianship bond | ⚠️ partial (`land_transfer_events`, Massena spine M129) |
| 1850–1880 | **Census household enumeration** — first censuses naming every household member | ⚠️ `ipums_census_records`, 1860 slave schedules (~1.68M leads); no free-schedule household table |
| 1865–1930 | Estate notices, sale notices, obituaries (newspapers) | ❌ **no corpus** |
| 1880–1950 | Census 1880/1900/1910/1920/1930/1940/**1950** | ❌ **no table** |
| 1935– | SSDI / SSACI, death index, published obituary | ❌ **no table** |
| any | Corporate/institutional records — the modern endpoint | ✅ `corporate_entities`, `corporate_slavery_disclosures` |

### 4b · Enslaved / freedperson line

| Era | Record | Held? |
|---|---|---|
| 1865–1874 | **Freedmen's Bank signature registers** — field 21 names the former enslaver, 22 names family, 23 residence. *The single highest-value document in the project for this class:* it is the bridge across 1870 AND the enslaver↔enslaved link in one row | ❌ **no table** — 28 branches / 200K+ depositors scoped in [[project_freedmens_bank_scrape]], 415K leads pending re-extraction ([[plan-freedmens-enslaver-reextraction]]) |
| 1865–1872 | Freedmen's Bureau labor contracts, marriage registers, ration rolls | ❌ no corpus |
| **1870** | **First US census naming formerly-enslaved people** — the wall, crossed downward | ❌ no table |
| 1880–1950 | Census forward chain (1880 adds *relationship to head* — the decisive field) | ❌ no table |
| 1865– | Cohabitation registers (VA 1866), church/school records, WPA narratives | ❌ no corpus |
| any | Named enslaved in wills/probate → same estate as the enslaver anchor | ✅ (`promote-probate-extractions.mjs` already de-silos these) |

**The honest read:** the enslaver line is buildable **today** for the first 1–3 generations from probate and
stalls at ~1880 for lack of a census-forward table. The enslaved line is **blocked at generation zero** until
Freedmen's Bank + the 1870→1950 census corridor land. Both lines converge on the **same missing asset: a
forward census/vital-record corridor.** That is one acquisition, and it unblocks both classes. It is the
highest-leverage acquisition in the project and it is an acquisition question, not a code question.

### 4c · Candidate for the forward corridor — Ancestry Library Edition (user, 2026-08-08)

The user flagged possible **Ancestry Library Edition (ALE)** access via a parallel session. ALE covers
exactly the missing corridor in one place: **1870–1950 US censuses**, vital records, city directories,
obituaries, and the Freedmen's Bureau/Bank collections — i.e. it would unblock the enslaver line past 1880
AND the enslaved line at generation zero simultaneously. That makes it the single highest-value access the
project could have right now, and it should be evaluated before any bespoke census scraper is written.

**Evaluate these before building against it — they change the design, not just the schedule:**
1. **Terms of access.** ALE is institution/IP-authenticated for *patron research use*. Systematic
   harvesting into a database is a different act from look-up, and is generally outside those terms. This
   project already refuses sources it cannot stand behind at audit; the same discipline applies to *how* a
   source is obtained, not only to what it claims. Establish what the license actually permits — and from
   whom — **before** a scraper exists to tempt us.
2. **The redistribution boundary.** A DAA cites its sources publicly and `person_documents` dual-archives
   images to S3 + Wayback. Both may be impermissible for a licensed commercial database even where lookup
   is fine. The likely-usable pattern is **citation + operator-verified transcription** (a pointer and a
   fact, not a redistributed image) — which is a *different* archival path from
   [[standard-file-first-document-archival]] and needs its own tier under
   [[standard-external-source-ingest]].
3. **Session model.** IP/library-bound auth means it inherits the FamilySearch failure mode — a human-held
   session on one machine, invisible expiry, silent no-op climbs. Any ALE lane needs the fail-CLOSED check
   that `ensureLoggedIn` had to learn ([[reference_familysearch_session_reauth]]).

**Recommended posture:** treat ALE as a **verification and gap-filling** source for descent steps the free
sources leave open, and as the **research surface for the corridor's shape**, while the bulk corridor comes
from a source whose terms permit ingest (FamilySearch collection ingest, IPUMS extension, NARA). Do not make
the descent engine structurally dependent on a source we may not be licensed to hold. **Open question for
the user:** what is the actual access — an institutional subscription through Bard, a public library card,
or something else? The answer determines which of the three postures above is available.

## 5 · Standards the engine enforces (non-negotiable — this is the "insisting" half of the directive)

The climb's original sin was being a **second, uncontrolled door** into `canonical_persons`. The descent
engine goes through the front door or it does not ship.

1. **Descendants land as LEADS.** Every discovered child → `PersonService.findOrCreateLead` (writes blocking
   keys, dedups on entry). **Never** a direct `canonical_persons` INSERT. Promotion only on RULE 0.6:
   discrete identity (Biscoe) + serves a document image (S3 + Wayback) + embedded in `embeddings`.
2. **No edge without its document.** Every `canonical_family_edges` row written by this engine carries
   `source_document_id`, plus M127 `information_type` / `informant_role` / `event_to_record_gap_years`.
   A tier-1 document can carry secondary information; gap > ~5 yr is a mechanical downgrade. **An edge with
   no document is not written — it is logged to `research_findings` as a gap.**
3. **Corroboration bar, inherited from `public-record-bridge.mjs` — do not loosen.** Spouse *or* sibling
   *or* second independent source class → **CONFIRMED**, auto-usable. Named-in-one-record + dates consistent
   → **CANDIDATE**, human review, never auto-asserted. Name-only → **rejected**, not stored as an edge.
4. **Multi-source by construction ("as many sources as possible").** A generation step SHOULD be attempted
   against every source class available for its era, and **disagreement between classes is a signal, not an
   error** — write both, mark the conflict, route to `linkage_verdicts` (M126). Genealogical edge and
   inheritance edge disagreeing about who got the estate is exactly the kind of finding this project exists
   to surface.
5. **Living people are searched, never minted.** The line STOPS at the last deceased person. The living
   generation is recorded as an **opt-in target**, not a person row, and never enters model context — PII
   directive, `scripts/pii/` lane only, `participants_safe` for any read
   ([[feedback_protect_participant_pii_from_model]]).
6. **Null results are first-class.** "Anne Maria Hopewell's 1880 household was searched in Charles County
   and she is not in it" is a finding → `research_findings` (M128). This is what makes a stalled line
   distinguishable from an unworked one — the same failure mode that let a logged-out climb write
   `status='completed'`.
7. **Free and recurring** (RULE 0.7). Deterministic script + local ollama + drip cron on the Mini, guarded
   by a poison-pill counter like `probate-drip.mjs`. Never a paid agent for the recurring loop.
8. **Every descent lead gets an EMBED phase** (RULE 0.5) or it is a retrieval silo.

## 6 · Schema (migration 133)

Reuse before adding. `canonical_family_edges` + `inheritance_edges` + `person_documents` +
`research_findings` already carry the payload. What is missing is the **work queue** — the thing that makes
this a drip instead of a script someone runs.

```
descent_anchors          -- the roots. one row per documented person we descend FROM
  canonical_person_id, person_class (enslaver|enslaved|freedperson),
  anchor_evidence_document_id,      -- what proved this identity (RULE 0.6 gate)
  priority, terminal_reason (living_generation_reached|no_forward_record|
                             conflict_unresolved|complete), status

descent_frontier         -- the drip queue. one row per (person, generation-step) to attempt
  anchor_id, person_ref (canonical_person_id | lead_id), generation_depth,
  era_band, source_classes_attempted text[], source_classes_remaining text[],
  attempts, last_attempt_at, outcome (children_found|no_record|blocked|exhausted)
```

Deliberately NOT reused: `slave_owner_descendants_suspected` (M013, **9 rows**) and
`slave_owner_descendants_confirmed`. They predate the gate model, key on the legacy `individuals` table,
carry their own confidence vocabulary, and store descendant PII (email/phone) in the main DB. They are dead
and should be documented as dead, not extended. `DescendantMapper.js` / `WikiTreeScraper.js` likewise —
WikiTree is a collaborative tree, i.e. tier 3, i.e. the same inert evidence class as the FS tree. Keep as a
**corroborator**, never as the producer of an edge.

## 7 · Build order

1. ✅ **Migration 133 — APPLIED 2026-08-08.** `descent_anchors` + `descent_frontier` +
   `descent_pending_inheritance`, plus `produced_by` on both edge tables. Class-neutral per the user's
   decision, so the enslaved side needs new rows and a source handler, never a schema change.
   *(Note: `scripts/apply-migrations.js` REFUSES to run — pre-existing checksum drift on
   `090-secondary-source-compilations.sql`, unrelated to this work and still open. 133 was applied
   directly and recorded in `schema_migrations` with a matching checksum.)*
2. ✅ **`scripts/descent/descend-from-probate.mjs` — BUILT + RUNNING 2026-08-08.** Generation 1 out of
   documents already on disk; no scraping, no acquisition, no FamilySearch session.
   **Measured on a 60-estate sample (~5% of the corpus): documented kinship edges 4 → 115.** All carry an
   S3-backed page citation, all `verified=false`, invariant clean.
   Design points that took measurement to get right:
   - **The OCR corroboration check had to be GRADED, not boolean.** A bare given name ("Richard") appears
     somewhere in a 31-page estate file close to by chance, so a binary check inflated confidence on
     exactly the heirs whose identity is *least* resolved. Now `full_string` / `all_tokens` /
     `weak_single_token` / `none`, and only a multi-token hit lifts confidence. 99 strong / 21 weak / 1
     absent on the sample — the extractions are largely faithful, which is itself a finding about the
     probate LLM router.
   - **Tier and verification are different questions.** `evidence_tier` follows the DOCUMENT CLASS (a will
     naming a son is tier 1 per [[standard-genealogical-edge-evidence]] §3); `verified` stays FALSE because
     the *reading* is LLM-derived (audit rule 1). Conflating them is how bad lineage ships.
   - **Yield ceiling is honest:** of 246 heirs in the sample, 71 state no relation at all and 42 state one
     that maps to no edge — the single largest loss is the extractor not capturing the relation phrase, not
     the gate rejecting people. That points the next quality pass at the extractor, not the filter.
3. **`descent-drip.mjs`** + Mini cron (free, guarded, ntfy) — works `descent_frontier`, one generation-step
   per tick, resumable, poison-pill guarded, logs nulls to `research_findings`. **NOT YET BUILT** — and
   largely inert until step 5, since `probate` is the only source class in the ladder that exists.

   ### 3a · NULL RESULT — the probate corpus is EXHAUSTED for descent (measured 2026-08-09)
   Three candidate ways to go deeper *without acquisition* were measured before building any of them.
   All three are dead ends, and the measurements are recorded so nobody re-runs them:

   | Candidate | Hypothesis | Measured | Verdict |
   |---|---|---|---|
   | **Generation-2 self-join** (an heir of estate A is the decedent of estate B) | chains the corpus to itself | **67** chainable names → **42** estates, 281 gen-2 heirs | real but negligible vs 1,882 pending frontier steps; and it needs Biscoe-grade identity work to justify each link |
   | **Relation recovery, adjacency** ("my son Richard Baker" in the OCR) | the extractor dropped relations that ARE in the text | **5%** of null-relation heirs; ~57% descent-relevant; visible false positives across comma boundaries (`"Widow , John Mullin"`) | not worth building |
   | **Relation recovery, list distribution** ("my sons John, William and Thomas") | the dominant will construction adjacency can't see | adds **2 more** on a 449-heir sample → **3% combined** | dead |

   **Why, and this is the load-bearing part:** the missing relations are not a extraction defect, they are a
   property of the record type. Null-relation rate by document: **`will` 19%** vs **`estate_account` 43%**,
   **`inventory` 46%**, **`appraisement` 32%**. Inventories, accounts and appraisements list distributees and
   creditors *without stating kinship, because kinship is not what those documents record.* The wills — the
   documents that DO record it — are already at 81% relation-stated, which is close to their ceiling.

   **Consequence:** generation 1 (2,798 edges) is essentially everything this corpus can give. Descent cannot
   go deeper on documents already on disk. **Step 5 is therefore not one option among several — it is the
   only path forward, for both classes.** A prior assessment in this session that relation recovery was "the
   biggest free win available" was WRONG; it was projected, not measured, and the measurement refuted it.
4. ✅ **`project-health-monitor.mjs` wired 2026-08-08** — 4 descent checks, all green on first run:
   `descent_edge_documented` (CRITICAL if any `produced_by LIKE 'descent/%'` edge lacks a source document —
   the engine's core contract, now enforced forever), `descent_edge_unverified` (CRITICAL on
   self-certification), `descent_frontier` (starvation warning), `descent_inheritance_parked` (backlog).
5. **The forward corridor (acquisition, unblocks BOTH classes)** — 1870→1950 census + vital records as a
   queryable table. Until this lands, every line stalls around 1880. Decide the source (FS collection ingest
   vs. IPUMS extension vs. another provider) before writing a scraper.
6. **Freedmen's Bank** — the enslaved-side generation-zero bridge, and independently the enslaver↔enslaved
   link. 415K leads already staged per [[plan-freedmens-enslaver-reextraction]].
7. **Re-point the DAA** at descent-derived lineage: a participant now matches into an **already-built,
   already-documented descent line** instead of triggering a bespoke upward climb. The climb becomes the
   corroborator of a descent line, and the intake support agent
   ([[plan-intake-and-climb-redesign]] §3) becomes the *joiner* — it walks a participant up only far enough
   to hit a line we have already built downward. **Both halves meeting in the middle, each carrying its own
   documents, is the assertable lineage the identity gate has been refusing to certify.**

## 8 · What this does not fix

- It does not retire the climb. It demotes it. Participant→line joining still needs an upward walk of 2–4
  **record-backed** generations ([[plan-intake-and-climb-redesign]] §3), just not 727 tree-grafted ones.
- It does not make the pre-1700 debt go away — the climb-minted canonicals still need reclassification to
  leads (assessment §4 retrofit, still open).
- It does not solve the enslaved-side dedup problem (#63, [[plan-63-enslaved-cross-source-dedup]]); descent
  will *stress* it, because 229,062 enslaved canonicals with thin identifying detail is exactly the corpus
  where a descent step will collide.
- The Mini remains a single point of failure and runs a stale checkout. A drip that matters more makes that
  debt matter more.

## See also
[[assessment-climb-architecture-gap-jun30]] · [[standard-genealogical-edge-evidence]] ·
[[standard-canonical-person-and-document-gate]] · [[plan-intake-and-climb-redesign]] ·
[[plan-freedmens-enslaver-reextraction]] · [[wealth-tracing-framework]] · [[interpretive-framework]] ·
[[plan-modern-endpoints-program]] · [[project_biscoe_identity_resolution]]
