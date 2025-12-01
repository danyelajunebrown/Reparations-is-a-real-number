#!/usr/bin/env node
/**
 * Multi-Source Historical Records Scraper Framework
 *
 * Extensible framework for scraping historical records from multiple sources:
 * - Beyond Kin Enslaved Populations Directory
 * - Civil War DC Compensated Emancipation Claims
 * - FamilySearch (with API integration)
 * - Ancestry (HTML uploads)
 * - And more...
 *
 * Usage:
 *   node multi-source-scraper.js beyondkin                    # Scrape all Beyond Kin
 *   node multi-source-scraper.js civilwar                     # Scrape Civil War DC
 *   node multi-source-scraper.js beyondkin --max-pages 10     # Limit pages
 *   node multi-source-scraper.js all --dry-run                # Test all sources
 */

const axios = require('axios');
const cheerio = require('cheerio');
const database = require('./database');

/**
 * Base Scraper Class
 * Extend this for each historical records source
 */
class BaseScraper {
  constructor(name, options = {}) {
    this.name = name;
    this.options = options;
    this.stats = {
      recordsFound: 0,
      recordsSubmitted: 0,
      recordsSkipped: 0,
      errors: 0
    };
  }

  /**
   * Main scraping method - override in subclasses
   */
  async scrape() {
    throw new Error('scrape() must be implemented by subclass');
  }

  /**
   * Submit a URL to the scraping queue
   */
  async submitToQueue(url, category, metadata = {}) {
    try {
      // Check if already in queue
      const existing = await database.query(
        `SELECT id, status FROM scraping_queue WHERE url = $1 LIMIT 1`,
        [url]
      );

      if (existing.rows.length > 0) {
        const status = existing.rows[0].status;
        if (status === 'completed') {
          console.log(`⏭️  Already processed: ${url}`);
          this.stats.recordsSkipped++;
          return false;
        } else if (status === 'pending' || status === 'processing') {
          console.log(`⏭️  Already in queue (${status}): ${url}`);
          this.stats.recordsSkipped++;
          return false;
        }
      }

      // Insert into queue
      const priority = metadata.priority || (category === 'beyondkin' ? 10 : 5);

      await database.query(
        `INSERT INTO scraping_queue (url, category, submitted_by, status, priority, metadata)
         VALUES ($1, $2, $3, 'pending', $4, $5)
         ON CONFLICT (url, status) DO NOTHING
         RETURNING id`,
        [url, category, `${this.name}-scraper`, priority, JSON.stringify(metadata)]
      );

      console.log(`✅ Queued: ${url}`);
      this.stats.recordsSubmitted++;
      return true;

    } catch (error) {
      console.error(`❌ Failed to queue ${url}:`, error.message);
      this.stats.errors++;
      return false;
    }
  }

  /**
   * Fetch a URL with retry logic
   */
  async fetchUrl(url, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await axios.get(url, {
          timeout: 30000,
          headers: {
            'User-Agent': `Historical Records Scraper (${this.name})`
          }
        });
        return response.data;
      } catch (error) {
        if (attempt === retries) {
          throw error;
        }
        console.log(`⚠️  Attempt ${attempt} failed, retrying...`);
        await this.sleep(2000 * attempt);
      }
    }
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Print statistics
   */
  printStats() {
    console.log('\n📊 STATISTICS');
    console.log('-------------');
    console.log(`Source:             ${this.name}`);
    console.log(`Records found:      ${this.stats.recordsFound}`);
    console.log(`Records submitted:  ${this.stats.recordsSubmitted}`);
    console.log(`Records skipped:    ${this.stats.recordsSkipped}`);
    console.log(`Errors:             ${this.stats.errors}`);
  }
}

/**
 * Beyond Kin Scraper
 */
class BeyondKinScraper extends BaseScraper {
  constructor(options = {}) {
    super('BeyondKin', options);
    this.baseUrl = 'https://beyondkin.org/enslaved-populations-research-directory/';
    this.recordsPerPage = 50;
    this.totalRecords = 2461;
    this.totalPages = Math.ceil(this.totalRecords / this.recordsPerPage);
    this.startPage = options.startPage || 1;
    this.maxPages = options.maxPages || this.totalPages;
  }

  async scrape() {
    console.log(`\n🌟 Scraping Beyond Kin Directory`);
    console.log(`   Total records: ${this.totalRecords}`);
    console.log(`   Pages: ${this.startPage} to ${Math.min(this.startPage + this.maxPages - 1, this.totalPages)}\n`);

    const endPage = Math.min(this.startPage + this.maxPages - 1, this.totalPages);

    for (let page = this.startPage; page <= endPage; page++) {
      await this.scrapePage(page);

      if (page < endPage) {
        await this.sleep(this.options.delayMs || 2000);
      }
    }
  }

  async scrapePage(pageNum) {
    const url = pageNum === 1
      ? this.baseUrl
      : `${this.baseUrl}?listpage=${pageNum}`;

    console.log(`📄 Page ${pageNum}/${this.totalPages}: ${url}`);

    try {
      const html = await this.fetchUrl(url);
      const $ = cheerio.load(html);

      $('a').each((i, elem) => {
        const href = $(elem).attr('href');
        if (href && href.includes('enslaved-population-research-view-details/?pdb=')) {
          const match = href.match(/pdb=(\d+)/);
          if (match) {
            const recordId = match[1];
            const fullUrl = href.startsWith('http')
              ? href
              : `https://beyondkin.org/enslaved-population-research-view-details/?pdb=${recordId}`;

            this.stats.recordsFound++;

            if (!this.options.dryRun) {
              this.submitToQueue(fullUrl, 'beyondkin', { recordId, source: 'directory' });
            }
          }
        }
      });

    } catch (error) {
      console.error(`❌ Failed to scrape page ${pageNum}:`, error.message);
      this.stats.errors++;
    }
  }
}

/**
 * Civil War DC Emancipation Claims Scraper
 */
class CivilWarDCScraper extends BaseScraper {
  constructor(options = {}) {
    super('CivilWarDC', options);
    this.baseUrl = 'https://civilwardc.org/texts/petitions/';
    this.startPage = options.startPage || 1;
    this.maxPages = options.maxPages || 100; // Estimate
  }

  async scrape() {
    console.log(`\n📜 Scraping Civil War DC Compensated Emancipation Claims`);
    console.log(`   URL: ${this.baseUrl}\n`);

    try {
      // First, fetch the index page to find all petition links
      const html = await this.fetchUrl(this.baseUrl);
      const $ = cheerio.load(html);

      // Look for petition links
      // The structure may vary, but typically links to individual petitions
      $('a').each((i, elem) => {
        const href = $(elem).attr('href');
        const text = $(elem).text().trim();

        if (href && (
          href.includes('/petition/') ||
          href.includes('cwdoc') ||
          text.match(/petition|claim|case/i)
        )) {
          const fullUrl = href.startsWith('http')
            ? href
            : `https://civilwardc.org${href.startsWith('/') ? '' : '/'}${href}`;

          // Filter out navigation links
          if (!href.includes('#') && !href.includes('javascript:')) {
            this.stats.recordsFound++;

            if (!this.options.dryRun) {
              this.submitToQueue(fullUrl, 'civilwar', { source: 'petition' });
            }
          }
        }
      });

      console.log(`✅ Found ${this.stats.recordsFound} petition records`);

    } catch (error) {
      console.error(`❌ Failed to scrape Civil War DC:`, error.message);
      this.stats.errors++;
    }
  }
}

/**
 * FamilySearch Scraper (Placeholder - requires API)
 */
class FamilySearchScraper extends BaseScraper {
  constructor(options = {}) {
    super('FamilySearch', options);
    this.apiKey = process.env.FAMILYSEARCH_API_KEY;
  }

  async scrape() {
    console.log(`\n👨‍👩‍👧‍👦 FamilySearch Scraper`);

    if (!this.apiKey) {
      console.log(`⚠️  FamilySearch API key not configured`);
      console.log(`   Set FAMILYSEARCH_API_KEY environment variable`);
      console.log(`   See: https://www.familysearch.org/developers/`);
      return;
    }

    console.log(`✅ API key configured - ready to scrape FamilySearch records`);
    console.log(`   (Implementation pending API integration)`);

    // TODO: Implement FamilySearch API integration
    // - Search for records matching specific criteria
    // - Extract person records
    // - Submit to queue
  }
}

/**
 * Generic URL List Scraper
 * For manually curated lists of URLs
 */
class URLListScraper extends BaseScraper {
  constructor(urls, category, options = {}) {
    super('URLList', options);
    this.urls = urls;
    this.category = category;
  }

  async scrape() {
    console.log(`\n📋 Scraping URL List`);
    console.log(`   Count: ${this.urls.length}`);
    console.log(`   Category: ${this.category}\n`);

    for (const url of this.urls) {
      this.stats.recordsFound++;

      if (!this.options.dryRun) {
        await this.submitToQueue(url, this.category, { source: 'manual-list' });
        await this.sleep(this.options.delayMs || 500);
      } else {
        console.log(`🧪 Would submit: ${url}`);
      }
    }
  }
}

// ========================================
// CLI Entry Point
// ========================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help') {
    console.log(`
Multi-Source Historical Records Scraper
=======================================

Usage:
  node multi-source-scraper.js <source> [options]

Sources:
  beyondkin      Beyond Kin Enslaved Populations Directory
  civilwar       Civil War DC Compensated Emancipation Claims
  familysearch   FamilySearch (requires API key)
  all            All available sources

Options:
  --start-page N     Start from page N
  --max-pages N      Only scrape N pages
  --dry-run          Test mode - don't submit records
  --delay MS         Delay between requests in ms

Examples:
  node multi-source-scraper.js beyondkin
  node multi-source-scraper.js civilwar --dry-run
  node multi-source-scraper.js beyondkin --max-pages 10
  node multi-source-scraper.js all
    `);
    process.exit(0);
  }

  const source = args[0];
  const options = {
    startPage: 1,
    maxPages: 9999,
    dryRun: false,
    delayMs: 2000
  };

  // Parse options
  for (let i = 1; i < args.length; i++) {
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
    }
  }

  console.log('🤖 Multi-Source Historical Records Scraper');
  console.log('==========================================\n');

  const scrapers = [];

  if (source === 'beyondkin' || source === 'all') {
    scrapers.push(new BeyondKinScraper(options));
  }

  if (source === 'civilwar' || source === 'all') {
    scrapers.push(new CivilWarDCScraper(options));
  }

  if (source === 'familysearch' || source === 'all') {
    scrapers.push(new FamilySearchScraper(options));
  }

  if (scrapers.length === 0) {
    console.error(`❌ Unknown source: ${source}`);
    console.log(`   Valid sources: beyondkin, civilwar, familysearch, all`);
    process.exit(1);
  }

  // Run all scrapers
  for (const scraper of scrapers) {
    try {
      await scraper.scrape();
      scraper.printStats();
      console.log();
    } catch (error) {
      console.error(`❌ Error running ${scraper.name} scraper:`, error);
    }

    // Delay between different scrapers
    if (scrapers.length > 1) {
      await scraper.sleep(3000);
    }
  }

  console.log('✨ All scrapers completed!\n');
  console.log('Run continuous-scraper.js to process the queued records.\n');
  process.exit(0);
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = {
  BaseScraper,
  BeyondKinScraper,
  CivilWarDCScraper,
  FamilySearchScraper,
  URLListScraper
};
