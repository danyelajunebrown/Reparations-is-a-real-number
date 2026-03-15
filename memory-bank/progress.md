# Development Progress: Reparations Is A Real Number

**Project Start:** 2024
**Current Phase:** Ancestor Climber Debugging & Pi Optimization
**Last Updated:** March 11, 2026

---

## Development Phases

### Phase 1: Foundation (2024 Q1-Q2) ✅
**Goal:** Build core infrastructure for document processing and genealogy tracking

**Completed Features:**
- ✅ Express.js API server with RESTful endpoints
- ✅ PostgreSQL database with complete schema
- ✅ Document upload pipeline (Multer)
- ✅ Local filesystem storage adapter
- ✅ OCR integration (Tesseract.js)
- ✅ Basic database schema (documents, enslaved_people, families)
- ✅ Database initialization script
- ✅ Health check endpoint

---

### Phase 2: Blockchain Integration (2024 Q3) ✅
**Goal:** Implement Ethereum smart contracts for payment distribution

**Completed Features:**
- ✅ ReparationsEscrow.sol smart contract (Solidity 0.8.19)
- ✅ ReparationsLedger.sol smart contract
- ✅ Truffle development framework setup
- ✅ Local Ganache blockchain for testing
- ✅ OpenZeppelin security patterns
- ✅ Web3.js integration in frontend
- ✅ MetaMask wallet connection

---

### Phase 3: Genealogy & Calculations (2024 Q4) ✅
**Goal:** Integrate genealogical APIs and implement reparations calculation engine

**Completed Features:**
- ✅ FamilySearch API integration
- ✅ Reparations calculation engine
- ✅ Descendant distribution algorithm
- ✅ Debt inheritance tracking
- ✅ Family relationship mapping

---

### Phase 4: Production Readiness (2025 Q1-Q4) ✅
**Goal:** Deploy to production and fix critical issues

**Completed Features:**
- ✅ Deployed backend to Render.com
- ✅ PostgreSQL database on Render
- ✅ S3 persistent storage migration
- ✅ Google Cloud Vision API integration
- ✅ Memory Bank documentation system
- ✅ Server refactoring with modular routes
- ✅ Full-screen document viewer

---

### Phase 5: Unified Scraping System (Dec 2025) ✅
**Goal:** Build working scraping pipeline from contribute page to database

**Completed Features:**
- ✅ UnifiedScraper.js with 8 site-type handlers
- ✅ Rootsweb census scraper (1860 Large Slaveholders)
- ✅ Auto-queue county pages from index
- ✅ Dual-table saving (individuals + unconfirmed_persons)
- ✅ Full backlog processing endpoint
- ✅ Contribute page with metadata fields
- ✅ 5,105+ persons extracted in first run

---

### Phase 6: Conversational Contribution Pipeline (Dec 2025) ✅
**Goal:** Build human-guided contribution flow with content-based confirmation

**Completed Features:**
- ✅ ContributionSession.js - Conversational service with 7 stages
- ✅ OwnerPromotion.js - Content-based confirmation with confirmatory channels
- ✅ API routes for full contribution flow
- ✅ contribute-v2.html - Chat-based UI
- ✅ Database tables (contribution_sessions, extraction_jobs, etc.)
- ✅ End-to-end test suite (test-contribution-pipeline-e2e.js)
- ✅ Natural language parsing for document descriptions
- ✅ Column header extraction from quoted text

**Critical Design Decision:**
Source domain (.gov, etc.) provides CONTEXT, not confirmation. Confirmation can ONLY come from:
1. Human transcription
2. OCR + human verification
3. High-confidence OCR (>= 95%)
4. Structured metadata (user confirmed)
5. Cross-reference with existing confirmed records

---

### Phase 7: Bibliography & Intellectual Property System (Dec 2025) ✅
**Goal:** Track all intellectual sources, databases, archives, researchers, and contributors

**Completed Features:**
- ✅ BibliographyManager (`src/utils/bibliography-manager.js`) - Core citation management
- ✅ IP Tracker (`src/utils/ip-tracker.js`) - Copy/paste and reference detection
- ✅ Bibliography API routes (`src/api/routes/bibliography.js`) - Full CRUD + analysis
- ✅ Frontend page (`bibliography.html`) - Comprehensive UI with search/filter/export
- ✅ Database tables (bibliography, pending_citations, participants, etc.)
- ✅ Memory bank index (`memory-bank/bibliography-index.md`)
- ✅ Pre-populated with 14 sources (archives, databases, technologies, participants)
- ✅ Citation formatting (APA, Chicago, MLA, BibTeX)

---

### Phase 8: Reparations Financial System (Dec 10, 2025) ✅ NEW
**Goal:** Build financial tracking system for reparations debt evidence and payments

**Completed Features:**
- ✅ CompensationTracker (`src/services/reparations/CompensationTracker.js`)
  - Records historical compensation payments TO owners as debt evidence
  - British Abolition 1833 claim import
  - DC Compensated Emancipation 1862 claim import
  - Historical currency conversion (GBP 1834, USD 1862)
  - Links to DebtTracker for unified debt tracking
- ✅ ReparationsSystem (`src/services/reparations/index.js`)
  - Unified module combining Calculator, DebtTracker, CompensationTracker
  - System state reporting
  - Blockchain export functionality
- ✅ DebtTracker fixes (removed smart quotes causing syntax errors)

**Key Financial Principle:**
Compensation TO owners PROVES debt owed TO descendants:
- Owner received £X → Enslaved received $0
- Minimum debt = Modern value of what owner received
- Additional damages for human dignity violations
- Compound interest for delayed justice (~2%/year)

**Test Results (Sample Data):**
- Lord Harewood: £26,309 for 1,277 enslaved → **$2.69 billion proven debt**
- John Smith: £4,500 for 250 enslaved → **$527.8M proven debt**
- James Williams (DC): $4,500 for 15 enslaved → **$19M proven debt**

---

### Phase 9: Data Source Expansion (Dec 10, 2025) ✅
### Phase 22: Ancestor Climber Debugging & Scale Testing (Mar 11, 2026) ✅ NEW
**Goal:** Fix broken ancestor climb, verify working at scale on Mac, plan Pi optimization

**Root Causes Found & Fixed:**
- `launchBrowser()` was killing ALL Chrome instances via `pkill -9` — including logged-in sessions. Fixed to reuse existing Chrome with remote debugging on port 9222; only kills climber-specific temp profile instances.
- FamilySearch React SPA not rendering before data extraction — "Sign In" text extracted as person name. Added `waitForFunction` for page title pattern before extraction.
- FamilySearch redirecting `/tree/person/details/{ID}` to `/tree/pedigree/portrait/{ID}`. Added redirect detection + re-navigation, plus fallback portrait view parsing (Methods 4 & 5 in `extractPersonFromPage`).
- Session expiration mid-climb unhandled. Added re-login detection with 3-minute manual login window in BFS loop.
- Reduced excessive wait times (was 5–12s per ancestor, now 2–3s adaptive).

**Test Results (Mac):**
- Successfully climbed 20+ ancestors through 4+ generations
- Both parents found consistently for most ancestors
- Reaching 1860s-era ancestors (slavery period) by generation 4
- API endpoint (POST /api/ancestor-climb/start) spawns background process correctly
- Sessions trackable via GET /api/ancestor-climb/sessions and /session/:id

**TODO — Pi Optimization (Pending):**
- [ ] Use Chromium instead of Chrome (lighter on Pi)
- [ ] Reduce wait times further for Pi hardware constraints
- [ ] Consider headless mode option for kiosk deployments
- [ ] Pre-cache FamilySearch cookies to skip login
- [ ] Batch parent extraction from portrait view (all ancestors visible at once)
- [ ] Add progress indicator to kiosk UI for slow climbs
- [ ] Explore FamilySearch API if developer app eventually approved

**Files Modified:**
- `scripts/scrapers/familysearch-ancestor-climber.js` — launchBrowser(), ensureLoggedIn(), BFS loop, extractPersonFromPage()

---

### Phase 21: Ancestor Climber Operationalization (Feb 28, 2026) ✅
**Goal:** Enable in-person sessions to trace a participant's ancestors to slaveholders using the FamilySearch workaround (no OAuth approval), with UI and API support.

**Completed Features:**
- ✅ Added backend API for climbs (work with existing v2 climber):
  - POST `/api/ancestor-climb/start` – launches local Chrome + climber script
  - GET `/api/ancestor-climb/sessions?fsId=...` – list climb sessions
  - GET `/api/ancestor-climb/session/:id` – session + matches
  - GET `/api/ancestor-climb/pending-verification` – review queue (unverified)
- ✅ Mounted routes in `src/server.js` and created `src/api/routes/ancestor-climb.js`
- ✅ Frontend “Trace Ancestors” panel + “Climb” nav in index.html
- ✅ js/app.js functions: `startAncestorClimbUI()`, `loadAncestorSessions()`, `loadAncestorSessionMatches()`, `loadPendingVerification()`
- ✅ Uses climber v2 strengths: ALL matches (no early stop), 1450 cutoff, session persistence, DocumentVerifier integration, diagnostics capture

**Operator Flow (Local Mac, Assisted Login):**
1. Ensure server is running on port 3000 (if EADDRINUSE, one is already running).
2. Visit http://localhost:3000 → “Trace Ancestors” → enter FamilySearch ID → Start Climb
3. Chrome opens locally; participant logs in to FamilySearch (first-time per machine/profile)
4. Monitor “Climb Sessions” and click a session to view live matches
5. Triage items in “Pending Verification”; classification remains UNVERIFIED until documents confirm

**Next Steps:**
- Background job/queue for multi-session concurrency on Mac minis
- Reviewer UI for document-backed verification and classification
- Headless mode trials with authenticated cookies (respecting ToS)
- Pipe verified matches to DAAOrchestrator for DAA generation

**Goal:** Add major historical data sources to scraping queue

**Completed:**
- ✅ Louisiana Slave Database (ibiblio.org/laslave) - 32 parish URLs queued
- ✅ UCL Legacies of British Slavery - 16 URLs queued (British compensation claims)
- ✅ Underwriting Souls - 23 URLs queued (insurance/financial enablers)
- ✅ FamilySearch Catalog - SC Probate records queued
- ✅ Created migration 009 for British colonial slavery data model

---

### Phase 20: Comprehensive Script Infrastructure (Dec 22-23, 2025) ✅ NEW
**Goal:** Build complete extraction, family linking, and descendant tracking infrastructure

**Completed Features:**

#### Civil War DC Genealogy Extraction Scripts
1. **`scripts/extract-civilwardc-genealogy.js`** (825 lines)
   - Extracts FULL genealogical data from 1,051 DC Emancipation petitions
   - Parses semantic HTML markup (`<span class="persName">`, `<span class="placeName">`)
   - Extracts: petitioners, enslaved persons, demographics, family relationships
   - Detects inheritance chains and previous owners from wills

2. **`scripts/reextract-civilwardc-families.js`** (590 lines)
   - Family-aware re-extraction for missed relationships
   - Detects patterns: "children of", "daughter/son of", "wife/husband of"
   - Dry run results: 467 relationships, 366 parent-child, 10 spouse links
   - Includes garbage name filtering

#### FamilySearch Pre-Indexed Extraction
3. **`scripts/extract-preindexed-data.js`** (509 lines)
   - Extracts volunteer-transcribed data from FamilySearch "Image Index" panel
   - Bypasses OCR errors by using pre-indexed (95% confidence) data
   - Puppeteer with stealth plugin for authenticated access
   - Supports interactive mode for cookie refresh

4. **`scripts/check-preindexed-coverage.js`**
   - Checks which pages have pre-indexed data vs need OCR fallback
   - Tests 15+ FamilySearch URLs from different states
   - Logs coverage statistics for data quality planning

#### WikiTree Descendant Tracking Suite
5. **`scripts/wikitree-batch-search.js`** (16KB)
   - Lightweight background process for continuous WikiTree searching
   - Rate-limited (1 search per 3 seconds)
   - Tries WikiTree IDs: `LastName-1` through `LastName-200`
   - Resumable via database queue
   - Modes: `--queue`, `--test`, `--stats`

6. **`scripts/wikitree-descendant-scraper.js`** (20KB)
   - Scrapes descendants from WikiTree profiles of confirmed enslavers
   - Max 8 generations, 500 descendants per profile (safety limits)
   - Parses GEDCOM descendant data from WikiTree HTML
   - Stores in `slave_owner_descendants_suspected`

#### Automation & Testing
7. **`scripts/run-census-scraper-resilient.sh`**
   - Shell wrapper for long-running census scraping
   - Auto-restarts on crash (10 max retries)
   - 30-second delay between retry attempts
   - Logs to `/tmp/arkansas-alabama-1860.log`

8. **`scripts/test-family-pattern.js`**, **`scripts/test-preindexed-batch.js`**, **`scripts/test-wikitree-debug.js`**
   - Testing and validation scripts for each system

---

### Phase 19: Descendant Tracking & WikiTree Integration (Dec 22, 2025) ✅
**Goal:** Build enslaved descendant credit tracking and systematic WikiTree search

**Completed Features:**

#### Enslaved Descendants CREDIT Schema
- ✅ `enslaved_descendants_suspected` - Private genealogy research (mirrors slaveholder schema)
- ✅ `enslaved_descendants_confirmed` - Opt-in verified descendants who are OWED credits
- ✅ `enslaved_credit_calculations` - Calculates reparations based on stolen labor value
- ✅ `wikitree_search_queue` - Lightweight queue for background WikiTree processing

**Migration:** `025-enslaved-descendant-credits.sql`

#### WikiTree Batch Search System
- ✅ Created `scripts/wikitree-batch-search.js` - Background-friendly search script
- ✅ Rate-limited profile checking (500ms between requests)
- ✅ Tries WikiTree ID patterns `LastName-1` through `LastName-200`
- ✅ Validates by checking name + location in profile HTML
- ✅ Queue-based with database persistence for resume capability
- ✅ Tested: Hopewell-1, Ravenel-5, multiple Coffin profiles found
- ✅ 20 high-confidence enslavers queued for processing

**Usage:**
```bash
node scripts/wikitree-batch-search.js --queue 100    # Queue enslavers
node scripts/wikitree-batch-search.js --test "Name"  # Test single name
node scripts/wikitree-batch-search.js               # Run continuously
```

#### Arkansas 1860 Slave Schedule Progress
- ✅ Pre-indexed extraction working (7,620 records at 95% confidence)
- ✅ 62/728 locations processed
- ✅ Data quality: 92% at 90%+ confidence
- 🔄 666 locations remaining

#### OCR Garbage Filter Fix
- ✅ Identified website UI text being extracted as person names
- ✅ Added garbage words: `genealogies`, `catalog`, `full`, `text`, `browse`, etc.
- ✅ Added garbage phrase detection: "genealogies catalog", "full text", etc.
- ✅ Cleaned 659 existing garbage records from database
- ✅ OCR fallback now properly filters UI artifacts

**Garbage Types Cleaned:**
| Type | Count | Issue |
|------|-------|-------|
| "Genealogies Catalog" | ~400 | FamilySearch navigation |
| "July" | ~250 | Date fragments |
| "Full Text" | ~9 | Button text |

**Files Created:**
- `migrations/025-enslaved-descendant-credits.sql`
- `scripts/wikitree-batch-search.js`
- `scripts/test-wikitree-debug.js`

**Files Modified:**
- `scripts/extract-census-ocr.js` - Enhanced `parseSlaveSchedule()` garbage filtering

---

### Phase 18: Data Quality & Ancestor Climber (Dec 20, 2025) ✅
**Goal:** Fix Civil War DC data quality issues and improve ancestor climber verification

**Completed Features:**

#### Civil War DC Data Fix
- ✅ Created `scripts/fix-civilwardc-data.js` - Template script for fixing petition data
- ✅ Extracts birth years from ages in context (1862 - age)
- ✅ Fixes locations to "Washington, D.C." (12,686 records had garbage data)
- ✅ Links enslaved persons to owners via relationships
- ✅ Cross-references table records with text records (handles Selina/Salina variants)
- ✅ Applied to 1,051 petitions, 35,944 records updated
- ✅ Williams family (cww.00035) verified: All 9 members now have birth years

#### Ancestor Climber Verification Improvements
- ✅ Disabled unreliable credit/debt classification (too many false positives)
- ✅ Added stricter verification requirements (document evidence + date matching)
- ✅ All matches now flagged as "UNVERIFIED - requires manual review"
- ✅ Fixed Lydia Williams false positive (user's ancestor 1746-1829 FREE ≠ DC enslaved 1838)

**Key Data Quality Issue Identified:**
- Civil War DC records had garbage single-word locations (e.g., `['Williams']` instead of `['Washington, D.C.']`)
- 53,349 records had garbage single-word names
- Many records missing birth years despite age being in context_text

**Files Created:**
- `scripts/fix-civilwardc-data.js` - Template data fix script

**Files Modified:**
- `scripts/scrapers/familysearch-ancestor-climber.js` - Stricter verification

---

### Phase 17: Corporate Entity & Farmer-Paellmann Integration (Dec 18, 2025) ✅
**Goal:** Track corporate entities involved in slavery and calculate their reparations debt

**Legal Reference:** In re African-American Slave Descendants Litigation, 304 F. Supp. 2d 1027 (N.D. Ill. 2004)

**Completed Features:**

#### Database Schema
- ✅ `corporate_entities` table - 17 Farmer-Paellmann defendants seeded
- ✅ `corporate_succession` table - Historical predecessor → modern successor chains
- ✅ `corporate_financial_instruments` table - Insurance policies, loans, mortgages
- ✅ `corporate_slaveholding` table - Direct ownership (BBH: 4,614 acres, 346 enslaved)
- ✅ `ipums_census_records` table - Ready for IPUMS Full Count data import
- ✅ `fips_states` table - 16 slave states seeded with FIPS codes

#### Sector-Specific Calculators
- ✅ `InsuranceCalculator.js` - Aetna, New York Life, Lloyd's, Southern Mutual, AIG
- ✅ `BankingCalculator.js` - FleetBoston, JP Morgan, Brown Brothers Harriman, Lehman
- ✅ `RailroadCalculator.js` - CSX, Norfolk Southern, Union Pacific, Canadian National

#### Enhanced DebtTracker
- ✅ Corporate debt tracking alongside individual slaveholders
- ✅ `addCorporateDebt()` method for sector calculator integration
- ✅ `getFarmerPaellmannDebts()` for all 17 defendants
- ✅ `getCombinedLeaderboard()` - Individuals + corporations ranked
- ✅ `calculateCombinedSystemDebt()` - System-wide totals

#### API Endpoints (`/api/corporate-debts/`)
- ✅ GET `/farmer-paellmann` - All 17 defendants
- ✅ GET `/farmer-paellmann/calculate` - Calculate all defendant debt
- ✅ GET `/entity/:id/debt` - Individual entity calculation
- ✅ GET `/leaderboard` - Corporate debt ranking
- ✅ GET `/sector/insurance|banking|railroads` - Sector calculations
- ✅ GET `/brown-brothers-harriman` - Most documented case

**Farmer-Paellmann Defendants (17 Total):**

| Sector | Count | Key Defendants |
|--------|-------|----------------|
| Banking | 4 | Bank of America, JP Morgan, Brown Brothers Harriman, Barclays |
| Insurance | 5 | CVS/Aetna, NY Life, Lloyd's, Southern Mutual, AIG |
| Railroads | 4 | CSX, Norfolk Southern, Union Pacific, Canadian National |
| Tobacco | 4 | RJ Reynolds, British American, Vector Group, Loews |

**Test Results (Dec 18, 2025):**
- Lloyd's of London: $1.8 quadrillion (insured entire Trans-Atlantic trade 1688-1807)
- CSX Corporation: $6.4 trillion (12 predecessor lines, 15,000 enslaved workers)
- Norfolk Southern: $4.1 trillion (10 predecessor lines, 12,000 enslaved)
- Brown Brothers Harriman: Direct slaveholding of 346 enslaved (4,614 acres Louisiana)

**IPUMS Census Status:**
- Request submitted to ipumsres@umn.edu for restricted slaveholder names
- 1850 Slave Schedule: 3,203,109 enslaved in 358,095 holdings
- 1860 Slave Schedule: 3,936,602 enslaved in 400,898 holdings
- Total: 7.1 million enslaved + ~395,000 named slaveholders (pending access)

**Files Created:**
- `migrations/021-corporate-entities-farmer-paellmann.sql`
- `migrations/022-ipums-census-integration.sql`
- `src/services/reparations/InsuranceCalculator.js`
- `src/services/reparations/BankingCalculator.js`
- `src/services/reparations/RailroadCalculator.js`
- `src/api/routes/corporate-debts.js`

---

### Phase 16: FamilySearch Census OCR Extraction (Dec 18, 2025) ✅
**Goal:** Extract enslaved persons from 1850/1860 Slave Schedule census images via OCR

**Completed Features:**

#### Location Crawler
- ✅ Enumerated 25,041 locations across FamilySearch collections
- ✅ 1850 Slave Schedule: 16,573 locations stored
- ✅ 1860 Slave Schedule: 8,468 locations stored
- ✅ All locations have waypoint URLs for image access

#### OCR Extraction Pipeline (`scripts/extract-census-ocr.js`)
- ✅ Puppeteer with stealth plugin for authenticated FamilySearch access
- ✅ Waypoint API integration (fetches from authenticated browser context)
- ✅ Drills down from County → District → Images hierarchy
- ✅ Google Vision OCR for census page text extraction
- ✅ Slave schedule format parser (Owner at top, enslaved by Age/Sex/Color)
- ✅ Owner-enslaved relationship linking via context_text
- ✅ Neon serverless database storage

**Test Results (20-County Batch):**
- Locations processed: 20
- Images processed: 100
- Owners extracted: 82
- Enslaved extracted: 170
- Errors: 0
- Elapsed time: 18m 41s

**Technical Fixes:**
- Fixed 403 Forbidden from waypoint API (use `page.evaluate()` with `credentials: 'include'`)
- Fixed location data ("county" → "district" in FamilySearch hierarchy)
- Fixed person endpoint using Neon serverless HTTP instead of pg Pool TCP
- Fixed owner linkage format: `"Name | Owner: OwnerName | County, State (Year)"`

**Files Created:**
- `scripts/extract-census-ocr.js` - Comprehensive OCR extraction script

---

### Phase 15: Production-Ready Refactoring (Dec 17, 2025) ✅
**Goal:** Comprehensive codebase refactoring, multi-table search, all tests passing

**Completed Features:**

#### Frontend Decomposition
- ✅ Split `index.html` from 2,765 lines to 346 lines
- ✅ Extracted `styles/main.css` (1,093 lines)
- ✅ Extracted `js/app.js` (1,331 lines)
- ✅ Updated `src/server.js` to serve new static directories

#### Codebase Cleanup
- ✅ Archived 89 obsolete files to `_archive/` directory
- ✅ Removed duplicate files (server.js, familysearch-integration.js, etc.)
- ✅ Organized into subdirectories by type (tests, html, js, docs, frontend, logs)

#### Chat Multi-Table Search
- ✅ Chat now searches ALL entity tables (was only `unconfirmed_persons`)
- ✅ Includes `enslaved_individuals` and `canonical_persons`
- ✅ Shows `[Confirmed]` and `[Canonical]` tags for verified records
- ✅ Fixed natural language parsing ("records about X", "people documented")

#### Search API Bug Fix
- ✅ Fixed UUID parsing error on `/api/contribute/search`
- ✅ Added explicit `/search` route before `/:sessionId` dynamic routes

#### Contribute.js Modularization
- ✅ Created `src/api/routes/contribute/` directory structure
- ✅ Added `shared.js` and `index.js` for future module composition

**Test Results:**
- Chat: 45/45 (100%)
- Documents: 8/8 (100%)
- Refactoring: 12/12 (100%)

**Files Created:**
- `styles/main.css` - Extracted CSS
- `js/app.js` - Extracted JavaScript
- `src/api/routes/contribute/shared.js` - Shared utilities
- `src/api/routes/contribute/index.js` - Module composition

**Files Modified:**
- `src/server.js` - Static file serving for new directories
- `src/api/routes/chat.js` - Multi-table search, improved NLP
- `src/api/routes/contribute.js` - Added `/search` route with query params
- `index.html` - Reduced to HTML structure only

---

### Phase 14: Document Viewer & Deduplication System (Dec 14, 2025) ✅
**Goal:** Fix document viewer S3 access, consolidate James Hopewell documents, add deduplication

**Completed Features:**

#### Document Viewer Fix
- ✅ Fixed `ecosystem.config.js` to load from `.env` (was using hardcoded old Render credentials)
- ✅ Added `/api/documents/archive/presign` endpoint for S3 presigned URLs
- ✅ Updated `openArchiveViewer()` in `index.html` to fetch presigned URLs before displaying

#### James Hopewell Documents
- ✅ Uploaded 2-page will to S3: `owners/James-Hopewell/will/page-1.pdf` and `page-2.pdf`
- ✅ Created unified document record with `ocr_page_count: 2`
- ✅ Added to `canonical_persons` (id: 1070) with descendant tracking notes
- ✅ Context: Slave owner (d. 1817, St. Mary's County, MD) with descendants traced to Nancy Miller Brown (Gen 8)

#### Document Deduplication System (Migration 017)
- ✅ New columns on `documents`: `document_group_id`, `page_number`, `is_primary_page`, `content_hash`
- ✅ `potential_duplicate_documents` view - finds suspicious document pairs
- ✅ `check_document_duplicates()` function - pre-insert duplicate check
- ✅ `merge_document_pages()` function - consolidates pages into single logical document
- ✅ `trg_warn_duplicate_document` trigger - logs warning on potential duplicates

#### Person Documents Index (Migration 016)
- ✅ `person_documents` junction table linking persons to S3 archived documents
- ✅ Views: `person_documents_with_names`, `person_document_counts`, `document_persons`
- ✅ Function: `get_person_documents(search_name)` for fuzzy search
- ✅ FamilySearch scraper updated to index documents during extraction

**Files Modified:**
- `ecosystem.config.js` - Now loads environment from `.env`
- `src/api/routes/documents.js` - Added presign endpoint
- `index.html` - Updated archive viewer
- `migrations/016-person-documents-index.sql` - New
- `migrations/017-document-deduplication.sql` - New

---

### Phase 13: Neon Database Migration & Search Fixes (Dec 14, 2025) ✅
**Goal:** Migrate to Neon serverless PostgreSQL and fix critical search bugs

**Completed Features:**
- ✅ Full database migration from Render PostgreSQL to Neon
  - 214,159 unconfirmed_persons
  - 1,401 enslaved_individuals
  - 1,068 canonical_persons
  - 726 confirming_documents
  - 4,192 scraping_queue
  - 2,887 scraping_sessions
- ✅ Fixed search returning unrelated names (OR→AND logic)
- ✅ Search now includes enslaved_individuals table (UNION query)
- ✅ Updated Render DATABASE_URL to use Neon

**Neon Database Credentials:**
```
Host: ep-still-glade-ad8qq83f-pooler.c-2.us-east-1.aws.neon.tech
Database: neondb
User: neondb_owner
Connection: postgresql://neondb_owner:npg_2S8LrhzkZmad@ep-still-glade-ad8qq83f-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require
```

**Search Bug Fixes:**
1. "Grace Butler" was returning 50 unrelated names → Now returns 3 correct results
2. "Adjua D'Wolf" returned 0 results → Now returns 1 result from enslaved_individuals

**Frontend URL:** https://danyelajunebrown.github.io/Reparations-is-a-real-number/

---

### Phase 10: Name Resolution System (Dec 14, 2025) ✅
**Goal:** Build identity resolution system to link OCR name variants to canonical persons

**Problem:** The same person appears with different spellings across documents due to OCR errors and historical spelling variations (e.g., "Sally Swailes" vs "Sally Swailer" vs "Sally Swales").

**Completed Features:**
- ✅ NameResolver Service (`src/services/NameResolver.js`)
  - Soundex phonetic matching algorithm
  - Metaphone phonetic matching algorithm
  - Levenshtein distance fuzzy matching
  - Name parsing (first, middle, last, suffix)
  - Confidence thresholds (≥0.85 auto-match, 0.60-0.84 queue for review, <0.60 create new)
- ✅ Database Migration (`migrations/010-name-resolution-system.sql`)
  - `canonical_persons` table - TRUE identity of a person
  - `name_variants` table - Different spellings linking to canonical
  - `name_match_queue` table - Ambiguous matches for human review
- ✅ API Endpoints (`src/api/routes/names.js`)
  - POST /api/names/analyze - Analyze a name (parsing, phonetic codes)
  - POST /api/names/compare - Compare two names for similarity
  - POST /api/names/resolve - Resolve name to canonical or queue for review
  - GET /api/names/search/:name - Find similar names
  - GET /api/names/stats - System statistics
- ✅ Automatic Scraper Integration
  - FamilySearch scraper now auto-processes names through NameResolver
  - Each extracted name is resolved/linked/queued during save

**Key Design Decisions:**
- Soundex codes enable phonetic matching (Swailes → S420, Swailer → S420)
- Multiple match methods combined for confidence scoring
- Human review queue for ambiguous matches prevents false merges
- Canonical person represents TRUE identity, variants track appearances

**Test Results:**
- "Sally Swailes" vs "Sally Swailer" → 83% confidence (queued for review)
- "Sally Swailes" vs "Sally Swales" → Soundex match
- "William Key" vs "William Frey" → No match (different phonetic codes)

---

### Phase 11: Historical Reparations Petitions & Broken Promises (Dec 14, 2025) ✅ NEW
**Goal:** Track historical reparations petitions and measure the gap between promised and actual payments

**Problem:** The system only tracked future payments via blockchain, not historical successful (or failed) reparations awards. Cases like Belinda Sutton's 1783 petition prove systemic failure: awarded but only 23% paid.

**Completed Features:**
- ✅ Database Migration (`migrations/011-historical-reparations-petitions.sql`)
  - `historical_reparations_petitions` - Petition details, awards, decisions
  - `historical_reparations_payments` - Actual payments made (or not made)
  - `petition_fulfillment_analysis` - "Wrap around check" comparing promises vs payments
  - `petition_documents` - Multi-purpose evidence docs (proves enslavement + broken promises)
  - Views: `broken_promises_summary`, `comprehensive_debt_with_broken_promises`
- ✅ PetitionTracker Service (`src/services/reparations/PetitionTracker.js`)
  - Records petitions, awards, payments, and fulfillment analysis
  - Calculates broken promise penalties (50% on unpaid amounts)
  - Compound interest on delayed payments (2% annual)
  - Auto-calculates fulfillment percentage (promised vs paid)
  - Belinda Sutton case import function
- ✅ Smart Contract Updates (`contracts/contracts/ReparationsEscrow.sol`)
  - Added `historicalPaymentsReceived` field to AncestryRecord struct
  - Added `recordHistoricalPayment()` function
  - Added `verifyHistoricalPayment()` function
  - Added `getNetDebtOwed()` - accounts for historical + blockchain payments
  - Added `isDebtFullySettled()` - checks both payment sources

**Belinda Sutton Case (1783):**
- Petition filed: Feb 14, 1783
- Award granted: £15 annually + £12 back payment (lifetime)
- Payments made: Only 2 (£27 total)
- Fulfillment rate: 23%
- Status: BROKEN PROMISE
- Modern value unpaid: $76,500
- Broken promise penalty: $38,250
- Total additional debt: $114,750+

**Multi-Purpose Evidence:**
Documents like Belinda's petition prove MULTIPLE things simultaneously:
- Enslavement occurred (Isaac Royall owned her 50 years)
- Debt was recognized (Legislature granted award)
- Government broke promise (Only 23% paid)

**S3 Storage Structure:**
```
s3://reparations-documents/
├── documents/                    # Existing enslaved evidence
└── multi-purpose-evidence/       # NEW: Petitions/awards/failures
    └── belinda-sutton-case/
        ├── 1783-02-petition-original.pdf
        ├── 1783-02-legislative-grant.pdf
        ├── 1783-03-payment-voucher-1.pdf
        ├── 1784-03-payment-voucher-2.pdf
        └── 1787-follow-up-petition.pdf
```

---

### Phase 12: Business Proceeds Calculation System (Dec 14, 2025) ✅ NEW
**Goal:** Correct the reparations formula and create system for calculating enslaved person's portion of business proceeds

**CRITICAL CONCEPTUAL CORRECTION:**

**INCORRECT (Previous):**
```
Total Debt = Original Debt + Compensation TO Owners + Broken Promises
```

**CORRECT (Updated):**
```
Total Reparations = Wage Theft + Portion of Business Proceeds + Damages
```

**Key Insight:** Compensation TO owners is NOT added to debt directly. It is EVIDENCE of business value at time of emancipation. We use it to CALCULATE what portion of that business value belonged to the enslaved person.

**Completed Features:**
- ✅ Database Migration (`migrations/012-business-proceeds-calculations.sql`)
  - `business_asset_records` - Store business/asset data and valuations
  - `proceeds_calculation_methods` - Methodologies for calculating proceeds portion
  - `proceeds_research_needed` - Track historical research requirements
  - `calculated_reparations` - Final calculations with corrected formula
  - Views: `complete_reparations_breakdown`, `research_priority_summary`
- ✅ ProceedsCalculator Service (`src/services/reparations/ProceedsCalculator.js`)
  - PLACEHOLDER service with structure for future improvement
  - Multiple calculation methodologies (labor hours, human capital, productivity)
  - Research guidance by business type (plantation, factory, shipping, etc.)
  - Integration with calculated_reparations table
- ✅ Comprehensive Documentation (`REPARATIONS-FORMULA-CORRECTED.md`)
  - Complete explanation of corrected formula
  - Component breakdown (Wage Theft, Business Proceeds, Damages)
  - Research requirements by business type
  - Belinda Sutton example with corrected calculations

**The Corrected Formula Components:**

1. **Component 1: Wage Theft**
   - Unpaid wages for labor performed
   - Years × Fair market wage rate
   - Example: 50 years @ £20/year = $850,000 modern

2. **Component 2: Portion of Business Proceeds**
   - Enslaved person's share of business value/proceeds
   - Calculated by researching: Owner's assets → Determine enslaved contribution → That portion belongs to them
   - Compensation TO owner tells us business value; we calculate their percentage
   - Example: 30% of £10,000 estate = $2,550,000 modern

3. **Component 3: Damages**
   - Human rights violations, family separation, lost freedom
   - Base amount + compound interest for delayed justice
   - Example: $100,000 base × 146 (compound over 242 years) = $14,600,000

**Research Requirements:**
Each enslaved person's business proceeds calculation requires specific historical research:
- Owner's business assets and reports from the time period
- Business type (plantation, factory, shipping, banking, etc.)
- Labor organization, workforce composition, productivity metrics
- Revenue/profit data, cost structure
- Enslaved person's role, skill level, years of service

**Status:** System ready to hold and refine proceeds calculations with future research. ProceedsCalculator is a PLACEHOLDER with methodology structure awaiting specific historical research per case.

---

## Recent Achievements

### Week of Dec 10, 2025 ✅ NEW
**Focus:** Financial System & Data Source Expansion

**Completed:**
1. ✅ Built CompensationTracker for tracking historical payments TO owners
2. ✅ Created ReparationsSystem unified module
3. ✅ Fixed DebtTracker syntax errors (smart quotes)
4. ✅ Tested financial system with sample British and DC claims
5. ✅ Added 32 Louisiana Slave Database URLs to queue
6. ✅ Created migration 009 for British colonial slavery data

**Files Created:**
- `src/services/reparations/CompensationTracker.js`
- `src/services/reparations/index.js`
- `migrations/009-british-colonial-slavery.sql`
- `scripts/scrapers/familysearch-catalog-scraper.js`

**Key Technical Achievement:**
Dual-ledger financial model where compensation TO owners is treated as EVIDENCE of debt, not credit against it. The enslaved received $0 - their descendants are owed at minimum what the owners received.

---

### Week of Dec 9, 2025 ✅
**Focus:** FamilySearch Document Processing

**Completed:**
1. ✅ Processed Thomas Porcher Ravenel Papers (970 images)
2. ✅ Extracted 1,355 enslaved persons from plantation records
3. ✅ Reached 212,002 total database records
4. ✅ Built FamilySearch tile viewer scraper with Google OAuth support

---

## Feature Status Tracker

### Financial System ⭐ NEW

| Feature | Status | Notes |
|---------|--------|-------|
| ReparationsCalculator | ✅ Complete | Wage theft, damages, interest |
| DebtTracker | ✅ Complete | Ancestor debts, inheritance chains |
| CompensationTracker | ✅ Complete | British 1833, DC 1862 claims |
| ReparationsSystem | ✅ Complete | Unified interface |
| Blockchain Export | ✅ Complete | Ready for smart contract integration |

### Scraping System

| Feature | Status | Notes |
|---------|--------|-------|
| UnifiedScraper.js | ✅ Complete | 8 site-type handlers |
| Rootsweb Census | ✅ Complete | Primary source, 0.98 confidence |
| Civil War DC | ✅ Complete | Primary source, 0.95 confidence |
| Beyond Kin | ✅ Complete | Secondary source, 0.60 confidence |
| FamilySearch Scraper | ✅ Complete | Tile viewer + OCR |
| MSA Archive Scraper | ✅ Complete | PDF + OCR pipeline |
| LA Slave DB | ⏳ Queued | 32 parish URLs pending |
| UCL LBS | ⏳ Queued | 16 claim URLs pending |
| Underwriting Souls | ⏳ Queued | 23 URLs pending |

---

## Metrics & Statistics

### Production Stats (Dec 14, 2025) - UPDATED
- **Database:** Neon PostgreSQL (migrated from Render)
- **Total unconfirmed_persons:** 214,159
- **Total enslaved_individuals:** 1,401 (confirmed)
- **Total canonical_persons:** 1,068
- **Confirming documents:** 726
- **Scraping queue:** 4,192
- **Scraping sessions:** 2,887
- **FamilySearch Ravenel Papers:** 1,355 records (970 images)
- **MSA Montgomery County:** ~5,367 records
- **Target Slaveholders:** 393,975

### Financial System Test Results
- **British Claim Example:** £26,309 → $2.69B proven debt
- **DC Claim Example:** $4,500 → $19M proven debt
- **Conversion Rates:** GBP 1834 = $50/£, USD 1862 = $30/$

---

## Data Sources

### Primary Sources (Census-Level Evidence)
| Source | Confidence | Status | Records |
|--------|------------|--------|---------|
| 1860 Slave Census (Rootsweb) | 0.98 | ✅ Complete | 11,000+ |
| DC Emancipation Petitions | 0.95 | ✅ Complete | 1,089 |
| FamilySearch Ravenel | 0.85 | ✅ Complete | 1,355 |
| MSA Montgomery County | 0.90 | ✅ Complete | 5,367 |

### Financial/Economic Sources
| Source | Status | Data Type |
|--------|--------|-----------|
| UCL LBS | ⏳ Queued | British compensation claims |
| Underwriting Souls | ⏳ Queued | Insurance policies on enslaved |
| DC Compensation Records | ⏳ Ready | 1862 emancipation payments |

### Regional Sources
| Source | Status | Coverage |
|--------|--------|----------|
| Louisiana Slave DB | ⏳ Queued | 32 Louisiana parishes |
| SC Probate Catalog | ⏳ Queued | Estate/will records |

---

## Roadmap

### Q4 2025 🎯

#### December 2025 (Remaining)
**Focus:** Complete Active Extraction & WikiTree Processing

**In Progress:**
- [ ] Complete Arkansas 1860 Slave Schedule (~400 locations remaining)
- [ ] Finish MSA Vol 812 reprocessing (pages 97-132)
- [ ] Run WikiTree batch search continuously
- [ ] Execute Civil War DC family re-extraction

**Completed This Month:**
- [x] Built comprehensive script infrastructure (8 major scripts)
- [x] Enslaved descendant credit tracking schema (migration 025)
- [x] WikiTree batch search + descendant scraper
- [x] Pre-indexed data extraction (95% confidence)
- [x] Civil War DC genealogy extraction
- [x] Family relationship pattern detection
- [x] OCR garbage filtering improvements
- [x] Data quality fixes for 35,944 DC records
- [x] CompensationTracker financial system
- [x] Corporate entity Farmer-Paellmann integration

### Ph
**Goal:** Build comprehensive legal infrastructure for reparations claims across ALL Triangle Trade jurisdictions

**Completed Features:**
- ✅ Migration 031: Triangle Trade Legal Framework
  - Legal jurisdictions table (UK, France, Haiti, US, Spain, Netherlands, Portugal)
  - Legal texts and statutes table with key provisions
  - UK 1833 loan data (paid off 2015 - PRIMARY PRECEDENT)
  - Haiti independence debt ($21B inverse reparations)
  - Farmer-Paellmann failure analysis with changed circumstances
  - Legal doctrines (unjust enrichment, constructive trust, successor liability, badges/incidents)
  - Garnishment mechanisms with Mullen/Darity assessment
  - Escrow tracking for when "somebody bites"
- ✅ LegalPrecedentService.js - Query service for all legal data
- ✅ API routes (/api/legal/*) for:
  - GET /precedents - All precedents ranked by strength
  - GET /uk-1833 - Primary precedent
  - GET /haiti - Counter-precedent (inverse reparations)
  - GET /farmer-paellmann - Strategic lessons from 2004 failure
  - GET /jurisdictions - All Triangle Trade jurisdictions
  - GET /doctrines - Legal theories applicable to reparations
  - GET /mechanisms - Garnishment approaches by defendant type
  - GET /daa-citations/:jurisdiction/:defendantType - Build DAA citations

**Key Strategic Decisions:**
1. **Individual DAAs (A)** = Our way in (avoids Farmer-Paellmann standing issues)
2. **Class action (B)** = Secondary, always thinking class action
3. **Government taxation (C)** = ONLY ethical mechanism per Mullen/Darity - ultimate goal
4. **Escrow strategy** = Credit distribution when payments arrive, not before

**Legal Texts Added:**
- Slavery Abolition Act 1833 (UK)
- Code Noir 1685 & Louisiana 1724 (France)
- Treaty of Utrecht / British Asiento 1713 (Spain)
- Moret Law 1870 & Cuba Abolition 1886 (Spain)
- Netherlands 2023 Apology & €200M Fund

---

### Q1 2026 🔮 (Updated Feb 28, 2026)

#### January 2026
**Focus:** Legal Framework Integration & WikiTree Processing
- [x] Triangle Trade Legal Framework complete
- [ ] Run wikitree-descendant-scraper on all queued profiles
- [ ] Connect CompensationTracker to live UCL LBS data
- [ ] Build enslaved credit calculations for confirmed descendants
- [ ] Execute Alabama 1860 Slave Schedule extraction
- [ ] Implement blockchain smart contract integration

#### February-March 2026
**Focus:** Ancestor Climber rollout + Cross-Reference & Payment System
- [x] In-person ancestor climber operational (UI + API + script integration)
- [x] Ancestor climber debugged & verified working at scale on Mac (Mar 11, 2026)
- [ ] Optimize ancestor climber for Raspberry Pi (Chromium, headless, reduced waits)
- [ ] Background queue + headless worker profiles for concurrency
- [ ] Reviewer UI for unverified matches → document-backed decisions
- [ ] Match enslaved descendants ↔ enslaver descendants
- [ ] Build participant KYC/identity verification
- [ ] Create payment distribution UI
- [ ] Add more compensation programs (French, Spanish, etc.)

---

## Current Active Scripts Reference

| Script | Purpose | Status |
|--------|---------|--------|
| `wikitree-batch-search.js` | Background WikiTree profile search | Ready |
| `wikitree-descendant-scraper.js` | Descendant extraction from WikiTree | Ready |
| `extract-preindexed-data.js` | FamilySearch pre-indexed extraction | Active |
| `extract-census-ocr.js` | 1860 Slave Schedule OCR extraction | Active |
| `reextract-civilwardc-families.js` | Family relationship extraction | Ready |
| `run-census-scraper-resilient.sh` | Long-running scraper wrapper | Active |

---

## Lessons Learned

### December 10, 2025 - Financial System
**Key Insights:**
1. **Compensation ≠ Credit** - Payments TO owners prove debt, they don't reduce it
2. **Dual-ledger model** - Separate evidence tracking from payment tracking
3. **Historical conversion** - Currency values must account for inflation + interest
4. **Damages compound** - Delayed justice adds ~2%/year to debt

**What Went Well:**
1. Clean integration with existing DebtTracker
2. Flexible import methods for different data sources
3. Comprehensive test coverage with sample data

---

## Success Stories 🎉

### 7. Financial System Architecture (Dec 10, 2025) ⭐ NEW
**Challenge:** Integrate compensation TO owners into debt system TO descendants
**Solution:** Dual-ledger model - compensation as EVIDENCE of debt
**Impact:** Can now calculate proven debt from historical records
**Key Insight:** £26,309 British claim → $2.69B modern debt

### 6. FamilySearch Document Processing (Dec 9, 2025)
**Challenge:** Extract names from handwritten plantation records
**Solution:** Tile viewer scraper + Google Vision OCR
**Impact:** 1,355 enslaved persons from 970 images

### 5. Unified Scraping System (Dec 2, 2025)
**Challenge:** Fragmented scrapers with broken dependencies
**Solution:** Created UnifiedScraper.js with 8 site handlers
**Impact:** 5,105+ persons extracted, backlog processing automated

---

## Next Milestone

**Target Date:** December 15, 2025

**Goal:** Process British Colonial Data

**Deliverables:**
- [ ] Migration 009 run on production database
- [ ] UCL LBS scraper processing compensation claims
- [ ] CompensationTracker integrated with live data
- [ ] Louisiana parish records processing started
- [ ] 250,000+ total database records

---

*This document tracks development progress and is updated regularly as features are completed.*
