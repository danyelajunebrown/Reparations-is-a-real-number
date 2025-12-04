# Technical Context: Reparations Is A Real Number

**Last Updated:** December 4, 2025

## Technology Stack

### Backend
- **Runtime:** Node.js 18+ (CommonJS modules)
- **Framework:** Express.js 4.18.2
- **Language:** JavaScript (ES6+)
- **Process Manager:** Render platform (production), nodemon (development)

### Database
- **Primary Database:** PostgreSQL 17 (Render)
- **Client Library:** pg 8.11.3 (node-postgres)
- **Connection Pooling:** Built-in pg.Pool
- **Schema Management:** Manual SQL scripts

### Storage
- **Cloud Storage:** AWS S3 (SDK v3: @aws-sdk/client-s3 3.470.0)
- **S3 Bucket:** reparations-them
- **S3 Region:** us-east-2 (IMPORTANT: default changed from us-east-1)
- **Distributed Storage:** IPFS (optional, disabled by default)

### File Processing
- **File Upload:** Multer 1.4.5-lts.1 (50MB limit)
- **File Type Detection:** file-type 12.4.2 (CommonJS compatible)
- **OCR Primary:** Google Cloud Vision API (@google-cloud/vision 4.0.2)
- **OCR Fallback:** Tesseract.js 5.0.3
- **PDF Parsing:** pdf-parse 1.1.1
- **Image Processing:** Sharp 0.33.1

### Web Scraping
- **HTTP Client:** Axios
- **HTML Parser:** Cheerio
- **Browser Automation:** Puppeteer (for JavaScript-rendered pages)

### Blockchain
- **Network:** Ethereum (local Ganache for testing)
- **Smart Contract Language:** Solidity 0.8.19
- **Development Framework:** Truffle 5.11.0
- **Web3 Library:** Web3.js 1.10.0
- **Contract Standards:** OpenZeppelin 4.9.0

### Frontend
- **UI Framework:** Vanilla HTML/CSS/JavaScript
- **Web3 Integration:** Web3.js 1.10.0
- **Static Hosting:** GitHub Pages
- **API Communication:** Native Fetch API

---

## Server Architecture (CRITICAL)

### Two Server Files Exist
The project has TWO server files - understanding this is critical:

1. **`server.js` (root)** - Legacy monolithic server (~2,400 lines)
   - Contains ALL endpoints in one file
   - NOT used in production

2. **`src/server.js`** - Refactored modular server (~900 lines)
   - **THIS IS USED IN PRODUCTION**
   - Uses modular routes from `src/api/routes/`
   - Plus inline legacy endpoints for frontend compatibility

**Render deployment command:** `npm start` → `node src/server.js`

### Route Structure (src/server.js)

```javascript
// Modular routes
app.use('/api/documents', documentsRouter);  // src/api/routes/documents.js
app.use('/api/research', researchRouter);    // src/api/routes/research.js
app.use('/api/health', healthRouter);        // src/api/routes/health.js
app.use('/api/errors', errorsRouter);        // src/api/routes/errors.js

// Legacy compatibility routes (inline in src/server.js)
app.get('/api/carousel-data', ...)
app.get('/api/documents', ...)
app.get('/api/search-documents', ...)
app.get('/api/queue-stats', ...)
app.get('/api/population-stats', ...)
app.post('/api/submit-url', ...)
app.post('/api/trigger-queue-processing', ...)
app.post('/api/process-full-backlog', ...)      // ⭐ NEW
app.post('/api/search-reparations', ...)
app.post('/api/get-descendants', ...)
app.get('/api/beyond-kin/pending', ...)
// ... more endpoints
```

---

## Scraping System Architecture ⭐ NEW

### UnifiedScraper.js (`src/services/scraping/UnifiedScraper.js`)

The main scraping engine with 8 site-type handlers:

```javascript
class UnifiedScraper {
    constructor(database, config = {}) {
        this.db = database;
        this.config = { timeout: 30000, ... };
    }

    // Main entry point
    async scrapeURL(url, options = {}) {
        const category = options.category || this.detectCategory(url);
        // Routes to appropriate handler based on category
    }

    // Category detection from URL
    detectCategory(url) {
        if (url.includes('freepages.rootsweb.com')) return 'rootsweb_census';
        if (url.includes('beyondkin.org')) return 'beyondkin';
        if (url.includes('civilwardc.org')) return 'civilwardc';
        // ... more patterns
        return 'generic';
    }

    // Site-specific handlers
    async scrapeRootswebCensus(url, result, options) { ... }
    async scrapeBeyondKin(url, result, options) { ... }
    async scrapeCivilWarDC(url, result, options) { ... }
    async scrapeWikipedia(url, result, options) { ... }
    async scrapeFindAGrave(url, result, options) { ... }
    async scrapeFamilySearch(url, result, options) { ... }
    async scrapeArchive(url, result, options) { ... }
    async scrapeGeneric(url, result, options) { ... }

    // Database saving
    async saveResults(result, options) {
        // Confirmed owners → individuals table
        // All data → unconfirmed_persons table
    }
}
```

### Confidence Scores by Source Type

| Source Type | Confidence | Target Table |
|-------------|------------|--------------|
| Census (rootsweb_census) | 0.98 | `individuals` (direct) |
| DC Petitions (civilwardc) | 0.95 | `individuals` (direct) |
| Beyond Kin | 0.60 | `unconfirmed_persons` |
| FamilySearch | 0.65 | `unconfirmed_persons` |
| Wikipedia | 0.50 | `unconfirmed_persons` |
| Find A Grave | 0.50 | `unconfirmed_persons` |
| Archive.org | 0.50 | `unconfirmed_persons` |
| Generic | 0.40 | `unconfirmed_persons` |

### Rootsweb Census Scraper Details

Handles Tom Blake's "Large Slaveholders of 1860" data:
- **Main Index:** Extracts all county page links, queues them
- **County Pages:** Parses slaveholder entries in format:
  ```
  NAME, # slaves, Location, page #
  Example: ADAMS, John, 98 slaves, Athens, page 19
  ```
- **Surname Matches:** Extracts 1870 African American surname data

---

## API Endpoints Reference

### Document Management
```
POST   /api/documents/upload          - Upload document (multipart/form-data)
GET    /api/documents                 - List all documents (pagination)
GET    /api/documents/:id             - Get document metadata
GET    /api/documents/:id/access      - Get presigned S3 URL for viewing
GET    /api/documents/:id/file        - Download document file
DELETE /api/documents/:id             - Delete document
GET    /api/search-documents          - Search by name/FamilySearch ID
```

### Queue & Scraping
```
POST   /api/submit-url                - Submit URL for scraping (with metadata)
GET    /api/queue-stats               - Queue statistics
POST   /api/trigger-queue-processing  - Trigger batch processing (3-5 URLs)
POST   /api/process-full-backlog      - Process ALL pending URLs ⭐ NEW
```

### Reparations & Genealogy
```
POST   /api/search-reparations        - Search by name/year/ID
POST   /api/get-descendants           - Get descendants for a person
GET    /api/population-stats          - Progress toward 393,975 goal
```

### Beyond Kin Review
```
GET    /api/beyond-kin/pending        - Get pending reviews
POST   /api/beyond-kin/:id/approve    - Approve submission
POST   /api/beyond-kin/:id/reject     - Reject submission
POST   /api/beyond-kin/:id/needs-document - Request documentation
```

### Utility
```
GET    /api                           - API info
GET    /api/health                    - Health check
GET    /api/carousel-data             - Carousel display data
GET    /api/cors-test                 - CORS diagnostic
```

---

## Environment Configuration

### Required Environment Variables
```bash
# PostgreSQL Database
DATABASE_URL=postgresql://user:password@host:port/database

# AWS S3 Storage
S3_ENABLED=true
S3_BUCKET=reparations-them
S3_REGION=us-east-2                    # IMPORTANT: us-east-2, NOT us-east-1
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key

# Google Cloud Vision API (for OCR)
GOOGLE_VISION_API_KEY=your_api_key_here

# Server Configuration
PORT=3000
NODE_ENV=production
```

---

## Deployment Architecture

### Production Environment: Render.com

**Backend Service:**
- **Name:** reparations-platform
- **URL:** https://reparations-platform.onrender.com
- **Build Command:** `npm install`
- **Start Command:** `npm start` → `node src/server.js`
- **Health Check:** `GET /health`
- **Auto-deploy:** From main branch on GitHub

**Database:**
- **Name:** reparations-db
- **Platform:** Render PostgreSQL 17
- **Region:** Virginia (us-east)

**Storage:**
- **Platform:** AWS S3
- **Bucket:** reparations-them
- **Region:** us-east-2

**Frontend:**
- **Platform:** GitHub Pages
- **URL:** https://danyelajunebrown.github.io
- **API Base URL:** https://reparations-platform.onrender.com

---

## Database Schema

### Core Tables

**individuals** (confirmed persons)
```sql
CREATE TABLE individuals (
  individual_id SERIAL PRIMARY KEY,
  full_name VARCHAR(255),
  birth_year INTEGER,
  death_year INTEGER,
  locations TEXT[],
  source_documents JSONB,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**unconfirmed_persons** (staging table)
```sql
CREATE TABLE unconfirmed_persons (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(255),
  person_type VARCHAR(50),          -- 'owner', 'suspected_owner', 'enslaved', 'suspected_enslaved'
  birth_year INTEGER,
  death_year INTEGER,
  locations TEXT[],
  source_url TEXT,
  source_type VARCHAR(100),
  confidence_score NUMERIC(3,2),
  context_text TEXT,
  relationships JSONB,
  status VARCHAR(50),               -- 'pending', 'reviewing', 'confirmed'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**scraping_queue**
```sql
CREATE TABLE scraping_queue (
  id SERIAL PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  category VARCHAR(100),
  submitted_by VARCHAR(255),
  status VARCHAR(50) DEFAULT 'pending',
  priority INTEGER DEFAULT 5,
  metadata JSONB,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processing_started_at TIMESTAMP,
  processing_completed_at TIMESTAMP,
  error_message TEXT
);
```

**documents**
```sql
CREATE TABLE documents (
  document_id VARCHAR(255) PRIMARY KEY,
  owner_name VARCHAR(255),
  doc_type VARCHAR(100),
  file_path VARCHAR(500),
  filename VARCHAR(255),
  storage_type VARCHAR(50) DEFAULT 'local',
  total_enslaved INTEGER DEFAULT 0,
  total_reparations DECIMAL(15,2) DEFAULT 0,
  ocr_text TEXT,
  verification_status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## File Structure

```
reparations-is-a-real-number/
├── src/
│   ├── server.js                 # ⭐ PRODUCTION SERVER (used by Render)
│   ├── api/
│   │   └── routes/
│   │       ├── documents.js      # Document endpoints
│   │       ├── research.js       # LLM/research endpoints
│   │       ├── health.js         # Health check
│   │       └── errors.js         # Error logging
│   ├── services/
│   │   ├── document/
│   │   │   ├── EnhancedDocumentProcessor.js
│   │   │   ├── S3StorageAdapter.js
│   │   │   └── OCRProcessor.js
│   │   └── scraping/
│   │       ├── UnifiedScraper.js # ⭐ MAIN SCRAPER (8 handlers)
│   │       └── Orchestrator.js   # Legacy (broken dependencies)
│   ├── database/
│   │   └── connection.js
│   └── utils/
│       └── logger.js
│
├── server.js                     # Legacy server (NOT used in production)
├── config.js                     # Central configuration
├── middleware/
│   ├── error-handler.js
│   ├── rate-limit.js
│   ├── validation.js
│   └── auth.js
│
├── index.html                    # Main dashboard
├── portal.html                   # Reparations search
├── contribute.html               # URL submission (enhanced with metadata)
│
├── memory-bank/                  # AI context persistence
│   ├── projectbrief.md
│   ├── productContext.md
│   ├── systemPatterns.md
│   ├── techContext.md            # This file
│   ├── activeContext.md
│   └── progress.md
│
├── contracts/                    # Solidity smart contracts
│   ├── contracts/
│   │   ├── ReparationsEscrow.sol
│   │   └── ReparationsLedger.sol
│   └── truffle-config.js
│
├── package.json
└── .env                          # Environment variables (gitignored)
```

---

## Common Issues & Solutions

### Issue: Document Viewer Not Full Screen
**Cause:** Document viewer nested inside widget container with position: absolute
**Solution:**
1. Change CSS to `position: fixed`, `width: 100vw`, `height: 100vh`, `z-index: 9999`
2. Move document viewer HTML to body level

### Issue: API Endpoints Return 404
**Cause:** `src/server.js` missing endpoints that exist in legacy `server.js`
**Solution:** Add missing endpoints inline to `src/server.js`

### Issue: S3 PermanentRedirect Error
**Cause:** S3 bucket in us-east-2 but config defaulting to us-east-1
**Solution:** Update `S3_REGION=us-east-2` in .env and config.js default

### Issue: Scraper Not Saving to Individuals Table
**Cause:** Only unconfirmed_persons was being populated
**Solution:** In UnifiedScraper.saveResults(), check if confidence >= 0.9 and save directly to individuals table

### Issue: Backlog Not Processing
**Cause:** No auto-processing endpoint
**Solution:** Added `POST /api/process-full-backlog` endpoint with rate limiting

---

## Scraping Data Flow

```
User submits URL (contribute.html)
         ↓
POST /api/submit-url (with category + metadata)
         ↓
scraping_queue table (status: pending)
         ↓
POST /api/process-full-backlog (or /api/trigger-queue-processing)
         ↓
UnifiedScraper.scrapeURL()
         ↓
detectCategory() → route to handler
         ↓
Handler extracts: owners[], enslavedPeople[], relationships[]
         ↓
saveResults()
    ├── if confidence >= 0.9 → individuals table ✅
    ├── all data → unconfirmed_persons table
    └── if slaveCount → slaveholder_records table
         ↓
scraping_queue updated (status: completed)
```

---

## Contribution Pipeline Architecture ⭐ NEW (Dec 2025)

### ContributionSession.js (`src/services/contribution/ContributionSession.js`)

Manages conversational contribution flow:

```javascript
class ContributionSession {
    stages = [
        'url_analysis',
        'content_description',
        'structure_confirmation',
        'extraction_strategy',
        'extraction_in_progress',
        'human_review',
        'complete'
    ];

    // Confirmatory channels - ways data can be confirmed
    confirmatoryChannels = [
        { id: 'human_transcription', confidenceWeight: 0.95 },
        { id: 'ocr_verified', confidenceWeight: 0.90 },
        { id: 'ocr_high_confidence', confidenceWeight: 0.75 },
        { id: 'page_metadata', confidenceWeight: 0.60 },
        { id: 'cross_reference', confidenceWeight: 0.70 }
    ];

    async analyzeUrl(sessionId) { ... }
    async processContentDescription(sessionId, userInput) { ... }
    async confirmStructure(sessionId, userConfirmation) { ... }
    async startExtraction(sessionId, method, options) { ... }
}
```

### OwnerPromotion.js (`src/services/contribution/OwnerPromotion.js`)

Content-based promotion with confirmatory channels:

```javascript
class OwnerPromotion {
    // CRITICAL: Promotion requires a confirmatory channel
    confirmatoryChannels = {
        'human_transcription': { minConfidence: 0.90 },
        'ocr_human_verified': { minConfidence: 0.85 },
        'ocr_high_confidence': { minConfidence: 0.95 },
        'structured_metadata': { minConfidence: 0.80 },
        'cross_reference': { minConfidence: 0.85 }
    };

    // Domain does NOT confirm - only provides context
    qualifiesForPromotion(person, sourceMetadata, confirmationChannel) {
        if (!confirmationChannel) {
            return { qualifies: false, reason: 'No confirmatory channel' };
        }
        // ...
    }

    async promoteOwner(person, sourceMetadata, confirmationChannel) { ... }
}
```

### Contribution API Endpoints

```
POST /api/contribute/start              - Start session with URL
POST /api/contribute/:id/chat           - Natural language interaction
POST /api/contribute/:id/describe       - Process content description
POST /api/contribute/:id/confirm        - Confirm structure
POST /api/contribute/:id/extract        - Start extraction
POST /api/contribute/:id/sample         - Submit sample extractions
GET  /api/contribute/:id                - Get session state
POST /api/contribute/:id/extraction/:eid/promote - Promote (REQUIRES confirmationChannel)
POST /api/contribute/promote/:leadId    - Manual promotion
GET  /api/contribute/promotion-stats    - Statistics
```

### Contribution Database Tables

```sql
-- Conversation state
CREATE TABLE contribution_sessions (
    session_id UUID PRIMARY KEY,
    url TEXT NOT NULL,
    contributor_id TEXT,
    current_stage TEXT DEFAULT 'url_analysis',
    conversation_history JSONB,
    source_metadata JSONB,
    content_structure JSONB,
    extraction_guidance JSONB,
    status TEXT DEFAULT 'in_progress',
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Extraction jobs
CREATE TABLE extraction_jobs (
    extraction_id UUID PRIMARY KEY,
    session_id UUID REFERENCES contribution_sessions,
    content_url TEXT,
    method TEXT,  -- 'auto_ocr', 'guided_entry', 'sample_learn', 'csv_upload'
    status TEXT DEFAULT 'pending',
    parsed_rows JSONB,
    avg_confidence DECIMAL,
    human_corrections INTEGER DEFAULT 0
);

-- Promotion audit trail
CREATE TABLE promotion_log (
    promotion_id SERIAL PRIMARY KEY,
    individual_id TEXT NOT NULL,
    full_name TEXT NOT NULL,
    source_url TEXT,
    confidence_score DECIMAL,
    promotion_type TEXT,  -- confirmatory channel used
    promotion_reason TEXT,
    promoted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Confirmation Logic (CRITICAL)

```
Source Domain (.gov, genealogy site, etc.)
    → Provides CONTEXT about where to look
    → Does NOT confirm data

Confirmation can ONLY come from:
    1. human_transcription - User manually typed names
    2. ocr_human_verified - OCR + human corrections
    3. ocr_high_confidence - >= 95% OCR confidence
    4. structured_metadata - Parsed data user confirmed
    5. cross_reference - Matches existing confirmed record
```

### End-to-End Test

Run with: `node test-contribution-pipeline-e2e.js`

Tests 3 description styles against the full pipeline, validates question structure, verifies all stages complete.

---

*This document provides the technical foundation for the Reparations Platform.*
