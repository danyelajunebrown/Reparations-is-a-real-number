# Active Context — Reparations Platform

_Last updated: 2026-08-21 (FABRICATION PURGE → EVIDENCE-BACKLOG SPLIT → SILENT-FAILURE SWEEP. Prior top
entries: 2026-08-08 DESCENT-FIRST DIRECTIVE — the climb demoted from spine to corroborator, lines built DOWN
from documented people; 2026-08-07 modern-endpoints + free automation + DAA identity gate; 2026-08-03
intake/PII; 2026-07-31 evidence-quality.)_

---

## 2026-08-19→21 · FABRICATION PURGE, THE BACKLOG SPLIT, AND FOUR SILENT FAILURES
→ [[finding-fabrication-classes-aug19-20]] · [[standard-assertion-store-and-inference-decisions]] ·
[[finding-marronnage-corpus-aug20]] · [[standard-targeted-harvesting]] · [[standard-project-monitoring-and-free-agents]]

**READ THIS FIRST, IT IS THE THEME:** every serious defect in these three days was a **failure that looked
like a completion**. Not a crash — a green light over an empty room. Enumerated, because the shape recurs:

| what it claimed | what was true |
|---|---|
| 1,456,640 person rows from slave schedules | one row per TALLY MARK — invented people |
| 7,053 probate decedents typed `enslaver` | provenance mistaken for evidence |
| 1860 scrape "0 locations to process" for months | 977 CONTAINER nodes (waypoint_id NULL) counted as work; only 60 real leaves left |
| 1860 OCR "extracted 301 characters" ×18 | it was transcribing the FamilySearch **login form** |
| `sample-dlas-petitions` → 0 petitions, saved as a finding | `s` is a REQUIRED param; a malformed query and an empty archive both return HTTP 200 |
| `audit-source-inference` → "NOT EMBEDDABLE YET" ×5 tables | all five 99–100% embedded; the monitor held a stale hardcoded map |
| 9,601 canonicals promoted, RULE 0.5 "fine" | `promoteToCanonical` writes neither `confirmed_individual_id` back nor the external id across — orphaned from BOTH directions |

**Rule earned:** *a status written without its link is not a status.* And: **assert the query worked before
recording what it found** — `.catch(()=>{})`, a caught 403, and an empty result set are indistinguishable
from an answer unless something insists otherwise.

### THE MEASUREMENT THAT SHOULD DRIVE THE NEXT SESSION → `audit-evidence-backlog-split.mjs`
The "unevidenced" backlog is **60.2% our own bookkeeping, not archive absence**:

|  | total | evidenced | doc known, no S3 | no doc anywhere | evidenced but GATE NOT LIFTED |
|---|---|---|---|---|---|
| freedperson | 82,565 | 0 | **78,212 (94.7%)** | 4,353 (5.3%) | 0 |
| enslaver | 413,513 | 41,066 | **293,078 (70.9%)** | 79,305 (19.2%) | 6,520 |
| enslaved | 233,602 | 72,957 | 1 | **160,644 (68.8%)** | 0 |
| unknown | 23,211 | 10,783 | 2 | 12,426 | **10,776 (46.4%)** |

**OUR debt 388,653 · REAL archive gap 256,728.** The freedperson "0% evidenced" headline is almost entirely
*unarchived*: 78,212 carry a `familysearch_record` row **with a source ARK**, `s3_key` simply NULL. Only
`enslaved` is a genuine archive gap — and that is precisely what the new sources are for. **Only bucket D
belongs in a sentence beginning "we do not have records for…".**

### DONE
* **Fabrication purged:** 1,455,019 + 1,621 tally-mark rows quarantined `placeholder_aggregate`;
  `extract-census-ocr.js` now quarantines at creation so the source stops fabricating. 7,053 unevidenced
  probate `enslaver` → `unknown` (279 evidence-backed kept).
* **RULE 0.5 closed:** `canonical_profile` **766,245 / 766,245 = 100%** via a new `canonicals` facet that
  embeds profiles DIRECTLY instead of depending on a lead traversal that often does not exist (also the real
  fix for #151). Verbs all 99–100%: voyages 64,853 · ownership 32,625 · inheritance 11,792 · insurance 675 ·
  wealth 128. `person_fact` in progress (~294K/497,851, on cron).
* **Search visibility:** 748,351 → 760,913 searchable — `descendant` was blanket-excluded, hiding 12,562
  historical ancestors. Replaced with a living-status gate (110y); 0 PII leaked.
* **4,540 named enslaved promoted** off slave schedules (deterministic `sched:<doc_id>:<name>` ids). NB the
  promoter's id+image join is DISJOINT for the enslaved (248,958 ids/no image · 105,230 image/no id · **0
  both**) — relaxing that gate would have minted ~100k fabricated people. It was a guardrail, not a bug.
* **1860 UNBLOCKED after months.** Three stacked defects: Vision key suspended (#126) → 403 caught and
  returned `''` → read as "may be title page" → `scraped_at` written UNCONDITIONALLY. Underneath all of it,
  the script called `puppeteer.launch()` on its own never-signed-in profile while the authenticated session
  sat in `:9222`. Now: connects to `:9222` by DEFAULT and **refuses** to launch unauthenticated; OCR via
  `vision-router` (Qwen-VL→Gemini, built for this in #142) with auth/quota THROWING; `scraped_at` only on
  actual yield; OCR head printed. **Also: `browser.close()` on a BORROWED browser killed the shared FS
  session for the whole Mini — now `releaseBrowser()` disconnects when borrowed.**
* **Six free agents cronned** (RULE 0.7): facts/canonical embeds (pgrep-guarded), `populate-blocking-keys` +
  `resolve-canonical-dedup --apply` (writes to `dedup_candidate_pairs`, a REVIEW queue — Biscoe gold
  passes: b1799-vs-b1844 excluded, Ann Biscoe/Ann Briscoe separated at name JW 0.98), by-source audit,
  archival compliance, 1860 tail. 22 entries. **7,833 dedup pairs queued.**
* **`check-archival-compliance.mjs`** — rules 8 / audit-5 / 0.5 / 0.6 now self-report with non-zero exit.
  Found the 23-artifact Wayback leak (20 of them Jefferson Farm Book, i.e. standing, not new).

### SOURCES MEASURED, NO PEOPLE WRITTEN (O-of-O §5 respected)
* **Marronnage** — 22,485 self-liberation ads 1765–1833, 7 colonies (Saint-Domingue 17,308). Exact counts
  from the source's own index: **`étampé`/BRANDED 9,915 (44%)**, `nation`/African ethnonym 2,975,
  `récompense` 4,367, `geôle` 721, `cicatrice` 778. Curated `noms` index verified usable (12/12, francophone
  AND anglophone) → deterministic named-person ingest, not regex-over-free-text. 67% carry scans under
  `/documents/` (robots disallows only `/images/`). **My stratified sample said branded=1%; equalising cells
  under-weighted Saint-Domingue 77%→22%. RULE: when the source exposes exact counts, COUNT.**
* **DLAS** — the CSV export `/petitions/tocsv/` returns the index in ~16 requests, not 17,487 page fetches.
  15,684 petitions · 29,934 enslaved · 129,351 enslavers. `enslavedCount` is the targeting key: **2,922
  petitions (19%) queued in `source_ingest_queue`** carrying 29,786 named enslaved (SC 718/13,429 leads).
  Coverage caveat recorded: keyword-`slave` reaches ~90% and biases AWAY from FPOC (385 vs ~8,000) — full
  coverage needs a UNION over terms deduped on `petitonIdentifier`.

### STILL OPEN / NEXT
1. **Re-run the gate** on ~17,296 already-evidenced-but-ungated people (`recompute-assertion-gates.mjs`) —
   cheapest possible win; they are provable *today* and simply are not being asserted.
2. **Archive the 371,290 known-but-unarchived ARKs** (rule 8 at scale). All FamilySearch, so it runs through
   the authenticated `:9222` Chrome at FS-safe pace — a long crawl, not a quick backfill. Queue AFTER 1860.
3. **Harvest for the 256,728 genuine gaps** — but see the 08-08 entry: the real blocker is the
   **1870→1950 forward corridor**, which neither DLAS nor Marronnage crosses. Do not let new-source
   enthusiasm substitute for the acquisition that unblocks both classes.
4. 1860 tail: 60 true leaves → then **1850**. Named-person ingest design for DLAS + Marronnage.
5. Fix `promoteToCanonical` to write `confirmed_individual_id` AND copy the external id (root cause of the
   9,601 orphans and of 68,320 leads with `status='promoted'` + null pointer).
6. `retrieval-health-audit` cannot call `s3:GetBucketLocation` (IAM); falls back to a redirect probe.

**PROCESS NOTE, recorded because it cost the day:** this session ran without reading `activeContext.md`
first — a direct RULE 0 violation. Consequences: `freedperson = 82,565` was re-"discovered" though recorded
08-08; "the RULE 0.7 monitors have not been running" was re-diagnosed though recorded 08-09; and the harvest
plan was re-derived from scratch *worse* than the existing one, because the memory bank already names the
1870→1950 corridor as THE blocker. **The memory bank is not a place to write to. It is the place to read
from, before deciding anything.**

---

## DESCENT-FIRST LINEAGE — build DOWN from documented people, not UP from living ones (2026-08-08)
→ [[plan-descent-first-lineage]] · [[assessment-climb-architecture-gap-jun30]] · [[standard-genealogical-edge-evidence]]

**User directive:** *"we have been approaching this ancestor climb impossibly. we have real people in
database and we should be drip building all lines down not up in all cases using as many sources as possible
and insisting on standards."* Accepted as the governing architecture. Full plan in
[[plan-descent-first-lineage]]; the short version:

**The measurement that settles it (live 2026-08-08):** 420,566 enslaver + 229,062 enslaved + 82,565
freedperson canonicals, 48,119 of the enslavers image-backed (RULE 0.6-grade anchors), 716,065
`person_documents`, 11,792 `inheritance_edges`, 48,985 `chattel_transfer_events` — and
**`canonical_family_edges` = 4,924 rows of which 4 carry a `source_document_id` (0.08%).** Three-quarters of
a million documented people and four documented kinship edges. The genealogical budget has been going
upward into the FS collaborative tree and starving the only thing a DAA needs.

**Why up cannot be repaired:** frontier doubles per generation while evidence density collapses (86% of one
climb's 2,675 ancestors born pre-1700, 96% of lines SPECULATIVE); the terminal step throws a NAME into a
haystack of 420,566 (all 33 matches on the 2026-08-07 re-climb were `name_only_match` — the Biscoe-forbidden
operation at scale); FS tree edges are tier-3 inert by our own standard; and it is throughput-bound on one
logged-in Chrome. **Descent inverts the epistemics — you never match a name into the corpus, you START at a
person a source document already identified.**

**Why down is also the thesis:** a will names the children AND assigns the estate — one descent step yields
the tier-1 kinship edge *and* the `inheritance_edges` row. Continuity-of-holding is a forward-time claim.
The 3 modern endpoints already built (Bard/Amherst/Georgetown) are hand-run descents; this generalizes them
to the corpus. It is also the only direction that crosses the 1870 wall for the enslaved line — from above,
where the person is named.

**Standards it must not bend:** descendants land as LEADS via `PersonService.findOrCreateLead` (never a
direct canonical INSERT — the climb's original sin was a second uncontrolled door); no edge is written
without its `source_document_id` + M127 information_type/informant_role/gap-years; spouse-or-sibling-or-
second-source = CONFIRMED, single-record = CANDIDATE (human review), name-only = REJECTED not stored;
source-class disagreement is a signal → `linkage_verdicts` (M126); nulls → `research_findings` (M128);
living people searched NEVER minted (PII lane only); free/deterministic drip cron per RULE 0.7; embed per
RULE 0.5.

**BUILD ORDER — step 2 needs no scraping and no acquisition.** (1) Migration **133** `descent_anchors` +
`descent_frontier`, seeded from the 48,119 image-backed enslavers. (2) **`descend-from-probate.mjs`** —
generation-1 heirs out of `probate_estate_extractions` (5,937) / `will_extractions` (20) into documented
edges + inheritance edges, **from data already on disk**; fastest path from 4 documented edges to thousands,
and it validates the loop before anything is acquired. (3) `descent-drip.mjs` + guarded Mini cron.
(4) monitor wiring. (5) **THE BLOCKER: a 1870→1950 census/vital forward corridor** — no such table exists,
so every line stalls ~1880; one acquisition unblocks BOTH classes. (6) Freedmen's Bank (enslaved-side
generation zero; field 21 names the former enslaver — 415K leads staged). (7) Re-point the DAA: a
participant JOINS an already-built documented descent line; the climb + intake support agent walk up only
far enough to meet it. Both halves meeting in the middle, each carrying documents, is the assertable
lineage the identity gate keeps refusing.

**DEAD, do not extend:** `slave_owner_descendants_suspected`/`_confirmed` (M013, **9 rows**, keys the legacy
`individuals` table, stores descendant email/phone in the main DB), `DescendantMapper.js` + `WikiTreeScraper.js`
(WikiTree is a collaborative tree = tier 3 = same inert class as the FS tree; keep as corroborator only).

**FULL RUN + RAG CORRECTION (2026-08-09)** → [[finding-retrievability-metric-and-doc-tails-aug09]]
Full corpus run: **634 estates → 1,308 documented kinship edges** (877 parent_of / 242 spouse / 189
sibling_of), 274 anchors, 877 pending frontier steps, 440 parked bequests, 392 null findings.
**`canonical_family_edges` documented: 4 → 1,312.** Invariants clean (0 undocumented, 0 self-verified).
**The producer shipped with NO EMBED PHASE — a RULE 0.5 violation, caught by the user, not by the monitor.**
Fixed by running `embed-leads.mjs --id-system probate_heir` (1,308/1,308), by printing the step on every
applying run, and by enforcing it (`descent_leads_embedded` CRITICAL). **The `retrievability` 0% CRITICAL
was a BROKEN METRIC, not an outage** — exact-document recall is unanswerable on 108K near-identical probate
pages (verified with the ANN index bypassed: still misses top-10, 4/4). Replaced with entity-relevance →
**75%, green**. Real silo found underneath: **21,176 long docs embedded HEAD-ONLY** (`doc_tail_unindexed`);
remedy is `embed-doc-chunks.mjs`, free, and belongs in the Mini nightly sweep.
**MINT GATE FIXED (2026-08-09)** → [[finding-name-validator-false-rejects-aug09]]
640 estates had no decedent on the spine because **`isValidPersonName` was silently rejecting REAL people**.
Five defects, each looking like prudence: (1) initials read as function words — the `NON_NAME_TOKENS` lookup
ran BEFORE the middle-initial branch, so `A.`→article `a` and `I.`→pronoun `i`, killing `A. S. Bacon`,
`D. I. Dawson`; (2) **`y` was not a vowel** — `Byrd`, `Smyth`, `Flynn`, `Lynch`, `Van Dyck`; (3) vowel-less
generational suffixes `Sr.`/`Jr.` rejected the whole name — and those sit on the patriarchs an inheritance
chain runs through; (4) vowel-less honorifics `Mrs`/`Dr`/`Rev` did the same — **and honorifics are the
principal way probate records name WOMEN, so the rule's effect was biased**; (5) `Wm`/`Hy`, the standard
period abbreviations, rejected as noise. Same class as `fsIdClean()` discarding 8 real climb seeds: a
validator written from an IDEA of the data rather than from the corpus.
**A false reject is the expensive direction** — junk is visible and deletable; a rejected row never exists,
so nothing surfaces it. Rule going forward: *a validator is a claim about the corpus and must be tested
against it, in both directions.*
Fixed + tightened (relaxing honorifics admitted `Mrs Sandiford's four daughters`, a CLASS of heirs → group
nouns/cardinals now rejected). **Measured: 353 decedent names newly accepted, 0 regressions; 636/647
unpromoted heir-bearing decedents now pass.** Guarded by `tests/fixtures/person-names.json` (54 real-corpus
cases, 4 directions) + `tests/unit/test-person-name-validator.js`, 54/54 — but **the repo has no `npm test`
runner** (placeholder `exit 1`), so it is not yet enforced anywhere. Deliberate residual rejects documented
(month-surnames like `John March`; will-preamble bleed `God Amen George Owens` — an EXTRACTOR defect, not a
validator one).
**CHAIN RUN 2026-08-09 (promote → descend → embed), post-validator-fix. FINAL:**
- **Step 1** `promote-probate-extractions --apply`: 3,282 extractions → **3,216 decedents minted**,
  22,744 documents linked, 136 named enslaved + 136 owner edges, **only 66 rejected**. Pre-fix that batch
  would have lost hundreds — every `Wm.`, `Mrs.`, `Sr.`, and y-vowel surname.
- **Step 2** `descend-from-probate --apply`: 1,348 estates, 5,692 heirs → **2,798 documented kinship edges**
  (1,882 parent_of / 562 spouse / 354 sibling_of), 595 anchors, 1,882 pending frontier steps, 956 parked
  bequests, 1,145 null findings. OCR: 2,299 strong / 562 weak / 29 absent.
- **Step 3** embed: heirs 2,798/2,798. **AND `--id-system probate_estate` embedded 7,683 with ZERO skips —
  meaning the ~4,467 decedent leads promoted BEFORE today had NEVER been embedded either.** A pre-existing
  RULE 0.5 silo, closed incidentally; `promote-probate-extractions.mjs` has no embed phase and should get
  one (or be paired in the Mini cron), or it re-silos on every run.

**NET FOR THE SESSION: `canonical_family_edges` 4,924 → 7,722 total; DOCUMENTED 4 → 2,802.** Invariants
clean (0 undocumented, 0 self-verified, 100% embedded). The project went from four documented kinship edges
to 2,802 without a single scrape, a single acquisition, or one FamilySearch session — entirely out of
probate already on disk.

**RESUMPTION 2026-08-09 (three parked threads restarted)** → [[finding-chunk-sweep-timeout-and-amelia-image-backing-aug09]]
(1) **Chunk sweep was dead, not slow** — killed by its own hardcoded 30s embed timeout: ollama QUEUES embeds
(idle 0.2s, at `--conc 6` 39.6s, CPU 10%), so the ceiling guaranteed failures. Added `--timeout`/`--retries`;
restarted at `--conc 3`, **0 err, ~70 docs/min**. Worse bug underneath: a doc that embedded 7 of 8 passages
**left the `--unchunked` pool forever** with the 8th silently missing — partials are now rolled back and
re-swept (4 already-gapped docs repaired). (2) **Amelia: 23 scans → S3 + 23/23 Wayback + person_documents,
pages hand-read from the images, and 10/10 `harm_events` now carry `source_document_id`** — citations became
evidence. Done from the MacBook; AWS creds are local, the Mini was never needed. Gaps kept honest: the scans
have NO `ocr_text` (RAG-silo; fix = store the hand transcription, not a fake OCR pass), and they contain
cases the ingest never captured (Georgianna/Thrift, Frank Patterson, Pop Goode & Milly, Benj Lewis).
(3) **Mini SSH is broken and is NOT the FS captcha** — key is accepted then denied; Mini-side `StrictModes`
perms or Remote Login user list, needs VNC. **The RULE 0.7 monitors have not been running.**
(4) Obligation ledger verified live: M136/M137 applied, `report-obligation-reached-class.mjs` runs and
prints Georgetown/Amherst as documented-origination vs. the banks that cannot open an account at all;
`extraction_regimes`/`obligation_accounts` are still **0 rows** — the ledger has schema, not yet entries.

**STILL OPEN:** the `descent-drip.mjs` tick (largely inert until a forward corridor exists) · the 1870→1950
census/vital corridor (blocks BOTH classes; Ancestry Library Edition posture questions in
[[plan-descent-first-lineage]] §4c) · Freedmen's Bank · `embed-doc-chunks.mjs` over the 21,180 head-only
docs · no `npm test` runner · the 090 migration checksum drift.

**OPEN DECISION for the user:** which class the drip serves first — enslaver-side (buildable today from
probate, feeds the debt ledger) or enslaved-side (blocked until Freedmen's Bank + census corridor land,
feeds the claimant side). Recommendation: build the ENGINE on the enslaver-probate side because its evidence
is already on disk, and run the Freedmen's Bank + census-corridor acquisition in parallel so the enslaved
side starts the moment its documents exist.

---

## MODERN-ENDPOINT PROGRAM + FREE AUTOMATION SUITE (2026-08-07) — branch `feat/evidence-quality-parcel-spine`
→ [[plan-modern-endpoints-program]] · [[plan-nesri-roster-completion]] · [[standard-canonical-person-and-document-gate]] · [[finding-land-nonclaim-and-dutchess-audit-jul17]]

**MODERN ENDPOINTS — 3 built, TWO types proven.** Continuity-of-holding to a modern institution now has two
templates: **LAND** (`land_transfer_events`/`properties`) and **CAPITAL** (`corporate_entities` +
`corporate_slavery_disclosures` + `inheritance_edges`). Reckoning-institutions ranked in the program plan
(Georgetown → Harvard → UVA → Princeton → Brown); Amherst is the reusable capital template.
- **Bard College (LAND) — COMPLETE.** Census pull closed it: **Samuel Bard → canonical #907115** (1800 census,
  7 enslaved, Dutchess/Clinton) and **William Bard → canonical #907116** (1810, 4), both image-backed
  (S3+Wayback) + RAG-embedded (RULE 0.6 fully met) + assertable_slaveowner. **Kinship edge #8114 VERIFIED
  (tier 2)** — census corroborates the genealogy. Land = the **Massena 15-link chain** (1688→2024, deed-backed,
  all `implicates_enslaver=FALSE` per land-non-claim) → Bard College holds it. GAPS: **no wills/probate, no DAA,
  assets = census COUNTS only** (no land/estate-valuation linked to them as persons, no named enslaved). NEXT =
  ingest **Samuel Bard's will (1821) + William's (1858)** for the inheritance edge + full assets.
- **Amherst College (CAPITAL).** Israel Trask (250+ enslaved, MS/LA cotton) funded it: **$800 documented**
  ($500 receipt + $300 will bequest) + the 1862 $50k donor list; college histories ERASED him (1862→1951).
  corporate_entity + disclosure; Nicka Sewell-Smith's **Trask 250** (9,208 descendants) CITED not scraped;
  living descendants logged for opt-in, NOT minted.
- **Georgetown University (CAPITAL, applied).** 1838 sale of **272** enslaved for **$115,000** funded the
  college; Mulledy/McSherry sellers, Isaac/Cornelius Hawkins + Frank Campbell named; DTRF descendant side.

**CENSUS-PULL OPERATIONAL LESSONS (reusable):** FS restricts the in-Chrome "Download" for census images → the
operator downloads via **Safari** (image-PDF) → `pull-bard-census.mjs --samuel-file/--william-file` archives
from the file. Read the open ARK viewer URLs straight from the **Chrome debug protocol** (`curl :9222/json`).
`PersonService.promoteToCanonical` gained **opts.forceCreate** (operator-confirmed fresh canonical past
same-name namesakes — "William Bard" collides with other-state William Bards that must NOT merge). The 1810
image is FS-FILED under "Allegany" but shows **Clinton township** (= Dutchess) + 4 enslaved (matching NESRI) —
an FS **film-group mislabel**, operator-confirmed. `let page` must be declared OUTSIDE the try (finally scope).

**NY PROBATE + de-silo:** mint gate — `isNameSuspect` promoted into `person-name-validator.js`, wired into
`findOrCreateLead` (declines place-words/legal-roles: "Albany"/"Deceased"/"Sole"). County-from-residence at
mint (`link-ny-probate-testators.mjs`) + **backfill of 2,475 existing** NY canonicals (34 real counties;
"Albany" mislabel → Dutchess/Ulster/Kings). **`promote-probate-extractions.mjs`** de-silos the LLM-extraction
output (`probate_estate_extractions`) → enslaver leads + linked docs + named enslaved (the old linker read the
wrong table). `probate-drip.mjs` **poison-pill guard** (un-extractable segments no longer pin the antebellum
queue — 1,076 wasted ticks on roll Q7P7-7MS).

**MIGRATIONS 127/128/129 + DAA (#147):** 127 `canonical_family_edges.information_type` (primary/secondary/
undetermined + informant_role + gap-years); 128 `research_findings` (null-result log, 'truncated' load-bearing);
129 Massena parcel spine. DAA subset gate (documented ancestors carry it; undocumented = `pendingDocumentation`)
+ `lineageUnproven` — both now RENDERED in the DOCX ("DOCUMENTATION STATUS & LIMITATIONS"). Fixed: gate-less
`generate-daa-pdf.js` hard-deprecated; invented dates (`yearsEnslaved:20/startYear:1850`) removed from the money
math; `generate-comprehensive-daa` runs end-to-end (DAA-000021+).

**KEY FIXES (dedup/embed class):** `PersonService.resolve` now matches **LEADS by external id** (Tier-1b) — the
Amherst/Trask dupe class (re-ingest duplicated leads); `forceCreate` for hand-confirmed fresh promotion. Migration
126 (chunk_index) had **broken the 4 embed scripts' `ON CONFLICT`** — fixed (add chunk_index). RULE 0.6 clause 3
(embed) was **skipped on the Bard promotion** — caught reactively, now ENFORCED by the monitor.

**FREE AUTOMATION SUITE (user directive: recurring agency must be FREE — NO Claude API).** Removed a paid
headless-Claude-Code setup. Now all deterministic + local-ollama + `gh`-REST:
- **Mini crons:** `probate-drip` (3h, guarded) · `project-health-monitor` (4h) · `promote-probate-extractions`
  (6h) · `embed-documents` sweep (nightly) · `auto-issue-monitor` (8h).
- **PM2 watchdogs:** `probate-watchdog-ny` (scraper) + `probate-session-heal-ny` (FS session).
- **`project-health-monitor.mjs`** — RULE 0.6 embed-compliance (recent promotions unembedded = CRITICAL, would
  have caught the Bard miss), gate over-assertion, embed backlog, orphaned image-leads, drip liveness, disk
  space, retrievability (live-retrieve). → `monitor_health_runs` ledger + ntfy (`OPS_NOTIFY_WEBHOOK`) + non-zero
  exit.
- **`auto-issue-monitor.mjs`** — FREE detector+filer: silent-failure log-scan (cron logs for FATAL/ERROR/does-
  not-exist), migration drift, siloing (growing) → auto-files deduped GitHub issues via REST+PAT (no `gh`
  install), falls back to `monitor_issues` + ntfy when no token.

**STANDING DEBTS (surfaced by the monitor — not yet fixed):** retrievability **20%** on recent docs; **5 marquee
enslavers** (Calhoun/Franklin/Carroll/Madison/Duncan) assert-without-image; **~103K** image-backed docs
unembedded; **~107K** image-leads unpromoted. **STRUCTURAL:** the Mini runs a **stale checkout** (scripts are
scp'd one-by-one — needs a branch sync); the Mini is a **single point of failure** (Tailscale drop = no
recovery, no Pi-side watchdog); Claude auth removed (free-only). **NEEDS FROM USER:** a free GitHub PAT in the
Mini `.env` (activates auto-issue-filing); optionally sync the Mini to the branch + a Pi→Mini watchdog.

---

## IDENTITY GATE — the DAA's second proposition was never gated (2026-08-07)
→ commits `ffdee08a9` (climber id fix) · `3fc284020` (identity gate)

**A bug was masking a hole.** The climber's `saveMatch` never listed `slaveholder_id` in either INSERT, so
every match it wrote had it NULL → `getDocumentedSlaveholders` resolved nothing → the probate gate threw
"no slaveholders resolved". Fixing that unmasked the real problem: **the gate validates only "did this
person hold slaves", never "is this person the participant's ancestor."** Two independent propositions;
one gate.

**Measured, same seed re-climbed (`G21Y-X4B`):** before 687 anc / 32 matches / **0 resolved**; after
727 anc / 33 matches / **33 resolved**, 31 serve a document, 9 serve an image. But **all 33 are
`name_only_match`** — and 20 documented ones would have entered the DEBT MATH. A DAA names a real person
as a slaveholder; asserting that on a name collision against ~420k enslavers is what the Biscoe rule and
audit rule 5 forbid. Identity gate added: identity-unproven ancestors move to `pending` (suspected,
excluded from debt) rather than being dropped — subset generation preserved. **Effect: 20 assertable → 0.**

**CONFIDENCE LAUNDERING (subtle, fixed).** `getDocumentedSlaveholders` re-resolves with its OWN vocabulary.
Now that a `slaveholder_id` exists, a `name_only_match` takes the `existing_id` branch and is stamped
**0.90 — higher than the 0.85** it would get from re-matching on name, on identical evidence. The original
climb `match_type` is now carried as `climb_match_type` so the gate judges real provenance. Identity is
proven ONLY by: external identifier, date+place agreement, curated dataset, or a human verdict
(`ancestor_climb_matches.verified`). Escape hatch `DAA_ALLOW_NAME_ONLY_IDENTITY=1` (backfill/testing only).

**Also this round:** record-walk now DERIVES `f.recordCountry` from birthplace (was hardcoded US, which
searched US collections for Italian-born grandparents and guaranteed a null). But recall got WORSE
(12→0 on the Italian blocks) — **unresolved**: either FS's Italian collections lack them, or `Italy` is not
a valid facet token. A control-name facet probe is written (`logs/facet-chain.sh`) but FAILED to run:
the operator closed the :9222 Chrome window, and the relaunched instance is **signed out**. Needs VNC login.
**MacBook disk:** the 40 GB `CoreSimulator` cannot be `rm -rf`'d — those are MOUNTED read-only APFS volumes;
real bytes are in SIP-protected `/System/Library/AssetsV2/…SimulatorRuntime`, and `simctl` ships with
Xcode.app which is not installed. Reclaim elsewhere.

---

## INTAKE REALITY CHECK + PII LOCKDOWN (2026-08-03) — branch `feat/evidence-quality-parcel-spine`
→ [[plan-intake-form-revamp]] · [[plan-intake-and-climb-redesign]]

**THE PII DIRECTIVE (user, mid-session — treat as standing).** A participant intake CSV was dropped in the
repo and read straight into model context: 7 real people's names, DOB, birthplaces, income, net worth, an
email, plus 24 relatives' names and FS IDs. User: *"people's data needs to be protected from the claude
model."* Correct, and `permissions.deny` alone does not do it — Bash (`cat`, `node -e`, `psql`) reaches the
same bytes. **Three layers now live, verified blocking:**
1. PII moved OUT of the repo → `~/Documents/reparations-pii/` (mode 700). `worksheets/intake-csv/` deleted.
2. `.claude/settings.json` — `permissions.deny` on the PII paths.
3. **`.claude/hooks/block-pii-access.mjs`** — `PreToolUse` guard on Bash|Read|Grep|Glob. Blocks PII paths
   AND SQL naming PII columns / `SELECT *` on participant tables. Exempts `scripts/pii/`. Fails OPEN on
   internal error (never brick a session), CLOSED on any positive match. **Proven live** — `cat` of the CSV
   returned blocked.
**The rule:** deterministic code touches PII, the model reads only emissions (UUIDs, counts, error codes).
This is audit rule 1 ("model orchestrates, code computes") applied to PII. New lane = `scripts/pii/`:
`load-intake-csv.mjs`, `inspect-redacted.mjs` (structure without values), `launch-climbs.mjs`.
**Migration 130** — `participants_safe` view (UUID, state, birth DECADE, income/net-worth BANDS, pipeline
counts; no names/DOB/address/email/FS IDs) + `participant_family.lineage_hint` / `source_block_index`.
**NOT undone:** the exposure already went to the model API, and `~/.claude/projects/…` transcripts (86 MB)
still hold earlier participant queries. Transcript scrub NOT run (resume-safety unverified).
**COMPLIANCE GAP:** the consent text says data is used *"only to count automated ancestor climbs"* — it
does not disclose LLM processing. Must be fixed in the form rewrite.

**THREE PRODUCTION BUGS FIXED (all found by working blind through the redacted inspector):**
- **`fsIdClean()` (`src/api/routes/intake.js`) rejected REAL FamilySearch IDs.** It required a digit AND a
  letter with no 3-in-a-row repeats. But FS IDs may be all letters and may repeat: `LTVZ-WSF`, `LTVZ-VSP`,
  `PXGL-LLW` are genuine and were 400'd as "placeholder". Discarded **8 climb seeds** across 6 CSV rows and
  misfiled Piper as a QA row. Replaced with a character-VARIETY test (`<3 distinct chars` = placeholder).
- **`DAAOrchestrator:1885` selected `net_worth`; the column is `estimated_net_worth`** (M036). Verified live:
  *column "net_worth" does not exist*. Query threw → catch swallowed → `dbRow` null → returned bare defaults,
  so the **entire M037 wealth fingerprint never reached the calculators**. Fixed with an aliased select.
- **`ensureLoggedIn` did NOT fail closed.** The render check passes on a sign-in page (`hasH1` is true for
  "Sign In"), so a logged-out climb printed "✓ Logged in", visited 1 ancestor, and wrote
  `status='completed'` — **indistinguishable from a genuine negative finding**. Since null results are
  first-class evidence here, that corrupts the evidence base for a real participant. Now throws on an auth
  host or on a page lacking person content. Observed on seed `G21Y-X4B` (session `9a60969b`, invalidated to
  `status='aborted_not_logged_in'`).

**5 NEW PARTICIPANTS INGESTED** (`intake_source='google_form_csv'`). QA row auto-skipped; Piper deduped
against her existing `google_form` row via self_fs_id (cross-source check). **Relationships written
NEUTRALLY** (`parent_1`…`grandparent_4`) — the form says only "Parent 1/2" and "Grandparent 1-4", no sex, no
lineage, yet the webhook hardcoded father/mother/pat_grandfather. Checked against this export that mislabels
a MAJORITY: **4 of 6 submissions put a woman in the 'father' slot** and 4 of 6 in 'pat_grandfather'. The
participant's own "whom is their child" answer is stored verbatim in `lineage_hint`; real relationships get
resolved from records. No fabricated data (audit rule 5).

**WHAT THE 5 SUBMISSIONS PROVE ABOUT THE FORM** (the empirical core of both plan docs):
- **ALL FIVE** are `self_living_unclimbable`. Measured: `LTVZ-D9S` (living participant) → **1 ancestor,
  0 matches**, twice. `LTVZ-D8M` (deceased) → **906 / 138**. `LX39-1MY` (deceased) → **5,260 / 548**.
  The DAA anchors on `participants.self_fs_id` (`daa.js:51` → `ensureClimbComplete:849`) — i.e. on precisely
  the ID that returns nothing. **The required unit must become "oldest DECEASED ancestor per line."**
- **NONE has an email.** No way to deliver a DAA to any of them.
- **4 of 5 are non-US-origin lineages** (Mexican, Puerto Rican, Italian, Punjabi). Under today's
  name+county match against US enslavers these mostly dead-end. The international-chain revision is not
  hypothetical.
- Data quality as predicted by the user's "people don't have this on hand": one participant's 4 grandparent
  birth years are `N/A`/`June 6`; one grandparent is `unknown/unknown/n/a`; one grandparent FS ID is a
  copy-paste of the parent's; **every** respondent ticked "I verified all links are correct", including the
  two who then reported gaps.
- Highest-value field remains the free text: *"allegedly we get our last name because our ancestors made
  yarn on the plantation"* — an occupational-surname → plantation lead, same shape as Adrian's McCain lore
  (43 held enslavers). Plus a name-change lead. It is question 61 of 62 and optional.

**COLUMN-MAP CORRECTION (I had this wrong first pass).** The webhook's `FORM_COLUMNS` 0-67 **does** match
the live sheet. Google Forms appends LATER-ADDED questions at the END of the sheet, not inline — hence
"whom is their child" at 69/70 and a re-created living-question at 68. The six 5-column person blocks are
NOT shifted. Real defects: **col 46 is permanently blank** (its live answer moved to 68, so
`pat_grandfather.is_living` is always null), 69/70 are duplicates of each other and unread, and the sheet
carries ghost columns (the "Column 5" placeholder; email/address at 9-13 deleted from the form). → build a
NEW form + NEW response sheet rather than editing.

**CLIMBS RUNNING (Mini).** 4 seeds queued sequentially via `scripts/pii/launch-climbs.mjs` for the two
US-prospect participants. Mini is BACK ONLINE (Chrome :9222 live, probate PM2 jobs stopped). Two ops traps
hit: `ssh host cmd` does not source the login profile → bare PATH → `node` exits 127 (now exported
explicitly in the generated runner); and node resolves modules from the SCRIPT's dir, not cwd, so probe
scripts must live inside the repo. **FS session state must be PROBED, never inferred from tab titles** —
stale ARK tabs rendered fine while the session was dead.

**NEXT:** rebuild the form per [[plan-intake-form-revamp]] §2 (new sheet + new `FORM_COLUMNS`); generalize
`public-record-bridge.mjs` into the DB-driven record-walk agent (**4 of 4,924 `canonical_family_edges` carry
a source document** — 0.08%); fan the DAA over multiple anchors (`ensureClimbComplete` consumes ONE session
from ONE seed, so 3 of 4 anchors are collected and unused). MacBook disk is at **98% (4.9 GB free)** —
~115 GB sits outside the home dir, likely APFS snapshots; user decision pending.

---

## EVIDENCE-QUALITY ROUND + STRATEGIC REFRAME (2026-07-31) — branch `feat/evidence-quality-parcel-spine`
→ [[standard-canonical-person-and-document-gate]] · [[finding-land-nonclaim-and-dutchess-audit-jul17]] · [[finding-bb1-deed-parcel-spine]] · [[assessment-dutchess-calibration-case-study-jul19]]

**DAA now RUNS (#147).** `_enforceProbateGate` was ALL-OR-NOTHING — it blocked the whole DAA if ANY matched
slaveholder lacked documentary evidence, so no DAA ever generated (climbs routinely match undocumented
ancestors). Per user directive, changed to **SUBSET generation**: the DAA carries the DOCUMENTED slaveholders
and holds undocumented matches as `pendingDocumentation` ("suspected — pending primary-source documentation",
never asserted, never in the debt). Gate returns `{documentedIds, pending, documentedDesc}`; throws only when
ZERO documented (no debt to assert) or under STRICT mode (`DAA_STRICT_PROBATE_GATE=1`). Fail-closed preserved:
name-only climb matches (null id) only exist when zero documented → still throws. **Verified: Adrian Brown
(P4RF-PFQ) generated DAA-000021** on 2 documented Hopewell ancestors (was `DAAProbateGateError`). Aligned with
the per-proposition canonical gate (all-or-nothing was stricter than the standard). TWO refinements still open:
(a) the kinship PATH gate is orthogonal + unbuilt (0/4,922 edges carry a kinship doc) — subset generation
increases DAAs riding UNPROVEN lineages; render "lineage unproven at gen N" alongside pending-doc (audit-only,
not a blocker); (b) stale comment block DAAOrchestrator:228-247 contradicts the new directive.

**STRATEGIC REFRAME (memory-bank read, corrects earlier plans):**
- **Dutchess is a CALIBRATION study, not a volume-ingest** (Roth & Tolbert 2025 multicalibration; calibrates
  per-link `p`). It is **blocked on the MODERN endpoint** (a Dutchess-descended participant / forward tracing) —
  NOT on more counties. Climb runs modern→enslaver, **0 Dutchess coverage**. "Do NOT scale nationally until
  Stage 1 returns `p`." So Ulster/Albany/Kings breadth is PREMATURE; the modern endpoint is the leverage.
- **Do NOT build a 4th extractor.** `georgia-probate-scraper.js` is already `--county`-parameterized;
  `probate-llm-extractor.js` + `probate-drip.mjs --prefix` + `extract-probate-estates.mjs` are generic.
  Real gap = fold colonial-will anchors into the SHARED `probate-entity-extractor.js`. **EXTRACTION, not
  ACQUISITION, is the bottleneck** — do not scrape more counties first. "Albany County" is the province-wide
  will-book (same %dutchess% contamination); derive county from the OCR residence phrase (fix
  `link-ny-probate-testators.mjs:54`). Before any batch: fix reextract→recomputeGate sync (else gate never
  lifts) + gate `isNameSuspect` at mint (else "Albany"/"Deceased" mint as enslavers).
- **NESRI = cross-index, NOT genealogy** (genealogy fields empirically 0-fill). Prefer a CUNY-GC data request
  over scraping. **Retrievability rubric** composes with the existing `retrieval-health-audit.mjs`/M106 ledger.
  **RAG is orphaned** (imported by ~zero live code; reads still ILIKE) — the untracked `src/api/routes/rag.js`
  is the in-progress wiring; embedding ≠ retrievable.

**BARD COLLEGE = candidate Dutchess MODERN ENDPOINT (grounded).** DB query: **Samuel Bard** and **William Bard**
are in the data as `enslaver`, Dutchess County NY, sourced from **NESRI** (leads 3579208/3579211, codes
`NY_BardSamu_01`/`NY_BardWill_01` — not yet canonical, no image). Continuity chain: Samuel Bard (Hyde Park
physician) → Bard family estate → grandson John Bard founds St. Stephen's/Bard College (1860) on the family
land → Bard College = modern institutional successor. Land instrument = the **Massena chain** (migration 129,
below) which is literally the Bard campus parcel. NEXT: attach a Samuel-Bard image → promote; harvest the
Bard→enslaved roster; log the deed/roster searches (incl. nulls) in `research_findings`.

**DUTCHESS LLM EXTRACTION (finished on the Mini).** qwen2.5 over the 479 unlinked `%dutchess%` residue:
**81 new true-Dutchess testators linked** → the true-Dutchess cohort (814 docs) went 41.4% → **50.9% linked**
(clears the rubric's 50% bar). 381/479 (80%) had NO extractable testator = structural fragment/index ceiling
(don't chase the tail). Local LLM doubled the 25.5% regex testator ceiling. 11 other-county contamination
confirmed (Albany 3, Suffolk 2, Queens, Westchester). Migration 126 (chunk_index) + `embed-doc-chunks.mjs`
gave passage-level RAG (whole-doc 0.445 → chunk 0.634).

**MIGRATIONS 127/128/129 (this round, applied + committed):**
- **127** — `canonical_family_edges.information_type` (primary/secondary/undetermined) + `informant_role` +
  `event_to_record_gap_years`. Genealogical proof-standard typing (a tier-1 doc can carry SECONDARY info);
  gap>~5yr = mechanical downgrade. Substrate for the DAA kinship gate.
- **128** — `research_findings`: first-class log of research ACTIONS incl. NULL results. `'truncated'` is
  load-bearing (a capped sweep is not a 'none'). Polymorphic subject (M103).
- **129** — **Massena parcel spine** (first real chain-of-title instrument, #112): Bard campus land,
  Barrytown/Red Hook, Dutchess. 12 named links 1688→2024 seeded from finding §4 (packet has 22; S3-archival
  + reconciliation pending). ALL links `implicates_enslaver=FALSE` (land-non-claim). Beekman+Livingston links
  = Dutchess enslaver families. Wealth series $50k(1853)→$20k→$1.15M→$14M(2024); modern link → Bard College.

**ISSUE BUNDLE for this round** (theme = chain-of-custody & evidence-quality for wealth tracing): CORE #112,
#72, #147, #113, #70+#101, #78, #75; ADJACENT #130, #123. DEFERRED (separate rounds): international ingest
(#119-145, EPIC #135), benchmark/anchor layer (#79-91,#116,#121), identity-spine (#96,#98,#105,#92).

**EARLIER THIS SESSION (pre-compaction arc):** living-person bridge (Piper Hill — FS hides living TREE
profiles, use consented data → deceased great-grandparent seeds); kinship-edge M103 harvest; intake-validator
hardening (placeholder-FS + garbage-name + impossible-gap BLOCKING); oral-history→directed-leads (McCain →
43 held enslavers); retrievability rubric (`rag-retrievability-audit.mjs`, 4 stages logged→embedded→readable
→RETRIEVED); Mini migration (heavy lifting back on the Mini). **Note: `land_transfer_events` is 116 rows now,
NOT 1 (CLAUDE.md was stale).** Migration numbering COLLIDES (113/121/122/126 each have two files — PK is the
filename, both apply); several 122-126 are applied-but-untracked in `schema_migrations`; 123 (CONCURRENTLY)
never applied.

**MEMORY-BANK RECONCILIATION (this session):** `techContext.md` heavy-rewritten (dead individuals/
unconfirmed_persons schema + blockchain gutted; PersonService/two-driver/RULE 0.5-0.6/three-machine/RAG-orphaned
added; S3 us-east-2 + 393,975 goal + scraper constants salvaged). `systemPatterns.md` fixed (blockchain removed,
Repository-Pattern two-driver rowCount trap, descendant→DAA model; design-rationale preserved). 8 stale
snapshots bannered (architecture-apr24, end-to-end-readiness-apr23, report-jun17, plan-lead-identity-resolution,
plan-may20, finding-ny-probate-audit-jul01 stale-counts, both RAG plans reality-checked).

---

## DUTCHESS AUDIT → LAND GUARDRAIL → SOURCES → RAG FIX → CALIBRATION (2026-07-17→19) → [[finding-land-nonclaim-and-dutchess-audit-jul17]] · [[assessment-dutchess-calibration-case-study-jul19]] · [[plan-dutchess-calibration-stage1]] · [[plan-dutchess-full-ingest]]
Very long session, branch `frontend/light-redesign`. Goal: end-to-end DAAs for Dutchess Co. enslavers +
enslaved, cognizant of wealth over time, making NO claim to Native land. ~20 commits. Highlights:

- **AUDIT + DEPS:** removed 11 unused packages (web3/truffle/ipfs-http-client/xlsx/… all zero-import) →
  npm audit 191→49, 0 prod criticals, unblocked `--force`. DAA CLI was dead (`corporateConnections is
  not iterable`, DAAOrchestrator:1581/:1762) — FIXED (default `[]` not `false`). `Calculator.js` is
  LEGACY (nothing on the DAA path imports it; the flagged free params 120/15000/0.04/0.035 affect no
  DAA — dead code; consider deleting it + the dead index.js facade).
- **LAND NON-CLAIM GUARDRAIL (core directive):** the system was ALREADY monetizing Native land into a
  descendant obligation (`DisgorgementCalculator` summed `land_transfer_events.consideration_usd` →
  ledger → descendant). Fixed: migration 125 `indigenous_land_provenance` (Link 0; seeded Dutchess/
  Massena → Stockbridge-Munsee), `forEnslaver` now splits `native_land_restitution_usd` (owed to the
  Native nation, separate) OUT of `descendant_claimable_usd`; DAAOrchestrator writes the descendant
  ledger from `descendant_claimable_usd`. 8-assertion test passes. Framework §2.5 amended. **Land VALUES
  wealth, never creates a descendant land claim.**
- **DUTCHESS SOURCES INGESTED (was 0 canonical/3 leads this morning):** 1714 census (14 enslavers,
  counts) + 1755 Census of Slaves (Dutchess+Westchester: 195 enslavers, 246 named enslaved, 246 edges)
  + colonial wills (26 IMAGE-BACKED enslaved, 18 edges) — all via PersonService dedup (Biscoe-safe, 0
  auto-merge) + owner→enslaved edges + district docs EMBEDDED (RAG). Secondary tier 0.85. 1790 Brownell
  edition NOT ingested (omits the slaves column). Massena chain-of-title packet is the wealth-over-time
  reference instrument (22 links 1688→2024, Beekman/Livingston/Ten Broeck = our census families).
- **RAG WAS SILENTLY BROKEN PLATFORM-WIDE — FIXED:** `RagService.retrieve` returned 0 for EVERY query
  (219k embeddings present) — unset `hnsw.ef_search` returns 0 rows on Neon + full HNSW index post-
  filter loss. Fix: SET ef_search + partial `doc_ocr` HNSW index (migration 124, dropped the full one;
  person_profile has no reader). Verified full-corpus retrieval. **EMBED + RAG run LOCALLY on the
  MacBook** — `nomic-embed-text` on ollama :11434 (the corpus model); the Mini-offline embed-debt
  excuse is GONE (`EMBED_SOURCE=ollama`).
- **CALIBRATION STUDY (Roth & Tolbert):** assessment says ground-truth n ≈ 0 (climb runs modern→
  enslaver, 0 Dutchess, ~2 human verdicts DB-wide). Maternal-link edge is SPARSE in both civil regs
  (mother optional) AND church baptisms (child often unnamed) — empirically probed. RE-SCOPED f to the
  ENSLAVER-anchored edge. Built: migration 126 `linkage_verdicts` (the verdict table the audit packet
  never wrote back to); cross-source verdict builder; NESRI cross-ref → **16 confirmed enslaver-identity
  verdicts** (Hoffman 43, Van Benthouse 14, Keip 9, …). Enslaver-identity ground truth is now real; the
  MODERN endpoint (Dutchess participant / forward tracing) is the remaining gap.
- **NESRI capability proven:** `scripts/scrapers/nesri-scraper.js` + `nesri-crossref-dutchess-enslavers.js`
  — the NY/Northeast Slavery Records Index (CUNY, Caspio; 2,569 Dutchess records, 38-field schema incl.
  Enslaver/Enslaved names, County, Year, Source) is scrapable per-search reliably; the 108-page full
  pull degrades on the SHARED FS Chrome (protocol timeouts) — needs a DEDICATED Chrome.
- **NEXT (user directive 2026-07-19): INGEST ALL OF DUTCHESS COUNTY.** See [[plan-dutchess-full-ingest]].

---

## LIVING-PERSON BRIDGE + kinship-harvest fixes + intake/oral-history + climb ON THE MACBOOK (2026-07-14→16)
Long session, branch frontend/light-redesign. **INFRA REALITY: the Mac Mini is OFFLINE for ~2 weeks**
(Tailscale "last seen 1d ago"; Pi offline 49d). So ALL FamilySearch/climb work now runs on the MACBOOK:
Chrome for Testing (puppeteer's bundled full Chrome, `~/.cache/puppeteer/chrome/mac_arm-143…`) launched via
`open -na … --remote-debugging-port=9222 --user-data-dir=/tmp/piper-climb-chrome` (NEVER puppeteer.launch —
same rule), user logs into FS manually in that window, scripts `puppeteer.connect()` :9222. Isolated profile +
shared Neon only → Mini pipeline untouched, resumes clean when it returns. This is a TEMPORARY exception to
"MacBook = no scraping".

**KINSHIP HARVEST (step 5) — WAS SILENTLY NO-OP'ING; FIXED (2 bugs).** `standard-genealogical-edge-evidence`
was "END-TO-END BUILT" but the harvest never actually wrote document-backed edges. Live diagnosis on the
MacBook: (1) `harvestPersonSources` used UNVERIFIED Sources-tab selectors (`[data-testid*=source]`/`a[href*=
/ark:/61903/]`) → matched 0 rows → silent. Fixed against live DOM: sources are `.cssSourceTitle` in
`.cssSourceGrid` rows + `source-button_view-<id>` testids (commit 128ca08ff). (2) waited 1500ms → fired BEFORE
the SPA rendered the cards → 0 captured; fixed to `waitForSelector('.cssSourceTitle')`. Now fires + classifies
(1950 census → tier-1 child_of). **BUT edges still didn't persist:** `writeKinshipEdge.resolveFs` is
CANONICAL-ONLY (line 50) and the climb produces LEADS → every edge returns `unresolved`. `canonical_family_edges`
IS lead-aware (M103 cols a_subject_table/a_subject_id…, person_a_id/b NULLABLE, trigger trg_cfe_sync_subject).
Fix = `scripts/climb/bridge-persist.mjs` writes a GATED (verified=false) lead-aware child_of edge via the M103
cols directly — honoring the climb-gate (leads, not canonicals). PROVEN: edge #8113 Kathleen Piper→Jack Piper Sr,
tier-1, doc-backed, gated. **REMAINING: unify — extend writeKinshipEdge to be lead-aware so the CLIMB (not just
the bridge) persists edges.**

**LIVING-PERSON WORKAROUND (user directive) — PROVEN + refined.** FS hides living people's TREE profiles
("[Unknown Name]") but INDEXED RECORDS are public. `scripts/climb/public-record-bridge.mjs`: given the
consented precise intake data (name/birth/place + known spouse/children), search public FS records,
disambiguate via known relatives, extract PARENTS = deceased/public great-grandparent seeds; the record doubles
as the kinship doc. **CONFIRMED tier** (spouse/child corroboration) vs **CANDIDATE tier** (parents+birth-year,
human review — never auto-asserted). Birth year parsed from "Birth YYYY" specifically (event-year matching
dropped childhood records). **Piper results:** Kathleen Piper→**Jack Piper Sr** CONFIRMED; Norma Branch→**Alton
E + Sadie J Branch** strong candidate (Branch maiden name + "Alton"→grandson Thomas ALTON Hill); Lloyd Hill
noisy; Jerry Smith deceased→father **Clemmie Adcock Smith 1910-1993** on file. **⚠ FS ANTI-BOT DISCIPLINE
(learned hard):** a tight test-loop of searches tripped FS's CAPTCHA AND my rapid re-navigations WIPED the
operator's in-progress captcha/login. MANDATORY: 20-34s between searches + STOP-on-CAPTCHA/logout (don't
hammer) + never open/close tabs fast while the operator is logging in. Commit 8351b319b.
**DELIVERABLE:** `worksheets/piper-lineage-verification.html` (gitignored, local — PII) — plain-language report
for Piper to confirm/correct the great-grandparents (participant sign-off, not operator).

**INTAKE HARDENING (a) — commit ac6021f2b.** Adrian's TEST submission (placeholder QA) exposed: `XXXX-XXX`
FS IDs passed the no-vowel regex (X is a consonant) → explicit placeholder rejection; test-value names
("…Test Run","City, State") slipped exact-match → phrase detection; impossible generations (GP born after
participant) were a non-blocking WARNING → `crossValidate` now returns {warnings,errors}, gap<=0 BLOCKS
(climbs queue only when errors.length===0).

**ORAL-HISTORY → DIRECTED LEADS (b) — M122 `intake_research_leads` + `parse-intake-oral-history.mjs`, commit
6ec187a76.** The intake free-text field was discarded; now parsed into slaveholder-family / enslaved-ancestor /
adoption / name-change claims. Slaveholder-family = a DIRECTED HYPOTHESIS cross-referenced against enslavers we
already hold. **Adrian's McCain lore** ("paternal grandmother's ancestors owned by John McCain's ancestors") →
**43 McCain enslavers we hold, dominant geography Union County NC** (data corrected my Carroll-County-MS
assumption) → targeted climb+match on the paternal-grandmother line. Confidence 0.5 (hypothesis); verify→match
or negative finding. 3 leads persisted to Adrian (P4RF-PFQ). Note: Adrian's intake also flagged adoption
(maternal cousins) + name change (=Abigail Brown).

**ALSO:** Piper registered (participant 7ce6dd12); NY-probate self-heal watchdog built (`probate-session-
watchdog.js`, PM2 probate-session-heal-ny) BUT the Mini's now offline so probate is paused until it returns;
GitHub caught up — all work pushed to branch `frontend/light-redesign` (origin/main is 229 AHEAD via a parallel
session — do NOT force main; open a PR if releasing). Earlier this session: the roster file-first reckoning
([[standard-file-first-document-archival]]) + rollback.
**NEXT:** Piper — await her confirmation of the report → persist confirmed great-grandparent edges → climb up
from Jack Piper Sr / the Branches / Clemmie Smith toward enslaver matches. Unify writeKinshipEdge lead-awareness.
Adrian — run the McCain-directed paternal climb. Ingest H_18xx IPUMS census as BENCHMARKS after the VA-slave-
count corruption fix (NOT the spine — no names). Mini returns ~end July → resume probate + heavy scraping.

---

## SESSION WRAP — frontend overhaul COMPLETE + gate-lift + guardrails (2026-07-08→11) → [[plan-frontend-light-redesign]] · [[plan-gate-lift-campaign]] · [[plan-rag-prod-wiring]]
The multi-day frontend-overhaul brief (Part 1) is substantially DONE + DEPLOYED (gh-pages-react) + runtime-
verified, plus two adjacent wins the work surfaced. Detail in the linked plan docs + the dated entries below.
- **Frontend a→e (deployed):** (a) bright light "archive/ledger" WCAG-AA design system; (d) shared `ui`
  primitives + one data layer (+ Field/Section consolidation across 5 comps, StatsRibbon retired); (b)
  schema-driven field layer (`api/fieldRegistry.js` + `RecordDetail`, PersonProfile identity grid); (c)
  cross-browser OpenSeadragon zoomable viewer (`drawer:'canvas'` — the WebGL-texture regression fix) +
  primary-sources-up; (e) RAG "Ask" surface + Search/Profile CTAs (deep-linkable `/ask?q=`). Then the
  INTEGRATION-DEBT pass: the signature primitives (LedgerFigure/SealBadge/EvidenceBlock) — built-but-unused
  — now wired; `.table-scroll` applied; VersionGate/ErrorBoundary stray colors converted; SubmitWillPage
  relit → the WHOLE public UI is light.
- **Runtime guardrails (NEW):** `scripts/smoke-test-frontend.mjs` (headless route smoke test @390px — catches
  JS/console/WebGL/doc-viewer errors; **11/11 clean**) + `scripts/verify-deploy.mjs` chained into
  `deploy:gh-pages` (wait-for-propagation → smoke-test the live bundle). It caught its own path-with-space
  quoting bug on first run (fixed). Runtime audit is now standing, not just build-verify.
- **RAG OPS still pending (frontend item 1):** Ask works in-UI but returns `degraded` in prod until Render
  `OLLAMA_URL` → Mini nomic/ollama via Tailscale Funnel ([[plan-rag-prod-wiring]]; a gemini query-embed is
  NOT a valid shortcut — corpus is nomic space). (e+) records-level embed backfill deferred.
- **Gate-lift (adjacent win):** fixed the `reextract-hand-uploaded-wills.mjs` pipeline (person_type
  'free_person'→'unknown'; auto `enslaved_count`→`recomputeGate` sync). **5 flagship enslavers now SURFACE
  (verified prod):** Hugh Hopewell V, Joshua John Ward (~1,100), Robert E. Lee, Wade Hampton, Thomas
  Jefferson. TWO TRACKS: schedule-served = cheap bulk `recomputeGate`; will-served = reextract drip (7,967 of
  10,890 gated-with-scan). #90 (scoped benchmark) is gated on the documented numerator growing (this
  campaign) + a settled national denominator (#116). [[plan-gate-lift-campaign]].
- **Liberty probate: NOT being rescraped** (user asked; DB-verified: 14,450 written, latest 2026-05-21, 0 in
  24h). Only recent Liberty touch = my re-EXTRACTION (not scrape) of one namesake admin-bond doc.
- **Remaining open (non-loose-ends, not neglect):** RAG live (ops), broaden RecordDetail platform-wide,
  thorough per-view responsive pass, embed-persons backfill. ⚠ Concurrency race with a parallel backend
  session recurred (absorbed my (c) commit) — coordinate commit timing.

---

## VA Untold #140 + high-profile enslaver front-end audit (2026-07-07, branch audit/probate-classifier)
**Virginia Untold Free Negro Registers #140 (commit da736a77d):** LVA CKAN CSV → 40,925 freed-person leads
(bulk path, per-row keys — Barcode is a COLLECTION code, only 88 distinct, NOT a person key), rule-8
dual-archived, embedding. Rich: 5,904 mother, **8,338 "Who emancipated" (manumitter=former enslaver,
dual-ledger)**, 100% carry a File Name → LVA page. **IMAGES NOT ATTACHED (0 — verified):** CSV has no image
URL; LVA serves via ExLibris/Preservica + FromThePage. FromThePage exposes IIIF (`fromthepage.com/iiif/
<id>/manifest`) but only **6 of ~39 registers** indexed there → scan-attach = a harvest (barcode locality/
years→work→canvas by File-Name page→image→S3), partial today. VA Untold is at leads+embed; NOT yet
image-backed canonicals. **Issue #145 filed** = all remaining tiers (PR-1872 #138, FOTM #139, Réunion,
French Antilles, Curaçao, Danish #141, OCR corpora) + VA Untold image follow-ons, each with the 6-step
standing procedure.
**HIGH-PROFILE ENSLAVER FRONT-END AUDIT:** Gate behavior CONFIRMED on the live API — `assertable_slaveowner=Y`
→ modal loads full (docs + enslavedPersons); **`assertable=n` → GATED/empty EVEN WITH an image** (Monroe has
an image but the gate isn't lifted → shows nothing). So "shore up" = lift the gate (qualifying doc + set
assertable). **FALSE-POSITIVE name-match risk:** ILIKE grabs wrong same-named people (matched "George
Washington YOUNG" #196627 not the President; 1860-schedule "Andrew Jackson"/"James Polk" post-date their
deaths → not them). Adds MUST go through the curated `roster_partner_ingest` pipeline with verified identity
(birth/death year + a real doc), not name-match promotion. **The curated roster (roster_partner_ingest, 19
records) already does ~14 majors WELL** (assert=Y+img): Washington #828136, Jefferson, Lee, J.J. Ward (14
docs), Forrest, Wade Hampton, A. Hamilton (4 docs), Aiken, Ladson, Cameron, Cobb, Treat + the Monticello
Hemings (enslaved, assert=n pending own docs). **TOP 10 to ADD/SHORE-UP (highest profile, missing or gated/
misclassified):** 1) Stephen Duncan #79380 — LARGEST US holder ~2,200, gated/0-docs; 2) Nathaniel Heyward —
MISSING (~2,000 rice); 3) Pierce Butler — MISSING (1859 "Weeping Time"); 4) Jefferson Davis #576209 —
MISCLASSIFIED as freedperson, fix→enslaver+doc; 5) John C. Calhoun #207607 — gated; 6) James Madison #427834
— weak/not-in-roster (ingest-madison-lead in progress); 7) James Monroe #614729 — has image, gate not lifted
(easy); 8) Isaac Franklin #141263 — largest trader, gated; 9) Charles Carroll #141466 — gated; 10) Andrew
Jackson — the assert=Y record is a same-named 1860 person, needs a verified President record. Mechanism =
roster_partner_ingest + will/probate scan → assertable.

---

## FRONTEND LIGHT REDESIGN — started (2026-07-07, branch frontend/light-redesign) → [[plan-frontend-light-redesign]]
Executing the "Part 1" frontend-overhaul brief (bright/daylight light UI, prioritized-but-detailed,
primary-sources-up, consolidated, RAG surfaced). Branch off audit/probate-classifier (frontend SOURCE lives
in-tree; deploys manually to gh-pages-react). Full plan + deeper grounding in the plan doc.
- **(a) DONE, committed, build-green:** rewrote `frontend/src/styles/global.css` token layer → a bright
  WCAG-AA "archive/ledger" light system (paper #F4F3EE, near-black ink, serif-display/sans-body/mono-ledger
  voices, ink-blue accent #14567A, evidence palette seal/debt/flag, the "ledger spine" signature). Legacy
  token names kept as aliases so every component flips with no markup change; 7-class taxonomy retuned to
  AA-on-paper; :focus-visible + reduced-motion added. Fixed PersonProfile's 2 hardcoded solarized/amber
  inline colors → semantic tokens. AA pairs (vs paper): ink 15.7 · ink-soft 6.2 · accent 7.2 · seal 5.8 ·
  debt 8.4 · err 5.9 · borders 3.1. NOT deployed (manual: `cd frontend && npm run deploy:gh-pages`).
- **Frontend facts (supersede stale techContext "Vanilla HTML/CSS/JS"):** Vite 6 + React 18 + RR6 + d3 +
  ethers; ONE global.css; ONE central api client (`api/client.js` + isVerified/filterVerified gate);
  DocumentViewer exists (582 lines) but NO true zoom/pan (→ OpenSeadragon for c); NO RAG/chat UI (net-new for
  e); dead StatsRibbon; duplicated PersonResult/Field helpers; only ONE media query (phone-first is a real gap).
- **RAG contract read:** `/api/rag/query {question,k}` → `{answer, citations:[{document_id,source_url,
  document_type}], retrieved, grounded, degraded}` (degrades gracefully). `/api/chat` is a keyword router
  over LEADS + a hardcoded reparations formula → the AskPanel should be driven off `/api/rag/query` (cited,
  honest empty), NOT raw /api/chat. Citations' document_id → `documents` table → existing DocumentViewer.
- **(d) follow-up + (b) + (c) DONE + DEPLOYED (2026-07-07).** (d) follow-up: shared `ui/Field` made a
  superset, folded the duplicated local Field/Section out of PersonProfile/DocumentViewer/CorporateEntity/
  LegalTopic (BlockchainPanel's hex-address variant kept on purpose). (b): `api/fieldRegistry.js` +
  `<RecordDetail>` — PersonProfile Identity grid is schema-driven (priority + progressive disclosure).
  (c): `ZoomableImage` (OpenSeadragon 6, lazy chunk) wired into the doc viewers, cross-browser pinch/pan,
  primary source surfaced HIGH on the profile. **DEPLOYED to gh-pages-react** (`npm run deploy:gh-pages` →
  "Published"). Existing cached clients need ONE hard-refresh (then VersionGate auto-detects). TODO: verify
  runtime zoom on-device across Chrome/Chromium/Android/Edge/Safari.
- **(e) Ask surface DEPLOYED + (e+) eval harness DONE (2026-07-07).** (e): `/ask` grounded Q&A on
  /api/rag/query, cited (citation→/documents/:id→viewer), honest empty/degraded; DEPLOYED. Live answers
  need the RAG backend wired to prod (OLLAMA_URL / Tailscale Funnel — Render isn't on the tailnet; the
  Ask tab shows "unavailable" honestly until then). (e+): eval harness committed —
  `build-rag-eval-fixture.mjs` (resolves+freezes gold IDs from live DB, ambiguity flagged not guessed) +
  `eval-records-rag.mjs` (hard gates + calibration baselines, degrades honestly) +
  `tests/fixtures/rag-eval/gold.json`. Mini person-embedding backfill (`embed-persons.mjs`) DEFERRED.
  **DATA-QUALITY FINDINGS (act on):** roster marquee enslavers SERVE scans but assertable_slaveowner=FALSE
  (Joshua John Ward #828471 = 14 scans/assertable=false; Thomas Jefferson #828182; Robert E. Lee #828469)
  — scans attached, gate never lifted; and an Arkansas "George Washington" #452284 carries assertable=TRUE
  (the #118 wrong-human is still live; the President isn't cleanly served/assertable). **INDEPENDENTLY
  CORROBORATED** by the parallel "high-profile enslaver front-end audit" (commit 144e0e9cb): `assertable=n`
  → gated/empty EVEN WITH an image (their exemplar: James Monroe #614729 has an image, gate not lifted).
  That audit's TOP-10 shore-up list (lift gate = qualifying doc + set assertable): Stephen Duncan #79380
  (largest US holder ~2,200), Nathaniel Heyward (misclassified freedperson), Calhoun #207607, Madison
  #427834, Monroe #614729 (easy — has image), Isaac Franklin #141263, Charles Carroll #141466… =
  the concrete backlog the eval's served-gold cohort will grade once RAG is wired. Frontend redesign
  a→e complete + deployed; see [[plan-frontend-light-redesign]].
- **HOPEWELL WILL AUDIT (2026-07-07, user asked "what happened to Hugh Hopewell V?"):** verified live.
  Hugh Hopewell V = **#193376 "Hugh Hopewell, Esq." d.1797** (enslaver). His will scan IS served
  (doc#570111, will, direct_primary, **s3=true**) — but he's **GATED** (`assertable_slaveowner=false`)
  because the will doc has `enslaved_count=null` + `evidences_enslaved_holding=false` + **0
  enslaved_owner edges** → the role-aware gate (#95) can't confirm "slaveholder," so his public profile
  shows the gated stub. Root cause = the will was archived but its enslaved CONTENT was never extracted
  (fix: `reextract-hand-uploaded-wills.mjs` → populate count/names → recomputeGate lifts). SAME pattern:
  **James Hopewell #1070** (primary DAA fixture!) also served=1 but assertable=false. **"Many Hopewell
  wills" = YES but 4 of 6 are ORPHANED** (person_documents document_type=will mentioning Hopewell:
  6 total, **4 canonical_person_id=NULL** → S3 scans linked to no person, invisible on every profile);
  only #1070 + #617719 linked. Plus dedup debt: multiple Hugh Hopewells (#193376/#617726/#609495-merged/
  #193864/#194338/#193558) + 3 merged "Anne Maria Hopewell" tombstones.
  **CORRECTION (verified by reading OCR):** my "4 orphaned Hopewell wills" was a FALSE POSITIVE — those
  are NY-probate wills (John Brinkerhoff Dutchess Co, Theodore Staats Cayuga Co) mentioning the *town* of
  Hopewell, NY; ILIKE '%hopewell%' matched a PLACE, not the family. Real Hopewell-family wills are the
  linked ones. (I fell into the exact namesake/place trap the project fights — logged as a lesson.)
  **HUGH V FIXED end-to-end (2026-07-07):** ran `reextract-hand-uploaded-wills.mjs --id 570111 --apply` →
  OCR'd the will (gemini-ocr, 3pp, S3 redirect-probe since GetBucketLocation IAM is missing) → extracted
  2 enslaved (Jacob, Harry) + 7 heirs into will_extractions. The entity-backfill FAILED on
  `chk_canonical_person_type` (reextract:228 writes personType='free_person', NOT in the M110 allowlist —
  version-skew bug). Per user (targeted-SQL, don't touch shared pipeline): set doc#570111
  enslaved_count=2 + evidences_enslaved_holding=true (grounded in the will), then PersonService.recomputeGate(193376)
  DERIVED assertable_slaveowner=true. Verified on PROD: gated=false, will collection serves,
  reparations compute, hasPrimarySource=true. Hugh V surfaces.
  **SCALE of the same fix (live counts): 10,890 enslaver canonicals serve a scan but assertable=false**
  (will 7,367 / other 3,347 / estate_inventory 775 / …); **7,967 are will/probate-served (reextract target)**;
  **39,681 served will/probate DOCS have no extracted enslaved content**; only 34,626 enslavers assertable now.
  **TWO PIPELINE ROOT CAUSES to fix before any batch campaign:** (1) reextract:228 personType 'free_person'
  → an M110-valid value (or ALTER the CHECK); (2) reextract must sync will_extractions enslaved →
  person_documents.enslaved_count/evidences_enslaved_holding + call recomputeGate (it currently does
  neither, so the gate never lifts). Then run the 7,967 as a coordinated drip (Mini), not ad-hoc. NOT done here.
- **FRONTEND AUDIT POSTURE + 2 live errors resolved (2026-07-07, user pushed on regressions).**
  Honest gap: the overhaul was build-verified + targeted-prod-verified, but NOT browser/runtime-audited —
  and both reported errors were runtime-only (invisible to `vite build`):
  1. **WebGL "Error creating texture" (REAL regression, FIXED, commit 22d50268d):** OSD 6 defaults to the
     WebGL drawer; WebGL can't texture a cross-origin S3 image without CORS → scan wouldn't render. Fix =
     `drawer:'canvas'` in ZoomableImage (2D drawImage handles tainted images; crossOriginPolicy stays false).
  2. **Deep-link "403" on /person/... (COSMETIC, not ours):** GH Pages returns HTTP 404 for a hard-loaded
     SPA path, the deployed 404.html SPA-redirect fires, page recovers. WebKit renders the 404 as a
     "permission" message. Standard GH-Pages-SPA behavior; in-app clicks never hit it.
  **Audit run this session:** build green · code regression grep clean (no broken imports / removed-component
  refs / stray hardcoded colors beyond the intentional dark lightbox) · cross-view PROD API smoke test =
  all 9 main-view endpoints 200 with valid shapes. **DURABLE FIX RECOMMENDED (not built):** a headless
  puppeteer/Playwright route smoke test (load each route + open the doc viewer + assert no console errors) —
  runnable on the Mini/CI; the WebGL bug is exactly what it would have caught. MacBook can't run a browser.
  **DURABLE FIX BUILT + VERIFIED (commit 242f80506):** `scripts/smoke-test-frontend.mjs` — headless
  puppeteer route smoke test (390px phone viewport) failing on JS exceptions / non-benign console errors /
  the WebGL texture regression / a doc viewer with no <canvas>. Launches headless (CI/Apple-Silicon) or
  CHROME_URL-connect on the Intel Mini; BASE_URL overridable. RAN against live: **11/11 routes clean**, and
  the doc-viewer check rendered a <canvas> → runtime-CONFIRMS the drawer:'canvas' WebGL fix draws Ward's
  scan. Run it after every frontend deploy. (Turns out headless launch DID work from this MacBook for our
  own public site — the earlier 'can't run a browser' caveat was over-cautious for a non-scraping smoke test.)
- **⚠ CONCURRENCY RACE (the documented shared-index bug recurred):** a parallel backend session ran a broad
  git add/commit and ABSORBED my staged (c) frontend files into ITS commit `a7bfdad34` ("feat(archive)…").
  The (c) CODE is intact in HEAD (verified: reorder present, ZoomableImage tracked, build green) — only the
  commit label is wrong. Did NOT rewrite history (parallel session active). Frontend source branch =
  `frontend/light-redesign`, which now also carries parallel backend commits (harmless to the frontend build).
- **Grounding note:** read the full governing memory bank before proceeding further (user directive). The
  design-system commit is validated by it (preserves gate-stub, VersionGate, dignity framing). Remaining
  objectives (d consolidate → b schema-driven fields → c primary-sources-up+OpenSeadragon → e AskPanel →
  e+ canonical embed backfill + eval harness) sequenced in the plan doc, with the added UI constraints
  (reparations-as-vector never-net, status-as-facts, kinship-edge gate, dignity/placeholder rules, RAG
  read-only boundary). Baselines (WCAG pairs recorded above; RAG eval baselines TBD when the harness runs).

---

## PROMOTION RECKONING — the systemic orphaning bug + RULE 0.6 (2026-07-07, branch audit/probate-classifier)
User pressed on whether ingested persons actually PROMOTE + SURFACE. Grounded audit found the load-bearing
disease. Commits d4c8e0ead / 8f36f5363 / promote-curated / link-ny-probate.
**THE DIAGNOSIS (verify-db-not-logs):** promotion was **systemically not happening — 9 leads promoted EVER**;
3.12M leads vs 680K canonicals (82% of persons un-promoted). The ingest + attach-doc halves were built; the
PROMOTE half never was → nothing new surfaces (leads are search-hidden by design). NOT a serving bug — the
doc-load (documentCollections/ownerDocuments) + doc-serve (/access presigned S3, verified HTTP 200 JPEG) work.
The two things that looked broken were my own test errors (wrong response field; host-prefixed a full presigned URL).
**SYSTEM ORPHANING AUDIT:** person_documents 658K → 450K→canonical, 159K→lead, **83K ORPHANED**; **only 45,521
canonicals (7%) serve an image → 635,006 (93%) IMAGE-LESS** (RULE 0.6 debt); **158,766 image-backed leads
promotable now**.
**RULE 0.6 CODIFIED (CLAUDE.md + [[standard-canonical-person-and-document-gate]]):** a canonical MUST (1)
be deduped/discrete, (2) SERVE an image (person_documents.s3_key, dual-archived rule 8), (3) be RAG-embedded.
Supersedes secondary-only gated canonicals for NEW promotions; the 635K image-less = backfill DEBT. Order for
image-rich sources: attach-scan drip → promote image-backed+deduped → embed.
**THE FIX — `promote-curated-source.mjs`** (curated = source already internally deduped, e.g. IISG Id_person).
The naive `PersonService.promoteToCanonical` failed on curated enslaved leads: (a) 70% needs_review (mononym+
birthdecade ambiguity vs the 424K other enslaved — the Biscoe guard is for MERGE, wrongly blocked CREATE);
(b) ext-id ON-CONFLICT left the canonical orphaned from its source id. Fix: CREATE per source-record (defer
cross-source MERGE to a Biscoe review pass) + MIGRATE identity set-based (ext-id + blocking keys + document
lead→canonical) + gate. **PROVEN end-to-end:** a promoted Suriname person is canonical + assertable + gated:False
+ its register scan loads in the modal + SERVES (200 JPEG 244KB). The full lead→canonical→surface→serve pipeline
works for the first time.
**#3 DONE — `link-ny-probate-testators.mjs`:** 3,726 real-named NY testators → assertable decedent canonicals
with their will scans linked (orphan docs → surfacing). Remaining ~74K unlinked NY docs = junk/Image-NNN.
**#1 Suriname promote — CHAINED after the scan drip** (drip ~82%, 46,802 scans; full promote fires on drain →
~95K assertable canonicals serving register scans). **#2 158K image-backed:** promotable-with-id_system are
almost all Suriname (49K→95K, = #1); the other ~110K (older freedmen's/census/probate docs, NO id_system) need
a GENERALIZED promote (select any lead w/ an s3_key doc, mint ext-id from source) — small follow-on.
**#4 635K IMAGE-LESS — recoverable, it's a RELINK disease not un-gettable:** by origin — 248K promote-slaveholders
(1860 slave-schedule scans, 140K scans in S3 but attached to the ENSLAVED on-page "Unknown" rows, NOT the named
owner; **owner↔scan link was LOST at promotion** — no ext-id, eor empty → needs name+state matching, Biscoe-soft);
78K freedpersons (Freedman's Bank scans); 43K SlaveVoyages (voyage images, partial); **185K Hall/Louisiana =
the hard tail (notarial scrape needed)**. Lesson: the ingest pipelines LOST or never-made the person↔document
link; #4 = sequenced relink passes.
**NEXT (order):** generalized promote for the 110K no-id-system image-backed → 248K slaveholder→schedule-scan
relink (matching-precision first) → Hall notarial scrape. Also: NY probate SCRAPER resumed (stale-jar reauth,
pid running); enslaved_org embed drip + Suriname scan drip running.

---

## #142 builds EXECUTED — vision router + reconciled count + distributed linker (2026-07-07, PR #144)
Preceded by a full architecture re-read for MAX INTEGRATION (user directive). Plan + integration map:
`memory-bank/plan-vision-router-and-count-aggregation.md`. Every build plugged into an existing seam and
REMOVED a duplicate / finished a deferred seam — no new silos.

- **BUILD 1 — vision-OCR router (DEPLOYED).** `src/services/vision/vision-router.js` exports
  `transcribeImage(buf,{mimeType,prompt})→string` (the seam OCRService already used), mirroring the TEXT
  router `probate-llm-extractor.js`. Cascade: **`qwen/qwen2.5-vl-72b-instruct` (OpenRouter — cursive-EXACT
  + UNCAPPED) → gemini-2.5-flash (OpenAI-compat endpoint) → gpt-4o**, 429/5xx fallthrough, `VISION_PROVIDERS`
  reorders. Healed 3 silos: `gemini-ocr.js`→thin delegate (OCRService/probate/will-reextractor upgrade
  transparently); `OCRProcessor.js`→router-first (was dead-Google-Vision→Tesseract-only); OCRService
  envelope stops mislabeling. **Prod needs `OPENROUTER_API_KEY` in Render for Qwen** (else degrades to Gemini).
- **BUILD 2 — `enslavedCountFor` (DEPLOYED).** `src/services/reparations/enslaved-count.js` — ONE reconciled
  per-slaveholder count = **MAX** of {`SUM(person_documents.enslaved_count)` walk/OCR, named edges, the 1.4M
  owner-referenced index leads} (MAX not SUM — overlapping sources never double-count; a documented FLOOR).
  Wired into BOTH `contribute.js` (was the only `enslaved_count` reader) AND `DAAOrchestrator.calculateTotalDebt`
  (was NAMED-rows-only + a DEAD `dbSlaveholder.enslaved_count` ref) — **divergence killed**. Verified: Ward
  0-named→**1,100**; Cobb 8→**49** (index found more of his run). Owner match normalizes Jr/Sr/honorifics,
  state-scoped for namesakes.
- **BUILD 3 — distributed edge linker (BUILT + STAGED, not run).** `scripts/link-distributed-enslaved-edges.mjs`
  persists the 1.4M owner-referenced leads as `enslaved_owner_relationships` edges (owner_canonical→enslaved
  lead) — **finishes the owner-lead→canonical seam `build-enslaved-owner-edges.mjs` left DEFERRED**; feeds #2's
  fast `named`. Bounded to served roster enslavers. BLOCKED on perf: a JSONB seq-scan per holder → **migration
  123** (trigram GIN on `unconfirmed_persons(relationships->>'owner')`, person_type='enslaved') **must be applied
  CONCURRENTLY OFF-PEAK** (scrapers write that table live) before the batch runs at scale.

**RAG boundary (user asked, now settled + matches your new RULE 0.6):** RAG ← FEEDS ← vision router (#1 OCR →
`person_documents.ocr_text` → embeddings); RAG ⊥ the COUNT (#2 stays pure SQL per **Rule 1** — deterministic
computes, never a model); RAG → may aid DISCOVERY → walk (#3). #3's captured pages should trigger a re-embed
(RULE 0.6 = canonicals must serve an image + be RAG-embedded).

**COMPLETENESS layer still open (documented follow-on):** live FS owner-name search
(`searchFamilySearchRecords` → ARKs beyond the ~79.5% index → vision-router OCR) closes the Ward-71-vs-1,100
index gap for distributed holders — BLOCKED on the recurring FS-session expiry (viability probe hit the login
wall). See [[reference_familysearch_session_reauth]].

---

## MULTI-SOURCE INGEST AT SCALE + bulk-path unlock + RULE 0.5/0.6 (2026-07-05→07, branch audit/probate-classifier)
A very large session (parallel to the roster campaign). Arc: LBS validated → the performance unlock →
Enslaved.org (424K) → Suriname (95K) + gate-lifting scans → standards codified. Commits b26dc2be…4f27d63.

**THE SCALING UNLOCK — set-based bulk-lead ingest (commit 94bcfe3aa).** User flagged the LBS promote was
~4h for 21K over Neon ("super slow… even for leads without documents"). Root cause = `PersonService.
findOrCreateLead` fires ~6-10 network round-trips/person → ~1.5 leads/sec (731K = ~5 days). Fix: **M121
`derive_blocking_keys()`** (SQL port of `_queryKeys`, byte-identical, verified) + **`scripts/lib/
bulk-lead-ingest.mjs`** — ONE data-modifying CTE per batch creates leads + person_external_ids +
blocking_keys set-based (ext-id unique index = the dedup; no app-side cache). A/B: byte-identical keys,
idempotent, **1,592 leads/sec (~1000×)**. Keeps findOrCreateLead for the interactive path. Every large
gated-lead ingest rides this now. Plan: [[plan-bulk-ingest-and-enslaved-org]].

**LBS #137 VALIDATED (commits 6cbe7090f…).** Fixed the dedup bug (findOrCreateLead's swallowed ext-id
write → 2.9× dup leads; ingest now owns dedup via ext-id cache + explicit write). `validate-ucl-lbs-
ingest.mjs` (the "not successful until this passes" harness) GREEN: dedup 1:1 (6,154), colony 100%/£
99.9% fill, 0 re-parse drift, £ as-transcribed, no fabrication, 7,085 awardees, **Σ£10.15M** dual-ledger
(Jamaica 2,696 claims/220K enslaved/£4.24M). Caught+fixed 2 parser bugs (£-as-year, 0-enslaved). Embedded.

**#136 Enslaved.org LOD — 424,185 leads in ~7 min (commit f21899bec).** `ingest-enslaved-org.mjs`:
two-pass Wikibase-JSON (731,500 persons P1→Q410; status P33-only Q109/Q112 — NOT P17/P39); provenance via
statement-ref→P6→Source(name/project/license); **SKIP federated slices we hold — 307,314 SlaveVoyages+Hall
excluded** (was 1 via wrong P13); bulk path; id_system=enslaved_org_qid. New datasets gained: Fogel
Economics of American Negro Slavery (~123K priced transfers), Brazil (~50K), Virginia Untold (~25K),
extended LBS/T71. **#143 (dedup DEFERRED):** enslaved.org has NO strong corroborator (P21=0%, no birth
years → nmsx name+sex only) → blanket cross-source dedup = low-precision review flood; needs birth-year
derivation first. **Leads vs canonicals:** leads LINK/resolve (reversible), canonicals MERGE (destructive,
Biscoe); RAG (`find-semantic-dup-candidates.mjs`) adds semantic RECALL but not precision. Embed drip on Mini.

**#137 Suriname Slave Registers — 95,505 leads + gate-lifting scan pipeline (commits 8c50dbcc0…4f27d63).**
IISG Dataverse hdl:10622/CSPBHO CC BY-SA CSV (55MB, 192K entry-rows→95,538 persons by Id_person). RICH:
63% birth year, 54% mother, **99.97% owner** (dual-ledger + owner-sequence=transfer chain), 32% emancipation
surname. `ingest-suriname-slaveregisters.mjs`, bulk path, **rule-8 dual-archive** (S3 CSV + Wayback). Strong
corroborators → 60,309 nmsxb birth-year keys → REAL cross-source dedup (unlike enslaved.org). **SCAN-ATTACH
(RULE 0.6):** `harvest-nas-scan-index.mjs` (OAI-PMH set=nas 524K→13,697-folio (inv|folio)→IIIF index, **100%
coverage** of the 13,683 IISG folios) + `attach-suriname-scans.mjs --index` (per-folio: IIIF service.archief.nl
→ S3 + Wayback → `person_documents.unconfirmed_person_id`, LEAD-capable). **DRIP RUNNING** (MacBook nohup,
resumable, high-recall, ~few hrs) attaching register scans to the 95K leads. Curaçao (OAI-PMH set=ghn, 46,821)
= next Dutch piece.

**STANDARDS CODIFIED:**
- **RULE 0.5** (CLAUDE.md + [[standard-external-source-ingest]]): use RAG on every DB/search/modal step;
  every ingest MUST add an EMBED phase (`embed-leads.mjs` generalizes it) or data is a retrieval silo.
- **RULE 0.6** (CLAUDE.md + [[standard-canonical-person-and-document-gate]]): a canonical MUST serve an
  image (person_documents.s3_key, dual-archived) AND be RAG-embedded. Supersedes secondary-only gated
  canonicals for NEW promotions; existing image-less canonicals = backfill DEBT. Order for image-rich
  sources: attach-scan drip → promote image-backed+deduped → embed. LOD-only (enslaved.org) can't clear it.
- **Rule 8** ([[standard-external-source-ingest]]): dual-archive S3 + Wayback (was the M100 standard the
  LBS ingest silently regressed from; codified + LBS backfilled).

**RESEARCH (all in [[data-sourcing-shopping-list]]/[[reference-benchmark-sources-register]]):** intl
slavery-source catalog (6-agent pass) tiered by re-hostable-images/gate-class/id_system → epic **#135** +
builds **#136-141** (Enslaved.org✓/Dutch⧗/PR-1872/FOTM/Virginia-Untold/Danish-permission). Per-power
colonial-trade-value PRIMARIES (Necker/Bryan Edwards/Humboldt/Inikori/Rönnbäck archive.org PD) + the
**MacGregor 5-volume map** (Vol V = British WI; user gave Vol IV = Cuba✓+Brazil). JFS #132 (no-repost) +
British Guiana vc.id.au #134. All feed `slave_economy_benchmarks` as cited aggregates (extraction pass NEXT).

**RUNNING BACKGROUND:** enslaved_org embed drip (Mini, ~days); Suriname scan-attach drip (MacBook, ~hrs).
**NEXT:** Suriname promote(image-backed+deduped)→embed once scans land; nas index makes every image-source
faster; Curaçao; per-power benchmark extraction; birth-year derivation to unlock enslaved.org dedup (#143).
**PERF CAVEAT retired:** the promote-slowness that motivated the bulk path is solved for leads; the
canonical-promote path (PersonService.promoteToCanonical) is still per-record — bulk it before mass promotion.

---

## Schedule-count backfills + modal enrichment + OCR-capacity findings (2026-07-06, PR #133 + issue #142)
Continued the roster campaign. **Ward = the fully-connected gold-standard exemplar now** (deployed): 25 `person_facts`
(6 plantations, 10 children, office), 14 schedule pages / **1,100 enslaved / $15.69B** live, `enslaver_evidence_compendium`
populated (`direct_primary`/`original_verified`), spouse + 3 heir-sons as gated secondary canonicals with
`canonical_family_edges` + `inheritance_edges` (Mayham→Alderly, Benj. Huger→Prospect Hill, Joshua→Brook Green — the
continuity spine). Frontend `PersonProfile.jsx` now renders a **Plantations & Holdings** + **Documented record** section
from `person.facts` (was rendering NONE — deployed to gh-pages). **#118** search disambiguation: `life_span` (birth–death)
added to all 3 search UNION branches so two real "George Washington" enslavers are tellable apart. PR #133 merged→main.

**7-lead schedule backfill (Cobb/Ladson/Forrest/Cameron/Hampton/Aiken/Lee):** 4 counted EXACT (Cobb 8, Forrest 7,
Lee 3 [personal; Custis estate separate], Ladson 2). 3 big holders = **per-location PARTIAL minimums** (Aiken 80,
Cameron 55, Hampton 21), flagged `distributed_holding`.

**OCR-CAPACITY FINDINGS (issue #142) — the load-bearing lesson:**
- **Vision-model bakeoff on 1860 cursive** (ground-truth Forrest ages [30,22,18,16,14,8,15]=7): **Qwen2.5-VL-72B via
  OpenRouter = EXACT + UNCAPPED** (OpenRouter has credit). Gemini accurate but DAILY-capped (~250/day, drains w/ retries).
  GPT-4o=12, gpt-4o-mini=116, Groq="Sarah Patton" — all miscount cursive. Google Vision key suspended (#126). → build a
  **vision-OCR router** mirroring `probate-llm-extractor.js` (Qwen-VL primary → Gemini → footer fallback); wire
  `OCRService`/`gemini-ocr` consumers onto it. This is the OCR-capacity layer the project lacked.
- **The real wall is STRUCTURE, not OCR:** big planters' enslaved are **distributed across many plantations/counties/
  states on SEPARATE schedules** (Hampton = SC+Mississippi; Cameron = Person + Orange Co Stagville; Aiken = Jehossee
  ~700 but adjacent pages read as Mrs/Jno Aiken — cursive owner-name drift). **Ward's single 14-page contiguous run is
  the EXCEPTION.** So a big holder's TRUE total needs **owner-name search + aggregation across the whole 1860 collection**
  (likely QUERY the existing **1.68M pre-indexed slave-schedule leads in `unconfirmed_persons`** by owner-name via
  blocking keys → dedup → sum `enslaved_count`), NOT run-walking. Second named build in #142.
- FS multi-page walk mechanics (from Ward + these): `&i=` param IGNORED; Next/Prev buttons work; the printed
  **"Total slaves" footer box** is the reliable per-page number; continuation pages are BLANK-owner (enumerator-dependent —
  Ward re-labeled "Est J J Ward / Brook Green Continued"; Aiken/Cameron/Hampton did not). Walker: `/tmp/*.cjs` on Mini.

**NEXT (before building #142's two capabilities): re-read the whole architecture for MAX INTEGRATION** (per user) — the
vision router must mirror the existing text router + OCRService consolidation; the owner-name aggregator must reuse the
1.68M indexed leads + `person_blocking_keys` + PersonService single-door + the `person_documents.enslaved_count`
count-holding model, NOT a new silo. Recurring op constraints: [[reference_familysearch_session_reauth]] (FS session
expiry → :9222 debug Chrome sign-in), Gemini daily cap.

---

## DIRECTIVE (user, 2026-07-05): USE RAG on every DB / search / modal step
For any step touching the database, search, or person-profile modals, GROUND it via the RAG retrieval
layer (`scripts/rag-query.cjs` / `/api/rag/query`, `RagService`, nomic-embed-text on the Mini ollama —
51,347 doc_ocr embeddings live) BEFORE deciding — not just reason from context. **Corollary caught by
doing it:** the LBS records are NOT embedded → invisible to RAG/search/modals. So every new ingest MUST
add an EMBED phase (like `embed-persons.mjs`/`embed-documents.mjs`) into the `embeddings` table, else the
data is siloed from retrieval. LBS embed step added to the pipeline (persons + claim/estate content via
Mini ollama; query-embed runs on the Mini where ollama is local).

---

## Roster audit → 15 famous enslavers SERVED on primary docs (2026-07-03/04, PR #125, branch audit/probate-classifier)
Audited Wikipedia "List of slave owners" (~300) against `standard-canonical-person-and-document-gate.md`.
**Breadth probe: 321/321 ABSENT for the intended person** (145 no-trace, 176 namesakes-only) — the DB holds
the NAMES (freedpeople who took them, bulk-mint Hall/SlaveVoyages, same-name strangers) but not the people.
A raw name+gate match is worse than useless (an AR "George Washington" carried `assertable_slaveowner=true` —
wrong human). Then depth-ingested PRIMARIES, each visually verified before serving:
- **Wills (user scans):** **George Washington** (+ **William Lee**, 1799 will manumission clause), **Thomas
  Jefferson** (+ **Burwell Colbert, John Hemings, Joe Fossett, Madison & Eston Hemings**, 1826 codicil).
  **James Madison = LEAD only** (transcription, no scanned file → NOT served; his will frees none, names none).
- **Hamilton (LoC cash books via IIIF):** served on the estate "**Servants £400**" inventory + the 1796
  "**$250 … 2 Negro servants … for me**" purchase; + **Peggy** + **Malachi Treat** (buyer) from the 1784 Peggy
  sale. Serfilippi Schuyler-Mansion paper stored SECONDARY + RAG (a hunting map, not assertable).
- **1860 slave schedules (Mac Mini FS scraper):** **Lee, Joshua Ward** (largest US slaveholder), **Cameron,
  Hampton, Forrest, Cobb, Ladson, Aiken** — from the pre-indexed leads' FamilySearch ARKs.

Pipeline: `ingest-{gw,jefferson,madison,hamilton}-*.mjs`, `ingest-peggy-treat.mjs`, `pull-marquee-schedules.cjs`
(Mini, queue-gated behind probate) + `promote-marquee-schedules.mjs` (MacBook, human-verified per lead).
**FS image capture (issue #124):** the viewer is tiled `<img>` (no canvas) → element-grab/`page.screenshot`
give illegible zoomed-out "wide screenshots"; the viewer's **Download button** yields the real full-res JPG
(~2 MB). The probate scraper has the SAME bug. `captureFamilySearchImage()` = the reusable primitive.

Gate/schema fixes (`PersonService.js` + migrations, applied live to Neon):
- **M113** `person_documents.evidences_enslaved_holding` — enumeration-of-unnamed gate branch (an estate line
  valuing "Servants" lifts the owner flag without naming; Rule-5-safe).
- `bill_of_sale` + `slave_manifest` moved **OWNER_NAMED → OWNER_CONTENT** (name BUYER **and** enslaved → owner
  assertion needs a role edge; fixed an enslaved woman, Peggy, wrongly flagged `assertable_slaveowner`).
- **M114** `person_documents.enslaved_count` (+ `_partial`, `_demographics`) — count-holding path for UNNAMED
  enslaved (a Rule-5-safe COUNT, not fabricated person rows).

Profile (`contribute.js`, deploys via Render): enslaved list keys on the verified `owner_canonical_id` edge,
not `owner_name ILIKE` (killed namesake contamination + the $28.52M-off-the-wrong-2-people bug);
`hasPrimarySource` recognizes `s3_key` primaries; **`person_facts` surfaced**; **count-based reparations** from
`SUM(enslaved_count)`. RAG: `/api/rag` mounted + `/api/chat` grounded (RagService was imported by ZERO live code).

Issues: **#118** (search MUST disambiguate same-name distinct people — two REAL "George Washington" enslavers,
President vs Choctaw-Nation/AR schedule; NEVER demote a real person), **#124** (FS capture quality).

HONEST LIMITS (do not overstate "served"): schedule counts are **PARTIAL** — one page each (Ward i=48=80
verified; his ~1,130 needs the full run). The FamilySearch SPA is **anti-scrape/flaky** (`&i=` nav ignored;
index panel renders unreliably on nav; DOM index **over-attributes on mixed pages** — Lee 40 vs image-verified
3). Reparations **formula** still the legacy-uncited one (only the COUNT feeding it changed — methodology = Issues
#2–#25). Ward enriched with 19 SECONDARY `person_facts` (all `needs_primary` — the family article is a HUNTING
MAP enumerating primaries to chase: gravestone, will+probate, full 1850+1860 schedules, marriage/death records,
the 1843 Allston letter).

**OCR was fragmented AND BROKEN → FIXED (#126, in PR #125):** the canonical `OCRService` (used by live
`DocumentProcessor`) called a **SUSPENDED Google Vision key** and silently degraded EVERY upload to Tesseract
(useless on cursive). The working OCR was `src/services/probate/gemini-ocr.js` (`transcribeImage`, Gemini 2.5
Flash), siloed in probate. **Consolidated `OCRService` onto `gemini-ocr`** (Gemini primary → Vision dormant
secondary → Tesseract fallback; added a backward-compat `prompt` param to `gemini-ocr` — no 5th module). Verified:
`OCRService.performOCR` on Ward's schedule now transcribes via gemini-2.5-flash (was PERMISSION_DENIED).

**Count pipeline = #127 (filed, PAUSED — Mini-heavy):** reuse `gemini-ocr` — walk the owner's consecutive pages
on the Mini (Next/Prev buttons; `&i=` URL param IGNORED; SPA flaky, needs render-waits) → download full-res →
Gemini-OCR each. The GOLD per-page count is the printed **"Total slaves" footer box** (machine-legible); owner
identity is cross-referenced vs the FS transcribed index (Gemini MISREADS cursive owner names — "Col. Joshua J
Ward"→"C.P. Jordan & Ward"; the DOM index OVER-attributes on mixed pages — Lee 40 vs image-verified 3). **Ward's
page CONFIRMED by image-read** = Col. Joshua J Ward, **Brook Green Plantation, 80 all-female** (footer box=80; the
"all-female" was REAL — a rice-plantation female gang, NOT a bug). **#127 EXECUTED for Ward 2026-07-05:** the
self-contained walker (`/tmp/ward-full-run.cjs` on the Mini — inline Gemini + Download-button capture; walks
Next/Prev, footer-box count per page, S3 + per-page `person_document`) captured **14 pages = 1,100 enslaved**
(12×80 + 60 + the i=48 80), his profile now shows **1,100 / reparations $15.69B live** (was 80/$1.14B). Owner
labels name his SIX plantations (Brook Green, Springfield, Alderly, Prospect Hill…). 1,100 corroborates the
1,130-1,131 secondary; 1 backward-boundary page had a transient Gemini-null (unresolved — the ~30 gap). **Blocker
hit + resolved: the Mini's FamilySearch session (cookie jar) EXPIRED** — scraper has NO password auto-login (throws
"log in via the Chrome window"); cookie re-injection via probate-restart did NOT help; required a MANUAL sign-in
via VNC into the **:9222 debug Chrome specifically** (user first signed into the wrong Chrome — the debug profile
`/tmp/familysearch-ancestor-climber` is separate). This blocks BOTH the walker AND probate (shared Chrome). Worth
a session-health ping + ntfy alert so runs don't silently no-op. STILL TODO: backfill the other 7 schedule leads
(Cameron/Cobb/Forrest/Hampton/Ladson/Aiken + Lee's small run) via the same walker. Ward = gold-standard exemplar.
**PR #125 MERGED → main + DEPLOYED
live 2026-07-05** (verified in prod: Ward's profile now returns occupation / 19 facts / reparations $1.14B;
`OCRService` runs on Gemini). Deploy-readiness confirmed GREEN: schema already in Neon, `render-build.sh` runs
NO migrations (code-only deploy), no dangling imports of the 5 deleted service classes; my migrations renumbered
113/114→121/122 (collision with #90 census) + logged in `schema_migrations`.

---

## UCL LBS scraper — research passes + step-1 frontier BUILT (2026-07-04, branch audit/probate-classifier)
User: dedicated research passes to devise + iteratively test/improve a scraper recovering all persons +
spine attributes from https://www.ucl.ac.uk/lbs/search/ — **fully autonomous, running on the Mac Mini
via puppeteer**. Research done + written to [[finding-ucl-lbs-source-and-scraper-research]] +
[[plan-ucl-lbs-scraper]]. KEY FINDINGS: (1) LBS = digitized 1834 Slave Compensation Commission = the
tier-1 "British 1834 compensation" source activeContext already flagged NEEDED — dual-ledger enslaver
debt (£20M to named awardees, per claim, with roles) + enslaved-count denominators (#116) + ~67k
owner-class canonicals + the six legacy strands (Commercial/firms = continuity substrate). (2) Licence
**CC BY-NC-SA 4.0** → usable non-commercially w/ attribution. (3) **NO bulk dump** (UKDA SN-852209 has no
files; MySQL/PHP, no API) → scrape the pages. (4) **HARD CONSTRAINT: Cloudflare managed challenge** — every
/lbs/* returns 403 "Just a moment…" to any curl/fetch/WebFetch → must use the Mini's **real Chrome via
`puppeteer.connect()` to :9222** (same FS-climber lifecycle; that's WHY it's Mini-side). Reverse-engineered
the DOM from **Wayback** (not Cloudflare-blocked). (5) Verified model: 4 types `GET /lbs/{claim,estate,
person,firm}/view/{id}`; claim pages carry colony/claim-no/estate/N-enslaved/£-s-d/date/contested +
Associated Individuals w/ ROLES (Awardee/Legatee/Trustee…); person pages carry name/birth-death/occupation/
spouse/children/addresses/per-claim-£-role/typed relationships (kinship edges). Person ids are MIXED
small-int AND large/negative hashes → enumerate by **GRAPH CRAWL** (seed dense claim/estate/firm int space,
follow every link), not sequential walk.
**STEP 1 DONE + VERIFIED (MacBook, uncommitted):** migration **118** (`lbs_crawl_frontier` visited-set/queue
+ `lbs_raw_records` raw-first staging; ext_id TEXT for negative/huge ids) applied+recorded (the HTTP
migration-runner is blocked by a PRE-EXISTING checksum mismatch on 090 — unrelated, someone edited an
applied migration — so applied 118 via TCP pg + recorded w/ matching sha256). `scripts/seed-ucl-lbs-
frontier.mjs` (idempotent, ON CONFLICT=visited-set, fail-loud on missing DATABASE_URL) **seeded 73,000
queued rows** (46k claim + 25k estate + 2k firm). Progress = `SELECT status,count(*) FROM lbs_crawl_frontier
GROUP BY 1` (DB-is-truth). **STEP 2 BUILT (MacBook, uncommitted; syntax+deps+schema verified, awaits LIVE Mini proof):**
`scripts/scrapers/ucl-lbs-crawler.mjs` — Stage-1 crawl+archive ONLY (raw-first; no parsing). Drives the
Mini's real Chrome via `puppeteer.connect()` :9222 + puppeteer-extra STEALTH (same FS-climber lifecycle);
Cloudflare-challenge detector w/ auto-solve wait + exponential backoff; atomic frontier claim
(`FOR UPDATE SKIP LOCKED`); archives HTML→S3 (`sources/ucl-lbs/{type}/{id}.html`, bucket reparations-them
verified enabled) + `lbs_raw_records`; ONE `source_artifacts('ucl-lbs', CC BY-NC-SA)` row reused by all
pages; graph-expands every `/lbs/{type}/view/{id}` link into the frontier (ON CONFLICT=visited-set);
`disconnect()` NOT close (leaves Mini Chrome up); ntfy on block; pauses after 3 consecutive blocks.
Flags: `--once <type> <id>`, `--limit N`, `--no-s3`, `--no-expand`, `--delay`, `--stale-min`.
**LIVE-TEST VERDICT (2026-07-04): the live-site CDP crawler is BLOCKED — Cloudflare TURNSTILE refuses the
attached browser, grants NO durable cf_clearance (only a 1-shot token + __cf_bm), re-challenges every nav
(repeated VNC solves never persisted). FlareSolverr ruled out (can't clear Turnstile). → PIVOTED to
Wayback + data request (user choice). Live crawler PARKED (kept for a future non-Cloudflare route).**
**WAYBACK PATH BUILT + RUNNING (autonomous, no Chrome):** M119 (`wayback_ts` col) + `scripts/scrapers/
ucl-lbs-wayback.mjs` (`--enumerate` CDX→frontier, `--fetch` snapshot→S3+staging; plain HTTP, ON CONFLICT
visited-set, politeness+backoff). **Enumerated the archived universe = ~22,190 records: claim 4,796 ·
estate 4,605 · person 12,242 · firm 547.** Full `--fetch` **running unattended on the Mini** (nohup, pid
launched; log `/tmp/lbs-wayback-fetch.log`; ~overnight) → HTML to S3 `sources/ucl-lbs/{type}/{id}.html` +
`lbs_raw_records`. Verified 37+ claims streaming (11KB each, all s3). Progress = `SELECT status,count(*)
FROM lbs_crawl_frontier WHERE wayback_ts IS NOT NULL GROUP BY 1`. **Data request DRAFTED** (`research/
ucl-lbs-data-request.md`) — the complete/authoritative route (CC BY-NC-SA, UKDA SN-852209); a granted
dump supersedes Wayback via the same parser.
**STEP 3 — PARSER DONE + VERIFIED (29/29, MacBook, uncommitted).** `src/services/lbs/lbs-parser.js`
(PURE, cheerio; `parseLbs(urlType, html)` dispatch). Also HARDENED the Wayback enumerate to prefer the
NEWEST 200-capture (dropped `collapse=urlkey` which kept the OLDEST/stale DOM; ON CONFLICT GREATEST-ts +
re-queue on a newer capture). Re-enumerated → captures now skew 2024-2026 (12,505 rows at 2025). 4
fixtures `tests/fixtures/ucl-lbs/{claim,person,estate,firm}-*.html` (2024-2026 captures) + `tests/unit/
test-ucl-lbs-parser.js`. VERIFIED extraction: **claim** → colony/claimNo/contested/year/enslavedCount/
£compensation(pounds+decimal)/individuals[personId+role incl. "(Mortgagee)" detail]/estates[]/notes;
**person** → name/absentee/occupation/spouse/children/school/university/birth-death/associated-claims
[£+role]/relationships[typed kinship+otherPersonId]/addresses; **estate** → name/colony/parish/
registrations[year,total,F,M,possessor time-series]/claims/people; **firm** → name/people[role+personId].
DOM grammar captured in the parser header (label:value=`table.full.table` strong/div; assoc lists=
`td.header` w/ `.highlight` role; firm=`.label`; estate reg rows scanned globally by `(Tot)` signature).
Corpus fetch RE-RUNNING on Mini (pid, /tmp/lbs-wayback-fetch.log) w/ the newest-capture script.
**STEP 5 — INGEST DONE + VERIFIED end-to-end (MacBook, uncommitted; on Mini too).** Migration **120**
(typed tables: `lbs_claims`, `lbs_claim_persons`, `lbs_estates`, `lbs_estate_registrations`, `lbs_firms`,
`lbs_firm_people`) applied. `scripts/ingest-ucl-lbs.mjs` — 3 modes `--parse` (S3 HTML→`parsed` JSONB via
presigned-url fetch), `--promote` (JSONB→typed+spine), `--fixtures` (offline test); dry-run default,
`--apply` writes. **Decision: NOT slave_economy_benchmarks** — that's for CITED jurisdiction aggregates;
per-claim/estate counts would double-count, so they live in the typed tables + a per-colony control-total
TRIPWIRE logs SUM(enslaved_count)/claim-count (rule #2; full BPP compare = follow-up once BPP colony
totals loaded). Persons→`PersonService.findOrCreateLead` (full attrs, `id_system='ucl_lbs_person'`,
gated secondary 0.85; `personType='enslaver'` ONLY if ≥1 associated claim else 'unknown' — #96 no
over-typing); idempotent via a person_external_ids pre-check (resolve() ext tier-1 only sees canonicals);
enslaved COUNTS stay integers (no placeholder persons, audit #5); comp £ = dual-ledger debt (audit #3,
as-transcribed not summed). **VERIFIED on 4 fixtures --apply:** lbs_claims Grenada 770 £6212.01/206-
enslaved/contested; 3 Hankey awardees `is_awardee` role "Awardee (Mortgagee)" linked to leads; estate
1817-1823 M/F series; firm 5/5 linked; Lennard lead `enslaver`+occupation ctx+ext-id; **re-run
idempotent (0 created, 13 ext-ids stable).** Parser+ingest scp'd to Mini (cheerio present). Corpus fetch
~20% (done 4,366 / queued 17,721) still running on Mini.
**STEP 6 — AUTONOMY DONE + LIVE on the Mini.** `scripts/lbs-drip.mjs` = one idempotent/resumable tick:
(1) SELF-HEAL fetch (relaunch detached `ucl-lbs-wayback --fetch` if queued>0 & no fetch proc; reclaim
stale 'fetching'); (2) PARSE bounded batch (S3→JSONB, `--parse-batch` default 3000); (3) PROMOTE all
parsed (person→estate→claim→firm); (4) status + ntfy on error / on DRAIN. Lock file (stale>2h override),
DB-is-truth. **Cron INSTALLED on Mini: `0 */2 * * *` → `/usr/local/bin/node scripts/lbs-drip.mjs >>
/tmp/lbs-drip.log`** (node v20.20.1; verified cron-BARE-env loads .env DATABASE_URL + has global fetch).
**Validated on REAL data (not just fixtures):** drip parsed 20 archived Antigua claims (0 errors) →
promoted (lbs_claims 21, Σ£ £23,013, Antigua 1,219 enslaved/20 claims); one full Mini tick launched.
**THE WHOLE PIPELINE IS AUTONOMOUS + LIVE:** nohup fetch draining ~22,190 (was ~4,400 done) + 2-hourly
cron doing parse→promote→self-heal, ntfy on drain. Satisfies the user's "completely autonomous, runs on
Mac Mini" requirement.
**OPTIONAL FOLLOW-UPS (not required for autonomy):** relationships→`canonical_family_edges` producer
(spouse/children JSONB on leads → edges, Biscoe-gated); estate possessor→owner-continuity; BPP colony
totals loaded → full control-total tripwire (currently logs the per-colony surface); send the data-request
email (`research/ucl-lbs-data-request.md`) for the authoritative 100%-coverage dump. **UNCOMMITTED** —
migrations 118/119/120, seed/crawler/wayback/ingest/drip scripts, lbs-parser + test, 4 fixtures, 3 memory
docs. NB the pre-existing 090 checksum mismatch still blocks `apply-migrations.js` (all my migrations
applied via TCP + recorded). Full arc in [[plan-ucl-lbs-scraper]] + [[finding-ucl-lbs-source-and-scraper-research]].

## Genealogical edge-evidence system — the kinship proposition, END-TO-END BUILT (2026-07-03, branch audit/probate-classifier)
User: "how are we establishing when we are confident the FamilySearch 'ancestor' is verifiably the REAL
ancestor… 'unreliable before X date' is not a real standard and holds no space to grow." **The reframe that
drove everything:** the project ALREADY refused the analogous fake standard on the slaveholder side — the
document gate (`standard-canonical-person-and-document-gate.md`) asserts "was a slaveowner" ONLY on a
proposition-specific S3 doc. The KINSHIP proposition ("X is the child of Y") was the one proposition the gate
never covered. Climb edges were pure tree-pointer trust (`slice(0,2)`) + a heuristic-constant "confidence" (0.90
because it came from the tree, not because a document corroborates it). Fix = extend the SAME document-gate
epistemology to the kinship link, tiered exactly like every other claim, earned one record at a time. So
"unreliable before X date" becomes an EMERGENT statistic (deep edges corroborate less because their records are
thinner), never a hardcoded rule. Full arc built + committed this session (5 commits, MacBook-buildable parts
green; the scrape wiring ships untested for the Mini):

1. **Standard `896ef439d`** — `standard-genealogical-edge-evidence.md`. Kinship = a gated claim; per-edge
   evidence tiers onto `canonical_family_edges.evidence_tier` (M066 slot ALREADY EXISTS — `source_document_id`,
   `verified` = the edge twin of M102 `assertable_slaveowner`); kinship document-type table; GPS mapping;
   DAA weakest-link rule. Cross-linked into the gate standard + climb plan Phase B.
2. **DAA chain-of-custody gate `896ef439d`** — `DAAOrchestrator._enforceKinshipGate` + `DAAKinshipGateError`,
   called right after `_enforceProbateGate` (which guards the NODE; this guards every EDGE). Walks each
   slaveholder's `lineage_path_fs_ids`, resolves FS→canonical via `person_external_ids`, requires every
   consecutive edge to have an S3-backed tier-1 `verified` `canonical_family_edges` row; reports the SHALLOWEST
   unproven edge as "lineage unproven at generation N". **AUDIT-only by default** (`DAA_KINSHIP_GATE` !==
   'enforce') so it doesn't brick current DAAs incl. Hopewell before edges carry docs. `test-daa-kinship-gate.js`
   fake-db 7/7.
3. **Classifier `993d497ff`** — `src/services/climb/kinship-source-classifier.js`, PURE. FS source →
   `{documentType, evidenceTier, evidences, parentHint, kinConfidence, verifiedEligible}`. Fixtures in
   `tests/fixtures/fs-sources/`, `test-kinship-source-classifier.js` 11/11.
4. **Edge writer `0dd611dfe`** — `src/services/climb/kinship-edge-writer.js`. Resolve FS→canonical, ensure a
   `person_documents` row, SELECT-first upsert of the `child_of` edge (`person_a_id/b` → M103 trigger syncs
   polymorphic cols). `test-kinship-edge-writer.js` live-DB-rollback 11/11.
5. **Harvest wiring `4f3f721ba`** — `familysearch-ancestor-climber.js` `harvestPersonSources()` behind
   `CLIMB_HARVEST_SOURCES=true`; reads `/tree/person/sources/{fsId}`, classifies, maps parent ROLE→tree
   father/mother FS id, calls the writer; fail-soft + restores details page. **⚠️ WRITTEN, UNTESTED (Mini-only).**

**DECISIONS (resolved, in `plan-fs-source-harvest-for-kinship-edges.md`):** D1 split state-vs-infer —
document-STATED tier-1 (will/death/birth/marriage naming a parent) auto-`verified=true`; census co-residence +
tier-2 stay `verified=false` for /review. D2 write M103-polymorphic edges. D3 conflicting tier-1 parents → both
edges `verified=false` + `notes='kinship_conflict'`, never overwrite (GPS conflict resolution).

**REMAINING before live (both Mini-side, out of the MacBook's lane):** (a) verify the harvest's Sources-tab DOM
SELECTORS against live FS + dry-run one lineage (Hopewell / Nancy Brown `G21N-4JF`); (b) S3-ARCHIVING FOLLOW-UP
— harvest currently passes `s3Key=null` so edges land verified=false (correct tier + citation, feeds /review) but
do NOT auto-lift the gate until FS filmed-image→`S3StorageAdapter` lands (`plan-fs-image-archiving.md`). THEN flip
`DAA_KINSHIP_GATE=enforce` on that lineage. See [[standard-genealogical-edge-evidence]] +
[[plan-fs-source-harvest-for-kinship-edges]].

## Reference-class benchmark layer + SlaveVoyages PAST de-siloing (2026-07-03, branch audit/probate-classifier)
Multi-national slave-population BENCHMARK denominators (calibration #90 reference classes) +
de-siloing the orphaned SlaveVoyages named-enslaved cohort. Origin: user asked whether IPUMS/other-
country aggregates could be voraciously intaken now that a lead table exists.

- **US census benchmark (M113→M114, DONE):** `census_holding_benchmarks` = IPUMS complete-count
  county-year enslaved/free/pop denominators. AGGREGATE layer, NOT persons (no placeholder rows).
  M113 keyed on `stateicp` (household files) was CORRUPT — stateicp is IPUMS-uncertified and
  TRANSPOSES VA↔TN 1810-1840 (VA's ~450k enslaved landed under "Tennessee"); a swap conserves the
  national total so it passed the national gate while per-state strata were 60-200% wrong. Caught by a
  per-state control-total audit; rolled back 1830/1840. **Fix (M114): rebuild on the COUNTY file's
  validated `statefip`** (1840 GA/MD/SC/TN match published 0.0%). LOADED **4,297 county-years, 31
  states, 1790-1840**, national totals within 0.5%. Ingest hardened: per-state corruption tripwire +
  breakdown-absent skip (no false 0s). `scripts/ingest-ipums-census-benchmark.mjs` · `plan-ipums-census-benchmark.md`.
- **Cuba source assessment (6-agent fan-out, 1,062 OCR pages):** the "Cuba book" = John MacGregor,
  *Commercial Statistics* Vol IV (1850) — a macro trade/customs digest, NOT a Cuba monograph (Cuba
  ~50pp; back 2/3 = British East Indies). Person value ~ZERO; macro value REAL — cited la Sagra
  aggregates: 436,495 enslaved (1841), capitalized-enslaved **$41.7M within $507M colonial capital**
  (1830 dual-ledger balance sheet). `assessment-macgregor-cuba-source-and-benchmark-scope.md`.
- **Citation discipline (`reference-benchmark-sources-register.md`):** primary-first for every figure —
  Cuba (la Sagra/censuses 1775-1841), Jamaica 1788 (**TNA CO 137/87**), British+French W.I. 1773-88
  (**Privy Council Slave-Trade Committee minutes** + Necker, via 1790 Almanac), Brazil 1872 (**DGE**).
  Conduits (MacGregor, Jamaican Family Search, Wikipedia) named ONLY where figures enter the class.
  Licensing (JFS no-repost → cite the primary).
- **Issues filed: #116** reference-class benchmark layer (generalized `slave_economy_benchmarks`,
  polity discriminator, aggregates-only); **#117** de-silo the SlaveVoyages PAST cohort.
- **SlaveVoyages PAST de-siloing (#117, Cuba pilot):** `slavevoyages_past_people` = 169,065 named
  enslaved Africans, ALL orphaned (canonical_person_id=0 linked); the thin SV→canonical ingest put
  51,111 names into canonical_persons with `primary_state` NULL, geography stranded in the side table.
  **~9,531 disembarked Havana/Cuba/Matanzas** (african_origins = Havana Mixed Commission liberated
  Africans) = the NUMERATOR inside Cuba's 436,495. Promoter `scripts/promote-slavevoyages-past-to-leads.mjs`
  (M115 back-link cols) routes each via `PersonService.resolve` → link-to-spine or GATED secondary lead.
  **BUG caught by spot-check: externalId=sv_id fired resolve tier-1 (name-blind), and sv_id (African-
  Origins PERSON ids) collides numerically with canonical `slavevoyages` external-ids (voyage ENSLAVER
  ids) → 5,275 enslaved bolted onto enslaver canonicals.** No canonical/external-id mutated (ON CONFLICT
  DO NOTHING); rolled back back-links; **fixed to NAME+location (Biscoe).** 4,256 correct new gated
  leads preserved; re-run landing the rest. Lesson (twin of the stateicp catch): a plausible match rate
  masking systematic corruption — the spot-check gate is why we scale safely.
- **Country coverage scoping:** HAVE US/Cuba/Jamaica/Brazil-1872/BWI-1790/FWI-1770s. NEED (tier-1):
  British 1817-34 Slave Registers + 1834 compensation (denominator + dual-ledger enslaver debt in one),
  Brazil provincial/earlier, Puerto Rico, Suriname. Recaptive sites (Freetown 62k, St Helena) = a
  different reference class.
- **NEW SCRAPE TARGETS (user-supplied, in the register):** (1) **British Caribbean Slave Registers
  1817-1834** (UNESCO Memory of the World; **TNA T 71**, ~700+ vols — Jamaica 249/Barbados 37/Grenada
  67/Demerara 37/Trinidad/Berbice/Dominica/St Kitts/Bahamas/Bermuda…; Ancestry-digitized). Person-level
  name/sex/age/colour/birthplace(creole|African+ethnic)/occupation/manumission + NAMED ENSLAVERS — the
  Tier-1 target (numerator+denominator+dual-ledger in one). Its own scrape. (2) **Brazil, Pombos
  (Pernambuco) slave deeds 1863-1890** (FamilySearch DGS **4144740**, film 1532441 Item 2; notarial
  registrations) → chattel-transfer records for `chattel_transfer_events`. Its own scrape.

---

## Review pipeline SHORED UP + backlog roadmap (2026-07-02, branch audit/probate-classifier)
**Review pipeline — all fail-loud now, merged to main/Render:** #106 auth VALIDATES token (verifyAndActivate
via /api/admin/verify; bad token → "✗ rejected"); #108 review.html api() THROWS on any non-OK (killed the
false-"✓"/card-vanish-but-nothing-persists bug); #109 cross-source Link 42P08 (cast $2::text in assignment+concat);
#110 ambiguous approve/reject 42P08 (separate concat param); **#111 PersonService.merge** — SAVEPOINT-before +
ROLLBACK-TO (was SAVEPOINT-after-abort = "current transaction is aborted" 500) AND handles unique OR CHECK
constraint (dedup_pair_order self-pair) by row-by-row delete-on-collision. Merge primitive now works for real dupes.
**Running:** `merge-climb-duplicate-clusters.mjs --apply` (folds 363 anchored climb re-import clusters / ~649 dupes,
person_merge_log; resumable/idempotent) + doc-embed drip (~15%).
**BACKLOG ROADMAP (workflow wf_a3ff131b-1f2, 12 areas scoped, full in task w2agk9xpx.output):**
QUICK WINS (DB-only, dry-run-first): QW-1 segment-probate-v2 over all rolls; QW-2 over-consolidation READ-only audit
(574 clusters: 4,369 cross-role, 267 null-state, rest Trask-absentee/human); QW-3 inheritance asset-detail backfill
(~178 monetary+342 enslaved+390 heir, feeds land); QW-4 enslaved-lead confidence scoring (replace flat 0.85);
QW-5 Ellison rootsweb triage (260 leads). BIG BETS (dep order): BB-1 land-bequest→land_transfer_events (NORTH STAR,
M038/M067 schema built, grantee=0); BB-2 non-enslaver producer (#96 enables); BB-3 forensic scaling (roll claim-lock);
BB-4 #63 approach B (new enslaved_candidate_pairs table, name+county block); BB-5 dedup clustering UI; BB-6 RAG adoption
(Tailscale Funnel topology); BB-7 forward descendancy (blocked on identity fingerprint); BB-8 #55/#100 producers.
QUICK WINS DONE: QW-2 ✅ (5,697 cross-role false links unwound, #105, reversible); QW-4 ✅ (`score-enslaved-lead-confidence.mjs`
— 2,663 re-scored: 869 OCR/secondary→0.72, flagged santos→0.75, junk→0.30; 9,479 scholarly santos correctly KEPT 0.85 —
dry-run caught an 11,887-row over-penalization of Brazilian mononyms); QW-5 ✅ (`triage-ellison-rootsweb-leads.js` — 13
fragments rejected, 97→reviewing; Ellisons kept). QW-3 APPLYING in bg (`backfill-inheritance-asset-detail-from-probate.mjs`
— 725 testators, 426 candidate asset edges from probate_estate_extractions per-heir JSONB; AUDIT RULE #1: never sums values
(count-not-sum, value NULL when >1 valued item collapses); Biscoe: skip if heir not a single canonical (heir_id NOT NULL);
SLOW — resolveHeir ILIKE full-scan). QW-1 (segment sweep) DEFERRED — collision risk w/ live Mini drip, needs roll claim-lock.
Climb-merge DONE (648 folds). Review-pipeline PRs #106/#108/#109/#110/#111 merged. #68/#69/#95/#99 CLOSED; #105 partially executed (QW-2).
QW-3 APPLIED: inheritance_edges typed 3→96, valued 0→20 (108 from-probate; 272 skipped fail-closed).
**BB-1 PIVOTED to a DEED/parcel spine** (user Q "how would parcels even be IDed?" — a WILL bequest isn't parcel-identifying;
a DEED carries a recorded legal description + liber/folio, traceable via county grantor-grantee index). DONE: migration 112
`properties` parcel anchor (legal_description/lot/block/subdivision/liber_folio/metes_and_bounds + nullable modern_parcel_apn/
geometry) + wired the dangling land_transfer_events.property_id FK; anchored the 1 real deed (Biscoe 1858 DC Lots 47&48
Holmead's addition + Liber J.A.S.104 f.124-128). `build-inheritance-land-transfers.mjs` = heirship-PROVENANCE producer, NOT
applied (wills feed heirship graph not parcels; 7 vague will land-bequests). NEXT for the parcel spine: deed legal-description
parser at scale (deed corpus THIN — 1 row now), county grantor-grantee forward-trace (manual/browser/Mini), metes-and-bounds→
modern APN georeferencing. Remaining big bets: BB-2 non-enslaver producer, BB-3 forensic scaling, BB-4 #63 cross-source,
BB-5 dedup-clustering UI, BB-6 RAG adoption, BB-7 forward descendancy. QW-1 (segment sweep) still deferred (Mini collision).

---

## #96 person_type false binary → status-as-facts — P0–P3 core DONE (2026-07-02) → [[plan-96-person-status-model]]
Triggered by the William Ellison reframe (born enslaved → major SC slaveholder; the binary can't
hold him). Full design + two research findings in the plan doc. Executed, tested, committed on
`audit/probate-classifier-and-source-documents` (paused before P4):
- **P0 `723d5d8cc`** — new `src/services/person-roles.js` (owner/enslaved/descendant GROUPS +
  roleGroup/isOwnerType); DAA owner universe (`DAAOrchestrator` step 2b) routed through it so
  `free_poc_slaveholder`/`slaveholder`/`owner` are no longer dropped from obligations. 9/9.
- **P1 `36b8fe507`** (migration 110) — soft CHECK guardrail on `person_type` (both tables); free-text
  column can no longer take junk values. Applied NOT VALID→VALIDATE (live-scraper-safe; 3.1M passed).
- **P2 `36b8fe507`** — status modeled as time-bounded evidenced FACTS in `person_facts` (not the enum).
  `scripts/backfill-status-facts.mjs` seeded the validation cohort: 122 DC certificate_of_freedom →
  `free_status`, 7 NY testators → dated `slaveholding`. Grounded + idempotent.
- **P3 core `ef2bbd9a2`** (migration 111) — `person_role_group()` SQL fn (mirror of person-roles.js);
  `reconcile-lineage-obligations.js` DEBIT ledger now scopes on `person_role_group='owner'` (debit-side
  twin of the P0 fix); `scripts/derive-dual-status-summary.mjs` upgrades a canonical with BOTH a
  slaveholding fact AND a free/enslaved-status fact → `free_poc_slaveholder` (0 real candidates yet —
  cohorts disjoint; forward machinery). 7/7.
- **Decision-3 research (foundational):** the obligation model is ALREADY directed party→party and
  NEVER nets a person's credit against their debit (separate tables/keys; explicit in migration 083).
  A dual-status Ellison → two separate directed obligations, never a blend. #96 preserves this (no
  per-person status balance). **Decision-2 research:** lead-capable person_facts = M103 polymorphic
  mirror, but GATED on a 3-part safety net (cascade-on-delete trigger, `migrateLeadFacts()`, extend
  `PersonService.merge` for polymorphic cols) that must land atomically — person_facts has NO readers
  yet, so the schema change is cheap.
- **REMAINING (not started):** **P4** lead-capable person_facts (the heavy one — safety net above);
  **P3 tail** route the 2 stored SQL matcher fns (M033/M035) + `DocumentVerifier.js:239` + contribute
  search filters through `person_role_group()` (behavior-changing — needs tests + a quiet window);
  **P5** deprecate empty `free_persons` + surface facts/dual-status on the profile UI. **Separate issue
  to file:** `USE_LINE_ITEM_METHODOLOGY` labels the acknowledger's CREDIT line-items as "debt"
  (`DAAOrchestrator.js:242-245`) — directional mismatch, dormant in prod.
- **#95 gate follow-up carried:** the earlier role-aware gate recompute is applied + idempotent
  (34,586 slaveowner / 122 enslaved / 1 dual-status); `#95` closed + annotated (commit `13f359950`,
  which was mislabeled `fix(#70)` by a shared-index race — content intact). Mini deploy verified
  byte-identical to git (scp stopgap per standard-deployment-and-versioning).
- **Watch-out:** intermittent CONCURRENT commits observed on this branch (e.g. `9f7d2b947`,
  `793b1b310`) — a parallel session/user. My commits are clean + correctly labeled; coordinate before
  large edits to avoid the shared-git-index race that absorbed the #95 commit.

---

## Review-UX + data-quality cluster + issue triage (2026-07-01/02, branch audit/probate-classifier)
Continuation. Human-review made usable + a data-quality sweep; GitHub issues 78→69 open.
- **Review UX (merged to main → Render live):** View PDF now uses a PRESIGNED url (raw private-S3 link
  was 403); "Unlinked Wills" queue scoped to will-like docs + placeholder-testator filter (175K→4,710
  linkable; the rest were "Image NNN" NY-probate failed-extraction); **inline "🔍 inspect"** on
  cross-source cards (fetches /api/contribute/person/:id same-origin, admin token bypasses gate) so a
  reviewer sees both records before linking. NOTE: /review is served by RENDER
  (reparations-platform.onrender.com/review), NOT github.io; requireAdmin returns 401 not 403.
- **Bulk auto-link:** the cross-source enslaver `auto_link_candidate` tier (single-match, exact
  name+state+county — mostly same-1860-schedule owner recorded per enslaved person) forced humans to
  click thousands of obvious matches. `scripts/bulk-link-auto-enslaver-candidates.mjs` linked **5,743**;
  queue 10,902→5,159 (ambiguous 'review' tier only). Resolver now AUTO-APPLIES that tier on --apply so
  it never recurs. Reversible (clear confirmed_individual_id).
- **DATA-QUALITY CLUSTER (closed #95/#68/#69/#99):** **#95** recomputeGate is now ROLE-AWARE
  (OWNER_NAMED/OWNER_CONTENT + ENSLAVED_NAMED/ENSLAVED_CONTENT; a shared doc type asserts a proposition
  only when the person's ROLE is corroborated in the estate graph) — recompute removed **7,509 false
  "was enslaved" assertions**, both-flags 7,510→1, ~6,446 unsupported slaveowner assertions cleared. The
  durable fix for the "rampant errors" concern: junk can no longer be externally assertable. **#68/#69**
  `scripts/clean-ny-probate-enslaved-flags.mjs` cleared 8 false + quarantined 201 post-1827 enslaved_count
  docs (NY abolished slavery 1827; originals in error_text). **#99** `scripts/flag-junk-enslaver-entities.mjs`
  reclassified 37 place-word/boilerplate junk (Sole/Albany/Deceased/Image...) enslaver→unknown + de-asserted.
  **#70 PARTIAL (open):** flagged 1,267 clear OCR/legal-junk enslaved names, but wrong-token noise +
  uniform-0.85 confidence need an EXTRACTOR fix. **#100 PARTIAL (open):** 260 leads from ONE Ellison
  rootsweb page — the Ellison family (William Ellison, free Black slaveholder, Sumter SC) is REAL → needs
  parser segmentation + careful triage, NOT a blanket sweep. **Triage also closed** #36/#48/#67/#83/#97
  (already-done). Still genuinely open: research (#19-25), calibration/anchors (#79-90), de-siloing edges
  (#71-78), #70/#100 extractor+parser work.

## NY probate exhaustive validity audit (2026-07-01) → see [[finding-ny-probate-audit-jul01]]
Read-only audit of the live NY scrape (collection 1920234, now 71,944 written) via new
`scripts/audit-ny-probate-quality.js`. Acquisition is excellent (S3 100%, OCR 95%, 0
count/extraction mismatch). Three NEW high-severity findings: (1) **gate over-assertion** —
4,910/5,301 NY testators are `assertable_slaveowner` AND `assertable_enslaved` simultaneously
but only 9 have enslaved evidence (recomputeGate keys off doc-type not proposition → violates
the canonical/document-gate STANDARD); (2) **junk enslavers** — "Albany"/"New York"/"Sole"/
"Deceased" minted person_type=enslaver + assertable; (3) **#67 year-extraction REGRESSING live**
(newest week 93.3% NULL — the Mini runs a stale pre-#67 scraper). Known #68/#69/#70 re-measured
(smaller than feared, still open). Structural: **89% doc orphan rate** + **person-lead PARITY
deficiency** (user's concern, CONFIRMED) — only enslaver/enslaved/heir roles built; DB-wide
97%+ of persons are perpetrator/victim classes, connective free-person tissue under-built.
Forensic financial extraction has reached only 1 of ~176 NY rolls. Fix order in the finding.

### #95 gate over-assertion — FIXED + APPLIED + VERIFIED (2026-07-01)
Root cause: `PersonService.recomputeGate` set each flag from `document_type` membership only, and
`will`/`estate_inventory`/`bill_of_sale`/`correspondence` are in BOTH proposition lists → any
stored will flipped both. Fix (role-aware, #95): partitioned DOC_PROP into OWNER_NAMED / OWNER_CONTENT
/ ENSLAVED_NAMED / ENSLAVED_CONTENT + shared SQL predicate builders (`assertableSlaveownerSQL` /
`assertableEnslavedSQL`, exported). *_NAMED types assert on linkage; *_CONTENT (probate) types
assert ONLY when the person's ROLE is corroborated in the estate graph — slaveowner: owner in
`enslaved_owner_relationships` OR a linked probate doc `enslaved_count>0`; enslaved: enslaved SUBJECT
in eor, NEVER the will's owner-linked testator. Enumeration (unnamed count) supports the OWNER's
flag, never an individual "was enslaved". **Applied (idempotent, +0/-0 on re-run): assertable
`slaveowner 41,034→34,588`, `enslaved 7,631→122`, `both 7,510→1`** (the surviving both = Ann E. Jones
MD, certificate_of_freedom + compensation petition = genuine dual-status). Health audit
`gate_assert_without_doc`=**0 critical**. Migration **109** indexed `probate_scrape_progress.person_document_id`
(the role predicate join; was unindexed → hung the recompute). Regression **`tests/unit/test-gate-role-aware.js`
14/14** incl. the Ellison dual-status fixture (slave_schedule + certificate_of_freedom → BOTH; a
mutual-exclusion fix would have erased him) + enumeration≠named. Files (UNCOMMITTED): PersonService.js,
recompute-assertion-gates.mjs, retrieval-health-audit.mjs (role-aware), migration 109, the test.
**DEPLOY GAP (like #67):** the Mini's scraper promotes via OLD coarse PersonService → new promotions
re-introduce over-assertions (visible as ~2 stale-lift drift); scp PersonService.js to the Mini +
it takes effect on next scraper restart. **Ellison reframe (complicated the whole audit):** he's NOT
absent — present as ≥3 unlinked clusters (`William Ellerson`+sons in the 1860 Sumter District SC slave
schedule as enslaver leads; 35 shredded `unknown` leads from the rootsweb graveyard page #100;
enslaved origin "April" nowhere), none canonical, `free_persons` empty. Refuted my "both flags
impossible" premise — dual status is VALID; a mutual-exclusion fix would ERASE Ellison-class people.

**Filed issues #95–#101** (A–G): #95 recomputeGate over-assertion (critical), #96 person_type
false binary (high/design), #97 #67-regression, #98 cross-source identity (Ellerson↔Ellison),
#99 junk enslaver entities, #100 rootsweb narrative-parser shredding, #101 #68/#69/#70.
**Ellison reframe:** he's NOT absent — present as ≥3 unlinked clusters (`William Ellerson`+sons
in 1860 slave schedule Sumter District SC; 35 shredded leads from the rootsweb graveyard page;
enslaved origin "April" nowhere), none canonical, `free_persons` table empty. Refutes my "both
assertable flags impossible" premise — dual status (born enslaved → major slaveowner) is VALID;
the gate bug is proposition-specificity, and a mutual-exclusion fix would ERASE Ellison-class
people. **#97 EXECUTED (data side):** ran `backfill-probate-document-year.mjs --prefix
new-york-probate- --apply` → 12,811 NULL→year, 0 regressions, NY year-NULL 54.2%→36.8%; NULLed
234 impossible >1971 (microfilm-stamp) years. **Mini deploy DONE (staged):** confirmed Mini ran
stale `18\d{2}` scraper (proof of the live regression); backed up + scp'd the fixed
georgia-probate-scraper.js + probate-extractor.js (`1[6-9]\d{2}`, syntax OK). **RESTART DONE
(controlled, user standing by on VNC/ntfy):** killed pid 98915 → re-captured a FRESH cookie jar
from the live logged-in Chrome (59 FS cookies, fssessionid present — the KEY step that prevents
the Jun-23 stale-jar index-wall clobber; the on-Mini jar was 8d stale from Jun 23) → reset
watchdog → relaunched pid 42233 on the fixed code. Verified authed + healthy: reading per-roll
Image-1 ARKs (index endpoint authed), direct-jump RESUME working, 0 SESSION LOST, NO VNC re-login
needed. Scraper now derives years at scrape-time. Restart RECIPE that avoids the wall: re-capture
the jar from live Chrome BEFORE relaunch (don't let the stale file inject). Follow-up on #97:
generic per-collection max-year clamp (currentYear guard won't catch 1972–1998 microfilm stamps).

---

## A/B/C refactor merged + identity spine completed (2026-07-01, branch audit/probate-classifier)
Continuation of the reckoning ([[reckoning-retrieval-epistemology-and-workaround-debt]]). Executed A→B→C:
- **A — PersonService is now the ONE door: ALL 7/7 live bypass writers routed** (ExtractionWorker,
  Orchestrator, NameResolver, wills.js, review.js, contribute.js, and **door 7 the climb** — closed Jul 1,
  commit 007141de3, inline blocking keys via a neon-`sql` adapter). No identity born a silo anymore.
- **B — deploy/versioning:** frontend bakes git SHA + `version.json` + `VersionGate` stale-client banner
  (deployed to gh-pages-react); "Mini runs from git not scp" → [[standard-deployment-and-versioning]].
- **C — fail-loud:** embed runners warn on implicit EMBED_SOURCE + preflight-abort on a dead/capped provider.
- **Merged to main:** PR #94 (Phase 2 RAG) + PR #93 (A/B/C). Render backend auto-deployed + verified healthy.
  ADMIN_TOKEN rotated (Render + local .env). Frontend live.
- **IDENTITY SPINE (the D item) — foundation DONE.** The old `identity_fingerprint` plan is SUPERSEDED by
  blocking keys. Built `scripts/backfill-unconfirmed-blocking-keys.mjs` (retry + START_ID resume) →
  **lead keying 0.13% → 99.9%** (2.43M leads, ~5.0M keys). `person_blocking_keys` = **10.88M rows**;
  whole ~3.25M-subject pool now dedup-visible. **Dedup dry-run finding:** naive key-clustering is NOT a
  dedup tool — clusters are dominated by DISTINCT same-name people (common first names, French compound
  given names, `no name` placeholders); true duplication is LOW; Biscoe holds. See
  [[plan-identity-resolution-completion]]. NEXT (in progress): re-run the SCORED resolver over newly-keyed
  leads → real candidates into /review; extend placeholder-name exclusion to canonicals; deprecate
  identity_fingerprint. Debt registry parks: enslaved_individuals migrate-vs-deprecate, broken PM2 worker.

## Phase 2 RAG live + RECKONING on workaround-debt (2026-06-30, branch audit/probate-classifier)
Parallel thread to Session 69. Two things:
- **Phase 2 RAG validated + self-hosted.** Switched the embedding space from Gemini (hard 1,000/day
  free-tier cap — infeasible for 77K+678K) to **self-hosted ollama `nomic-embed-text` on the Mini**
  (free, no cap, ~15 docs/min real / ~104/min short). Gotcha: ollama 0.24.0 **wedges under concurrency
  → CONC=1**; `EMBED_SOURCE=ollama` is REQUIRED or it silently falls back to the capped Gemini.
  Retrieval + full grounded query VALIDATED in nomic space (Mikell inventory → cited enslaved persons +
  values). Doc→person embed drip chained + unattended on the Mini (~1 week). Public `/api/rag/query`
  DEFERRED until the corpus fills. Detail: [[plan-phase2-rag]]. Also: today's "search shows nothing"
  crisis was a **stale GitHub Pages cache** (hard-refresh fixed it) — NOT a code bug.
- **RECKONING written** ([[reckoning-retrieval-epistemology-and-workaround-debt]]): user asked why we ran
  keyword search without RAG, what else we're papering over, and whether downstream-aware refactoring is
  overdue. Answer: retrieval was built as UI (ILIKE) not epistemology; the recurring pattern is corrective
  layers over root causes (climb-as-second-door, the gate, blocking-keys-vs-broken-spine, silent config
  fallbacks, scp-deploys from a dirty Mini checkout, data quarantines). Refactoring IS overdue in named
  places — finish PersonService as the ONE door (A), deploy/versioning discipline (B), fail-loud config
  (C), pay down the identity spine before more ingest (D), keep a debt registry (E). READ that file.

## Climb-as-gated-lead-source + contamination audit (2026-06-30, Session 69)
Building Adrian Brown lineage worksheets, the user caught the climb asserting slaveholding it
can't stand behind (Elizabeth Parker, NJ d.1793, marked an 1860 Georgia slaveholder via a
name-only doc link). Root issue is ARCHITECTURAL: the climb is a second, uncontrolled door —
it scrapes FamilySearch's raw collaborative tree and bypasses identity resolution, the
canonical/document gate, and source-tier classification.
- **Worksheet fixed:** ⚖ confirmations now source ONLY from the verified layer
  (`enslaver_evidence_compendium` direct_primary) by resolved identity — 4 real (Biscoe×2,
  Hopewell×2), not the 106 name-match false-positives. Lineage tree audited
  (`scripts/audit-lineages.mjs`): 86% of connected ancestors born pre-1700, 96% of lines
  SPECULATIVE (FamilySearch deep-graft); worksheet now grades SOLID/MODERATE/SPECULATIVE.
- **DAA is PROTECTED:** `_enforceProbateGate` blocks any DAA whose slaveholders don't resolve
  to a canonical with TIER A/B/C evidence; the name-only climb-match fallback (null ids) can't
  pass. Exposure is research/UI surfaces + the identity store, not the instrument.
- **Existing tooling reconciled:** `audit-climb-contamination.js` / `rescan-climb-matches.js`
  / `re-evaluate-matches.js` / `clean-climb-match-data-quality.mjs` already implement most of
  the filter — never run/wired. Climber cutoff already fixed in code (1450→1600); contaminated
  data is pre-fix. Dry-run quantified: 9,730 modern canonicals + 316,938 FS-URL "documents" +
  20 false enslavers → **GitHub issue #92** (sequence into de-siloing Step 4).
- **New memory-bank docs:** `assessment-climb-architecture-gap-jun30.md`,
  `plan-climb-as-gated-lead-source.md`, `finding-census-namematch-falsepositives-jun30.md`,
  `note-climb-resolution-producer-jun27.md`.

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
- **#3 DONE (de-silo at scale):** `scripts/backfill-orphan-canonical-keys.mjs` keyed the 174,732
  orphaned canonicals (81% first-name-only Hall/LA/SV imports the surname-only populator couldn't key)
  with the `_queryKeys` scheme (nmsx/nmsxb + surname keys, cap 64) → **174,732 → 8 remaining** (the 8
  have no usable name). They now answer resolve()/find_person_match.
- **#2 DONE (continuous harness):** made `retrieval-health-audit.mjs` self-contained (inline DOC_PROP
  fallback, robust S3 via objectExists, self-contained ntfy on critical/high), deployed to the Mini,
  and added a **cron `0 */6 * * *`** (`--s3 --s3-sample 300`, logs `/tmp/retrieval-health.log`, ntfy
  via OPS_NOTIFY_WEBHOOK). Verified on the Mini: gate sound, S3 200/200, ledger written, ntfy sent.
- **#1 DEPLOYED + VERIFIED LIVE (Jun 30):** pushed `main` (fast-forward `ae15828fd..4b237fbb8`) →
  render auto-deployed the backend; redeployed the frontend from main. **Gate VERIFIED live in prod:**
  the render backend returns `{gated:true, gatedMessage}` for a gated canonical (Edwin Cowles
  /person/826229?table=canonical_persons). The 94% public-search visibility flip + the whole
  de-siloing+gate program are LIVE. Added CLAUDE.md RULE 0 (re-read memory bank before anything, per
  user) on main's project-doc (kept, not the erased rules-file). **STILL USER ACTION: set `ADMIN_TOKEN`
  on render** — without it the gate's research/curator bypass is off in prod (`isAdmin`=false for all);
  public gating works, but the team can't see gated persons via the API to curate until it's set.
  NOTE: `/person/:id` without a `table` param checks unconfirmed first → for an id that's both a lead
  and a canonical it returns the (un-gated) lead; the frontend always passes table=canonical_persons,
  so the public UI is correctly gated. (Detail of the pre-deploy merge below.)
- **#1 MERGE RESOLVED (pre-deploy detail):** merged `origin/main` (9 divergent commits — primary/
  secondary doc classification, inheritance_edges→cfe bridge, wills dedup fixes) into the branch. The
  `ort` strategy auto-resolved ALL 11 overlapping files (incl. contribute.js, PersonProfile.jsx) with
  NO conflicts. Verified: both sides survived (gate `canonicalGateClause` + main doc-tier refs both in
  contribute.js), syntax OK, harness gate GREEN post-merge, frontend builds. Merge commit pushed to the
  BRANCH (not main). **GO-LIVE CHECKLIST (user):** (1) decide on `CLAUDE.md` — main re-created it; user
  had erased it ("no parallel rule surface") — surfaced, NOT re-erased unilaterally; (2) set
  `ADMIN_TOKEN` on render (else the gate's research/curator bypass is off in prod — public gating still
  works); (3) confirm render auto-deploys on push to `main`; (4) final go → push `main` (the 94% public
  visibility flip + backend gate go live).
- **Phase-2 (later):** pgvector RAG + retrieval-feedback loop.

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

---

## SESSION CLOSE 2026-08-11 — eight issues filed for what was touched and not resolved
→ [[finding-duplication-interoperability-retrievability-aug10]] · [[standard-targeted-harvesting]] ·
[[finding-chunk-sweep-timeout-and-amelia-image-backing-aug09]]

**Landed:** Farm Book extracted (445 leads / 169 edges / 445 embedded) + Stage 5 reconciler (157 mentions
resolved, 281 name-ambiguous REFUSED) · Amelia 23 scans archived S3+Wayback, **10/10 harm_events
image-backed**, 14 kin edges graded per informant · Shepherd chain graded per link (Pannon documented;
Fisher recorded as searched-and-not-found) · 22 letter↔1860-schedule corroboration pairs seeded at priority
10 · **research_findings 1,173/1,173 embedded — "what did we already fail to find" is now answerable** ·
7,053 canonicals reclassified enslaver→unknown (typed by a DEFAULT VALUE) · Mini SSH restored (it was a
passphrase-protected local key, never the server) · chunk sweep fixed + supervised.

**OPEN — filed, do not re-derive:**
| # | |
|---|---|
| #149 | 249 estates naming enslaved people not on the spine — **Moses S. Jones, 85 people, 1855** |
| #150 | Obligation ledger: schema, zero entries; `extraction_mechanism` 0/19 |
| #151 | Embed the verbs: 49k transfers; 46% of canonicals have no embedding path |
| #152 | Interoperability: transfers can't reference leads; ~8k docs under the wrong state |
| #153 | Amelia: ~10 harms never ingested; scans have no OCR text |
| #154 | Duplicate pipelines; Hemings pages (p.139) still unparsed |
| #155 | Ops fragility: ~222 scripts still lack pool error handlers |
| #156 | Targeted harvesting: **Virginia probate is the next harvest** |

**Two corrections worth carrying:** (1) I claimed Albany NY "structurally cannot yield" from the 1827
abolition date — it is the **second-richest county in the corpus** (98 estates, 247 people named); the waste
was Cayuga + Allegany, 1,903 estates for 11 people. (2) I named a schema gap as the blocker for the Shepherd
chain when the real blocker is that **Virginia probate has never been scraped**. Both were arguments made
without looking, and the operator caught both.

---

## 2026-08-19/20 — FABRICATION SWEEP, THE ASSERTION-STORE ANSWER, AND DLAS RECONNAISSANCE
→ [[standard-assertion-store-and-inference-decisions]] · [[standard-targeted-harvesting]] ·
[[finding-duplication-interoperability-retrievability-aug10]]

**FOUR FABRICATION CLASSES FOUND AND FIXED.** Every one was an IMPLICIT INFERENCE no human approved:
| implicit rule | cost | fix |
|---|---|---|
| a probate decedent is an enslaver | 7,053 canonicals | reclassified -> unknown, 279 evidence-backed kept |
| a tally mark is a person | **1,456,640** rows | quarantined `placeholder_aggregate` **+ source patched** |
| family-tree provenance ⇒ maybe alive | 12,562 ancestors hidden | search gated on LIVING STATUS, not provenance |
| a rejected decedent NAME voids the estate | 66 enslaved people invisible | mint gate decoupled; 65 recovered |
Real named enslaved leads after the sweep: **692,197** (was 2,147,162, most of it fiction).

**THE STORAGE ANSWER (operator: "is a table even the best storage at scale?").** No — and `person_facts`
(497,851 rows) already IS the answer: open `fact_type` vocabulary, dates+places, related person, full source
chain, confidence, and **`contested` + `contested_reason`**. DLAS's 127 terms become fact_type VALUES, not
86 tables. My "68% have no home" was WRONG — `manumission`/`escape`/`free_status`/`occupation` were already
in use. Fifth asserted-absence-without-checking of the session. **Three layers: ledger tables for what must
be SUMMED · person_facts for what must be CLAIMED · embeddings for what must be FOUND.**

**FREEDOM IS REVOCABLE** (operator): people were kidnapped, re-enslaved, jailed, bound out. `contested` is
how a `free_status` fact gets revoked with a reason. Used **0 times** so far.

**RETRIEVABILITY.** Verbs embedded: kin edges 7,905 · transfers 48,987 · findings 1,173 · ownership 29,524+
· inheritance · insurance · estates · voyages (Mini) · **person_facts 497,851 (running)**. Proven working:
"who was sold from one enslaver to another in Louisiana in 1789" and "have we already searched for James
Fisher in Powhatan" both return correct top hits.

**YIELD COMPARISON that settles targeting:** NY probate 88,870 pages -> **290** enslaved named (**306
pages/person**) · Liberty Co GA 14,452 pages -> **1,373** (**11 pages/person**) · DLAS 17,487 petitions ->
**~80,000 enslaved**. Collections assembled FOR this question beat general record sets by ~30x-500x.

**DLAS RECONNAISSANCE (steps 1-2 of the O-of-O done).** 127-term controlled vocabulary captured to
`bibliography_sources`. robots.txt permits crawling. **NEXT = STEP 3: sample ~200 petitions across
states/courts/decades and measure which fields actually populate BEFORE writing a person row.**

**OTHER LIVE ITEMS:** 1860 tail (65 locations, FS session re-authed, runner fixed — the old one reported
"ALL STATES DONE" with work remaining because its grep checked the whole log) · Knighten petition #21382436
(Fairfield SC 1824: executor Moses Knighton the younger sold 3 estate slaves "in a secret and fraudulent
manner", court partially granted, hiring values + sale prices in depositions 1812-1826) · two coastwise
manifests archived (#740386 Gold Hunter of BOSTON, #740387 Fashion of NEW YORK — northern vessels; the form
separates SHIPPER from OWNER/CONSIGNEE, which chattel_transfer_events collapses) · issues #149-#158.
