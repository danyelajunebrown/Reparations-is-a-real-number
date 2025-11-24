# Quick Start: Automated Scraping

## ✅ All Fixed!

### Problems Solved
1. **429 Rate Limit Errors** - FIXED
   - Upload limit: 10 → **200 per 15 minutes**
   - Queue trigger: 5 per 15 min → **50 per 5 minutes**
   - You can now submit 100+ URLs without errors!

2. **Manual One-by-One Submissions** - AUTOMATED
   - Built Beyond Kin scraper for all 2,461 records
   - Built multi-source framework for FamilySearch, Civil War DC, etc.

### Your Database Status
- ✅ Queue: **57 URLs** (6 pending, 49 completed, 2 failed)
- ✅ Sessions: **62 scraping sessions**
- ✅ Persons found (24h): **1,154**
- ✅ Sessions (24h): **10**

## 🚀 Run the Scrapers Now

### Option 1: Beyond Kin (All 2,461 Records)
```bash
# Start scraping Beyond Kin directory
node beyond-kin-scraper.js

# This will:
# - Crawl all 50 pages (~10-15 minutes)
# - Find all 2,461 record URLs
# - Submit to queue automatically
# - Skip duplicates
```

### Option 2: Multi-Source Scraping
```bash
# Scrape Beyond Kin
node multi-source-scraper.js beyondkin

# Scrape Civil War DC records
node multi-source-scraper.js civilwar

# Scrape all sources
node multi-source-scraper.js all
```

### Option 3: Test First (Recommended)
```bash
# Dry run - see what would happen without submitting
node beyond-kin-scraper.js --max-pages 1 --dry-run

# Output shows:
# 🧪 DRY RUN: Would submit 50 records
#    - Record 659: https://beyondkin.org/...
#    - Record 592: https://beyondkin.org/...
#    ... and 47 more
```

## 📊 Process the Queue

After scraping, process the URLs:

```bash
# Start continuous background worker
node continuous-scraper.js

# It will:
# - Poll queue every 30 seconds
# - Process 1 URL at a time
# - Extract persons, documents, relationships
# - Mark as completed
# - Retry on failures (3 attempts)
```

## 🖥️ Monitor Progress

### Web Interface
Open `contribute.html` in browser to see:
- URLs Waiting: Live count
- Persons Found (24h): Real-time updates
- Documents Found (24h): Real-time updates

### Database Queries
```bash
# Check queue status
psql $DATABASE_URL -c "SELECT status, COUNT(*) FROM scraping_queue GROUP BY status;"

# See recent completions
psql $DATABASE_URL -c "SELECT url, status FROM scraping_queue WHERE status = 'completed' ORDER BY processing_completed_at DESC LIMIT 10;"

# Check errors
psql $DATABASE_URL -c "SELECT url, error_message FROM scraping_queue WHERE status = 'failed';"

# View statistics
psql $DATABASE_URL -c "SELECT * FROM queue_stats;"
```

## 📁 Files Created

### Scrapers
- `beyond-kin-scraper.js` - Beyond Kin directory scraper
- `multi-source-scraper.js` - Multi-source framework
- `continuous-scraper.js` - Background queue processor (already exists)
- `process-pending-urls.js` - One-time batch processor (already exists)

### Documentation
- `SCRAPER-GUIDE.md` - Complete documentation
- `QUICK-START-SCRAPING.md` - This file
- `create-scraping-tables.sql` - Database setup (already run)

### Configuration
- `middleware/rate-limit.js` - Updated rate limits (fixed)
- `database-schemas.js` - Added scraping tables
- `server.js` - Updated with moderateLimiter

## 🎯 Recommended Workflow

### 1. Start Fresh (One-Time Setup)
```bash
# Test the scraper
node beyond-kin-scraper.js --max-pages 1 --dry-run

# If it looks good, run for real
node beyond-kin-scraper.js

# Wait 10-15 minutes for all pages to be crawled
```

### 2. Start Processing
```bash
# In a separate terminal or screen/tmux session
node continuous-scraper.js

# Or use PM2 for production
pm2 start continuous-scraper.js --name "queue-worker"
pm2 logs queue-worker  # View logs
pm2 stop queue-worker   # Stop when done
```

### 3. Monitor
```bash
# Check progress every few minutes
psql $DATABASE_URL -c "SELECT * FROM queue_stats;"

# Or open contribute.html in browser
```

### 4. Review Results
```bash
# See what was found
psql $DATABASE_URL -c "
  SELECT
    i.full_name,
    i.birth_year,
    i.death_year,
    i.locations,
    i.total_documents
  FROM individuals i
  WHERE i.created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
  ORDER BY i.created_at DESC
  LIMIT 20;
"
```

## 🔧 Troubleshooting

### "Too many requests" (429 errors)
✅ **This should not happen anymore!** Limits have been increased.

If it still happens:
- Wait 15 minutes for rate limit window to reset
- Increase `--delay` parameter: `node beyond-kin-scraper.js --delay 3000`

### Connection timeouts
- Render free tier may spin down after inactivity
- First request after idle will be slow (30-60 seconds)
- Subsequent requests will be fast

### Queue stuck on "processing"
```bash
# Reset stuck entries
psql $DATABASE_URL -c "
  UPDATE scraping_queue
  SET status = 'pending'
  WHERE status = 'processing'
  AND processing_started_at < NOW() - INTERVAL '1 hour';
"
```

## 📈 Performance Expectations

### Beyond Kin Scraper
- **Scraping phase**: ~10-15 minutes (all 2,461 URLs)
- **Processing phase**: ~20-40 hours (depends on content)
- **Persons extracted**: ~10,000+ (estimate)
- **Documents found**: ~5,000+ (estimate)

### Throughput
- **Scraping**: 50 URLs per page × 2 seconds = ~3 minutes per page
- **Processing**: 3-5 records per minute (varies by complexity)
- **Database**: Can handle 1000+ records/hour

## 🌟 Next Steps

### 1. FamilySearch API
Once you get the API key:
```bash
export FAMILYSEARCH_API_KEY=your_key_here
node multi-source-scraper.js familysearch
```

### 2. Civil War DC
Ready now:
```bash
node multi-source-scraper.js civilwar
```

### 3. Custom Sources
Add your own source scrapers by extending `BaseScraper` class in `multi-source-scraper.js`

## 🎉 You're Ready!

Everything is set up and tested. Just run:

```bash
node beyond-kin-scraper.js
```

Then sit back and watch it work! 🚀

---

**Need help?** Read `SCRAPER-GUIDE.md` for detailed documentation.
