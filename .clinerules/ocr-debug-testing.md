# Cline Prompt: OCR Extraction Pipeline Debug & Resolution

## Context

The contribution pipeline's OCR extraction feature has been failing silently. Users click "start auto-ocr" and see "Starting extraction..." but nothing happens - no progress, no errors, no results even after 10+ minutes. A comprehensive debugging system has been implemented and needs rigorous testing to identify and resolve the root cause.

## Problem Statement

When a user submits a URL (specifically tested with Maryland State Archives documents), the OCR extraction process:
1. Creates an extraction job in the database
2. Shows "Starting auto_ocr extraction" message
3. Then... nothing. No progress updates, no errors, no completion.

The user's test case:
- URL: Maryland State Archives document (PDF embedded in iframe)
- Document: Slave schedule with columns for DATE, NAME OF OWNER, NAME OF SLAVE, SEX, AGE, etc.
- Expected: OCR extracts text, parses into rows, shows results
- Actual: Silent failure with no feedback

## Debugging Infrastructure Now Available

### 1. Database Debug Columns (extraction_jobs table)
```sql
status_message  TEXT    -- Human-readable status ("Downloading content...", "Running OCR...")
debug_log       JSONB   -- Full debug log array with timestamps and stages
updated_at      TIMESTAMP -- Last update time
started_at      TIMESTAMP -- When extraction began
```

### 2. Debug Log Stages (in order)
```
INIT → STATUS → DB_QUERY → JOB_INFO → URL_RESOLVE →
DOWNLOAD_METHOD → DOWNLOAD_FAIL → DOWNLOAD →
OCR_START → OCR_PROCESS → OCR_RESULT → OCR_COMPLETE →
PARSE_START → PARSE_COMPLETE → SAVE → COMPLETE
```

Each log entry contains:
```json
{
  "timestamp": "ISO datetime",
  "stage": "STAGE_NAME",
  "message": "Human readable message",
  "data": { /* context-specific data */ },
  "elapsed": 1234  // ms since start
}
```

### 3. API Endpoints for Debugging

**Status with Debug Log:**
```
GET /api/contribute/:sessionId/extraction/:extractionId/status?debug=true

Response:
{
  "success": true,
  "extraction": {
    "id": "uuid",
    "status": "pending|processing|completed|failed",
    "progress": 0-100,
    "statusMessage": "Current operation",
    "error": "Error message if failed",
    "elapsedMs": 12345,
    "debugLog": [ /* array of log entries */ ]
  }
}
```

**System Capabilities:**
```
GET /api/contribute/capabilities

Response:
{
  "success": true,
  "capabilities": {
    "ocrProcessor": true/false,
    "googleVision": true/false,
    "tesseract": true/false,
    "puppeteer": true/false,
    "playwright": true/false,
    "browserAutomation": true/false
  },
  "message": "Full extraction capabilities available" or warning
}
```

### 4. Frontend Debug Panel (contribute-v2.html)
- Auto-opens when extraction starts
- Shows: Status, Progress %, Message, Elapsed Time
- Color-coded debug log entries:
  - Red: ERROR, FAIL stages
  - Green: COMPLETE, SUCCESS stages
  - Blue: INIT, START stages
  - Purple: DOWNLOAD stages
  - Orange: OCR stages
- "Refresh Debug Log" button for manual refresh
- "Check Capabilities" button to verify system setup

### 5. Server-Side Logging
All debug entries are also logged to server console via Winston logger:
```
[Extraction:abc12345] STAGE: Message { data }
```

### 6. Download Fallback Methods (in order of attempt)
1. **direct_http** - Simple axios GET with research bot User-Agent
2. **browser_mimic** - Spoofed browser headers (Chrome UA, Accept, Sec-Fetch-*)
3. **pdf_link_extraction** - Fetch HTML page, find PDF links via cheerio, fetch PDF
4. **browser_screenshot** - Puppeteer/Playwright full-page screenshot

## Files to Examine

### Core Extraction Logic
- `src/services/contribution/ExtractionWorker.js` - Main extraction worker with debug logging
  - `processExtraction()` - Main entry point
  - `downloadContentWithFallbacks()` - Multi-method download
  - `runOCR()` - OCR processing
  - `parseOCRtoRows()` - Text to structured data
  - `debug()` - Debug logging method

### OCR Processing
- `src/services/document/OCRProcessor.js` - Google Vision + Tesseract OCR
  - `process()` - Main OCR entry
  - `processWithGoogleVision()` - Primary OCR
  - `processWithTesseract()` - Fallback OCR

### API Routes
- `src/api/routes/contribute.js` - Contribution API
  - `GET /:sessionId/extraction/:extractionId/status` - Status endpoint
  - `GET /capabilities` - System capabilities
  - `POST /:sessionId/extract` - Start extraction

### Session Management
- `src/services/contribution/ContributionSession.js` - Session handling
  - `startExtraction()` - Initiates extraction job

### Frontend
- `contribute-v2.html` - Main UI
  - `pollExtractionStatus()` - Polls for updates
  - `updateDebugPanel()` - Updates debug display
  - `renderDebugLog()` - Renders log entries
  - `checkCapabilities()` - Checks system setup

### Configuration
- `config.js` - API keys and settings
  - `apiKeys.googleVision` - Google Vision API key

## Testing Plan Requirements

Create a rigorous testing plan that:

1. **Verifies Debug Infrastructure Works**
   - Can we see debug logs in the database?
   - Does the status endpoint return debug data?
   - Does the frontend display debug info?

2. **Identifies Exact Failure Point**
   - At which stage does the process stop?
   - What error messages appear in debug log?
   - Does it fail at download, OCR, or parsing?

3. **Tests Each Download Method**
   - Does direct_http work for any URL?
   - Does browser_mimic bypass 403s?
   - Does pdf_link_extraction find embedded PDFs?
   - Is Puppeteer installed and working?

4. **Tests OCR Pipeline**
   - Is Google Vision API key configured?
   - Does Tesseract fallback work?
   - What happens with empty OCR results?

5. **Tests with Multiple URL Types**
   - Direct PDF URL
   - Page with embedded PDF iframe
   - Page with PDF download link
   - Protected/authenticated content

## Database Access

```
Host: dpg-d3v78f7diees73epc4k0-a.oregon-postgres.render.com
Database: reparations
User: reparations_user
Password: hjEMn35Kw7p712q1SYJnBxZqIYRdahHv
```

Useful queries:
```sql
-- Get recent extraction jobs with debug info
SELECT extraction_id, status, progress, status_message, error_message,
       debug_log, started_at, updated_at
FROM extraction_jobs
ORDER BY created_at DESC
LIMIT 5;

-- Get full debug log for specific extraction
SELECT debug_log
FROM extraction_jobs
WHERE extraction_id = 'your-extraction-id';
```

## Expected Outcomes

After testing, we should know:
1. Exactly which stage fails
2. Why it fails (missing dependency, API error, network issue, etc.)
3. What fix is needed
4. Whether the fix works

## Key Questions to Answer

1. Does the extraction job even start processing? (Check for INIT stage in debug_log)
2. If it starts, where does it stop? (Last stage in debug_log)
3. Are download methods being attempted? (Look for DOWNLOAD_METHOD stages)
4. Is OCR being called? (Look for OCR_START stage)
5. Are there error messages? (Look for ERROR, FAIL stages)
6. What do the capabilities show? (Check /api/contribute/capabilities)
7. Is the frontend polling correctly? (Check browser console)
8. Is the database being updated? (Query extraction_jobs directly)

## Success Criteria

The OCR extraction is working when:
1. User clicks "start auto-ocr"
2. Debug panel shows progress through all stages
3. Status updates appear in real-time
4. Either: Extraction completes with parsed rows displayed
5. Or: Clear error message explains what went wrong with actionable next steps

## Notes

- The production backend is on Render and will auto-deploy from GitHub
- GitHub Pages serves the frontend (contribute-v2.html)
- The database migration has already been applied
- Puppeteer may not be installed - this could be the issue for protected PDFs
