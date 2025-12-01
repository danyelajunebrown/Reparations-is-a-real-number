# System Patterns: Reparations Is A Real Number

## Architectural Patterns

### Layered Architecture
The system follows a traditional layered architecture with clear separation of concerns:

```
┌─────────────────────────────────────────┐
│  Presentation Layer (Frontend)          │
│  - HTML/CSS/JavaScript                   │
│  - Web3.js integration                   │
│  - MetaMask wallet connection            │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│  API Layer (Express Server)              │
│  - RESTful endpoints                     │
│  - Request validation                    │
│  - Error handling middleware             │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│  Business Logic Layer                    │
│  - Document processor                    │
│  - Reparations calculator                │
│  - Genealogy integration                 │
│  - Debt tracker                          │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│  Data Access Layer                       │
│  - Storage adapter (Local/S3/IPFS)       │
│  - Database client (PostgreSQL)          │
│  - Smart contract interface (Web3)       │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│  Infrastructure Layer                    │
│  - PostgreSQL database                   │
│  - AWS S3 storage                        │
│  - Ethereum blockchain                   │
│  - IPFS network                          │
└─────────────────────────────────────────┘
```

### Pipeline Pattern (Document Processing)
Documents flow through a series of processing stages:

```
Upload → Type Detection → Storage → IPFS Hashing → OCR → Extraction → Database → Verification
```

Each stage is independent and can be retried separately if it fails.

**Implementation:** `enhanced-document-processor.js`

**Key Features:**
- **Idempotent:** Can be run multiple times without side effects
- **Fail-Safe:** Each stage validates input before processing
- **Traceable:** Each stage logs progress and errors
- **Resumable:** Can restart from any stage using document ID

### Adapter Pattern (Storage Abstraction)
Storage implementation is abstracted behind a common interface:

```javascript
class StorageAdapter {
  async uploadFile(uploadedFile, metadata)
  async detectFileType(filePath)
  async uploadFileToLocal(uploadedFile, metadata)
  async uploadFileToS3(uploadedFile, metadata)
}
```

**Benefits:**
- Swap storage backends without changing upstream code
- Fallback from S3 to local storage on failure
- Consistent interface for all storage operations
- Easy to add new storage providers (IPFS, Azure Blob, etc.)

**Implementation:** `storage-adapter.js`

### Repository Pattern (Database Access)
Database queries are encapsulated in a centralized module:

```javascript
// database.js
const pool = new Pool({
  host: config.database.host,
  database: config.database.database,
  user: config.database.user,
  password: config.database.password
});

module.exports = { query: (text, params) => pool.query(text, params) };
```

**Benefits:**
- Single source of truth for database connection
- Consistent error handling
- Connection pooling managed centrally
- Easy to add query logging, metrics, etc.

**Schema Definition:** `database-schemas.js` defines all tables, views, and indexes

### Strategy Pattern (OCR Processing)
Multiple OCR providers with automatic fallback:

```
Google Vision API (preferred) → Tesseract.js (fallback) → Manual Entry
```

**Decision Logic:**
1. Check if `GOOGLE_VISION_API_KEY` is configured
2. If yes: Use Google Vision API (faster, more accurate)
3. If Google fails or unavailable: Use Tesseract.js (slower, lower accuracy)
4. If both fail: Flag document for manual OCR entry

**Implementation:** `enhanced-document-processor.js` line 89-150

## Design Decisions

### File Type Detection: Content-Based vs Extension-Based
**Decision:** Use magic number (file signature) detection instead of trusting file extensions

**Rationale:**
- **Security:** Prevents malicious files disguised with wrong extensions
- **Accuracy:** Uploaded .pdf files were actually plain text
- **Corruption Prevention:** Ensures MIME types match actual content
- **Data Integrity:** Database stores correct mime_type for retrieval

**Implementation:**
```javascript
// storage-adapter.js
async detectFileType(filePath) {
  const buffer = await fs.readFile(filePath);
  const detected = await fileType(buffer); // Magic number detection

  // Warn if mismatch
  if (uploadedExt && uploadedExt !== actualExt) {
    console.warn(`⚠ File type mismatch: uploaded as ${uploadedExt} but actual type is ${actualExt}`);
  }

  return detected;
}
```

**Trade-offs:**
- ✅ Prevents corruption
- ✅ Improves security
- ❌ Adds processing overhead (read entire file)
- ❌ Requires file-type package dependency

### Storage: Ephemeral vs Persistent
**Decision:** Migrate from Render's ephemeral filesystem to AWS S3

**Rationale:**
- **Problem:** Render's free tier deletes files on restart/redeploy
- **Impact:** 4.8MB PDFs uploaded Nov 19 were wiped, replaced with test files Nov 24
- **Solution:** S3 provides permanent storage with 99.999999999% durability
- **Cost:** Acceptable for document preservation use case

**Implementation:**
```javascript
// storage-adapter.js
async uploadFile(uploadedFile, metadata) {
  if (this.s3Enabled) {
    try {
      return await this.uploadFileToS3(uploadedFile, metadata);
    } catch (err) {
      console.error('S3 upload failed, falling back to local:', err);
      return await this.uploadFileToLocal(uploadedFile, metadata);
    }
  } else {
    return await this.uploadFileToLocal(uploadedFile, metadata);
  }
}
```

**Trade-offs:**
- ✅ Files persist across deployments
- ✅ Scalable to millions of documents
- ✅ Built-in versioning and backup
- ❌ Monthly S3 storage costs
- ❌ Network latency for uploads/downloads
- ❌ Requires AWS credentials management

### Database: SQL vs NoSQL
**Decision:** PostgreSQL (relational) over MongoDB/DynamoDB (document)

**Rationale:**
- **Complex Relationships:** Multi-table joins required (documents ↔ enslaved_people ↔ families ↔ reparations_breakdown)
- **Genealogical Queries:** Recursive queries for family trees
- **Aggregations:** Statistical calculations (SUM, AVG, GROUP BY)
- **ACID Guarantees:** Financial calculations require transactional consistency
- **Views:** Pre-computed views for performance (owner_summary, verification_queue)

**Schema Example:**
```sql
-- documents table
CREATE TABLE documents (
  document_id VARCHAR(255) PRIMARY KEY,
  owner_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500),
  ipfs_hash VARCHAR(100),
  ocr_text TEXT,
  ocr_confidence NUMERIC(5,2),
  ocr_service VARCHAR(50),
  verification_status VARCHAR(50) DEFAULT 'pending'
);

-- enslaved_people table (foreign key relationship)
CREATE TABLE enslaved_people (
  person_id SERIAL PRIMARY KEY,
  document_id VARCHAR(255) REFERENCES documents(document_id),
  full_name VARCHAR(255),
  estimated_birth_year INTEGER,
  location VARCHAR(255)
);

-- View for aggregated owner data
CREATE VIEW owner_summary AS
SELECT
  owner_name,
  COUNT(DISTINCT document_id) as document_count,
  COUNT(DISTINCT person_id) as enslaved_count,
  SUM(reparations_total) as total_reparations
FROM documents
LEFT JOIN enslaved_people USING (document_id)
LEFT JOIN reparations_breakdown USING (person_id)
GROUP BY owner_name;
```

**Trade-offs:**
- ✅ ACID transactions for financial integrity
- ✅ Powerful query capabilities
- ✅ Mature tooling and ecosystem
- ❌ Schema changes require migrations
- ❌ Vertical scaling limits
- ❌ More complex setup than NoSQL

### Blockchain: Ethereum vs Alternatives
**Decision:** Ethereum mainnet with Solidity smart contracts

**Rationale:**
- **Maturity:** Most established smart contract platform
- **Immutability:** Transaction history cannot be altered
- **Transparency:** All payments publicly auditable
- **Developer Tools:** Truffle, Ganache, Web3.js ecosystem
- **Security:** OpenZeppelin battle-tested contract libraries

**Smart Contract Pattern:**
```solidity
// ReparationsEscrow.sol
contract ReparationsEscrow is ReentrancyGuard, Ownable, Pausable {
  struct AncestryRecord {
    string ipfsHash;
    address[] descendants;
    uint256 totalAmount;
    bool verified;
  }

  function submitAncestryRecord(string memory ipfsHash) external
  function addDescendant(uint256 recordId, address descendant) external onlyOwner
  function depositPayment(uint256 recordId) external payable
  function distributePayment(uint256 recordId) external nonReentrant whenNotPaused
}
```

**Trade-offs:**
- ✅ Immutable audit trail
- ✅ Decentralized (no single point of failure)
- ✅ Trustless execution (code is law)
- ❌ High gas fees (can be $50-$200 per transaction)
- ❌ Slow transaction finality (15 seconds to 5 minutes)
- ❌ Requires users to manage private keys

### OCR: Cloud API vs Local Processing
**Decision:** Google Vision API (preferred) with Tesseract.js fallback

**Rationale:**
- **Accuracy:** Google Vision 90-95% vs Tesseract 60-80% on handwritten documents
- **Speed:** Google Vision 2-5 seconds vs Tesseract 30-60 seconds per page
- **Handwriting:** Google Vision significantly better on 1700s-1800s cursive
- **Cost:** Google Vision $1.50 per 1000 images (acceptable for use case)
- **Offline Capability:** Tesseract provides fallback if API unavailable

**Implementation:**
```javascript
// enhanced-document-processor.js
async function performOCR(filePath) {
  const apiKey = config.apiKeys.googleVision;

  if (apiKey) {
    try {
      // Attempt Google Vision API
      const [result] = await client.textDetection(filePath);
      return {
        text: result.fullTextAnnotation.text,
        confidence: 0.95,
        service: 'google-vision'
      };
    } catch (error) {
      console.warn('Google Vision failed, falling back to Tesseract');
    }
  }

  // Fallback to Tesseract.js
  const { data } = await Tesseract.recognize(filePath, 'eng');
  return {
    text: data.text,
    confidence: data.confidence / 100,
    service: 'tesseract'
  };
}
```

**Trade-offs:**
- ✅ Best accuracy for critical data
- ✅ Fast processing for user experience
- ✅ Fallback ensures resilience
- ❌ API costs scale with document volume
- ❌ Requires internet connection for primary path
- ❌ Vendor lock-in to Google Cloud

## Error Handling Patterns

### Global Error Middleware
All unhandled errors caught at application level:

```javascript
// server.js
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);

  // Don't expose internal errors to client
  const statusCode = err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : err.message;

  res.status(statusCode).json({
    success: false,
    error: message
  });
});
```

### Database Transaction Pattern
Critical operations wrapped in transactions:

```javascript
const client = await pool.connect();
try {
  await client.query('BEGIN');

  // Insert document
  await client.query('INSERT INTO documents ...', [...]);

  // Insert enslaved people
  for (const person of extractedPeople) {
    await client.query('INSERT INTO enslaved_people ...', [...]);
  }

  // Calculate reparations
  await client.query('INSERT INTO reparations_breakdown ...', [...]);

  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error; // Re-throw for global handler
} finally {
  client.release();
}
```

### Retry Pattern (with Exponential Backoff)
External API calls automatically retried:

```javascript
async function retryWithBackoff(fn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) throw error;

      const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
      console.log(`Retry ${attempt}/${maxRetries} after ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Usage
const result = await retryWithBackoff(() =>
  googleVisionClient.textDetection(filePath)
);
```

## Security Patterns

### Input Validation
All user inputs sanitized before processing:

```javascript
// storage-adapter.js
sanitizeFilename(name = '') {
  return String(name)
    .replace(/[^a-z0-9_\-\.]/gi, '-')  // Allow only safe chars
    .replace(/-+/g, '-');                // Collapse multiple dashes
}

// Example: "Robert E. Lee" → "Robert-E-Lee"
```

### SQL Injection Prevention
Parameterized queries used throughout:

```javascript
// GOOD: Parameterized query
await database.query(
  'SELECT * FROM documents WHERE owner_name = $1',
  [ownerName]
);

// BAD: String concatenation (vulnerable)
await database.query(
  `SELECT * FROM documents WHERE owner_name = '${ownerName}'`
);
```

### File Upload Security
File size limits and type validation:

```javascript
// server.js
const upload = multer({
  dest: './uploads/',
  limits: {
    fileSize: 50 * 1024 * 1024  // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept any file, but validate with magic numbers later
    cb(null, true);
  }
});
```

### Environment Variable Protection
Secrets never committed to git:

```javascript
// .gitignore
.env
.env.local
.env.production

// config.js
module.exports = {
  database: {
    password: process.env.POSTGRES_PASSWORD || ''  // Never hardcode
  },
  apiKeys: {
    googleVision: process.env.GOOGLE_VISION_API_KEY || ''
  }
};
```

## Performance Patterns

### Database Indexing
Indexes on frequently queried columns:

```sql
CREATE INDEX idx_documents_owner_name ON documents(owner_name);
CREATE INDEX idx_enslaved_people_full_name ON enslaved_people(full_name);
CREATE INDEX idx_documents_verification_status ON documents(verification_status);
```

### Connection Pooling
Reuse database connections:

```javascript
// database.js
const pool = new Pool({
  max: 20,                    // Max connections
  idleTimeoutMillis: 30000,   // Close idle connections after 30s
  connectionTimeoutMillis: 2000  // Fail fast if no connection available
});
```

### Streaming for Large Files
Avoid loading entire files into memory:

```javascript
// storage-adapter.js (S3 upload)
const fileStream = fsSync.createReadStream(uploadedFile.path);

const putParams = {
  Bucket: this.s3Bucket,
  Key: key,
  Body: fileStream,  // Stream instead of buffer
  ContentLength: fileStats.size
};

await this.s3.send(new PutObjectCommand(putParams));
```

### Lazy Loading
OCR text only loaded when needed:

```javascript
// Frontend
async function loadDocumentDetails(documentId) {
  // Initial load: metadata only
  const doc = await fetch(`/api/documents/${documentId}`).then(r => r.json());

  // OCR text loaded on user request
  if (userClicksViewOCR) {
    const ocrText = await fetch(`/api/documents/${documentId}/ocr`).then(r => r.text());
  }
}
```

---

*This document describes the architectural patterns and design decisions for the Reparations Platform.*
