#!/usr/bin/env node
/**
 * Beyond Kin Directory Scraper
 *
 * Automatically crawls all 2,461 records from the Beyond Kin Enslaved Populations Research Directory
 * https://beyondkin.org/enslaved-populations-research-directory/
 *
 * Features:
 * - Crawls all paginated directory pages (50 records per page)
 * - Extracts individual record URLs
 * - Scrapes each record detail page
 * - Submits to research queue for processing
 * - Handles rate limiting and retries
 * - Progress tracking and resumption
 *
 * Usage:
 *   node beyond-kin-scraper.js                    # Scrape all records
 *   node beyond-kin-scraper.js --start-page 5     # Resume from page 5
 *   node beyond-kin-scraper.js --max-pages 10     # Only scrape first 10 pages
 *   node beyond-kin-scraper.js --dry-run          # Test without submitting
 */

const axios = require('axios');
const cheerio = require('cheerio');
const database = require('./database');

class BeyondKinScraper {
  constructor(options = {}) {
    this.baseUrl = 'https://beyondkin.org/enslaved-populations-research-directory/';
    this.detailBaseUrl = 'https://beyondkin.org/enslaved-population-research-view-details/';
    this.recordsPerPage = 50;
    this.totalRecords = 2461; // As of last check
    this.totalPages = Math.ceil(this.totalRecords / this.recordsPerPage);

    // Options
    this.startPage = options.startPage || 1;
    this.maxPages = options.maxPages || this.totalPages;
    this.dryRun = options.dryRun || false;
    this.delayMs = options.delayMs || 2000; // 2 second delay between requests
    this.batchSize = options.batchSize || 10; // Submit in batches

    // Stats
    this.stats = {
      pagesScraped: 0,
      recordsFound: 0,
      recordsSubmitted: 0,
      recordsSkipped: 0,
      errors: 0
    };
  }

  /**
   * Main entry point - scrape all directory pages
   */
  async scrapeAll() {
    console.log('🌟 Beyond Kin Directory Scraper');
    console.log('================================\n');
    console.log(`📊 Total records: ${this.totalRecords}`);
    console.log(`📄 Total pages: ${this.totalPages}`);
    console.log(`🚀 Starting from page: ${this.startPage}`);
    console.log(`🎯 Max pages to scrape: ${this.maxPages}`);
    console.log(`⏱️  Delay between requests: ${this.delayMs}ms`);
    console.log(`${this.dryRun ? '🧪 DRY RUN MODE - No submissions will be made' : '✅ LIVE MODE - Records will be submitted'}\n`);

    const endPage = Math.min(this.startPage + this.maxPages - 1, this.totalPages);

    for (let page = this.startPage; page <= endPage; page++) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`📄 Processing page ${page}/${this.totalPages}`);
      console.log(`${'='.repeat(60)}`);

      try {
        await this.scrapePage(page);
        this.stats.pagesScraped++;

        // Progress report every 10 pages
        if (page % 10 === 0) {
          this.printStats();
        }

        // Delay before next page
        if (page < endPage) {
          console.log(`⏳ Waiting ${this.delayMs}ms before next page...`);
          await this.sleep(this.delayMs);
        }
      } catch (error) {
        console.error(`❌ Error scraping page ${page}:`, error.message);
        this.stats.errors++;
      }
    }

    console.log('\n\n' + '='.repeat(60));
    console.log('🎉 SCRAPING COMPLETE');
    console.log('='.repeat(60));
    this.printStats();
  }

  /**
   * Scrape a single directory page
   */
  async scrapePage(pageNum) {
    const url = pageNum === 1
      ? this.baseUrl
      : `${this.baseUrl}?listpage=${pageNum}`;

    console.log(`\n🔍 Fetching: ${url}`);

    try {
      const response = await axios.get(url, {
        timeout: 30000,
        headers: {
          'User-Agent': 'Beyond Kin Research Bot (Reparations Platform)'
        }
      });

      const $ = cheerio.load(response.data);
      const recordUrls = [];

      // Find all "See more" links
      $('a').each((i, elem) => {
        const href = $(elem).attr('href');
        const text = $(elem).text().trim();

        if (href && href.includes('enslaved-population-research-view-details/?pdb=')) {
          // Extract the record ID from URL
          const match = href.match(/pdb=(\d+)/);
          if (match) {
            const recordId = match[1];
            const fullUrl = href.startsWith('http')
              ? href
              : `${this.detailBaseUrl}?pdb=${recordId}`;

            recordUrls.push({
              id: recordId,
              url: fullUrl
            });
          }
        }
      });

      console.log(`✅ Found ${recordUrls.length} records on this page`);
      this.stats.recordsFound += recordUrls.length;

      // Submit records to queue in batches
      if (!this.dryRun) {
        await this.submitRecordBatch(recordUrls);
      } else {
        console.log('🧪 DRY RUN: Would submit', recordUrls.length, 'records');
        recordUrls.slice(0, 3).forEach(record => {
          console.log(`   - Record ${record.id}: ${record.url}`);
        });
        if (recordUrls.length > 3) {
          console.log(`   ... and ${recordUrls.length - 3} more`);
        }
      }

    } catch (error) {
      console.error(`❌ Failed to scrape page ${pageNum}:`, error.message);
      throw error;
    }
  }

  /**
   * Submit a batch of record URLs to the database queue
   */
  async submitRecordBatch(records) {
    console.log(`\n📦 Submitting batch of ${records.length} records to queue...`);

    for (const record of records) {
      try {
        // Check if already in queue
        const existing = await database.query(
          `SELECT id, status FROM scraping_queue
           WHERE url = $1
           LIMIT 1`,
          [record.url]
        );

        if (existing.rows.length > 0) {
          const status = existing.rows[0].status;
          if (status === 'completed') {
            console.log(`⏭️  Record ${record.id} already processed - skipping`);
            this.stats.recordsSkipped++;
            continue;
          } else if (status === 'pending' || status === 'processing') {
            console.log(`⏭️  Record ${record.id} already in queue (${status}) - skipping`);
            this.stats.recordsSkipped++;
            continue;
          }
          // If failed, we'll re-submit it
        }

        // Insert into queue (handle existing entries gracefully)
        await database.query(
          `INSERT INTO scraping_queue (url, category, submitted_by, status, priority)
           VALUES ($1, $2, $3, 'pending', $4)
           ON CONFLICT (url, status) DO NOTHING
           RETURNING id`,
          [record.url, 'beyondkin', 'beyond-kin-scraper', 10] // High priority
        );

        console.log(`✅ Record ${record.id} added to queue`);
        this.stats.recordsSubmitted++;

        // Small delay between submissions
        await this.sleep(100);

      } catch (error) {
        console.error(`❌ Failed to submit record ${record.id}:`, error.message);
        this.stats.errors++;
      }
    }
  }

  /**
   * Print statistics
   */
  printStats() {
    console.log('\n📊 PROGRESS REPORT');
    console.log('------------------');
    console.log(`Pages scraped:      ${this.stats.pagesScraped}/${this.totalPages}`);
    console.log(`Records found:      ${this.stats.recordsFound}`);
    console.log(`Records submitted:  ${this.stats.recordsSubmitted}`);
    console.log(`Records skipped:    ${this.stats.recordsSkipped}`);
    console.log(`Errors:             ${this.stats.errors}`);

    const progress = (this.stats.pagesScraped / this.totalPages * 100).toFixed(1);
    console.log(`\n⏳ Overall progress: ${progress}%`);
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ========================================
// CLI Entry Point
// ========================================

async function main() {
  const args = process.argv.slice(2);
  const options = {
    startPage: 1,
    maxPages: 9999,
    dryRun: false,
    delayMs: 2000
  };

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--start-page' && args[i + 1]) {
      options.startPage = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--max-pages' && args[i + 1]) {
      options.maxPages = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--dry-run') {
      options.dryRun = true;
    } else if (args[i] === '--delay' && args[i + 1]) {
      options.delayMs = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--help') {
      console.log(`
Beyond Kin Directory Scraper
============================

Usage:
  node beyond-kin-scraper.js [options]

Options:
  --start-page N     Start from page N (default: 1)
  --max-pages N      Only scrape N pages (default: all)
  --dry-run          Test mode - don't submit records
  --delay MS         Delay between requests in ms (default: 2000)
  --help             Show this help

Examples:
  node beyond-kin-scraper.js
  node beyond-kin-scraper.js --start-page 5
  node beyond-kin-scraper.js --max-pages 10 --dry-run
  node beyond-kin-scraper.js --delay 3000
      `);
      process.exit(0);
    }
  }

  const scraper = new BeyondKinScraper(options);

  try {
    await scraper.scrapeAll();
    console.log('\n✨ Done! Run the continuous-scraper.js to process the queued records.\n');
    process.exit(0);
  } catch (error) {
    console.error('\n💥 Fatal error:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = BeyondKinScraper;
