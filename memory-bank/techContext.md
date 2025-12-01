# Technical Context: Reparations Is A Real Number

## Technology Stack

### Backend
- **Runtime:** Node.js 18+ (CommonJS modules)
- **Framework:** Express.js 4.18.2
- **Language:** JavaScript (ES6+)
- **Process Manager:** Render platform (production), nodemon (development)

### Database
- **Primary Database:** PostgreSQL 15+
- **Client Library:** pg 8.11.3 (node-postgres)
- **Connection Pooling:** Built-in pg.Pool
- **Schema Management:** Manual SQL scripts (database-schemas.js)

### Blockchain
- **Network:** Ethereum (mainnet, testnet, or local Ganache)
- **Smart Contract Language:** Solidity 0.8.19
- **Development Framework:** Truffle 5.11.0
- **Web3 Library:** Web3.js 1.10.0
- **Contract Standards:** OpenZeppelin 4.9.0 (ReentrancyGuard, Ownable, Pausable)
- **Local Blockchain:** Ganache CLI 6.12.2

### Storage & File Processing
- **Cloud Storage:** AWS S3 (SDK v3: @aws-sdk/client-s3 3.470.0)
- **Distributed Storage:** IPFS (ipfs-http-client 60.0.1)
- **File Upload:** Multer 1.4.5-lts.1 (50MB limit)
- **File Type Detection:** file-type 12.4.2 (CommonJS compatible)
- **OCR Primary:** Google Cloud Vision API (@google-cloud/vision 4.0.2)
- **OCR Fallback:** Tesseract.js 5.0.3
- **PDF Parsing:** pdf-parse 1.1.1
- **Image Processing:** Sharp 0.33.1

### Frontend
- **UI Framework:** Vanilla HTML/CSS/JavaScript (no framework)
- **Web3 Integration:** Web3.js 1.10.0
- **Wallet:** MetaMask browser extension required
- **Static Hosting:** GitHub Pages (separate deployment)
- **API Communication:** Native Fetch API

### Development Tools
- **Package Manager:** npm
- **Environment Variables:** dotenv 16.0.0
- **Development Server:** nodemon 3.0.2
- **Linting:** None configured (potential improvement)
- **Testing:** None configured (potential improvement)

## Key Dependencies

### Production Dependencies
```json
{
  "@aws-sdk/client-s3": "^3.470.0",           // S3 file storage
  "@google-cloud/vision": "^4.0.2",           // OCR processing
  "@openzeppelin/contracts": "^4.9.0",        // Smart contract libraries
  "cheerio": "^1.1.2",                        // HTML parsing (scraping)
  "cors": "^2.8.5",                           // Cross-origin requests
  "express": "^4.18.2",                       // Web server
  "express-rate-limit": "^7.1.5",             // API rate limiting
  "file-type": "^12.4.2",                     // File type detection
  "ipfs-http-client": "^60.0.1",              // IPFS integration
  "jsonwebtoken": "^9.0.2",                   // JWT authentication
  "multer": "^1.4.5-lts.1",                   // File uploads
  "pdf-parse": "^1.1.1",                      // PDF text extraction
  "pg": "^8.11.3",                            // PostgreSQL client
  "puppeteer": "^24.31.0",                    // Web scraping
  "sharp": "^0.33.1",                         // Image processing
  "tesseract.js": "^5.0.3",                   // Local OCR
  "web3": "^1.10.0",                          // Ethereum integration
  "winston": "^3.18.3"                        // Logging
}
```

### Development Dependencies
```json
{
  "@truffle/hdwallet-provider": "^2.1.0",     // HD wallet for deployments
  "ganache-cli": "^6.12.2",                   // Local blockchain
  "nodemon": "^3.0.2",                        // Auto-reload server
  "truffle": "^5.11.0"                        // Smart contract framework
}
```

## Environment Configuration

### Required Environment Variables
```bash
# PostgreSQL Database (Option 1: Connection String)
DATABASE_URL=postgresql://user:password@host:port/database

# PostgreSQL Database (Option 2: Individual Variables)
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=reparations
POSTGRES_USER=reparations_user
POSTGRES_PASSWORD=secure_password_here

# Google Cloud Vision API (for OCR)
GOOGLE_VISION_API_KEY=your_api_key_here

# AWS S3 Storage
S3_ENABLED=true
S3_BUCKET=reparations-documents
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key

# IPFS (Optional)
IPFS_ENABLED=false
IPFS_GATEWAY=https://ipfs.io/ipfs/

# Server Configuration
PORT=3000
NODE_ENV=production

# Security (Optional)
JWT_SECRET=your_jwt_secret_here
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

### Configuration Loading
Configuration is centralized in `config.js`:

```javascript
module.exports = {
  env: process.env.NODE_ENV || 'development',
  isDevelopment: process.env.NODE_ENV !== 'production',
  port: parseInt(process.env.PORT || '3000', 10),

  database: {
    host: process.env.DB_HOST || process.env.POSTGRES_HOST || 'localhost',
    database: process.env.DB_NAME || process.env.POSTGRES_DB || 'reparations',
    user: process.env.DB_USER || process.env.POSTGRES_USER || '',
    password: process.env.DB_PASS || process.env.POSTGRES_PASSWORD || ''
  },

  storage: {
    root: process.env.STORAGE_ROOT || './storage',
    s3: {
      enabled: process.env.S3_ENABLED === 'true',
      bucket: process.env.S3_BUCKET || '',
      region: process.env.S3_REGION || 'us-east-1'
    }
  },

  apiKeys: {
    googleVision: process.env.GOOGLE_VISION_API_KEY || ''
  }
};
```

## Database Schema

### Core Tables

**documents** - Master document records
```sql
CREATE TABLE documents (
  document_id VARCHAR(255) PRIMARY KEY,
  owner_name VARCHAR(255) NOT NULL,
  document_type VARCHAR(100),
  file_path VARCHAR(500),
  file_size BIGINT,
  mime_type VARCHAR(100),
  filename VARCHAR(255),
  ipfs_hash VARCHAR(100),
  ocr_text TEXT,
  ocr_confidence NUMERIC(5,2),
  ocr_service VARCHAR(50),
  verification_status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**enslaved_people** - Extracted individual records
```sql
CREATE TABLE enslaved_people (
  person_id SERIAL PRIMARY KEY,
  document_id VARCHAR(255) REFERENCES documents(document_id),
  full_name VARCHAR(255),
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  estimated_birth_year INTEGER,
  estimated_death_year INTEGER,
  gender VARCHAR(20),
  location VARCHAR(255),
  occupation VARCHAR(100),
  relationship VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**families** - Family groupings
```sql
CREATE TABLE families (
  family_id SERIAL PRIMARY KEY,
  family_name VARCHAR(255),
  primary_document_id VARCHAR(255) REFERENCES documents(document_id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**reparations_breakdown** - Economic calculations
```sql
CREATE TABLE reparations_breakdown (
  breakdown_id SERIAL PRIMARY KEY,
  person_id INTEGER REFERENCES enslaved_people(person_id),
  base_wage_theft NUMERIC(15,2),
  inflation_adjustment NUMERIC(15,2),
  compound_interest NUMERIC(15,2),
  pain_suffering_damages NUMERIC(15,2),
  total_reparations NUMERIC(15,2),
  calculation_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**verification_reviews** - Human verification queue
```sql
CREATE TABLE verification_reviews (
  review_id SERIAL PRIMARY KEY,
  document_id VARCHAR(255) REFERENCES documents(document_id),
  reviewer_email VARCHAR(255),
  review_status VARCHAR(50) DEFAULT 'pending',
  review_notes TEXT,
  reviewed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Database Views

**owner_summary** - Aggregated owner data
```sql
CREATE VIEW owner_summary AS
SELECT
  owner_name,
  COUNT(DISTINCT document_id) as document_count,
  COUNT(DISTINCT person_id) as enslaved_count,
  SUM(total_reparations) as total_reparations,
  AVG(ocr_confidence) as avg_ocr_confidence
FROM documents
LEFT JOIN enslaved_people USING (document_id)
LEFT JOIN reparations_breakdown USING (person_id)
GROUP BY owner_name;
```

**verification_queue** - Documents awaiting review
```sql
CREATE VIEW verification_queue AS
SELECT
  d.document_id,
  d.owner_name,
  d.document_type,
  d.ocr_confidence,
  d.created_at,
  COUNT(ep.person_id) as extracted_people_count
FROM documents d
LEFT JOIN enslaved_people ep USING (document_id)
WHERE d.verification_status = 'pending'
GROUP BY d.document_id
ORDER BY d.created_at ASC;
```

**blockchain_queue** - Verified records ready for blockchain
```sql
CREATE VIEW blockchain_queue AS
SELECT
  d.document_id,
  d.owner_name,
  d.ipfs_hash,
  COUNT(DISTINCT ep.person_id) as person_count,
  SUM(rb.total_reparations) as total_amount
FROM documents d
JOIN enslaved_people ep USING (document_id)
JOIN reparations_breakdown rb USING (person_id)
WHERE d.verification_status = 'verified'
  AND d.ipfs_hash IS NOT NULL
GROUP BY d.document_id;
```

## Smart Contract Architecture

### ReparationsEscrow.sol
Main smart contract for payment distribution:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

contract ReparationsEscrow is ReentrancyGuard, Ownable, Pausable {
  struct AncestryRecord {
    string ipfsHash;              // Immutable document proof
    address submitter;            // Who submitted the claim
    address[] descendants;        // Beneficiary addresses
    uint256 totalAmount;          // Total reparations owed
    uint256 depositedAmount;      // Amount currently in escrow
    bool verified;                // Admin verification flag
    uint256 submittedAt;          // Timestamp
  }

  mapping(uint256 => AncestryRecord) public records;
  uint256 public recordCount;

  event RecordSubmitted(uint256 indexed recordId, address indexed submitter, string ipfsHash);
  event RecordVerified(uint256 indexed recordId, address indexed verifier);
  event PaymentDeposited(uint256 indexed recordId, uint256 amount, address indexed depositor);
  event PaymentDistributed(uint256 indexed recordId, uint256 totalAmount, uint256 recipientCount);

  function submitAncestryRecord(string memory ipfsHash) external returns (uint256);
  function addDescendant(uint256 recordId, address descendant) external onlyOwner;
  function verifyRecord(uint256 recordId) external onlyOwner;
  function depositPayment(uint256 recordId) external payable;
  function distributePayment(uint256 recordId) external nonReentrant whenNotPaused;
}
```

### Deployment Networks
Configured in `truffle-config.js`:

```javascript
module.exports = {
  networks: {
    development: {
      host: "127.0.0.1",
      port: 8545,              // Ganache
      network_id: "*"
    },
    goerli: {                  // Ethereum testnet
      provider: () => new HDWalletProvider(
        process.env.MNEMONIC,
        `https://goerli.infura.io/v3/${process.env.INFURA_PROJECT_ID}`
      ),
      network_id: 5,
      gas: 5500000
    }
  },
  compilers: {
    solc: {
      version: "0.8.19"
    }
  }
};
```

## API Endpoints

### Document Management
```
POST /api/upload-document
  - Content-Type: multipart/form-data
  - Fields: document (file), ownerName, documentType, birthYear, deathYear, location
  - Returns: { success, documentId, result }

GET /api/documents/:documentId
  - Returns: { document metadata }

GET /api/documents/:documentId/file
  - Returns: Raw file with correct MIME type

DELETE /api/documents/:documentId
  - Soft delete (marks as deleted, doesn't remove file)
```

### Research & Queries
```
POST /api/llm-query
  - Body: { query: string, sessionId?: string }
  - Pattern-matching NLP for natural language queries
  - Returns: { success, response, evidence }

POST /api/clear-chat
  - Body: { sessionId?: string }
  - Clears conversation history

GET /api/stats
  - Returns: { documentCount, personCount, totalReparations, ... }
```

### Genealogy Integration
```
POST /api/familysearch/search
  - Body: { name, birthYear, location }
  - Queries FamilySearch API
  - Returns: { matches: [...] }

POST /api/familysearch/descendants
  - Body: { personId }
  - Retrieves family tree data
  - Returns: { descendants: [...] }
```

### Individual Metadata
```
POST /api/process-individual-metadata
  - Body: { documentId, fileName, fullName, birthYear, deathYear, ... }
  - Links individuals to documents
  - Returns: { success, individualId }
```

## Deployment Architecture

### Production Environment: Render.com

**Backend Service:**
- Platform: Render Web Service (free tier)
- URL: https://reparations-platform.onrender.com
- Auto-deploy: From main branch on GitHub
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check: `GET /health`

**Database:**
- Platform: Render PostgreSQL (free tier)
- Connection: `DATABASE_URL` environment variable
- Backups: Automatic daily backups
- SSL: Required (sslmode=require)

**Storage:**
- Platform: AWS S3
- Bucket: reparations-them
- Region: us-east-1
- Access: IAM credentials via environment variables

**Frontend:**
- Platform: GitHub Pages (separate repository)
- URL: https://yourusername.github.io/reparations-frontend
- Deployment: Automatic on push to main
- API Base URL: Points to Render backend

### Development Environment

**Local Setup:**
```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with local PostgreSQL credentials

# Initialize database
npm run init-db

# Start development server
npm run dev  # Uses nodemon for auto-reload
```

**Local Blockchain:**
```bash
# Terminal 1: Start Ganache
ganache-cli

# Terminal 2: Deploy contracts
cd contracts
truffle compile
truffle migrate --network development
```

## File Structure

```
reparations-is-a-real-number/
├── contracts/
│   ├── contracts/
│   │   ├── ReparationsEscrow.sol
│   │   └── ReparationsLedger.sol
│   ├── migrations/
│   │   └── 2_deploy_contracts.js
│   └── truffle-config.js
│
├── frontend/
│   └── public/
│       ├── index.html
│       ├── app.js
│       └── styles.css
│
├── memory-bank/                    # NEW: AI context persistence
│   ├── projectbrief.md             # Source of truth
│   ├── productContext.md           # User perspective
│   ├── systemPatterns.md           # Architecture patterns
│   ├── techContext.md              # This file
│   ├── activeContext.md            # Current work
│   └── progress.md                 # Development tracker
│
├── storage/                        # Local file storage (gitignored)
│   └── owners/
│       └── {ownerName}/
│           └── {docType}/
│               └── {timestamp}.{ext}
│
├── uploads/                        # Temporary Multer uploads (gitignored)
│
├── config.js                       # Central configuration
├── database.js                     # PostgreSQL client
├── database-schemas.js             # Schema definitions
├── enhanced-document-processor.js  # Main processing pipeline
├── storage-adapter.js              # Storage abstraction
├── reparations-calculator.js       # Economic calculations
├── familysearch-integration.js     # FamilySearch API client
├── debt-tracker.js                 # Inheritance chain tracking
├── init-database.js                # Database initialization script
├── server.js                       # Express server
├── package.json                    # Dependencies
├── .env                            # Environment variables (gitignored)
├── .gitignore
└── README.md
```

## Performance Considerations

### Database Optimization
- **Indexes:** Created on owner_name, full_name, verification_status
- **Connection Pooling:** Max 20 connections, 30s idle timeout
- **Views:** Pre-computed aggregations (owner_summary, verification_queue)
- **Pagination:** API endpoints should implement LIMIT/OFFSET for large result sets (TODO)

### File Upload Optimization
- **Streaming:** Large files streamed to S3, not loaded into memory
- **File Type Detection:** Reads entire file (trade-off for security)
- **OCR Processing:** Async processing with job queue (TODO)
- **IPFS Hashing:** Can be slow for large files (consider async worker)

### Frontend Optimization
- **Lazy Loading:** OCR text loaded on-demand
- **Caching:** Browser caching for static assets
- **Compression:** Enable gzip compression on Express (TODO)
- **CDN:** Consider CloudFront for S3 assets (TODO)

## Monitoring & Logging

### Current Logging
```javascript
// Winston logger configured in server.js
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
    new winston.transports.DailyRotateFile({
      filename: 'logs/application-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d'
    })
  ]
});
```

### Health Check Endpoint
```javascript
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});
```

### Future Monitoring (TODO)
- **APM:** Application Performance Monitoring (New Relic, DataDog)
- **Error Tracking:** Sentry or Rollbar integration
- **Metrics:** Prometheus + Grafana for system metrics
- **Alerting:** PagerDuty for critical failures

---

*This document provides the technical foundation for the Reparations Platform.*
