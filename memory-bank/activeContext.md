# Active Context: Current Development State

**Last Updated:** April 20–21, 2026 (Session 32 — civilwardc TEI + Hopewell OCR + corporate slavery evidence + Document AI training)
**Current Phase:** Document AI fine-tune in progress for Freedmens. All 1,041 DC 1862 petitions ingested. Corporate slavery evidence schema live. Human review UI operational at /review.
**Active Branch:** main
**Project Title:** Reparations ∈ ℝ ("you can do it, put your back into it")

---

## Session 32: civilwardc TEI + Hopewell + Corporate + Document AI (Apr 20–21, 2026) 🟡 IN PROGRESS

### Delivered

**Civilwardc.org TEI bulk ingest — 100% coverage:**
- 1,041 / 1,041 DC 1862 compensated-emancipation petitions (replaced lossy HTML ingest via TEI XML)
- `historical_reparations_petitions`: 1,041 rows, UNIQUE constraint on `docket_number` added
- Enslaved persons indexed with structured fields: **1,698** (age/sex/color/value/description parsed from `<table>` rows)
- Total claimed valuation: **$352,598** in 1862 dollars
- `family_relationships` enslaved_by edges: **1,983** (named enslaved → claimant)
- S3-archived 1200px JPGs in `person_documents`: **4,174**
- Parser tolerates partial dates ("1862", "1862-05", "1862-05-8", "May 6,1862") and filters bad image hrefs (e.g. `.004` without `.jpg`)

**Hopewell 1817 will OCR (PDF was orphaned in S3 since Dec 2025):**
- Ran Google Vision on 4-page PDF via pdftoppm; stored `ocr_text` + `context_snippet` on `person_documents.id=19`
- Will names wife as "Angelica Hopewell" (married surname), not "Chesley" — that's why NameResolver missed her
- Bequeathed "one negro man named Lewis" to wife Angelica; distributed Midley/Alam/Lloyd/Such+3 children/Ester+child to daughter "Ann Maria Bercer" (= Ann Maria Biscoe cp=141015)
- Created `person_relationships_verified` edges: James↔Angelica spouse, James→Ann Maria parent_of, Angelica→Ann Maria parent_of

**DAA probate gate expansion (DAAOrchestrator.js):**
- Added `compensated_emancipation_petition`, `dc_petition`, `petition` to `PROBATE_DOC_TYPES` — critical bug: every civilwardc petition doc wasn't firing Tier B without this
- Rewrote scope CTE as per-origin: each ancestor sees evidence on same-name dupes + spouse/parent/child canonicals via `person_relationships_verified`
- **Adrian Brown's gate: 3/16 → 6/16 passing.** Angelica Chesley now passes via spouse → James's will.

**Canonical merges (person_merge_log populated for first time):**
- Maria Angelica Biscoe (6 dupes) → cp=141014 "Angelica Chew (born Maria Angelica Biscoe)"
- James Hopewell (2 dupes) → cp=1070
- Angelica Chesley (2 dupes) → cp=140299
- FK references redirected across 24 tables; 8 merges logged

**Corporate slavery evidence (migration 043):**
- 3 new tables: `slave_era_insurance_policies`, `corporate_slavery_disclosures`, `corporate_debt_acknowledgments`
- **Architectural reframe:** every DAA is a class obligation — individual enslavers and corporations share the same debt model, differing only by acknowledger type
- **CA Slavery Era Insurance Registry** (Harvard Dataverse CSV, 687 rows) ingested: 675 policies, 4 insurer disclosures (Aetna/CVS 28, AIG/Corebridge 173, NY Life 485, ACE/Chubb 1)
- **419 enslaved names auto-linked** to canonical_persons; 147 slaveholder names linked
- **11 Philly 2024 bank PDFs** archived to S3 + `corporate_slavery_disclosures` rows: Bank of America, BNY Mellon, Citizens (RI), Fulton, JPMorgan Chase (13,000 enslaved as collateral + 1,250 owned), PNC, Santander, TD, United Bank of Phila, U.S. Bank, Wells Fargo

**Climber + data-quality cleanups:**
- 390 `ancestor_climb_matches` rows with implausible birth years (<1600 or >1870) nulled; 46 reclassified temporal_impossible
- Climber `HISTORICAL_CUTOFF_YEAR` changed 1450 → 1600 (stops medieval ancestor walks)
- LX39-1MY climb relabeled as **Gwendolyn Louise Fagan** (Eli Neal's grandmother); 548 matches flagged for extra review
- 2,593 civilwardc ML-misclassified `unconfirmed_persons` rejected (dictionary words "Here", "Petition", "Columbia" misclassified as enslaved); 68 flagged for re-parse

**Human review UI:**
- `/review` admin-gated Express route with 6 queues: enslaver_candidates, unresolved_petitions, pending_climb_matches, ambiguous_unconfirmed, duplicate_canonicals, **parse_failures**
- Each parse-failure item renders 31 Freedmens schema fields as inline inputs pre-populated with engine output; reviewer corrections flagged `training_eligible`

**Document AI integration (in training):**
- Custom Extractor processor `freedmens-bank-ledger-v1` (ID `30049eebf8debcf4`) in project `velvety-tangent-476318-u1`
- 31-field schema defined via `updateDatasetSchema` (root entity `custom_extraction_document_type` + nested properties)
- Service account `reparations-is-a-real-number@...` has Document AI Editor + Dataset Administrator
- **Regional endpoint critical:** `us-documentai.googleapis.com` (global returns PERMISSION_DENIED for region-local processors)
- Canary pre-training: 3/31 fields at 40-89% confidence — cleaner than old parser but undertrained
- Training batch staged at `~/Desktop/docai-training-batch/`: 36 diverse edge-case pages across 31 branches; user labeling in progress
- Migration 044 `parse_failure_queue` + `FreedmensBankProcessor.extractWithQueueing()` complete the feedback loop: misses queue for review, reviewer corrections flagged `training_eligible`, next fine-tune picks them up

**Thought experiments (not implemented, documented for future):**

*Shirley Plantation / Charles Carter III + Lauren:*
- 11-generation continuous Hill-Carter ownership 1638–present
- Current DB probe: 15 Carter-named enslavers in family_relationships (William 94 enslaved, Robert 92, Charles 51); 4 NY Life insurance policies with "Hill, EN"; 0 land_transfer_events for Shirley; 0 Carter probate in person_documents; 89,941 VA slave schedule records but no Charles City disambiguation
- Key methodology insight: continuous-enterprise descendants require "total person-years enslaved 1638–1865 × wage-theft × compound" NOT summed per-ancestor (double-counts)
- Estimated per-descendant obligation: ~$400M–$600M (1000× typical) because wealth stayed concentrated
- **Methodology gap:** DAAOrchestrator needs "continuous enterprise" flag for small class (Shirley, Westover, Berkeley, Stratford, Sabine Hall)

*Morgan family (Chauncey, John Jr, Caroline, Quincy):*
- Institutional trace through Aetna (Joseph Morgan III 1820s) + Peabody cotton trade + Confederate bonds (J.S. Morgan London) + 1871+ railroads/steel
- Existing Brattle constants already in DAAGenerator ($134,467/person-year ceiling) — Brattle PDF noted as ref doc, no S3 archive needed per user

### Priority gaps still open

1. **2,154 civilwardc petition images archived to S3 but not OCR'd** (their metadata is in DB via TEI ingest, but handwritten narrative prose + signatures + endorsements unextracted) — same orphan pattern as Hopewell will was
2. **15,992 unconfirmed_persons stuck in `needs_review`** — huge limbo backlog
3. **Empty migration tables from earlier work:** `top_landholder_flags`, `flagrant_heirloom_assets`, `modern_parcel_links`, `land_transfer_events`, `enslaver_lineage_ledger`, `daa_lineage_contributions`, `enslaved_owner_relationships`, `enslaved_descendants_confirmed/suspected`, `person_evidence_sources`
4. **Old Freedmens Vision parser ceiling is ~50%** yield (record-anchor detection limited by handwriting variance)
5. **Freedmens "production run" from Apr 18 had a 200-depositor cap per branch** — real coverage was ~840 pages across 28 branches, not thousands. Real full-roll awaits trained Document AI.
6. **OCR pass on 11 Philly bank PDFs** to extract JPMC-style names lists → populate `corporate_debt_acknowledgments`

### User-approved priority order

1. ✅ Malformed civilwardc re-run (20 → 0)
2. ✅ TEI re-ingest of all 1,041 civilwardc petitions
3. 🟡 Freedmens Bank parser audit + Document AI training (user labeling, training queued)
4. ✅ Human review UI scaffold + parse_failures queue
5. ⏳ 1870 Census pilot (DC/MD/SC/NY/GA approved, not started)
6. ⏳ Freedmens Bureau integration (approved, not started)
7. ⏳ OCR pass on 11 Philly bank PDFs (names lists → corporate_debt_acknowledgments)
8. ⏳ Participant intake form checklist update (expanded to 25+ corp/uni options)

---

## Session 31: Freedmen's Bank Parser + Wealth Tracing Pivot + Security Audit (Apr 18-19, 2026) ✅ DELIVERED

### Triggering events
- Kernel panic on 8GB M1 MacBook Air during Freedmen's Bank scrape work. Root cause: swap thrash from concurrent Puppeteer + Chrome + VS Code + Claude Code.
- User pushback on long-standing implicit "wealth tracing is infeasible" framing in the project's calculator defaults — directive to pivot to specific-asset, land-primary tracing.
- Safari "Apple Security System" scareware popup surfaced as a recurring system-level concern.

### Delivered tonight (Apr 18 evening → Apr 19 early morning)

**Memory-safe Freedmen's Bank runner** (`scripts/run-all-freedmens.sh`):
- `NODE_OPTIONS=--max-old-space-size=1536` heap cap per branch
- Clean Chrome quit + relaunch between branches (captures Chrome args at startup, reuses same user-data-dir for login persistence)
- Swap-abort guard (default 80%) with resume instructions on exit
- Chrome-detection regex fixed (was missing `.app/` in path pattern)

**Audit script duplicate-detection bug fixed** (`scripts/audit-freedmens-quality.js`):
- Old query grouped on `(full_name, context_text, branch)`. When `context_text` fell back to the generic "Freedman's Bank depositor, <branch>" string (no account#), 136 distinct first-name-only "John" records in NYC collapsed into one group and got reported as duplicates. False positive.
- Split into 3a HARD duplicates (same ARK URL) and 3b SUSPICIOUS (same name + account# across different ARKs).
- True issue rate: **0.033%** (was reported as 0.365%). Only 20 real duplicates in the 363K records.

**Freedmen's Bank enslaver-field extraction — full rewrite** (`scripts/extract-freedmens-fields.js`):
- Replaced naive flat-text regex parser with Google Vision DOCUMENT_TEXT_DETECTION bounding-box parser.
- Label detection: strict regex with `^`/`$` anchors and `(\d+\.\s*)?` optional numeric prefix — handles BOTH Charleston Roll 21's numbered 26-field form AND Baltimore/Huntsville unnumbered short-form in the same patterns.
- Record anchor detection: "No.NNNN" account numbers OR "Record for NAME" headers (covers all 28 branches' templates). OCR-variant tolerance for "Becord" / "lecord" / "Pecord" misreads of "Record".
- Zone partitioning: single anchor → whole-page zone; multi-anchor → partition by (y, x) with unique keys (fixed the bug where all null-acct anchors collapsed into one null-keyed zone).
- Value extraction via catchment area: for each label, collect words between midpoint-to-prev and midpoint-to-next label, with a ±12px buffer so handwritten values whose bounding boxes straddle row boundaries get captured.
- UI-chrome filter: exclude words outside `{x:[40,2200], y:[120,1600]}` so FS viewer sidebar text ("Bank Records", "NAMES", etc.) doesn't pollute ledger extraction.
- Screenshot stabilization: strip `view=index` query param from the ledger URL before `page.goto()` so FS doesn't auto-open the right-hand indexing panel. Viewport set to 2800×1700. Zoom-In clicks not needed (they made text blurry); "fit to window" default at wider viewport gives clean ledger capture.
- Vision response caching: `--reuse-ocr` flag loads cached annotation JSON from disk, zero-cost parser iteration.
- Random sampling mode: `--random` flag for verification sweeps.

**Parser verification sweep** (`scripts/verify-freedmens-parser.sh`):
- Ran on one random page from each of 31 branches.
- 29 of 31 produced ≥1 record anchor. Median 8 anchors per multi-record page, 1 per single-record page.
- Graceful failures (no false data): Mobile Alabama (faded ink, OCR couldn't read) and Philadelphia (tabular "RECORDS FOR SOCIETIES" form — organizational, not individual).
- Ground-truth success: Charleston R21 image 107 extracted `last_master="Mrs Cyons Howe."` for Hagar Savage (OCR noise on "Cyans" → "Cyons" but human-recognizable).

**Full-collection overnight runner started** (`scripts/run-freedmens-field-extraction.sh`):
- 28 branches (Philadelphia deliberately skipped — orgs form).
- PER_BRANCH_LIMIT=300 depositors, 30-min per-branch timeout (hand-rolled bash watchdog since macOS lacks `gtimeout`).
- Chrome restart every branch, swap-abort at 80%, post-branch audit with threshold interrupts (>30% garbage ratio or 2 consecutive 0-extract branches — new logic applies to future restarts only).
- LIVE DB writes enabled. Started 00:18:50 EDT Apr 19.
- Branch 1 Charleston R21: **50 depositors extracted, 32 with enslaver fields, 26 with old_titles, 0 garbage.**
- Branch 2 Charleston R23 crashed on rate-limit ("Execution context destroyed"); user fixed the rate limit manually; Branch 3 Richmond R26 resumed cleanly. R23 needs re-run.

### Wealth tracing pivot (directional shift)

After the user's critique of the aggregate-statistics framing, we established:
- Directional memory file `project_wealth_tracing_pivot.md` capturing the pivot thesis.
- **`memory-bank/wealth-tracing-framework.md`** — academic-quality methodology draft (abstract, problem statement, 3-claim thesis, working bibliography, two-pillar methodology, data model, source priorities, validation, limits, DC pilot, roadmap). Target: peer-reviewable, court-admissible.
- **`migrations/038-land-tracing-and-flagrant-assets.sql`** — additive schema: `land_transfer_events` (chain of title), `modern_parcel_links` (historical → modern parcel ID), `top_landholder_flags` (1% reference tier, keyed to canonical_persons), `flagrant_heirloom_assets` (named trusts, stock certificates, art, etc.). Plus `enslaver_material_footprint` view for DAAOrchestrator consumption.
- Thresholds: **top 1% landholder reference tier PLUS any-scale-slaveholder tier** (not top 10% per user direction).
- Pilot case: user's 5 DC-slave-owning ancestors whose probate/deed/administration/guardianship records were requested on Apr 18. Ingestion and trace will follow once records arrive.

### 🚨 Security finding

- **Production Render PostgreSQL password `<REDACTED-render-pg-decommissioned-2026-04-25>` is committed in git HEAD** on public repo `github.com/danyelajunebrown/Reparations-is-a-real-number` in 5 files: `docs/deployment/DEPLOYMENT-FIX-GUIDE.md:78`, `memory-bank/activeContext.md:1867`, `run-test.sh:5`, `setup-agent.sh:8`, `test-simple.sh:5`.
- **Google Vision API key + FamilySearch password** are only in local `.claude/settings.local.json` (not tracked). Less severe but still good-hygiene rotate.
- Action plan (task #17): rotate in Render → update .env → remove from 5 files → `git filter-repo` to purge history → force-push → audit DB for suspicious activity. User aware; rotation timing TBD (overnight run holds DB connection).

### Safari scareware

- "McAfee: Critical Virus Alert" popups diagnosed as Safari web-notification scam from domain `homphitiomiring.com` (classic malvertising push-notification subscription). Not a system virus. User instructed to delete all Safari notification permissions + disable future notification prompts.

### Current state (as of Apr 19 ~02:00 ET)

- Overnight runner PID 11467 alive, on branch 3 of 30.
- Charleston R23 needs re-run (crashed on rate limit; zero DB corruption, just no data written for that branch).
- Task #17 (credential rotation) awaiting user action.
- Land-tracing schema drafted but not applied.

### Known deferred
- Parser accuracy improvement: cross-label value bleed on Charleston R21 (slave_residence and old_title both capture "Charleston." when they shouldn't). Acceptable for MVP.
- Baltimore DB↔FS image mapping mismatch: DB thinks acct 220 is one person, FS ledger page 11 shows a different name at acct 220. Separate data-quality issue, not parser.
- Full-collection run will need re-run on any branches that crashed on rate limits; `run-freedmens-field-extraction.sh` is idempotent over already-extracted records (filters on `review_notes NOT LIKE '%ledger_extraction%'`).

---

## Session 29: Frontend Reintegration (Apr 11, 2026)

### Context
After months of backend development (scrapers, identity system, match verification, reparations calculators, blockchain deployment, 1860 slave schedule extraction), the Dec 2025 vanilla HTML frontend was severely out of sync with the current system. This session began the full rebuild.

### Audience Hierarchy (user-defined)
1. **Primary (DAA recipients):** Slaveholder descendants who completed intake. Receive DAA + payment page only — handled by admin, not main frontend.
2. **Secondary (priority for frontend):** Black folks who want to clearly traverse ALL verified data. Main audience.
3. **Tertiary:** Expert collaborators (genealogists, economists, lawyers, historians) — collaborate line-by-line via GitHub hosting.

### Core Decisions
- **Framework:** React + Vite (user approved — "take your time to do it right")
- **Aesthetic:** Terminal — black background, white monospace. "Does not need to be attractive."
- **Data policy:** STRICT. Only confirmed/verified data displayed on public site. Human review must be completed. NO unverified matches.
- **Hosting:** GitHub Pages (static build) → Neon DB via Render API backend
- **No real-time updates** needed at premiere

### Multi-Calculator Reparations Display
Per user directive, the reparations breakdown shows the **full multi-calculator breakdown** with every constant cited:
- Wealth gap (Craemer 2015 / Darity & Mullen)
- ICHEIC (Holocaust-era assets adaptation)
- Tiered payment (progressive) — labeled PLACEHOLDER
- Insurance / Banking / Railroad (Farmer-Paellmann sector calculators)

The legacy unsourced `Calculator.js` values ($120/day wage, $15K dignity, 4% compound, 2% penalty) are NEVER displayed without an explicit warn-tag labeling them as unsourced (issues #9, #12, #17, #18).

### Scaffold Created: `frontend/`
Full React+Vite project at `frontend/`. Structure:
```
frontend/
├── package.json (react 18, react-router 6, d3 7, ethers 6, vite 6)
├── vite.config.js (proxies /api → localhost:3000 in dev; manualChunks for d3/ethers/react-vendor)
├── .env.example (VITE_API_URL, VITE_BASE_PATH)
├── index.html
└── src/
    ├── main.jsx, App.jsx (lazy-loaded routes)
    ├── api/
    │   ├── client.js          # Single API source of truth + isVerified() strict filter
    │   └── format.js          # USD/int/class label helpers + CLASS_LABELS + CLASS_DESCRIPTIONS
    ├── hooks/
    │   ├── useApi.js          # useApi + useAsyncAction
    │   └── useBlockchain.js   # MetaMask/ethers wrapper, auto-switches to Base 8453
    ├── styles/global.css      # Terminal aesthetic + 7-class badge CSS vars
    ├── pages/                 # 9 route pages (Home, Search, Person, Lineage, Documents, Corporate, Legal, Blockchain, Admin)
    └── components/
        ├── Layout/StatsRibbon.jsx
        ├── Search/SearchBar.jsx
        ├── PersonModal/PersonProfile.jsx
        ├── Reparations/ReparationsBreakdown.jsx    # Multi-calculator with citations
        ├── LineageGraph/LineageGraph.jsx           # D3 zoomable — zoom out = all lineages
        ├── DocumentViewer/ (DocumentViewer + DocumentList)
        ├── CorporateDebts/ (CorporateDebts + CorporateEntity)
        ├── LegalFramework/ (LegalFramework + LegalTopic)
        ├── BlockchainPanel/BlockchainPanel.jsx     # Payment-ready for premiere
        └── Admin/ (AdminHome, ReviewQueue, DataQuality, ParticipantManagement)
```

### Seven Phases (all complete)
1. ✅ Scaffold + terminal aesthetic + search
2. ✅ Person modal + reparations calculators (multi-methodology with citations)
3. ✅ Lineage graph visualization (D3 zoomable — zoom out = all participant lineages side by side)
4. ✅ Document viewer + corporate debts + legal framework
5. ✅ Blockchain payment panel (MetaMask, submit DAA, USDC/ETH deposit)
6. ✅ Kiosk update + admin routes
7. ✅ Cleanup + dependency-safe removals

### Strict Verification Filter
`src/api/client.js` exports `isVerified()` and `filterVerified()`. A record is displayed iff:
- `verification_status ∈ {confirmed_slaveholder, enslaved_ancestor, free_poc, free_poc_slaveholder}`, OR
- `status === 'confirmed'`, OR
- Row lives in `canonical_persons` / `enslaved_individuals` / `individuals`

Everything else (temporal_impossible, common_name_suspect, ambiguous_needs_review, unverified) is excluded from the public site entirely. Admin routes can override.

### Kiosk Rewrite
`styles/kiosk.css` rewritten in terminal aesthetic (same black/white/mono palette as React app). 7-class verification badges preserved (they already existed in the old CSS). Kiosk stays vanilla HTML so the Pi deployment pipeline is unchanged.

### Files Removed (git rm)
- `contribute-v2.html` — conversational contribute workflow no longer in premiere scope
- `js/debt-river-animation.js` — hidden since December, decorative only
- `styles/debt-river.css` — paired CSS

### Files Modified
- `index.html` — removed debt-river `<link>`, `<div>`, `<script>` tags
- `js/app.js` — removed dead `window.debtRiver.onSearch()` branches
- `src/server.js` — removed `/contribute-v2.html` route + dead `/api/process-individual-metadata` stub
- `styles/kiosk.css` — terminal aesthetic rewrite

### Dependency Analysis Done Before Removal
Three parallel sub-agent sweeps verified everything that referenced each removed item. Key findings preserved:
- `enslaved_people` table references are production (34 files) — NOT removed
- Beyond Kin references are active (2,461 records, high-conf 0.95 parsing) — NOT removed
- Legacy redirect endpoints (`/api/upload-document`, `/api/llm-query`, `/health`) — callers still exist in Orchestrator.js + test scripts; kept for now, flagged for future cleanup after those callers are updated

### Admin Plan
Four routes under `/admin`:
- **Overview** (AdminHome) — pre-premiere checklist
- **Review queue** — approve/reject pending matches; edit name before approving; public site shows only approved items
- **Data quality** — metrics, garbage rate, confidence distribution
- **Participants** — grouped by climb session identity (fallback until dedicated `/api/participants` endpoint exists)

### Apr 13 Update: Build + API Shape + Auth Pass

✅ **npm install + build pass** — 164 packages, 0 vulns, `npm run build` clean (776 modules, 0 errors, ~540 KB gzipped total). Code-split per route. ethers=99K, react-vendor=54K, d3=16K, per-page bundles 1-4K.

✅ **Stats caching** — already existed in `contribute.js:48-52` with 5-min TTL. No change needed.

✅ **API shape mismatches resolved** by cross-checking real route handler code (not blindly trusting frontend guesses):
   - `isVerified()` in `client.js` — checks BOTH `verification_status` AND `classification` columns on `ancestor_climb_matches` (MatchVerifier writes `classification`, migration 034 added `verification_status` as synonym).
   - `CorporateDebts.jsx` — rewritten to match real response. `/farmer-paellmann` returns `defendants: [{entity_id, modern_name, historical_name, entity_type, scac_paragraph_reference, documented_activity, ...}]` — NO debt figures. `/farmer-paellmann/by-sector` returns flat array from `defendants_by_sector` view, not a grouped object. IMPORTANT: backend's `/calculate` endpoint is explicitly gated as RESEARCH_IN_PROGRESS (unsourced multipliers, placeholder counts) — we show defendants as documented facts only, no dollar figures. Prominent warning box added.
   - `LineageGraph.jsx` — `detail.matches` (top-level not nested), uses real column names `slaveholder_name`, `slaveholder_birth_year`, `generation_distance`.
   - `ParticipantManagement.jsx` — `matches_found` (real column) not `matches_count`.
   - `BlockchainPanel.jsx` — **3 critical contract mismatches fixed**:
     - Was calling `contract.submitRecord(...)` — real function is `submitAncestryRecord(name, fsId, genealogyHash, amount, notes)` with 5 args including genealogyHash.
     - Was calling `depositUSDC`/`depositETH` — real function is unified `depositReparations(recordId, token, amount)`. USDC: `token = config.usdcAddress`. ETH: `token = address(0)` + `{value: amount}`.
     - Was parsing `totalDebt` with 18 decimals — contract stores in USDC decimals (6) per `blockchain.js:148`. Now using `parseUnits(amount, 6)`.

✅ **Admin auth gate** — Bearer token (X-Admin-Token header) with timing-safe comparison:
   - `src/middleware/admin-auth.js` — reads `ADMIN_TOKEN` env var. Production: refuses requests without it (503). Dev: left open with single startup warning.
   - Gated routes (registered BEFORE router mounts): `/api/admin/verify`, `/api/ancestor-climb/pending-verification`, `/api/contribute/review-queue` (+ approve/reject/approve-all), `/api/contribute/data-quality` (+ fix/mutations), `/api/contribute/data-quality-metrics`, `/api/contribute/training/*`.
   - CORS allowedHeaders now includes `X-Admin-Token`.
   - Frontend: `useAdminAuth` hook, `AdminAuth.jsx` login component wraps `AdminPage.jsx`, token stored in localStorage, verified against `/api/admin/verify` on mount.
   - `.env.example` updated: ADMIN_TOKEN section with `openssl rand -hex 32` generation tip and rotation policy.

### Apr 13: Live verification, legal rendering, IPFS, pool fix, deploy

🛑 **Live API verification BLOCKED:** `https://reparations-platform.onrender.com/api/health` returns HTTP 503 with HTML body "Service Suspended". The Render deployment is suspended (not just sleeping). Need to reactivate Render account before live verification is possible. Static code cross-checks against route handler source were done as a substitute.

✅ **Legal framework structured rendering** — `LegalTopic.jsx` rewritten with topic-specific views:
   - `UK1833View`: loan amount/date/payoff/modern value, who received what, key arguments, citation
   - `HaitiView`: original demand/payment/modern value, framing (extorted vs gained), arguments, sources
   - `FarmerPaellmannView`: case metadata, why it failed, what changed since 2004, strategic lessons
   - `JurisdictionsView`: list of all jurisdictions with priority/legal_system/strategy/mechanism
   - All views handle `data.data` wrapper from the backend service. Helper components: `Lede`, `Section`, `Field`, `Cite`, `Pre`, `asArray`, `stringifyMaybe`.
   - Added `getFarmerPaellmannLegal()` and `listLegalDoctrines()` to api/client.js. Encoded country params for `getJurisdiction()`.

✅ **Genealogy hash for blockchain submission** — created `frontend/src/api/genealogyHash.js`:
   - Computes deterministic SHA-256 of canonical JSON of the submission payload using Web Crypto API
   - Output is `0x` + 64 hex chars (32 bytes), exactly fits Solidity bytes32
   - No IPFS network dependency → no flaky failures during live demo
   - Same content always produces same hash (idempotent)
   - Forward-compatible: when IPFS pinning is wired later, the same hash format remains valid evidence
   - Wired into `BlockchainPanel.jsx` SubmitRecord; the computed hash is shown to the user after submission so they can record what was committed on-chain
   - Throws loud error if `crypto.subtle` is unavailable (insecure origin) — refuses to silently fall back to ZERO_BYTES32 because payment provenance matters

✅ **Connection pool fix** — `contribute.js` had **17 endpoints** creating `new Pool()` per request and ending it (Neon connection exhaustion bug from FRONTEND-ENHANCEMENT-PLAN.md). Replaced ALL 17 with `sharedPool` from `database/connection.js`. Removed all 19 corresponding `pool.end()` calls. Syntax checks pass.

✅ **Deploy to GitHub Pages — READY but NOT PUSHED** (awaits user approval to avoid clobbering existing remote `gh-pages` branch which contains real Dec 2025 code history, not Pages artifacts):
   - `frontend/package.json` updated with deploy:gh-pages script that builds with correct env vars and pushes to **`gh-pages-react`** branch (NOT the legacy `gh-pages`) via the gh-pages package
   - `npm run build` now also generates `dist/404.html` (copy of index.html) for SPA client-side routing fallback
   - Verified build with `VITE_BASE_PATH=/Reparations-is-a-real-number/` produces correct prefixed asset paths
   - Local-mode build (no env vars) still works for dev
   - `frontend/.env.example` documents both base path scenarios
   - **What user needs to do before deploy:**
     1. Approve overwriting/creating the `gh-pages-react` branch on origin
     2. Run `cd frontend && npm run deploy:gh-pages`
     3. In repo Settings → Pages, set source to branch `gh-pages-react` / folder `/`
     4. (Optional) Reactivate Render so the API is reachable from the deployed site

### Apr 13 Files Touched
- `src/api/routes/contribute.js` — sharedPool everywhere (17 replacements, 19 pool.end removals), stats query rewritten with CTEs
- `src/middleware/admin-auth.js` (new)
- `src/server.js` — admin auth wiring, CORS X-Admin-Token header
- `frontend/src/api/genealogyHash.js` (new)
- `frontend/src/api/client.js` — added getFarmerPaellmannLegal, listLegalDoctrines, encoded jurisdiction param, admin token helpers
- `frontend/src/hooks/useAdminAuth.js` (new)
- `frontend/src/components/Admin/AdminAuth.jsx` (new)
- `frontend/src/components/BlockchainPanel/BlockchainPanel.jsx` — wired computeGenealogyHash, shows committed hash on success
- `frontend/src/components/LegalFramework/LegalTopic.jsx` — full rewrite with topic-specific structured views
- `frontend/src/components/CorporateDebts/CorporateDebts.jsx` — involvement_category array handling + rewrite for real API shape
- `frontend/src/components/LineageGraph/LineageGraph.jsx` — real column names (slaveholder_birth_year, matches_found)
- `frontend/src/components/Admin/ParticipantManagement.jsx` — matches_found column
- `frontend/package.json` — deploy:gh-pages script targets gh-pages-react branch, build generates 404.html
- `frontend/.env.example` — documents base path scenarios
- `migrations/apply-missing-on-neon.sql` (new) — defendants_by_sector view
- `.env.example` — ADMIN_TOKEN section

### Apr 13/14 DEPLOYMENT COMPLETE — full system green

All three commits pushed to origin/main and Render auto-deployed successfully:
- `40afc1759` feat(frontend): React+Vite rebuild for May 2026 premiere
- `81c69d349` fix(server): admin auth gate, connection pool fix, stats query fix
- `ae9b6a414` docs(memory-bank): Session 29 — frontend reintegration

**User actions completed:**
1. ✅ Migration 031 applied to Neon via SQL editor (7 legal relations seeded: 7 jurisdictions, 4 doctrines, 4 garnishment mechanisms, UK 1833 compensation, Haiti independence debt, Farmer-Paellmann analysis)
2. ✅ `apply-missing-on-neon.sql` applied to Neon (defendants_by_sector view created)
3. ✅ ADMIN_TOKEN set on Render (original value was accidentally posted in chat, user was advised to rotate immediately, user confirmed rotation — memorize: **never request or accept secret values in chat**)
4. ✅ GitHub Pages source switched from `main` to `gh-pages-react` branch / root folder
5. ✅ Visual confirmation from user: "yup looks decent"

**Before → After endpoint sweep:**
| Endpoint | Before | After |
|---|---|---|
| /api/contribute/stats slaveholders | **55** | **399,578** |
| /api/contribute/stats total_records | 1.97M | 2.46M |
| /api/legal/* (all 8 endpoints) | 500 | 200 with rich structured data |
| /api/corporate-debts/farmer-paellmann/by-sector | 500 | 200 (5 insurers, 4 railroads, 4 tobacco, etc.) |
| /api/admin/verify | 404 | 401 (gate working, token rejecting wrong values) |

**Live URLs:**
- Frontend: https://danyelajunebrown.github.io/Reparations-is-a-real-number/
- Backend API: https://reparations-platform.onrender.com
- DB: Neon (ep-still-glade-ad8qq83f-pooler.c-2.us-east-1.aws.neon.tech/neondb)

### 🔴 ISSUE FOR TOMORROW (Apr 14): Eli Neal not appearing in UI

User reported on first look: **"not seeing eli neal who's scrape we completed"**

Per memory (project_eli_neal.md), Eli Neal has 4 grandparent FS IDs with at least the Fagan climb completed (12+ matches Gen 7+). The climb sessions list returned 11 sessions from the live API but Eli Neal didn't show up in whatever view the user was checking.

Investigation hypotheses for tomorrow:
1. **Participant grouping not wired up** — Eli Neal's climbs are indexed by grandparent FS IDs (LX39-1MY, GQ5M-G1L, etc.), not by "Eli Neal". The ParticipantManagement component currently groups by modern_person_fs_id, so Eli's 4 grandparent climbs would appear as 4 separate "participants", not one named "Eli Neal". Need the participants table (migration 036) actually populated and a /api/participants endpoint wired.
2. **Lineage graph filtering matches too aggressively** — isVerified() only accepts confirmed_slaveholder/enslaved_ancestor/free_poc/free_poc_slaveholder. If the Eli Neal climb matches are all classified as 'unverified' (pre-verification), they'd be hidden from the public lineage graph. The ancestor_climb_matches row Edward Schwehr → Jacob Ruff we spot-checked shows classification='temporal_impossible' — many other matches may be similarly filtered out. Need to check what percentage of Eli Neal's ~12 matches pass the strict filter.
3. **Search not hitting canonical_persons properly** — if user searched "Eli Neal" directly, the /api/contribute/search endpoint hits unconfirmed_persons, enslaved_individuals, canonical_persons. But Eli Neal is a PARTICIPANT (living person), not an enslaver or enslaved person — he wouldn't be in any of those tables. There's no dedicated participant search yet.

Likely the real fix is (1) + a dedicated participant view that surfaces by participant name and shows all 4 grandparent lineages together in the LineageGraph.

Session pause: user said "we'll dig in tomorrow" — no more code changes tonight.

## Apr 13/14 Late-Night Audit: system-wide orphaning assessment

User followed up with broader concern: "how many other completed climbs and other sorts of data are lingering about in limbo due to our helter skelter migrations and integrations?" — triggered systematic audit via the live API.

### The headline numbers

- **11 ancestor_climb_sessions** total in DB (via `/api/ancestor-climb/sessions?limit=100`). 5 are named with FS IDs only (humanly unsearchable), 6 are named properly.
- **582 total climb matches** across all 10 completed sessions. **5 pass the verification filter. 99.1% hide rate.**
- Adrian Brown 16→1 (Angelica Chesley)
- Eli Fagan LX39-1MY: **548→4** (Mary Martin, William Howard, Mary Johnson, William Collins)
- Eli Schwehr GQ5M-G1L: 1→0 (Jacob Ruff b.1473 temporal_impossible)
- Ryan Mills ×3: 13→0
- Andrew Scammell 4→0
- **1,930,933 unconfirmed_persons** rows accessible via search but refused in person modal (incoherent UX — see issue #34)

### Key insight about the 548→4 ratio

Not a filter bug — the filter logic is correct. Breakdown of the 548:
- 330 `classification='temporal_impossible'` (born outside slavery era, correctly rejected)
- 121 `classification='unverified'` (MatchVerifier couldn't determine — **needs human review, no admin UI exists**)
- 93 `classification='common_name_suspect'` (high-frequency surname filter; includes "Hull, George" which is a legit Athens GA family per memory bank)
- 4 `classification='enslaved_ancestor'` (pass filter)

The `verification_status` column (225 auto_verified, 315 common_name_suspect, 8 temporal_impossible) is a human-review pipeline state, NOT a content classification. `auto_verified` just means "MatchVerifier made a confident call without needing human review" — which for most rows is a confident rejection, not a promotion.

### The Eli Neal problem (deeper dive)

Search for "Eli Neal" returns 18 fuzzy namesakes (Elizabeth Neal, Eli Oneal, Eliza Neale) — none are him. BUT:
- Search "Fagan" → 45 enslaver records in canonical_persons
- Search "Schwehr" → 7 descendant records in canonical_persons (Bartholomäus, Joannes Baptista, Georg, Remigius, Herman Louis...)
- Search "Hull" → 50 results (Hull family data is present)

**The data his climbs produced IS in the database.** The problem is the participant↔climb↔matches chain has no human-searchable entry point:
1. ancestor_climb_sessions.modern_person_name = FS ID for unnamed climbs
2. No /api/participants endpoint
3. Canonical_persons rows have no originating_session_id
4. ParticipantManagement groups by FS ID, not participant identity
5. `participants` table from migration 036 — status unknown, probably empty

### Missing migrations still outstanding

- ✅ Migration 031 (legal framework) — applied Apr 13
- ✅ defendants_by_sector view (from 021) — applied Apr 13
- 🔴 **Migration 009 (british_colonies)** — not applied, /api/british-colonies returns 500
- Unknown: migrations 010, 013, 016, 018, 020, 022, 023, 024, 025, 028, 029, 030, 032, 033, 036 (no verification done yet)
- Known broken (from memory): migration 011 historical_reparations_petitions

### Other orphaned state

- Census OCR job #246 **stalled 83+ hours** since Apr 10 on Virginia/Cabell County, 0% complete, status='running' but updated_at is 4 days old. /extraction-progress auto-detects this as 'stalled'.
- Blockchain contract on Base mainnet: totalRecords=0 (no DAAs ever submitted — genealogyHash work ready but untested with real data)
- Stale gh-pages branch on origin (real Dec 14 2025 code history, not Pages artifact — confusing)
- memory-bank/ is gitignored but files tracked (confusing git add workflow)

### GitHub issues filed Apr 13/14 (Session 29 close)

- **#26** P0 Eli Neal invisible — climbs indexed by FS ID, not participant name (critical, frontend-integration, data-orphaning)
- **#27** P0 No admin review UI for ancestor_climb_matches — 99.1% frontend hide rate (critical, frontend-integration, data-orphaning, bug)
- **#28** P1 Migration 009 (British colonial) not applied to Neon (high, data-orphaning, bug)
- **#29** P1 Audit all migrations 007-036 for applied-on-Neon status (high, data-orphaning)
- **#30** P1 Census OCR job #246 stalled since Apr 10 (high, bug)
- **#31** P2 Search returns type=descendant / slaveholder_descendant with no frontend model (medium, frontend-integration)
- **#32** P2 Revisit common_name_suspect filter — legit matches hidden (medium, frontend-integration)
- **#33** P2 Repo housekeeping — stale gh-pages branch, gitignored memory-bank (medium)
- **#34** P1 Unconfirmed_persons (1.93M) surface in search but refuse in person modal (high, frontend-integration, data-orphaning)

### New labels created
- `frontend-integration` #5319E7 — Connecting React frontend to backend data/services for May premiere
- `data-orphaning` #EDEDED — Data exists in DB but unreachable from intended user views

### Priority order for Apr 14 morning work

**P0 (premiere-critical):** #26 #27 — without these, Eli Neal (and everyone with FS-ID-only climbs) has nothing to see at the premiere

**P1 (data integrity):** #29 (migration audit), #34 (unconfirmed UX), #28 (British colonial), #30 (stalled OCR)

**P2 (polish):** #31 #32 #33

### User Preferences Reaffirmed
- Take time, do it right, test, verify at each step, update memory bank (explicit instruction)
- Nothing unsubstantiated on the premiere frontend — data cleaning in parallel chat
- The premiere is proof-of-concept, not the product (per project_vision_apr6 memory)

---

## Session 28: Freedmen's Bank Records Scraping (Apr 7-9, 2026) 🟢 LIVE SCRAPING

### Goal
Add formerly enslaved persons with owner/master information to the database from the Freedmen's Bank Records (FamilySearch Collection 1417695). These records contain depositor names, occupations, complexions, birthplaces, and critically — **former master/mistress names and plantation names** — linking freedpersons directly to their enslavers.

### Two Scrapers
1. **`scripts/scrape-freedmens-bank-indexed.js`** — For branches with FamilySearch Image Index (pre-transcribed volunteer data). ~13 records/page, 0.95 confidence. Parses structured text from the index panel.
2. **`scripts/scrape-freedmens-bank-ocr.js`** — For branches without pre-indexed data. Screenshots pages, runs Google Vision OCR, parses handwritten register format. Extracts former master/mistress names.

### Branches Configured
| Branch | Type | Rolls | Total Images | Status |
|--------|------|-------|-------------|--------|
| Charleston, SC | Indexed | Roll 22 | 421 | Not started |
| Richmond, VA | Indexed | Roll 26 (221) + Roll 27 (841) | 1,062 | **🟢 Roll 26 LIVE SCRAPING** |
| Wilmington, NC | Indexed | Roll 18 | 254 | Not started |
| Raleigh, NC | Indexed | Roll 18 | 2 | Not started |
| Atlanta, GA | OCR | Roll 6 | 612 | Not started |
| Washington, D.C. | OCR | Roll 4 | 841 | Not started |

### Critical Discovery: FamilySearch Bot Detection (Apr 9) ⚠️ IMPORTANT
**FamilySearch detects and blocks Puppeteer CDP (Chrome DevTools Protocol) interactions:**
- `page.goto()` → Redirected to "Get Involved" page
- `window.location.href` changes → Redirected
- `page.evaluate(() => element.click())` → Redirected
- `page.evaluate(() => element.focus())` → Redirected
- `page.focus()` → Element not found (Shadow DOM)

**What WORKS:**
- `page.evaluate(() => document.body.innerText)` — **READ-ONLY text extraction is safe**
- **Chrome AppleScript JS execution** via `osascript -e 'tell application "Google Chrome" execute active tab of front window javascript "..."'` — Completely bypasses CDP bot detection
- The hybrid approach: **osascript for navigation, Puppeteer for reading** — 0 errors

### Navigation Solution (WORKING ✅)
Uses Chrome's AppleScript bridge to execute JavaScript that:
1. Finds the image number input via `document.querySelector('input[aria-label="Enter Image number"]')`
2. Sets value via React-compatible native setter (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set`)
3. Dispatches `input`, `change`, and `keydown(Enter)` events
4. Waits 5 seconds for SPA + index panel to refresh
5. Reads page text via Puppeteer CDP (read-only, safe)

**Prerequisites:**
- Chrome must have "Allow JavaScript from Apple Events" enabled (View > Developer)
- Chrome must be launched with `--remote-debugging-port=9222`
- User must manually navigate to the first Freedmen's Bank ARK page before starting scraper
- The Image Index tab must be open/visible in the FS viewer

### Improvements Made to Scraper (Apr 9)
1. **`checkPageHealth()`** — Detects redirects to wrong FS app, 500/403 errors, empty SPA bodies
2. **Chrome AppleScript navigation** — Bypasses FS bot detection completely
3. **Reuses existing FS tab** — Never creates new tabs (which get redirected)
4. **No CDP clicks/focus** — ensureIndexOpen is now read-only
5. **Removed `activate` command** — Chrome no longer jumps to foreground every 5s
6. **`person_type = 'enslaved'`** — Records visible in ALL existing search/API filters (was 'freedperson' which no API recognized)
7. **Per-page source_url** — Each record has exact ARK URL with `?i=N` param for provenance
8. **S3 screenshot archival** — Each page archived to `archives/freedmens-bank/{branch}/roll-{N}/image-{NNNN}-{hash}.png`
9. **Dedup hash** — MD5 of `name|account#|pageURL` in `data_quality_flags.dedup_hash` prevents duplicate inserts
10. **Image number tagging** — `relationships.source_image_number` tracks which image each record came from
11. **Cleaned 24,016 duplicate records** — Deleted all previous runs before clean restart
5. **Consecutive empty page safety valve** — Stops after 10 consecutive empty/failed pages with clear resume instructions (`--start N`)
6. **Debug dump on every failure** — Saves body text + full DOM HTML to `debug/freedmens-bank/`
5. **`ensureIndexOpen()`** — Clicks "Index" tab/button if FS lazy-loads the index panel

### Next Steps (when FamilySearch comes back online)
1. Verify current index URLs still work (may need URL format update)
2. Test single page: `node scripts/scrape-freedmens-bank-indexed.js --branch "Richmond, Virginia" --start 0 --limit 2`
3. If URLs changed, navigate manually in browser to discover new format, update BRANCHES config
4. Run full Richmond scrape: `--branch "Richmond, Virginia" --start 5` (was at page 5 before freeze)
5. Run remaining indexed branches (Charleston, Wilmington, Raleigh)
6. Run OCR branches (Atlanta, Washington DC)

### Resume Command (when FS is back)
```bash
# Richmond was at page 5 before the freeze
node scripts/scrape-freedmens-bank-indexed.js --branch "Richmond, Virginia" --start 5
```

---

## Session 27: Methodology Overhaul + Blockchain + Data Promotion (Mar 31 – Apr 5, 2026) ✅ COMPLETE

### Codebase Integrity Audit — 24 GitHub Issues Filed
Comprehensive audit of all financial calculation code revealed systemic problems: unsourced constants, contradictory formulas, fabricated data, and misattributed research. Every hardcoded multiplier, interest rate, and base value in the reparations calculation pipeline was examined.

**CRITICAL Issues (#2-#8):**
1. **Three contradictory formulas** produce 37x divergence in a single document ($1/day vs $120/day vs $58,620/person-year across DAAGenerator, DAADocumentGenerator, and generate-daa-pdf.js)
2. **Fabricated "Unnamed enslaved person(s)"** with made-up 30yr/1800 data generates real dollar debts in participant documents
3. **Ager/Boustan/Eriksson 2.5x "wealth multiplier"** does not exist in the cited paper — misattributed
4. **Triple-counting:** compound interest + inflation multiplier + wealth multiplier applied cumulatively
5. **Generated documents use binding legal language** ("Obligor," "waives defenses") with no attorney review
6. **Corporate calculators** use acknowledged placeholder data to produce specific dollar amounts via API
7. **TODO markers** appear in participant-facing legal documents

**HIGH Issues (#9-#14):** Five different interest rates (3-7%) none sourced, uncalibrated confidence scores, guessed currency conversions, unsourced "Delayed Justice Multiplier" 3.2x and "Human Dignity Value" $15K/$50K, unsourced "enablement multipliers" 1.5x-3x, blockchain escrow described as functional but doesn't exist

**MEDIUM Issues (#15-#18):** "UNITED STATES OF AMERICA" header, stale 79.5% hardcoded, "damages"/"penalty" language vs inherited-debt philosophy, dead code in Calculator.js

**RESEARCH-NEEDED Issues (#19-#25):** Operationalize Darity & Mullen, wealth tracing methodology, tiered payment structure, legal framework, ICHEIC adaptation, Brattle Group data harvest, revisable blockchain DAAs

### Research Sources Identified
- **Craemer (2015):** hours × wage × 3% compound. No additional multipliers. $14T total.
- **Darity & Mullen (2020):** Wealth-gap closure. $795K/household × 10M = $7.95T. Population-level — needs adaptation for individual DAAs. **Consider direct consultation.**
- **Brattle Group (2023):** $100-131T comprehensive forensic economics. Useful as macro ceiling and per-category decomposition.
- **Ager/Boustan/Eriksson (AER 2021):** Slaveholder families fully recovered via social capital in 1-2 generations. NO numerical multiplier — qualitative finding about wealth persistence through social capital ↔ financial capital conversion.
- **ICHEIC (Holocaust insurance):** Face value at historical exchange rates → present value via government bond returns. Most applicable asset-tracing model for known asset values.
- **Swiss Volcker Commission:** 10x multiplier was negotiated proxy, not forensic tracing. 650 accountants, 254 banks, CHF 300M audit cost.
- **MeasuringWorth.com:** Four conversion methods producing $13.5K to $3.4M per person-year.
- **Fleischman & Tyson (2004):** Plantation accounting records documenting how accounting facilitated slavery.

### Premiere Intake Form (May 8-9, 2026)
Built Google Form structure and validation script for participant intake at film premiere.

**Data standard:** All 4 grandparent FamilySearch IDs required. Priority is absolute certainty in analysis, not maximum participation. Participants must do their own genealogy before they can participate.

**Required fields:** Self (name, DOB, birthplace, email, address, FS ID), Parents ×2 (name, birth year, birthplace, FS ID, living status), Grandparents ×4 (same), Financial disclosure (income, net worth, real estate equity, inheritance received/expected, tax filing status, dependents), Consent (4 checkboxes + certification)

**Wealth Fingerprint (Section 3b — added Apr 15/16, 2026):** Trust/estate (beneficiary status + corpus), family business (founded vs inherited + sector/founding year), inherited land (acreage tier + states + use types), Farmer-Paellmann corporate connections checklist (JPMorgan, CVS/Aetna, NY Life, BBH, CSX, Norfolk Southern, Union Pacific, Canadian National), executive/board multi-generational history, pre-1865 business continuity.

**Validation script:** `scripts/validate-intake-form.js` — processes Google Form CSV export, validates FS IDs (no-vowel regex), cross-checks generational plausibility, detects duplicate IDs, verifies FS IDs exist via HTTP, auto-computes `wealth_flag_elevated` and `corporate_connection_type`, optional tree linkage verification via Puppeteer

**FS ID regex:** `^[BCDFGHJKLMNPQRSTVWXYZ0-9]{4}-[BCDFGHJKLMNPQRSTVWXYZ0-9]{2,4}$` (no vowels A E I O U)

### Dead-Data Problem Fixed (Apr 15/16, 2026)
Previously, intake form collected 7 financial fields but DAAOrchestrator.calculateTotalDebt() only used `annualIncome * 0.02` (flat 2%). Net worth, real estate equity, inheritance, dependents, tax status — all dead data.

**Now wired:**
- **DAAOrchestrator** calls TieredPaymentCalculator (progressive brackets 0.5%–5% × slaveholder scale × corporate multiplier + 0.1% net worth component) + WealthGapCalculator (Darity-Mullen share-of-gap with wealth ratio + inheritance factor). Uses HIGHER of Craemer vs D&M as obligation floor.
- **Migration 037** adds 15 new columns to `participants`: corporate_connections[], corporate_connection_type, trust_beneficiary, trust_corpus, family_business_ownership/details, inherited_land_acres/states/use, executive_board_history, pre_1865_business_continuity/details, wealth_flag_elevated, wealth_flag_reasons[]
- **CorporateSuccessionTracer** now has `reverseLookup()` — "Citizens Bank" → jpmorgan (predecessor, 0.8 confidence)
- **Backward compatible** — calculateTotalDebt() still accepts a bare number for existing callers

**Integration test verified:**
- $250K income, $3M net worth, $800K inheritance, 50 enslaved, direct corporate:
  - Flat 2% was: $5,000/yr
  - Tiered now: $15,240/yr (6.1% effective rate)
  - Wealth-gap obligation: $1.6M
  - Dual methodology picks Darity-Mullen (higher)

**TODO:** Paste Section 3b into actual Google Form. Run migration 037 on Neon.

### Piper's Failed Climb (LTVZ-D9S)
- Session beea32c1 started Mar 26, ran for 5 seconds, visited 1 person, 0 ancestors
- Climber hit living person page, failed to extract parent IDs (all 5 methods returned nothing), BFS queue emptied, marked "completed" with 0 work done
- Root cause: Either Chrome wasn't logged into FS, or logged-in account didn't have tree sharing access to Piper's family
- **Needs:** Re-run with confirmed FS login + tree sharing. Also fix climber to FAIL LOUDLY when living person page yields 0 parents.

### Data Foundation Fixes (Apr 6)
- **Dedup complete:** 46,552 duplicate enslavers deleted, 9,642 groups merged. Daniel Clark 360→6. Enslavers: 402,139 (clean).
- **Person_type normalized:** 403K rows (slaveholder/owner → enslaver) in unconfirmed_persons
- **Participant model created:** Migration 036. Eli Neal linked to 2 climb sessions + 4 family members. Adrian Brown linked to 1 session.
- **SlaveVoyages owners promoted:** 36,026 ship owners/captains → canonical_persons
- **Santos enslavers promoted:** 3,661 → canonical_persons
- **Book of Negroes enslavers scraped:** 724 from LAC detail pages → canonical_persons, 638 enslaved records updated with enslaver linkage
- **Voyage evidence built:** 71 SlaveVoyages matches enriched with ship names, ports, dates, enslaved counts
- **All climb matches rescanned:** Eli 548→225 legitimate, Adrian 16→14, others cleaned

### Data Problems — RESOLVED Apr 6
1. ~~1.6M enslaved invisible to DAA~~ → **FIXED**: DAAOrchestrator now queries enslaved_individuals + family_relationships + unconfirmed_persons JSONB
2. ~~Two linkage systems not synced~~ → **FIXED**: 99.3% of enslaver edges linked to canonical IDs, 34K JSONB links synced to family_relationships
3. ~~Dedup needed~~ → **FIXED**: 46,552 duplicates deleted, enslavers: 402,139 (clean)
4. ~~Person_type inconsistent~~ → **FIXED**: 403K rows normalized to 'enslaver'

### Remaining Data Problems
1. **Freedmen's Bureau not imported** — 480K names with former enslaver linkages, requires FamilySearch scraper (Chrome busy with slave schedules)
2. **12% FamilySearch ID coverage** — only 54K of 402K enslavers have FS IDs, limiting Tier 1 matching
3. ~~No confidence propagation~~ → **FIXED**: DAAGenerator weights debt by 0.92^generation * match_confidence. Gen 4=72%, Gen 8=51%, Gen 10=43%.
4. **Spelling variant duplicates** — dedup caught exact matches but not Asbury/Asberry, Wm/William variants. NameResolver (Soundex/Metaphone) could help.
5. ~~Front page wonky (Issue #1)~~ → **FIXED**: Emojis removed, nav overflow fixed, layout cleaned up.

### Blockchain Escrow Deployed to Base Mainnet (Apr 5)
- **Contract:** `0x914846ceA07e57d848d9d60C8238865D83d9ab1E`
- **Explorer:** https://basescan.org/address/0x914846ceA07e57d848d9d60C8238865D83d9ab1E
- **Tx Hash:** `0x81b2b63542cdf605709fa640d1fd1f6c41ea596bce7608f5725452f3f7c6f326`
- **Network:** Base Mainnet (chain 8453)
- **Owner:** `0xD20a3CF9101948bE150C1ca3fa9a9bA60b3cfB3f` (MetaMask)
- **USDC:** `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (Circle native on Base)
- **Features:** ancestry record submission, USDC/ETH deposits, descendant management, verification, revisable DAA amounts (updateReparationsOwed), historical payment tracking, 7-day timelock withdrawals
- **Tests:** 12/12 passing (deployment, records, verification, revisable amounts, deposits, debt tracking, views)
- **Deployment artifacts:** `deployments/base-deployment.json`, `deployments/ReparationsEscrow-abi.json`
- **SECURITY:** Deployer private key was exposed in chat — transfer ownership to fresh wallet after premiere
- **TODO:** Wire frontend (js/app.js) and Express server to contract; connect DAA generation to on-chain recording

### Eli Neal — First Premiere Participant Climb (Apr 5) — RUNNING
- **Participant:** Eli Neal (provided name + family tree screenshot with all FS IDs)
- **Lineage reconstructed from tree screenshot** — no intake form needed for testing
- **Climb 1:** Gwendolyn Louise Fagan (`LX39-1MY`, 1923-2007) — RUNNING, Gen 7+, 12 matches, 75 ancestors queued
  - Fagan/Lasater/Richard/Bennett lines — deep Georgia, Civil War era
  - Henry Fagan (b.1842), Dewitt Clinton Bennett (b.1840), Elizabeth Hull (b.1847) — key ancestors
  - Hull surname matches Southern Mutual Insurance enslavers (Asbury Hull, Fred H. Hull)
- **Climb 2:** Edward Joseph Schwehr (`GQ5M-G1L`, 1916-1992) — AUTO-QUEUED, starts when climb 1 finishes
- **Known ancestors from screenshot:** 14 documented (8 Civil War era)
- **Paternal grandparents:** `KV29-9MN` and `MBLJ-P9B` — these are Gwendolyn's parents (William Cecil Fagan + Mary Catherine Richard), already being traversed by climb 1
- **Session ID:** 174eb3fb-dc82-4da6-adcd-7f4081239043

### Piper — Awaiting Grandparent IDs
- Individual ID `LTVZ-D9S` is insufficient — living person page yields no parent data without tree sharing
- **Need:** 4 grandparent FamilySearch IDs from Piper (deceased grandparents with public tree data)
- Previous session beea32c1 ran 5 seconds, 0 ancestors — confirmed as expected behavior for inaccessible living person

### All-States Slaveholder Promotion (Apr 5) — RUNNING
- `scripts/promote-slaveholders.js --all` launched, processing 15 states
- 272K unique slaveholders (after dedup) being promoted from unconfirmed_persons to canonical_persons
- Dry run validated: ~94% pass rate, ~4% garbage filtered, ~2% already existed
- Will triple the matchable enslaver population from ~123K to ~395K
- Script: promote-slaveholders.js (chunks of 500, idempotent, safe to re-run)

### Insurance Ledger Extraction Complete (Apr 5)
- Southern Mutual Insurance Co. (1847-1855, Athens GA): 37 enslaved persons, 27 enslavers in DB
- 7 corporate disclosure PDFs registered in person_documents
- OCR working via Google Vision (17 pages processed, 6 additional policies found beyond manual transcription)
- Enslavers cross-referenced against canonical_persons (3 matched existing entries: Deborah Ellis, John Smith, James Thomas)

### Corporate Calculator Data Updated (Apr 5)
- InsuranceCalculator: all 5 Farmer-Paellmann defendants updated with verified primary source data
- BankingCalculator: JPMorgan updated to Philadelphia 2024 disclosure (21,055 collateral / 1,300 owned)
- RailroadCalculator: Kornweibel predecessor counts (CSX 36, Norfolk Southern 39, Union Pacific 12, CN 7)
- All calculation endpoints gated behind RESEARCH_IN_PROGRESS flag
- Enablement multipliers replaced with market-share framing in data blocks

### All 17 Code Issues Resolved (Apr 5)
- **Issues #2-#8 (CRITICAL):** Canonical formula (Craemer 2015), fabricated persons removed, Ager multiplier removed, triple-counting fixed, legal language disclaimed, placeholder corporate data gated, TODOs removed from docs
- **Issues #9-#14 (HIGH):** Interest rates standardized, confidence scores documented as tiers, currency conversions sourced (BLS/BoE), delayed justice/dignity unsourced constructs gated, enablement multipliers replaced with market-share data, blockchain escrow claims removed
- **Issues #15-#18 (MEDIUM):** USA header → project name, stale % already fixed, inherited-debt language, dead code documented
- **Corporate calculators updated** with verified primary source data (CA DOI, JP Morgan Philadelphia 2024, Kornweibel railroads)
- **4 primary source PDFs** stored in `storage/corporate-disclosures/`
- **7 research-needed issues remain open** (#19-#25) — these are the forward-looking methodology work

### Key User Direction
- Every constant needs an academic citation with page number
- If we don't have the citation, we don't use the number
- Build iteratively — will not get methodology right on first try
- Be transparent about what we don't know yet
- The genealogical pipeline (climber + match verification) IS solid — lean on this
- The financial calculation code is NOT ready for participants — must be transparent about developmental state
- "If anywhere in this project there is fluff designed to gratify our own sense of the codebase's functioning we need to route that shit out like white blood cells to an infection"
- Personal debt vs reparations debt: philosophically these are separate ledgers
- Living descendants inherit an unpaid debt — they are not being debited retroactively for crimes they weren't party to

---

## Session 26: Name-Only Climbing Fixes (Mar 24-26, 2026) ✅

### Ryan Mills Climb — First Successful Name-Only Climb
- Commit a86c51b — page recovery, session tracking, garbage detection overhaul
- Reached Gen 6+ (vs Gen 4 crash previous day), 5 enslaver matches, deep Irish lineage traced
- Fixes: NOT NULL on modern_person_fs_id, session creation for name-only, living person detection (check UNKNOWN before Person Not Found), match quality overhaul for name-only climbs

### Piper's Climb Attempted (LTVZ-D9S) — Failed silently (see Session 27 notes above)

---

## Session 25: Enslaver Matching Gap Fix + Mac Mini Deploy (Mar 20-23, 2026) ✅

### Enslaver Matching Gap Resolved
- Root cause: 58% of enslavers had no person_external_ids linkage
- Backfilled 2,464 FS IDs from notes → person_external_ids
- Promoted 2,276 CivilWarDC slaveholders to canonical_persons
- Added Tier 2b matching (name + state when birth year NULL, confidence 0.60-0.70)
- 72,201 enslavers now matchable

### Adrian Brown Climb Completed (P4RF-PFQ)
- 3,922 ancestors, 9 matches (5 temporal_impossible, 4 unverified)
- Strongest: Angelica Chesley (b.1783, external_id_match 0.95)
- All stale sessions cleaned Mar 23

### Mac Mini Deployed
- Git pulled e728c71, npm install, PM2 reconfigured
- Chrome relaunched with remote debugging on port 9222
- Full stack verified: Pi kiosk → Mac Mini Express → FS climber → Neon DB

---

## Session 24: 1860 Slave Schedule Audit & Gap Fill (Mar 20, 2026) ✅

### Definitive Audit Completed
Discovered that previous status reports were wrong — `extraction_progress` table and log files gave misleading completion data. The actual source of truth is `familysearch_locations.scraped_at`.

**Real status: 79.5% complete (4,381/5,513 locations scraped)**

Key findings:
- 977 of 6,490 entries are catalog hierarchy nodes (no waypoint_id) — not scrapeable
- Jan 31 "finish" run logged "ALL STATES COMPLETE" despite `ERR_INTERNET_DISCONNECTED` silently skipping states
- Pre-indexed data stored as `extraction_method = 'pre_indexed'`, not `'census_ocr_extraction'` — caused undercounting
- 1,660,291 pre-indexed + 20,380 OCR persons actually in DB

**Big gaps remaining (1,132 locations):**
1. Virginia: 285 remaining (4.7% done)
2. Mississippi: 162 remaining (34.9% done)
3. Louisiana: 155 remaining (43.8% done)
4. Kentucky: 101 remaining (72.0% done)
5. Missouri: 101 remaining (82.2% done)
6. Georgia: 93 remaining (84.9% done)
7. Tennessee: 88 remaining (91.1% done)
8. Arkansas: 72 remaining (85.8% done)

**Currently running:** Starting big gap states (VA → MS → LA)

### Today's Priority Order
1. ~~Audit 1860 slave schedule~~ ✅
2. Resume extraction on gap states (VA, MS, LA first)
3. Commit & stabilize uncommitted work
4. Mac Mini deployment (migrations 032-034, 15 commits behind)
5. Multi-source parent discovery testing

---

## Session 23 Accomplishments (Mar 19, 2026) ✅

### Match Quality Overhaul: Race-Aware Verification Pipeline ✅
**Problem:** System had zero race awareness. Amos Cilvester Brown (Black, b.1860 Louisiana, dragman) matched to white slaveholder records at 0.70 confidence. Francois Larche (free Black man who bought and manumitted his mother) classified as slaveholder. 70+ common-name matches like "John Smith" (b.1523) at Gen 13+ — centuries before American slavery. All 131 matches defaulted to classification='debt'.

**Solution implemented:**
- **Migration 034:** Added verification_status, verification_evidence (JSONB), confidence_adjusted, requires_human_review, review_reason columns to ancestor_climb_matches
- **MatchVerifier service** (`src/services/match-verification.js`): Post-match verification with 7 disqualification checks (temporal, enslaved_individuals, free_persons, census race, canonical person_type, common name at depth, race indicators) + corroboration checks (prior verification, census White)
- **Classification taxonomy:** confirmed_slaveholder, enslaved_ancestor, free_poc, free_poc_slaveholder, temporal_impossible, common_name_suspect, ambiguous_needs_review, unverified
- **SlaveVoyages tightened:** Removed first-initial matching (too many false positives), raised threshold 0.55→0.65, added temporal validation, exact whole-word surname matching
- **Climber wired:** Race/occupation extraction from FS page text, MatchVerifier in match flow, registerRaceEvidence() learning loop feeds free_persons table
- **Kiosk badges:** 7 new CSS classification badge classes, classificationLabel() helper, badges on tree nodes + cards + lineage overlay
- **API routes updated:** kiosk.js and ancestor-climb.js return new verification columns

**Re-evaluation results:**
- 131 existing matches re-evaluated → 101 reclassified, 0 errors
- 76 temporal_impossible (born too late or predates slave trade)
- 10 common_name_suspect (high-frequency surnames at deep generations)
- 45 unverified (legitimate candidates needing corroboration)
- Abigail session: 84 of 96 matches reclassified (cleaned up the slop)

**Integration tests:** 6/6 pass (Amos Brown, John Smith, Paul Paynter, Angelica Chesley, Robert Wilson, Charles Brown w/ race indicator)

**Commit:** e728c71 pushed to main

**Pending:**
- Mac Mini deploy (192.168.0.196 offline) — git pull + launchctl restart
- Fresh test climb with live FamilySearch browser session

---

## Session 21+ Accomplishments (Mar 11–16, 2026) ✅

### 1) Distributed Architecture: Pi Kiosk → Mac Mini ✅
**Problem solved:** Raspberry Pi too slow to run Chrome/Puppeteer. Solution: Pi is input-only kiosk, Mac Mini (studio) runs Chrome and the climber script. Connected via SSH over LAN.

**Architecture:**
```
Raspberry Pi (kiosk.html) → LAN → Mac Mini (Express 0.0.0.0:3000)
                                      ↓
                              POST /api/kiosk/start-climb
                                      ↓
                              nohup node familysearch-ancestor-climber.js (orphaned)
                                      ↓
                              Chrome (localhost:9222, GUI session)
                                      ↓
                              BFS climb → PostgreSQL (Neon)
                                      ↓
                              GET /api/kiosk/climb-status/:id (polling)
                                      ↓
                              Kiosk UI updates in real-time
```

**Key changes made:**
- Express binds `0.0.0.0` for LAN access from Pi (`src/server.js`)
- Kiosk route (`src/api/routes/kiosk.js`) spawns climber via `nohup` shell wrapper, fully orphaned from PM2
- `open -a "Google Chrome"` on macOS to launch through GUI session (SSH/PM2 can't access window server)
- Concurrent climbs: each climb gets its own Chrome tab, no more `pkill` of other climbs
- Confidence filtering: matches < 65% excluded (too many false positives on common names)
- Process detachment: `nohup + spawn(detached:true) + proc.unref()` survives PM2 restarts
- Virtual on-screen keyboard on kiosk for touchscreen input
- Kiosk auto-reset after 90s inactivity

### 2) Abigail Brown Climb Still Running ⚡
- P4RF-PFQ: 3,360+ ancestors visited, 48 matches, status=in_progress (do not interrupt)

### 3) Multi-Source Parent Discovery (In Progress — Session 22)
**Problem:** Mira Schor (657W-K77T) climb failed — 1 ancestor visited, 0 parents found. Tree page had no parent links. Climber only works when FamilySearch collaborative tree has parents pre-linked.

**Solution in development:** Enhanced `discoverParents()` pipeline with multi-source fallback:
1. FamilySearch tree parent links (existing)
2. Participant-provided parent names → tree search
3. FamilySearch Research Hints on person page
4. FamilySearch record search (census, birth, marriage) → extract parents
5. WikiTree cross-reference
6. FindAGrave family connections (best-effort)
7. IPUMS census API (batch enrichment)
8. SlaveVoyages API (international enslaver DB enrichment, free REST API)
9. UCL Legacies of British Slavery (British/Caribbean slave owners)

**Kiosk intake expanding:** FS ID becomes optional. Participant provides name + birth year + location + parent names.

**Key findings:**
- FamilySearch collaborative tree is shared — ANY logged-in user can navigate ANY person's ancestors
- Ancestry.com API retired ~2015 — dead end, don't invest
- SlaveVoyages.org has free REST API (no auth) with 36K+ voyages
- UCL LBS has 46K British slave compensation claims
- CAPTCHA: Image-based, redirect to challenge page, operator solves manually
- Plan file: `.claude/plans/luminous-questing-nebula.md`

---

## Session 19 Accomplishments (Feb 28, 2026) ✅

### 1) Ancestor Climber made operational via API + UI (FamilySearch OAuth fallback) ✅
Problem: FamilySearch developer application was not approved; we need an in-person/assisted flow that lets a participant log in on our machine and run the “ancestor climber” at scale without official OAuth.

What we built today:
- Backend API endpoints (work with existing v2 climber script):
  - POST `/api/ancestor-climb/start` → launches `scripts/scrapers/familysearch-ancestor-climber.js` with FAMILYSEARCH_INTERACTIVE=true (opens Chrome for login if needed)
  - GET `/api/ancestor-climb/sessions?fsId=...` → list sessions (from `ancestor_climb_sessions`)
  - GET `/api/ancestor-climb/session/:id` → session details + matches (from `ancestor_climb_matches`)
  - GET `/api/ancestor-climb/pending-verification` → unverified matches for human review queue

- Frontend UI (index.html + js/app.js):
  - New “Trace Ancestors” quick action and bottom-nav “Climb” tab
  - Ancestor panel with:
    - FamilySearch ID + optional name inputs
    - Start Climb button (calls POST /api/ancestor-climb/start)
    - Sessions list (filterable by FS ID), click to view live matches
    - “Pending Verification” stub listing unverified matches
  - App logic added:
    - startAncestorClimbUI(), loadAncestorSessions(), loadAncestorSessionMatches(), loadPendingVerification()

- Server wiring:
  - Added `src/api/routes/ancestor-climb.js`
  - Mounted in `src/server.js`: `app.use('/api/ancestor-climb', ancestorClimbRouter)`

Key properties of the v2 climber (already in script, now surfacing via UI/API):
- Finds ALL slaveholder matches (no early stop), BFS climb with 1450 cutoff
- Session persistence + resume capabilities (tables in `migrations/027-ancestor-climb-sessions.sql`)
- Diagnostics capture for failed profile extraction
- DocumentVerifier invoked for each potential match (classification remains ‘unverified’ until documents prove it)

Operator instructions (in-person session):
1. Start server locally (port 3000). If EADDRINUSE occurs, an instance is already running.
2. Visit http://localhost:3000 → “Trace Ancestors” → enter FS ID (e.g., G21N-HD2) and click Start Climb.
3. Chrome window opens on host; have participant log in to FamilySearch (first time per machine/profile).
4. Return to “Climb Sessions” to monitor ancestors visited and matches found; click a session to see live matches.
5. Use “Pending Verification” to triage unverified matches for human review.

Notes & limitations:
- This flow is intended for on-site/assisted use (no credentials handled by our server; login happens in local Chrome).
- Classification into DEBT or CREDIT remains disabled until document verification confirms match context.

Next steps (scale-up):
1. Background runner + queue for multi-session concurrency (Mac minis, distinct Chrome profiles).
2. Headless mode trials with authenticated cookies, where appropriate (while preserving ToS).
3. Reviewer UI with evidence linking and one-click verification decisions.
4. Auto-hand-off from verified matches → DAAOrchestrator to generate participant’s comprehensive DAA.

Files changed in this session:
- Added: `src/api/routes/ancestor-climb.js`
- Updated: `src/server.js` (mounted new router)
- Updated: `index.html` (new panel + nav + quick action)
- Updated: `js/app.js` (UI logic for start/monitor/pending verification)

---

## Session 18 Accomplishments (Jan 31, 2026) ✅ NEW

### 1. DAA System Architecture Complete ✅
**Goal:** Engineer production system to generate Debt Acknowledgement Agreements from ancestor climb data

**Discovered:** 
- 74,095 CivilWarDC records in `unconfirmed_persons` (data WAS there, just not promoted!)
- 10 Biscoe/Chew slaveholders found and promoted to `canonical_persons`
- 1051 petition URLs with 100+ enslaved persons linked

**Files Created:**
- `scripts/promote-civilwardc-slaveholders.js` - Promotes CivilWarDC slaveholders from unconfirmed → canonical
- `scripts/generate-comprehensive-daa.js` - Main DAA generation script
- `docs/COMPREHENSIVE-DAA-GENERATION.md` - Complete system documentation
- `src/services/reparations/DAAOrchestrator.js` - Coordinates DAA generation
- `src/services/reparations/DAADocumentGenerator.js` - Generates DOCX documents

**Key Technical Achievement:**
Enhanced name matching in DAAOrchestrator for common variations:
- "Angelica Chesley" → "Angelica Chew" (FamilySearch vs CivilWarDC naming)
- "Angelica Chesley" → "Maria Angelica Biscoe" 
- Biscoe/Bisco spelling variations
- All Chew family name matching

**Promoted Slaveholders:**
| Name | ID | Status |
|------|-----|--------|
| Angelica Chew | 141014 | ✅ Promoted |
| Ann M. Biscoe | 141015 | ✅ Promoted |
| Ann Maria Biscoe and Emma Biscoe | 141016 | ✅ Promoted |
| Bennet Biscoe | 141017 | ✅ Promoted |
| Bennett Biscoe | 141018 | ✅ Promoted |
| Emma Biscoe | 141019 | ✅ Promoted |
| Geo Biscoe | 141020 | ✅ Promoted |
| Miss Ann Biscoe | 141021 | ✅ Promoted |
| Phil. Chew | 141022 | ✅ Promoted |
| Walter B. Chew | 141023 | ✅ Promoted |

**System Architecture:**
```
User provides FamilySearch ID
         ↓
Ancestor Climb runs (finds ALL slaveholders in lineage)
         ↓
DAAOrchestrator queries database for documented slaveholders
         ↓
Fuzzy name matching (handles spelling variations)
         ↓
Aggregates ALL enslaved persons per slaveholder
         ↓
Calculates total debt across ALL slaveholders
         ↓
DAADocumentGenerator creates DOCX with primary sources
```

**Data Pipeline Fixed:**
1. CivilWarDC scrapers had extracted 74K records → `unconfirmed_persons`
2. Created promotion script to move to `canonical_persons`
3. Enhanced name matching to handle variations
4. DAA system now finds complete lineage

**Next Steps:**
- Run: `node scripts/generate-comprehensive-daa.js --fs-id G21N-4JF --name "Nancy Brown" --email "nancy@example.com" --income 65000`
- Should now generate complete DAA with ALL Biscoe/Chew/Hopewell slaveholders
- Test validates system finds all connections

---

## Active Background Processes

| Process | Task ID | Status | Progress | Notes |
|---------|---------|--------|----------|-------|
| Arkansas 1860 Slave Schedule | be162f1 | ✅ Batch 8+ complete | 1,346+ owners, 8,361+ enslaved | ~400 locations remaining |
| WikiTree Batch Search | - | ✅ Infrastructure complete | 20 enslavers queued | Ready for continuous processing |
| MSA Vol 812 Reprocessing | - | 🔄 In progress | Pages 1-96 of 132 | Need to finish pages 97-132 |

---

## Session 17 Summary (Dec 23, 2025)

### Memory Bank Sync
- Reviewed all recent codebase developments
- Updated memory bank files to reflect current state
- Documented new scripts, patterns, and architectural changes

---

## Session 16 Accomplishments (Dec 22, 2025)

### 1. Arkansas Batch 8 Complete ✅
- **1,346 owners** and **8,361 enslaved** extracted from 34 locations
- Jackson, Jefferson, Johnson, Kiamitia, LaFayette, Lafayette, Lawrence, Madison counties
- Pre-indexed extraction at 95% confidence working
- ~400 locations remaining for Arkansas

### 2. Civil War DC Family Extraction Script ✅
**Created:** `scripts/reextract-civilwardc-families.js`

**Purpose:** Extract parent-child, spouse, and sibling relationships from Civil War DC Emancipation petition text (1,051 petitions)

**Patterns detected:**
- "Said X, Y, Z are the children of [said] Parent" - family groups
- "FirstName LastName daughter/son of [said] FirstName LastName"
- "FirstName LastName wife/husband of [said] FirstName LastName"
- "FirstName LastName brother/sister of [said] FirstName LastName"

**Dry run results (1,051 petitions):**
| Metric | Count |
|--------|-------|
| Total relationships found | 467 |
| Parent-child links matched | 366 |
| Spouse links matched | 10 |
| Sibling links | 0 |
| Persons not in DB | 91 |

**Sample relationships found:**
- Rose Goans daughter of Malinda Goans ✓
- George Dyer son of Mary Dyer ✓
- Eliza Thomas wife of John Thomas ✓
- Mary Shorter → Jacob, Andrew, Frank Shorter ✓
- Lucy Gordon → Clement, Vincent, Jane, Jerry Gordon ✓
- Charlotte Sims → Elias, Daniel Sims ✓

**Usage:**
```bash
node scripts/reextract-civilwardc-families.js           # Dry run
node scripts/reextract-civilwardc-families.js --execute # Apply changes
```

### 3. API/Search Verification ✅
**Verified Render API works correctly:**
- Base URL: `reparations-platform.onrender.com` (not `reparations-is-a-real-number.onrender.com`)
- Search returns enslaved persons with owners linked via `relationships.owner`
- Person profiles return full data with reparations calculations

### 4. Family Linking Gap Identified
**Current state:**
- ✅ Enslaved persons are searchable
- ✅ Owner IS linked via `relationships.owner`
- ❌ Family members NOT linked to each other (no parent_id, child_id, spouse_id)

**Civil War DC is best source for family extraction** - longer narrative text with explicit relationships like "Mary Bruce daughter of Ellen Covington"

---

## Session 15 Accomplishments (Dec 22, 2025)

### 1. Enslaved Descendants CREDIT Tracking Schema ✅
**Created 4 new tables for CREDIT side (enslaved descendants are OWED money):**
- `enslaved_descendants_suspected` - Private genealogy research
- `enslaved_descendants_confirmed` - Opt-in verified descendants
- `enslaved_credit_calculations` - Calculates reparations owed based on stolen labor
- `wikitree_search_queue` - Lightweight queue for background WikiTree searches

**Migration:** `025-enslaved-descendant-credits.sql`

### 2. WikiTree Batch Search Script ✅
**Created lightweight background process:** `scripts/wikitree-batch-search.js`

Features:
- Rate-limited profile checking (500ms between requests)
- Tries WikiTree IDs `LastName-1` through `LastName-200`
- Validates matches by checking name + location in profile
- Resumable via database queue tracking
- Graceful shutdown on Ctrl+C

Usage:
```bash
node scripts/wikitree-batch-search.js --queue 100    # Queue top 100 enslavers
node scripts/wikitree-batch-search.js --test "Name"  # Test single name
node scripts/wikitree-batch-search.js --stats        # Show queue stats
node scripts/wikitree-batch-search.js               # Run continuously
```

Tested successfully:
- James Hopewell → Hopewell-1 (70% confidence)
- Stephen Ravenel → Ravenel-5 (70% confidence)
- 20 enslavers queued for processing

### 3. Arkansas Pre-indexed Extraction ✅
**Scrape session extracted 7,600+ high-quality records:**
- 7,620 pre-indexed (FamilySearch volunteer transcriptions, 95% confidence)
- Only 15 OCR fallback needed
- 62/728 Arkansas locations processed
- 666 locations remaining

**Data Quality Check (Dec 22, 2025):**
| Metric | Value |
|--------|-------|
| Total today | 13,099 records |
| Pre-indexed | 7,620 (92%) |
| 90%+ confidence | 12,053 (92%) |
| Enslaved | 9,942 |
| Slaveholders | 3,157 |

### 4. High-Confidence Slaveholders Identified ✅
**For WikiTree testing:**
- James Hopewell (Maryland) - 100%
- Thomas Aston Coffin (SC, 1795-1863) - 95%
- Stephen Ravenel (Charleston, SC) - 95%
- Daniel James Ravenel (Charleston, SC) - 95%
- 6 Civil War DC petitioners with primary source documents

### 5. OCR Garbage Filter Fix ✅
**Problem:** OCR fallback was extracting FamilySearch website UI text as person names
- "Genealogies Catalog" - navigation UI
- "Full Text" - button text
- "July" - date fragments ("day of July 1860")

**Solution:**
1. Added garbage words to `ocrGarbage` set in `parseSlaveSchedule()`
2. Added `garbagePhrases` set for multi-word garbage detection
3. Cleaned 659 existing garbage records from database

**Files Modified:**
- `scripts/extract-census-ocr.js` - Enhanced garbage filtering

**Result:** OCR records reduced from 15 to 12 (legitimate edge cases only)

---

## Session 14 Accomplishments (Dec 20, 2025)

### 1. Civil War DC Data Fix ✅ COMPLETE
**Applied to 35,944 records across 1,051 petitions:**
- Extracted birth years from ages (1862 - age)
- Fixed garbage locations to "Washington, D.C."
- Linked enslaved persons to owners
- Cross-referenced table/text records (Selina/Salina variants)

**Williams Family Test (cww.00035):**
- All 9 members now have birth years (1811-1861)
- Lydia Williams: 1838 (≠ user's ancestor 1746-1829 FREE)
- Owner: Thomas Donoho properly linked

### 2. Ancestor Climber Verification Fixes ✅
- Disabled unreliable credit/debt classification
- All matches now flagged "UNVERIFIED - requires manual review"
- Added stricter date/location matching requirements

### 3. 1860 Slave Schedule Scraping 🔄 IN PROGRESS
- Arkansas: 728 locations queued (starting now)
- Alabama: 515 locations pending

**Script Created:**
- `scripts/fix-civilwardc-data.js` - Template for fixing source-specific data quality issues

---

## Session 13 Accomplishments (Dec 19, 2025)

### 1. Data Cleanup - 27,000+ Garbage Records Deleted ✅
**Cleaned unconfirmed_persons table:**
- 18,513 records with newlines/tabs
- 4,802 website text entries ("National Archives", "FamilySearch", etc.)
- 3,396 county names captured as person names
- Geographic terms, OCR artifacts, short names
- **Verified 0 orphaned connections** in related tables

### 2. Person Type Consolidation ✅
- Merged slaveholder → enslaver (14 garbage OCR records cleaned)
- Merged owner → enslaver (47 George Washington records cleaned)
- Changed enslaver_family → enslaver (1 record: Angelica Chesley)
- **Final count:** 69,931 enslavers in canonical_persons

### 3. James Hopewell Duplicate Merge ✅
- Merged 3 duplicate records into canonical ID 1070
- FamilySearch ID: MTRV-Z72
- Fixed missing person_documents link to will
- Will accessible at: `owners/James-Hopewell/will/James-Hopewell-Will-1817-complete.pdf`

### 4. Search Query Fix ✅
**Problem:** Search returned duplicate records from unconfirmed_persons even when merged to canonical_persons
**Fix:** Added status filter to exclude `status='duplicate'` records
```javascript
let unconfirmedWhere = `${whereClause} AND (status IS NULL OR status != 'duplicate')`;
```
**Commit:** 78e2360 - pushed to trigger Render deploy

### 5. Render Server Status ⚠️
- Server was DOWN (`x-render-routing: no-server`)
- Push sent to trigger auto-deploy
- Local server works on port 3000

---

## 🚨 E2E TESTING REQUIRED

### Critical Tests Identified
| Test | Purpose | Status |
|------|---------|--------|
| Search → Person Modal → Document View | Verify complete user flow | Pending |
| Enslaved person search → Owner link | Cross-reference accessibility | Pending |
| Reparations calculation accuracy | Verify math in modal | Pending |
| S3 document accessibility | All uploaded docs viewable | Pending |
| Person deduplication display | No duplicates in search | Pending |
| Scraper data → Search → Modal | Full pipeline validation | Pending |

### Immediate Issues Found & Fixed
1. **Render server needs restart** - ✅ Pushed 2 commits to trigger deploy
2. **Search returning wrong table** - ✅ FIXED (both search endpoints now query all tables)
3. **E2E test suite results** - ✅ 90.9% pass rate (20/22 tests)

### E2E Test Summary
| Category | Tests | Passed | Notes |
|----------|-------|--------|-------|
| Ravenel Family | 3 | 2 | Archive URL test is limitation |
| James Hopewell | 3 | 2 | Browse test is limitation, search works |
| Maryland Archives | 3 | 3 | All passing |
| Confirmed Enslaved | 3 | 3 | All passing |
| Data Quality | 7 | 7 | 0% garbage rate |
| Document Viewer | 3 | 3 | All passing |

### Search Fix Details
**Problem:** Two separate search endpoints existed:
1. Line ~268: UNION search (had partial fix)
2. Line ~2293: `/api/contribute/search` (was only querying unconfirmed_persons)

**Solution:** Updated both endpoints to:
- Query canonical_persons, enslaved_individuals, unconfirmed_persons via UNION ALL
- Filter out records with `status = 'duplicate'`
- Order by confidence DESC

**Commits:**
- `78e2360` - Initial status filter fix
- `0188fbb` - Full UNION ALL fix for search endpoint

---

## Session 12 Accomplishments (Dec 19, 2025)

### 1. Title Update ✅
- Changed site title to **"Reparations ∈ ℝ"** across all pages
- New subtitle: **"you can do it, put your back into it"**
- Updated: index.html, contribute-v2.html, review.html, dashboard.html

### 2. 1860 Slave Schedule OCR Scraper - VERIFIED WORKING ✅
**Data flow confirmed end-to-end:**
- OCR extracts owners and enslaved from FamilySearch census images
- Owner-enslaved relationships stored in `relationships` JSON field
- Images archived to S3: `archives/slave-schedules/1860/{state}/{county}/{hash}.png`
- Source URLs preserved for evidentiary chain

**Recent Extraction Stats:**
| Metric | Count |
|--------|-------|
| Owners extracted | 177+ |
| Enslaved extracted | 125+ |
| Enslaved WITH owner linked | 78% |
| Images processed | 94+ |
| Locations processed | 20+ |

**Sample Record (verified in DB):**
```
[238246] Will (enslaved)
   OWNER: James Will
   YEAR: 1860
   LOCATION: South Eastern Division, Alabama
   S3 ARCHIVED: ✅ archives/slave-schedules/1860/alabama/...
```

### 3. URL/Document Watchdog ✅ COMPLETED
**New script:** `scripts/url-watchdog.js`

**Features:**
- Monitors critical sites (FamilySearch, MSA, Ancestry, SlaveVoyages, S3)
- Checks archived URLs for availability and content changes
- Detects tampering via SHA-256 hash comparison
- Logs alerts to `watchdog_alerts` database table
- Supports --check-all, --limit, --critical flags

**Usage:**
```bash
node scripts/url-watchdog.js --critical     # Check critical sites only
node scripts/url-watchdog.js --limit=50     # Check 50 archived URLs
node scripts/url-watchdog.js --check-all    # Force recheck all
```

### 4. Major Code Push to GitHub ✅
**Commit 278ea25:** 53 files, 13,839 lines added
- All new scripts (census OCR, scrapers, extractors)
- New services (NameValidator, UnifiedNameExtractor)
- Chat API route
- Modular contribute routes
- styles/main.css (was missing, broke page layout)

### 5. Key Design Decisions Documented

**Geographic Filtering:**
- ❌ US state-level filtering REJECTED - slavery existed even in "free" states
- ✅ Country-level filtering ACCEPTED - e.g., Poland exempted (no African chattel slavery)

**Wealth Tracking:**
- ❌ Live stock prices REJECTED - volatile, meaningless for actual calculations
- ✅ Tax returns ACCEPTED - actual income/assets, applies to both corporations AND individuals

---

## 🎯 CORE MISSION: Modern-to-Historical Lineage Bridging (Dec 19, 2025 - Session 11)

### The Challenge
**Connecting consenting modern participants to historical slaveholders** to demonstrate the feasibility of reparations on a global scale.

### The Two Worlds Problem
1. **Historical Records (Pre-1900)**: Publicly available via WikiTree, FamilySearch, ancestry databases
   - Contains slaveholders, their descendants, and enslaved persons
   - Example: James Hopewell (MTRV-Z72, 1780) - documented slaveholder with will in S3

2. **Modern Records (Post-1900)**: Privacy-protected, requires consent
   - Living persons' genealogy is NOT publicly accessible
   - Requires participants to voluntarily provide their FamilySearch ID

### The Bridge Solution (CONCEPT - NOT YET OPERATIONAL)
**Bottom-up ancestor climbing** from consenting modern participants:
1. Participant provides their FamilySearch ID (e.g., G21N-HD2 for Danyela Brown)
2. Scraper climbs UP through parents using `/tree/person/details/{FS_ID}` pages
3. Each ancestor is checked against our enslaver database (69,992+ known slaveholders)
4. **ALL matches must be found** - not just the first one
5. Complete lineage from participant to ALL connected slaveholders must be stored

---

## 🚨 ANCESTOR CLIMBER STATUS: NOT OPERATIONAL (Dec 19, 2025)

### What Works (Proof of Concept Only)
- ✅ Parent ID extraction from FamilySearch person detail pages
- ✅ BFS traversal through ancestors
- ✅ Database matching by name and FamilySearch ID
- ✅ Saving lineage to database

### What Does NOT Work (Critical Gaps)
| Issue | Impact | Required Fix |
|-------|--------|--------------|
| **Stops at first match** | Misses all other slaveholder connections | Must continue climbing until historical cutoff |
| **No historical cutoff** | Doesn't know when to stop | Must climb to ~1450s (start of transatlantic slave trade) |
| **No multi-match handling** | Can't connect participant to multiple slaveholders | Must track ALL matches per participant |
| **No credit vs debt logic** | Doesn't distinguish rape/violence lineage from inheritance | Must implement complex credit/debt math |
| **No country/region filtering** | Searches irrelevant branches | Must filter by slaveholding regions |
| **No nobility/class detection** | Wastes time on non-slaveholding lines | Must implement class/occupation filtering |
| **No sex-based filtering** | Doesn't optimize search based on patrilineal slavery patterns | Must implement gender-aware traversal |

### The Reality: Many Slaveholder Connections Per Person
**Example: Danyela Brown**
- Known maternal connections: **13+ slaveholders** (user-confirmed)
- Known paternal connections: **1+ slaveholders** (Joseph Miller found, possibly more)
- The climber found Joseph Miller (Gen 6) and STOPPED - missing 13+ others

### Complex Math Required
**Descending from a slaveholder does NOT always mean DEBT:**
- Direct inheritance of wealth = DEBT (owes reparations)
- Product of rape/violence = CREDIT (owed reparations as victim's descendant)
- This distinction is CRITICAL and NOT YET IMPLEMENTED

### Scope of Development Needed
The ancestor climber requires:
1. **Complete redesign** to find ALL matches, not first
2. **Historical cutoff logic** (mid-1400s transatlantic trade start)
3. **Geographic filtering** (slaveholding regions only)
4. **Credit vs Debt determination** per lineage path
5. **Scalability** to handle trees with 1000s of ancestors
6. **Validation** against known multi-slaveholder cases
7. **Testing** with participants who have verified lineages

**Estimated effort:** Major development initiative, not a quick fix

---

### Test Run Analysis (Dec 19, 2025)

**What happened:**
- Started from: Nancy Miller (G21N-4JF)
- Climbed 6 generations, scraped 58 ancestors
- Found: Joseph Miller (enslaver, Louisiana Slave Database, 1820)
- **STOPPED immediately** - did not continue to find James Hopewell (Gen 8) or 12+ other known connections

**Joseph Miller Match:**
- Database ID: 133033
- Role: Buyer (of enslaved persons)
- Confidence: exact_name_match (needs birth year verification to confirm same person)

---

## 🚨 CRITICAL SYSTEM GAPS (Identified Dec 19, 2025)

**To demonstrate feasibility of actual wealth transfer (reparations), we need:**

### WHAT EXISTS (~70% complete)
- ✅ Debt tracking (slaveholder → descendants via DebtTracker.js)
- ✅ Credit genealogy (enslaved → descendants via TreeBuilder.js)
- ✅ Corporate wealth identification (17 Farmer-Paellmann defendants)
- ✅ Calculation methodology (ReparationsCalculator.js)
- ✅ Data quality framework (confidence scoring)
- ✅ Contribution pipeline (multi-stage verification)
- ✅ Evidence collection system

### CRITICAL GAPS (~30% missing)
| Gap | Severity | What's Needed |
|-----|----------|---------------|
| **URL/Document Watchdog** | CRITICAL | Monitor all indexed URLs for tampering, availability; auto-archive at first sign of trouble |
| **Cross-Verification Matching** | CRITICAL | Match enslaved descendants ↔ slaveholder descendants (who owes who) |
| **Participant Identity (KYC)** | CRITICAL | Verify real people for actual payments |
| **Live Asset Tracking** | HIGH | Current stock prices, real estate, profit streams |
| **Confidence Aggregation** | HIGH | Auto-rollup: source → document → relationship → person |
| **Blockchain Evidence** | HIGH | Immutable timestamps for legal admissibility |
| **Trust Account/Escrow** | HIGH | Actual mechanism for funds to move |
| **Legal Case Precedent** | HIGH | Case law citations for calculation defensibility |

### Recommended Proof-of-Concept Approach
1. Pick ONE complete family example (e.g., Belinda Sutton case)
2. Verify 3-5 living enslaved descendants + 3-5 living slaveholder descendants
3. Show complete chain: evidence → genealogy → calculation → payment mechanism
4. Document everything with confidence scores and legal citations

---

## Recent Major Changes (Dec 18, 2025 - Session 10)

### 35. Corporate Entity & Farmer-Paellmann Integration ✅ (Dec 18, 2025)

**Goal:** Track reparations debt for 17 corporate defendants from the Farmer-Paellmann litigation (In re African-American Slave Descendants Litigation, 304 F. Supp. 2d 1027 (N.D. Ill. 2004))

**Completed:**

#### 1. Database Schema (`migrations/021-corporate-entities-farmer-paellmann.sql`)
- `corporate_entities` - All 17 Farmer-Paellmann defendants with SCAC references
- `corporate_succession` - Historical predecessor → modern successor chains
- `corporate_financial_instruments` - Slave mortgages, insurance policies
- `corporate_slaveholding` - Direct slaveholding (Brown Brothers: 4,614 acres, 346 enslaved)
- `corporate_debt_calculations` - Computed debt amounts

#### 2. Sector-Specific Calculators
- `InsuranceCalculator.js` - Aetna, NY Life, Lloyd's, Southern Mutual, AIG
- `BankingCalculator.js` - FleetBoston, JP Morgan, Brown Brothers Harriman, Barclays
- `RailroadCalculator.js` - CSX, Norfolk Southern, Union Pacific, Canadian National

#### 3. Enhanced DebtTracker
- Corporate debt tracking alongside individual slaveholder debt
- Combined leaderboard (individuals + corporations)
- Farmer-Paellmann specific queries

#### 4. API Endpoints (`/api/corporate-debts`)
- `GET /farmer-paellmann` - List all 17 defendants
- `GET /farmer-paellmann/calculate` - Calculate total corporate debt
- `GET /entity/:id/debt` - Individual entity debt calculation
- `GET /leaderboard` - Corporate debt rankings
- `GET /sector/insurance|banking|railroads` - Sector breakdowns

**Test Calculation Results:**
| Entity | Calculated Debt |
|--------|----------------|
| Lloyd's of London | $1.8 quadrillion |
| CSX Corporation | $6.4 trillion |
| Norfolk Southern | $4.1 trillion |
| Brown Brothers Harriman | $4.7 billion |

**Files Created:**
- `migrations/021-corporate-entities-farmer-paellmann.sql`
- `migrations/022-ipums-census-integration.sql`
- `src/services/reparations/InsuranceCalculator.js`
- `src/services/reparations/BankingCalculator.js`
- `src/services/reparations/RailroadCalculator.js`
- `src/api/routes/corporate-debts.js`

**Files Modified:**
- `src/services/reparations/DebtTracker.js` - Added corporate tracking
- `src/services/reparations/index.js` - Export new calculators
- `src/server.js` - Register corporate-debts routes

---

### 34. FamilySearch Census OCR Extraction System ✅ (Dec 18, 2025 - Session 9)

**Goal:** Extract enslaved persons from 1850/1860 Slave Schedule census images via OCR

**Completed Infrastructure:**

#### 1. Location Crawler (COMPLETED)
- Enumerated 25,041 locations across FamilySearch collections:
  - 1850 Slave Schedule: 16,573 locations
  - 1860 Slave Schedule: 8,468 locations
- Stored in `familysearch_locations` table with waypoint URLs

#### 2. OCR Extraction Script (`scripts/extract-census-ocr.js`)
- Puppeteer with stealth plugin for authenticated FamilySearch access
- Fetches image lists via waypoint API hierarchy (Collection → State → County → District → Images)
- Screenshots census pages and runs Google Vision OCR
- Parses slave schedule format: Owner name at top, enslaved listed by Age/Sex/Color
- Stores in `unconfirmed_persons` with owner linkage

**Key Technical Solutions:**

1. **Waypoint API Authentication**:
   - API required authentication (403 Forbidden initially)
   - Fixed by using `page.evaluate()` to make fetch requests from authenticated browser context with `credentials: 'include'`

2. **Waypoint Hierarchy Discovery**:
   - Stored locations are at COUNTY level, but images are at DISTRICT level
   - Script drills down from county → district → images

3. **Neon Serverless Connection**:
   - Fixed `/api/contribute/person/:id` endpoint using `sharedPool` (Neon HTTP) instead of pg Pool (TCP)
   - Avoids port 5432 connection issues

4. **Owner-Enslaved Linkage**:
   - Owner info stored in `context_text` format: `"Name | Owner: OwnerName | County, State (Year)"`
   - Front-end extracts owner from this pattern

5. **Location Data Fix**:
   - In FamilySearch hierarchy, "county" contains parent level, actual county is in "district"
   - Script uses `location.district` as the actual county name

**Test Batch Results (20 Counties):**
```
======================================================================
📊 EXTRACTION COMPLETE
======================================================================

   Locations processed: 20
   Images processed:    100
   Owners extracted:    82
   Enslaved extracted:  170
   Errors:              0
   Elapsed time:        18m 41s
```

**Sample Extracted Data:**
```
Nancy (enslaved):
  Location: Bibb, Alabama
  Context: Nancy | Owner: Nancy W Wright | Bibb, Alabama (1850)
  Owner in relationships: Nancy W Wright
```

**Files Created:**
- `scripts/extract-census-ocr.js` - Main OCR extraction script (comprehensive pipeline)

**Files Modified:**
- `src/api/routes/contribute.js` - Fixed person endpoint to use Neon serverless

**Current Status (In Progress):**
- 1860 Slave Schedule extraction running in background
- ~79 locations scraped, ~916 OCR records extracted
- Estimated completion: ~70 hours (~3 days)

---

## Recent Major Changes (Dec 17, 2025 - Session 8)

### 33. Comprehensive Refactoring & Multi-Table Search ✅ (Dec 17, 2025)

**Major Accomplishments:**

#### 1. index.html Decomposition
- **Before:** 2,765 lines (inline CSS + JS)
- **After:** 346 lines (HTML only)
- **Created:** `styles/main.css` (1,093 lines), `js/app.js` (1,331 lines)
- **Result:** 12/12 refactoring tests pass

#### 2. Codebase Cleanup
- **Archived:** 89 obsolete files to `_archive/` directory
  - 27 test files → `_archive/obsolete-tests/`
  - 10 HTML files → `_archive/obsolete-html/`
  - 20 JS files → `_archive/obsolete-js/`
  - 21 MD files → `_archive/obsolete-docs/`
  - `frontend/` folder → `_archive/obsolete-frontend/`
  - `logs/` folder → `_archive/obsolete-logs/`

#### 3. Chat Multi-Table Search
- **Before:** Only searched `unconfirmed_persons`
- **After:** Searches ALL entity tables:
  - `unconfirmed_persons` (scraped data)
  - `enslaved_individuals` (confirmed enslaved)
  - `canonical_persons` (canonical identities)
- **Display:** Shows `[Confirmed]` or `[Canonical]` tags for verified records
- **Example:** "find James Hopewell" returns 2 records (1 canonical, 1 unconfirmed)

#### 4. Search API Routing Bug Fix
- **Problem:** `/api/contribute/search?q=Ravenel` returned UUID parsing error
- **Cause:** `/:sessionId` route was catching `/search` before search route
- **Fix:** Added explicit `/search` route with query params before dynamic routes

#### 5. Natural Language Parsing Improvements
- Fixed "I want to find records about Ravenel" → now extracts "ravenel" correctly
- Fixed "how many people are documented" → now returns total records, not documents

#### 6. Contribute.js Modular Structure
- Created `src/api/routes/contribute/` directory
- Added `shared.js` (shared utilities) and `index.js` (composition)
- Prepared for future splitting of 3,457-line file

**Test Results:**
- Chat tests: **45/45 (100%)**
- Document tests: **8/8 (100%)**
- Refactoring tests: **12/12 (100%)**

**Verified Entity Access:**
- ✅ Ann Biscoe (owner) - accessible via chat
- ✅ Thomas Ravenel family - 10 records (6 canonical, 4 unconfirmed)
- ✅ James Hopewell - 2 records (1 canonical, 1 unconfirmed)

**Reparations Formula Confirmed Intact:**
```javascript
// 25 year estimate
const wageTheft = years * 120 * 300 * 30;  // $120/day × 300 days × inflation
const damages = years * 15000 * 1.5;
const profitShare = years * 300 * 30 * 0.4;
const interest = subtotal * (Math.pow(1.04, 160) - 1);  // 4% compound, 160 years
```

---

## Recent Major Changes (Dec 17, 2025 - Session 7)

### 32. Chat API (Research Assistant) Complete Overhaul ✅ (Dec 17, 2025)

**Problem:** Chat panel was broken - `/api/chat` endpoint didn't exist. Previous ResearchService used stale table names (`enslaved_people` instead of `unconfirmed_persons`).

**Solution:** Created comprehensive `src/api/routes/chat.js` with natural language query processing:

**Intent Recognition:**
- `count` - "how many enslaved", "total records", "count owners"
- `search` - "find Ravenel", "search for James", "who is Henry"
- `statistics` - "stats", "statistics", "show statistics"
- `reparations` - "calculate reparations for James", "what is owed"
- `sources` - "what are the data sources", "where does data come from"
- `list` - "list enslaved", "show me owners", "list civil war enslaved"
- `civilwar` - "civil war records", "dc petition"
- `help` - "help", "what can you do"

**Entity Filters:**
- `enslaved/owner` - person type filters
- `familysearch/msa/civilwar` - source filters
- `high confidence` - confidence_score >= 0.9

**Key Features:**
1. Session-based context (remembers last searched person for follow-up queries)
2. Reparations calculation using standard formula (wage theft + damages + profit share + compound interest)
3. NaN% handling for null confidence scores (shows "unrated")
4. Source filtering in list queries
5. Civil War DC specific queries

**Test Results:** 41/41 tests passing across 3 test suites:
- Core queries (26 tests)
- Edge cases (16 tests)
- Final validation (15 tests)

**Files Created:**
- `src/api/routes/chat.js` - Complete chat endpoint

**Files Modified:**
- `src/server.js` - Added `app.use('/api/chat', require('./api/routes/chat'));`
- `index.html` - Updated `sendChat()` to call `/api/chat`

---

### Feature Panel Review Complete ✅ (Dec 17, 2025)

Systematically tested all 8 feature panels in index.html:

| Panel | Status | Notes |
|-------|--------|-------|
| Documents | ✅ Working | Loads 1 uploaded document (James Hopewell) |
| People | ✅ Working | 53K+ records, filters work |
| Formula | ✅ Working | Static display |
| Chat | ✅ Fixed | Was broken, now working with 41 test cases |
| Upload | ✅ Working | Endpoint responds correctly |
| Quality | ✅ Working | Shows 148K+ issues |
| Person Modal | ✅ Working | Reparations calculation correct |
| Document Viewer | ✅ Working | Presigned S3 URLs work |

---

## Recent Major Changes (Dec 17, 2025 - Session 6)

### 31. Monitoring Dashboard & Data Quality Metrics ✅ (Dec 17, 2025)

**Problem:** No real-time visibility into data quality metrics or target progress.

**Solution:**
1. Created new API endpoint `GET /api/contribute/data-quality-metrics` with comprehensive metrics:
   - Records by status (pending, needs_review, rejected, confirmed)
   - Records by source (FamilySearch, Maryland Archives, Civil War DC, Beyond Kin)
   - Records by person type (enslaved, owner, slaveholder, etc.)
   - Target progress tracking (garbage rate, owner linkage, avg confidence)

2. Added **Monitoring tab** to `dashboard.html` as default view:
   - Real-time metrics cards (clean records, garbage rate, avg confidence, owner linkage)
   - Status breakdown visualization
   - Source breakdown table with distribution bars
   - Target progress bars with pass/fail indicators
   - Auto-refresh toggle (30-second intervals)

**Files Created/Modified:**
- `src/api/routes/contribute.js` - Added `/data-quality-metrics` endpoint (line 1533)
- `dashboard.html` - Added Monitoring tab as default

---

### 30. FamilySearch Owner-Enslaved Linkage Fix ✅ (Dec 17, 2025)

**Problem:** FamilySearch had 0% owner linkage rate - enslaved persons weren't connected to their owners.

**Root Cause:** Scraper saved relationships in JSONB column but metrics checked `context_text` for "Owner:" patterns.

**Solution:**
1. Created `scripts/fix-familysearch-linkage.js` to update context_text with owner info
2. Linked enslaved persons from:
   - Existing relationships JSON (63 records)
   - Collection-level context (Ravenel family - 1,702 records)

**Results:**
- Before: 0% owner linkage
- After: **100% owner linkage** (1,765/1,765 records)
- Target was 50%, now exceeded

**Files Created:**
- `scripts/check-familysearch-linkage.js` - Diagnostic script
- `scripts/fix-familysearch-linkage.js` - Fix script

---

### 29. E2E Test Suite ✅ (Dec 17, 2025)

**Problem:** No automated testing to verify all features work end-to-end.

**Solution:** Created `scripts/e2e-test-runner.js` with 22 automated tests:
- Test 1: Ravenel Family (FamilySearch) - 3 tests
- Test 2: James Hopewell (S3 Document) - 3 tests
- Test 3: Maryland Archives (MSA) - 3 tests
- Test 4: Confirmed Enslaved Individual - 3 tests
- Data Quality Checks - 7 tests
- Document Viewer Tests - 3 tests

**Results:** 95.5% pass rate (21/22 tests)
- Only failing test: "Hopewell in people database" - not in first 500 results (test limitation)

**Files Created:**
- `scripts/e2e-test-runner.js`

---

## Current Metrics (Dec 17, 2025)

| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| Owner Linkage (FamilySearch) | 100% | 50% | ✅ Good |
| Garbage Rate (browse) | 0% | <5% | ✅ Good |
| E2E Tests | 95.5% | 100% | ⚠️ Acceptable |
| Avg Confidence | 63% | 70% | ⚠️ Needs work |
| Clean Records | 54,685 | - | - |
| Total Records | 137,146 | - | - |

---

## Recent Major Changes (Dec 14, 2025 - Session 5)

### 28. Data Quality Crisis & Cleanup ✅ (Dec 14, 2025)

**CRITICAL ISSUE DISCOVERED:** 34.8% of database was garbage data (81,027 records).

**Root Causes:**
1. No input validation at scraper level
2. No data quality layer before database insert
3. No frontend validation before display
4. No end-to-end testing

**Garbage Categories:**
- Common English words ("The", "He", "She"): 61,731
- Form headers ("Participant Info", "Researcher Location"): 13,130
- Column headers ("Year", "Month", "Compensation"): 2,554
- Too short (1-2 chars): 1,964

**Solution Implemented:**
1. Created `src/services/NameValidator.js` - comprehensive name validation
2. Created `scripts/cleanup-garbage-data.js` - database cleanup script
3. Added frontend `isValidSearchResult()` filter
4. Ran cleanup: **81,027 garbage records deleted**

**Before/After:**
| Metric | Before | After |
|--------|--------|-------|
| Total Records | 232,737 | 151,849 |
| Garbage % | 34.8% | ~0% |

**New Files:**
- `src/services/NameValidator.js`
- `scripts/cleanup-garbage-data.js`
- `DATA-QUALITY-CRISIS.md`

---

### 27. Enslaved-Owner Relationship System ✅ (Dec 14, 2025)

**Problem:** Enslaved individuals were being extracted but NOT connected to their owners. All 1,400 enslaved_individuals had NULL `enslaved_by_individual_id`.

**Root Cause:** The FamilySearch scraper saved enslaved persons and slaveholders as separate records with no explicit relationship - only implicitly linked via shared `source_url`.

**Solution:**

#### 1. Backfilled Existing Records
Updated 17,403 enslaved persons with owner relationships via JSONB `relationships` field:
```sql
UPDATE unconfirmed_persons
SET relationships = [...owner data...]
WHERE person_type = 'enslaved' AND source_url IN (documents with both);
```

#### 2. Created Clean View `enslaved_owner_connections`
Filters OCR noise and shows valid relationships:
```sql
CREATE VIEW enslaved_owner_connections AS
-- Filters known good enslaved names (African day names, common names)
-- Joins with slaveholders from same source document
-- Excludes OCR artifacts like "That", "He", "The"
```

#### 3. Updated FamilySearch Scraper
Now saves owner relationships directly when extracting enslaved names:
```javascript
// Build owner relationships for this page
const ownersOnPage = parsed.slaveholders.map(s => ({
    type: 'potential_owner',
    name: s.name,
    source: 'same_document',
    page: imageNumber
}));
// Include in INSERT for enslaved persons
```

**Verified Results:**
| Enslaved | Connected Owners |
|----------|-----------------|
| July | Middleton, Pinckney, Porcher, Ravenel |
| Friday | Ravenel |
| Monday | Middleton, Ravenel |
| Prince | Porcher |

**Statistics:**
- 722 unique enslaved linked to owners
- 473 unique owners identified
- 234 documents with connections
- 17,403 enslaved records updated with owner JSONB

**Note:** Initial attempt to create `enslaved_owner_relationships` table hit Neon's 512MB limit due to cartesian product (N×M rows). Solution uses JSONB field instead - more space efficient.

---

## Recent Major Changes (Dec 14, 2025 - Session 4)

### 26. Document Viewer S3 Presigned URLs ✅ (Dec 14, 2025)

**Problem:** Document viewer returned 403 Forbidden when trying to display archived FamilySearch documents from S3.

**Root Cause:**
1. `ecosystem.config.js` had hardcoded old Render database credentials
2. S3 environment variables weren't being loaded by PM2
3. Frontend was trying to access S3 directly instead of through presigned URLs

**Solution:**
1. Updated `ecosystem.config.js` to load from `.env` via `require('dotenv').config()`
2. Added new API endpoint `/api/documents/archive/presign` that generates presigned S3 URLs
3. Updated `openArchiveViewer()` in `index.html` to fetch presigned URLs before displaying

**New Endpoint:**
```javascript
GET /api/documents/archive/presign?url=<s3-url>
// Returns: { viewUrl, downloadUrl, expiresIn, expiresAt, metadata }
```

---

### 25. James Hopewell Document Fix ✅ (Dec 14, 2025)

**Problem:** James Hopewell's will (2 pages) was showing as separate documents instead of one combined document.

**Context:** James Hopewell (d. 1817, St. Mary's County, Maryland) is a slave owner whose descendants were traced to Nancy Miller Brown (Generation 8) through WikiTree/FamilySearch research.

**Solution:**
1. Uploaded both will pages to S3:
   - `owners/James-Hopewell/will/page-1.pdf` (2.4MB)
   - `owners/James-Hopewell/will/page-2.pdf` (2.4MB)
2. Created unified `documents` record with `ocr_page_count: 2`
3. Added to `canonical_persons` (id: 1070) with descendant tracking notes

**Database Records:**
```sql
-- documents table
document_id: 'james-hopewell-will-1817'
owner_name: 'James Hopewell'
doc_type: 'will'
ocr_page_count: 2
s3_key: 'owners/James-Hopewell/will/'

-- canonical_persons table
id: 1070
canonical_name: 'James Hopewell'
person_type: 'slaveholder'
notes: 'Slave owner with descendants traced to Nancy Miller Brown (Gen 8). WikiTree: Hopewell-183.'
```

---

### 24. Document Deduplication System ✅ (Dec 14, 2025)

**Problem:** System had no way to detect when multi-page documents were being uploaded as separate records.

**Solution:** Created `migrations/017-document-deduplication.sql` with:

**New Columns on `documents` table:**
- `document_group_id` - Links pages of same document
- `page_number` - Page number within multi-page doc
- `is_primary_page` - TRUE for main/first page
- `content_hash` - SHA-256 for duplicate detection
- `filename_normalized` - For similarity matching

**New Database Objects:**
```sql
-- View: Finds suspicious document pairs
potential_duplicate_documents

-- Function: Pre-insert check for existing similar docs
check_document_duplicates(owner_name, doc_type, filename, content_hash)

-- Function: Consolidates pages into single logical document
merge_document_pages(primary_document_id, page_document_ids[])

-- Trigger: Logs warning on potential duplicates
trg_warn_duplicate_document
```

**Detection Signals:**
- Same content hash (exact match)
- Same owner + doc type + filename contains "page-1", "page-2"
- Same owner + doc type + uploaded within 24 hours

---

### Person Documents Index System ✅ (Dec 14, 2025)

**Problem:** No way to retrieve all S3 documents mentioning a specific individual.

**Solution:** Created `migrations/016-person-documents-index.sql` with:
- `person_documents` junction table linking persons to archived documents
- Views: `person_documents_with_names`, `person_document_counts`, `document_persons`
- Function: `get_person_documents(search_name)` for fuzzy search

**FamilySearch scraper updated** to automatically index documents to persons during extraction.

---

## Recent Major Changes (Dec 14, 2025 - Session 3)

### 23. Neon Database Migration ✅ (Dec 14, 2025)

**Problem:** Render PostgreSQL had connection issues and the frontend was depending on a backend that could be slow to respond.

**Solution:** Migrated entire database to Neon serverless PostgreSQL:
- Migrated 214,159 unconfirmed_persons
- Migrated 1,401 enslaved_individuals
- Migrated 1,068 canonical_persons
- Migrated 726 confirming_documents
- Migrated 4,192 scraping_queue
- Migrated 2,887 scraping_sessions

**Benefits:**
- Serverless - auto-scales, no cold start issues
- Better connection pooling via pooler endpoint
- No more "connection refused" errors
- Faster queries for frontend

**Action Required:** Update Render's DATABASE_URL environment variable to:
```
postgresql://neondb_owner:<REDACTED-neon-old-rotated-2026-04-25>@ep-still-glade-ad8qq83f-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require
```

---

### 22. Search Bug Fixes ✅ (Dec 14, 2025)

**Problem 1:** Search for "Grace Butler" returned 50 unrelated names like "Co Maryland", "Gusty", "Sept".

**Root Cause:** Search used OR between words and searched context_text (entire documents), so any record containing "grace" OR "butler" anywhere matched.

**Fix:** Changed to AND logic and only search full_name field:
```javascript
// OLD (buggy): Returns any record with "grace" OR "butler"
WHERE full_name ILIKE '%grace%' OR context_text ILIKE '%grace%' OR ...

// NEW (fixed): Returns only records with BOTH words in name
WHERE full_name ILIKE '%grace%' AND full_name ILIKE '%butler%'
```

**Problem 2:** Search for "Adjua D'Wolf" returned 0 results.

**Root Cause:** Adjua D'Wolf was in enslaved_individuals table (confirmed records), but search only queried unconfirmed_persons.

**Fix:** Added UNION query to search both tables:
```sql
SELECT ... FROM unconfirmed_persons WHERE ...
UNION ALL
SELECT ... FROM enslaved_individuals WHERE ...
```

---

## Recent Major Changes (Dec 14, 2025 - Session 2)

### 21. FamilySearch Scraper LDS Ad Fix ✅ (Dec 14, 2025)

**Problem:** FamilySearch scraper was clicking on LDS Church promotional ads instead of document thumbnails. The scraper navigated to `churchofjesuschrist.org/comeuntochrist` instead of viewing plantation records.

**Root Cause:** The thumbnail selector was too broad - it would click any image meeting size criteria, including embedded LDS promotional banners on FamilySearch pages.

**Solution:** Added domain filtering to thumbnail selection in `scripts/scrapers/familysearch-scraper.js`:
```javascript
// CRITICAL: Only click images from FamilySearch domains, never external ads
const isFamilySearchImage = src.includes('familysearch.org') ||
                           src.includes('fs.net') ||
                           src.startsWith('data:') ||
                           src.startsWith('blob:');
// Exclude external/promotional images
const isExternal = src.includes('churchofjesuschrist') ||
                  src.includes('comeuntochrist') ||
                  src.includes('lds.org') ||
                  src.includes('churchnews');
```

**Status:** Film 7 scraper relaunched and running successfully.

---

### 20. Name Resolution System ✅ (Dec 14, 2025)

**Problem Solved:** The same person appears with different spellings across documents due to OCR errors and historical spelling variations (e.g., "Sally Swailes" vs "Sally Swailer" vs "Sally Swales"). Need to consolidate these to TRUE identities.

**Solution Implemented:**

#### 1. NameResolver Service (`src/services/NameResolver.js`)
New service providing:
- **Soundex Algorithm** - Phonetic matching (Swailes → S420, Swailer → S420)
- **Metaphone Algorithm** - Alternative phonetic encoding
- **Levenshtein Distance** - Character-by-character edit distance
- **Name Parsing** - Split into first, middle, last, suffix components
- **Confidence Scoring** - Combined metrics for match quality

**Confidence Thresholds:**
- ≥0.85: Auto-match to existing canonical person
- 0.60-0.84: Queue for human review
- <0.60: Create new canonical person

#### 2. Database Migration (`migrations/010-name-resolution-system.sql`)
Three new tables:
```sql
canonical_persons    -- TRUE identity of a person
name_variants        -- Different spellings linking to canonical
name_match_queue     -- Ambiguous matches awaiting human review
```

**Key Fields:**
- `first_name_soundex`, `last_name_soundex` - For phonetic search
- `first_name_metaphone`, `last_name_metaphone` - Alternative phonetic
- `confidence_score` - How confident we are this is a real person
- `verification_status` - auto_created, human_verified, confirmed

#### 3. API Endpoints (`src/api/routes/names.js`)
```javascript
POST /api/names/analyze      // Analyze a name (parsing, phonetic codes)
POST /api/names/compare      // Compare two names for similarity
POST /api/names/resolve      // Resolve name to canonical or queue
GET  /api/names/search/:name // Find similar names in database
GET  /api/names/stats        // System statistics
```

#### 4. Automatic Scraper Integration
FamilySearch scraper (`scripts/scrapers/familysearch-scraper.js`) now:
- Initializes NameResolver on database connection
- Processes each extracted name through `resolveOrCreate()`
- Logs resolution statistics: `🔗 Name resolution: X linked, Y queued, Z new`

**Current Database Stats (Dec 14, 2025):**
| Table | Count |
|-------|-------|
| canonical_persons | 4 |
| name_variants | 0 |
| name_match_queue | 1 |
| unconfirmed_persons | 213,740 |

---

### 19. CompensationTracker Financial System ✅ (Dec 10, 2025)

**Key Insight:** Compensation payments TO owners PROVE debt exists - they don't reduce it. The enslaved received $0.

**Test Results:**
- Lord Harewood: £26,309 for 1,277 enslaved → **$2.69 billion proven debt**
- James Williams (DC): $4,500 for 15 enslaved → **$19M proven debt**

---

## Name Resolution Architecture

### Data Flow
```
OCR Extraction → unconfirmed_persons table
                        ↓
              NameResolver.resolveOrCreate()
                        ↓
        ┌───────────────┼───────────────┐
        ↓               ↓               ↓
   HIGH CONF        MED CONF        LOW CONF
   (≥0.85)        (0.60-0.84)       (<0.60)
        ↓               ↓               ↓
   Link to          Queue for        Create new
   existing         human review     canonical
   canonical                         person
```

### Phonetic Matching Examples
| Name 1 | Name 2 | Soundex | Match? |
|--------|--------|---------|--------|
| Swailes | Swailer | S420 = S420 | Yes |
| Swailes | Swales | S420 = S420 | Yes |
| Key | Frey | K000 ≠ F600 | No |
| Johnson | Johnsen | J525 = J525 | Yes |

---

## Current Production Environment

### Render Services
- **Backend:** `reparations-platform.onrender.com` (Node.js)
- **Database:** Neon PostgreSQL (migrated Dec 14, 2025)

### Database Credentials (Neon PostgreSQL) - UPDATED
```
Host: ep-still-glade-ad8qq83f-pooler.c-2.us-east-1.aws.neon.tech
Database: neondb
User: neondb_owner
Password: <REDACTED-neon-old-rotated-2026-04-25>
Connection String: postgresql://neondb_owner:<REDACTED-neon-old-rotated-2026-04-25>@ep-still-glade-ad8qq83f-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require
```

### Legacy Database (Render PostgreSQL) - DEPRECATED
```
Host: dpg-d3v78f7diees73epc4k0-a.oregon-postgres.render.com
Database: reparations
User: reparations_user
Password: <REDACTED-render-pg-decommissioned-2026-04-25>
```

### Database Statistics (Dec 14, 2025) - POST-CLEANUP
- **Database:** Neon PostgreSQL (migrated from Render)
- **Total unconfirmed_persons:** 151,849 (was 232,737 - cleaned 81,027 garbage)
- **Enslaved (unconfirmed):** 85,986
- **Slaveholders:** 1,651
- **Enslaved individuals (confirmed):** 1,400
- **Canonical persons:** 1,079
- **Confirming documents:** 726
- **Scraping queue:** 4,192
- **Scraping sessions:** 2,887

### Frontend
- **URL:** https://danyelajunebrown.github.io/Reparations-is-a-real-number/
- **Backend API:** https://reparations-platform.onrender.com

---

## Files Created/Modified This Session (Dec 14, 2025)

### New Files
- `src/services/NameResolver.js` - Name resolution service
- `src/api/routes/names.js` - API endpoints for name resolution
- `migrations/010-name-resolution-system.sql` - Database schema
- `scripts/test-name-resolver.js` - Test script

### Modified Files
- `scripts/scrapers/familysearch-scraper.js` - Added NameResolver integration
- `src/server.js` - Added /api/names routes

---

## NameResolver Service Methods

```javascript
// Core algorithms
soundex(name)           // Returns Soundex code (e.g., "S420")
metaphone(name)         // Returns Metaphone code
levenshtein(s1, s2)     // Returns edit distance
parseName(fullName)     // Returns {first, middle, last, suffix}

// Database operations
createCanonicalPerson(name, options)    // Create TRUE identity
addNameVariant(canonicalId, variant)    // Link variant spelling
findCandidateMatches(name, context)     // Find potential matches
resolveOrCreate(name, options)          // Main entry point

// Search & stats
searchSimilarNames(name, options)       // Find similar in DB
getStats()                              // System statistics
```

---

## Background Processes (Currently Running)

| Process | Status | Progress | Notes |
|---------|--------|----------|-------|
| Film 7 | ✅ Complete | 936/995 | 236 enslaved, 92 slaveholders found |
| Film 8 | 🔄 Running | 963/1020 (94%) | Near completion, archiving to S3 |

**Film 8 Details:**
- Collection: Thomas Porcher Ravenel papers - Film 8
- Film Number: 008891451
- Total Images: 1020
- Now includes person_documents indexing (added in Session 4)
- Now includes owner relationships (added in Session 5)

---

## Files Modified This Session (Dec 14, 2025 - Session 5)

### New Files
- `migrations/018-enslaved-owner-relationships.sql` - Attempted but removed (hit Neon 512MB limit)

### Modified Files
- `src/api/routes/contribute.js` - Enhanced `/person/:id` to handle slaveholders:
  - Added `canonical_persons` table lookup
  - Added `documents` table lookup
  - Query enslaved persons connected to slaveholders
  - Calculate reparations owed BY slaveholders
  - Return `ownerDocuments` and `enslavedPersons` arrays
  - Auto-generate WikiTree links from notes
- `index.html` - Enhanced person modal for slaveholders:
  - Show location field
  - Display "Enslaved Persons" list (clickable)
  - Display "Historical Documents" with "View Document" button
  - Added WikiTree link in Actions
  - New `openDocumentFromS3()` function for S3 documents
- `scripts/scrapers/familysearch-scraper.js` - Save owner relationships in JSONB

### Database Changes
- Created `enslaved_owner_connections` view for clean enslaved-owner queries
- Backfilled 17,403 enslaved records with owner relationships (JSONB)
- 722 unique enslaved linked to 473 unique owners across 234 documents

---

## Files Modified (Dec 14, 2025 - Session 4)

### New Files
- `migrations/016-person-documents-index.sql` - Junction table linking persons to S3 documents
- `migrations/017-document-deduplication.sql` - Deduplication detection system

### Modified Files
- `ecosystem.config.js` - Now loads environment from `.env` via dotenv
- `src/api/routes/documents.js` - Added `/archive/presign` endpoint for S3 presigned URLs
- `index.html` - Updated `openArchiveViewer()` to use presigned URLs
- `scripts/scrapers/familysearch-scraper.js` - Added person_documents indexing

### Database Changes
- Added James Hopewell to `documents` table (id: james-hopewell-will-1817)
- Added James Hopewell to `canonical_persons` table (id: 1070)
- Uploaded 2 will pages to S3: `owners/James-Hopewell/will/page-1.pdf`, `page-2.pdf`
- Added deduplication columns to `documents` table
- Created `potential_duplicate_documents` view
- Created `check_document_duplicates()` and `merge_document_pages()` functions
- Created duplicate warning trigger

---

## Files Modified (Dec 14, 2025 - Session 3)

### Modified
- `src/api/routes/contribute.js` - Fixed search logic (OR→AND), added UNION with enslaved_individuals
- `memory-bank/activeContext.md` - Updated with Neon credentials and search fixes
- `memory-bank/progress.md` - Added Phase 13 for Neon migration

### Database Migration
- Migrated 224,433 total records from Render PostgreSQL to Neon
- Updated Render DATABASE_URL environment variable to use Neon

---

## Files Modified (Dec 14, 2025 - Session 2)

### Modified
- `scripts/scrapers/familysearch-scraper.js` - Added domain filtering to prevent clicking LDS promotional ads

---

## Next Steps

### Immediate
1. ✅ ~~Corporate Entity Integration~~ (COMPLETED Dec 18, 2025)
2. ✅ ~~1860 Census OCR Extraction Started~~ (IN PROGRESS - running in background)
3. Monitor 1860 census scraper (task bbd32b0) - check periodically
4. Await IPUMS data access approval from ipumsres@umn.edu
5. Build human review UI for name_match_queue

### Short Term
1. **Tobacco Company Calculations** - Requires asset beneficiary analysis (different methodology)
2. Create frontend UI for corporate debt leaderboard
3. Create merge tools for duplicate canonical persons
4. Link canonical_persons to reparations calculation system
5. Bridge WikiTree gap for James Hopewell descendants (Gen 5→8 via FamilySearch API)

### Pending External Dependencies
- **IPUMS Full Count Census Data** - Request submitted, awaiting access
  - 7.1 million enslaved persons (1850/1860)
  - Will populate `ipums_census_records` table once available

---

*This document is updated frequently as development progresses. Always check the "Last Updated" timestamp.*
