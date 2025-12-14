/**
 * FamilySearch Authenticated Scraper
 *
 * Scrapes transcripts from FamilySearch film viewer using Puppeteer
 * Specifically designed for Thomas Porcher Ravenel papers (Film 008891444)
 *
 * AUTHENTICATION: FamilySearch requires Google OAuth login which is very hard
 * to automate. This scraper supports two modes:
 *
 * 1. INTERACTIVE MODE (recommended):
 *    - Set FAMILYSEARCH_INTERACTIVE=true
 *    - Browser opens visibly, you manually complete Google OAuth
 *    - After login, scraper continues automatically
 *
 * 2. SESSION/COOKIE MODE:
 *    - Provide cookies from a previous login session
 *    - Set FAMILYSEARCH_COOKIES=/path/to/cookies.json
 *
 * Usage:
 *   # Interactive mode - log in manually via Google
 *   FAMILYSEARCH_INTERACTIVE=true DATABASE_URL=postgres://... \
 *   node scripts/scrapers/familysearch-scraper.js [start] [end]
 *
 *   # Cookie mode - use pre-saved cookies
 *   FAMILYSEARCH_COOKIES=./fs-cookies.json DATABASE_URL=postgres://... \
 *   node scripts/scrapers/familysearch-scraper.js [start] [end]
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');
const NameResolver = require('../../src/services/NameResolver');

// Google Vision API for OCR (same as MSA scraper)
const GOOGLE_VISION_API_KEY = process.env.GOOGLE_VISION_API_KEY;

// S3 client setup for document archival
let s3Client = null;
let s3Enabled = false;
const S3_BUCKET = process.env.S3_BUCKET;

if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && S3_BUCKET) {
    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
    s3Client = new S3Client({
        region: process.env.S3_REGION || 'us-east-2',
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        }
    });
    s3Enabled = true;
    console.log('✅ S3 storage enabled for document archival');
} else {
    console.log('⚠️  S3 storage disabled - documents will not be archived');
}

// Use stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

// Configuration
const FAMILYSEARCH_INTERACTIVE = process.env.FAMILYSEARCH_INTERACTIVE === 'true';
const FAMILYSEARCH_COOKIES = process.env.FAMILYSEARCH_COOKIES;
const DATABASE_URL = process.env.DATABASE_URL;

// Film configurations for Thomas Porcher Ravenel papers (catalog 559181)
// Film numbers 008891444 through 008891453 (Films 1-10)
const FILM_CONFIGS = {
    1: { filmNumber: '008891444', totalImages: 1355, description: 'Film 1 of 10 - COMPLETED' },
    2: { filmNumber: '008891445', totalImages: 970, description: 'Film 2 of 10' },
    3: { filmNumber: '008891446', totalImages: 1031, description: 'Film 3 of 10' },
    4: { filmNumber: '008891447', totalImages: 1058, description: 'Film 4 of 10' },
    5: { filmNumber: '008891448', totalImages: 1012, description: 'Film 5 of 10' },
    6: { filmNumber: '008891449', totalImages: 987, description: 'Film 6 of 10' },
    7: { filmNumber: '008891450', totalImages: 1045, description: 'Film 7 of 10' },
    8: { filmNumber: '008891451', totalImages: 1020, description: 'Film 8 of 10' },
    9: { filmNumber: '008891452', totalImages: 1095, description: 'Film 9 of 10' },
    10: { filmNumber: '008891453', totalImages: 1127, description: 'Film 10 of 10' }
};

// Select film from environment variable or default to Film 2
const FILM_INDEX = parseInt(process.env.FILM_INDEX || '2', 10);
const filmConfig = FILM_CONFIGS[FILM_INDEX] || FILM_CONFIGS[2];

const COLLECTION = {
    name: `Thomas Porcher Ravenel papers - Film ${FILM_INDEX}`,
    filmNumber: filmConfig.filmNumber,
    catalogId: '559181',
    dateRange: '1731-1867',
    location: 'South Carolina',
    totalImages: filmConfig.totalImages,
    description: `Diaries, daybooks, slave lists, correspondence - ${filmConfig.description}`
};

// Base URLs
const LOGIN_URL = 'https://www.familysearch.org/auth/familysearch/login';
const FILM_BASE_URL = 'https://www.familysearch.org/ark:/61903/3:1:';

// Database connection
let pool = null;
let nameResolver = null;

function initDatabase() {
    if (!DATABASE_URL) {
        console.log('⚠️  No DATABASE_URL - will output to console only');
        return null;
    }

    pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    // Initialize NameResolver for automatic name variant detection
    nameResolver = new NameResolver(pool);
    console.log('✅ NameResolver initialized for automatic name variant detection');

    return pool;
}

// Progress file for recovery
const PROGRESS_FILE = path.join(__dirname, '.fs-scraper-progress.json');

/**
 * Save scraping progress to disk for recovery after connection loss
 */
function saveProgress(filmIndex, lastImage, endImage) {
    const progress = {
        filmIndex,
        lastImage,
        endImage,
        timestamp: new Date().toISOString(),
        filmNumber: FILM_CONFIGS[filmIndex]?.filmNumber || 'unknown'
    };

    try {
        fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
        console.log(`   💾 Progress saved: Film ${filmIndex}, image ${lastImage}/${endImage}`);
    } catch (err) {
        console.error(`   ⚠️  Could not save progress: ${err.message}`);
    }
}

/**
 * Load saved progress from disk
 */
function loadProgress() {
    try {
        if (fs.existsSync(PROGRESS_FILE)) {
            const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
            console.log(`📂 Found saved progress: Film ${data.filmIndex}, image ${data.lastImage}`);
            return data;
        }
    } catch (err) {
        console.error(`⚠️  Could not load progress: ${err.message}`);
    }
    return null;
}

/**
 * Clear progress file after successful completion
 */
function clearProgress() {
    try {
        if (fs.existsSync(PROGRESS_FILE)) {
            fs.unlinkSync(PROGRESS_FILE);
            console.log('🗑️  Progress file cleared');
        }
    } catch (err) {
        // Ignore cleanup errors
    }
}

/**
 * Check if internet connection is available
 */
async function checkInternetConnection() {
    try {
        const response = await axios.get('https://www.google.com', { timeout: 5000 });
        return response.status === 200;
    } catch {
        return false;
    }
}

/**
 * Get a fresh page reference from browser (handles detached frame recovery)
 * @param {Browser} browser - Puppeteer browser instance
 * @param {Page} currentPage - Current page (may be detached)
 * @returns {Page} Fresh page reference
 */
async function getFreshPage(browser, currentPage) {
    try {
        // First try to use the current page
        if (currentPage) {
            const url = await currentPage.url().catch(() => null);
            if (url) {
                return currentPage; // Page is still valid
            }
        }
    } catch (e) {
        console.log('   ⚠️  Current page is detached, getting fresh reference...');
    }

    // Get all pages and return the most recent one
    const pages = await browser.pages();
    if (pages.length > 0) {
        const freshPage = pages[pages.length - 1];
        console.log('   🔄 Got fresh page reference');
        return freshPage;
    }

    // If no pages exist, create a new one
    const newPage = await browser.newPage();
    await newPage.setViewport({ width: 1920, height: 1080 });
    console.log('   🆕 Created new page');
    return newPage;
}

/**
 * Safely evaluate JavaScript on page with frame recovery
 * @param {Browser} browser - Puppeteer browser
 * @param {Page} page - Current page reference
 * @param {Function} fn - Function to evaluate
 * @returns {Object} { result, page } - Result and potentially new page reference
 */
async function safeEvaluate(browser, page, fn) {
    try {
        const result = await page.evaluate(fn);
        return { result, page };
    } catch (error) {
        if (error.message.includes('detached Frame') ||
            error.message.includes('Execution context was destroyed') ||
            error.message.includes('Target closed')) {
            console.log('   🔄 Frame detached, recovering...');
            const freshPage = await getFreshPage(browser, page);
            await new Promise(r => setTimeout(r, 2000));

            try {
                const result = await freshPage.evaluate(fn);
                return { result, page: freshPage };
            } catch (retryError) {
                console.log(`   ❌ Recovery evaluate failed: ${retryError.message}`);
                return { result: null, page: freshPage };
            }
        }
        throw error;
    }
}

/**
 * Safely navigate to URL with frame recovery
 * @param {Browser} browser - Puppeteer browser
 * @param {Page} page - Current page reference
 * @param {string} url - URL to navigate to
 * @param {Object} options - Navigation options
 * @returns {Page} Page reference (may be new if recovery was needed)
 */
async function safeGoto(browser, page, url, options = {}) {
    const defaultOptions = { waitUntil: 'domcontentloaded', timeout: 60000 };
    const navOptions = { ...defaultOptions, ...options };

    try {
        await page.goto(url, navOptions);
        return page;
    } catch (error) {
        if (error.message.includes('detached Frame') ||
            error.message.includes('Execution context was destroyed') ||
            error.message.includes('Target closed') ||
            error.message.includes('net::ERR')) {
            console.log(`   🔄 Navigation error: ${error.message.substring(0, 50)}..., recovering...`);
            const freshPage = await getFreshPage(browser, page);
            await new Promise(r => setTimeout(r, 3000));

            try {
                await freshPage.goto(url, navOptions);
                return freshPage;
            } catch (retryError) {
                console.log(`   ❌ Recovery navigation failed: ${retryError.message}`);
                throw retryError;
            }
        }
        throw error;
    }
}

/**
 * Wait for internet connection to be restored
 */
async function waitForInternet(maxWaitSeconds = 300) {
    console.log('\n🔌 Waiting for internet connection...');
    const startTime = Date.now();
    const maxWaitMs = maxWaitSeconds * 1000;

    while (Date.now() - startTime < maxWaitMs) {
        if (await checkInternetConnection()) {
            console.log('✅ Internet connection restored!');
            return true;
        }

        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.log(`   ⏳ No connection... waiting (${elapsed}s / ${maxWaitSeconds}s)`);
        await new Promise(r => setTimeout(r, 10000)); // Check every 10 seconds
    }

    console.log('❌ Timeout waiting for internet connection');
    return false;
}

/**
 * Attempt to recover from connection loss
 * @param {Browser} browser - Puppeteer browser instance
 * @param {Page} page - Puppeteer page instance
 * @param {number} lastImage - Last successfully processed image
 * @param {number} endImage - Target end image
 * @returns {boolean} True if recovery successful
 */
async function recoverConnection(browser, page, lastImage, endImage) {
    console.log('\n🔄 ATTEMPTING CONNECTION RECOVERY...');

    // Step 1: Wait for internet to come back
    const hasInternet = await waitForInternet(300); // Wait up to 5 minutes
    if (!hasInternet) {
        console.log('❌ Internet did not come back within timeout');
        return false;
    }

    // Step 2: Try to navigate to a simple page to test browser
    try {
        console.log('🌐 Testing browser connection...');
        await page.goto('https://www.familysearch.org', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        // Wait a moment for the page to settle
        await new Promise(r => setTimeout(r, 3000));

        // Check if we're still logged in
        const isLoggedIn = await page.evaluate(() => {
            return !document.body.innerText.includes('Sign In') ||
                   document.querySelector('[class*="signed-in"]') !== null ||
                   document.querySelector('[class*="user"]') !== null;
        });

        if (isLoggedIn) {
            console.log('✅ Browser connection restored, still logged in!');
            return true;
        } else {
            console.log('⚠️  Session expired during connection loss');

            // If interactive mode, prompt for re-login
            if (FAMILYSEARCH_INTERACTIVE) {
                console.log('\n🔐 Please log in again in the browser window...');
                console.log('   (You have 5 minutes to complete login)');

                // Wait for login
                const loginSuccess = await Promise.race([
                    (async () => {
                        // Wait for sign-in to complete (URL changes or sign-in button disappears)
                        await page.waitForFunction(() => {
                            return !document.body.innerText.includes('Sign In') ||
                                   window.location.href.includes('/search');
                        }, { timeout: 300000 });
                        return true;
                    })(),
                    new Promise(resolve => setTimeout(() => resolve(false), 300000))
                ]);

                if (loginSuccess) {
                    console.log('✅ Re-login successful!');
                    return true;
                }
            }

            console.log('❌ Could not restore session');
            return false;
        }
    } catch (error) {
        console.log(`❌ Recovery failed: ${error.message}`);

        // Browser might be completely dead, need to restart
        console.log('⚠️  Browser appears unresponsive');
        console.log(`   Run command to resume: FILM_INDEX=${FILM_INDEX} node scripts/scrapers/familysearch-scraper.js ${lastImage + 1} ${endImage}`);
        return false;
    }
}

/**
 * Perform OCR on an image using Google Vision API
 * @param {Buffer} imageBuffer - Image data as buffer
 * @returns {string} Extracted text
 */
async function performGoogleVisionOCR(imageBuffer) {
    if (!GOOGLE_VISION_API_KEY) {
        throw new Error('GOOGLE_VISION_API_KEY not set - cannot perform OCR');
    }

    try {
        // Resize image for optimal OCR (similar to MSA scraper)
        const resizedBuffer = await sharp(imageBuffer)
            .resize(2500, null, { fit: 'inside', withoutEnlargement: true })
            .png()
            .toBuffer();

        console.log(`   📷 Image prepared: ${Math.round(resizedBuffer.length / 1024)}KB`);

        // Call Google Vision API
        const response = await axios.post(
            `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_VISION_API_KEY}`,
            {
                requests: [{
                    image: { content: resizedBuffer.toString('base64') },
                    features: [{ type: 'DOCUMENT_TEXT_DETECTION' }]
                }]
            },
            { timeout: 60000 }
        );

        const text = response.data.responses[0]?.fullTextAnnotation?.text || '';
        console.log(`   📝 Google Vision OCR: ${text.length} chars extracted`);

        return text;
    } catch (error) {
        console.error(`   ❌ Google Vision OCR error: ${error.message}`);
        return '';
    }
}

/**
 * Upload image to S3 for permanent archival
 * @param {Buffer} imageBuffer - Image data
 * @param {number} imageNumber - Image number in collection
 * @returns {string|null} S3 URL or null if upload failed
 */
async function uploadToS3(imageBuffer, imageNumber) {
    if (!s3Enabled || !imageBuffer) return null;

    try {
        const { PutObjectCommand } = require('@aws-sdk/client-s3');
        const key = `archives/familysearch/film-${COLLECTION.filmNumber}/image-${String(imageNumber).padStart(4, '0')}.png`;

        await s3Client.send(new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: key,
            Body: imageBuffer,
            ContentType: 'image/png',
            Metadata: {
                'source': 'familysearch',
                'film-number': COLLECTION.filmNumber,
                'catalog-id': COLLECTION.catalogId,
                'collection-name': COLLECTION.name,
                'image-number': String(imageNumber),
                'date-archived': new Date().toISOString()
            }
        }));

        const s3Url = `https://${S3_BUCKET}.s3.amazonaws.com/${key}`;
        console.log(`   ☁️  Archived to S3: ${key}`);
        return s3Url;
    } catch (error) {
        console.error(`   ❌ S3 upload error: ${error.message}`);
        return null;
    }
}

/**
 * Download image from FamilySearch viewer using Puppeteer
 * @param {Page} page - Puppeteer page
 * @returns {Buffer|null} Image buffer or null
 */
async function downloadImageFromViewer(page) {
    try {
        // Try to find the main image element in the viewer
        const imageData = await page.evaluate(() => {
            // FamilySearch uses various selectors for the image
            const selectors = [
                '.image-viewer img',
                '.viewer-image img',
                'img[src*="tile"]',
                'img[src*="image"]',
                '.film-strip img',
                'canvas',
                'img.main-image',
                'img[class*="viewer"]',
                'img[class*="image"]'
            ];

            // Try to find an image
            for (const selector of selectors) {
                const el = document.querySelector(selector);
                if (el && el.tagName === 'IMG' && el.src) {
                    return { type: 'img', src: el.src };
                }
                if (el && el.tagName === 'CANVAS') {
                    return { type: 'canvas', data: el.toDataURL('image/png') };
                }
            }

            // Try to find image URL from background-image
            const bgElements = document.querySelectorAll('[style*="background-image"]');
            for (const el of bgElements) {
                const style = el.getAttribute('style');
                const match = style.match(/url\(['"']?([^'"']+)['"']?\)/);
                if (match && match[1].includes('image')) {
                    return { type: 'img', src: match[1] };
                }
            }

            return null;
        });

        if (!imageData) {
            console.log('   ⚠️  Could not find image element in viewer');
            return null;
        }

        if (imageData.type === 'canvas') {
            // Canvas data URL
            const base64 = imageData.data.replace(/^data:image\/\w+;base64,/, '');
            return Buffer.from(base64, 'base64');
        }

        if (imageData.type === 'img' && imageData.src) {
            console.log(`   🔗 Image URL found: ${imageData.src.substring(0, 80)}...`);

            // Get cookies for authenticated download
            const cookies = await page.cookies();
            const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

            // Download the image with cookies
            const response = await axios.get(imageData.src, {
                responseType: 'arraybuffer',
                headers: {
                    'Cookie': cookieString,
                    'Referer': 'https://www.familysearch.org/',
                    'User-Agent': await page.evaluate(() => navigator.userAgent)
                },
                timeout: 60000
            });

            return Buffer.from(response.data);
        }

        return null;
    } catch (error) {
        console.error(`   ❌ Image download error: ${error.message}`);
        return null;
    }
}

/**
 * Take a screenshot of the viewer area and use that for OCR
 * @param {Page} page - Puppeteer page
 * @returns {Buffer|null} Screenshot buffer
 */
async function screenshotViewerArea(page) {
    try {
        // FamilySearch renders documents in the center of the viewport
        // Element selectors like [class*="viewer"] often match empty containers
        // Best approach: take viewport screenshot and crop to document area

        // First, try to find the actual image element bounds
        const imageBounds = await page.evaluate(() => {
            // Look for the main document image
            const selectors = [
                'img.main-image',
                'img[class*="image"]',
                'img[src*="tile"]',
                '.openseadragon-container',
                'canvas',
                // Large images in the viewer
                'img'
            ];

            for (const selector of selectors) {
                const elements = document.querySelectorAll(selector);
                for (const el of elements) {
                    const rect = el.getBoundingClientRect();
                    // Look for sizable elements (not thumbnails)
                    if (rect.width > 300 && rect.height > 300) {
                        return {
                            found: true,
                            x: Math.max(0, rect.x),
                            y: Math.max(0, rect.y),
                            width: rect.width,
                            height: rect.height,
                            selector: selector
                        };
                    }
                }
            }

            // If no specific element found, return center region of viewport
            return {
                found: false,
                x: 200,
                y: 100,
                width: window.innerWidth - 400,
                height: window.innerHeight - 200
            };
        });

        if (imageBounds.found) {
            console.log(`   🎯 Found document at ${imageBounds.selector}: ${Math.round(imageBounds.width)}x${Math.round(imageBounds.height)}`);
        }

        // Take viewport screenshot (not fullPage - just what's visible)
        const fullScreenshot = await page.screenshot({
            type: 'png',
            fullPage: false
        });

        // If we have good bounds, crop the image to just the document area
        if (imageBounds.width > 300 && imageBounds.height > 300) {
            try {
                const croppedScreenshot = await sharp(fullScreenshot)
                    .extract({
                        left: Math.round(imageBounds.x),
                        top: Math.round(imageBounds.y),
                        width: Math.round(Math.min(imageBounds.width, 1920 - imageBounds.x)),
                        height: Math.round(Math.min(imageBounds.height, 1080 - imageBounds.y))
                    })
                    .png()
                    .toBuffer();

                console.log(`   📸 Cropped screenshot: ${Math.round(croppedScreenshot.length / 1024)}KB`);
                return croppedScreenshot;
            } catch (cropError) {
                console.log(`   ⚠️  Crop failed: ${cropError.message}, using full viewport`);
            }
        }

        console.log(`   📸 Viewport screenshot: ${Math.round(fullScreenshot.length / 1024)}KB`);
        return fullScreenshot;
    } catch (error) {
        console.error(`   ❌ Screenshot error: ${error.message}`);
        return null;
    }
}

/**
 * Parse transcript text using interpretive framework
 * Centers enslaved persons, tracks resistance, identifies relationships
 */
function parseTranscript(text, imageNumber) {
    const result = {
        enslavedPersons: [],
        slaveholders: [],
        events: [],
        locations: [],
        dates: [],
        resistanceIndicators: [],
        rawText: text
    };

    if (!text || text.length < 20) return result;

    // Normalize text
    const normalizedText = text.replace(/\s+/g, ' ').trim();
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Common enslaved name patterns in SC plantation records
    // Many are Akan day names or anglicized African names
    const africanDayNames = [
        'Quash', 'Quashee', 'Cudjoe', 'Cudjo', 'Cuffee', 'Cuffy',
        'Quaco', 'Kwaku', 'Juba', 'Phibba', 'Phoebe', 'Abba',
        'Cuba', 'Mingo', 'Sambo', 'Cato', 'Pompey', 'Caesar',
        'Scipio', 'Prince', 'Fortune', 'July', 'Monday', 'Friday'
    ];

    // Resistance indicators (following interpretive framework)
    const resistancePatterns = [
        /\b(runaway|ran away|absconded|escaped|fugitive)\b/gi,
        /\b(conspiracy|uprising|revolt|insurrection|rebellion)\b/gi,
        /\b(punish|whip|whipped|flogged|sold for|transported)\b/gi,
        /\b(pardon|sentence|convicted|trial|jail)\b/gi,
        /\b(maroon|outlying|outliers)\b/gi,
        /\b(refuse|refused|resist|resisted|trouble)\b/gi
    ];

    // Check for resistance indicators
    for (const pattern of resistancePatterns) {
        const matches = normalizedText.match(pattern);
        if (matches) {
            result.resistanceIndicators.push(...matches.map(m => m.toLowerCase()));
        }
    }

    // Extract potential enslaved names
    // Pattern: Look for names followed by occupational/status markers
    const namePatterns = [
        // "Negro [Name]" or "Negroe [Name]"
        /\b(?:negro|negroe|black)\s+([A-Z][a-z]+)/gi,
        // "[Name] a negro/slave"
        /\b([A-Z][a-z]+)\s+(?:a\s+)?(?:negro|slave|servant)/gi,
        // African day names
        new RegExp(`\\b(${africanDayNames.join('|')})\\b`, 'gi'),
        // "my/the [role] [Name]" - e.g., "my driver Moses"
        /\b(?:my|the|our)\s+(?:driver|cook|servant|slave|man|woman|boy|girl)\s+([A-Z][a-z]+)/gi
    ];

    const foundNames = new Set();

    for (const pattern of namePatterns) {
        let match;
        while ((match = pattern.exec(normalizedText)) !== null) {
            const name = match[1]?.trim();
            if (name && name.length > 1 && !foundNames.has(name.toLowerCase())) {
                foundNames.add(name.toLowerCase());

                // Get context around the match
                const contextStart = Math.max(0, match.index - 50);
                const contextEnd = Math.min(normalizedText.length, match.index + match[0].length + 50);
                const context = normalizedText.slice(contextStart, contextEnd);

                result.enslavedPersons.push({
                    name: name,
                    context: context,
                    page: imageNumber,
                    confidence: 0.65 // Lower confidence for diary entries vs tabular records
                });
            }
        }
    }

    // Extract slaveholder names (Ravenel family patterns)
    const slaveholderPatterns = [
        /\b(Ravenel|Porcher|Pringle|Middleton|Pinckney)\b/gi,
        /\b(Mr\.|Mrs\.|Dr\.|Col\.|Capt\.)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g
    ];

    for (const pattern of slaveholderPatterns) {
        let match;
        while ((match = pattern.exec(normalizedText)) !== null) {
            const name = match[2] || match[1];
            if (name && !foundNames.has(name.toLowerCase())) {
                result.slaveholders.push({
                    name: name.trim(),
                    page: imageNumber
                });
            }
        }
    }

    // Extract dates
    const datePattern = /\b(\d{1,2})\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*(\d{4})?\b/gi;
    let dateMatch;
    while ((dateMatch = datePattern.exec(normalizedText)) !== null) {
        result.dates.push(dateMatch[0]);
    }

    // Extract locations (SC plantations, places)
    const locationPatterns = [
        /\b(Pine\s*Ville|Pineville|Charleston|Santee|Cooper\s*River)\b/gi,
        /\b(plantation|quarter|field|house)\b/gi
    ];

    for (const pattern of locationPatterns) {
        let match;
        while ((match = pattern.exec(normalizedText)) !== null) {
            if (!result.locations.includes(match[0])) {
                result.locations.push(match[0]);
            }
        }
    }

    // Extract events (deaths, births, weather, crop references)
    const eventPatterns = [
        /\b(died|death|born|birth|married|buried)\b/gi,
        /\b(frost|snow|storm|gale|hurricane)\b/gi,
        /\b(cotton|rice|crop|harvest|plant)\b/gi
    ];

    for (const pattern of eventPatterns) {
        let match;
        while ((match = pattern.exec(normalizedText)) !== null) {
            result.events.push(match[0].toLowerCase());
        }
    }

    return result;
}

/**
 * Save parsed data to database
 * @param {Object} parsed - Parsed data with enslaved persons, slaveholders, etc.
 * @param {number} imageNumber - Image number in collection
 * @param {string} transcriptText - Full transcript text
 * @param {string|null} s3Url - S3 archive URL (if uploaded)
 */
async function saveToDatabase(parsed, imageNumber, transcriptText, s3Url = null) {
    if (!pool) return;

    const sourceUrl = `https://www.familysearch.org/search/film/${COLLECTION.filmNumber}?i=${imageNumber - 1}&cat=${COLLECTION.catalogId}`;
    const archiveNote = s3Url ? `\n\nARCHIVED DOCUMENT: ${s3Url}` : '';
    const s3Key = s3Url ? `archives/familysearch/film-${COLLECTION.filmNumber}/image-${String(imageNumber).padStart(4, '0')}.png` : null;

    const citation = `FamilySearch, ${COLLECTION.name}, Film ${COLLECTION.filmNumber}, image ${imageNumber}. ` +
                    `${COLLECTION.description}, ${COLLECTION.dateRange}. ${COLLECTION.location}.${archiveNote}`;

    try {
        // Save enslaved persons
        for (const person of parsed.enslavedPersons) {
            await pool.query(`
                INSERT INTO unconfirmed_persons (
                    full_name, person_type, source_url, source_page_title,
                    extraction_method, context_text, confidence_score, source_type
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT DO NOTHING
            `, [
                person.name,
                'enslaved',
                sourceUrl,
                `${COLLECTION.name} - Image ${imageNumber}`,
                'familysearch_scraper',
                `${citation}\n\nContext: "${person.context}"\n\n` +
                (parsed.resistanceIndicators.length > 0
                    ? `RESISTANCE INDICATORS: ${parsed.resistanceIndicators.join(', ')}\n\n`
                    : '') +
                `Full transcript available.`,
                person.confidence,
                'primary'
            ]);
        }

        // Save slaveholders
        for (const person of parsed.slaveholders) {
            await pool.query(`
                INSERT INTO unconfirmed_persons (
                    full_name, person_type, source_url, source_page_title,
                    extraction_method, context_text, confidence_score, source_type
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT DO NOTHING
            `, [
                person.name,
                'slaveholder',
                sourceUrl,
                `${COLLECTION.name} - Image ${imageNumber}`,
                'familysearch_scraper',
                citation,
                0.70,
                'primary'
            ]);
        }

        console.log(`   💾 Saved ${parsed.enslavedPersons.length} enslaved, ${parsed.slaveholders.length} slaveholders`);

        // Run name resolution and save to person_documents junction table
        if (nameResolver) {
            let linkedCount = 0;
            let queuedCount = 0;
            let newCount = 0;
            let docsIndexed = 0;

            // Process all persons through name resolver
            const allPersons = [
                ...parsed.enslavedPersons.map(p => ({ ...p, personType: 'enslaved' })),
                ...parsed.slaveholders.map(p => ({ ...p, personType: 'slaveholder' }))
            ];

            for (const person of allPersons) {
                try {
                    const result = await nameResolver.resolveOrCreate(person.name, {
                        sex: null, // Not available from OCR
                        personType: person.personType,
                        state: COLLECTION.location,
                        county: null,
                        sourceType: 'familysearch_scraper',
                        sourceUrl: sourceUrl,
                        createdBy: 'familysearch_scraper'
                    });

                    if (result.action === 'linked_existing') {
                        linkedCount++;
                    } else if (result.action === 'queued_for_review') {
                        queuedCount++;
                    } else if (result.action === 'created_new') {
                        newCount++;
                    }

                    // Index this document to the person (person_documents junction table)
                    // This allows retrieving all documents for a person
                    if (s3Url) {
                        try {
                            await pool.query(`
                                INSERT INTO person_documents (
                                    canonical_person_id,
                                    unconfirmed_person_id,
                                    name_as_appears,
                                    s3_url,
                                    s3_key,
                                    source_url,
                                    source_type,
                                    collection_name,
                                    film_number,
                                    image_number,
                                    ocr_text,
                                    context_snippet,
                                    person_type,
                                    document_type,
                                    extraction_confidence,
                                    created_by
                                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                                ON CONFLICT DO NOTHING
                            `, [
                                result.canonicalPersonId || null,
                                result.unconfirmedPersonId || null,
                                person.name,
                                s3Url,
                                s3Key,
                                sourceUrl,
                                'familysearch',
                                COLLECTION.name,
                                COLLECTION.filmNumber,
                                imageNumber,
                                transcriptText,
                                person.context || null,
                                person.personType,
                                'plantation_record', // Ravenel papers are diaries/daybooks
                                person.confidence || 0.70,
                                'familysearch_scraper'
                            ]);
                            docsIndexed++;
                        } catch (docErr) {
                            // Table might not exist yet if migration hasn't run
                            if (!docErr.message.includes('does not exist')) {
                                console.error(`   ⚠️  Document indexing error: ${docErr.message}`);
                            }
                        }
                    }
                } catch (resolverErr) {
                    // Don't fail the whole save if name resolution fails for one person
                    // Just log and continue
                }
            }

            if (linkedCount + queuedCount + newCount > 0) {
                console.log(`   🔗 Name resolution: ${linkedCount} linked, ${queuedCount} queued, ${newCount} new`);
            }
            if (docsIndexed > 0) {
                console.log(`   📑 Indexed ${docsIndexed} person-document links`);
            }
        }
    } catch (error) {
        console.error(`   ❌ Database error: ${error.message}`);
    }
}

/**
 * Check if page shows an error (e.g., "Something Went Wrong", invalid ARK)
 * @param {Page} page - Puppeteer page
 * @returns {Object} { isError: boolean, errorType: string|null }
 */
async function checkForErrorPage(page) {
    try {
        const errorState = await page.evaluate(() => {
            const bodyText = document.body.innerText || '';
            const title = document.title || '';

            // Check for "Something Went Wrong" error
            if (bodyText.includes('Something Went Wrong') ||
                bodyText.includes('Something went wrong') ||
                title.includes('Error')) {
                return { isError: true, errorType: 'something_went_wrong', message: bodyText.substring(0, 200) };
            }

            // Check for invalid ARK error
            if (bodyText.includes('is invalid') || bodyText.includes('ark') && bodyText.includes('invalid')) {
                return { isError: true, errorType: 'invalid_ark', message: bodyText.substring(0, 200) };
            }

            // Check for 404 or not found
            if (bodyText.includes('Page Not Found') || bodyText.includes('404') ||
                title.includes('404') || title.includes('Not Found')) {
                return { isError: true, errorType: 'not_found', message: bodyText.substring(0, 200) };
            }

            // Check for rate limiting
            if (bodyText.includes('rate limit') || bodyText.includes('too many requests') ||
                bodyText.includes('slow down')) {
                return { isError: true, errorType: 'rate_limit', message: bodyText.substring(0, 200) };
            }

            // Check for session expired
            if (bodyText.includes('session expired') || bodyText.includes('sign in again')) {
                return { isError: true, errorType: 'session_expired', message: bodyText.substring(0, 200) };
            }

            return { isError: false, errorType: null };
        });

        return errorState;
    } catch (e) {
        return { isError: false, errorType: null, checkError: e.message };
    }
}

/**
 * Recover from error page by navigating back to gallery and retrying
 * @param {Page} page - Puppeteer page
 * @param {number} imageNum - Current image number
 * @param {number} retryCount - Current retry attempt
 * @returns {boolean} True if recovery successful
 */
async function recoverFromError(page, imageNum, retryCount = 0) {
    const MAX_RETRIES = 3;

    if (retryCount >= MAX_RETRIES) {
        console.log(`   ❌ Max retries (${MAX_RETRIES}) reached for image ${imageNum}`);
        return false;
    }

    console.log(`   🔄 Attempting recovery (attempt ${retryCount + 1}/${MAX_RETRIES})...`);

    try {
        // Exponential backoff wait
        const waitTime = Math.min(5000 * Math.pow(2, retryCount), 30000);
        console.log(`   ⏳ Waiting ${waitTime/1000}s before retry...`);
        await new Promise(r => setTimeout(r, waitTime));

        // Navigate back to gallery
        const galleryUrl = `https://www.familysearch.org/search/film/${COLLECTION.filmNumber}?cat=${COLLECTION.catalogId}`;
        console.log(`   🔗 Navigating back to gallery...`);
        await page.goto(galleryUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 3000));

        // Check if we're back on a valid page
        const errorCheck = await checkForErrorPage(page);
        if (errorCheck.isError) {
            console.log(`   ⚠️  Still on error page, trying again...`);
            return await recoverFromError(page, imageNum, retryCount + 1);
        }

        console.log(`   ✅ Successfully recovered to gallery`);
        return true;
    } catch (e) {
        console.log(`   ❌ Recovery failed: ${e.message}`);
        return await recoverFromError(page, imageNum, retryCount + 1);
    }
}

/**
 * Wait for user to complete Google OAuth login
 */
async function waitForLogin(page, targetUrl) {
    console.log('\n🔑 INTERACTIVE LOGIN MODE');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('A Chrome window should have opened. Please:');
    console.log('  1. Look for the FamilySearch login page in THAT window');
    console.log('  2. Click "Continue with Google" and complete login');
    console.log('  3. Navigate to the film viewer page after login');
    console.log('');
    console.log('The scraper will detect when you are logged in.');
    console.log('═══════════════════════════════════════════════════════════════\n');

    // Check every 2 seconds if we're logged in
    let attempts = 0;
    const maxAttempts = 150; // 5 minutes max wait

    while (attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 2000));
        attempts++;

        const currentUrl = page.url();

        // Debug every 15 seconds
        if (attempts % 7 === 0) {
            console.log(`   📍 Current URL: ${currentUrl.substring(0, 80)}...`);
        }

        // Multiple login detection methods:
        // 1. On the target ark page with content
        const isOnArk = currentUrl.includes('ark:/61903') && !currentUrl.includes('ident.familysearch');

        // 2. On a film viewer page (with or without /en/ prefix)
        const isOnFilmPage = currentUrl.includes('/search/film/') || currentUrl.includes('/film/');

        // 3. On FamilySearch homepage (logged in redirect)
        const isOnHomepage = currentUrl === 'https://www.familysearch.org/' ||
                            currentUrl === 'https://www.familysearch.org/en/' ||
                            currentUrl.includes('familysearch.org/search') ||
                            currentUrl.includes('familysearch.org/tree');

        // 4. Not on login/ident pages
        const notOnLogin = !currentUrl.includes('ident.familysearch') &&
                          !currentUrl.includes('/auth/') &&
                          !currentUrl.includes('accounts.google.com');

        // Check if on film page and logged in
        if (isOnFilmPage && notOnLogin) {
            // Lower threshold - FamilySearch SPA might still be loading
            const bodyLength = await page.evaluate(() => document.body.innerText.length);
            // Check for images (thumbnails) as indicator of successful load
            const hasImages = await page.evaluate(() => document.querySelectorAll('img').length > 3);
            if (bodyLength > 100 || hasImages) {
                console.log(`✅ Login detected! On film viewer page (body: ${bodyLength} chars, images: ${hasImages}).\n`);
                return true;
            }
        }

        if (isOnArk) {
            // Check if page has actual content
            const bodyLength = await page.evaluate(() => document.body.innerText.length);
            if (bodyLength > 200) {
                console.log('✅ Login detected! On target page with content.\n');
                return true;
            }
        }

        if (isOnHomepage && notOnLogin) {
            console.log('✅ Login detected! Redirecting to target page...\n');
            // Navigate to our target film page
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await new Promise(r => setTimeout(r, 3000));
            return true;
        }

        if (attempts % 10 === 0) {
            console.log(`   ⏳ Waiting for login... (${attempts * 2}s elapsed)`);
        }
    }

    throw new Error('Login timeout - did not complete within 5 minutes');
}

/**
 * Load cookies from file
 */
async function loadCookies(page, cookieFile) {
    try {
        const cookiesData = fs.readFileSync(cookieFile, 'utf8');
        const cookies = JSON.parse(cookiesData);
        await page.setCookie(...cookies);
        console.log(`   ✅ Loaded ${cookies.length} cookies from ${cookieFile}`);
        return true;
    } catch (error) {
        console.error(`   ❌ Failed to load cookies: ${error.message}`);
        return false;
    }
}

/**
 * Save cookies to file for future sessions
 */
async function saveCookies(page, cookieFile) {
    try {
        const cookies = await page.cookies();
        fs.writeFileSync(cookieFile, JSON.stringify(cookies, null, 2));
        console.log(`   💾 Saved ${cookies.length} cookies to ${cookieFile}`);
    } catch (error) {
        console.error(`   ⚠️  Failed to save cookies: ${error.message}`);
    }
}

/**
 * Main scraper function
 */
async function scrape(startImage = 1, endImage = COLLECTION.totalImages) {
    // Validate auth mode
    if (!FAMILYSEARCH_INTERACTIVE && !FAMILYSEARCH_COOKIES) {
        console.error('❌ No authentication method specified!');
        console.error('');
        console.error('   Option 1 - Interactive mode (recommended for first run):');
        console.error('   FAMILYSEARCH_INTERACTIVE=true node scripts/scrapers/familysearch-scraper.js');
        console.error('');
        console.error('   Option 2 - Cookie mode (for subsequent runs):');
        console.error('   FAMILYSEARCH_COOKIES=./fs-cookies.json node scripts/scrapers/familysearch-scraper.js');
        console.error('');
        process.exit(1);
    }

    console.log('\n======================================================================');
    console.log('🔍 FAMILYSEARCH AUTHENTICATED SCRAPER');
    console.log('======================================================================');
    console.log(`Collection: ${COLLECTION.name}`);
    console.log(`Film: ${COLLECTION.filmNumber}`);
    console.log(`Images: ${startImage} to ${endImage} (of ${COLLECTION.totalImages})`);
    console.log(`Date Range: ${COLLECTION.dateRange}`);
    console.log(`Auth Mode: ${FAMILYSEARCH_INTERACTIVE ? 'Interactive (Google OAuth)' : 'Cookie file'}`);
    console.log(`OCR: ${GOOGLE_VISION_API_KEY ? '✅ Google Vision API available' : '❌ No OCR (set GOOGLE_VISION_API_KEY)'}`);
    console.log('======================================================================\n');

    // Initialize database
    initDatabase();

    // Launch browser - use a persistent user data directory to appear more legitimate
    // This helps bypass Google's "This browser or app may not be secure" error
    const userDataDir = path.join(process.cwd(), '.chrome-profile');

    console.log('🚀 Launching browser with persistent profile...');
    console.log(`   Profile directory: ${userDataDir}`);

    const browser = await puppeteer.launch({
        headless: false, // Always visible - need to see login
        // Use system Chrome instead of bundled Chromium for better Google compatibility
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        userDataDir: userDataDir, // Persist cookies, localStorage, etc.
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1920,1080',
            '--start-maximized',
            // Remove automation flags that Google detects
            '--disable-infobars',
            '--disable-extensions'
        ],
        ignoreDefaultArgs: ['--enable-automation'], // Remove automation flag
        defaultViewport: null
    });

    let page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    // Minimal headers - avoid CORS issues
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9'
    });

    const cookieSavePath = FAMILYSEARCH_COOKIES || './fs-cookies.json';

    try {
        // Load cookies if available
        if (FAMILYSEARCH_COOKIES && fs.existsSync(FAMILYSEARCH_COOKIES)) {
            console.log('🍪 Loading saved cookies...');
            await loadCookies(page, FAMILYSEARCH_COOKIES);
        }

        // Navigate to target page using film number URL format
        const targetUrl = `https://www.familysearch.org/search/film/${COLLECTION.filmNumber}?cat=${COLLECTION.catalogId}&i=0`;
        console.log(`🔗 Navigating to: ${targetUrl}`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // Wait for page to settle
        await new Promise(r => setTimeout(r, 3000));

        // Check if we need to login
        const currentUrl = page.url();
        const needsLogin = currentUrl.includes('ident.familysearch.org') ||
                          currentUrl.includes('/auth/') ||
                          currentUrl.includes('signin') ||
                          currentUrl.includes('accounts.google.com');

        if (needsLogin) {
            if (FAMILYSEARCH_INTERACTIVE) {
                // Wait for user to manually complete Google OAuth
                await waitForLogin(page, targetUrl);

                // Save cookies for future sessions
                await saveCookies(page, cookieSavePath);
            } else {
                throw new Error('Cookies expired or invalid. Please run in interactive mode to re-authenticate.');
            }
        } else {
            // Already logged in via cookies
            console.log('✅ Already logged in (via cookies)\n');
        }

        // Verify we're on the right page
        await page.screenshot({ path: '/tmp/fs-after-login.png' });
        console.log('📸 Screenshot saved to /tmp/fs-after-login.png');

        // Process each image
        let totalEnslaved = 0;
        let totalSlaveholders = 0;
        let successCount = 0;
        let errorCount = 0;

        // Connection recovery tracking
        let consecutiveErrors = 0;
        let lastSuccessfulImage = startImage - 1;

        // Track if we're in the viewer (after first successful click)
        let inViewer = false;

        for (let imageNum = startImage; imageNum <= endImage; imageNum++) {
            console.log(`📄 Processing image ${imageNum}/${endImage}...`);

            try {
                // STRATEGY: For the first image, navigate to gallery and click thumbnail.
                // For subsequent images, use keyboard navigation (arrow keys) within the viewer.

                if (!inViewer || imageNum === startImage) {
                    // First image or recovery: Navigate to gallery and click into viewer
                    const galleryWithImage = `https://www.familysearch.org/search/film/${COLLECTION.filmNumber}?cat=${COLLECTION.catalogId}&i=${imageNum - 1}`;
                    console.log(`   🔗 Navigating to gallery at image ${imageNum}...`);

                    // Use safe navigation with frame recovery
                    page = await safeGoto(browser, page, galleryWithImage);
                    await new Promise(r => setTimeout(r, 3000));

                    // Click the highlighted/selected thumbnail to enter the full viewer
                    console.log(`   🖱️  Clicking thumbnail to open image viewer...`);
                    const { result: thumbnailClicked, page: newPage } = await safeEvaluate(browser, page, () => {
                        // The ?i=XXX parameter highlights/selects a specific thumbnail
                        // Look for selected/highlighted thumbnail first
                        const selectedSelectors = [
                            '[class*="selected"] img',
                            '[class*="active"] img',
                            '[class*="current"] img',
                            '[class*="highlight"] img',
                            '[aria-selected="true"] img',
                            '.filmstrip-item.selected img',
                            'img[style*="border"]'
                        ];

                        for (const selector of selectedSelectors) {
                            const el = document.querySelector(selector);
                            if (el) {
                                el.click();
                                return { clicked: true, selector: selector };
                            }
                        }

                        // Fallback: Look for thumbnail images that are sized like thumbnails (not icons)
                        // CRITICAL: Only click images from FamilySearch domains, never external ads
                        const thumbnails = Array.from(document.querySelectorAll('img')).filter(img => {
                            const rect = img.getBoundingClientRect();
                            const src = img.src || '';
                            // Must be from FamilySearch domain
                            const isFamilySearchImage = src.includes('familysearch.org') ||
                                                        src.includes('fs.net') ||
                                                        src.startsWith('data:') ||
                                                        src.startsWith('blob:');
                            // Exclude external/promotional images
                            const isExternal = src.includes('churchofjesuschrist') ||
                                              src.includes('comeuntochrist') ||
                                              src.includes('lds.org') ||
                                              src.includes('churchnews');
                            // Thumbnail-sized images (not tiny icons, not full-size)
                            return isFamilySearchImage && !isExternal &&
                                   rect.width > 60 && rect.width < 300 && rect.height > 80 && rect.height < 400 &&
                                   !src.includes('logo') && !src.includes('icon') &&
                                   rect.top >= 0 && rect.bottom <= window.innerHeight;
                        });

                        if (thumbnails.length > 0) {
                            // Click the first visible thumbnail (should be the one scrolled to)
                            thumbnails[0].click();
                            return { clicked: true, selector: 'first visible thumbnail', count: thumbnails.length };
                        }

                        // Last resort: find any clickable image FROM FAMILYSEARCH ONLY
                        const allImages = Array.from(document.querySelectorAll('img')).filter(img => {
                            const src = img.src || '';
                            const isFamilySearchImage = src.includes('familysearch.org') ||
                                                        src.includes('fs.net') ||
                                                        src.startsWith('data:') ||
                                                        src.startsWith('blob:');
                            const isExternal = src.includes('churchofjesuschrist') ||
                                              src.includes('comeuntochrist') ||
                                              src.includes('lds.org') ||
                                              src.includes('churchnews');
                            return isFamilySearchImage && !isExternal &&
                                   img.offsetWidth > 50 && img.offsetHeight > 50 &&
                                   !src.includes('logo') && !src.includes('icon');
                        });
                        if (allImages.length > 0) {
                            allImages[0].click();
                            return { clicked: true, selector: 'any image', count: allImages.length };
                        }

                        return { clicked: false, thumbnailCount: thumbnails.length };
                    });

                    // Update page reference if safeEvaluate got a fresh one
                    if (newPage) page = newPage;

                    if (thumbnailClicked && thumbnailClicked.clicked) {
                        console.log(`   ✅ Clicked thumbnail (${thumbnailClicked.selector})`);
                        // Wait for the full image viewer to load
                        await new Promise(r => setTimeout(r, 4000));
                        inViewer = true;
                    } else {
                        console.log(`   ⚠️  Could not click any thumbnail`);
                        errorCount++;
                        inViewer = false;
                        continue;
                    }
                } else {
                    // Already in viewer - use keyboard navigation to go to next image
                    console.log(`   ➡️  Using keyboard navigation to next image...`);

                    // Press Right Arrow key to go to next image
                    await page.keyboard.press('ArrowRight');
                    await new Promise(r => setTimeout(r, 2500)); // Wait for image transition

                    // Verify we're still in viewer and image changed
                    const stillInViewer = await page.evaluate(() => {
                        // Check for image viewer elements
                        const hasViewer = !!document.querySelector('.image-viewer, [class*="image-viewer"], [class*="ImageViewer"], canvas, img[class*="main"]');
                        const hasLargeImage = Array.from(document.querySelectorAll('img')).some(img => img.offsetWidth > 500);
                        return hasViewer || hasLargeImage;
                    });

                    if (!stillInViewer) {
                        console.log(`   ⚠️  Lost viewer context, re-navigating...`);
                        inViewer = false;
                        imageNum--; // Retry this image
                        continue;
                    }
                }

                // Wait for the image viewer to fully load
                console.log(`   ⏳ Waiting for image viewer...`);

                // Wait for viewer to mount
                try {
                    await page.waitForFunction(() => {
                        // Check for image viewer elements
                        const hasViewer = !!document.querySelector('.image-viewer, [class*="image-viewer"], [class*="ImageViewer"], canvas, img[class*="main"]');
                        // Check for full-size image
                        const hasLargeImage = Array.from(document.querySelectorAll('img')).some(img => img.offsetWidth > 500);
                        return hasViewer || hasLargeImage;
                    }, { timeout: 15000 });
                    console.log(`   ✅ Image viewer loaded`);
                } catch (e) {
                    console.log(`   ⚠️  Image viewer check timed out, continuing anyway...`);
                }

                // Additional wait for the image to fully load
                await new Promise(r => setTimeout(r, 3000));

                // Check for error pages before proceeding
                const errorCheck = await checkForErrorPage(page);
                if (errorCheck.isError) {
                    console.log(`   ⚠️  Error page detected: ${errorCheck.errorType}`);
                    console.log(`   📄 Message: ${errorCheck.message}`);

                    // Attempt recovery
                    const recovered = await recoverFromError(page, imageNum);
                    if (!recovered) {
                        console.log(`   ❌ Could not recover from error, skipping image ${imageNum}`);
                        errorCount++;
                        continue;
                    }

                    // After recovery, we're back at gallery - need to click thumbnail to enter viewer
                    // The ?i=XXX parameter only scrolls to/highlights the thumbnail, doesn't open it
                    const directUrl = `https://www.familysearch.org/search/film/${COLLECTION.filmNumber}?cat=${COLLECTION.catalogId}&i=${imageNum - 1}`;
                    console.log(`   🔗 Re-navigating to image ${imageNum} after recovery...`);
                    await page.goto(directUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                    await new Promise(r => setTimeout(r, 3000));

                    // Now click the highlighted/selected thumbnail to enter the viewer
                    console.log(`   🖱️  Clicking highlighted thumbnail to open viewer...`);
                    const clickedAfterRecovery = await page.evaluate(() => {
                        // Look for selected/highlighted thumbnail (usually has cyan border or selected class)
                        const selectedThumbnail = document.querySelector('[class*="selected"] img, [class*="active"] img, [class*="highlight"] img, img[style*="border"]');
                        if (selectedThumbnail) {
                            selectedThumbnail.click();
                            return { clicked: true, selector: 'selected thumbnail' };
                        }

                        // Fallback: click any visible thumbnail in the center of the viewport
                        const thumbnails = document.querySelectorAll('img');
                        for (const thumb of thumbnails) {
                            const rect = thumb.getBoundingClientRect();
                            // Look for thumbnails that are visible and reasonably sized
                            if (rect.width > 50 && rect.width < 200 && rect.top > 0 && rect.bottom < window.innerHeight) {
                                thumb.click();
                                return { clicked: true, selector: 'visible thumbnail' };
                            }
                        }
                        return { clicked: false };
                    });

                    if (clickedAfterRecovery.clicked) {
                        console.log(`   ✅ Clicked thumbnail (${clickedAfterRecovery.selector})`);
                        await new Promise(r => setTimeout(r, 4000));
                    } else {
                        console.log(`   ⚠️  Could not click thumbnail after recovery`);
                    }

                    // Check again for errors after clicking
                    const secondCheck = await checkForErrorPage(page);
                    if (secondCheck.isError) {
                        console.log(`   ❌ Still getting error after recovery, skipping image ${imageNum}`);
                        errorCount++;
                        continue;
                    }
                }

                // Save debug screenshot for first 5 images
                if (imageNum <= startImage + 4) {
                    await page.screenshot({ path: `/tmp/fs-image-${imageNum}.png`, fullPage: true });
                    console.log(`   📸 Debug screenshot: /tmp/fs-image-${imageNum}.png`);
                }

                // Get page state for debugging
                const pageState = await page.evaluate(() => {
                    return {
                        url: window.location.href,
                        bodyLength: document.body.innerText.length,
                        htmlLength: document.documentElement.innerHTML.length,
                        hasReactRoot: !!document.querySelector('[data-reactroot], #root'),
                        divCount: document.querySelectorAll('div').length,
                        iframeCount: document.querySelectorAll('iframe').length,
                        title: document.title,
                        // List all class names for analysis
                        classNames: Array.from(new Set(
                            Array.from(document.querySelectorAll('*'))
                                .flatMap(el => Array.from(el.classList))
                        )).slice(0, 50)
                    };
                });

                console.log(`   🔍 URL: ${pageState.url.substring(0, 80)}...`);
                console.log(`   🔍 Body: ${pageState.bodyLength} chars, HTML: ${pageState.htmlLength} chars`);
                console.log(`   🔍 Divs: ${pageState.divCount}, Iframes: ${pageState.iframeCount}, React: ${pageState.hasReactRoot}`);
                console.log(`   🔍 Title: ${pageState.title}`);
                if (pageState.classNames.length > 0) {
                    console.log(`   🔍 Classes: ${pageState.classNames.slice(0, 20).join(', ')}`);
                }

        
                // Try to extract transcript text with multiple selectors
                const transcriptText = await page.evaluate(() => {
                    // FamilySearch possible transcript selectors
                    const selectors = [
                        '.transcription-text',
                        '.transcript-text',
                        '.full-text-content',
                        '[data-testid="transcript"]',
                        '.transcription-container',
                        '.transcription',
                        '.text-view',
                        '.fullTextContainer',
                        '#fullTextContent',
                        '.fs-full-text',
                        '.document-text',
                        // FamilySearch specific classes (from research)
                        '.cell-value',
                        '.transcript-line',
                        '.field-value',
                        '[class*="transcript"]',
                        '[class*="Transcript"]',
                        // Generic content areas
                        'article',
                        'main',
                        '.content',
                        '#app',
                        '#root'
                    ];

                    for (const selector of selectors) {
                        const el = document.querySelector(selector);
                        if (el && el.innerText && el.innerText.length > 50) {
                            return { text: el.innerText, selector: selector };
                        }
                    }

                    // Fallback: look for any pre-formatted or text-heavy element
                    const allText = [];
                    document.querySelectorAll('pre, .monospace, [style*="font-family: monospace"]').forEach(el => {
                        if (el.innerText.length > 20) allText.push(el.innerText);
                    });
                    if (allText.length > 0) return { text: allText.join('\n'), selector: 'pre/monospace' };

                    // Try to get all text from divs with substantial content
                    const contentDivs = Array.from(document.querySelectorAll('div'))
                        .filter(d => d.innerText.length > 100 && d.children.length < 10)
                        .sort((a, b) => b.innerText.length - a.innerText.length);
                    if (contentDivs.length > 0) {
                        return { text: contentDivs[0].innerText, selector: 'div (largest)' };
                    }

                    // Last resort: get body text and look for meaningful content
                    const body = document.body.innerText || '';
                    return { text: body, selector: 'body' };
                });

                let textContent = '';
                let usedSelector = 'none';
                let ocrSource = 'google_vision_ocr';
                let imageBuffer = null;  // Track image for S3 archival
                let s3Url = null;  // S3 archive URL

                // We are already in the image viewer after clicking the thumbnail
                // Capture the document image using screenshot (most reliable)
                // FamilySearch renders documents on canvas, so screenshot is the best approach
                console.log(`   📸 Capturing document image via screenshot...`);

                // Take a screenshot of just the viewer area (the document)
                imageBuffer = await screenshotViewerArea(page);

                // Archive the image to S3 for permanent preservation
                if (imageBuffer) {
                    s3Url = await uploadToS3(imageBuffer, imageNum);
                }

                // Always use OCR for these historical documents
                // FamilySearch doesn't have community transcripts for Ravenel papers
                if (GOOGLE_VISION_API_KEY && imageBuffer && imageBuffer.length > 10000) {
                    console.log(`   🔍 Using Google Vision OCR on captured image...`);

                    // Perform OCR on the image
                    textContent = await performGoogleVisionOCR(imageBuffer);
                    usedSelector = 'google_vision';

                    if (textContent && textContent.length > 20) {
                        console.log(`   ✅ Google Vision OCR extracted ${textContent.length} chars`);
                        // Preview first 200 chars
                        console.log(`   📝 Preview: ${textContent.substring(0, 200).replace(/\n/g, ' ')}...`);
                    } else {
                        console.log(`   ⚠️  OCR found little text (may be film leader/blank page)`);
                    }
                } else if (!imageBuffer) {
                    console.log(`   ❌ Could not obtain image for OCR`);
                } else if (imageBuffer.length < 10000) {
                    console.log(`   ⚠️  Image too small (${Math.round(imageBuffer.length/1024)}KB) - likely placeholder`);
                } else {
                    console.log(`   ⚠️  GOOGLE_VISION_API_KEY not set - cannot perform OCR`);
                }

                // Skip if no meaningful text found (film leaders, blank pages, etc.)
                if (!textContent || textContent.length < 20) {
                    console.log(`   ⏭️  Skipping image ${imageNum} - no extractable text (film leader or blank)`);
                    // Don't count as error - just skip
                    continue;
                }

                // Parse the transcript
                const parsed = parseTranscript(textContent, imageNum);

                console.log(`   👥 Found: ${parsed.enslavedPersons.length} enslaved, ${parsed.slaveholders.length} slaveholders`);

                if (parsed.resistanceIndicators.length > 0) {
                    console.log(`   ⚡ RESISTANCE: ${parsed.resistanceIndicators.join(', ')}`);
                }

                // Save to database with S3 archive URL
                await saveToDatabase(parsed, imageNum, textContent, s3Url);

                totalEnslaved += parsed.enslavedPersons.length;
                totalSlaveholders += parsed.slaveholders.length;
                successCount++;

                // Rate limiting - be respectful
                await new Promise(r => setTimeout(r, 1500));

                // Reset consecutive error count on success
                consecutiveErrors = 0;
                lastSuccessfulImage = imageNum;

                // Save progress periodically
                if (imageNum % 50 === 0) {
                    saveProgress(FILM_INDEX, imageNum, endImage);
                }

            } catch (error) {
                console.error(`   ❌ Error on image ${imageNum}: ${error.message}`);
                errorCount++;
                consecutiveErrors++;

                // Check for connection-related errors that indicate wifi loss
                const isConnectionError = error.message.includes('detached Frame') ||
                    error.message.includes('Target closed') ||
                    error.message.includes('Protocol error') ||
                    error.message.includes('ERR_INTERNET_DISCONNECTED') ||
                    error.message.includes('ERR_ADDRESS_UNREACHABLE') ||
                    error.message.includes('ECONNRESET') ||
                    error.message.includes('Navigation timeout') ||
                    error.message.includes('net::ERR');

                if (isConnectionError && consecutiveErrors >= 5) {
                    console.log('\n🔌 CONNECTION LOST - Detected 5+ consecutive connection errors');
                    console.log(`   Last successful image: ${lastSuccessfulImage}`);

                    // Save progress before attempting recovery
                    saveProgress(FILM_INDEX, lastSuccessfulImage, endImage);

                    // Attempt to recover
                    const recovered = await recoverConnection(browser, page, lastSuccessfulImage, endImage);
                    if (recovered) {
                        // Get new page reference after recovery
                        const pages = await browser.pages();
                        page = pages[pages.length - 1] || page;
                        consecutiveErrors = 0;
                        // Resume from last successful + 1
                        imageNum = lastSuccessfulImage;
                        console.log(`   ✅ Recovered! Resuming from image ${imageNum + 1}`);
                        continue;
                    } else {
                        console.log('   ❌ Could not recover. Saving progress and exiting.');
                        console.log(`   Run with: FILM_INDEX=${FILM_INDEX} node ... ${lastSuccessfulImage + 1} ${endImage}`);
                        break;
                    }
                }

                // Continue on non-critical errors
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        // Summary
        console.log('\n======================================================================');
        console.log('📊 SCRAPING COMPLETE');
        console.log('======================================================================');
        console.log(`Images processed: ${successCount}/${endImage - startImage + 1}`);
        console.log(`Errors: ${errorCount}`);
        console.log(`Total enslaved persons: ${totalEnslaved}`);
        console.log(`Total slaveholders: ${totalSlaveholders}`);
        console.log('======================================================================\n');

        // Clear progress file on successful completion
        if (successCount > 0 && errorCount < (endImage - startImage + 1) / 2) {
            clearProgress();
        }

    } catch (error) {
        console.error(`\n❌ Fatal error: ${error.message}`);
        console.error(error.stack);
    } finally {
        await browser.close();
        if (pool) await pool.end();
    }
}

// Parse command line arguments
const args = process.argv.slice(2);
const startImage = parseInt(args[0]) || 1;
const endImage = parseInt(args[1]) || 10; // Default to first 10 for testing

// Run scraper
scrape(startImage, endImage);
