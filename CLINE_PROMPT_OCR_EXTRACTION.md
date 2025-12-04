# Cline Prompt: Implement OCR Extraction for Contribution Pipeline

## Context

The Reparations project has a conversational contribution pipeline where users describe historical documents (slave schedules, census records, etc.) and the system extracts data. The conversation flow is complete and working:

1. ✅ User submits URL → system analyzes page
2. ✅ User describes document → system parses columns/structure
3. ✅ User confirms structure → system shows extraction options
4. ✅ User chooses extraction method (auto_ocr, guided_entry, etc.)
5. ❌ **ACTUAL OCR EXTRACTION NOT IMPLEMENTED** ← This is what needs to be built

## Current State

### Working Files
- `src/services/contribution/ContributionSession.js` - Manages conversation flow, creates extraction job records
- `src/services/contribution/OwnerPromotion.js` - Promotes confirmed owners to individuals table
- `src/api/routes/contribute.js` - API endpoints for contribution flow
- `contribute-v2.html` - Chat-based frontend UI

### Database Tables (on Render PostgreSQL)
- `contribution_sessions` - Conversation state
- `extraction_jobs` - Extraction job tracking (status, method, parsed_rows, etc.)
- `extraction_corrections` - Human corrections to OCR output

### What Happens Now
When user selects `auto_ocr`, `ContributionSession.startExtraction()` (line 1468) creates an extraction job record but does NOT actually run OCR. The session just sits at `extraction_in_progress` stage forever.

## Your Task

Implement the actual OCR extraction that:
1. Downloads the PDF from `session.sourceMetadata.contentUrl`
2. Runs OCR on the PDF (Google Cloud Vision is already configured in the project)
3. Parses the OCR text using the column structure from `session.contentStructure.columns`
4. Saves parsed rows to `extraction_jobs.parsed_rows`
5. Updates extraction status (pending → processing → completed/failed)
6. Returns results to the frontend for human review

## Technical Requirements

### 1. OCR Service Already Exists
Check `src/services/document/OCRProcessor.js` - there's already Google Cloud Vision integration:
```javascript
// The project already has:
const vision = require('@google-cloud/vision');
// API key in env: GOOGLE_VISION_API_KEY
```

### 2. PDF Handling
The project uses:
- `pdf-parse` for text extraction
- `sharp` for image processing
- PDFs from Maryland State Archives are scanned images, so you need Vision API, not pdf-parse

### 3. Column Structure Available
After user describes the document, `session.contentStructure.columns` contains:
```javascript
[
  { position: 1, headerExact: "DATE.", dataType: "date" },
  { position: 2, headerExact: "NAME OF OWNER.", dataType: "owner_name" },
  { position: 3, headerExact: "NAME OF SLAVE.", dataType: "enslaved_name" },
  // ... etc
]
```

### 4. Expected Output Format
`extraction_jobs.parsed_rows` should be a JSONB array:
```javascript
[
  {
    rowIndex: 0,
    columns: {
      "DATE.": "May 15 1864",
      "NAME OF OWNER.": "John Smith",
      "NAME OF SLAVE.": "Mary",
      "SEX.": "F",
      "AGE.": "25"
      // ... all columns
    },
    confidence: 0.87,  // Average confidence for this row
    rawText: "May 15 1864  John Smith  Mary  F  25..."  // Original OCR line
  },
  // ... more rows
]
```

## Implementation Plan

### Step 1: Create ExtractionWorker Service
Create `src/services/contribution/ExtractionWorker.js`:
```javascript
class ExtractionWorker {
  constructor(database) {
    this.db = database;
  }

  async processExtraction(extractionId) {
    // 1. Get extraction job details
    // 2. Get session for column structure
    // 3. Download PDF
    // 4. Run OCR (Google Cloud Vision)
    // 5. Parse OCR text into rows based on column structure
    // 6. Save parsed_rows to extraction_jobs
    // 7. Update status to 'completed' or 'needs_review'
  }

  async downloadPdf(url) { ... }
  async runOCR(pdfBuffer) { ... }
  async parseOCRtoRows(ocrText, columns) { ... }
}
```

### Step 2: Trigger Extraction After Job Creation
In `ContributionSession.startExtraction()`, after creating the job, trigger the worker:
```javascript
// After INSERT INTO extraction_jobs...
// Don't await - let it run async
this.extractionWorker.processExtraction(extractionId).catch(err => {
  console.error('Extraction failed:', err);
  // Update job status to 'failed'
});
```

### Step 3: Add Status Polling Endpoint
The endpoint already exists at `GET /api/contribute/:sessionId/extraction/:extractionId/status`
Just make sure it returns current status and any parsed rows.

### Step 4: Frontend Updates (contribute-v2.html)
Add polling to check extraction status and display results when ready:
```javascript
async function pollExtractionStatus(sessionId, extractionId) {
  const response = await fetch(`${API_BASE}/api/contribute/${sessionId}/extraction/${extractionId}/status`);
  const data = await response.json();

  if (data.extraction.status === 'completed') {
    displayParsedRows(data.extraction.parsedRows);
  } else if (data.extraction.status === 'failed') {
    showError(data.extraction.error);
  } else {
    // Still processing, poll again in 2 seconds
    setTimeout(() => pollExtractionStatus(sessionId, extractionId), 2000);
  }
}
```

## Test Data

Use this Maryland State Archives URL for testing:
```
https://msa.maryland.gov/megafile/msa/stagsere/se1/se5/001000/001036/html/0096.html
```

The PDF link on that page goes to a slave compensation record with columns:
- DATE
- NAME OF OWNER
- NAME OF SLAVE
- SEX
- AGE
- PHYSICAL CONDITION
- TERM OF SERVITUDE
- Military columns (sub-columns for Day/Month/Year)
- REGIMENT
- Compensation Received
- NAMES BY WHOM FORMER OWNERSHIP PROVEN

## Environment Variables Already Set
```
GOOGLE_VISION_API_KEY=<already configured>
DATABASE_URL=<Render PostgreSQL>
```

## Testing Checklist

1. [ ] Run end-to-end test: `node test-contribution-pipeline-e2e.js`
2. [ ] Manually test full flow via contribute-v2.html
3. [ ] Verify extraction_jobs table gets populated with parsed_rows
4. [ ] Verify OCR text is reasonable for Maryland document
5. [ ] Test error handling (invalid URL, OCR failure, etc.)

## Files to Create/Modify

### Create:
- `src/services/contribution/ExtractionWorker.js` - Main OCR worker

### Modify:
- `src/services/contribution/ContributionSession.js` - Trigger worker after job creation
- `src/api/routes/contribute.js` - May need to enhance status endpoint
- `contribute-v2.html` - Add status polling and results display
- `src/server.js` - Initialize ExtractionWorker with database

## Important Notes

1. **Google Cloud Vision** is already set up in the project - check `src/services/document/OCRProcessor.js` for reference

2. **Don't block the API** - OCR should run async. Return immediately from startExtraction and let frontend poll for status.

3. **Handle multi-page PDFs** - The Maryland documents often span multiple pages

4. **Confidence scores** - Google Vision returns confidence. Use it to flag low-confidence extractions for human review.

5. **Table detection** - Vision API has TABLE detection. Use it if available, otherwise fall back to line-by-line parsing.

## Success Criteria

1. User can go through full contribution flow and see extracted data
2. Extracted data appears in `extraction_jobs.parsed_rows`
3. Frontend displays extracted rows for human review
4. Human can correct mistakes (saves to `extraction_corrections` table)
5. Corrected data can be promoted to `individuals` table via OwnerPromotion

---

## Quick Start Commands

```bash
# Navigate to project
cd "/Users/danyelabrown/Desktop/danyelajunebrown GITHUB/Reparations-is-a-real-number-main"

# Run existing tests to ensure nothing breaks
node test-contribution-pipeline-e2e.js

# Start local server for testing
npm start

# Test the frontend
open contribute-v2.html
```

Good luck! The conversational pipeline is solid - just need the OCR extraction to actually run.
