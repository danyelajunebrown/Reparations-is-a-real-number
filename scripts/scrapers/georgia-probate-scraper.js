
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const S3Service = require('../../src/services/storage/S3Service');
const { classifyTranscript } = require('../../src/services/probate/document-classifier');
const pg = require('pg');

puppeteer.use(StealthPlugin());

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

// --- CLI Arguments ---
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, def = null) => {
    const i = argv.indexOf(name);
    return (i !== -1 && argv[i + 1]) ? argv[i + 1] : def;
};

const COUNTY_FILTER    = opt('--county', null);       // e.g. "Liberty"
const ROLL_TITLE_FILTER = opt('--roll-title', null);  // substring match on roll title
const START_COUNTY     = opt('--start-county', null); // skip counties alphabetically before this
const DRY_RUN          = flag('--dry-run');
const APPLY            = flag('--apply');
const RESUME           = flag('--resume');
const LIMIT            = parseInt(opt('--limit', '0'), 10);
const VERBOSE          = flag('--verbose');
const CLEAR_SITEMAP    = flag('--clear-sitemap');

// --- Constants ---
const COLLECTION_ID   = '1999178';
const STATE           = 'GA';
const BROWSER_DEBUG_PORT = 9222;
const S3_BUCKET       = process.env.S3_BUCKET_NAME || 'reparations-them';
const SITEMAP_FILE    = path.join(__dirname, '../../tmp/georgia-probate-sitemap.json');

// Fix 3: Confirmed working waypoints URL (Level 1 — all 130 counties in collection 1999178)
const WAYPOINTS_URL   = 'https://www.familysearch.org/search/image/index?owc=https%3A%2F%2Fwww.familysearch.org%2Fplatform%2Frecords%2Fcollections%2F1999178%2Fwaypoints';

// --- Cookie injection ---
const FS_SESSION_COOKIE = process.env.FS_SESSION_COOKIE || null;
const FAMILYSEARCH_COOKIES_PATH = process.env.FAMILYSEARCH_COOKIES || null;

// --- Global State ---
let browser = null;
let page = null;
let methodologyId = null;
let s3VerifiedCount = 0;
let totalImagesProcessed = 0;

// --- Utility ---
function log(...args) {
    console.log(`[${new Date().toISOString()}]`, ...args);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Unicode / control-char sanitizer ---
// FamilySearch volunteer transcripts contain OCR artifact codepoints in ranges:
//   U+2300 to U+23FF (Misc Technical), U+2500 to U+257F (Box Drawing),
//   U+2100 to U+214F (Letterlike Symbols), and C0/C1 control chars.
// PostgreSQL rejects these when casting to JSONB. Strip them all before any DB write.
function sanitizeForDb(str) {
    if (!str) return str;
    return str
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
        .replace(/[\u2300-\u23FF]/g, ' ')
        .replace(/[\u2500-\u257F]/g, ' ')
        .replace(/[\u2100-\u214F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// --- Name Normalization (unchanged) ---
function normalizeName(name) {
    if (!name) return name;
    return name
        .replace(/\bThos\b\.?/gi, 'Thomas')
        .replace(/\bWm\b\.?/gi, 'William')
        .replace(/\bJas\b\.?/gi, 'James')
        .replace(/\bChas\b\.?/gi, 'Charles')
        .replace(/\bJno\b\.?/gi, 'John')
        .replace(/\bRobt\b\.?/gi, 'Robert')
        .replace(/\bSaml\b\.?/gi, 'Samuel')
        .replace(/\bBenj\b\.?/gi, 'Benjamin')
        .replace(/\bEdw\b\.?/gi, 'Edward')
        .replace(/\bRich\b\.?/gi, 'Richard')
        .trim();
}

// --- Levenshtein Distance (unchanged) ---
function levenshteinDistance(a, b) {
    const an = a.length;
    const bn = b.length;
    if (an === 0) return bn;
    if (bn === 0) return an;
    const matrix = [];
    for (let i = 0; i <= an; i++) matrix[i] = [i];
    for (let j = 1; j <= bn; j++) matrix[0][j] = j;
    for (let i = 1; i <= an; i++) {
        for (let j = 1; j <= bn; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
        }
    }
    return matrix[an][bn];
}

// --- Cookie injection (unchanged) ---
async function injectCookies() {
    if (FAMILYSEARCH_COOKIES_PATH) {
        if (!fs.existsSync(FAMILYSEARCH_COOKIES_PATH)) {
            log(`WARNING: FAMILYSEARCH_COOKIES file not found at ${FAMILYSEARCH_COOKIES_PATH}. Skipping cookie injection.`);
            return false;
        }
        const cookies = JSON.parse(fs.readFileSync(FAMILYSEARCH_COOKIES_PATH, 'utf8'));
        await page.setCookie(...cookies);
        log(`Injected ${cookies.length} cookies from ${FAMILYSEARCH_COOKIES_PATH}`);
        return true;
    }
    if (FS_SESSION_COOKIE) {
        await page.setCookie({
            name: 'fssessionid',
            value: FS_SESSION_COOKIE,
            domain: '.familysearch.org',
            path: '/',
            httpOnly: true,
            secure: true,
            sameSite: 'None',
        });
        log('Injected FS_SESSION_COOKIE from .env.');
        return true;
    }
    return false;
}

// --- Browser Launch (unchanged pattern) ---
async function launchBrowser() {
    log('Connecting to existing Chrome instance on port 9222...');
    try {
        browser = await puppeteer.connect({
            browserURL: `http://127.0.0.1:${BROWSER_DEBUG_PORT}`,
            defaultViewport: null
        });
        log('Connected to existing Chrome instance.');
        page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 900 });
        return;
    } catch (e) {
        log(`No existing Chrome session on port ${BROWSER_DEBUG_PORT}. Launching system Chrome...`);
    }

    // DO NOT use puppeteer.launch() — crashes on Intel Mac Sonoma (EXC_BREAKPOINT / SIGTRAP).
    log('Launching system Google Chrome via open command...');
    try {
        execSync(
            `open -na "Google Chrome" --args --remote-debugging-port=${BROWSER_DEBUG_PORT} --user-data-dir=/tmp/familysearch-scraper-session --no-first-run --no-default-browser-check`,
            { stdio: 'ignore' }
        );
    } catch (openErr) {
        log(`WARNING: open command failed: ${openErr.message}`);
    }
    await sleep(4000);
    try {
        browser = await puppeteer.connect({
            browserURL: `http://127.0.0.1:${BROWSER_DEBUG_PORT}`,
            defaultViewport: null
        });
        log('Connected to system Chrome instance.');
        page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 900 });
        return;
    } catch (e2) {
        log('ERROR: Could not connect to Chrome after launch attempt. Please run manually:');
        log(`  open -na "Google Chrome" --args --remote-debugging-port=${BROWSER_DEBUG_PORT} --user-data-dir=/tmp/familysearch-scraper-session`);
        log('Then re-run the scraper.');
        process.exit(1);
    }
}

// --- Login Check (unchanged) ---
async function ensureLoggedIn() {
    log('Checking FamilySearch login status...');

    const currentUrl = page.url();
    if (currentUrl.includes('/ark:/') || currentUrl.includes('familysearch.org/ark')) {
        if (VERBOSE) log('Already on record page — session assumed valid.');
        return;
    }

    const cookiesInjected = await injectCookies();
    await page.goto('https://www.familysearch.org/', { waitUntil: 'domcontentloaded' });
    await sleep(cookiesInjected ? 3000 : 2000);

    const checkLoggedIn = async () => {
        try {
            const url = page.url();
            if (url.includes('/home/portal/') || url.includes('familysearch.org/home')) return true;
            return await page.evaluate(() =>
                document.querySelector('button[data-testid="user-menu-button"]') !== null ||
                document.querySelector('[data-testid="header-profile"]') !== null ||
                document.querySelector('a[href*="/account/"]') !== null
            );
        } catch (_) {
            // page.evaluate() throws "Execution context was destroyed" when FamilySearch
            // redirects mid-flight (e.g. / → /en/home/portal/). Fall back to URL check.
            const url = page.url();
            return url.includes('/home/portal/') || url.includes('familysearch.org/home');
        }
    };

    if (await checkLoggedIn()) {
        log('Already logged in to FamilySearch.');
        return;
    }

    log('Not logged in. Please log in in the Chrome window. Waiting up to 3 minutes...');
    let loggedIn = false;
    for (let i = 0; i < 18; i++) {
        await sleep(10000);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await sleep(2000);
        if (await checkLoggedIn()) {
            loggedIn = true;
            break;
        }
    }
    if (!loggedIn) {
        log('Login timed out. Exiting.');
        process.exit(1);
    }
    log('Successfully logged in to FamilySearch.');
}

// --- Migration Check ---
async function checkAndApplyMigrations() {
    const client = await pool.connect();
    try {
        // M069: probate_scrape_progress table
        const tableExists = await client.query(`
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables WHERE table_name = 'probate_scrape_progress'
            );
        `);
        if (!tableExists.rows[0].exists) {
            log('Applying migration 069...');
            const sql069 = fs.readFileSync(
                path.join(__dirname, '../../migrations/069-georgia-probate-pipeline.sql'), 'utf8'
            );
            await client.query(sql069);
            log('Migration 069 applied.');
        }

        // M078: add roll_group_id column + fix UNIQUE constraint
        const colExists = await client.query(`
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'probate_scrape_progress' AND column_name = 'roll_group_id'
            );
        `);
        if (!colExists.rows[0].exists) {
            log('Applying migration 078 (roll_group_id column)...');
            const sql078 = fs.readFileSync(
                path.join(__dirname, '../../migrations/078-probate-scrape-progress-roll-column.sql'), 'utf8'
            );
            await client.query(sql078);
            log('Migration 078 applied.');
        }

        // Fetch methodology UUID
        const mRes = await client.query(`
            SELECT id FROM estimation_methodology_registry
            WHERE name = 'georgia_probate_liberty_county_1858_1867'
              AND version = 'v1.0.0'
            LIMIT 1;
        `);
        if (mRes.rows.length > 0) {
            methodologyId = mRes.rows[0].id;
            if (VERBOSE) log(`Methodology UUID: ${methodologyId}`);
        } else {
            log('WARNING: Methodology UUID not found. Proceeding with null methodology_id.');
        }
    } catch (e) {
        log(`ERROR during migration check: ${e.message}`);
        process.exit(1);
    } finally {
        client.release();
    }
}

// --- Sitemap ---
function loadSitemap() {
    const dir = path.dirname(SITEMAP_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (CLEAR_SITEMAP && fs.existsSync(SITEMAP_FILE)) {
        fs.unlinkSync(SITEMAP_FILE);
        log('--clear-sitemap: deleted existing sitemap file.');
    }
    if (fs.existsSync(SITEMAP_FILE)) {
        const data = JSON.parse(fs.readFileSync(SITEMAP_FILE, 'utf8'));
        log(`Loaded sitemap: ${data.counties.length} counties already indexed.`);
        return data;
    }
    return { counties: [] };
}

function saveSitemap(sitemap) {
    fs.writeFileSync(SITEMAP_FILE, JSON.stringify(sitemap, null, 2), 'utf8');
}

// --- Phase 0: Build sitemap by crawling collection waypoints ---
// Fix 3: Uses confirmed waypoints URL; exits with code 1 if zero counties found.
async function buildSitemap(sitemap) {
    log('Phase 0: Building/updating sitemap from collection waypoints...');
    log(`  Waypoints URL: ${WAYPOINTS_URL}`);

    await page.goto(WAYPOINTS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(5000); // wait for React SPA to render county list

    // Extract all county-level group entries from the waypoints page.
    // Each link contains owc= parameter encoding countyGroupId and countyDgs.
    const countyLinks = await page.evaluate(() => {
        const results = [];
        const links = Array.from(document.querySelectorAll('a[href*="owc="]'));
        for (const link of links) {
            const href = link.href || '';
            if (!href.includes('familysearch.org')) continue;
            // owc= parameter value contains groupId%3Adgs (URL-encoded colon)
            const owcMatch = href.match(/[?&]owc=([^&]+)/);
            if (!owcMatch) continue;
            const owcDecoded = decodeURIComponent(owcMatch[1]);
            // Format: GROUPID:DGS?cc=1999178 or GROUPID:DGS1,DGS2?cc=...
            const owcParts = owcDecoded.replace(/\?.*$/, '').split(':');
            if (owcParts.length < 2) continue;
            const groupId = owcParts[0].trim();
            const dgs = owcParts[1].trim();
            // County name from link text
            const name = (link.textContent || '').trim();
            if (groupId && dgs && name) {
                results.push({ county: name, countyGroupId: groupId, countyDgs: dgs });
            }
        }
        return results;
    });

    // Fix 3: Hard stop if zero counties found
    if (countyLinks.length === 0) {
        log('ERROR: Waypoints page returned zero county links. The URL or DOM structure may have changed.');
        log(`  URL used: ${WAYPOINTS_URL}`);
        log('  Open this URL in Chrome DevTools, find the county links, and update the selector.');
        process.exit(1);
    }

    log(`Found ${countyLinks.length} county entries on waypoints page.`);

    const existingCountyIds = new Set(sitemap.counties.map(c => c.countyGroupId));

    for (const countyEntry of countyLinks) {
        if (existingCountyIds.has(countyEntry.countyGroupId)) {
            if (VERBOSE) log(`  County ${countyEntry.county}: already in sitemap, skipping.`);
            continue;
        }

        // Apply --county filter at sitemap-build time to avoid crawling all 130 counties
        if (COUNTY_FILTER && countyEntry.county.toLowerCase() !== COUNTY_FILTER.toLowerCase()) {
            continue;
        }

        log(`  Indexing county: ${countyEntry.county} (${countyEntry.countyGroupId})`);

        // Navigate to county-level index page to get its sub-rolls
        const countyDgsEncoded = countyEntry.countyDgs.replace(',', '%2C');
        const countyIndexUrl = `https://www.familysearch.org/search/image/index?owc=${encodeURIComponent(countyEntry.countyGroupId + ':' + countyEntry.countyDgs + '?cc=' + COLLECTION_ID)}&cc=${COLLECTION_ID}`;

        let rolls = [];
        try {
            await page.goto(countyIndexUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await sleep(4000);

            rolls = await page.evaluate(() => {
                const results = [];
                const links = Array.from(document.querySelectorAll('a[href*="owc="]'));
                for (const link of links) {
                    const href = link.href || '';
                    const owcMatch = href.match(/[?&]owc=([^&]+)/);
                    if (!owcMatch) continue;
                    const owcDecoded = decodeURIComponent(owcMatch[1]);
                    const owcParts = owcDecoded.replace(/\?.*$/, '').split(':');
                    if (owcParts.length < 2) continue;
                    const groupId = owcParts[0].trim();
                    const dgs = owcParts[1].trim();
                    const title = (link.textContent || '').trim();
                    if (groupId && dgs && title) {
                        const rollIndexUrl = `https://www.familysearch.org/en/search/image/index?owc=${encodeURIComponent(groupId + ':' + dgs + '?cc=1999178')}&cc=1999178`;
                        results.push({ title, groupId, dgs, rollIndexUrl, imageCount: null, status: 'pending' });
                    }
                }
                return results;
            });

            // Deduplicate by groupId
            const seen = new Set();
            rolls = rolls.filter(r => {
                if (seen.has(r.groupId)) return false;
                seen.add(r.groupId);
                return true;
            });

            log(`    Found ${rolls.length} rolls in ${countyEntry.county}.`);
        } catch (e) {
            log(`    WARNING: Could not index rolls for ${countyEntry.county}: ${e.message}`);
        }

        sitemap.counties.push({
            county: countyEntry.county,
            countyGroupId: countyEntry.countyGroupId,
            countyDgs: countyEntry.countyDgs,
            rolls,
        });
        saveSitemap(sitemap);
        await sleep(2000 + Math.random() * 1000);
    }

    log(`Phase 0 complete. Sitemap has ${sitemap.counties.length} counties.`);
    return sitemap;
}

// --- Image URL: uses the image-specific ARK extracted from page.url() after viewer navigation ---
// Navigation between images uses the viewer's number-input field (not the i= URL parameter).
// This URL is used for DB storage/display reference only — not for page.goto().
function buildImageUrl(arkId) {
    return `https://www.familysearch.org/ark:/61903/3:1:${arkId}?view=fullText&lang=en`;
}

// --- Phase 1: Scrape all images in one roll ---
// Navigation: navigate to roll index page → click first thumbnail → enter viewer →
// use the viewer's number-input field to advance to each subsequent image.
// Each image has a unique ARK extracted from page.url() after navigation.
async function scrapeOneRoll(countyObj, roll, isDryRun) {
    log(`Roll: "${roll.title}" [${roll.groupId}] in ${countyObj.county}`);

    // Backfill rollIndexUrl for sitemaps built before this change
    if (!roll.rollIndexUrl) {
        roll.rollIndexUrl = `https://www.familysearch.org/en/search/image/index?owc=${encodeURIComponent(roll.groupId + ':' + roll.dgs + '?cc=' + COLLECTION_ID)}&cc=${COLLECTION_ID}`;
    }

    // Step 1: Navigate to the roll's index page
    try {
        await page.goto(roll.rollIndexUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await sleep(4000);
    } catch (e) {
        log(`  ERROR navigating to roll index ${roll.groupId}: ${e.message}. Skipping roll.`);
        roll.status = 'failed';
        return;
    }

    // Step 2: Click the first image thumbnail to enter the viewer
    try {
        await page.click('a[href*="/ark:/61903/3:1:"]');
    } catch (e) {
        log(`  ERROR: No image thumbnail found for roll ${roll.groupId}: ${e.message}. Skipping roll.`);
        roll.status = 'failed';
        return;
    }
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(6000);

    // Step 3: Extract total image count from "Image N of TOTAL" text in viewer body
    let imageCount = roll.imageCount;
    if (!imageCount) {
        imageCount = await page.evaluate(() => {
            const bodyText = document.body.innerText || '';
            const m = bodyText.match(/[Ii]mage\s+\d+\s+of\s+(\d+)/i);
            if (m) return parseInt(m[1], 10);
            const m2 = bodyText.match(/of\s+(\d+)/i);
            if (m2) return parseInt(m2[1], 10);
            return null;
        });
        if (imageCount) {
            roll.imageCount = imageCount;
            log(`  Image count: ${imageCount}`);
        } else {
            log(`  WARNING: Could not determine image count for roll ${roll.groupId}. Defaulting to 500.`);
            imageCount = 500;
        }
    }

    // Step 4: Extract image-1 ARK from the resolved URL
    const image1Url = page.url();
    const image1ArkMatch = image1Url.match(/3:1:([A-Z0-9]+-[A-Z0-9]+(?:-[A-Z0-9]+)*)/i);
    if (!image1ArkMatch) {
        log(`  ERROR: Could not extract ARK for image 1 of roll ${roll.groupId} (URL: ${image1Url}). Skipping roll.`);
        roll.status = 'failed';
        return;
    }
    let currentArkId = image1ArkMatch[1];
    log(`  Image 1 ARK: ${currentArkId}`);

    // Load already-written image numbers for this roll (--resume)
    let writtenImages = new Set();
    if (RESUME) {
        const client = await pool.connect();
        try {
            const res = await client.query(`
                SELECT image_number FROM probate_scrape_progress
                WHERE collection_id = $1 AND roll_group_id = $2 AND status = 'written'
            `, [COLLECTION_ID, roll.groupId]);
            writtenImages = new Set(res.rows.map(r => r.image_number));
            if (writtenImages.size > 0) log(`  RESUME: Skipping ${writtenImages.size} already-written images.`);
        } catch (e) {
            log(`  WARNING: Could not load written images for resume: ${e.message}`);
        } finally {
            client.release();
        }
    }

    // Step 5: Process image 1 (already in viewer), then advance via input field for images 2…N
    for (let imageNumber = 1; imageNumber <= imageCount; imageNumber++) {
        if (LIMIT > 0 && totalImagesProcessed >= LIMIT) {
            log(`  Global limit of ${LIMIT} images reached.`);
            return;
        }

        if (RESUME && writtenImages.has(imageNumber)) {
            if (VERBOSE) log(`  RESUME: Skipping image ${imageNumber}.`);
            // Advance viewer so it stays in sync, then read the new ARK
            if (imageNumber < imageCount) {
                await advanceViewerToImage(imageNumber + 1);
                const advUrl = page.url();
                const advMatch = advUrl.match(/3:1:([A-Z0-9]+-[A-Z0-9]+(?:-[A-Z0-9]+)*)/i);
                if (advMatch) currentArkId = advMatch[1];
            }
            continue;
        }

        await processImage(countyObj, roll, imageNumber, currentArkId, isDryRun);
        totalImagesProcessed++;

        await sleep(3000 + Math.random() * 2000);

        if (imageNumber % 50 === 0) {
            log(`  Session check at image ${imageNumber}...`);
            await ensureLoggedIn();
        }

        // Advance to next image via viewer input field and capture new ARK
        if (imageNumber < imageCount) {
            const advanced = await advanceViewerToImage(imageNumber + 1);
            if (!advanced) {
                log(`  WARNING: Could not advance viewer to image ${imageNumber + 1}. Stopping roll.`);
                break;
            }
            const newUrl = page.url();
            const newArkMatch = newUrl.match(/3:1:([A-Z0-9]+-[A-Z0-9]+(?:-[A-Z0-9]+)*)/i);
            if (newArkMatch) {
                currentArkId = newArkMatch[1];
                if (VERBOSE) log(`  Image ${imageNumber + 1} ARK: ${currentArkId}`);
            } else {
                log(`  WARNING: Could not extract ARK for image ${imageNumber + 1} (URL: ${newUrl}). Using placeholder.`);
                currentArkId = `unknown-${imageNumber + 1}`;
            }
        }
    }
}

// --- Advance FamilySearch image viewer to a specific image number via the number-input field ---
async function advanceViewerToImage(imageNumber) {
    // Try selectors in priority order as specified
    const selectors = [
        'input[aria-label*="mage"]',
        'input[class*="image-number"]',
        'input[type="number"]',
    ];
    let inputHandle = null;
    for (const sel of selectors) {
        try {
            inputHandle = await page.$(sel);
            if (inputHandle) break;
        } catch (_) {}
    }
    if (!inputHandle) {
        log(`  WARNING: Image number input not found for image ${imageNumber}.`);
        return false;
    }
    try {
        await inputHandle.click({ clickCount: 3 }); // triple-click to select all
        await inputHandle.type(String(imageNumber));
        await inputHandle.press('Enter');
        await sleep(6000); // wait for SPA navigation to settle
        return true;
    } catch (e) {
        log(`  WARNING: Error advancing viewer to image ${imageNumber}: ${e.message}`);
        return false;
    }
}

// --- Process a single image ---
// The page is already on the correct image (navigated by scrapeOneRoll via viewer input).
// Do not navigate again — just extract transcript, take screenshot, write to DB.
async function processImage(countyObj, roll, imageNumber, currentArkId, isDryRun) {
    // buildImageUrl takes only the ARK — this URL is for DB storage/display, not navigation
    const url = buildImageUrl(currentArkId);
    if (VERBOSE) log(`  Image ${imageNumber}: ${url}`);

    let rawTranscriptText = '';
    let screenshotBuffer = null;
    let status = 'no_transcript';
    let recordType = 'other';
    let testatorName = null;
    let enslavedCount = 0;
    let errorText = null;
    let parsedData = null;

    try {
        // Page is already on this image — wait briefly for transcript panel to fully render
        await sleep(2000);

        // Extract transcript text using the confirmed FamilySearch DOM structure.
        // div[data-testid="full-text-transcript"] contains volunteer transcription as <span> children.
        // Confirmed live in Chrome DevTools on Mac Mini (2026-05-15).
        rawTranscriptText = await page.evaluate(() => {
            const container = document.querySelector('div[data-testid="full-text-transcript"]');
            if (!container) return '';
            const spans = Array.from(container.querySelectorAll('span'));
            const joined = spans.map(s => s.textContent).join(' ').replace(/\s+/g, ' ').trim();
            return joined.length <= 5 ? '' : joined;
        });

        if (rawTranscriptText.trim().length > 0) {
            status = 'parsed';
            parsedData = parseTranscript(rawTranscriptText, imageNumber, currentArkId);
            recordType = parsedData.recordType;
            testatorName = parsedData.testatorName;
            enslavedCount = parsedData.enslavedPersons.length;
            if (VERBOSE) {
                log(`  Parsed image ${imageNumber}:`, JSON.stringify(parsedData, null, 2));
            }
        } else {
            if (VERBOSE) log(`  Image ${imageNumber}: no transcript.`);
        }

        screenshotBuffer = await page.screenshot({ fullPage: false, type: 'jpeg', quality: 85 });
    } catch (e) {
        log(`  ERROR processing image ${imageNumber}: ${e.message}`);
        status = 'failed';
        errorText = e.message;
    }

    if (!isDryRun && status !== 'failed') {
        await writeToDbAndS3(
            imageNumber, currentArkId, url, rawTranscriptText, screenshotBuffer,
            status, recordType, testatorName, enslavedCount, errorText, parsedData,
            countyObj.county, roll
        );
    } else if (isDryRun) {
        log(`  DRY RUN image ${imageNumber}: status=${status} type=${recordType} testator="${testatorName}" enslaved=${enslavedCount} heirs=${parsedData?.heirs?.length ?? 0} estateValue=${parsedData?.estateValue ?? 'n/a'}`);
        if (VERBOSE && parsedData) {
            log('    Heirs:', parsedData.heirs.map(h => `${h.name} (${h.relation})`).join(', ') || 'none');
            log('    Enslaved:', parsedData.enslavedPersons.map(e => `${e.name} [to: ${e.bequestRecipientName || 'unknown'}]`).join(', ') || 'none');
        }
        // Still record progress in dry-run mode so status is visible
        await updateProgress(imageNumber, currentArkId, status, errorText, recordType, testatorName, enslavedCount, null, null, roll.groupId);
    } else {
        // status === 'failed'
        await updateProgress(imageNumber, currentArkId, status, errorText, recordType, testatorName, enslavedCount, null, null, roll.groupId);
    }
}

// --- DB + S3 Write ---
// Fix 2: Dynamic S3 key, collectionName, collectionKey, sourcePageTitle
// derived from county and roll parameters — no hardcoded Liberty County strings.
async function writeToDbAndS3(
    imageNumber, baseArkId, url, rawTranscriptText, screenshotBuffer,
    status, recordType, testatorName, enslavedCount, errorText, parsedData,
    county, roll
) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Sanitize transcript text before any DB write — strips Unicode OCR artifacts
        // (Misc Technical, Box Drawing, Letterlike Symbols, control chars) that Postgres
        // rejects when casting to JSONB.
        const safeTranscript = sanitizeForDb(rawTranscriptText) || '';

        // Fix 2: Dynamic S3 key
        const countySlug = county.toLowerCase().replace(/\s+/g, '-');
        const s3Key = `probate/georgia/${countySlug}/${roll.groupId}/image-${String(imageNumber).padStart(4, '0')}-${baseArkId}.jpg`;

        // Fix 2: Dynamic collection strings
        const collectionName = `${county} County GA Probate Records — ${roll.title}`;
        const collectionKey = `georgia-probate-${countySlug}-${roll.groupId}`;
        const sourcePageTitle = `${county} County Georgia Probate Records, ${roll.title}, Image ${imageNumber}`;

        let s3Url = '';
        if (screenshotBuffer) {
            const s3Result = await S3Service.upload(s3Key, screenshotBuffer, 'image/jpeg');
            s3Url = s3Result.url || s3Result.Location || `https://${S3_BUCKET}.s3.us-east-2.amazonaws.com/${s3Key}`;
            log(`  S3 upload OK: ${s3Url}`);
            s3VerifiedCount++;
        }

        const docTypeMap = {
            will: 'will',
            inventory: 'estate_inventory',
            estate_account: 'estate_account',
            guardian_account: 'guardian_account',
            letters: 'other',
            other: 'other',
        };
        const docType = docTypeMap[recordType] || 'other';

        // extraction_confidence reflects the strength of the record-type
        // classification signal (0 = no recognised anchor — e.g. continuation
        // or index page). It is NOT a transcript-quality score. The column
        // schema default is 0.70; writing it explicitly avoids every row
        // silently inheriting that default regardless of what was matched.
        const extractionConfidence = parsedData?.classificationConfidence ?? 0;

        const pdResult = await client.query(`
            INSERT INTO person_documents
                (s3_key, s3_url, document_type, filename, file_size, mime_type,
                 source_type_label, collection_name, collection_key,
                 collection_page_number, name_as_appears, document_year,
                 created_by, ocr_text, source_url, source_type, image_number,
                 extraction_confidence)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
            ON CONFLICT DO NOTHING
            RETURNING id;
        `, [
            s3Key, s3Url, docType,
            `image-${imageNumber}-${baseArkId}.jpg`,
            screenshotBuffer ? screenshotBuffer.length : 0,
            'image/jpeg',
            'probate_record',
            collectionName, collectionKey, imageNumber,
            testatorName || `Image ${imageNumber}`,
            parsedData?.recordYear || null,
            'georgia-probate-scraper',
            safeTranscript,
            url,
            'familysearch',
            imageNumber,
            extractionConfidence
        ]);

        if (!pdResult.rows[0]) {
            await client.query('COMMIT');
            log(`  person_documents: duplicate for image ${imageNumber}, skipping.`);
            await updateProgress(imageNumber, baseArkId, 'written', null, recordType, testatorName, enslavedCount, null, s3Key, roll.groupId);
            return;
        }
        const personDocumentId = pdResult.rows[0].id;
        log(`  person_documents id=${personDocumentId}`);

        // Upsert testator
        let testatorCanonicalPersonId = null;
        if (testatorName && parsedData?.recordYear) {
            testatorCanonicalPersonId = await upsertCanonicalPerson(
                client, testatorName, 'enslaver', parsedData.recordYear, county, STATE
            );
        }
        // Dependent writes run only when the testator resolved to a real
        // person — upsertCanonicalPerson returns null for a rejected non-name.
        if (testatorCanonicalPersonId) {
            await client.query(
                `UPDATE person_documents SET canonical_person_id = $1 WHERE id = $2`,
                [testatorCanonicalPersonId, personDocumentId]
            );

            await client.query(`
                INSERT INTO enslaver_evidence_compendium
                    (canonical_person_id, evidence_source_table, evidence_source_id,
                     evidence_strength, claim_summary, methodology_id, ingested_at, ingested_by)
                VALUES ($1, 'person_documents', $2::text, 'direct_primary', $3, $4, NOW(), 'georgia-probate-scraper')
                ON CONFLICT DO NOTHING;
            `, [
                testatorCanonicalPersonId, personDocumentId,
                `Named as testator in ${county} County GA probate ${parsedData.recordYear}, type: ${recordType}`,
                methodologyId
            ]);

            if (parsedData.estateValue) {
                const notesJson = JSON.stringify({
                    georgia_probate_estate_value: parsedData.estateValue,
                    georgia_probate_year: parsedData.recordYear,
                    roll: roll.title,
                    county,
                });
                // The notes column may contain plain-text boilerplate from a prior pipeline.
                // Use a SAVEPOINT so that if the JSONB cast fails, we roll back only this
                // sub-operation (not the whole transaction) and retry with a plain overwrite.
                // A bare ROLLBACK would destroy all prior work in the transaction (person_documents
                // INSERT, testator upsert, etc.) and leave the connection without an active txn.
                await client.query('SAVEPOINT before_notes_update');
                try {
                    await client.query(`
                        UPDATE canonical_persons
                        SET notes = COALESCE(notes::jsonb, '{}'::jsonb) || $1::jsonb, updated_at = NOW()
                        WHERE id = $2;
                    `, [notesJson, testatorCanonicalPersonId]);
                    await client.query('RELEASE SAVEPOINT before_notes_update');
                } catch (_jsonErr) {
                    // JSONB cast failed — roll back only to the savepoint so the connection
                    // is no longer in "aborted" state, then overwrite with the plain value.
                    try { await client.query('ROLLBACK TO SAVEPOINT before_notes_update'); } catch (_) {}
                    await client.query(`
                        UPDATE canonical_persons
                        SET notes = $1, updated_at = NOW()
                        WHERE id = $2;
                    `, [notesJson, testatorCanonicalPersonId]);
                }
            }
        }

        // Upsert heirs
        const heirNameToId = {};
        if (parsedData?.heirs?.length > 0) {
            for (const heir of parsedData.heirs) {
                if (!heir.name || !isValidPersonName(heir.name)) continue;
                // Use a SAVEPOINT per heir so a constraint violation or other error on one
                // heir does not leave the connection in "aborted" state for subsequent heirs.
                await client.query('SAVEPOINT before_heir_upsert');
                try {
                    const heirId = await upsertCanonicalPerson(
                        client, heir.name, 'unknown', parsedData.recordYear, county, STATE
                    );
                    // upsertCanonicalPerson returns null for a rejected non-name — skip.
                    if (!heirId) {
                        await client.query('RELEASE SAVEPOINT before_heir_upsert');
                        continue;
                    }
                    heirNameToId[normalizeName(heir.name).toLowerCase()] = heirId;

                    if (testatorCanonicalPersonId) {
                        await client.query(`
                            INSERT INTO inheritance_edges
                                (testator_id, heir_id, asset_type, asset_description,
                                 source_document_id, document_year, document_jurisdiction,
                                 evidence_tier, confidence)
                            VALUES ($1, $2, 'unspecified', $3, $4, $5, $6, 1, 0.90)
                            ON CONFLICT DO NOTHING;
                        `, [
                            testatorCanonicalPersonId, heirId,
                            `Heir named in ${recordType}: ${heir.relation || 'unknown relation'}`,
                            personDocumentId, parsedData.recordYear,
                            `${county} County, ${STATE}`
                        ]);
                    }
                    await client.query('RELEASE SAVEPOINT before_heir_upsert');
                } catch (e) {
                    try { await client.query('ROLLBACK TO SAVEPOINT before_heir_upsert'); } catch (_) {}
                    log(`  WARNING: Could not upsert heir "${heir.name}": ${e.message}`);
                }
            }
        }

        // Process enslaved persons
        for (const ep of (parsedData?.enslavedPersons || [])) {
            if (!ep.name && !ep.contextText) continue;
            // Use a SAVEPOINT per enslaved person so a constraint violation on one
            // row does not leave the connection in "aborted" state for subsequent rows.
            await client.query('SAVEPOINT before_enslaved_insert');
            try {
                const upRes = await client.query(`
                    INSERT INTO unconfirmed_persons
                        (full_name, person_type, gender, locations, source_url, source_page_title,
                         extraction_method, context_text, confidence_score, relationships)
                    VALUES ($1, 'enslaved', $2, $3, $4, $5, 'full_text_transcript', $6, $7, $8)
                    RETURNING lead_id;
                `, [
                    ep.name || 'Unknown',
                    ep.gender || null,
                    [`${county} County, ${STATE}`],
                    url,
                    sourcePageTitle,
                    sanitizeForDb(ep.contextText) || null,
                    0.85,
                    JSON.stringify({
                        bequeathed_by_canonical_id: testatorCanonicalPersonId,
                        bequeathed_to_canonical_id: ep.bequestRecipientName
                            ? (heirNameToId[ep.bequestRecipientName.toLowerCase()] || null)
                            : null,
                        dollar_value_at_bequeathal: ep.dollarValue,
                        record_year: parsedData.recordYear,
                        record_type: recordType
                    })
                ]);
                const upLeadId = upRes.rows[0].lead_id;
                log(`  unconfirmed_persons lead_id=${upLeadId} name="${ep.name}"`);

                if (testatorCanonicalPersonId && ep.bequestRecipientName) {
                    const resolvedHeirId = heirNameToId[ep.bequestRecipientName.toLowerCase()] || null;
                    if (resolvedHeirId) {
                        await client.query(`
                            INSERT INTO inheritance_edges
                                (testator_id, heir_id, asset_type, asset_description,
                                 enslaved_persons_count, source_document_id,
                                 document_year, document_jurisdiction, evidence_tier, confidence)
                            VALUES ($1, $2, 'enslaved_persons', $3, 1, $4, $5, $6, 1, 0.95)
                            ON CONFLICT DO NOTHING;
                        `, [
                            testatorCanonicalPersonId, resolvedHeirId,
                            `Bequest of enslaved person "${ep.name}" from ${recordType}`,
                            personDocumentId, parsedData.recordYear,
                            `${county} County, ${STATE}`
                        ]);
                    }
                }
                await client.query('RELEASE SAVEPOINT before_enslaved_insert');
            } catch (e) {
                try { await client.query('ROLLBACK TO SAVEPOINT before_enslaved_insert'); } catch (_) {}
                log(`  WARNING: Could not insert enslaved person "${ep.name}": ${e.message}`);
            }
        }

        await client.query('COMMIT');
        await updateProgress(imageNumber, baseArkId, 'written', null, recordType, testatorName, enslavedCount, personDocumentId, s3Key, roll.groupId);
    } catch (e) {
        await client.query('ROLLBACK');
        log(`  ERROR writing image ${imageNumber}: ${e.message}`);
        await updateProgress(imageNumber, baseArkId, 'failed', e.message, recordType, testatorName, enslavedCount, null, null, roll.groupId);
    } finally {
        client.release();
    }
}

// --- Progress tracking (updated for roll_group_id) ---
async function updateProgress(
    imageNumber, arkId, status, errorText = null,
    recordType = null, testatorName = null, enslavedCount = 0,
    personDocumentId = null, s3Key = null, rollGroupId = null
) {
    const client = await pool.connect();
    try {
        await client.query(`
            INSERT INTO probate_scrape_progress
                (collection_id, county, state, image_number, ark_id, roll_group_id, status,
                 record_type, testator_name, enslaved_count, person_document_id,
                 s3_key, error_text, processed_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
            ON CONFLICT (collection_id, roll_group_id, image_number) DO UPDATE SET
                ark_id             = EXCLUDED.ark_id,
                status             = EXCLUDED.status,
                record_type        = EXCLUDED.record_type,
                testator_name      = EXCLUDED.testator_name,
                enslaved_count     = EXCLUDED.enslaved_count,
                person_document_id = EXCLUDED.person_document_id,
                s3_key             = EXCLUDED.s3_key,
                error_text         = EXCLUDED.error_text,
                processed_at       = NOW();
        `, [
            COLLECTION_ID,
            // county and state are not available here without extra params — use defaults
            rollGroupId || 'unknown', STATE,
            imageNumber, arkId, rollGroupId, status, recordType,
            testatorName, enslavedCount, personDocumentId, s3Key, errorText
        ]);
    } catch (e) {
        log(`  ERROR updating probate_scrape_progress for image ${imageNumber}: ${e.message}`);
    } finally {
        client.release();
    }
}

// --- Enslaved person name stopword filter ---
// Prevents generic OCR tokens from being written to unconfirmed_persons as "names".
// Compiled from contaminated names observed in the Liberty County 1790-1850 run.
const NAME_STOPWORDS = new Set([
    'named','one','by','the','my','said','of','and','to','for','in','at','as',
    'is','it','he','she','his','her','their','our','its','or','but','not',
    'with','from','that','this','also','above','within','same','aforesaid',
    'following','certain','another','given','all','other',
    'man','woman','boy','girl','child','children','wench','fellow','servant',
    'slave','slaves','negro','negroes','old','young','little','big','aged',
    'faithful','trusty','female','male','mulatto','called',
    'two','three','four','five','six','seven','eight','nine','ten','eleven',
    'twelve','fourteen','fifteen','twenty',
    'executor','executrix','executors','witness','witnesses','subscriber',
    'subscribers','rector','deacon',
    'viz','lastly','likewise','furthermore','moreover','whereas','item',
    'valued','purchase','forward','house','field','born','cold','had','ditto',
    'do','gross','pair','mentioned','state','march','day',
    'pr','sew','suc','amht','god','lemale','foltowing',
]);

function isValidEnslavedPersonName(token) {
    if (!token) return false;
    const clean = token.trim();
    if (clean.length < 2) return false;
    if (NAME_STOPWORDS.has(clean.toLowerCase())) return false;
    if (/^\d+$/.test(clean)) return false;
    if (!/^[A-Z]/.test(clean)) return false;       // must start with capital
    if (!/[aeiouAEIOU]/.test(clean)) return false; // must contain a vowel
    return true;
}

// Articles, prepositions, pronouns and will/deed boilerplate. A "name" that
// contains any of these is a parsed phrase fragment, not a person — this is
// what produced the 3,271 `system`/`unknown` junk rows the audit deleted
// ("to my beloved", "and recommend my", "them by will", "the premisses", …).
const NON_NAME_TOKENS = new Set([
    'a','an','the','and','or','of','to','in','on','at','by','for','with','from',
    'as','my','his','her','their','our','your','its','i','he','she','we','they',
    'them','it','who','whom','which','that','this','these','those','said','same',
    'shall','should','will','would','hereby','unto','upon','before','during',
    'after','until','whereas','wherein','therein','thereof','herein','anno',
    'lawful','issue','premises','premisses','tract','estate','heirs','heir',
    'recommend','dispose','bequeath','devise','give','given','sell','submit',
    'children','child','dollars','dollar','perty','property',
]);

// True only for strings that plausibly name a single human being. Used to gate
// every canonical_persons creation in this scraper (testators and heirs).
function isValidPersonName(name) {
    if (!name) return false;
    const clean = String(name).trim();
    if (clean.length < 3) return false;
    if (/[\n\t\r]/.test(clean)) return false;          // OCR line-break artifact
    if (!/[A-Za-z]/.test(clean)) return false;
    const tokens = clean.split(/\s+/).filter(Boolean);
    if (tokens.length === 0 || tokens.length > 5) return false; // a name is not a phrase
    let realTokens = 0;
    for (const t of tokens) {
        const lc = t.toLowerCase().replace(/[^a-z]/g, '');
        if (!lc) continue;
        if (NON_NAME_TOKENS.has(lc) || NAME_STOPWORDS.has(lc)) return false;
        if (lc.length === 1) continue;                  // middle initial — allowed
        if (!/[aeiou]/.test(lc)) return false;          // multi-letter name words need a vowel
        if (/^[A-Z]/.test(t)) realTokens++;
    }
    return realTokens >= 1;                             // ≥1 capitalised name word
}

// --- Transcript Parser ---
function parseTranscript(rawText, imageNumber, arkId) {
    const result = {
        recordType: 'other',
        classificationConfidence: 0,
        testatorName: null,
        recordYear: null,
        enslavedPersons: [],
        heirs: [],
        executors: [],
        estateValue: null,
        enslavedPropertyValue: null,
        rawText,
        imageNumber,
        arkId,
    };

    // Record-type classification is delegated to the shared classifier
    // (src/services/probate/document-classifier.js) so the scraper and the
    // roll-level segmenter apply identical rules. The old substring rule
    // ("executor" AND "will" anywhere) tagged almost every probate page as a
    // will — see the classifier header for the post-mortem.
    const classified = classifyTranscript(rawText);
    result.recordType = classified.recordType;
    result.classificationConfidence = classified.confidence;

    const yearMatches = rawText.match(/\b(18\d{2})\b/g);
    if (yearMatches && yearMatches.length > 0) {
        result.recordYear = Math.min(...yearMatches.map(y => parseInt(y, 10)));
    }

    const namePatterns = [
        /Last Will and Testament of\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/,
        /(?:Estate of|Est\.?)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/,
        /I[,\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})[,\s]+(?:being|do make|of the County)/,
        /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\s+(?:Executor|Executrix|Executors)/,
    ];
    for (const pat of namePatterns) {
        const m = rawText.match(pat);
        if (m && m[1]) {
            const candidate = normalizeName(m[1]);
            if (isValidPersonName(candidate)) {
                result.testatorName = candidate;
                break;
            }
        }
    }

    const totalValueMatch = rawText.match(/(?:total|amount|sum|appraised at|valued at)[^\d$]*\$?([\d,]+(?:\.\d{2})?)/i);
    if (totalValueMatch) {
        result.estateValue = parseFloat(totalValueMatch[1].replace(/,/g, ''));
    }

    const heirRelationPattern = /(?:to\s+my\s+(son|daughter|wife|husband|brother|sister|nephew|niece|grandson|granddaughter|mother|father|child|children|friend|cousin)[\s,]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}))/gi;
    const giveBequeath = /(?:give(?:\s+and\s+bequeath)?|devise|leave)\s+(?:unto\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})(?:\s+my\s+(son|daughter|wife|brother|sister|nephew|niece|friend|grandson|granddaughter|cousin))?/gi;

    let hm;
    while ((hm = heirRelationPattern.exec(rawText)) !== null) {
        const relation = hm[1].toLowerCase();
        const name = normalizeName(hm[2]);
        if (isValidPersonName(name) && !result.heirs.find(h => h.name === name)) {
            result.heirs.push({ name, relation, personType: 'unknown' });
        }
    }
    while ((hm = giveBequeath.exec(rawText)) !== null) {
        const name = normalizeName(hm[1]);
        const relation = hm[2] ? hm[2].toLowerCase() : 'unknown';
        if (isValidPersonName(name) && !result.heirs.find(h => h.name === name)) {
            result.heirs.push({ name, relation, personType: 'unknown' });
        }
    }

    const execPattern = /(?:appoint|constitute|make)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s+(?:my\s+)?(?:executor|executrix)/gi;
    let em;
    while ((em = execPattern.exec(rawText)) !== null) {
        const name = normalizeName(em[1]);
        if (isValidPersonName(name)) result.executors.push({ name });
    }

    const enslavedPatterns = [
        /(?:my\s+)?(?:negro|negroes|slave|slaves|servant|servants)\s+(?:man|woman|boy|girl|child)?\s+([A-Z][a-z]+)/gi,
        /(?:freedman|freedwoman)\s+([A-Z][a-z]+)/gi,
        /([A-Z][a-z]+)\s+(?:a\s+)?(?:negro|slave|servant|freedman|freedwoman)\s+(?:man|woman|boy|girl)?/gi,
        /(?:negro|negroes|freedmen)\s+named?\s+([A-Z][a-z]+(?:\s+and\s+[A-Z][a-z]+)*)/gi,
    ];

    const seenEnslaved = new Set();
    for (const pattern of enslavedPatterns) {
        let match;
        pattern.lastIndex = 0;
        while ((match = pattern.exec(rawText)) !== null) {
            const rawName = match[1].trim();
            const names = rawName.split(/\s+and\s+/i).map(n => n.trim()).filter(n => n.length > 1);
            for (const name of names) {
                const key = name.toLowerCase();
                if (seenEnslaved.has(key)) continue;
                seenEnslaved.add(key);

                const ctxStart = Math.max(0, match.index - 150);
                const ctxEnd = Math.min(rawText.length, match.index + match[0].length + 150);
                const contextText = rawText.substring(ctxStart, ctxEnd).replace(/\n+/g, ' ').trim();

                let gender = null;
                if (/(woman|girl|freedwoman)/i.test(match[0])) gender = 'F';
                else if (/(man|boy|freedman)/i.test(match[0])) gender = 'M';

                const afterBlock = rawText.substring(match.index + match[0].length, match.index + match[0].length + 80);
                let dollarValue = null;
                const dvm = afterBlock.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
                if (dvm) dollarValue = parseFloat(dvm[1].replace(/,/g, ''));

                // Skip stopwords and invalid tokens before treating as an enslaved person's name
                if (!isValidEnslavedPersonName(name)) continue;

                let bequestRecipientName = null;
                const bequestMatch = contextText.match(
                    /(?:give(?:\s+and\s+bequeath)?|devise|leave|bequeath)\s+(?:to\s+)?(?:my\s+(?:son|daughter|wife|brother|sister|nephew|niece|friend|grandson|granddaughter|cousin)\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i
                );
                if (bequestMatch) {
                    const candidate = normalizeName(bequestMatch[1]);
                    if (candidate.toLowerCase() !== name.toLowerCase() &&
                        candidate.toLowerCase() !== (result.testatorName || '').toLowerCase()) {
                        bequestRecipientName = candidate;
                    }
                }

                result.enslavedPersons.push({ name, gender, dollarValue, contextText, bequestRecipientName });
            }
        }
    }

    return result;
}

// --- Canonical Person Upsert (unchanged) ---
async function upsertCanonicalPerson(client, name, personType, deathYearEstimate, primaryCounty, primaryState) {
    // Last line of defense: never create a canonical_persons row for a string
    // that is not a person's name. Callers must treat a null return as "skip".
    if (!isValidPersonName(name)) {
        if (VERBOSE) log(`    Rejected non-name "${name}" — not creating canonical_person`);
        return null;
    }
    const normalizedName = normalizeName(name);
    const nameParts = normalizedName.split(/\s+/);
    const firstName = nameParts[0] || null;
    const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : null;

    const searchRes = await client.query(`
        SELECT id, canonical_name, death_year_estimate
        FROM canonical_persons
        WHERE primary_county ILIKE $1 AND primary_state ILIKE $2
          AND (
                canonical_name ILIKE $3
                OR (first_name ILIKE $4 AND last_name ILIKE $5)
              )
        ORDER BY
            CASE WHEN canonical_name ILIKE $3 THEN 0 ELSE 1 END,
            ABS(COALESCE(death_year_estimate, $6) - $6) ASC
        LIMIT 5;
    `, [primaryCounty, primaryState, normalizedName, firstName, lastName, deathYearEstimate || 1860]);

    let existingPersonId = null;
    let bestScore = -1;

    for (const row of searchRes.rows) {
        const dist = levenshteinDistance(normalizedName.toLowerCase(), row.canonical_name.toLowerCase());
        if (dist <= 2) {
            const yearDiff = (deathYearEstimate && row.death_year_estimate)
                ? Math.abs(deathYearEstimate - row.death_year_estimate)
                : 5;
            if (yearDiff <= 15) {
                const score = (2 - dist) * 10 + (10 - Math.min(yearDiff, 10));
                if (score > bestScore) {
                    bestScore = score;
                    existingPersonId = row.id;
                }
            }
        }
    }

    if (existingPersonId) {
        await client.query(`
            UPDATE canonical_persons
            SET person_type = $1, updated_at = NOW()
            WHERE id = $2
              AND (person_type IS NULL OR person_type = 'unknown')
              AND $1 <> 'unknown';
        `, [personType, existingPersonId]);
        if (VERBOSE) log(`    Matched canonical_person id=${existingPersonId} for "${normalizedName}"`);
        return existingPersonId;
    }

    const insertRes = await client.query(`
        INSERT INTO canonical_persons
            (canonical_name, first_name, last_name, person_type, verification_status,
             primary_county, primary_state, death_year_estimate, notes, created_at, updated_at)
        VALUES ($1, $2, $3, $4, 'pending_review', $5, $6, $7, $8, NOW(), NOW())
        RETURNING id;
    `, [
        normalizedName, firstName, lastName, personType,
        primaryCounty, primaryState, deathYearEstimate || null,
        `Auto-created by georgia-probate-scraper. Type: ${personType}.`
    ]);
    const newId = insertRes.rows[0].id;
    if (VERBOSE) log(`    Created canonical_person id=${newId} for "${normalizedName}"`);
    return newId;
}

// --- Main ---
async function main() {
    log('Starting Georgia Probate Scraper (multi-county/multi-roll)...');
    log(`  COUNTY_FILTER=${COUNTY_FILTER || 'all'}, ROLL_TITLE_FILTER=${ROLL_TITLE_FILTER || 'all'}`);
    log(`  DRY_RUN=${DRY_RUN}, APPLY=${APPLY}, RESUME=${RESUME}, LIMIT=${LIMIT || 'none'}`);

    await launchBrowser();
    await ensureLoggedIn();
    await checkAndApplyMigrations();

    let sitemap = loadSitemap();

    // Phase 0: Build/update sitemap
    sitemap = await buildSitemap(sitemap);
    saveSitemap(sitemap);

    if (sitemap.counties.length === 0) {
        log('ERROR: Sitemap is empty after Phase 0. Cannot proceed.');
        process.exit(1);
    }

    const isDryRun = DRY_RUN || !APPLY;

    // Phase 1: Scrape rolls
    for (const countyObj of sitemap.counties) {
        // --county filter
        if (COUNTY_FILTER && countyObj.county.toLowerCase() !== COUNTY_FILTER.toLowerCase()) continue;

        // --start-county filter
        if (START_COUNTY && countyObj.county.toLowerCase() < START_COUNTY.toLowerCase()) continue;

        log(`County: ${countyObj.county} (${countyObj.rolls.length} rolls)`);

        for (const roll of countyObj.rolls) {
            if (roll.status === 'complete') {
                if (VERBOSE) log(`  Roll "${roll.title}" already complete, skipping.`);
                continue;
            }
            // --roll-title filter
            if (ROLL_TITLE_FILTER && !roll.title.toLowerCase().includes(ROLL_TITLE_FILTER.toLowerCase())) continue;

            if (LIMIT > 0 && totalImagesProcessed >= LIMIT) {
                log(`Global limit of ${LIMIT} images reached.`);
                break;
            }

            await scrapeOneRoll(countyObj, roll, isDryRun);

            if (roll.status !== 'failed') {
                roll.status = 'complete';
            }
            saveSitemap(sitemap);

            await sleep(2000 + Math.random() * 1000);
        }

        if (LIMIT > 0 && totalImagesProcessed >= LIMIT) break;
    }

    log(`Scraping complete. Total images processed: ${totalImagesProcessed}`);
    await browser.disconnect();
    await pool.end();
}

main().catch(err => {
    log('FATAL ERROR:', err.message);
    console.error(err);
    process.exit(1);
});
