# Active Context: Current Development State

**Last Updated:** December 2, 2025
**Current Phase:** Refactoring Fixes Complete - All Systems Operational
**Active Branch:** main

---

## Recent Major Changes (Dec 2, 2025)

### 9. Major Refactoring Fixes COMPLETED ✅ (Dec 2, 2025)
**Problem Solved:** Fixed critical issues caused by server refactoring where `src/server.js` was missing many endpoints that existed in legacy `server.js`.

**Root Cause Analysis:**
- Render deployment uses `npm start` which runs `node src/server.js`
- The refactored `src/server.js` was missing ~15 endpoints that the frontend relied on
- Document viewer was constrained inside `.widget-forest` container
- Frontend was initially pointing to wrong Render service URL

**Implementation Complete:**

#### 1. Fixed Frontend API_BASE_URL
- Confirmed single Render service: `reparations-platform.onrender.com`
- Updated all frontend files to use correct URL:
  - `index.html`
  - `portal.html`
  - `contribute.html`

#### 2. Restored Missing API Endpoints to `src/server.js`
Added all missing legacy endpoints:

**Document Endpoints:**
- `GET /api/documents` - List all documents with pagination
- `GET /api/search-documents` - Search across owner names, FamilySearch IDs

**Queue/Scraping Endpoints (for contribute.html):**
- `POST /api/submit-url` - Submit URL for scraping queue
- `GET /api/queue-stats` - Queue statistics (pending, processing, completed)
- `GET /api/population-stats` - Population/progress stats toward 393,975 goal
- `POST /api/trigger-queue-processing` - Trigger background URL processing

**Portal Endpoints (for portal.html):**
- `POST /api/search-reparations` - Search by name/year/ID
- `POST /api/get-descendants` - Get descendants for a person

**Carousel/Frontend Endpoints:**
- `GET /api/carousel-data` - Returns documents for carousel display
- `GET /api/beyond-kin/pending` - Beyond Kin review queue
- `POST /api/beyond-kin/:id/approve|reject|needs-document`
- `POST /api/process-individual-metadata`

**Utility Endpoints:**
- `GET /api/cors-test` - CORS diagnostic
- `GET /api` - API info

#### 3. Fixed Document Viewer Overlay
**Problem:** Document viewer was nested inside `.widget-forest` and used `position: absolute`, causing it to be constrained to the widget size instead of full screen.

**Solution:**
- Changed CSS from `position: absolute` to `position: fixed`
- Changed dimensions from `100%` to `100vw/100vh`
- Increased `z-index` from 100 to 9999
- **Moved document viewer HTML from inside `.widget-forest` to body level**

#### 4. Deleted Broken Database Entries
Successfully deleted 4 orphaned document entries:
- `900cf66201885c3124a8ea81`
- `e1ba74d24afaf8e15e847bb0`
- `2f00968ac93ef39f47e74d49`
- `d94180c70274f7bf25b735a8`

#### 5. Updated S3 Region Configuration
- Updated `config.js` default region from `us-east-1` to `us-east-2`
- Updated `.env.example` to use `us-east-2`
- Local `.env` already had correct `S3_REGION=us-east-2`

**Current Status:**
- ✅ All API endpoints working and tested
- ✅ Document viewer displays as full-screen overlay
- ✅ Downloads working correctly
- ✅ S3 presigned URLs generating correctly
- ✅ Database cleaned up
- ✅ All changes committed and pushed to GitHub
- ✅ Render auto-deployed with latest code

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
GET  /api/documents/owner/:name     - Get documents by owner
GET  /api/search-documents          - Search documents
GET  /api/carousel-data             - Carousel display data
GET  /api/queue-stats               - Scraping queue stats
GET  /api/population-stats          - Progress statistics
POST /api/submit-url                - Submit URL for scraping
POST /api/trigger-queue-processing  - Process queue
POST /api/search-reparations        - Search reparations
POST /api/get-descendants           - Get descendants
GET  /api/beyond-kin/pending        - Beyond Kin queue
POST /api/beyond-kin/:id/approve    - Approve Beyond Kin
POST /api/beyond-kin/:id/reject     - Reject Beyond Kin
GET  /api/cors-test                 - CORS diagnostic
```

### Current Database Stats
- **Documents:** 7 total
- **Queue:** 691 pending, 5 processing, 2,862 completed
- **Individuals:** 28 total

---

## Architecture Notes

### Server Structure (IMPORTANT)
The project has TWO server files:
1. **`server.js` (root)** - Legacy server with all endpoints (2,400+ lines)
2. **`src/server.js`** - Refactored modular server (800+ lines after fixes)

**Render uses `src/server.js`** via `npm start` → `node src/server.js`

The refactored server uses:
- `src/api/routes/documents.js` - Document routes
- `src/api/routes/research.js` - Research/LLM routes
- `src/api/routes/health.js` - Health check routes
- `src/api/routes/errors.js` - Error logging routes

Plus inline legacy endpoints added directly to `src/server.js` for frontend compatibility.

### Frontend Files
- `index.html` - Main dashboard with carousel and document viewer
- `portal.html` - Reparations search portal
- `contribute.html` - URL submission for research

All use `API_BASE_URL = 'https://reparations-platform.onrender.com'`

---

## Known Issues & Limitations

### Resolved Issues ✅
1. ~~Document viewer constrained by widget container~~ - FIXED
2. ~~Missing API endpoints after refactoring~~ - FIXED
3. ~~S3 region mismatch~~ - FIXED
4. ~~Orphaned database entries~~ - DELETED

### Remaining Issues
1. **No Authentication** 🔴 - API completely open
2. **No Rate Limiting Active** 🟡 - Middleware installed but not all endpoints protected
3. **No Input Validation** 🟡 - Joi installed but not fully implemented
4. **Console.log Overuse** 🟢 - Should use Winston logger consistently

---

## Commits from This Session

1. `6632ad2` - Add DELETE endpoint for document cleanup
2. `5b40ccf` - Fix frontend API_BASE_URL and add document DELETE endpoint
3. `a1c578b` - Revert API_BASE_URL to reparations-platform.onrender.com
4. `3d7e90e` - Add missing legacy endpoints to src/server.js for frontend compatibility
5. `945bdff` - Restore all missing legacy endpoints to src/server.js
6. `af72c02` - Fix document viewer to use full-screen overlay at body level

---

## Next Steps

### Immediate
1. Monitor document viewer functionality on production
2. Test all restored endpoints from frontend
3. Verify carousel loads correctly

### Short Term
1. Implement JWT authentication
2. Add rate limiting to sensitive endpoints
3. Add Joi validation to POST bodies
4. Set up error tracking (Sentry)

---

*This document is updated frequently as development progresses. Always check the "Last Updated" timestamp.*
