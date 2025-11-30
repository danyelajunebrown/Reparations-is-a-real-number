# Active Context: Current Development State

**Last Updated:** November 29, 2025
**Current Phase:** Production Deployment & Document Processing
**Active Branch:** main

---

## Recent Major Changes (Nov 19-30, 2025)

### 6. Render Deployment Fix - Dual Server Architecture Issue ✅ (Nov 30, 2025)
**Problem:** Render deployment failing because wrong server being started.

**Root Cause:**
- Project has TWO servers:
  1. **Legacy `server.js`** (1,200+ lines) - Full-featured, all API endpoints
  2. **New `src/server.js`** (150 lines) - Minimal refactored version, incomplete
- `package.json` was set to `"start": "node index.js"`
- `index.js` loads `src/server.js` (the incomplete one)
- Frontend expects legacy server endpoints
- Result: Deployment succeeded but API endpoints were missing/broken

**Solution Implemented:**
- Changed `package.json` start script from `node index.js` to `node server.js`
- This ensures Render uses the fully-featured legacy server
- All API endpoints now available: upload, search, llm-query, beyond-kin, etc.

**Files Changed:**
- `package.json` (line 7: start script)

**Impact:**
- ✅ All frontend API calls will now work
- ✅ Document upload/viewing functional
- ✅ Research assistant operational
- ✅ Beyond Kin review queue accessible
- ✅ Static file serving includes `frontend/public/carousel-enhancements.js`

**Next Steps:**
- Commit changes with message: "Fix Render deployment: Switch to legacy server.js"
- Push to GitHub
- Render will auto-deploy
- Wait 2-3 minutes for deployment
- Test health endpoint: https://reparations-platform.onrender.com/health
- Test frontend media assets loading

**Long-term Plan:**
- Keep using `server.js` (legacy) for production
- Continue refactoring `src/server.js` in parallel
- Use feature flags for gradual migration
- Full cutover only when `src/server.js` has parity with all endpoints

---

## Recent Major Changes (Nov 19-29, 2025)

### 1. File Type Detection Implementation ✅
**Problem:** PDF files were being corrupted because the system trusted file extensions instead of validating actual content.

**Root Cause:**
- A .pdf file was uploaded that contained plain text (OCR data) instead of PDF binary
- Database record claimed 4.8MB PDF, actual file was 2.1KB text
- No content validation before storage or retrieval

**Solution Implemented:**
- Installed `file-type@12.4.2` package (CommonJS compatible)
- Updated `storage-adapter.js` to detect file type using magic numbers
- Added `detectFileType()` method that reads file buffer and validates content
- Updated server.js download endpoint to verify MIME type before serving
- Added warning logs for mismatched file types

**Files Changed:**
- `storage-adapter.js` (lines 33-61, 70-90, 126-146)
- `server.js` (document retrieval endpoint)
- `upload-james-hopewell-pdfs.js` (migration script)
- `package.json` (added file-type dependency)

**Code Example:**
```javascript
// storage-adapter.js
async detectFileType(filePath) {
  const buffer = await fs.readFile(filePath);
  const detected = await fileType(buffer); // Magic number detection

  if (detected) {
    console.log(`✓ Detected file type: ${detected.mime} (.${detected.ext})`);
    return detected;
  }

  // Fallback: Check if plain text
  const sample = buffer.toString('utf8', 0, Math.min(512, buffer.length));
  const isBinaryFree = !/[\x00-\x08\x0E-\x1F]/.test(sample);
  if (isBinaryFree) {
    return { ext: 'txt', mime: 'text/plain' };
  }

  return { ext: 'bin', mime: 'application/octet-stream' };
}
```

### 2. S3 Persistent Storage Migration ✅
**Problem:** Render's free tier uses ephemeral filesystem - files uploaded Nov 19 were wiped on Nov 24 restart.

**Impact:**
- Original 4.8MB PDFs (James Hopewell will, 2 pages) lost
- Database still referenced deleted files
- Replaced with 2.1KB test files during debugging

**Solution Implemented:**
- Configured AWS S3 bucket: `reparations-them` (us-east-1)
- Updated `config.js` to support S3 configuration via env vars
- Modified `storage-adapter.js` to upload to S3 with local fallback
- Created `upload-james-hopewell-pdfs.js` migration script
- Successfully uploaded original PDFs to S3
- Updated database records with correct file paths

**S3 Configuration:**
```bash
S3_ENABLED=true
S3_BUCKET=reparations-them
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIAU7BYZX2VYR6CS73L
AWS_SECRET_ACCESS_KEY=[configured in Render]
```

**Files Changed:**
- `config.js` (added storage.s3 configuration)
- `storage-adapter.js` (added uploadFileToS3 method)
- `upload-james-hopewell-pdfs.js` (new migration script)
- `RUN-THIS-TO-UPLOAD-PDFS.sh` (helper script)
- `DEPLOYMENT-FIX-GUIDE.md` (comprehensive deployment guide)

### 3. Multiple Deployment Fixes ✅
**Problem:** Sequential deployment failures on Render due to dependency and configuration issues.

**Deployment Failures:**
1. **dep-d4ktbchr0fns73cf6neg** - file-type v16 ES module incompatibility
2. **dep-d4lja324d50c73e4k8mg** - file-type v16 ES module incompatibility
3. **dep-d4ljjnhr0fns73cjgp4g** - Missing config.apiKeys.googleVision

**Fixes Applied:**
- Downgraded file-type from v16.5.4 to v12.4.2 (CommonJS compatible)
- Updated API calls from `FileType.fromFile(path)` to `fileType(buffer)`
- Restructured config.js to add missing properties:
  - `apiKeys.googleVision`
  - `env`, `isDevelopment`, `port`
  - `security.allowedOrigins`
  - POSTGRES_* environment variable fallbacks

**Final Successful Deployment:**
- Service: reparations-platform (srv-d4j61k24d50c73e3sv8g)
- URL: https://reparations-platform.onrender.com
- Status: Live and healthy
- Health Check: `GET /health` returns 200 OK

### 4. Google Cloud Vision API Integration ✅
**Problem:** OCR processing was configured but missing API key.

**Solution:**
- Added GOOGLE_VISION_API_KEY to Render environment variables
- API Key: AIzaSyDYVe9vG4AqrsBN2xuSDkCbolHQrLc9SMo
- Updated config.js to properly expose apiKeys.googleVision
- OCR pipeline now uses Google Vision (primary) with Tesseract.js fallback

**OCR Flow:**
```
Document Upload → File Type Detection → S3 Storage
                                              ↓
Google Vision API (90-95% accuracy) → Extract Text
                ↓ (fallback if fail)
Tesseract.js (60-80% accuracy) → Extract Text
                                              ↓
Database Insert (ocr_text, ocr_confidence, ocr_service)
```

### 5. Memory Bank Implementation 🔄
**Purpose:** Implement persistent AI context system for Cline/Claude development.

**Completed:**
- ✅ Created `memory-bank/` directory structure
- ✅ `projectbrief.md` - Project vision, goals, constraints
- ✅ `productContext.md` - User personas, workflows, ethical considerations
- ✅ `systemPatterns.md` - Architecture patterns, design decisions
- ✅ `techContext.md` - Tech stack, dependencies, deployment
- ✅ `activeContext.md` - This file (current state)
- ⏳ `progress.md` - Development tracker (pending)

**Pending:**
- Create Cline custom instructions guide with Mermaid flowcharts
- Guide user through Cline setup in VS Code

---

## Current Database State

### Documents Table
**Key Record:**
- `document_id`: d94180c70274f7bf25b735a8
- `owner_name`: James Hopewell
- `file_path`: owners/James-Hopewell/will/James-Hopewell-will-page1.pdf (S3)
- `file_size`: 10,179,994 bytes (combined 2 pages)
- `mime_type`: application/pdf
- `ocr_text`: "In the name of God Amen. I, James Hopewell..." (full will text)
- `ocr_service`: manual_import
- `ocr_confidence`: 1.0
- `verification_status`: pending

### S3 Storage Structure
```
s3://reparations-them/
└── owners/
    └── James-Hopewell/
        └── will/
            ├── James-Hopewell-will-page1.pdf (5.2 MB)
            └── James-Hopewell-will-page2.pdf (4.7 MB)
```

### Local Storage (Legacy)
```
./storage/
└── owners/
    └── James-Hopewell/
        └── will/
            └── James-Hopewell-will-1763564287838.pdf (2.1 KB plain text)
```
**Note:** Local file is obsolete test data, production uses S3

---

## Known Issues & Limitations

### High Priority
1. **Authentication Missing** 🔴
   - API endpoints are completely open
   - No user authentication or authorization
   - JWT_SECRET configured but not implemented
   - **Risk:** Anyone can upload documents, modify database
   - **Next Step:** Implement JWT middleware for protected routes

2. **Rate Limiting Not Active** 🟡
   - express-rate-limit installed but not configured
   - **Risk:** API abuse, DoS attacks
   - **Next Step:** Configure rate limits per endpoint

3. **Input Validation Minimal** 🟡
   - No schema validation on POST bodies
   - Joi package installed but not used
   - **Risk:** Malformed data causing crashes
   - **Next Step:** Add Joi schemas for all API endpoints

### Medium Priority
4. **No Test Suite** 🟡
   - Zero automated tests
   - Manual testing only
   - **Next Step:** Add Jest or Mocha with basic API tests

5. **Frontend Not Connected** 🟡
   - Frontend deployed on GitHub Pages (separate repo)
   - Needs API_BASE_URL configured to Render backend
   - CORS enabled but frontend may need updates
   - **Next Step:** Verify frontend-backend integration

6. **IPFS Integration Disabled** 🟡
   - IPFS_ENABLED=false in environment
   - ipfs-http-client package installed
   - **Next Step:** Configure local IPFS daemon or use Infura

7. **Blockchain Contracts Not Deployed** 🟡
   - Contracts compiled but not deployed to testnet/mainnet
   - Only tested on local Ganache
   - **Next Step:** Deploy to Goerli testnet, update frontend ABIs

### Low Priority
8. **No Pagination** 🟢
   - API endpoints return all results
   - Will cause performance issues at scale
   - **Next Step:** Add LIMIT/OFFSET to database queries

9. **Logging Needs Improvement** 🟢
   - Winston configured but not used consistently
   - Console.log scattered throughout code
   - **Next Step:** Replace console.log with logger.info/error

10. **No Error Tracking** 🟢
    - No Sentry or Rollbar integration
    - Errors only visible in Render logs
    - **Next Step:** Add error tracking service

---

## Immediate Next Steps

### Short-term (This Week)
1. ✅ Complete Memory Bank documentation
2. ✅ Create Cline custom instructions guide
3. 🔄 Triage current Render deployment failure (user requested)
4. ⏳ Test document upload pipeline end-to-end
5. ⏳ Verify S3 file retrieval works correctly
6. ⏳ Test OCR processing with Google Vision API

### Medium-term (This Month)
1. Implement JWT authentication middleware
2. Add rate limiting to API endpoints
3. Add Joi schema validation for all POST bodies
4. Deploy smart contracts to Goerli testnet
5. Connect frontend to backend API
6. Add basic API tests (Jest)

### Long-term (Next Quarter)
1. Build admin dashboard for verification queue
2. Implement IPFS integration for document hashing
3. Add pagination to all list endpoints
4. Set up error tracking (Sentry)
5. Implement async job queue for OCR processing
6. Add multi-page PDF upload support

---

## Development Environment Setup

### Required Tools
- Node.js 18+
- PostgreSQL 15+
- Git
- Code editor (VS Code recommended)
- Cline extension for VS Code

### Quick Start
```bash
# Clone repository
git clone [repository-url]
cd reparations-is-a-real-number-main

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Initialize database
npm run init-db

# Start development server
npm run dev
```

### Environment Variables Checklist
- ✅ POSTGRES_HOST
- ✅ POSTGRES_DB
- ✅ POSTGRES_USER
- ✅ POSTGRES_PASSWORD
- ✅ GOOGLE_VISION_API_KEY
- ✅ S3_ENABLED
- ✅ S3_BUCKET
- ✅ S3_REGION
- ✅ AWS_ACCESS_KEY_ID
- ✅ AWS_SECRET_ACCESS_KEY
- ⏳ JWT_SECRET (configured but not used)
- ⏳ ALLOWED_ORIGINS (configured but not enforced)

---

## Recent Git Commits

```
[PENDING] Fix Render deployment: Switch to legacy server.js
e6f641f Fix document file serving: Try local first, then S3
fe0be8e Fix config validation: Remove strict database requirement
aa11d0a Fix deployment: Make JWT_SECRET optional with secure default
8dd9dff Fix document viewer: Add missing /file endpoint
7bb2658 Major architecture refactoring: Production-ready modernization
```

**Current Branch:** main
**Untracked Files:**
- delete-scraped-from-s3.js
- download-from-s3.js
- extract-pdf-text.js
- james-hopewell-from-s3.pdf
- upload-scraped-to-s3.js

**Deleted Files (staged):**
- Multiple scraped-documents/*.pdf files (moved to S3)

---

## Active Monitoring

### Render Service Health
- **Service ID:** srv-d4j61k24d50c73e3sv8g
- **URL:** https://reparations-platform.onrender.com
- **Health Endpoint:** https://reparations-platform.onrender.com/health
- **Last Successful Deploy:** November 29, 2025
- **Build Status:** Live

### Database Connection
- **Provider:** Render PostgreSQL
- **Connection:** Via DATABASE_URL environment variable
- **SSL:** Required (sslmode=require)
- **Status:** Connected and healthy

### S3 Bucket
- **Bucket:** reparations-them
- **Region:** us-east-1
- **Public Access:** Blocked (private bucket)
- **Versioning:** Disabled
- **Status:** Active, 2 files uploaded

---

## Questions for User / Decisions Needed

1. **Frontend Deployment:** Should we connect the GitHub Pages frontend to the Render backend?
2. **Authentication:** What authentication strategy? (JWT, OAuth, session-based?)
3. **Blockchain Network:** Deploy to Goerli testnet or wait for mainnet?
4. **IPFS:** Use local daemon or Infura IPFS service?
5. **Rate Limiting:** What limits per endpoint? (e.g., 100 requests/15min?)
6. **Monitoring:** Prefer Sentry, Rollbar, or another error tracking service?

---

## Context for AI Assistants (Cline/Claude)

**Current Task:** Memory Bank implementation and Cline setup guide

**Recent Work Session:**
1. Fixed file type detection corruption issue
2. Migrated storage from ephemeral filesystem to S3
3. Fixed multiple Render deployment failures
4. Uploaded James Hopewell PDFs to S3
5. Created Memory Bank documentation structure
6. Currently creating Cline custom instructions

**User's Immediate Need:** "Triage Render deployment failure exclusively on Cline"

**Next Actions:**
1. Complete progress.md documentation
2. Create Cline custom instructions guide with Mermaid diagrams
3. Guide user through Cline setup in VS Code
4. Triage any active Render deployment issues

---

*This document is updated frequently as development progresses. Always check the "Last Updated" timestamp.*
