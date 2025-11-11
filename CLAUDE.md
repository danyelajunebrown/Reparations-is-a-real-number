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
    â†“
Express API Server (server.js)
    â†“
â”œâ”€ Document Processor Pipeline
â”œâ”€ Storage Adapter (Local/S3/IPFS)
â”œâ”€ PostgreSQL Database
â””â”€ Ethereum Smart Contracts
```

### Core Processing Pipeline

**Document Upload Flow** (`enhanced-document-processor.js`):
1. File upload via Multer â†’ temp storage
2. StorageAdapter â†’ permanent storage (`./storage/owners/{name}/{type}/`)
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

GET /health
  - Health check: { status: 'ok', timestamp }
```

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

# Google Vision API
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
â”œâ”€â”€ server.js                    # Express server entry point
â”œâ”€â”€ app.js                       # Web3 frontend integration
â”œâ”€â”€ config.js                    # Central configuration
â”œâ”€â”€ database.js                  # PostgreSQL client
â”œâ”€â”€ database-schemas.js          # Schema definitions
â”œâ”€â”€ enhanced-document-processor.js  # Main document pipeline
â”œâ”€â”€ storage-adapter.js           # Storage abstraction
â”œâ”€â”€ reparations-calculator.js    # Economic calculations
â”œâ”€â”€ familysearch-reparations-integration.js  # Genealogy integration
â”œâ”€â”€ init-database.js             # Database initialization script
â”œâ”€â”€ contracts/
â”‚   â”œâ”€â”€ contracts/*.sol          # Solidity smart contracts
â”‚   â””â”€â”€ migrations/              # Truffle deployment scripts
â””â”€â”€ frontend/
    â””â”€â”€ public/
        â”œâ”€â”€ index.html           # Main UI
        â””â”€â”€ app.js               # Blockchain integration
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

## Common Issues & Solutions

**Database Foreign Key Errors (`document_individuals_document_id_fkey`)**:
- **Symptom**: Error "Failed to save metadata: insert or update on table document_individuals violates foreign key constraint"
- **Cause**: Trying to link individuals to documents before the document record exists in the `documents` table
- **Solution**: The `/api/process-individual-metadata` endpoint now checks if document exists before linking
- **Prevention**: Always ensure document upload completes and returns valid `document_id` before processing individual metadata

**Document Upload Order**:
1. Upload file via `/api/upload-document` → returns `documentId`
2. Use returned `documentId` when calling `/api/process-individual-metadata`
3. Document must be in `documents` table before linking individuals

**Frontend-Backend Connection**:
- Frontend (GitHub Pages) must call backend (Render) API endpoints
- CORS is enabled in server.js for cross-origin requests
- Check browser console for API connection errors
- Verify API_BASE_URL points to: `https://reparations-platform.onrender.com`
