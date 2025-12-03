# Conversational Contribute Pipeline Design

## The Problem

Current approach: User submits URL → Scraper tries to magically understand it → Often fails on:
- Scanned PDFs (no text layer)
- Iframes with restricted content
- Partial views (can only see 3.5 columns)
- Handwritten documents
- Non-standard layouts
- Content behind viewers/wrappers

## The Solution: Human-Guided Contextual Extraction

Instead of making the scraper omniscient, make it **collaborative**. The contribute page becomes a **conversation** where the human provides the context that machines can't divine.

---

## Comprehensive Metadata Schema

### 1. Source Metadata (About the Website/Document)

```javascript
sourceMetadata: {
  // Basic identification
  url: String,                    // Original URL submitted
  finalUrl: String,               // After redirects (may differ)
  domain: String,                 // e.g., "msa.maryland.gov"

  // Archive/Institution info
  archiveName: String,            // "Maryland State Archives"
  collectionName: String,         // "Montgomery County Slave Statistics"
  collectionId: String,           // "sc2908/000001/000812"

  // Document identification
  documentTitle: String,          // Human-provided or extracted
  documentDate: String,           // "1867-1868"
  documentDateType: Enum,         // 'exact' | 'range' | 'circa' | 'unknown'

  // Geographic context
  state: String,                  // "Maryland"
  county: String,                 // "Montgomery County"
  city: String,                   // Optional
  country: String,                // Default "United States"

  // Source classification
  sourceType: Enum,               // 'primary' | 'secondary' | 'tertiary'
  documentType: Enum,             // See Document Types below

  // Credibility indicators
  isOfficial: Boolean,            // Government/institutional source
  isDigitized: Boolean,           // Scanned from original
  hasOCRText: Boolean,            // PDF has text layer
  requiresOCR: Boolean,           // Needs OCR processing

  // Access details
  accessMethod: Enum,             // 'direct' | 'iframe' | 'pdf_viewer' | 'image' | 'api'
  contentUrl: String,             // Direct URL to actual content (PDF, image)
  authRequired: Boolean,          // Needs login

  // Pagination (for multi-page documents)
  pageNumber: Number,             // Current page
  totalPages: Number,             // Total pages in document
  paginationPattern: String,      // URL pattern for other pages

  // Timestamps
  submittedAt: DateTime,
  processedAt: DateTime,
  lastVerifiedAt: DateTime
}
```

### 2. Document Types Enum

```javascript
documentTypes: [
  // PRIMARY SOURCES - Can confirm ownership
  'slave_schedule',           // Census slave schedules
  'compensation_petition',    // DC Emancipation, etc.
  'slave_manifest',          // Ship manifests
  'bill_of_sale',            // Purchase/sale records
  'will_testament',          // Wills mentioning enslaved
  'estate_inventory',        // Property inventories
  'court_record',            // Legal proceedings
  'tax_record',              // Property tax lists
  'birth_register',          // Birth records
  'death_register',          // Death records
  'marriage_record',         // Marriage records
  'manumission_deed',        // Freedom papers
  'runaway_advertisement',   // Newspaper ads
  'plantation_record',       // Plantation journals/logs

  // SECONDARY SOURCES - Require verification
  'genealogy_database',      // Ancestry, FamilySearch
  'compiled_index',          // Published indexes
  'transcription',           // Transcribed records
  'family_tree',             // User-submitted trees
  'memorial',                // FindAGrave, etc.
  'biographical_sketch',     // Published biographies

  // TERTIARY SOURCES - Reference only
  'encyclopedia',            // Wikipedia, etc.
  'historical_article',      // News/magazine articles
  'academic_paper',          // Scholarly works
  'book_excerpt',            // Published books

  // UNKNOWN
  'unknown'
]
```

### 3. Content Structure Metadata (What the user sees)

```javascript
contentStructure: {
  // Layout type
  layoutType: Enum,              // 'table' | 'list' | 'prose' | 'form' | 'mixed' | 'image_only'

  // For tabular data
  columns: [
    {
      position: Number,          // 1, 2, 3...
      headerText: String,        // "NAME OF OWNER" (if visible)
      headerGuess: String,       // User's guess if header not visible
      dataType: Enum,            // 'owner_name' | 'enslaved_name' | 'date' | 'location' | 'age' | 'gender' | 'remarks' | 'unknown'
      width: Enum,               // 'narrow' | 'medium' | 'wide'
      visibility: Enum,          // 'full' | 'partial' | 'hidden'
      sampleValues: [String],    // User-provided examples from column
    }
  ],

  // For list/prose data
  entityPatterns: {
    ownerPattern: String,        // How owners appear in text
    enslavedPattern: String,     // How enslaved appear in text
    relationshipPattern: String, // How relationships are expressed
  },

  // Scan/Image quality
  scanQuality: Enum,             // 'excellent' | 'good' | 'fair' | 'poor' | 'illegible'
  handwritingType: Enum,         // 'printed' | 'typescript' | 'cursive' | 'mixed'
  handwritingLegibility: Enum,   // 'clear' | 'mostly_clear' | 'difficult' | 'illegible'

  // Visible area (for partial views)
  visibleArea: {
    columnsVisible: Number,      // e.g., 3.5
    rowsVisible: Number,         // e.g., 20
    scrollable: Boolean,
    zoomable: Boolean,
  },

  // Orientation issues
  orientation: Enum,             // 'normal' | 'rotated_90' | 'rotated_180' | 'rotated_270' | 'skewed'
  requiresRotation: Boolean,

  // Language
  language: String,              // 'en' default
  hasAbbreviations: Boolean,     // Old-style abbreviations
  abbreviationNotes: String,     // e.g., "do." means "ditto"
}
```

### 4. Entity Extraction Guidance (What we're looking for)

```javascript
extractionGuidance: {
  // What entities exist in this document?
  containsOwners: Boolean,
  containsEnslaved: Boolean,
  containsRelationships: Boolean,
  containsLocations: Boolean,
  containsDates: Boolean,
  containsValues: Boolean,       // Monetary values
  containsAges: Boolean,
  containsGenders: Boolean,
  containsOccupations: Boolean,

  // Name format guidance
  ownerNameFormat: Enum,         // 'last_first' | 'first_last' | 'last_only' | 'full_with_title'
  enslavedNameFormat: Enum,      // 'first_only' | 'first_last' | 'descriptive'

  // Relationship indicators
  relationshipKeywords: [String], // ["owned by", "slave of", "property of"]

  // Expected counts (for validation)
  expectedOwnerCount: Number,    // User estimate
  expectedEnslavedCount: Number,

  // Special patterns
  specialPatterns: [
    {
      name: String,              // "Ditto marks"
      pattern: String,           // "do." or '"'
      meaning: String,           // "Same as above"
    }
  ],

  // User-provided sample extractions (training data!)
  sampleExtractions: [
    {
      rawText: String,           // "JOHNSON, William    Sam    32"
      parsedOwner: String,       // "William Johnson"
      parsedEnslaved: String,    // "Sam"
      parsedAge: Number,         // 32
      confidence: Number,        // User's confidence in their reading
      notes: String,             // "Last name might be Johnston"
    }
  ]
}
```

### 5. Processing Instructions

```javascript
processingInstructions: {
  // Extraction approach
  extractionMethod: Enum,        // 'auto_ocr' | 'guided_ocr' | 'manual_entry' | 'csv_upload' | 'api_fetch'

  // OCR settings
  ocrEngine: Enum,               // 'tesseract' | 'google_vision' | 'aws_textract' | 'azure'
  ocrLanguage: String,           // 'eng'
  ocrEnhancements: [Enum],       // ['deskew', 'denoise', 'contrast', 'binarize']

  // Validation requirements
  requireHumanReview: Boolean,   // Always true for primary sources
  reviewPriority: Enum,          // 'high' | 'medium' | 'low'

  // Batch processing
  isBatchJob: Boolean,           // Part of larger crawl
  batchId: String,
  batchPriority: Number,

  // Error handling
  onOCRFailure: Enum,            // 'queue_manual' | 'skip' | 'retry_different_engine'
  onParseFailure: Enum,          // 'save_raw' | 'queue_review' | 'discard'

  // Storage
  storeRawImage: Boolean,        // Keep original scan
  storeOCRText: Boolean,         // Keep OCR output
  s3Path: String,                // Where to store files
}
```

### 6. Contributor Metadata

```javascript
contributor: {
  // Identity (optional)
  name: String,
  email: String,
  userId: String,                // If logged in

  // Attribution
  isAnonymous: Boolean,
  wantsCredit: Boolean,

  // Expertise
  expertise: [Enum],             // ['genealogy', 'history', 'ocr', 'local_knowledge']
  familyConnection: Boolean,     // Related to people in document
  connectionNotes: String,

  // Session
  sessionId: String,
  contributionCount: Number,     // How many they've done
  accuracyScore: Number,         // Based on verified contributions
}
```

### 7. Quality & Verification Metadata

```javascript
quality: {
  // Confidence scores
  ocrConfidence: Number,         // 0-1, from OCR engine
  parseConfidence: Number,       // 0-1, from our parser
  humanConfidence: Number,       // 0-1, contributor's confidence
  overallConfidence: Number,     // Weighted combination

  // Verification status
  status: Enum,                  // 'pending' | 'ocr_complete' | 'parsed' | 'reviewed' | 'verified' | 'rejected'

  // Review chain
  reviews: [
    {
      reviewerId: String,
      reviewerType: Enum,        // 'auto' | 'contributor' | 'moderator' | 'expert'
      reviewDate: DateTime,
      decision: Enum,            // 'approve' | 'edit' | 'reject' | 'escalate'
      edits: Object,             // What was changed
      notes: String,
    }
  ],

  // Cross-references
  corroboratedBy: [String],      // Other document IDs that confirm this
  conflictsWith: [String],       // Other document IDs with conflicting info

  // Flags
  flags: [
    {
      type: Enum,                // 'illegible' | 'damaged' | 'incomplete' | 'suspicious' | 'duplicate'
      details: String,
      flaggedBy: String,
      flaggedAt: DateTime,
    }
  ]
}
```

---

## Conversation Flow Design

### Stage 1: URL Analysis (Automatic)

```
User: [pastes URL]

System: [fetches URL, analyzes structure]

"I've analyzed this URL. Here's what I found:

📍 Source: Maryland State Archives
📄 Document: Montgomery County Slave Statistics, 1867-1868
🔗 Content: The actual document is a scanned PDF
   (https://msa.maryland.gov/.../pdf/am812--1.pdf)

This appears to be a PRIMARY SOURCE - an official government record
that could CONFIRM slaveholder/enslaved relationships.

Before I try to extract data, I need to understand what you're seeing.
Can you describe the document layout?"
```

### Stage 2: Visual Description (Human Input)

```
User: "I see a table with columns. First column is narrow - dates.
       Second column is NAME OF OWNER. Third is NAME OF SLAVE.
       There's a fourth column I can only see part of."

System: "Got it! Let me confirm the structure:

| Column | Width   | Header        | Data Type        |
|--------|---------|---------------|------------------|
| 1      | Narrow  | [Date?]       | Registration date|
| 2      | Wide    | NAME OF OWNER | Slaveholder name |
| 3      | Wide    | NAME OF SLAVE | Enslaved name    |
| 4      | Partial | [Unknown]     | ?                |

Is this accurate? And a few more questions:

1. Can you see the header row, or are you guessing column meanings?
2. What's the handwriting like - printed, cursive, or mixed?
3. How legible is it overall - clear, mostly readable, or difficult?"
```

### Stage 3: Quality Assessment (Human Input)

```
User: "Headers are visible. It's handwritten cursive, mostly readable
       but some entries are faded. The fourth column might be AGE or REMARKS."

System: "Thanks! Based on your description:

📊 Document Quality Assessment:
   • Layout: Tabular (4 columns)
   • Handwriting: Cursive
   • Legibility: Mostly readable with some faded entries
   • Column 4: Uncertain (AGE or REMARKS)

I have a few approaches we can try:

1. **Auto-OCR** - I'll run OCR and show you results to correct
   Best for: Mostly legible documents

2. **Guided Entry** - I'll show you the image, you type what you see
   Best for: Difficult handwriting, important documents

3. **Sample + Learn** - You give me 5-10 example rows, I learn the pattern
   Best for: Consistent formatting with quirks

Which would you like to try?"
```

### Stage 4: Extraction Strategy (Human Choice)

```
User: "Let's try Auto-OCR first"

System: "Starting OCR extraction...

⏳ Downloading PDF...
⏳ Running Tesseract OCR...
⏳ Parsing tabular structure...

Here's what I extracted from the first 10 rows:

| Date       | Owner Name       | Enslaved Name | Col 4   | Confidence |
|------------|------------------|---------------|---------|------------|
| 1867-03-15 | JOHNSON, William | Sam           | 32      | 85%        |
| 1867-03-15 | JOHNSON, William | Mary          | 28      | 82%        |
| 1867-03-18 | [illegible]      | [illegible]   | [?]     | 15%        |
| 1867-03-20 | THOMPSON, James  | Isaac         | 45      | 78%        |
| 1867-03-20 | THOMPSON, James  | Hannah        | 40      | 75%        |
| ...        |                  |               |         |            |

Looks like Column 4 is AGE based on the numeric values.

Row 3 is mostly illegible. Can you read it in the original?
Also, please correct any errors you see."
```

### Stage 5: Human Correction (Iterative)

```
User: "Row 3 is SMITH, Robert and the slave is 'Daniel', age 25.
       Also Row 1 should be 'Samuel' not 'Sam'"

System: "Corrections applied:

✓ Row 1: Sam → Samuel
✓ Row 3: [illegible] → SMITH, Robert | Daniel | 25

Updated extraction:
| Date       | Owner Name       | Enslaved Name | Age | Confidence |
|------------|------------------|---------------|-----|------------|
| 1867-03-15 | JOHNSON, William | Samuel        | 32  | 95% ✓      |
| 1867-03-15 | JOHNSON, William | Mary          | 28  | 82%        |
| 1867-03-18 | SMITH, Robert    | Daniel        | 25  | 100% ✓     |
| 1867-03-20 | THOMPSON, James  | Isaac         | 45  | 78%        |

Should I continue with the rest of the document?
Or would you like to review/correct more rows first?"
```

### Stage 6: Confirmation & Storage

```
User: "Continue with the rest"

System: [processes remaining pages]

"Extraction complete!

📊 Summary:
   • Pages processed: 15
   • Total rows: 342
   • Owners identified: 89
   • Enslaved persons: 342
   • Auto-extracted: 298 (87%)
   • Human-corrected: 44 (13%)
   • Still illegible: 12 (4%)

📁 Data will be stored as:
   • Source: Maryland State Archives
   • Document: Montgomery County Slave Statistics, 1867-1868
   • Type: PRIMARY SOURCE (can confirm relationships)
   • Status: PENDING REVIEW (high-confidence entries)

Would you like to:
1. Review the illegible entries one more time?
2. Add any notes about this document?
3. Continue to the next page in this series?
4. Submit and finish?"
```

---

## API Endpoints Needed

```javascript
// New endpoints for conversational contribute

POST /api/contribute/analyze-url
// Input: { url }
// Output: { sourceMetadata, contentType, accessMethod, suggestedApproach }

POST /api/contribute/describe-content
// Input: { sessionId, description (natural language) }
// Output: { parsedStructure, clarifyingQuestions }

POST /api/contribute/confirm-structure
// Input: { sessionId, confirmedStructure, qualityAssessment }
// Output: { extractionOptions, recommendations }

POST /api/contribute/start-extraction
// Input: { sessionId, method: 'auto_ocr' | 'guided' | 'sample_learn' }
// Output: { extractionId, status: 'processing' }

GET /api/contribute/extraction-status/:extractionId
// Output: { status, progress, previewRows, errors }

POST /api/contribute/correct-extraction
// Input: { extractionId, corrections: [{ rowId, field, oldValue, newValue }] }
// Output: { updatedRows, newConfidence }

POST /api/contribute/submit-extraction
// Input: { extractionId, contributorNotes, reviewPriority }
// Output: { documentId, personsCreated, status }

// WebSocket for real-time OCR progress
WS /api/contribute/extraction-stream/:extractionId
// Streams: { type: 'progress' | 'row' | 'error', data }
```

---

## Database Schema Additions

```sql
-- Contribution sessions (conversation state)
CREATE TABLE contribution_sessions (
    session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    url TEXT NOT NULL,
    contributor_id TEXT,

    -- Conversation state
    current_stage TEXT DEFAULT 'url_analysis',
    conversation_history JSONB DEFAULT '[]',

    -- Gathered metadata
    source_metadata JSONB,
    content_structure JSONB,
    extraction_guidance JSONB,
    processing_instructions JSONB,

    -- Status
    status TEXT DEFAULT 'in_progress',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- Extraction jobs
CREATE TABLE extraction_jobs (
    extraction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES contribution_sessions(session_id),

    -- Source
    content_url TEXT NOT NULL,
    content_type TEXT,

    -- Processing
    method TEXT NOT NULL,  -- 'auto_ocr', 'guided', 'sample_learn'
    ocr_engine TEXT,
    ocr_config JSONB,

    -- Results
    raw_ocr_text TEXT,
    parsed_rows JSONB,
    row_count INTEGER,

    -- Quality
    avg_confidence DECIMAL(3,2),
    human_corrections INTEGER DEFAULT 0,
    illegible_count INTEGER DEFAULT 0,

    -- Status
    status TEXT DEFAULT 'pending',
    progress INTEGER DEFAULT 0,
    error_message TEXT,

    -- Timestamps
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Human corrections (learning data!)
CREATE TABLE extraction_corrections (
    correction_id SERIAL PRIMARY KEY,
    extraction_id UUID REFERENCES extraction_jobs(extraction_id),

    row_index INTEGER,
    field_name TEXT,
    original_value TEXT,
    corrected_value TEXT,

    -- Context for ML training
    raw_image_region TEXT,  -- Base64 of the specific cell
    ocr_confidence DECIMAL(3,2),

    corrected_by TEXT,
    corrected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Learned patterns (from corrections)
CREATE TABLE learned_patterns (
    pattern_id SERIAL PRIMARY KEY,
    domain TEXT,
    document_type TEXT,

    -- Pattern
    pattern_type TEXT,  -- 'name_format', 'abbreviation', 'column_header'
    raw_pattern TEXT,
    interpreted_as TEXT,

    -- Confidence
    occurrences INTEGER DEFAULT 1,
    corrections INTEGER DEFAULT 0,
    confidence DECIMAL(3,2),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## Frontend Component Structure

```
contribute-v2.html (or React component)
├── URLInputStage
│   ├── URLInput
│   ├── AnalysisSpinner
│   └── SourcePreview
│
├── ContentDescriptionStage
│   ├── ChatInterface
│   ├── QuickDescriptionButtons
│   ├── ColumnDefinitionUI
│   └── QualityAssessmentForm
│
├── ExtractionStage
│   ├── MethodSelector
│   ├── ProgressIndicator
│   ├── PreviewTable
│   │   ├── EditableCell
│   │   ├── ConfidenceIndicator
│   │   └── FlagButton
│   └── CorrectionInterface
│
├── ReviewStage
│   ├── SummaryStats
│   ├── IssuesList
│   ├── NotesInput
│   └── SubmitButton
│
└── SuccessStage
    ├── ContributionSummary
    ├── NextPagePrompt
    └── ShareButtons
```

---

## Key Principles

1. **Human expertise is the input, not the backup**
   - The contributor knows what they're looking at
   - The system asks questions, doesn't assume

2. **Every correction is training data**
   - Store original OCR + human correction pairs
   - Learn patterns specific to document types/archives

3. **Confidence is transparent**
   - Show confidence scores for every extraction
   - Let humans prioritize what to review

4. **Progressive enhancement**
   - Start with human guidance
   - As patterns emerge, automate more
   - Never fully automate primary sources

5. **Fail gracefully**
   - Illegible? Flag it, don't guess
   - Uncertain? Ask, don't assume
   - Wrong? Easy to correct

6. **Context flows downstream**
   - Metadata gathered in conversation informs extraction
   - Extraction confidence informs review priority
   - Human corrections inform future extractions
