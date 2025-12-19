# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A blockchain-based reparations platform that processes historical documents to identify enslaved ancestors, calculate descendant reparations, and manage payments through Ethereum smart contracts. The system integrates genealogical APIs (FamilySearch, Ancestry), document processing (OCR), and economic calculations.

**Tech Stack**: Node.js/Express, PostgreSQL, Ethereum/Solidity, Web3.js, IPFS

## Common Commands

```bash
# Development
npm run dev              # Start server with auto-reload (nodemon)
npm start                # Start production server (port 3000)

# Database
npm run init-db          # Initialize PostgreSQL schema and tables

# Blockchain Development
ganache-cli              # Start local blockchain on port 8545
truffle compile          # Compile Solidity contracts
truffle migrate          # Deploy contracts to configured network
```

## Architecture Overview

### Layered Architecture
```
Frontend (HTML/JS + Web3.js)
    Ã¢â€ â€œ
Express API Server (server.js)
    Ã¢â€ â€œ
Ã¢â€Å“Ã¢â€â‚¬ Document Processor Pipeline
Ã¢â€Å“Ã¢â€â‚¬ Storage Adapter (Local/S3/IPFS)
Ã¢â€Å“Ã¢â€â‚¬ PostgreSQL Database
Ã¢â€â€Ã¢â€â‚¬ Ethereum Smart Contracts
```

### Core Processing Pipeline

**Document Upload Flow** (`enhanced-document-processor.js`):
1. File upload via Multer Ã¢â€ â€™ temp storage
2. StorageAdapter Ã¢â€ â€™ permanent storage (`./storage/owners/{name}/{type}/`)
3. IPFS hash generation (optional, for immutability)
4. OCR processing (Google Vision API preferred, Tesseract.js fallback)
5. Data extraction (enslaved names, relationships, metadata)
6. Reparations calculation
7. PostgreSQL insert (documents, enslaved_people, families, reparations_breakdown tables)

### Key Modules

**Document Processing**:
- `enhanced-document-processor.js` - Main orchestrator
- `storage-adapter.js` - Abstracts local/S3 storage
- OCR via Google Vision API (requires `GOOGLE_VISION_API_KEY`) or Tesseract.js

**Genealogy & Calculations**:
- `reparations-calculator.js` - Economic calculations (inflation, interest, damages)
- `familysearch-reparations-integration.js` - FamilySearch API + descendant calculations
- `familysearch-integration.js` - OAuth and person data
- `debt-tracker.js` - Tracks slaveowner debts and inheritance chains

**Database**:
- `database.js` - PostgreSQL client, supports both `DATABASE_URL` and individual `POSTGRES_*` env vars
- `database-schemas.js` - Complete schema definitions
- Key tables: `documents`, `enslaved_people`, `families`, `reparations_breakdown`, `verification_reviews`
- Views: `owner_summary`, `verification_queue`, `blockchain_queue`, `stats_dashboard`

**Blockchain**:
- `contracts/contracts/ReparationsEscrow.sol` - Smart contract for escrow and payment distribution
- `contracts/contracts/ReparationsLedger.sol` - Ledger contract
- Frontend: `frontend/public/app.js` - Web3.js integration (requires MetaMask)

### API Endpoints

```
POST /api/upload-document
  - multipart/form-data with: document (file), ownerName, documentType, birthYear, deathYear, location
  - Returns: { success, documentId, result }

POST /api/llm-query
  - Body: { query: string }
  - Query types: "hopewell", "minna", "stats"
  - Returns: { success, response, evidence }
  - NOTE: This is NOT an LLM/AI endpoint - it's keyword-based database queries
  - Searches the `documents` table for records

POST /api/process-individual-metadata
  - Saves individual metadata to `individuals` table
  - Links individuals to documents via `document_individuals` table
  - Body: documentId, fileName, fullName, birthYear, deathYear, gender, locations, spouses, children, parents, notes

GET /health
  - Health check: { status: 'ok', timestamp }
```

### Research Assistant (FREE Natural Language Processing)

**NO API KEYS NEEDED!** The Research Assistant uses a custom-built NLP system for intelligent queries.

**Features:**
- âœ… Natural language understanding
- âœ… Entity extraction (person names, numbers)
- âœ… Intent classification (search/count/lineage)
- âœ… Context awareness (remembers previous questions)
- âœ… Pronoun resolution ("How many did he own?" knows who "he" is)
- âœ… Follow-up question handling
- âœ… 100% free - no external APIs

**How it works:**
1. **Pattern Matching**: Uses regex patterns to identify question types
2. **Entity Extraction**: Finds person names using capitalization patterns
3. **Intent Classification**: Determines what the user wants (search/count/stats)
4. **Context Memory**: Tracks last person mentioned for follow-ups
5. **Pronoun Resolution**: Replaces "he/she/they" with actual person name
6. **Database Query**: Searches relevant tables based on intent
7. **Natural Response**: Formats results in conversational language

**Supported Question Types:**

*Find Person:*
- "Do you have James Hopewell?"
- "Tell me about James Hopewell"
- "Who is James Hopewell?"
- "Search for Hopewell"

*Count Enslaved:*
- "How many enslaved people did James Hopewell own?"
- "How many did he own?" (follow-up)
- "Slave count for Hopewell"

*Reparations Amount:*
- "How much does James Hopewell owe?"
- "What reparations does he owe?" (follow-up)
- "Reparations for Hopewell"

*Statistics:*
- "Show me statistics"
- "How many total owners?"
- "What's in the database?"

*Follow-ups:*
- After asking about a person, you can say:
- "How many did he own?"
- "What does he owe?"
- "Tell me more about them"

**API Endpoints:**

`POST /api/llm-query`
- Body: `{ query: string, sessionId?: string }`
- Uses pattern-matching NLP to answer questions
- Maintains conversation context per sessionId
- Returns formatted natural language response

`POST /api/clear-chat`
- Body: `{ sessionId?: string }`
- Clears conversation history for the given session

**Session Management:**
- Each session maintains:
  - Last person mentioned
  - Last person type (owner/enslaved)
  - Conversation history
  - Last intent executed
- Sessions persist until cleared or server restart

**Database Queries:**
The NLP system queries:
- `documents` table â†’ slave owners
- `enslaved_people` table â†’ enslaved individuals
- `individuals` table â†’ verified genealogical records
- Database statistics and aggregations

**Example Conversation:**
```
User: "Do you have James Hopewell?"
Bot: "Yes, I found James Hopewell in the records. 
      Location: Maryland
      Life: 1780-1825
      Enslaved: 32 people
      Reparations: $70.4M"

User: "How many did he own?"
Bot: "James Hopewell enslaved 32 people according to the documents we have."

User: "What does he owe?"
Bot: "James Hopewell owes $70.4 million in reparations."
```

**No External Dependencies:**
- No API keys required
- No subscription costs
- Works offline (except database)
- Pure JavaScript/Node.js
- Regex-based pattern matching
- In-memory session storage

## Environment Setup

Required environment variables (create `.env` file):

```bash
# PostgreSQL - Use either DATABASE_URL OR individual variables
DATABASE_URL=postgresql://user:pass@host:port/dbname  # Render.com style
# OR
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=reparations
POSTGRES_USER=reparations_user
POSTGRES_PASSWORD=secure_password

# Google Vision API (for OCR)
GOOGLE_VISION_API_KEY=your_key_here

# Storage (optional)
STORAGE_ROOT=./storage
S3_ENABLED=false
S3_BUCKET=your-bucket
S3_REGION=us-east-1

# IPFS (optional)
IPFS_ENABLED=false
IPFS_GATEWAY=https://ipfs.io/ipfs/

# Server
PORT=3000
NODE_ENV=development
```

**First-time setup**:
1. Install dependencies: `npm install`
2. Configure `.env` file with database credentials
3. Initialize database: `npm run init-db`
4. Start development server: `npm run dev`

**For blockchain development**:
1. Start Ganache: `ganache-cli`
2. Deploy contracts: `truffle migrate --network ganache`
3. Update contract addresses in frontend

## Configuration

**config.js** - Central configuration loaded from environment variables:
- Database connection settings
- Storage backend selection (local/S3)
- IPFS integration toggles
- Google Vision API key

**truffle-config.js** - Blockchain configuration:
- Networks: development (Ganache), testnet, mainnet
- Solidity compiler version: 0.8.19

## Database Architecture

**Core Tables**:
- `documents` - Master records with IPFS hashes, OCR confidence scores, checksums
- `enslaved_people` - Individual names extracted from documents
- `families` - Family groupings with relationship tracking
- `reparations_breakdown` - Detailed calculation components
- `verification_reviews` - Human verification queue

**Views for Queries**:
- `owner_summary` - Aggregated owner data
- `verification_queue` - Unverified documents
- `blockchain_queue` - Verified records ready for blockchain submission

The schema uses PostgreSQL features: JSON columns, array types, generated columns, and indexes for performance.

## Important Patterns

**Async/Await with Transactions**:
```javascript
const client = await pool.connect();
try {
  await client.query('BEGIN');
  // ... operations ...
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
}
```

**Storage Abstraction**:
The `StorageAdapter` class allows swapping between local filesystem and S3 without changing upstream code.

**Error Handling**:
Global error middleware in `server.js` catches unhandled errors. Individual modules should throw errors with descriptive messages.

**Middleware Stack** (server.js):
- CORS enabled
- JSON/URL-encoded body parsing
- Multer file uploads (50MB limit)
- Static file serving from `frontend/public`

## Smart Contracts

**ReparationsEscrow.sol** key features:
- `AncestryRecord` struct with IPFS hashes
- `submitAncestryRecord()` - File claims
- `addDescendant()` - Add family members to distribution
- `depositPayment()` - Fund reparations
- `distributePayment()` - Send to recipients
- `verifyRecord()` - Admin verification

Uses OpenZeppelin: ReentrancyGuard, Ownable, Pausable

## File Organization

```
/
Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ server.js                    # Express server entry point
Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ app.js                       # Web3 frontend integration
Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ config.js                    # Central configuration
Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ database.js                  # PostgreSQL client
Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ database-schemas.js          # Schema definitions
Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ enhanced-document-processor.js  # Main document pipeline
Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ storage-adapter.js           # Storage abstraction
Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ reparations-calculator.js    # Economic calculations
Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ familysearch-reparations-integration.js  # Genealogy integration
Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ init-database.js             # Database initialization script
Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ contracts/
Ã¢â€â€š   Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ contracts/*.sol          # Solidity smart contracts
Ã¢â€â€š   Ã¢â€â€Ã¢â€â‚¬Ã¢â€â‚¬ migrations/              # Truffle deployment scripts
Ã¢â€â€Ã¢â€â‚¬Ã¢â€â‚¬ frontend/
    Ã¢â€â€Ã¢â€â‚¬Ã¢â€â‚¬ public/
        Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ index.html           # Main UI
        Ã¢â€â€Ã¢â€â‚¬Ã¢â€â‚¬ app.js               # Blockchain integration
```

## Development Notes

**No Test Suite**: Tests are not currently configured. Consider adding Jest or Mocha for API and module testing.

**Authentication**: No authentication layer exists. API endpoints are currently open.

**Input Validation**: Limited validation on incoming data. Consider adding Joi or Zod schemas.

**File Uploads**:
- Temporary: `./uploads/` (via Multer, in .gitignore)
- Permanent: `./storage/` (via StorageAdapter, in .gitignore)

**OCR Processing**:
- Google Vision API is preferred (faster, more accurate)
- Tesseract.js is automatic fallback
- Performance difference is significant for large documents

**IPFS Integration**:
- Optional feature (can be disabled)
- Provides immutable document proofs
- Uses IPFS HTTP client to local/remote daemon

**Database Connection**:
- Supports both Render-style `DATABASE_URL` and individual env vars
- SSL certificate handling included for managed PostgreSQL

## Deployment Considerations

**Render Platform**:
- `DATABASE_URL` environment variable supported
- SSL cert handling for managed PostgreSQL included
- Set environment variables in Render dashboard
- Run `npm run init-db` on first deployment
- Backend at: `https://reparations-platform.onrender.com`
- Frontend at: GitHub Pages (must configure API_BASE_URL)

**Production Checklist**:
1. Set all required environment variables
2. Initialize database schema (`npm run init-db`)
3. Deploy smart contracts to target network
4. Configure contract addresses
5. Enable HTTPS/TLS
6. Consider rate limiting on upload endpoints

## Contribution & Extraction System (December 2024)

The platform includes a crowdsourced document contribution pipeline for extracting historical slavery records from archives.

### Key Services

**Contribution Pipeline** (`src/services/contribution/`):
- `ContributionSession.js` - Manages the multi-step contribution workflow
- `ExtractionWorker.js` - OCR processing with debug logging and database persistence
- `NarrativeExtractor.js` - AI-powered entity extraction from prose/narrative text

### Contribution API Flow

```
POST /api/contribute/start
  - Body: { url: string }
  - Analyzes URL, identifies source type (government archive, etc.)
  - Returns: { sessionId, analysis, questions }

POST /api/contribute/:sessionId/describe
  - Body: { description: string, answers: { layout_type, scan_quality, handwriting_type } }
  - User describes document structure
  - Returns: { columns, questions }

POST /api/contribute/:sessionId/confirm
  - Body: { corrections: {} }
  - Confirms or corrects column structure
  - Returns: { success, message }

POST /api/contribute/:sessionId/extract
  - Body: { method: "auto_ocr" | "manual" }
  - Triggers OCR extraction
  - Returns: { extractionId, stage: "extraction_in_progress" }

GET /api/contribute/:sessionId/extraction/:extractionId/status
  - Returns extraction progress, parsed rows, debug logs
```

### Narrative Extraction (NarrativeExtractor.js)

Extracts entities from prose text using regex patterns:
- **Slaveholders**: Names followed by "owned X slaves" patterns
- **Slave Counts**: Word-to-number conversion ("ten slaves" → 10)
- **Suspected Enslaved**: Creates placeholder records `[Unknown - 1 of N]` indexed to owners
- **Name Filtering**: Rejects location words (mill, creek), conjunctions, non-name words

### Database Persistence (ExtractionWorker.js)

The `persistToUnconfirmedPersons()` method saves extracted findings:
- Enslaved persons → `unconfirmed_persons` table with `person_type='enslaved'` or `'suspected_enslaved'`
- Slaveholders → `unconfirmed_persons` table with `person_type='slaveholder'`
- Relationships stored in JSONB field linking enslaved to owners
- Confidence scores and source URLs tracked

### Database Tables

**`unconfirmed_persons`** - Pending human review:
- `full_name`, `person_type` (enslaved/slaveholder/suspected_enslaved)
- `source_url`, `extraction_method` (ocr_extraction/narrative_count/narrative_extraction)
- `confidence_score` (0-1), `context_text`, `relationships` (JSONB)
- `status` ('pending' for review)

**`extraction_jobs`** - Extraction processing:
- `extraction_id`, `session_id`, `status` (pending/processing/completed/failed)
- `parsed_rows` (JSONB), `raw_ocr_text`, `debug_log` (JSONB)
- `row_count`, `avg_confidence`

**`contribution_sessions`** - Contribution workflow state:
- `session_id`, `url`, `stage`, `source_metadata` (JSONB)
- `content_structure` (JSONB with columns)

### Testing Extractions

```bash
# Start a contribution session
curl -X POST "https://reparations-platform.onrender.com/api/contribute/start" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://msa.maryland.gov/path/to/document.pdf"}'

# Describe the document
curl -X POST "https://reparations-platform.onrender.com/api/contribute/$SESSION_ID/describe" \
  -H "Content-Type: application/json" \
  -d '{"description":"Prose document", "answers":{"layout_type":"prose","scan_quality":"good","handwriting_type":"printed"}}'

# Trigger extraction
curl -X POST "https://reparations-platform.onrender.com/api/contribute/$SESSION_ID/extract" \
  -H "Content-Type: application/json" \
  -d '{"method":"auto_ocr"}'

# Check status
curl "https://reparations-platform.onrender.com/api/contribute/$SESSION_ID/extraction/$EXTRACTION_ID/status"
```

## Common Issues & Solutions

**JavaScript Parser Errors Breaking Frontend**:
- **Symptom**: Browser console shows "SyntaxError: Parser error" and "ReferenceError: Can't find variable: sendChatMessage"
- **Root Causes**:
  1. **Node.js modules loaded in browser**: Script tags trying to load backend files like `reparations-calculator.js`, `enhanced-document-processor.js` that contain `require()` statements
  2. **Duplicate function definitions**: Multiple definitions of the same function (e.g., `uploadMultiPageDocument`) causing brace mismatches
  3. **Orphaned code blocks**: When removing duplicate functions, leftover code fragments (lines 1200-1247 in the corrupted version) created extra closing braces without matching opens
  4. **Malformed comments**: Comment and code on same line (e.g., `// comment    const variable = ...`) causing parsing issues
- **Solution Steps**:
  1. **Remove all backend module script tags** from `<head>` section
  2. **Fix malformed comment + const declaration**: Separate onto different lines
  3. **Remove orphaned modal creation code**: Delete any code blocks that exist outside of function definitions
  4. **Validate syntax**: Extract JavaScript and run `node --check script.js`
  5. **Verify brace balance**: Use Python script to count `{` and `}` outside of strings
- **Diagnostic Commands**:
  ```bash
  # Find duplicate functions
  grep -n "^function \|^async function " index.html | sort | uniq -d
  
  # Extract and validate JavaScript
  awk '/<script>/{p=1;next}/<\/script>/{p=0}p' index.html > script.js
  node --check script.js
  
  # Count braces (use Python script with proper string handling)
  ```
- **Prevention**: 
  - Frontend (GitHub Pages) only needs HTML, CSS, and browser JavaScript
  - Backend modules stay in repo root for Render deployment but are NEVER loaded with `<script>` tags
  - All backend functionality accessed via fetch() API calls
  - When removing duplicate functions, check for orphaned code blocks after the closing brace
- **Fixed**: 2025-11-12 - Removed Node.js backend module imports, fixed malformed comment/const, removed orphaned modal code (lines 1200-1247), eliminated duplicate functions

**Server Startup Error: "Cannot access 'app' before initialization"**:
- **Symptom**: Render deployment fails with `ReferenceError: Cannot access 'app' before initialization at /opt/render/project/src/server.js:1`
- **Cause**: Route definitions were placed before Express app initialization (duplicate code at top of file)
- **Solution**: Ensure `server.js` follows correct structure:
  1. Imports (`require()` statements)
  2. App initialization (`const app = express()`)
  3. Middleware setup (`app.use()`)
  4. Route definitions (`app.get()`, `app.post()`)
  5. Server start (`app.listen()`)
- **Prevention**: Check for duplicate route code, ensure all routes come AFTER `const app = express()`
- **Fixed**: 2025-11-12 - Removed duplicate `/api/upload-multi-page-document` route from line 1

**Database Foreign Key Errors (`document_individuals_document_id_fkey`)**:
- **Symptom**: Error "Failed to save metadata: insert or update on table document_individuals violates foreign key constraint"
- **Cause**: Trying to link individuals to documents before the document record exists in the `documents` table
- **Solution**: The `/api/process-individual-metadata` endpoint now checks if document exists before linking
- **Prevention**: Always ensure document upload completes and returns valid `document_id` before processing individual metadata

**Document Upload Order**:
1. Upload file via `/api/upload-document` â†’ returns `documentId`
2. Use returned `documentId` when calling `/api/process-individual-metadata`
3. Document must be in `documents` table before linking individuals

**Frontend-Backend Connection**:
- Frontend (GitHub Pages) must call backend (Render) API endpoints
- CORS is enabled in server.js for cross-origin requests
- Check browser console for API connection errors
- Verify API_BASE_URL points to: `https://reparations-platform.onrender.com`

## Data Quality System (December 2024)

### Overview
Built a comprehensive data quality dashboard for cleaning garbage records and training the parser through human feedback.

### Database Status (as of Dec 15, 2024)
- **canonical_persons**: 1,164 records (cleaned - 47 garbage removed)
  - 1,109 valid enslavers (Ravenel family, James Hopewell, etc.)
  - 55 confirmed enslaved persons
- **unconfirmed_persons**: ~71,000+ records (needs ongoing cleanup)
  - Many low confidence OCR extractions
  - Missing owner links
  - Placeholder records removed

### Data Quality API Endpoints

```
GET /api/contribute/data-quality
  - Returns issue counts, fixable patterns, sample garbage records
  - Analyzes: placeholders, low confidence, missing owner links, names with numbers

POST /api/contribute/data-quality/fix
  - Body: { fixType: "strip_leading_numbers" | "delete_placeholders" | "delete_very_low_confidence" }
  - Applies bulk automated fixes

PUT /api/contribute/data-quality/record/:id
  - Body: { full_name: "Corrected Name", confidence_score: 0.9 }
  - Fixes individual record AND adds corrected name to training data

DELETE /api/contribute/data-quality/record/:id
  - Deletes garbage record

GET /api/contribute/canonical-audit
  - Audits canonical_persons table for garbage (organizations, placeholders, numbers)
  - Returns: { summary, garbageRecords, sampleValidOwners, sampleValidEnslaved }

DELETE /api/contribute/canonical-audit/cleanup
  - Removes garbage patterns from canonical_persons
  - Patterns: Army, University, Congress, Museum, ISBN citations, numbers in names
```

### Frontend Integration
- **Dashboard** (`/dashboard`) - Full-page data quality view
- **Main App** (`/`) - "Clean Data" button in bottom nav with badge showing issue count
- Both load from `/api/contribute/data-quality`
- Fix/Delete operations work in real-time with toast notifications

### Training Feedback Loop
1. User corrects a name via Fix button
2. Corrected name saved to database with confidence 0.9
3. Name added to `data/learned-patterns.json`
4. UnifiedNameExtractor loads patterns on next scrape
5. Parser learns to recognize similar names

### Known Data Issues

**Source Documents Not Archived**:
- Scrapers extract names but DON'T archive source document images
- `canonical_persons` has context text but no linked documents
- Only James Hopewell has actual document (will PDF in S3)
- FamilySearch/MSA documents need retroactive archiving

**BeyondKin Records**:
- Reference FamilySearch sources in context but don't link them
- Example: Thomas Ellison has BeyondKin URL but not the FamilySearch slave schedule
- Need to follow source links and archive original documents

**Schema Note**:
- `canonical_persons` uses `canonical_name` column (not `full_name`)
- `unconfirmed_persons` uses `full_name` column
- Different schemas - be careful with queries

### Files Modified
- `src/api/routes/contribute.js` - Added data quality endpoints (lines 1003-1240)
- `index.html` - Added Clean Data nav item and quality panel
- `dashboard.html` - Data Quality tab as default view
- `src/services/UnifiedNameExtractor.js` - System-wide name extraction service

### Running the Server
```bash
cd "/Users/danyelabrown/Desktop/danyelajunebrown GITHUB/Reparations-is-a-real-number-main"
node src/server.js
# Access at http://localhost:3000
# Dashboard at http://localhost:3000/dashboard
```
