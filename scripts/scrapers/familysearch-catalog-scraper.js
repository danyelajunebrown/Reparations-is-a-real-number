/**
 * FamilySearch Catalog Scraper
 *
 * Scrapes FamilySearch catalog pages that contain multiple collections,
 * with support for pre-indexed records (no OCR needed!).
 *
 * Key difference from familysearch-scraper.js:
 * - That scraper: Direct film image viewing + Google Vision OCR
 * - This scraper: Catalog navigation + indexed record extraction
 *
 * When a collection has the "sparkle" icon (indexed records), we can
 * use FamilySearch's search API to get pre-transcribed data - no OCR costs!
 *
 * Usage:
 *   # Scrape a catalog page
 *   FAMILYSEARCH_INTERACTIVE=true DATABASE_URL=postgres://... \
 *   node scripts/scrapers/familysearch-catalog-scraper.js [catalog_id_or_url]
 *
 *   # Process from queue
 *   FAMILYSEARCH_INTERACTIVE=true DATABASE_URL=postgres://... \
 *   node scripts/scrapers/familysearch-catalog-scraper.js --queue
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

// Configuration
const FAMILYSEARCH_INTERACTIVE = process.env.FAMILYSEARCH_INTERACTIVE === 'true';
const DATABASE_URL = process.env.DATABASE_URL;

// Database connection
let pool = null;

function initDatabase() {
    if (!DATABASE_URL) {
        console.log('⚠️  No DATABASE_URL - will output to console only');
        return null;
    }
    pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    return pool;
}

// Stats tracking
const stats = {
    catalogsProcessed: 0,
    collectionsFound: 0,
    indexedCollections: 0,
    recordsExtracted: 0,
    errors: [],
    startTime: null
};

/**
 * Main entry point
 */
async function main() {
    stats.startTime = Date.now();
    initDatabase();

    console.log('\n' + '='.repeat(70));
    console.log('📚 FAMILYSEARCH CATALOG SCRAPER');
    console.log('   For catalog pages with pre-indexed records');
    console.log('='.repeat(70));

    const args = process.argv.slice(2);

    if (args.includes('--queue')) {
        await processQueue();
    } else if (args.length > 0) {
        const catalogInput = args[0];
        const catalogUrl = catalogInput.startsWith('http')
            ? catalogInput
            : `https://www.familysearch.org/en/search/catalog/${catalogInput}`;
        await processCatalog(catalogUrl);
    } else {
        console.log('\nUsage:');
        console.log('  node familysearch-catalog-scraper.js <catalog_id_or_url>');
        console.log('  node familysearch-catalog-scraper.js --queue');
        process.exit(1);
    }

    printSummary();
    if (pool) await pool.end();
}

/**
 * Process catalogs from the scraping queue
 */
async function processQueue() {
    if (!pool) {
        console.error('Database required for queue processing');
        process.exit(1);
    }

    const result = await pool.query(`
        SELECT id, url, metadata
        FROM scraping_queue
        WHERE category = 'familysearch_catalog'
        AND status = 'pending'
        ORDER BY priority DESC, submitted_at ASC
    `);

    console.log(`\n📋 Found ${result.rows.length} catalog(s) in queue\n`);

    for (const row of result.rows) {
        try {
            await pool.query(
                `UPDATE scraping_queue SET status = 'processing', processing_started_at = NOW() WHERE id = $1`,
                [row.id]
            );

            await processCatalog(row.url, row.metadata);

            await pool.query(
                `UPDATE scraping_queue SET status = 'completed', processing_completed_at = NOW() WHERE id = $1`,
                [row.id]
            );

            stats.catalogsProcessed++;
        } catch (error) {
            console.error(`❌ Failed: ${row.url} - ${error.message}`);
            stats.errors.push({ url: row.url, error: error.message });

            await pool.query(
                `UPDATE scraping_queue SET status = 'failed', error_message = $2, processing_completed_at = NOW() WHERE id = $1`,
                [row.id, error.message]
            );
        }
    }
}

/**
 * Process a single catalog page
 */
async function processCatalog(catalogUrl, metadata = {}) {
    console.log(`\n📚 Processing catalog: ${catalogUrl}`);

    const browser = await puppeteer.launch({
        headless: !FAMILYSEARCH_INTERACTIVE,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--window-size=1920,1080'
        ],
        defaultViewport: { width: 1920, height: 1080 }
    });

    const page = await browser.newPage();

    try {
        // Set user agent
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Navigate to catalog
        await page.goto(catalogUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        // Check if login required
        if (page.url().includes('/auth/') || page.url().includes('/login')) {
            if (FAMILYSEARCH_INTERACTIVE) {
                console.log('\n🔐 Login required - please complete login in browser window...');
                await waitForLogin(page);
                console.log('✅ Login detected, continuing...');
                await page.goto(catalogUrl, { waitUntil: 'networkidle2', timeout: 60000 });
            } else {
                throw new Error('Login required but not in interactive mode');
            }
        }

        // Wait for content to load
        await page.waitForSelector('body', { timeout: 30000 });
        await sleep(3000); // Let dynamic content load

        // Extract catalog information
        const catalogInfo = await extractCatalogInfo(page);
        console.log(`   Title: ${catalogInfo.title}`);
        console.log(`   Collections: ${catalogInfo.collections.length}`);

        // Process each collection
        for (const collection of catalogInfo.collections) {
            console.log(`\n   📁 Collection: ${collection.title}`);
            console.log(`      Films: ${collection.filmNumbers.join(', ')}`);
            console.log(`      Has indexed records: ${collection.hasIndexedRecords ? 'YES ✨' : 'No'}`);

            stats.collectionsFound++;
            if (collection.hasIndexedRecords) {
                stats.indexedCollections++;

                // If indexed, we can use the search API
                if (collection.searchUrl) {
                    console.log(`      🔍 Extracting indexed records...`);
                    await extractIndexedRecords(page, collection);
                }
            }

            // Add individual films to queue for image processing if no indexed records
            if (!collection.hasIndexedRecords && collection.filmNumbers.length > 0) {
                await queueFilmsForProcessing(collection, catalogInfo.title);
            }
        }

        // Check for pagination
        const nextPageUrl = await getNextPageUrl(page);
        if (nextPageUrl) {
            console.log(`\n📄 Found next page, processing...`);
            await processCatalog(nextPageUrl, metadata);
        }

    } finally {
        await browser.close();
    }
}

/**
 * Wait for user to complete login
 */
async function waitForLogin(page) {
    // Wait until URL changes to indicate successful login
    return new Promise((resolve) => {
        const checkInterval = setInterval(async () => {
            const url = page.url();
            if (!url.includes('/auth/') && !url.includes('/login')) {
                clearInterval(checkInterval);
                resolve();
            }
        }, 2000);

        // Timeout after 5 minutes
        setTimeout(() => {
            clearInterval(checkInterval);
            resolve();
        }, 300000);
    });
}

/**
 * Extract catalog information from the page
 */
async function extractCatalogInfo(page) {
    return await page.evaluate(() => {
        const info = {
            title: '',
            catalogId: '',
            collections: []
        };

        // Extract title
        const titleEl = document.querySelector('h1, .catalog-title, [data-testid="title"]');
        if (titleEl) info.title = titleEl.textContent.trim();

        // Extract catalog ID from URL
        const urlMatch = window.location.href.match(/catalog\/(\d+)/);
        if (urlMatch) info.catalogId = urlMatch[1];

        // Find all collection rows in the table
        const rows = document.querySelectorAll('table tbody tr, .film-row, [data-testid="film-item"]');

        rows.forEach(row => {
            const collection = {
                title: '',
                filmNumbers: [],
                hasIndexedRecords: false,
                hasImages: false,
                imageUrl: null,
                searchUrl: null
            };

            // Get title from first column or title element
            const titleCell = row.querySelector('td:first-child, .film-title, [data-testid="film-title"]');
            if (titleCell) collection.title = titleCell.textContent.trim();

            // Look for film numbers
            const filmText = row.textContent;
            const filmMatches = filmText.match(/\d{7}/g);
            if (filmMatches) collection.filmNumbers = [...new Set(filmMatches)];

            // Check for camera icon (has images)
            const cameraIcon = row.querySelector('[data-testid="camera-icon"], .camera-icon, a[href*="/film/"]');
            if (cameraIcon) {
                collection.hasImages = true;
                collection.imageUrl = cameraIcon.href || cameraIcon.closest('a')?.href;
            }

            // Check for sparkle/document icon (has indexed records)
            const indexedIcon = row.querySelector('[data-testid="indexed-icon"], .sparkle-icon, .indexed-icon, a[href*="/search/"]');
            if (indexedIcon) {
                collection.hasIndexedRecords = true;
                collection.searchUrl = indexedIcon.href || indexedIcon.closest('a')?.href;
            }

            // Also check for "Indexed" text
            if (row.textContent.includes('Indexed') || row.textContent.includes('indexed')) {
                collection.hasIndexedRecords = true;
            }

            if (collection.title || collection.filmNumbers.length > 0) {
                info.collections.push(collection);
            }
        });

        return info;
    });
}

/**
 * Extract indexed records using FamilySearch search
 */
async function extractIndexedRecords(page, collection) {
    if (!collection.searchUrl) return;

    try {
        // Navigate to search results
        await page.goto(collection.searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await sleep(2000);

        // Extract search results
        const records = await page.evaluate(() => {
            const results = [];

            // Find all result items
            const items = document.querySelectorAll('.result-item, [data-testid="search-result"], .person-card');

            items.forEach(item => {
                const record = {
                    name: '',
                    dates: '',
                    location: '',
                    recordType: '',
                    details: {}
                };

                // Extract name
                const nameEl = item.querySelector('.result-name, .person-name, [data-testid="name"]');
                if (nameEl) record.name = nameEl.textContent.trim();

                // Extract dates
                const dateEl = item.querySelector('.result-date, .life-dates, [data-testid="dates"]');
                if (dateEl) record.dates = dateEl.textContent.trim();

                // Extract location
                const locEl = item.querySelector('.result-location, .event-place, [data-testid="location"]');
                if (locEl) record.location = locEl.textContent.trim();

                // Extract type
                const typeEl = item.querySelector('.result-type, .record-type, [data-testid="type"]');
                if (typeEl) record.recordType = typeEl.textContent.trim();

                if (record.name) results.push(record);
            });

            return results;
        });

        console.log(`      Found ${records.length} indexed records`);

        // Save to database
        for (const record of records.slice(0, 100)) { // Limit to first 100 per collection
            await saveIndexedRecord(record, collection);
            stats.recordsExtracted++;
        }

    } catch (error) {
        console.error(`      Error extracting indexed records: ${error.message}`);
    }
}

/**
 * Save an indexed record to the database
 */
async function saveIndexedRecord(record, collection) {
    if (!pool) return;

    try {
        const citation = `FamilySearch, "${collection.title}". Indexed record. ` +
                        `Films: ${collection.filmNumbers.join(', ')}. ` +
                        `URL: ${collection.searchUrl || 'N/A'}`;

        // Determine person type from context
        let personType = 'unknown';
        const lowerName = record.name.toLowerCase();
        const lowerDetails = JSON.stringify(record).toLowerCase();

        if (lowerDetails.includes('slave') || lowerDetails.includes('enslaved') ||
            lowerDetails.includes('negro') || lowerDetails.includes('colored')) {
            personType = 'enslaved';
        } else if (lowerDetails.includes('estate') || lowerDetails.includes('will') ||
                   lowerDetails.includes('probate') || lowerDetails.includes('inventory')) {
            personType = 'estate_record';
        }

        await pool.query(`
            INSERT INTO unconfirmed_persons (
                full_name,
                person_type,
                source_url,
                extraction_method,
                context_text,
                confidence_score,
                status,
                source_type,
                created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            ON CONFLICT DO NOTHING
        `, [
            record.name,
            personType,
            collection.searchUrl || '',
            'familysearch_indexed',
            `${citation}. Dates: ${record.dates}. Location: ${record.location}. Type: ${record.recordType}`,
            0.9, // High confidence for indexed records
            'pending',
            'primary'
        ]);

    } catch (error) {
        console.error(`      Error saving record: ${error.message}`);
    }
}

/**
 * Queue films for image processing (when no indexed records available)
 */
async function queueFilmsForProcessing(collection, catalogTitle) {
    if (!pool) return;

    for (const filmNumber of collection.filmNumbers) {
        const filmUrl = `https://www.familysearch.org/ark:/61903/3:1:${filmNumber}`;

        try {
            // Check if already in queue
            const exists = await pool.query('SELECT id FROM scraping_queue WHERE url = $1', [filmUrl]);

            if (exists.rows.length === 0) {
                await pool.query(`
                    INSERT INTO scraping_queue (url, category, status, priority, metadata, submitted_at, submitted_by)
                    VALUES ($1, $2, 'pending', 5, $3, NOW(), 'catalog_scraper')
                `, [
                    filmUrl,
                    'familysearch',
                    JSON.stringify({
                        film_number: filmNumber,
                        collection_title: collection.title,
                        catalog_title: catalogTitle,
                        needs_ocr: true
                    })
                ]);
                console.log(`      📥 Queued film ${filmNumber} for OCR processing`);
            }
        } catch (error) {
            console.error(`      Error queueing film: ${error.message}`);
        }
    }
}

/**
 * Get URL of next page if exists
 */
async function getNextPageUrl(page) {
    return await page.evaluate(() => {
        const nextLink = document.querySelector('a[rel="next"], .pagination-next, [data-testid="next-page"]');
        return nextLink ? nextLink.href : null;
    });
}

/**
 * Print summary
 */
function printSummary() {
    const elapsed = (Date.now() - stats.startTime) / 1000;

    console.log('\n' + '='.repeat(70));
    console.log('📊 CATALOG SCRAPING COMPLETE');
    console.log('='.repeat(70));
    console.log(`   Catalogs processed: ${stats.catalogsProcessed}`);
    console.log(`   Collections found: ${stats.collectionsFound}`);
    console.log(`   With indexed records: ${stats.indexedCollections} ✨`);
    console.log(`   Records extracted: ${stats.recordsExtracted}`);
    console.log(`   Time: ${(elapsed / 60).toFixed(2)} minutes`);

    if (stats.errors.length > 0) {
        console.log('\n⚠️  Errors:');
        stats.errors.slice(0, 5).forEach(e => console.log(`   ${e.url}: ${e.error}`));
    }

    console.log('='.repeat(70) + '\n');
}

/**
 * Sleep helper
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Run
main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
