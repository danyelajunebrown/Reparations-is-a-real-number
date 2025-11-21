# Continuous Autonomous Research System

## 🎯 Vision

A **public-facing, continuously-running** system where supporters can submit URLs for research, and the autonomous agent works 24/7 building the lead database even when you're not actively working.

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────┐
│           PUBLIC SUBMISSION PAGE                         │
│  "Help us find historical records"                      │
│                                                           │
│  [Submit URL to Research]                                │
│  • Wikipedia articles                                    │
│  • FindAGrave memorials                                  │
│  • Ancestry profiles                                     │
│  • Archive.org documents                                 │
│  • Newspaper archives                                    │
│                                                           │
│  📊 Current Status:                                      │
│     • URLs waiting to be processed: 145                  │
│     • Persons found (last 24h): 1,247                    │
│     • Documents found (last 24h): 83                     │
└──────────────────┬───────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────┐
│           URL QUEUE TABLE (scraping_queue)               │
│                                                           │
│  • url VARCHAR                                            │
│  • status ('pending' | 'processing' | 'completed')       │
│  • submitted_by VARCHAR                                   │
│  • priority INTEGER                                       │
│  • duplicate_of_session_id INTEGER                        │
│  • scheduled_at TIMESTAMP                                 │
└──────────────────┬───────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────┐
│      BACKGROUND WORKER (continuous-scraper.js)           │
│                                                           │
│  while (true) {                                          │
│    1. Check for pending URLs in queue                    │
│    2. Check if URL was scraped before (dedup)            │
│    3. If duplicate, skip and mark as such                │
│    4. If new, run autonomous-research-orchestrator       │
│    5. Save results to unconfirmed_persons                │
│    6. Mark URL as completed                              │
│    7. Wait 30 seconds                                    │
│    8. Repeat                                             │
│  }                                                       │
└──────────────────┬───────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────┐
│        DUPLICATE PERSON DETECTION                        │
│                                                           │
│  After each scraping session:                            │
│  • Find potential duplicates by name similarity          │
│  • Check birth/death year overlap                        │
│  • Suggest merges for human review                       │
│  • Track variations (spellings) of same person           │
└──────────────────────────────────────────────────────────┘
```

---

## 📦 Database Schema Extensions

### 1. URL Queue Table

```sql
CREATE TABLE scraping_queue (
    queue_id SERIAL PRIMARY KEY,
    
    -- URL to scrape
    url TEXT NOT NULL UNIQUE,
    url_hash VARCHAR(64), -- For faster duplicate checking
    
    -- Submission info
    submitted_by VARCHAR(255), -- Can be 'public', email, or user ID
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Processing status
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed', 'duplicate'
    priority INTEGER DEFAULT 5, -- 1-10 (10 = highest)
    
    -- Deduplication
    duplicate_of_url TEXT, -- If this URL was already scraped
    duplicate_of_session_id INTEGER REFERENCES scraping_sessions(session_id),
    
    -- Scheduling
    scheduled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    
    -- Results
    session_id INTEGER REFERENCES scraping_sessions(session_id),
    persons_found INTEGER DEFAULT 0,
    error_message TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_queue_status ON scraping_queue(status, priority DESC, submitted_at ASC);
CREATE INDEX idx_queue_url_hash ON scraping_queue(url_hash);
```

### 2. Person Duplicates Table

```sql
CREATE TABLE person_duplicates (
    duplicate_id SERIAL PRIMARY KEY,
    
    -- The two leads that might be the same person
    lead_id_1 INTEGER REFERENCES unconfirmed_persons(lead_id),
    lead_id_2 INTEGER REFERENCES unconfirmed_persons(lead_id),
    
    -- Similarity metrics
    name_similarity DECIMAL(3,2), -- 0.0 to 1.0 (Levenshtein distance)
    birth_year_match BOOLEAN,
    death_year_match BOOLEAN,
    location_match BOOLEAN,
    
    -- Overall confidence that these are the same person
    merge_confidence DECIMAL(3,2),
    
    -- Resolution
    status VARCHAR(50) DEFAULT 'suggested', -- 'suggested', 'confirmed_duplicate', 'not_duplicate', 'merged'
    reviewed_by VARCHAR(255),
    reviewed_at TIMESTAMP,
    
    -- If merged, which one is the canonical record?
    canonical_lead_id INTEGER REFERENCES unconfirmed_persons(lead_id),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_duplicates_status ON person_duplicates(status, merge_confidence DESC);
CREATE INDEX idx_duplicates_lead1 ON person_duplicates(lead_id_1);
CREATE INDEX idx_duplicates_lead2 ON person_duplicates(lead_id_2);
```

### 3. Person Identifiers Table

```sql
CREATE TABLE person_identifiers (
    person_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Canonical information
    canonical_name VARCHAR(255),
    birth_year_min INTEGER,
    birth_year_max INTEGER,
    death_year_min INTEGER,
    death_year_max INTEGER,
    primary_location VARCHAR(255),
    
    -- Person type
    person_type VARCHAR(50), -- 'enslaved', 'owner', 'descendant'
    
    -- Link to confirmed database
    confirmed_enslaved_id VARCHAR(255),
    confirmed_individual_id VARCHAR(255),
    
    -- Status
    status VARCHAR(50) DEFAULT 'unconfirmed', -- 'unconfirmed', 'confirmed'
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Link unconfirmed persons to their canonical person_id
ALTER TABLE unconfirmed_persons 
ADD COLUMN person_id UUID REFERENCES person_identifiers(person_id);

CREATE INDEX idx_unconfirmed_person_id ON unconfirmed_persons(person_id);
```

---

## 🌐 Public Submission Interface

### Frontend (HTML/JS)

```html
<!-- Add to index.html -->
<section id="contribute">
    <h2>Help Us Find Historical Records</h2>
    <p>Know of a webpage with information about slavery or genealogy? Submit it here!</p>
    
    <form id="submit-url-form">
        <input type="url" id="research-url" placeholder="https://..." required />
        <select id="url-category">
            <option value="wikipedia">Wikipedia Article</option>
            <option value="findagrave">FindAGrave Memorial</option>
            <option value="ancestry">Ancestry Profile</option>
            <option value="archive">Archive Document</option>
            <option value="newspaper">Newspaper Archive</option>
            <option value="other">Other</option>
        </select>
        <button type="submit">Submit for Research</button>
    </form>
    
    <div id="queue-stats">
        <h3>Research Queue Status</h3>
        <p>URLs waiting: <span id="urls-pending">Loading...</span></p>
        <p>Persons found (24h): <span id="persons-24h">Loading...</span></p>
        <p>Documents found (24h): <span id="docs-24h">Loading...</span></p>
    </div>
</section>
```

### Backend API Endpoint

```javascript
// Add to server.js
app.post('/api/submit-url', async (req, res) => {
    const { url, category, submittedBy } = req.body;
    
    try {
        // Validate URL
        const parsedUrl = new URL(url);
        
        // Hash for duplicate checking
        const urlHash = crypto.createHash('sha256').update(url.toLowerCase()).digest('hex');
        
        // Check if already queued or processed
        const existing = await pool.query(`
            SELECT queue_id, status FROM scraping_queue WHERE url_hash = $1
        `, [urlHash]);
        
        if (existing.rows.length > 0) {
            return res.json({
                success: true,
                message: 'URL already in queue',
                queueId: existing.rows[0].queue_id,
                status: existing.rows[0].status
            });
        }
        
        // Add to queue
        const result = await pool.query(`
            INSERT INTO scraping_queue (url, url_hash, submitted_by, priority)
            VALUES ($1, $2, $3, $4)
            RETURNING queue_id
        `, [url, urlHash, submittedBy || 'public', 5]);
        
        res.json({
            success: true,
            message: 'URL added to research queue',
            queueId: result.rows[0].queue_id
        });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// Get queue statistics
app.get('/api/queue-stats', async (req, res) => {
    const stats = await pool.query(`
        SELECT
            COUNT(*) FILTER (WHERE status = 'pending') as pending_urls,
            COUNT(*) FILTER (WHERE status = 'processing') as processing_urls,
            COUNT(*) FILTER (WHERE status = 'completed') as completed_urls,
            (
                SELECT COUNT(*)
                FROM unconfirmed_persons
                WHERE created_at > NOW() - INTERVAL '24 hours'
            ) as persons_24h,
            (
                SELECT COUNT(*)
                FROM scraped_documents
                WHERE created_at > NOW() - INTERVAL '24 hours'
            ) as documents_24h
        FROM scraping_queue
    `);
    
    res.json(stats.rows[0]);
});
```

---

## 🤖 Continuous Background Worker

```javascript
// continuous-scraper.js
const AutonomousResearchOrchestrator = require('./autonomous-research-orchestrator');
const { pool } = require('./database');

class ContinuousScraper {
    constructor() {
        this.orchestrator = new AutonomousResearchOrchestrator(pool, {
            autoDownloadDocuments: true,
            autoUploadDocuments: false, // Don't auto-upload to avoid rate limits
            minConfidenceForConfirmed: 0.85,
            serverUrl: process.env.SERVER_URL || 'http://localhost:3000'
        });
        
        this.isRunning = false;
        this.pollInterval = 30000; // 30 seconds
    }
    
    async start() {
        console.log('🤖 Starting continuous scraper...');
        this.isRunning = true;
        
        while (this.isRunning) {
            try {
                await this.processNextURL();
                await this.sleep(this.pollInterval);
            } catch (error) {
                console.error('Error in main loop:', error);
                await this.sleep(60000); // Wait 1 minute on error
            }
        }
    }
    
    async processNextURL() {
        // Get next URL from queue
        const result = await pool.query(`
            SELECT queue_id, url FROM scraping_queue
            WHERE status = 'pending'
            ORDER BY priority DESC, submitted_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        `);
        
        if (result.rows.length === 0) {
            console.log('No URLs in queue. Waiting...');
            return;
        }
        
        const { queue_id, url } = result.rows[0];
        
        // Mark as processing
        await pool.query(`
            UPDATE scraping_queue
            SET status = 'processing', started_at = CURRENT_TIMESTAMP
            WHERE queue_id = $1
        `, [queue_id]);
        
        console.log(`\n📍 Processing: ${url}`);
        
        try {
            // Run the autonomous agent
            const results = await this.orchestrator.processURL(url);
            
            // Update queue record
            await pool.query(`
                UPDATE scraping_queue
                SET status = 'completed',
                    completed_at = CURRENT_TIMESTAMP,
                    session_id = $1,
                    persons_found = $2
                WHERE queue_id = $3
            `, [results.sessionId, results.personsAdded.unconfirmed, queue_id]);
            
            console.log(`✅ Completed: ${results.personsAdded.unconfirmed} persons found`);
            
            // Check for duplicates
            await this.detectDuplicates(results.sessionId);
            
        } catch (error) {
            console.error(`❌ Failed:`, error.message);
            
            await pool.query(`
                UPDATE scraping_queue
                SET status = 'failed',
                    completed_at = CURRENT_TIMESTAMP,
                    error_message = $1
                WHERE queue_id = $2
            `, [error.message, queue_id]);
        }
    }
    
    async detectDuplicates(sessionId) {
        // Get newly added persons from this session
        const newPersons = await pool.query(`
            SELECT lead_id, full_name, birth_year, death_year, locations
            FROM unconfirmed_persons
            WHERE source_url IN (
                SELECT target_url FROM scraping_sessions WHERE session_id = $1
            )
        `, [sessionId]);
        
        for (const newPerson of newPersons.rows) {
            // Find potential duplicates using fuzzy name matching
            const potentialDupes = await pool.query(`
                SELECT lead_id, full_name, birth_year, death_year
                FROM unconfirmed_persons
                WHERE lead_id != $1
                  AND person_type = $2
                  AND similarity(full_name, $3) > 0.7
                  AND (
                      birth_year IS NULL OR $4 IS NULL OR ABS(birth_year - $4) <= 2
                  )
                  AND status NOT IN ('rejected', 'duplicate')
                LIMIT 10
            `, [newPerson.lead_id, newPerson.person_type, newPerson.full_name, newPerson.birth_year]);
            
            // Save duplicate suggestions
            for (const dupe of potentialDupes.rows) {
                await pool.query(`
                    INSERT INTO person_duplicates (
                        lead_id_1, lead_id_2, name_similarity, merge_confidence
                    ) VALUES ($1, $2, $3, $4)
                    ON CONFLICT DO NOTHING
                `, [
                    newPerson.lead_id,
                    dupe.lead_id,
                    this.nameSimilarity(newPerson.full_name, dupe.full_name),
                    0.8
                ]);
            }
        }
    }
    
    nameSimilarity(name1, name2) {
        // Simple Levenshtein-based similarity
        // In production, use a proper library like 'natural' or 'string-similarity'
        return 0.85; // Placeholder
    }
    
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    stop() {
        console.log('Stopping continuous scraper...');
        this.isRunning = false;
    }
}

// Run if executed directly
if (require.main === module) {
    const scraper = new ContinuousScraper();
    scraper.start();
    
    // Graceful shutdown
    process.on('SIGINT', () => {
        scraper.stop();
        process.exit(0);
    });
}

module.exports = ContinuousScraper;
```

---

## 🔄 Duplicate Person Management

### Detection Algorithm

```javascript
async findDuplicates(person) {
    // 1. Exact name match
    let candidates = await this.findByExactName(person.fullName);
    
    // 2. Fuzzy name match (handle spelling variations)
    candidates = [...candidates, ...await this.findByFuzzyName(person.fullName)];
    
    // 3. Filter by date ranges
    candidates = candidates.filter(c => 
        this.dateRangesOverlap(person.birthYear, person.deathYear, c.birthYear, c.deathYear)
    );
    
    // 4. Check location overlap
    candidates = candidates.filter(c =>
        this.locationsOverlap(person.locations, c.locations)
    );
    
    return candidates;
}
```

### Name Variations to Handle

Common spelling variations for enslaved people:
- Missing surnames
- Phonetic variations (Harry/Hairy, Caesar/Cesar)
- Shortened names (Elizabeth/Eliza/Liza/Betty)
- Multiple surnames (ownership changes)

---

## 🔐 Login-Protected Sites (FamilySearch, Ancestry)

### Solution 1: Screenshot Upload

```javascript
// Add to server.js
app.post('/api/process-screenshot', upload.single('screenshot'), async (req, res) => {
    const { sourceUrl, submittedBy } = req.body;
    const screenshotPath = req.file.path;
    
    try {
        // Use OCR (Google Vision API or Tesseract)
        const text = await performOCR(screenshotPath);
        
        // Extract persons using ML
        const extractor = new GenealogyEntityExtractor();
        const results = await extractor.extractPersons(text, sourceUrl);
        
        // Save to unconfirmed_persons
        for (const person of results.persons) {
            await saveToUnconfirmed(person, sourceUrl, 'screenshot');
        }
        
        res.json({ success: true, personsFound: results.persons.length });
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
```

### Solution 2: HTML Source Upload

```javascript
app.post('/api/process-html-source', async (req, res) => {
    const { htmlSource, sourceUrl, submittedBy } = req.body;
    
    try {
        // Parse HTML with Cheerio
        const $ = cheerio.load(htmlSource);
        
        // Extract text content
        const text = $('body').text();
        
        // Extract persons
        const extractor = new GenealogyEntityExtractor();
        const results = await extractor.extractPersons(text, sourceUrl);
        
        // Save to unconfirmed_persons
        for (const person of results.persons) {
            await saveToUnconfirmed(person, sourceUrl, 'html_upload');
        }
        
        res.json({ success: true, personsFound: results.persons.length });
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
```

---

## 📊 Running the System

### Start the Background Worker

```bash
# Terminal 1: Run the web server
npm start

# Terminal 2: Run the continuous scraper
node continuous-scraper.js
```

### Or use PM2 for production:

```bash
npm install -g pm2

# Start both processes
pm2 start server.js --name "reparations-server"
pm2 start continuous-scraper.js --name "continuous-scraper"

# View logs
pm2 logs

# Stop
pm2 stop all
```

---

## ✅ Next Steps

1. **Implement scraping_queue table** in database
2. **Create public submission form** in index.html
3. **Build continuous-scraper.js** worker
4. **Implement duplicate detection** with person_identifiers
5. **Add screenshot/HTML upload** endpoints
6. **Deploy background worker** with PM2
7. **Monitor queue** and adjust poll interval
8. **Review duplicate suggestions** weekly
