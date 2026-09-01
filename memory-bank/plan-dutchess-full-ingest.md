# PLAN — Full Dutchess County ingest (near-census coverage) — Jul 19 2026

_User directive (2026-07-19): "we need to ingest ALL of Dutchess County." Move from the sampled/targeted
ingest to the COMPLETE Dutchess enslaver + enslaved population, so the reference class = the population
(the calibration premise) and DAAs can be generated for the whole county. Builds on
[[plan-dutchess-calibration-stage1]] · [[assessment-dutchess-calibration-case-study-jul19]] ·
[[finding-land-nonclaim-and-dutchess-audit-jul17]]. Standards: [[standard-external-source-ingest]] ·
[[standard-file-first-document-archival]] · [[standard-canonical-person-and-document-gate]] (RULE 0.6)._

## Why "all of Dutchess" (the premise)
NY's gradual abolition (1799 act → 1827) time-bounds Dutchess enslavement; holdings were small (1–5);
the record chain is unusually continuous. Near-CENSUS coverage of ONE county makes the reference class
the population itself, substituting record-linkage agreement for the 750-participant frame we don't
have. It is also the both-sides corpus a comprehensive county DAA needs.

## What we hold vs what "all" requires
DONE (Phase 0): 1714 census (14 enslavers), 1755 census (195 enslavers / 246 named enslaved / 246
edges, Dutchess+Westchester), colonial-wills SAMPLE (26 image-backed enslaved / 18 edges), NESRI
cross-ref (16 confirmed enslaver-identity verdicts). Census aggregate denominators known (1790: 1,864
enslaved / 43,412 total; 1800: 1,609; 1810: 1,262).
REMAINING for "all": the full NESRI Dutchess roster (2,569 records — we've pulled ~24 families), the
full will corpus (1,225 imaged docs — only 13 extracted), and the church/manumission/court layers.

## EXECUTION LOG (2026-07-19→27, Phase 1 in progress)
- **Dedicated Chrome :9223 LAUNCHED** (`open -na "Google Chrome for Testing" --args
  --remote-debugging-port=9223 --user-data-dir=/tmp/nesri-chrome`) — FS :9222 untouched. Scraper
  hardened: `--browser-url` (default :9223) + `protocolTimeout:240000` (the 30s default was what killed
  long runs). This un-flakes NESRI.
- **BETTER MECHANISM FOUND — NESRI "Download Data" (Caspio CSV export).** The results page has
  `a.cbResultSetDownloadLink` → a native CSV with ALL 38 columns (incl. the genealogy fields). Capture
  via CDP `Page.setDownloadBehavior`. This BEATS card-scraping (no parsing, every field). **BUT Caspio
  caps each export at ~250 rows** — so the full 2,569 needs SLICED searches (each <250) → one CSV each →
  `ingest-nesri-csv.mjs` per slice. Slicing is slow to probe (each NESRI search ~15s w/ reload); a clean
  slice key (≤250/slice covering all Enslaver rows) is still TBD — surname-initial or year are candidates.
- **PARENT-CODE QUESTION DEFINITIVELY CLOSED:** the CSV exposes Parent ID Codes / Enslaved Person
  Family / Sibling ID Codes / Enslaver Genealogical Link as real columns → **0 fill across all 250 rows
  (incl. all 16 Enslaved-Person rows).** NESRI genealogy fields are genuinely EMPTY for Dutchess (not a
  display artifact). Maternal link is NOT in NESRI — baptisms remain the (sparse) maternal layer.
- **`ingest-nesri-csv.mjs` BUILT + batch-1 (250 rows) ingested:** 218 enslaver + 21 enslaved leads
  (id_system 'nesri'), census rows → benchmarks (not persons), site/college skipped. Dedup 0 auto-links
  (Biscoe-conservative — same as census/wills; corroboration is recorded via `nesri-crossref` verdicts
  + carried resolve-candidates, NOT auto-merge). Batch 1 = the alphabetical-first ~250; **remaining
  ~2,300 need the sliced downloads.**
- **CSV→ingest is the pattern going forward:** slice NESRI search under 250 → Download Data CSV →
  `ingest-nesri-csv.mjs <csv> --apply`. Idempotent (externalId = NESRI Enslaver/Enslaved Person Code).

## INFRA PREREQUISITE (do first) — a DEDICATED Chrome
The NESRI 108-page pull degrades on the SHARED FS Chrome (:9222) — protocol timeouts under contention.
Launch a SECOND debug Chrome for NESRI, leaving :9222 for FS/climb:
`open -na "Google Chrome for Testing" --args --remote-debugging-port=9223 --user-data-dir=/tmp/nesri-chrome`
Point the scrapers at `http://127.0.0.1:9223`. (No FS login needed — NESRI is public.) This alone
un-flakes the full pull. Everything else stays local (nomic embed on ollama :11434).

## Phase 1 — FULL NESRI Dutchess roster (2,569 records) — the priority
`scripts/scrapers/nesri-scraper.js` already: submits the Caspio search (county=Dutchess), parses the
38-field results cards by known labels, paginates via the jump-to-page field. HARDEN for a full run:
1. **Dedicated Chrome (:9223)** + retry-on-protocol-timeout + **resumable page cursor** (persist last
   page N to a progress file; the run is 108 pages).
2. Pull all 2,569 → JSONL. Classify by Record Type:
   - **Enslaver** (owner + counts + county + year + source) → enslaver LEAD.
   - **Enslaved Person** (name + owner + year + source) → enslaved LEAD + owner→enslaved edge.
   - **Census** (aggregate counts) → benchmark denominators (`census_holding_benchmarks` / notes), NOT
     person rows (audit rule — no fabricated persons from counts).
   - **Site / Ship** → skip for the person ingest (separate provenance).
3. **Route every person through `PersonService.findOrCreateLead`** — id_system `nesri` (product-
   specific; externalId = NESRI Unique Record Identifier), sourceType secondary, confidence 0.85,
   locations ['Dutchess County, New York']. **DEDUP IS THE PAYOFF:** NESRI enslavers auto-LINK to our
   census/will enslavers (same family) → cross-source corroboration flows into `linkage_verdicts`
   automatically; NESRI enslaved get owner→enslaved edges. Biscoe-safe (no auto-merge on ambiguous).
4. **Rule-8 provenance:** `source_artifacts` per NESRI cohort (the record's own Source Document + the
   NESRI record URL; Wayback the NESRI page). NESRI is rehostable=link-only (scholarly) — record
   wayback_url, S3 optional.
5. **EMBED** (RULE 0.5) — local nomic; NESRI record text as doc_ocr-adjacent OR person_profile (note
   RagService reads doc_ocr — decide per §Phase-4 RAG).
6. Re-run `nesri-crossref-dutchess-enslavers.js` tail (the 4 errored + ~15 unchecked families) → the
   full confirmed enslaver-identity verdict set (expect ~25–35 of ~40).

## Phase 2 — FULL colonial-wills extraction (1,225 imaged docs)
The regex analyzer (`analyze-dutchess-colonial-wills.mjs`) got 26 names from 13 docs — the parsers are
inadequate for the full corpus (known pattern: colonial-book OCR needs agent-grade / DocAI, not regex).
1. Re-extract the 1,225 via **Google DocAI Custom Extractor** (the probate/will processor) OR an
   agent-grade extraction pass — testator + enslaved names + valuations. Expect many more than 26.
2. Ingest via `ingest-dutchess-colonial-wills.mjs` pattern (image-backed leads + edges + doc evidencing).
3. Capture the £-valuations (Kniffen £301) as the wealth-over-time signal → `estate_valuations` (NOT
   `land_transfer_events`, to keep the land-claim path closed per the non-claim guardrail).

## Phase 3 — church / manumission / court layers
- **DRC baptisms** (Rhinebeck Flats, Poughkeepsie, Fishkill, New Hackensack) via FS images + OCR — the
  MATERNAL layer. Sparse + minimally-recorded (assessment §6.4: child often unnamed) — ingest as a
  separately-scored layer, NEVER the calibration backbone. Cross-ref to registrations by owner+date.
- **Manumissions** (NESRI REG/manumission records + Quaker Nine Partners MM 1773–1782).
- **Dutchess County Ancient Documents** (County Clerk, ~167k pages 1721–1840s, digitized) — the deep
  legal layer (bills of sale, wills, guardianships). Large; scope a targeted slavery-token pull.

## Phase 4 — consolidation → promotion → RAG → calibration
1. **Dedup/consolidate** all Dutchess leads (the carried resolve-candidates) — merge multiply-sourced
   families (census × NESRI × will) into single leads; Biscoe (flag/review, never auto-merge ambiguous).
2. **Promote** the image-backed ones to canonical (RULE 0.6: served image + embedded + deduped). Will
   docs qualify (S3 scans); census/NESRI leads stay leads until image-backed.
3. **RAG:** embed the full corpus (local nomic); ensure doc_ocr coverage so it's retrievable.
4. **Calibration:** re-run the cross-source verdict builder on the full population → the confirmed
   verdict set; do the reference-class mass check (town × decade × holding-size) on the near-complete
   population; then the MODERN-ENDPOINT track (below).

## The MODERN endpoint (parallel track — the remaining calibration gap)
Full colonial ingest gives the POPULATION; per-link p on the full modern→enslaver chain still needs
living descendants. Two routes (neither is the ingest): (a) forward tracing from the enslaved seeds
across the post-1827 free-Black community records (church, 1830+ census, directories) — hard but the
right direction; (b) a Dutchess-descended participant (recruitment). Do NOT block the ingest on this.

## Sequencing + effort
1. Dedicated Chrome (:9223) — minutes. 2. Harden + run full NESRI pull (2,569) — ~1 day (108 pages
resumable) + ingest/dedup/embed. 3. Wills DocAI re-extract + ingest — ~2–4 days (extraction is the
cost). 4. Church/manumission/court — weeks (image OCR). 5. Consolidate/promote/calibrate — ongoing.

## Guardrails carried
- **No fabricated persons** from counts (census aggregates → benchmarks, not rows).
- **Land VALUES wealth, never a descendant claim** (migration 125 guardrail + test).
- **Biscoe** dedup (flag, never auto-merge birth-year-less colonial names).
- **Secondary tier 0.85** ceiling on census/NESRI until manuscript originals; wills image-backed but
  OCR-extracted (0.6 + review; known false positives like "Philip Field" flagged not asserted).
- **RULE 0.5/0.6** — every ingest EMBEDs (local nomic); canonical only when image-backed + embedded.
- **NESRI courtesy** — rate-limited, dedicated Chrome; it is a public scholarly project.
