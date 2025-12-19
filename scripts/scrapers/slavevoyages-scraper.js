/**
 * SlaveVoyages.org Scraper
 *
 * Scrapes data from the African Origins / Enslaved database into
 * our canonical_persons table.
 *
 * Data source: https://www.slavevoyages.org/past/database
 * Contains: 91,491+ named Africans from captured slave ships (1808-1862)
 * Also contains: Ship captains/enslavers from voyage records
 *
 * Usage:
 *   node scripts/scrapers/slavevoyages-scraper.js [--enslaved | --enslavers | --all]
 *   node scripts/scrapers/slavevoyages-scraper.js --test  # Test with 10 records
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

// Helper for delays (replaces deprecated waitForTimeout)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Configuration
const DATABASE_URL = process.env.DATABASE_URL;
const DATA_DIR = path.join(__dirname, '../../data/slavevoyages');

// API endpoints discovered from frontend
const API_BASE = 'https://api.slavevoyages.org';
const FRONTEND_BASE = 'https://www.slavevoyages.org';

// Database connection
let sql = null;

// Statistics
const stats = {
    recordsProcessed: 0,
    enslavedInserted: 0,
    enslaversInserted: 0,
    recordsSkipped: 0,
    errors: 0,
    startTime: Date.now()
};

// Progress tracking
let progressFile = path.join(DATA_DIR, '.slavevoyages-progress.json');

/**
 * Initialize database connection
 */
function initDatabase() {
    if (!DATABASE_URL) {
        console.log('⚠️  No DATABASE_URL - dry run mode');
        return null;
    }
    sql = neon(DATABASE_URL);
    return sql;
}

/**
 * Ensure data directory exists
 */
function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        console.log(`📁 Created data directory: ${DATA_DIR}`);
    }
}

/**
 * Load/save progress for resumable scraping
 */
function loadProgress() {
    try {
        if (fs.existsSync(progressFile)) {
            return JSON.parse(fs.readFileSync(progressFile, 'utf8'));
        }
    } catch (e) {}
    return { lastOffset: 0, totalFetched: 0 };
}

function saveProgress(progress) {
    fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2));
}

/**
 * Launch browser and intercept API authentication
 */
async function launchBrowserWithAuth() {
    console.log('🚀 Launching browser to capture API authentication...');

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    // Capture API requests to extract auth headers
    let capturedHeaders = {};
    let capturedCookies = '';

    await page.setRequestInterception(true);

    page.on('request', request => {
        const url = request.url();
        if (url.includes('api.slavevoyages.org')) {
            capturedHeaders = request.headers();
            console.log(`   📡 Captured API request: ${url.substring(0, 80)}...`);
        }
        request.continue();
    });

    // Navigate to the enslaved database page to trigger API calls
    console.log('   📄 Loading SlaveVoyages database page...');
    await page.goto(`${FRONTEND_BASE}/past/database`, {
        waitUntil: 'networkidle2',
        timeout: 60000
    });

    // Wait for API calls to happen
    await delay(5000);

    // Get cookies
    const cookies = await page.cookies();
    capturedCookies = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    // Try to trigger an actual data fetch by interacting with the page
    try {
        // Click on search or load data
        await page.evaluate(() => {
            // Trigger any data loading
            const buttons = document.querySelectorAll('button');
            buttons.forEach(b => {
                if (b.textContent.includes('Search') || b.textContent.includes('Apply')) {
                    b.click();
                }
            });
        });
        await delay(3000);
    } catch (e) {
        console.log('   ⚠️ Could not trigger search button');
    }

    await browser.close();

    return { headers: capturedHeaders, cookies: capturedCookies };
}

/**
 * Fetch enslaved persons data using intercepted auth
 */
async function fetchEnslavedData(auth, offset = 0, limit = 100) {
    const axios = require('axios');

    const response = await axios.post(`${API_BASE}/past/enslaved/`, {
        results_per_page: limit,
        results_page: Math.floor(offset / limit) + 1
    }, {
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Origin': FRONTEND_BASE,
            'Referer': `${FRONTEND_BASE}/past/database`,
            'Cookie': auth.cookies,
            ...auth.headers
        },
        timeout: 30000
    });

    return response.data;
}

/**
 * Fetch data using Puppeteer page evaluation (more reliable)
 */
async function fetchDataViaBrowser(page, endpoint, params = {}) {
    const result = await page.evaluate(async (apiBase, endpoint, params) => {
        try {
            const response = await fetch(`${apiBase}${endpoint}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(params),
                credentials: 'include'
            });
            return await response.json();
        } catch (e) {
            return { error: e.message };
        }
    }, API_BASE, endpoint, params);

    return result;
}

/**
 * Main scraping function - intercepts actual page data and paginates
 */
async function scrapeWithBrowser(options = {}) {
    const { mode = 'enslaved', limit = null, testMode = false } = options;
    const maxRecords = testMode ? 100 : (limit || 100000);

    console.log('🚀 Launching browser for SlaveVoyages scraping...');

    const browser = await puppeteer.launch({
        headless: testMode ? false : 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    // Store captured API responses
    let capturedData = [];
    let totalAvailable = 0;

    // Set up response interception BEFORE navigation
    page.on('response', async response => {
        const url = response.url();
        if (url.includes('api.slavevoyages.org') && url.includes('enslaved') && response.status() === 200) {
            try {
                const buffer = await response.buffer();
                const text = buffer.toString('utf8');
                const data = JSON.parse(text);
                if (data.count) {
                    totalAvailable = data.count;
                    console.log(`   📊 Total available: ${totalAvailable}`);
                }
                if (data.results && data.results.length > 0) {
                    console.log(`   📥 Captured ${data.results.length} records`);
                    capturedData.push(...data.results);
                }
            } catch (e) {
                // Response wasn't JSON or already consumed
            }
        }
    });

    // Navigate to the People Database page
    console.log('📄 Loading SlaveVoyages People Database...');
    await page.goto(`${FRONTEND_BASE}/past/database`, {
        waitUntil: 'networkidle0',
        timeout: 60000
    });

    await delay(2000);

    // Click the "Enslaved" button to load enslaved persons data
    console.log('   🖱️ Clicking "Enslaved" button...');
    try {
        await page.evaluate(() => {
            // Find the Enslaved button
            const buttons = document.querySelectorAll('button, a');
            for (const btn of buttons) {
                if (btn.textContent.trim() === 'Enslaved') {
                    btn.click();
                    return 'clicked Enslaved';
                }
            }
            return 'button not found';
        });
    } catch (e) {
        console.log(`   ⚠️ Click error: ${e.message}`);
    }

    // Wait for data to load after clicking
    await delay(8000);

    // Initial capture
    console.log(`   📊 Initial capture: ${capturedData.length} records (${totalAvailable} total available)`);

    // Load progress for resuming
    const progress = loadProgress();
    let processedCount = 0;
    if (!testMode && progress.totalFetched > 0) {
        console.log(`   📂 Resuming from: ${progress.totalFetched} already processed`);
        processedCount = progress.totalFetched;
    }

    // Process initial batch
    let insertedThisBatch = 0;
    for (const record of capturedData) {
        if (processedCount >= maxRecords) break;
        await processEnslavedRecord(record);
        stats.recordsProcessed++;
        processedCount++;
        insertedThisBatch++;
    }
    console.log(`   ✅ Processed ${insertedThisBatch} from initial load`);

    // Paginate to get more records
    let pageNum = 2;
    const maxPages = testMode ? 2 : 1000; // Safety limit

    while (processedCount < maxRecords && processedCount < totalAvailable && pageNum <= maxPages) {
        console.log(`\n📥 Loading page ${pageNum}... (${processedCount}/${Math.min(maxRecords, totalAvailable)})`);

        // Clear captured data for this page
        capturedData = [];

        // Click next page or scroll to load more
        try {
            // Look for pagination controls
            const clicked = await page.evaluate((targetPage) => {
                // Try various pagination patterns
                const pageButtons = document.querySelectorAll('[class*="pagination"] button, [class*="pagination"] a, [class*="page"] button');
                for (const btn of pageButtons) {
                    if (btn.textContent.trim() === String(targetPage) ||
                        btn.textContent.includes('Next') ||
                        btn.getAttribute('aria-label')?.includes('next')) {
                        btn.click();
                        return btn.textContent;
                    }
                }

                // Try scrolling to trigger infinite scroll
                window.scrollTo(0, document.body.scrollHeight);
                return 'scroll';
            }, pageNum);

            if (clicked) {
                console.log(`   🖱️ Triggered: ${clicked}`);
            }
        } catch (e) {
            console.log(`   ⚠️ Pagination error: ${e.message}`);
        }

        // Wait for new data to load
        await delay(3000);

        // Process new batch
        if (capturedData.length > 0) {
            insertedThisBatch = 0;
            for (const record of capturedData) {
                if (processedCount >= maxRecords) break;
                await processEnslavedRecord(record);
                stats.recordsProcessed++;
                processedCount++;
                insertedThisBatch++;
            }
            console.log(`   ✅ Processed ${insertedThisBatch} records`);

            // Save progress
            saveProgress({ lastOffset: processedCount, totalFetched: processedCount });
        } else {
            console.log('   ⚠️ No new data captured, may have reached end');
            break;
        }

        // Progress update every 500 records
        if (processedCount % 500 === 0) {
            printStats();
        }

        pageNum++;

        // Rate limiting
        await delay(1000);
    }

    await browser.close();

    console.log('\n✅ Scraping complete!');
    printStats();
}

/**
 * Process and insert an enslaved person record
 */
async function processEnslavedRecord(record) {
    if (!sql) {
        stats.recordsSkipped++;
        return null;
    }

    try {
        // Extract fields from SlaveVoyages format
        const name = record.documented_name || record.name || record.african_name || 'Unknown';
        const africanName = record.african_name || record.modern_name || null;
        const age = parseInt(record.age) || null;
        const gender = normalizeGender(record.gender || record.sex);
        const height = record.height ? parseFloat(record.height) : null;

        // Origin info
        const countryOrigin = record.post_disembark_location?.name ||
                             record.language_group?.name ||
                             record.country_origin || null;
        const ethnicGroup = record.language_group?.name || null;

        // Voyage info
        const vesselName = record.voyage?.ship_name || record.vessel_name || null;
        const voyageId = record.voyage?.id || record.voyage_id || null;
        const voyageYear = record.voyage?.year_arrived || record.year || null;

        // Calculate birth year
        let birthYearEstimate = null;
        if (age && voyageYear) {
            birthYearEstimate = voyageYear - age;
        }

        // Build notes
        const notesParts = [];
        if (africanName && africanName !== name) notesParts.push(`African name: ${africanName}`);
        if (countryOrigin) notesParts.push(`Origin: ${countryOrigin}`);
        if (ethnicGroup) notesParts.push(`Ethnic/Language: ${ethnicGroup}`);
        if (vesselName) notesParts.push(`Vessel: ${vesselName}`);
        if (voyageYear) notesParts.push(`Year: ${voyageYear}`);
        if (height) notesParts.push(`Height: ${height}"`);
        if (record.id) notesParts.push(`SlaveVoyages ID: ${record.id}`);
        notesParts.push('Source: SlaveVoyages.org African Origins Database');

        const result = await sql`
            INSERT INTO canonical_persons (
                canonical_name,
                first_name,
                sex,
                birth_year_estimate,
                person_type,
                confidence_score,
                verification_status,
                primary_state,
                notes,
                created_by
            ) VALUES (
                ${name},
                ${africanName || name},
                ${gender},
                ${birthYearEstimate},
                'enslaved',
                0.90,
                'verified_scholarly',
                ${countryOrigin || 'Trans-Atlantic'},
                ${notesParts.join(' | ')},
                'slavevoyages_import'
            )
            ON CONFLICT DO NOTHING
            RETURNING id
        `;

        if (result && result[0]?.id) {
            stats.enslavedInserted++;
        } else {
            stats.recordsSkipped++;
        }

        return result?.[0]?.id;
    } catch (error) {
        stats.errors++;
        if (stats.errors < 10) {
            console.log(`   ⚠️ Insert error: ${error.message}`);
        }
        return null;
    }
}

/**
 * Normalize gender values
 */
function normalizeGender(value) {
    if (!value) return null;
    const v = String(value).toLowerCase().trim();
    if (v === 'm' || v === 'male' || v === 'man' || v === 'boy') return 'male';
    if (v === 'f' || v === 'female' || v === 'woman' || v === 'girl') return 'female';
    return null;
}

/**
 * Print statistics
 */
function printStats() {
    const elapsed = Math.round((Date.now() - stats.startTime) / 1000);
    console.log(`
📊 IMPORT STATISTICS
════════════════════════════════════════
Records processed:      ${stats.recordsProcessed.toLocaleString()}
Enslaved inserted:      ${stats.enslavedInserted.toLocaleString()}
Enslavers inserted:     ${stats.enslaversInserted.toLocaleString()}
Records skipped:        ${stats.recordsSkipped.toLocaleString()}
Errors:                 ${stats.errors}
Elapsed time:           ${Math.floor(elapsed / 60)}m ${elapsed % 60}s
════════════════════════════════════════
Target table: canonical_persons
`);
}

/**
 * Main function
 */
async function main() {
    console.log('══════════════════════════════════════════════════════════════');
    console.log('🚢 SLAVEVOYAGES.ORG SCRAPER');
    console.log('══════════════════════════════════════════════════════════════');
    console.log('Source: African Origins Database');
    console.log('Records: ~91,491 named Africans (1808-1862)');
    console.log('Target: canonical_persons table');
    console.log('══════════════════════════════════════════════════════════════\n');

    // Parse args
    const args = process.argv.slice(2);
    const testMode = args.includes('--test');
    const scrapeEnslavers = args.includes('--enslavers') || args.includes('--all');
    const scrapeEnslaved = args.includes('--enslaved') || args.includes('--all') ||
                          (!args.includes('--enslavers'));

    // Initialize
    ensureDataDir();
    initDatabase();

    if (testMode) {
        console.log('🧪 TEST MODE - fetching 10 records only\n');
    }

    // Scrape using browser
    await scrapeWithBrowser({
        mode: scrapeEnslaved ? 'enslaved' : 'enslavers',
        testMode
    });
}

// Export for testing
module.exports = {
    processEnslavedRecord,
    normalizeGender,
    fetchDataViaBrowser
};

// Run
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
