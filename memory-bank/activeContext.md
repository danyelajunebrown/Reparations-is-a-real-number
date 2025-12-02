# Active Context: Current Development State

**Last Updated:** December 2, 2025
**Current Phase:** Unified Scraping System Live - Full Backlog Processing
**Active Branch:** main

---

## Recent Major Changes (Dec 2, 2025)

### 10. Unified Scraping System & Backlog Processing LIVE (Dec 2, 2025)

**Problem Solved:** Fragmented scraping system with broken dependencies rebuilt into unified system with full backlog auto-processing.

**Root Cause Analysis:**
- Old `Orchestrator.js` required non-existent files (`autonomous-web-scraper.js`, `genealogy-entity-extractor.js`, `llm-page-analyzer.js`)
- Scripts in `scripts/scrapers/` required `./database` which doesn't exist
- No connection between contribute page and actual scraping
- Data was being extracted but not flowing to main `individuals` table

**Implementation Complete:**

#### 1. Created UnifiedScraper.js (`src/services/scraping/UnifiedScraper.js`)
Complete working scraper with handlers for multiple site types:

| Category | Source | Confidence | Data Extracted |
|----------|--------|------------|----------------|
| `rootsweb_census` | 1860 Census data | 0.98 | Confirmed slaveholders with slave counts |
| `civilwardc` | DC Emancipation Petitions | 0.95 | Confirmed owners + enslaved people |
| `beyondkin` | Beyond Kin directory | 0.60 | Suspected slaveholders + enslaved |
| `wikipedia` | Wikipedia articles | 0.50 | Suspected owners |
| `findagrave` | Find A Grave | 0.50 | Suspected owners |
| `familysearch` | FamilySearch | 0.65 | Family relationships |
| `archive` | Archive.org | 0.50 | Documents + names |
| `generic` | Any webpage | 0.40 | Keyword-based extraction |

#### 2. Rootsweb Census Scraper (PRIMARY SOURCE)
Specialized handler for Tom Blake's "Large Slaveholders of 1860" data:
- URL: `https://freepages.rootsweb.com/~ajac/genealogy/`
- Extracts confirmed slaveholders from census records
- Parses format: `NAME, # slaves, Location, page #`
- Auto-queues all county pages from main index
- Confidence: 0.98 (census data = gold standard)
- **Saves directly to `individuals` table** (not just unconfirmed_persons)

#### 3. Full Backlog Processing Endpoint
New endpoint: `POST /api/process-full-backlog`
- Processes ALL pending URLs in queue
- Rate-limited (1 second between requests)
- Logs progress and completion stats
- Currently processing 691 URLs

#### 4. Data Flow Fixed
- Confirmed owners (confidence >= 0.9) → `individuals` table
- All extractions → `unconfirmed_persons` table (for tracking)
- Slaveholder records → `slaveholder_records` table (with slave counts)

#### 5. Updated Contribute Page
Enhanced `contribute.html` with:
- New categories: civilwardc, slaveholders1860, surnames1870, custom
- Advanced metadata fields for custom sources
- Source type selection (primary/secondary/tertiary)

**Current Processing Status (LIVE):**
```
Pending:     610 URLs (down from 691)
Processing:  5 concurrent
Completed:   2,943 (up from 2,862)
Persons 24h: 5,105+ extracted
```

---

### 9. Major Refactoring Fixes (Earlier Dec 2, 2025) ✅

Fixed critical issues from server refactoring:
- Restored 15+ missing API endpoints to `src/server.js`
- Fixed document viewer CSS (position: fixed, z-index: 9999)
- Moved document viewer HTML to body level
- Deleted 4 orphaned database entries
- Updated S3 region default to us-east-2

---

## Current Production Environment

### Render Services
- **Backend:** `reparations-platform.onrender.com` (Node.js)
- **Database:** `reparations-db` (PostgreSQL 17, Virginia)

### Working Endpoints (Verified Dec 2, 2025)
```
GET  /api                           - API info
GET  /api/health                    - Health check
GET  /api/documents                 - List documents
GET  /api/documents/:id             - Get document metadata
GET  /api/documents/:id/access      - Get presigned S3 URL
GET  /api/documents/:id/file        - Download document
DELETE /api/documents/:id           - Delete document
GET  /api/search-documents          - Search documents
GET  /api/carousel-data             - Carousel display data
GET  /api/queue-stats               - Scraping queue stats
GET  /api/population-stats          - Progress statistics
POST /api/submit-url                - Submit URL for scraping
POST /api/trigger-queue-processing  - Process batch (3-5 URLs)
POST /api/process-full-backlog      - Process ALL pending URLs ⭐ NEW
POST /api/search-reparations        - Search reparations
POST /api/get-descendants           - Get descendants
GET  /api/beyond-kin/pending        - Beyond Kin queue
GET  /api/cors-test                 - CORS diagnostic
```

### Current Database Stats
- **Documents:** 7 total
- **Queue:** 610 pending, 5 processing, 2,943 completed
- **Individuals:** 28 (will grow as census data processes)
- **Persons extracted (24h):** 5,105+

---

## Architecture Notes

### Server Structure (IMPORTANT)
The project has TWO server files:
1. **`server.js` (root)** - Legacy server (NOT used in production)
2. **`src/server.js`** - Production server (used by Render)

**Render uses `src/server.js`** via `npm start` → `node src/server.js`

### Scraping System Structure
```
src/services/scraping/
├── UnifiedScraper.js    # ⭐ MAIN SCRAPER (working)
└── Orchestrator.js      # Old orchestrator (broken dependencies)
```

**UnifiedScraper.js** is the working scraper with:
- Site-specific handlers for each source type
- Automatic category detection from URL
- Dual-table saving (individuals + unconfirmed_persons)
- Census reference tracking

---

## Known Issues & Limitations

### Resolved Issues ✅
1. ~~Fragmented scraping system~~ - FIXED with UnifiedScraper
2. ~~Data not flowing to individuals table~~ - FIXED for confirmed sources
3. ~~Rootsweb census not being scraped~~ - FIXED with specialized handler
4. ~~No auto-processing~~ - FIXED with /api/process-full-backlog
5. ~~Document viewer constrained~~ - FIXED
6. ~~Missing API endpoints~~ - FIXED

### Remaining Issues
1. **No Authentication** - API completely open
2. **`slaveholder_records` table may not exist** - Falls back gracefully
3. **Rate limiting not on all endpoints**

---

## Commits from This Session

1. `a2ca268` - Add unified scraping system with dynamic site handlers
2. `b9a3e16` - Add rootsweb census scraper and full backlog auto-processing

Previous session commits:
- `6632ad2` - Add DELETE endpoint for document cleanup
- `af72c02` - Fix document viewer to use full-screen overlay at body level

---

## Data Sources Status

### Primary Sources (Confidence 0.9+)
| Source | Status | Notes |
|--------|--------|-------|
| Rootsweb Census 1860 | ✅ SCRAPER LIVE | Auto-queues county pages |
| Civil War DC Petitions | ✅ SCRAPER READY | Needs URLs in queue |

### Secondary Sources (Confidence 0.6-0.8)
| Source | Status | Notes |
|--------|--------|-------|
| Beyond Kin | ✅ SCRAPER READY | 691 URLs in queue |
| FamilySearch | ✅ SCRAPER READY | HTML pages only |

### Pending Sources
| Source | Status | Notes |
|--------|--------|-------|
| Large Slaveholders 1860 | 🔄 PROCESSING | Main index queued |
| African American Surnames 1870 | ⏳ WAITING | User to provide URL |

---

## Next Steps

### Immediate (Auto-running)
1. ✅ Full backlog processing in progress (~58 min estimated)
2. Monitor `individuals` table growth as census data processes
3. Watch for rootsweb county pages being auto-queued

### User Action Needed
1. Provide URL for "African American Surname Matches from 1870"
2. Monitor Render logs for processing progress

### Short Term
1. Verify `slaveholder_records` table exists
2. Add more Civil War DC petition URLs
3. Consider adding more census sources

---

*This document is updated frequently as development progresses. Always check the "Last Updated" timestamp.*
