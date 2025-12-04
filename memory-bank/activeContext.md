# Active Context: Current Development State

**Last Updated:** December 4, 2025
**Current Phase:** Conversational Contribution Pipeline with Content-Based Confirmation
**Active Branch:** main

---

## Recent Major Changes (Dec 4, 2025)

### 11. Conversational Contribution Pipeline LIVE (Dec 4, 2025)

**Problem Solved:** Built a human-guided contribution flow where users can describe documents in natural language and the system extracts structured data. Critical fix: confirmation is now based on **document content**, NOT source domain.

**Key Principle:** Source domain (e.g., .gov) provides CONTEXT about where to look for documents, but does NOT confirm the data itself. Confirmation can ONLY come from:
1. Human transcription of names from document
2. OCR extraction that has been human-verified
3. High-confidence OCR (>= 95%) from user-confirmed document
4. Structured metadata parsed from page that user confirmed as accurate
5. Cross-reference with existing confirmed records

**Implementation Complete:**

#### 1. ContributionSession.js (`src/services/contribution/ContributionSession.js`)
Conversational service managing the contribution flow:
- **Stages:** url_analysis → content_description → structure_confirmation → extraction_strategy → extraction_in_progress → human_review → complete
- **URL Analysis:** Fetches page, detects archive type, PDF links, iframes, pagination
- **Content Description Parsing:** Extracts columns, quality, handwriting type from natural language
- **Column Header Parsing:** Prioritizes quoted headers ("DATE." "NAME.") over period-split parsing
- **Expanded inferDataType():** Recognizes 15+ column types (owner, enslaved, date, age, gender, physical_condition, military, compensation, witness, etc.)

#### 2. OwnerPromotion.js (`src/services/contribution/OwnerPromotion.js`)
Content-based promotion service with **confirmatory channels**:
```javascript
confirmatoryChannels = {
    'human_transcription': { minConfidence: 0.90 },
    'ocr_human_verified': { minConfidence: 0.85 },
    'ocr_high_confidence': { minConfidence: 0.95 },
    'structured_metadata': { minConfidence: 0.80 },
    'cross_reference': { minConfidence: 0.85 }
}
```
- Promotion REQUIRES specifying a confirmatory channel
- `.gov` domain alone does NOT auto-confirm anything
- Extensible via `addConfirmatoryChannel()` method

#### 3. API Routes (`src/api/routes/contribute.js`)
```
POST /api/contribute/start              - Start session with URL
POST /api/contribute/:sessionId/describe - Describe document content
POST /api/contribute/:sessionId/confirm  - Confirm structure
POST /api/contribute/:sessionId/extract  - Start extraction
POST /api/contribute/:sessionId/chat     - Natural language interaction
POST /api/contribute/:sessionId/sample   - Submit sample extractions
GET  /api/contribute/:sessionId          - Get session state
POST /api/contribute/:sessionId/extraction/:extractionId/promote - Promote to individuals (REQUIRES confirmationChannel)
POST /api/contribute/promote/:leadId     - Manual promotion
GET  /api/contribute/promotion-stats     - Statistics
```

#### 4. Frontend (`contribute-v2.html`)
Chat-based UI with:
- URL input to start session
- Chat interface for natural language
- Side panel showing progress, source info, extraction options
- Questions panel for structured input

#### 5. Database Tables (on Render PostgreSQL)
- `contribution_sessions` - Conversation state and metadata
- `extraction_jobs` - OCR/extraction job tracking
- `extraction_corrections` - Human corrections (training data)
- `promotion_log` - Audit trail for promotions
- `human_readings` - Ground truth from human input
- `document_auxiliary_data` - Stockpiled auxiliary information

#### 6. End-to-End Test (`test-contribution-pipeline-e2e.js`)
Comprehensive test simulating real user flow:
- Tests 3 description styles (detailed, simple, minimal)
- Validates questions have proper structure
- Verifies all stages complete successfully
- Run with: `node test-contribution-pipeline-e2e.js`

**Bugs Fixed (Dec 4):**
1. `pagination.detected` undefined - Initialize pagination in analysis object
2. Column header parsing - Prioritize quoted headers over period-split
3. Missing data type recognition - Added 15+ column types
4. Null safety - Added checks for contentStructure and columns arrays
5. Incorrect confirmation messaging - Changed from "Can CONFIRM" to "May contain"

---

### 10. Unified Scraping System & Backlog Processing LIVE (Dec 2, 2025)

**Problem Solved:** Fragmented scraping system rebuilt into unified system.

See previous activeContext.md for full details.

---

## Current Production Environment

### Render Services
- **Backend:** `reparations-platform.onrender.com` (Node.js)
- **Database:** Render PostgreSQL 17 (Virginia) - contains contribution tables

### Database Credentials (Render PostgreSQL)
```
Host: dpg-d3v78f7diees73epc4k0-a.oregon-postgres.render.com
Database: reparations
User: reparations_user
Password: hjEMn35Kw7p712q1SYJnBxZqIYRdahHv
```

### Working Contribution Endpoints (Verified Dec 4, 2025)
```
POST /api/contribute/start              ✅ Working
POST /api/contribute/:id/chat           ✅ Working
POST /api/contribute/:id/describe       ✅ Working
POST /api/contribute/:id/confirm        ✅ Working
POST /api/contribute/:id/extract        ✅ Working
GET  /api/contribute/:id                ✅ Working
```

---

## Architecture Notes

### Contribution Pipeline Flow
```
User pastes URL → /api/contribute/start
         ↓
URL Analysis (source type, PDF detection, pagination)
         ↓
User describes content → /api/contribute/:id/chat
         ↓
Parse description (columns, quality, handwriting)
         ↓
Confirm structure → /api/contribute/:id/confirm
         ↓
Choose extraction method → /api/contribute/:id/extract
         ↓
Extraction runs (OCR or guided entry)
         ↓
Human review/corrections
         ↓
Promotion (REQUIRES confirmatory channel)
         ↓
individuals table (confirmed only)
```

### Confirmation Logic (CRITICAL)
```
Source Domain → Provides CONTEXT (government archive, genealogy site, etc.)
                Does NOT confirm data

Confirmation → Can ONLY come from:
  1. human_transcription - User typed what they see
  2. ocr_human_verified - OCR + human corrections
  3. ocr_high_confidence - >= 95% OCR confidence
  4. structured_metadata - Parsed + user confirmed
  5. cross_reference - Matches existing confirmed record
```

---

## Known Issues & Limitations

### Resolved Issues ✅
1. ~~"Can CONFIRM" based on .gov domain~~ - FIXED: Now says "May contain"
2. ~~pagination.detected undefined~~ - FIXED: Initialize in analysis object
3. ~~Column parsing breaks on periods~~ - FIXED: Prioritize quoted headers
4. ~~Limited column type recognition~~ - FIXED: Added 15+ types
5. ~~Questions causing frontend crash~~ - FIXED: Null safety added

### Remaining Issues
1. **No Authentication** - API completely open
2. **OCR not implemented** - Extraction methods stub only
3. **Guided entry not implemented** - UI exists but backend incomplete
4. **No progress notifications** - Long-running extractions silent

---

## Commits from This Session (Dec 4, 2025)

1. `261f097` - Fix confirmation logic: use content-based confirmation, not domain-based
2. `2132989` - Fix multiple contribution pipeline bugs found by e2e testing
3. `0544589` - Add end-to-end test for contribution pipeline

Previous session commits (Dec 2):
- `36c3e02` - Add conversational contribution pipeline with federal owner auto-promotion
- `b9a3e16` - Add rootsweb census scraper and full backlog auto-processing
- `a2ca268` - Add unified scraping system with dynamic site handlers

---

## Next Steps

### Immediate
1. Implement actual OCR extraction (currently stub)
2. Build guided entry UI for high-difficulty documents
3. Add progress notifications for long-running extractions

### Short Term
1. Add authentication to protect API
2. Build verification queue for human review
3. Add more confirmatory channels as needed

---

*This document is updated frequently as development progresses. Always check the "Last Updated" timestamp.*
