# Autonomous Research Agent - System Design

## 🎯 Vision

Build an AI agent that can:
1. **Accept a URL** from you during a work session
2. **Intelligently scrape the page** for genealogical data
3. **Extract persons** (enslaved, owners, descendants) with relationships
4. **Detect and download** evidentiary documents (wills, probate records, etc.)
5. **Auto-upload and process** documents through existing pipeline
6. **Categorize and label** everything automatically
7. **Manage two databases**:
   - **Confirmed Persons** (high confidence, verified)
   - **Unconfirmed Leads** (needs review, bulk repository)

---

## 🏗️ System Architecture

```
User provides URL
    ↓
[Web Scraping Agent]
    ├─ Intelligent page parsing
    ├─ Extract text, tables, images
    └─ Detect downloadable documents
    ↓
[ML Entity Extractor]
    ├─ Named Entity Recognition (NER)
    ├─ Relationship extraction
    ├─ Confidence scoring
    └─ Classification (owner/enslaved/descendant)
    ↓
[Document Handler]
    ├─ Auto-download PDFs/images
    ├─ Upload to system
    ├─ Trigger OCR pipeline
    └─ Auto-categorize (will/probate/census)
    ↓
[Two-Tier Database Manager]
    ├─ High confidence → Confirmed DB
    ├─ Low confidence → Unconfirmed Leads DB
    └─ Link to source URL for provenance
    ↓
[Verification Queue]
    ├─ Human review interface
    ├─ Promote leads → confirmed
    └─ Merge duplicates
```

---

## 📦 Component 1: Web Scraping Agent

### Technology Stack
- **Puppeteer** (headless Chrome) or **Playwright** (multi-browser)
- **Cheerio** (fast HTML parsing)
- **Readability** (extract main content from noisy pages)

### Capabilities

#### 1. Intelligent Page Navigation
```javascript
class WebScrapingAgent {
  async scrapePage(url) {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    // Go to URL
    await page.goto(url, { waitUntil: 'networkidle2' });

    // Detect page type
    const pageType = await this.detectPageType(page);

    // Extract based on page type
    if (pageType === 'familysearch-person') {
      return await this.scrapeFamilySearchPerson(page);
    } else if (pageType === 'ancestry-profile') {
      return await this.scrapeAncestryProfile(page);
    } else if (pageType === 'archive-document') {
      return await this.scrapeArchiveDocument(page);
    } else {
      return await this.scrapeGenericPage(page);
    }
  }
}
```

#### 2. FamilySearch Person Page Scraping
```javascript
async scrapeFamilySearchPerson(page) {
  const data = {
    personId: await page.$eval('.personId', el => el.textContent),
    fullName: await page.$eval('.fullName', el => el.textContent),
    birthYear: await this.extractYear('birth'),
    deathYear: await this.extractYear('death'),
    birthPlace: await this.extractPlace('birth'),

    // Extract relationships
    spouses: await this.extractSpouses(page),
    children: await this.extractChildren(page),
    parents: await this.extractParents(page),

    // Extract sources/documents
    documents: await this.extractDocuments(page),

    // Metadata
    sourceUrl: page.url(),
    scrapedAt: new Date()
  };

  return data;
}
```

#### 3. Generic Page Scraping (Any Website)
```javascript
async scrapeGenericPage(page) {
  // Get main content (remove nav, ads, etc.)
  const mainContent = await page.evaluate(() => {
    // Use Mozilla Readability algorithm
    return new Readability(document).parse();
  });

  // Extract all text
  const text = mainContent.textContent;

  // Extract all tables (often contain genealogical data)
  const tables = await page.$$eval('table', tables => {
    return tables.map(table => {
      // Convert table to structured data
      const headers = [...table.querySelectorAll('th')].map(th => th.textContent);
      const rows = [...table.querySelectorAll('tr')].map(tr => {
        return [...tr.querySelectorAll('td')].map(td => td.textContent);
      });
      return { headers, rows };
    });
  });

  // Find all downloadable documents
  const documents = await this.findDocuments(page);

  return { text, tables, documents, url: page.url() };
}
```

#### 4. Document Detection
```javascript
async findDocuments(page) {
  // Find all links to PDFs, images, documents
  const documents = await page.$$eval('a[href]', links => {
    return links
      .filter(link => {
        const href = link.href.toLowerCase();
        return href.endsWith('.pdf') ||
               href.endsWith('.jpg') ||
               href.endsWith('.png') ||
               href.includes('download') ||
               href.includes('document');
      })
      .map(link => ({
        url: link.href,
        text: link.textContent.trim(),
        type: this.guessDocumentType(link.textContent)
      }));
  });

  return documents;
}

guessDocumentType(text) {
  const lower = text.toLowerCase();
  if (lower.includes('will')) return 'will';
  if (lower.includes('probate')) return 'probate';
  if (lower.includes('census')) return 'census';
  if (lower.includes('deed')) return 'deed';
  if (lower.includes('marriage')) return 'marriage';
  if (lower.includes('birth')) return 'birth';
  if (lower.includes('death')) return 'death';
  return 'other';
}
```

---

## 📦 Component 2: ML Entity Extractor

### Purpose
Extract structured data from unstructured text scraped from web pages.

### Technology Options

#### Option A: Free Local NLP (No API costs)
- **compromise** npm package (JavaScript NLP)
- **natural** npm package (NER, tokenization)
- **Regex patterns** (fast, rule-based)

#### Option B: Advanced ML (Better accuracy)
- **OpenAI GPT-4** (best, costs ~$0.01 per page)
- **spaCy** (Python, free, excellent NER)
- **Hugging Face Transformers** (free, local)

### Implementation (Hybrid Approach)

```javascript
class EntityExtractor {
  async extractPersons(text) {
    // Step 1: Find all potential person names (fast, local)
    const names = this.extractNamesLocal(text);

    // Step 2: For each name, extract context
    const persons = [];

    for (const name of names) {
      const context = this.getContextAroundName(text, name);

      // Extract structured data
      const person = {
        fullName: name,
        type: this.classifyPersonType(context), // owner/enslaved/descendant
        relationships: this.extractRelationships(context),
        dates: this.extractDates(context),
        locations: this.extractLocations(context),
        confidence: this.calculateConfidence(context),
        evidence: context,
        sourceUrl: this.currentUrl
      };

      persons.push(person);
    }

    return persons;
  }

  extractNamesLocal(text) {
    // Use regex to find capitalized name patterns
    const namePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g;
    const matches = [...text.matchAll(namePattern)];

    // Filter out common false positives
    const names = matches
      .map(m => m[1])
      .filter(name => !this.isCommonWord(name))
      .filter(name => !this.isPlaceName(name));

    return [...new Set(names)]; // Deduplicate
  }

  classifyPersonType(context) {
    const lower = context.toLowerCase();

    // Check for enslaver keywords
    if (lower.includes('enslaved') ||
        lower.includes('owned') ||
        lower.includes('master') ||
        lower.includes('slaveholder')) {
      return 'enslaved';
    }

    // Check for owner keywords
    if (lower.includes('bequeath') ||
        lower.includes('estate') ||
        lower.includes('property')) {
      return 'owner';
    }

    // Check for descendant keywords
    if (lower.includes('son') ||
        lower.includes('daughter') ||
        lower.includes('child') ||
        lower.includes('heir') ||
        lower.includes('descendant')) {
      return 'descendant';
    }

    return 'unknown';
  }

  extractRelationships(context) {
    const relationships = [];

    // Pattern: "X's son Y" or "Y, son of X"
    const sonPattern = /(\w+(?:\s+\w+)*)'s son (\w+(?:\s+\w+)*)|(\w+(?:\s+\w+)*),\s+son of (\w+(?:\s+\w+)*)/gi;
    const sonMatches = [...context.matchAll(sonPattern)];

    sonMatches.forEach(match => {
      relationships.push({
        type: 'parent-child',
        parent: match[1] || match[4],
        child: match[2] || match[3]
      });
    });

    // Similar patterns for daughter, wife, husband, etc.

    return relationships;
  }

  calculateConfidence(context) {
    let score = 0.5; // Base confidence

    // Increase confidence if we found:
    if (context.includes('born')) score += 0.1;
    if (context.includes('died')) score += 0.1;
    if (context.match(/\b\d{4}\b/)) score += 0.1; // Has a year
    if (context.includes('married')) score += 0.05;
    if (context.length > 100) score += 0.1; // Good context

    return Math.min(score, 1.0);
  }
}
```

### Advanced ML Option (OpenAI GPT-4)

```javascript
async extractPersonsWithGPT(text) {
  const prompt = `
Extract all persons mentioned in this text. For each person, identify:
1. Full name
2. Type (enslaved_person, slave_owner, or descendant)
3. Birth year (if mentioned)
4. Death year (if mentioned)
5. Relationships to other persons
6. Any other relevant details

Text:
${text}

Return as JSON array.
`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' }
  });

  return JSON.parse(response.choices[0].message.content);
}
```

---

## 📦 Component 3: Document Auto-Downloader

### Purpose
Detect, download, and auto-process documents found on web pages.

```javascript
class DocumentAutoDownloader {
  async processDocuments(documents, sourceUrl) {
    const results = [];

    for (const doc of documents) {
      try {
        console.log(`Downloading: ${doc.url}`);

        // Download document
        const filePath = await this.downloadFile(doc.url);

        // Guess document metadata
        const metadata = {
          documentType: doc.type || this.guessTypeFromFilename(doc.url),
          sourceUrl: sourceUrl,
          originalFilename: this.getFilename(doc.url),
          downloadedAt: new Date()
        };

        // Upload to our system
        const uploadResult = await this.uploadToSystem(filePath, metadata);

        // Trigger OCR and processing
        await this.triggerProcessing(uploadResult.documentId);

        results.push({
          success: true,
          documentId: uploadResult.documentId,
          url: doc.url
        });

      } catch (error) {
        console.error(`Failed to download ${doc.url}:`, error);
        results.push({
          success: false,
          url: doc.url,
          error: error.message
        });
      }
    }

    return results;
  }

  async downloadFile(url) {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();

    const filename = `./downloads/${Date.now()}_${this.getFilename(url)}`;
    fs.writeFileSync(filename, Buffer.from(buffer));

    return filename;
  }

  async uploadToSystem(filePath, metadata) {
    // Use existing upload API
    const formData = new FormData();
    formData.append('document', fs.createReadStream(filePath));
    formData.append('ownerName', metadata.ownerName || 'Unknown');
    formData.append('documentType', metadata.documentType);
    formData.append('sourceUrl', metadata.sourceUrl);

    const response = await fetch('http://localhost:3000/api/upload-document', {
      method: 'POST',
      body: formData
    });

    return await response.json();
  }
}
```

---

## 📦 Component 4: Two-Tier Database System

### Database Schema

#### Table: `unconfirmed_persons` (Leads Repository)
```sql
CREATE TABLE unconfirmed_persons (
    lead_id SERIAL PRIMARY KEY,

    -- Person data
    full_name VARCHAR(255) NOT NULL,
    person_type VARCHAR(50), -- 'enslaved', 'owner', 'descendant', 'unknown'
    birth_year INTEGER,
    death_year INTEGER,
    birth_place VARCHAR(255),
    death_place VARCHAR(255),
    gender VARCHAR(20),

    -- Source and provenance
    source_url TEXT NOT NULL,
    source_page_title TEXT,
    extraction_method VARCHAR(50), -- 'regex', 'gpt4', 'manual'

    -- Evidence
    context_text TEXT, -- Surrounding text where person was mentioned
    confidence_score DECIMAL(3,2), -- 0.00 to 1.00

    -- Relationships (JSON array)
    relationships JSONB,

    -- Status
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'reviewing', 'confirmed', 'rejected', 'duplicate'
    reviewed_by VARCHAR(255),
    reviewed_at TIMESTAMP,

    -- Link to confirmed person (if promoted)
    confirmed_person_id VARCHAR(255),

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_unconfirmed_full_name ON unconfirmed_persons(full_name);
CREATE INDEX idx_unconfirmed_confidence ON unconfirmed_persons(confidence_score DESC);
CREATE INDEX idx_unconfirmed_status ON unconfirmed_persons(status);
CREATE INDEX idx_unconfirmed_type ON unconfirmed_persons(person_type);
```

#### Linking Table: `unconfirmed_to_confirmed`
```sql
CREATE TABLE unconfirmed_to_confirmed (
    mapping_id SERIAL PRIMARY KEY,
    unconfirmed_lead_id INTEGER REFERENCES unconfirmed_persons(lead_id),
    confirmed_person_id VARCHAR(255), -- Links to enslaved_individuals or individuals table
    confidence_score DECIMAL(3,2),
    matched_by VARCHAR(50), -- 'automatic', 'manual', 'ml'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Confidence-Based Routing

```javascript
class TwoTierDatabaseManager {
  async saveExtractedPerson(person, sourceUrl) {
    const confidence = person.confidence || 0.5;

    if (confidence >= 0.85) {
      // High confidence - add directly to confirmed database
      return await this.addToConfirmedDB(person);

    } else if (confidence >= 0.5) {
      // Medium confidence - add to unconfirmed, flag for review
      return await this.addToUnconfirmedDB(person, sourceUrl, 'needs_review');

    } else {
      // Low confidence - add to unconfirmed, flag for bulk review
      return await this.addToUnconfirmedDB(person, sourceUrl, 'low_confidence');
    }
  }

  async addToUnconfirmedDB(person, sourceUrl, status) {
    const result = await pool.query(`
      INSERT INTO unconfirmed_persons (
        full_name, person_type, birth_year, death_year,
        source_url, context_text, confidence_score,
        relationships, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING lead_id
    `, [
      person.fullName,
      person.type,
      person.birthYear,
      person.deathYear,
      sourceUrl,
      person.evidence,
      person.confidence,
      JSON.stringify(person.relationships),
      status
    ]);

    return result.rows[0].lead_id;
  }
}
```

---

## 📦 Component 5: Verification Queue UI

### Purpose
Allow you to quickly review and promote unconfirmed leads.

### Features

#### 1. Review Dashboard
```
Unconfirmed Persons Queue (3,847 leads)

[High Confidence (85%+)] [Medium Confidence (50-85%)] [Low Confidence (<50%)]

─────────────────────────────────────────────────────
Lead #1 | Confidence: 92%
─────────────────────────────────────────────────────
Name: Sarah Elizabeth Hopewell
Type: Enslaved Person
Born: 1835
Died: 1905
Source: https://familysearch.org/tree/person/details/XXXX

Evidence:
"Sarah Elizabeth Hopewell, born 1835, was enslaved by
James Robert Hopewell in Maryland..."

Relationships Found:
  • Enslaved by: James Robert Hopewell
  • Parent: Unknown

[✓ Confirm & Add to Database]  [✗ Reject]  [? Need More Info]
─────────────────────────────────────────────────────
```

#### 2. Bulk Actions
```javascript
// Confirm all high-confidence leads at once
async bulkConfirmHighConfidence() {
  const leads = await pool.query(`
    SELECT * FROM unconfirmed_persons
    WHERE confidence_score >= 0.85
      AND status = 'pending'
    LIMIT 100
  `);

  for (const lead of leads.rows) {
    await this.promoteToConfirmed(lead);
  }
}

async promoteToConfirmed(lead) {
  // Add to enslaved_individuals or individuals table
  const personId = await this.addToConfirmedDB(lead);

  // Update unconfirmed record
  await pool.query(`
    UPDATE unconfirmed_persons
    SET status = 'confirmed',
        confirmed_person_id = $1,
        reviewed_at = CURRENT_TIMESTAMP
    WHERE lead_id = $2
  `, [personId, lead.lead_id]);

  return personId;
}
```

---

## 🚀 Implementation Phases

### Phase 1: Core Web Scraping (Week 1)
✅ Puppeteer setup
✅ Generic page scraping
✅ FamilySearch-specific scraping
✅ Document detection

### Phase 2: Entity Extraction (Week 2)
✅ Regex-based name extraction
✅ Relationship extraction
✅ Confidence scoring
✅ Optional: GPT-4 integration

### Phase 3: Two-Tier Database (Week 2)
✅ Create unconfirmed_persons table
✅ Confidence-based routing
✅ Linking mechanisms

### Phase 4: Document Auto-Processing (Week 3)
✅ Auto-download documents
✅ Auto-upload to system
✅ Trigger OCR pipeline
✅ Auto-categorization

### Phase 5: Verification UI (Week 3)
✅ Review queue interface
✅ Bulk actions
✅ Promote to confirmed

---

## 💡 Example Work Session

```
You: "Scrape this page: https://familysearch.org/tree/person/details/MTRV-272"

Agent:
  ✓ Navigating to page...
  ✓ Detected: FamilySearch person page
  ✓ Extracted: James Hopewell (1780-1825)
  ✓ Found 5 children, 1 spouse
  ✓ Found 3 attached documents
  ✓ Downloading document: "Will of James Hopewell.pdf"
  ✓ Uploading to system... (Document ID: doc_12345)
  ✓ Triggering OCR processing...

  📊 Results:
    • 7 persons extracted (6 high confidence, 1 medium)
    • 5 relationships identified
    • 3 documents downloaded and processing
    • 6 persons added to confirmed DB
    • 1 person added to review queue

You: "Show me the review queue"

Agent:
  📋 Unconfirmed Persons Queue:

    1. Angelica Chesley (Confidence: 78%)
       Type: Spouse
       Relationship to: James Hopewell
       Source: FamilySearch

       [✓ Confirm]  [✗ Reject]

You: "Confirm"

Agent:
  ✓ Angelica Chesley added to confirmed database
  ✓ Linked to James Hopewell as spouse
```

---

## 🎯 Ready to Build?

Should I start with **Phase 1: Core Web Scraping**?

In 2-3 hours I can build:
1. Puppeteer-based page scraper
2. FamilySearch person page parser
3. Generic page text extractor
4. Document detector

Then you can immediately start feeding it URLs and watching it extract data!
