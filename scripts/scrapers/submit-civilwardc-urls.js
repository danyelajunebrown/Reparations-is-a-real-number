#!/usr/bin/env node
/**
 * Civil War DC Compensation Petitions URL Submitter
 *
 * Crawls https://civilwardc.org/texts/petitions/ index page
 * Finds all ~1,100 petition URLs
 * Submits them to the universal scraping queue
 *
 * The continuous scraper will then process them automatically!
 *
 * Usage:
 *   node submit-civilwardc-urls.js
 *   node submit-civilwardc-urls.js --dry-run  # Test without submitting
 */

const axios = require('axios');
const cheerio = require('cheerio');
const database = require('./database');
const { queryWithRetry } = require('./database-utils');

const INDEX_URL = 'https://civilwardc.org/texts/petitions/index.html';
const BASE_URL = 'https://civilwardc.org/texts/petitions/';

class CivilWarDCSubmitter {
    constructor(options = {}) {
        this.dryRun = options.dryRun || false;
        this.stats = {
            urlsFound: 0,
            urlsSubmitted: 0,
            urlsSkipped: 0,
            errors: 0
        };
    }

    async run() {
        console.log('🇺🇸 Civil War DC Compensation Petitions URL Submitter');
        console.log('='.repeat(60));
        console.log(`📄 Index URL: ${INDEX_URL}`);
        console.log(`${this.dryRun ? '🧪 DRY RUN MODE - No submissions will be made' : '✅ LIVE MODE - URLs will be submitted to queue'}\n`);

        try {
            // Step 1: Fetch index page
            console.log('📡 Fetching petition index page...');
            const response = await axios.get(INDEX_URL, {
                timeout: 30000,
                headers: {
                    'User-Agent': 'Reparations Research Bot (Genealogy Research)'
                }
            });

            // Step 2: Parse HTML and extract petition URLs
            console.log('🔍 Parsing HTML for petition URLs...');
            const $ = cheerio.load(response.data);
            const urls = [];

            // Find all links that match petition pattern: cww.XXXXX.html
            $('a[href]').each((i, elem) => {
                const href = $(elem).attr('href');
                if (href && href.match(/cww\.\d+\.html$/)) {
                    // Convert relative URL to absolute
                    const fullUrl = href.startsWith('http')
                        ? href
                        : `${BASE_URL}${href}`;

                    urls.push({
                        url: fullUrl,
                        id: href.match(/cww\.(\d+)\.html$/)[1],
                        text: $(elem).text().trim()
                    });
                }
            });

            this.stats.urlsFound = urls.length;
            console.log(`✓ Found ${urls.length} petition URLs\n`);

            if (urls.length === 0) {
                console.log('⚠️  No petition URLs found! Check if page structure has changed.');
                return;
            }

            // Show sample URLs
            console.log('📋 Sample petition URLs:');
            urls.slice(0, 5).forEach(u => {
                console.log(`   • ${u.text}`);
                console.log(`     ${u.url}`);
            });
            if (urls.length > 5) {
                console.log(`   ... and ${urls.length - 5} more\n`);
            }

            if (this.dryRun) {
                console.log('\n🧪 DRY RUN - Would submit', urls.length, 'URLs to scraping queue');
                return;
            }

            // Step 3: Submit to scraping queue
            console.log('\n📤 Submitting to universal scraping queue...');

            for (let i = 0; i < urls.length; i++) {
                const petition = urls[i];

                try {
                    // Check if already in queue
                    const existing = await queryWithRetry(database, `
                        SELECT id, status FROM scraping_queue
                        WHERE url = $1
                        LIMIT 1
                    `, [petition.url]);

                    if (existing.rows.length > 0) {
                        const status = existing.rows[0].status;
                        if (status === 'completed') {
                            console.log(`   ⏭️  #${petition.id}: Already processed`);
                            this.stats.urlsSkipped++;
                            continue;
                        } else if (status === 'pending' || status === 'processing') {
                            console.log(`   ⏭️  #${petition.id}: Already in queue (${status})`);
                            this.stats.urlsSkipped++;
                            continue;
                        }
                    }

                    // Insert into queue
                    await queryWithRetry(database, `
                        INSERT INTO scraping_queue (url, category, priority, submitted_by, metadata)
                        VALUES ($1, 'civilwardc', 10, 'civilwardc-submitter', $2::jsonb)
                        ON CONFLICT (url, status) DO NOTHING
                    `, [petition.url, JSON.stringify({ petitionId: petition.id, title: petition.text })]);

                    this.stats.urlsSubmitted++;

                    // Progress update every 100 URLs
                    if ((i + 1) % 100 === 0) {
                        console.log(`   ✓ Submitted ${i + 1}/${urls.length} (${((i + 1) / urls.length * 100).toFixed(1)}%)`);
                    }

                } catch (error) {
                    console.error(`   ✗ Error submitting #${petition.id}:`, error.message);
                    this.stats.errors++;
                }
            }

            console.log('\n' + '='.repeat(60));
            console.log('✅ SUBMISSION COMPLETE');
            console.log('='.repeat(60));
            this.printStats();

            console.log('\n📊 Next Steps:');
            console.log('   1. The continuous scraper will process these URLs automatically');
            console.log('   2. Check progress: SELECT * FROM scraping_queue WHERE category = \'civilwardc\'');
            console.log('   3. Review auto-promoted: SELECT * FROM confirming_documents_auto_promoted');
            console.log('   4. Human review queue: SELECT * FROM confirming_documents_review_queue');

        } catch (error) {
            console.error('\n❌ FATAL ERROR:', error.message);
            console.error(error.stack);
            process.exit(1);
        }
    }

    printStats() {
        console.log(`URLs Found:     ${this.stats.urlsFound}`);
        console.log(`URLs Submitted: ${this.stats.urlsSubmitted}`);
        console.log(`URLs Skipped:   ${this.stats.urlsSkipped}`);
        console.log(`Errors:         ${this.stats.errors}`);
    }
}

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

// Run the submitter
const submitter = new CivilWarDCSubmitter({ dryRun });
submitter.run()
    .then(() => {
        console.log('\n✓ Process complete');
        process.exit(0);
    })
    .catch(error => {
        console.error('\n💥 Fatal error:', error);
        process.exit(1);
    });
