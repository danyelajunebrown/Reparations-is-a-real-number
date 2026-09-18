# System Patterns: Reparations Is A Real Number

> **Reconciled 2026-07-31.** Design-rationale sections below (file-type detection, storage, OCR, security, performance, error handling) remain accurate. The blockchain, single-pool, and descendant-persistence sections have been corrected/removed to match current reality (see `activeContext.md`, `standard-canonical-person-and-document-gate.md`).

## Architectural Patterns

### Layered Architecture
The system follows a traditional layered architecture with clear separation of concerns:

```
┌─────────────────────────────────────────┐
│  Presentation Layer (Frontend)          │
│  - React + Vite (terminal aesthetic)     │
│  - Verified-data-only rendering          │
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
│  - Storage adapter (Local/S3)            │
│  - Database client (PostgreSQL)          │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│  Infrastructure Layer                    │
│  - PostgreSQL database (Neon)            │
│  - AWS S3 storage                        │
└─────────────────────────────────────────┘
```

### Pipeline Pattern (Document Processing)
Documents flow through a series of processing stages:

```
Upload → Type Detection → Storage → OCR → Extraction → Database → Verification
```

Each stage is independent and can be retried separately if it fails.

**Implementation:** `src/services/document/EnhancedDocumentProcessor.js`

**Key Features:**
- **Idempotent:** Can be run multiple times without side effects
- **Fail-Safe:** Each stage validates input before processing
- **Traceable:** Each stage logs progress and errors
- **Resumable:** Can restart from any stage using document ID

### Contribution Pipeline Pattern (December 2025)
Crowdsourced document contribution with multi-step workflow:

```
URL Analysis → Description → Column Inference → Confirmation → Extraction → Persistence
```

**Implementation:** `src/services/contribution/`
- `ContributionSession.js` - State machine for workflow stages
- `ExtractionWorker.js` - OCR with debug logging and database persistence
- `NarrativeExtractor.js` - Entity extraction from prose text

**Key Features:**
- **Stateful Sessions:** Each contribution tracked with session_id
- **Flexible Extraction:** Works with tables (column parsing) and prose (entity extraction)
- **Identity Persistence:** extracted people flow through `PersonService.findOrCreateLead`
  (writes a discrete lead), then a gated `PersonService.promoteToCanonical`. Per RULE 0.6 a lead
  is promoted to `canonical_persons` ONLY when it is deduped (Biscoe), serves an S3 document image,
  AND is RAG-embedded. Raw `persistToUnconfirmedPersons()` is legacy — the review queue no longer
  auto-promotes.
- **Debug Logging:** Full diagnostic trail stored in `extraction_jobs.debug_log`

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
- Easy to add new storage providers (Azure Blob, etc.)

**Implementation:** `src/services/document/S3StorageAdapter.js`

### Repository Pattern (Database Access) — TWO drivers, not one
Database access is centralized in `src/database/connection.js`, but there is **no single pool**.
Two Postgres drivers are installed and both are in active use, and they behave differently. Any
code that touches the DB must know which one it is holding:

```javascript
// src/database/connection.js exposes BOTH:

// 1) @neondatabase/serverless (HTTP) — serverless/edge-friendly.
//    TRAP: rowCount ALWAYS returns 0 for UPDATE / DELETE. You cannot tell
//    whether a write matched any rows from rowCount. You MUST use RETURNING
//    and count result.rows.length instead.
const { rows } = await sql`UPDATE canonical_persons SET ... WHERE id = ${id} RETURNING id`;
const affected = rows.length; // NOT rowCount

// 2) pg.Pool (TCP) — classic connection pool. rowCount works correctly here.
//    This is the PRODUCTION RUNTIME driver (see server startup).
const res = await pool.query('UPDATE canonical_persons SET ... WHERE id = $1', [id]);
const affected = res.rowCount; // correct with pg.Pool
```

**Rules of thumb:**
- Production API runtime uses `pg.Pool` (TCP). Scripts vary — check before assuming.
- With the Neon HTTP driver, treat `rowCount` as meaningless for writes; always `RETURNING id`
  and count `rows.length`.
- Consistent error handling and connection pooling are still centralized in `connection.js`;
  the "single source of truth" is the module, **not** a single pool object.

**Schema Definition:** table/view/index definitions live in the `migrations/` directory (numbered
SQL migrations), not in a single schema file.

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

**Implementation:** `src/services/document/EnhancedDocumentProcessor.js`

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

## Extraction & Data Quality Patterns ⭐ NEW (Dec 2025)

### Two-Tier Extraction Pattern
FamilySearch data uses a tiered extraction approach:

```
┌─────────────────────────────────────────┐
│  Pre-Indexed Check                       │
│  (Volunteer transcriptions, 95% conf)    │
└─────────────────────────────────────────┘
         ↓ Available?
    ┌────┴────┐
    ↓ Yes     ↓ No
┌───────┐  ┌──────────────────────────────┐
│ Use   │  │ OCR Fallback                 │
│ Pre-  │  │ (Google Vision, 60-80% conf) │
│ Index │  │ + Garbage Filtering          │
└───────┘  └──────────────────────────────┘
```

**Implementation:**
```javascript
// extract-preindexed-data.js
const preIndexedPanel = await page.$('.image-index-panel');
if (preIndexedPanel) {
  // Use high-quality volunteer data
  return await extractPreIndexed(page);
} else {
  // Fall back to OCR with garbage filtering
  return await extractWithOCR(page, ocrGarbage, garbagePhrases);
}
```

### Family Relationship Pattern Detection
Extracts genealogical links from narrative text:

```javascript
// reextract-civilwardc-families.js
const familyPatterns = [
  // "X, Y, Z are the children of Parent"
  /(?:said )?(\w+(?:,\s*\w+)*) are the children of (?:said )?(\w+[\w\s]*)/gi,

  // "FirstName daughter/son of Parent"
  /(\w+) (?:is )?(?:the )?(?:daughter|son) of (?:said )?(\w+[\w\s]*)/gi,

  // "FirstName wife/husband of Spouse"
  /(\w+) (?:is )?(?:the )?(?:wife|husband) of (?:said )?(\w+[\w\s]*)/gi
];

// Result: 467 relationships from 1,051 petitions
```

### Background Queue Processing Pattern
For long-running, resumable tasks:

```javascript
// wikitree-batch-search.js
class BackgroundQueueProcessor {
  constructor(options = {}) {
    this.rateLimit = options.rateLimit || 3000; // ms between requests
    this.maxRetries = options.maxRetries || 3;
  }

  async processQueue() {
    while (true) {
      const item = await this.getNextPendingItem();
      if (!item) break;

      try {
        await this.markAsProcessing(item.id);
        const result = await this.process(item);
        await this.saveResult(item.id, result);
      } catch (error) {
        await this.handleError(item.id, error);
      }

      await this.delay(this.rateLimit);
    }
  }
}
```

**Benefits:**
- Resumable after crashes
- Rate-limited to respect external APIs
- Database-backed state for recovery
- Graceful shutdown support

### Private-to-Public Pipeline Pattern (current)
Identity no longer flows through the old `enslaved_descendants_suspected` /
`enslaved_descendants_confirmed` / `enslaved_credit_calculations` tables. It flows through the
`PersonService` lead → gated canonical model, and the credit/ledger work is done by the DAA layer:

```
┌─────────────────────────────────────────┐
│  1. Lead (private research)              │
│  PersonService.findOrCreateLead          │
│  - Discrete, deduped lead (Biscoe rule)  │
│  - NOT public, confidence scored         │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│  2. Gated promotion to canonical         │
│  PersonService.promoteToCanonical        │
│  - RULE 0.6: deduped + serves an S3      │
│    document image + RAG-embedded         │
│  - "Every canonical serves an image and  │
│    is in RAG."                           │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│  3. DAA ledger (credit / disgorgement)   │
│  DAAOrchestrator + DisgorgementCalculator│
│  - Per-person line items, dual ledger    │
│  - Compensation TO enslavers = evidence  │
│    of debt, not credit against it        │
│  - Every number traces to row + citation │
└─────────────────────────────────────────┘
```

### Semantic HTML Parsing Pattern
For sources with structured markup (Civil War DC):

```javascript
// extract-civilwardc-genealogy.js
const extractFromSemanticHTML = async (html) => {
  const $ = cheerio.load(html);

  // Extract names from semantic spans
  const names = $('.persName').map((i, el) => ({
    name: $(el).text().trim(),
    role: $(el).attr('role') || 'unknown',
    ref: $(el).attr('ref')
  })).get();

  // Extract places from placeName spans
  const places = $('.placeName').map((i, el) => $(el).text().trim()).get();

  return { names, places };
};
```

---

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
