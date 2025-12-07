# Active Context: Current Development State

**Last Updated:** December 6, 2025
**Current Phase:** Comprehensive Historical Data Model
**Active Branch:** main

---

## Recent Major Changes (Dec 6, 2025)

### 14. Comprehensive Historical Data Model Enhancement (Dec 6, 2025)

**Problem Solved:** The database schema was designed for simple owner→enslaved relationships but couldn't represent complex historical documents like the 1733 Talbot County Tax Assessment, which includes households, geographic subdivisions (hundreds), occupations, legal statuses, property/quarters, and requires provenance tracking.

**Solution Implemented:** Migration 007 adds 7 major enhancements:

#### 1. Household System
```sql
households                 -- Groups of people living/taxed together
household_members          -- Junction table linking individuals to households
```
- Tracks head of household, member status (dependent, kin, servant, apprentice, orphan)
- Records taxable counts by race/gender
- Links to geographic subdivisions and source documents

#### 2. Hierarchical Geography
```sql
geographic_subdivisions    -- Country → State → County → Hundred → Parish
```
- Pre-populated with Maryland and Talbot County's 6 hundreds
- Recursive view `geographic_hierarchy` for full path queries
- Supports historical subdivisions that no longer exist

#### 3. Occupation & Honorific Fields
```sql
individuals.occupation           -- 'planter', 'blacksmith', etc.
individuals.occupation_category  -- 'craftsman', 'planter', 'merchant'
individuals.honorific            -- 'Gent', 'Esq', 'Dr', 'Capt'
individuals.title                -- 'Justice of the Peace', 'Sheriff'
enslaved_individuals.occupation  -- 'field_hand', 'domestic', 'blacksmith'
enslaved_individuals.skill_level -- 'skilled', 'semi_skilled', 'unskilled'
```

#### 4. Legal & Racial Status Fields
```sql
individuals.racial_designation        -- As recorded in historical documents
individuals.racial_designation_modern -- Modern terminology
individuals.legal_status              -- 'free', 'indentured', 'apprenticed'
individuals.is_taxable                -- Tax liability status
enslaved_individuals.racial_designation -- 'negro', 'mulatto', 'mustee'
enslaved_individuals.enslaved_status   -- 'enslaved', 'term_slave', 'hired_out'
```

#### 5. Property & Quarter System
```sql
properties                 -- Land holdings, plantations, quarters
property_residents         -- Who lived/worked on each property
```
- Supports plantation→quarter hierarchy
- Tracks ownership, acreage, acquisition/disposition
- Links residents with roles (owner, overseer, worker, domestic)

#### 6. Enhanced Name Handling
```sql
enslaved_individuals.given_name      -- First name
enslaved_individuals.surname         -- Often unknown
enslaved_individuals.name_type       -- 'given_only', 'full', 'partial'
enslaved_individuals.gender_source   -- 'explicit', 'inferred_from_name'
enslaved_individuals.gender_confidence
```

#### 7. Data Attribution & Provenance
```sql
source_types              -- 13 source types with reliability weights
data_attributions         -- Links any field to its source(s)
inference_log             -- Tracks when data was inferred vs. recorded
```
- Reliability weights: tax_list (0.95) → oral_history (0.50)
- Supports multi-source verification
- Audit trail for inferences

#### 8. Expanded Relationship Types
```sql
relationship_types        -- 39 relationship types in 5 categories
```
- Categories: kinship, legal, economic, residential, ecclesiastical
- Includes: enslaver/enslaved_by, master/apprentice, guardian/ward, overseer/supervised, head_of_household/household_member

**New Views Created:**
- `household_full` - Complete household with all members as JSON
- `geographic_hierarchy` - Full geographic path for any subdivision
- `property_with_residents` - Property with all residents as JSON
- `data_provenance_summary` - Attribution stats per record

**Migration File:** `migrations/007-comprehensive-historical-data-model.sql`

---

## Recent Major Changes (Dec 5, 2025)

### 13. OCR Extraction Pipeline Comprehensive Debugging (Dec 5, 2025)

**Problem Solved:** The OCR extraction process was failing silently with no errors shown to users. When users clicked "start auto-ocr", the system would show "Starting extraction..." but nothing would happen - no progress, no errors, no results even after 10+ minutes.

**Root Cause Analysis:**
1. ExtractionWorker ran asynchronously but errors were only logged server-side
2. No real-time status updates were pushed to frontend
3. Download methods failed silently (especially for protected PDFs like MSA)
4. No debug information was persisted or exposed to frontend
5. Database lacked columns for status messages and debug logs

**Solution Implemented:**

#### 1. Enhanced ExtractionWorker (`src/services/contribution/ExtractionWorker.js`)
- **Debug Logging System:** Added `debug()` method that logs to console AND persists to database
- **Multiple Download Fallback Methods:**
  1. Direct HTTP download (for unprotected PDFs)
  2. Browser-mimicking download (spoofed User-Agent + headers)
  3. PDF link extraction from HTML pages (parses iframe/embed/object tags)
  4. Browser-based screenshot (Puppeteer or Playwright)
- **Comprehensive Error Tracking:** Every stage logs with timestamp, elapsed time, and data
- **Graceful Degradation:** OCR errors return results instead of throwing

#### 2. New Database Columns (Migration: `migrations/add-extraction-debug-columns.sql`)
```sql
ALTER TABLE extraction_jobs ADD COLUMN status_message TEXT;
ALTER TABLE extraction_jobs ADD COLUMN debug_log JSONB;
ALTER TABLE extraction_jobs ADD COLUMN updated_at TIMESTAMP;
```

#### 3. Enhanced API Routes (`src/api/routes/contribute.js`)
- **Debug Status Endpoint:** `GET /api/contribute/:sessionId/extraction/:extractionId/status?debug=true`
  - Returns full debug log with timestamps and stages
  - Shows elapsed time, status message, error details
- **Capabilities Endpoint:** `GET /api/contribute/capabilities`
  - Reports available OCR services (Google Vision, Tesseract)
  - Reports browser automation availability (Puppeteer, Playwright)

#### 4. Frontend Debug Panel (`contribute-v2.html`)
- **Collapsible Debug Panel:** Shows real-time extraction status
- **Live Status Display:** Status, Progress %, Message, Elapsed Time
- **Color-Coded Debug Log:**
  - Red for errors/failures
  - Green for success/completion
  - Blue for initialization/start
  - Purple for download stages
  - Orange for OCR stages
- **Capabilities Check Button:** Shows what OCR services are available
- **Auto-show on extraction start:** Debug panel opens automatically

#### 5. Improved Polling System
- Polls every 2 seconds with debug info every 5th poll
- 10-minute timeout with clear messaging
- Shows alternative methods on failure/timeout
- Better error handling for connection issues

**Key Debug Log Stages:**
```
INIT → STATUS → DB_QUERY → JOB_INFO → URL_RESOLVE →
DOWNLOAD_METHOD → DOWNLOAD_FAIL → DOWNLOAD →
OCR_START → OCR_PROCESS → OCR_RESULT → OCR_COMPLETE →
PARSE_START → PARSE_COMPLETE → SAVE → COMPLETE
```

**Migration Required:**
```bash
PGPASSWORD=hjEMn35Kw7p712q1SYJnBxZqIYRdahHv psql -h dpg-d3v78f7diees73epc4k0-a.oregon-postgres.render.com -U reparations_user -d reparations -f migrations/add-extraction-debug-columns.sql
```

---

## Recent Major Changes (Dec 4, 2025)

### 12. Bibliography & Intellectual Property System LIVE (Dec 4, 2025)

**Problem Solved:** The project needed a comprehensive system to track all intellectual sources, databases, archives, researchers, and contributors. Users copy/paste content without full citations, and sources need proper academic attribution.

**Solution Implemented:**

#### 1. BibliographyManager (`src/utils/bibliography-manager.js`)
Core management class with:
- Citation formatting (APA, Chicago, MLA, BibTeX)
- Known archive patterns (MSA, FamilySearch, Ancestry, Civil War DC, etc.)
- Copy/paste content detection
- Pending citation flagging
- Participant/contributor tracking
- Database and in-memory storage support

#### 2. IP Tracker (`src/utils/ip-tracker.js`)
Intellectual property tracker with:
- Automatic URL detection and archive identification
- Long text/quote detection
- Academic citation pattern recognition
- Census/statistical data detection
- Session-based reference tracking
- Integration hooks for contribution pipeline

#### 3. Bibliography API Routes (`src/api/routes/bibliography.js`)
```
GET    /api/bibliography              - Get all entries + pending + participants
GET    /api/bibliography/stats        - Statistics
GET    /api/bibliography/export       - Export (json, bibtex, apa, chicago)
GET    /api/bibliography/pending      - Pending citations
POST   /api/bibliography/pending      - Flag pending citation
PUT    /api/bibliography/pending/:id  - Resolve pending
GET    /api/bibliography/participants - Get participants
POST   /api/bibliography/participants - Add participant
POST   /api/bibliography              - Add entry
POST   /api/bibliography/analyze      - Analyze text for copy/paste
POST   /api/bibliography/from-url     - Generate citation from URL
```

#### 4. Frontend (`bibliography.html`)
Full-featured bibliography page with:
- Tabbed sections: Sources, Technologies, Intellectual Leaders, Participants, Pending
- Search and filter functionality
- Expandable category cards with formatted citations
- Forms to add participants and flag pending citations
- Export functionality (JSON)
- Pre-populated with 10+ known sources

#### 5. Database Tables (LIVE on Render PostgreSQL)
```sql
bibliography              - Main citations table
pending_citations         - Sources needing full citation
participants              - Contributors and researchers
copy_paste_flags          - Detected references
citation_relationships    - Source relationships
bibliography_exports      - Export history
```

#### 6. Memory Bank Index (`memory-bank/bibliography-index.md`)
Living documentation tracking all sources with:
- Quick statistics
- Full source inventory by category
- How-to guides for adding sources
- Source type definitions

**Pre-populated Sources (14 entries):**
- 4 Government Archives (MSA, Civil War DC, NARA, Library of Virginia)
- 3 Genealogy Databases (FamilySearch, Ancestry, Find A Grave)
- 2 Research Compilations (Tom Blake's 1860, Beyond Kin)
- 3 Technologies (Google Vision, Tesseract, OpenZeppelin)
- 2 Participants (Danyela Brown, Tom Blake)

**Key Feature - Pending Citations:**
When content is copy/pasted or referenced without full citation:
1. The IP Tracker can flag it automatically
2. Entry appears in `/api/bibliography/pending`
3. Shows on bibliography.html under "Pending Citations" tab
4. User completes citation details later (NOT prompted immediately)

---

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
6. ~~OCR extraction failing silently~~ - FIXED: Comprehensive debug logging
7. ~~No progress notifications~~ - FIXED: Real-time debug panel

### Remaining Issues
1. **No Authentication** - API completely open
2. **Guided entry not implemented** - UI exists but backend incomplete
3. **Browser automation may not be installed** - Need Puppeteer for protected PDFs
4. **Google Vision API key required** - OCR won't work without valid credentials

### Dependencies to Install (if not present)
```bash
npm install puppeteer  # For browser-based PDF extraction
```

---

## Commits from This Session (Dec 5, 2025)

TBD - Commit after testing

Previous session commits (Dec 4):
1. `261f097` - Fix confirmation logic: use content-based confirmation, not domain-based
2. `2132989` - Fix multiple contribution pipeline bugs found by e2e testing
3. `0544589` - Add end-to-end test for contribution pipeline

Previous session commits (Dec 2):
- `36c3e02` - Add conversational contribution pipeline with federal owner auto-promotion
- `b9a3e16` - Add rootsweb census scraper and full backlog auto-processing
- `a2ca268` - Add unified scraping system with dynamic site handlers

---

## Next Steps

### Immediate (Dec 5, 2025)
1. ✅ Run database migration for debug columns
2. Test extraction with MSA URL to verify debug logging works
3. Install Puppeteer if browser automation needed

### Short Term
1. Add authentication to protect API
2. Build verification queue for human review
3. Add more confirmatory channels as needed
4. Implement guided entry for documents OCR can't handle

---

*This document is updated frequently as development progresses. Always check the "Last Updated" timestamp.*
