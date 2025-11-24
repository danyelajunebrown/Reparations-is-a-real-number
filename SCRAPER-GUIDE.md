# Web Scraper Guide

## Overview

The Reparations Platform now includes powerful web scrapers that can automatically crawl and process thousands of historical records from multiple sources. This eliminates the need for manual URL submission.

## What's New

### ✅ Fixed Rate Limiting Issues

The 429 (Too Many Requests) errors have been fixed:

- **Upload limit increased**: 10 → **200 submissions per 15 minutes**
- **Queue processing limit**: 5 per 15 min → **50 per 5 minutes**
- **Stats polling**: Now handles frequent requests without errors

You can now submit 100+ URLs without hitting rate limits!

### 🌟 New Automated Scrapers

#### 1. Beyond Kin Scraper (`beyond-kin-scraper.js`)

Automatically crawls all 2,461 records from the Beyond Kin Enslaved Populations Research Directory.

**Features:**
- Crawls all 50 pages automatically
- Extracts individual record URLs
- Submits to queue with high priority
- Progress tracking and resumption
- Handles errors and retries

**Usage:**

```bash
# Scrape all Beyond Kin records (recommended)
node beyond-kin-scraper.js

# Test with dry run (doesn't submit, just shows what would happen)
node beyond-kin-scraper.js --dry-run

# Scrape first 10 pages only
node beyond-kin-scraper.js --max-pages 10

# Resume from page 25
node beyond-kin-scraper.js --start-page 25

# Adjust delay between requests (default: 2000ms)
node beyond-kin-scraper.js --delay 3000
```

**Expected Output:**
```
🌟 Beyond Kin Directory Scraper
================================

📊 Total records: 2461
📄 Total pages: 50
🚀 Starting from page: 1
✅ LIVE MODE - Records will be submitted

============================================================
📄 Processing page 1/50
============================================================

🔍 Fetching: https://beyondkin.org/enslaved-populations-research-directory/
✅ Found 50 records on this page
📦 Submitting batch of 50 records to queue...
✅ Record 659 added to queue
✅ Record 592 added to queue
...
```

#### 2. Multi-Source Scraper (`multi-source-scraper.js`)

Extensible framework for scraping multiple historical record sources.

**Supported Sources:**
- ✅ **Beyond Kin** - Enslaved Populations Research Directory
- ✅ **Civil War DC** - Compensated Emancipation Claims
- 🚧 **FamilySearch** - Ready for API integration (requires API key)
- 🔄 **Custom URL Lists** - Bulk import from files

**Usage:**

```bash
# Scrape Beyond Kin
node multi-source-scraper.js beyondkin

# Scrape Civil War DC records
node multi-source-scraper.js civilwar

# Scrape all available sources
node multi-source-scraper.js all

# Test mode (dry run)
node multi-source-scraper.js beyondkin --dry-run --max-pages 5

# With custom options
node multi-source-scraper.js civilwar --delay 3000 --dry-run
```

## Complete Workflow

### Option 1: Automated Scraping (Recommended)

**Step 1: Run the scraper**
```bash
node beyond-kin-scraper.js
```
This will take ~10-15 minutes to crawl all 50 pages and submit 2,461 records to the queue.

**Step 2: Process the queue**
```bash
node continuous-scraper.js
```
This background worker will automatically process all queued URLs, extracting data and saving to the database.

**Step 3: Monitor progress**
- Open `contribute.html` in your browser
- Watch the "URLs Waiting" counter decrease
- See "Persons Found (24h)" and "Documents Found (24h)" increase

### Option 2: Manual Submission (Still Works)

The contribute page still works for individual submissions:

1. Go to `contribute.html`
2. Enter URL
3. Select category (choose "Beyond Kin Project" for high priority)
4. Submit
5. Repeat (now supports 200+ submissions without hitting rate limits)

### Option 3: Bulk API Submission

For programmatic bulk submissions:

```bash
curl -X POST https://reparations-platform.onrender.com/api/submit-url \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://beyondkin.org/enslaved-population-research-view-details/?pdb=100",
    "category": "beyondkin",
    "submittedBy": "your-name"
  }'
```

## Adding New Sources

The scraper framework is extensible. To add a new source:

### Example: Adding a New Source

```javascript
// In multi-source-scraper.js

class MyNewSourceScraper extends BaseScraper {
  constructor(options = {}) {
    super('MySource', options);
    this.baseUrl = 'https://example.com/records/';
  }

  async scrape() {
    console.log(`\n📚 Scraping My New Source\n`);

    // Fetch the index page
    const html = await this.fetchUrl(this.baseUrl);
    const $ = cheerio.load(html);

    // Find all record links
    $('a.record-link').each((i, elem) => {
      const url = $(elem).attr('href');
      const fullUrl = new URL(url, this.baseUrl).href;

      this.stats.recordsFound++;

      if (!this.options.dryRun) {
        this.submitToQueue(fullUrl, 'mynewsource', {
          source: 'index',
          priority: 5
        });
      }
    });
  }
}

// Add to main() function:
if (source === 'mynewsource' || source === 'all') {
  scrapers.push(new MyNewSourceScraper(options));
}
```

## Database Tables

All scraped URLs are stored in the `scraping_queue` table:

```sql
SELECT
  id,
  url,
  category,
  status,           -- pending, processing, completed, failed
  priority,         -- 10=high (Beyond Kin), 5=normal
  submitted_by,
  submitted_at,
  processing_started_at,
  processing_completed_at,
  retry_count,
  error_message
FROM scraping_queue
ORDER BY priority DESC, submitted_at ASC;
```

**Useful Queries:**

```sql
-- Check queue status
SELECT status, COUNT(*) FROM scraping_queue GROUP BY status;

-- See pending URLs
SELECT * FROM scraping_queue WHERE status = 'pending' LIMIT 10;

-- See errors
SELECT url, error_message FROM scraping_queue WHERE status = 'failed';

-- Reset failed records for retry
UPDATE scraping_queue SET status = 'pending', retry_count = 0 WHERE status = 'failed';
```

## Performance

### Beyond Kin Scraper
- **Total records**: 2,461
- **Pages**: 50 (50 records per page)
- **Scraping time**: ~10-15 minutes (with 2-second delays)
- **Processing time**: ~20-30 hours (depends on record complexity)

### Processing Queue
- **Throughput**: ~3-5 records per minute (continuous-scraper.js)
- **Concurrent processing**: 1 at a time (prevents overload)
- **Retry logic**: 3 attempts per URL before marking as failed

### Scaling Up
To process faster, run multiple workers:

```bash
# Terminal 1
node continuous-scraper.js

# Terminal 2 (if your server can handle it)
node continuous-scraper.js

# Or use PM2 for process management
pm2 start continuous-scraper.js -i 3  # 3 workers
```

## Troubleshooting

### "Too many requests" errors

✅ **FIXED!** Rate limits have been increased:
- 200 submissions per 15 minutes (was 10)
- 50 queue triggers per 5 minutes (was 5 per 15 min)

If you still see errors, wait 15 minutes or adjust the `--delay` parameter.

### Database connection errors

Make sure PostgreSQL is running and `DATABASE_URL` is set:

```bash
# Check connection
psql $DATABASE_URL -c "SELECT COUNT(*) FROM scraping_queue;"

# Or with individual env vars
psql -h $POSTGRES_HOST -U $POSTGRES_USER -d $POSTGRES_DB
```

### Scraper hanging or timing out

Increase timeout in the scraper code:

```javascript
// In beyond-kin-scraper.js or multi-source-scraper.js
const response = await axios.get(url, {
  timeout: 60000,  // Increase from 30000 to 60000 (60 seconds)
  headers: { 'User-Agent': '...' }
});
```

### Queue not processing

1. Check if `continuous-scraper.js` is running:
   ```bash
   ps aux | grep continuous-scraper
   ```

2. Check for stuck "processing" records:
   ```sql
   SELECT * FROM scraping_queue
   WHERE status = 'processing'
   AND processing_started_at < NOW() - INTERVAL '1 hour';

   -- Reset them
   UPDATE scraping_queue
   SET status = 'pending'
   WHERE status = 'processing'
   AND processing_started_at < NOW() - INTERVAL '1 hour';
   ```

3. Start the continuous scraper:
   ```bash
   node continuous-scraper.js
   ```

## Next Steps

### 1. FamilySearch Integration

The scraper framework is ready for FamilySearch, but requires API credentials:

1. Register at https://www.familysearch.org/developers/
2. Get your API key
3. Set environment variable:
   ```bash
   export FAMILYSEARCH_API_KEY=your_key_here
   ```
4. Run:
   ```bash
   node multi-source-scraper.js familysearch
   ```

### 2. Civil War DC Integration

Ready to scrape compensated emancipation claims:

```bash
node multi-source-scraper.js civilwar
```

### 3. Custom URL Lists

Have a list of URLs? Create a file and import:

```javascript
// bulk-import.js
const { URLListScraper } = require('./multi-source-scraper');

const urls = [
  'https://en.wikipedia.org/wiki/Thomas_Jefferson',
  'https://en.wikipedia.org/wiki/George_Washington',
  // ... more URLs
];

const scraper = new URLListScraper(urls, 'wikipedia', { dryRun: false });
scraper.scrape().then(() => scraper.printStats());
```

```bash
node bulk-import.js
```

## Best Practices

1. **Always test with `--dry-run` first** to see what will happen
2. **Use `--max-pages` for testing** to limit scope
3. **Monitor the queue** using `contribute.html` or database queries
4. **Run continuous-scraper.js in the background** using PM2 or screen
5. **Be respectful** of source sites - use appropriate delays (2-3 seconds)
6. **Check logs regularly** for errors or issues
7. **Back up your database** before running large scrapes

## Summary

You now have powerful automated scrapers that can:
- ✅ Crawl all 2,461 Beyond Kin records automatically
- ✅ Process Civil War DC emancipation claims
- ✅ Submit 200+ URLs per session without rate limits
- ✅ Track progress and resume if interrupted
- ✅ Extend to new sources easily

**No more manual one-by-one submissions!** Just run the scraper and let it work.

---

**Questions or Issues?**
Check the code comments in `beyond-kin-scraper.js` and `multi-source-scraper.js` for detailed documentation.
