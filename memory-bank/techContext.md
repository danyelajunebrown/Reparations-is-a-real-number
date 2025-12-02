# Technical Context: Reparations Is A Real Number

**Last Updated:** December 2, 2025

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

2. **`src/server.js`** - Refactored modular server (~800 lines)
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
app.post('/api/search-reparations', ...)
app.post('/api/get-descendants', ...)
app.get('/api/beyond-kin/pending', ...)
app.post('/api/beyond-kin/:id/approve', ...)
app.post('/api/beyond-kin/:id/reject', ...)
app.post('/api/beyond-kin/:id/needs-document', ...)
app.post('/api/process-individual-metadata', ...)
app.get('/api/cors-test', ...)
app.get('/api', ...)
```

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
GET    /api/documents/owner/:name     - Get documents by owner name
GET    /api/documents/stats/global    - Global statistics
GET    /api/search-documents          - Search by name/FamilySearch ID
```

### Carousel & Frontend
```
GET    /api/carousel-data             - Get cards for carousel display
GET    /api/population-stats          - Progress toward 393,975 goal
```

### Queue & Scraping
```
POST   /api/submit-url                - Submit URL for scraping
GET    /api/queue-stats               - Queue statistics
POST   /api/trigger-queue-processing  - Trigger background processing
```

### Reparations & Genealogy
```
POST   /api/search-reparations        - Search by name/year/ID
POST   /api/get-descendants           - Get descendants for a person
POST   /api/llm-query                 - Research assistant query
POST   /api/clear-session             - Clear research session
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
GET    /health                        - Legacy health (redirects)
GET    /api/cors-test                 - CORS diagnostic
POST   /api/errors/log                - Client error logging
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

# IPFS (Optional)
IPFS_ENABLED=false
IPFS_GATEWAY=https://ipfs.io/ipfs/

# Server Configuration
PORT=3000
NODE_ENV=production

# Security (Optional)
JWT_SECRET=your_jwt_secret_here
```

### Configuration Loading (config.js)
```javascript
module.exports = {
  storage: {
    s3: {
      enabled: process.env.S3_ENABLED === 'true',
      bucket: process.env.S3_BUCKET || '',
      region: process.env.S3_REGION || 'us-east-2'  // Default updated to us-east-2
    }
  }
};
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
- **SSL:** Required

**Storage:**
- **Platform:** AWS S3
- **Bucket:** reparations-them
- **Region:** us-east-2

**Frontend:**
- **Platform:** GitHub Pages
- **URL:** https://danyelajunebrown.github.io
- **API Base URL:** https://reparations-platform.onrender.com

---

## Frontend Configuration

### API_BASE_URL Setting
All frontend files use the same API base:

```javascript
// In index.html, portal.html, contribute.html
const API_BASE_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:3000'
    : 'https://reparations-platform.onrender.com';
```

### Document Viewer CSS (Critical)
The document viewer must use these styles for proper full-screen overlay:

```css
.document-viewer-container {
    position: fixed;           /* NOT absolute */
    top: 0;
    left: 0;
    width: 100vw;              /* NOT 100% */
    height: 100vh;             /* NOT 100% */
    background: rgba(10, 14, 39, 0.98);
    display: none;
    flex-direction: row;
    z-index: 9999;             /* High value to overlay everything */
    opacity: 0;
    transition: opacity 0.3s ease;
}
```

**Important:** The document viewer HTML must be at body level, NOT nested inside other containers.

---

## Database Schema

### Core Tables

**documents**
```sql
CREATE TABLE documents (
  document_id VARCHAR(255) PRIMARY KEY,
  owner_name VARCHAR(255),
  doc_type VARCHAR(100),
  file_path VARCHAR(500),
  filename VARCHAR(255),
  file_size BIGINT,
  mime_type VARCHAR(100),
  storage_type VARCHAR(50) DEFAULT 'local',
  total_enslaved INTEGER DEFAULT 0,
  total_reparations DECIMAL(15,2) DEFAULT 0,
  ocr_text TEXT,
  ocr_confidence NUMERIC(5,2),
  verification_status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**scraping_queue**
```sql
CREATE TABLE scraping_queue (
  id SERIAL PRIMARY KEY,
  url TEXT NOT NULL,
  category VARCHAR(100),
  submitted_by VARCHAR(255),
  status VARCHAR(50) DEFAULT 'pending',
  priority INTEGER DEFAULT 5,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processing_started_at TIMESTAMP,
  processing_completed_at TIMESTAMP,
  error_message TEXT
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
│   │   │   ├── FileTypeDetector.js
│   │   │   └── OCRProcessor.js
│   │   └── scraping/
│   │       └── Orchestrator.js
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
├── contribute.html               # URL submission
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
├── .env                          # Environment variables (gitignored)
└── .env.example                  # Example configuration
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

### Issue: Frontend Calling Wrong Backend
**Cause:** API_BASE_URL pointing to non-existent Render service
**Solution:** Ensure all frontend files use `https://reparations-platform.onrender.com`

---

*This document provides the technical foundation for the Reparations Platform.*
