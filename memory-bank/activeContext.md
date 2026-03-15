# Active Context: Current Development State

**Last Updated:** March 11, 2026 (Session 20)
**Current Phase:** Ancestor Climber Debugging & Pi Optimization
**Active Branch:** main
**Project Title:** Reparations ∈ ℝ ("you can do it, put your back into it")

---

## Session 20 Accomplishments (Mar 11, 2026) ✅ NEW

### 1) Ancestor Climber Fixed & Verified Working at Scale on Mac ✅
**Root causes found and fixed:**
- `launchBrowser()` was killing ALL Chrome instances (including logged-in sessions) via `pkill -9`. Fixed to reuse existing Chrome with remote debugging on port 9222, only kill climber-specific temp profile instances.
- FamilySearch SPA not rendering before extraction. Added `waitForFunction` checks for page title pattern before extracting person data.
- FamilySearch redirecting `/tree/person/details/{ID}` to `/tree/pedigree/portrait/{ID}`. Added redirect detection and re-navigation, plus fallback portrait view parsing (Method 4 & 5 in extractPersonFromPage).
- Session expiration mid-climb. Added re-login detection and 3-minute manual login window in BFS loop.
- Reduced excessive wait times (was 5-12 seconds per ancestor, now 2-3 seconds adaptive).

**Test results (Mac):**
- Successfully climbed 20+ ancestors through 4+ generations
- Both parents found consistently for most ancestors
- Reaching 1860s-era ancestors (slavery period) by generation 4
- API endpoint (POST /api/ancestor-climb/start) spawns background process correctly
- Sessions trackable via GET /api/ancestor-climb/sessions and /session/:id

### 2) TODO: Pi Optimization (Pending)
- Ancestor climb was built for kiosk mode on Raspberry Pi
- Pi was too slow - need to optimize:
  - Use Chromium instead of Chrome (lighter)
  - Reduce wait times further for Pi hardware
  - Consider headless mode option
  - Pre-cache FamilySearch cookies
  - Batch parent extraction from portrait view (all ancestors visible at once)
  - Add progress indicator to kiosk UI for slow climbs
  - Consider FamilySearch API approach if developer app gets approved

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
postgresql://neondb_owner:npg_2S8LrhzkZmad@ep-still-glade-ad8qq83f-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require
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
Password: npg_2S8LrhzkZmad
Connection String: postgresql://neondb_owner:npg_2S8LrhzkZmad@ep-still-glade-ad8qq83f-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require
```

### Legacy Database (Render PostgreSQL) - DEPRECATED
```
Host: dpg-d3v78f7diees73epc4k0-a.oregon-postgres.render.com
Database: reparations
User: reparations_user
Password: hjEMn35Kw7p712q1SYJnBxZqIYRdahHv
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
