/**
 * FamilySearch Census Image OCR Extraction
 *
 * Extracts enslaved persons from 1850/1860 slave schedule images:
 * - Fetches image URLs from familysearch_locations table
 * - Takes screenshots of census images via Puppeteer
 * - Runs Google Vision OCR to extract text
 * - Parses slave schedule format (Owner + Age/Sex/Color rows)
 * - Stores extracted persons in unconfirmed_persons
 *
 * Usage:
 *   FAMILYSEARCH_INTERACTIVE=true node scripts/extract-census-ocr.js
 *
 * Options:
 *   --state "Alabama"    - Process single state
 *   --states "Arkansas,Alabama" - Process multiple states with one login
 *   --county "Autauga"   - Process single county
 *   --limit 10           - Limit number of locations
 *   --dry-run            - Don't save to database
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { neon } = require('@neondatabase/serverless');
const axios = require('axios');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// S3 for document archiving
let s3Client = null;
const S3_REGION = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-2';
try {
    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.S3_BUCKET) {
        s3Client = new S3Client({
            region: S3_REGION,
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
            }
        });
        console.log(`📦 S3 archiving enabled (region: ${S3_REGION})`);
    }
} catch (e) {
    console.log('⚠️ S3 not available - skipping document archiving');
}

puppeteer.use(StealthPlugin());

// Configuration
const DATABASE_URL = process.env.DATABASE_URL;
const GOOGLE_VISION_API_KEY = process.env.GOOGLE_VISION_API_KEY;
const INTERACTIVE = process.env.FAMILYSEARCH_INTERACTIVE === 'true';
const S3_BUCKET = process.env.S3_BUCKET;

// FamilySearch API endpoints
const FS_API_BASE = 'https://www.familysearch.org/service/cds/recapi';
const FS_IMAGE_BASE = 'https://www.familysearch.org/ark:/61903/3:1';

let sql = null;
let browser = null;
let page = null;

// Statistics
const stats = {
    locationsProcessed: 0,
    imagesProcessed: 0,
    personsExtracted: 0,
    ownersExtracted: 0,
    errors: 0,
    startTime: Date.now()
};

// Progress tracking
let progressId = null;
let currentYear = null;
let currentCollectionId = null;
let totalLocations = 0;

/**
 * Initialize progress tracking in database
 */
async function initProgress(year, collectionId, locationsCount) {
    if (!sql) return;

    currentYear = year;
    currentCollectionId = collectionId;
    totalLocations = locationsCount;

    try {
        // Mark any previous running jobs as interrupted
        await sql`
            UPDATE extraction_progress
            SET status = 'interrupted', updated_at = NOW()
            WHERE status = 'running'
        `;

        // Create new progress record
        const result = await sql`
            INSERT INTO extraction_progress
            (job_name, year, collection_id, status, locations_total, current_state)
            VALUES (
                ${`Census OCR - ${year}`},
                ${year},
                ${collectionId},
                'running',
                ${locationsCount},
                'Starting...'
            )
            RETURNING id
        `;
        progressId = result[0].id;
        console.log(`📊 Progress tracking initialized (ID: ${progressId})`);
    } catch (e) {
        console.log(`⚠️ Progress tracking error: ${e.message}`);
    }
}

/**
 * Update progress in database
 */
async function updateProgress(currentState, currentCounty, currentDistrict) {
    if (!sql || !progressId) return;

    try {
        await sql`
            UPDATE extraction_progress SET
                locations_processed = ${stats.locationsProcessed},
                images_processed = ${stats.imagesProcessed},
                owners_extracted = ${stats.ownersExtracted},
                enslaved_extracted = ${stats.personsExtracted},
                errors = ${stats.errors},
                current_state = ${currentState || ''},
                current_county = ${currentCounty || ''},
                current_district = ${currentDistrict || ''},
                updated_at = NOW()
            WHERE id = ${progressId}
        `;
    } catch (e) {
        // Silently ignore progress update errors
    }
}

/**
 * Mark progress as complete or failed
 */
async function completeProgress(status = 'completed', errorMessage = null) {
    if (!sql || !progressId) return;

    try {
        await sql`
            UPDATE extraction_progress SET
                status = ${status},
                locations_processed = ${stats.locationsProcessed},
                images_processed = ${stats.imagesProcessed},
                owners_extracted = ${stats.ownersExtracted},
                enslaved_extracted = ${stats.personsExtracted},
                errors = ${stats.errors},
                completed_at = NOW(),
                updated_at = NOW(),
                error_message = ${errorMessage}
            WHERE id = ${progressId}
        `;
    } catch (e) {
        console.log(`⚠️ Progress completion error: ${e.message}`);
    }
}

/**
 * Initialize database
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
 * Initialize Puppeteer browser
 */
async function initBrowser() {
    const userDataDir = path.join(process.cwd(), '.chrome-profile');

    console.log('🚀 Launching Chrome...');
    browser = await puppeteer.launch({
        headless: !INTERACTIVE,
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        userDataDir: userDataDir,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--window-size=1920,1200',
            '--disable-infobars'
        ],
        ignoreDefaultArgs: ['--enable-automation'],
        defaultViewport: null
    });

    page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1200 });

    // Load cookies if available
    const cookieFile = './fs-cookies.json';
    if (fs.existsSync(cookieFile)) {
        try {
            const cookies = JSON.parse(fs.readFileSync(cookieFile, 'utf8'));
            await page.setCookie(...cookies);
            console.log(`✅ Loaded ${cookies.length} cookies`);
        } catch (e) {
            console.log('⚠️  Could not load cookies');
        }
    }

    return page;
}

/**
 * Ensure user is logged into FamilySearch
 */
async function ensureLoggedIn() {
    console.log('🔐 Checking FamilySearch login status...');

    await page.goto('https://www.familysearch.org/search/catalog', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
    });

    await new Promise(r => setTimeout(r, 3000));

    const currentUrl = page.url();
    if (currentUrl.includes('ident.familysearch') || currentUrl.includes('/auth/')) {
        if (!INTERACTIVE) {
            throw new Error('Not logged in and not in interactive mode. Run with FAMILYSEARCH_INTERACTIVE=true');
        }

        console.log('\n⚠️  Please log into FamilySearch in the browser window...');
        console.log('   Waiting up to 3 minutes...\n');

        let attempts = 0;
        while (attempts < 90) {
            await new Promise(r => setTimeout(r, 2000));
            const url = page.url();
            if (!url.includes('ident.') && !url.includes('/auth/')) {
                break;
            }
            attempts++;
        }

        // Save cookies
        const cookies = await page.cookies();
        fs.writeFileSync('./fs-cookies.json', JSON.stringify(cookies, null, 2));
        console.log(`💾 Saved ${cookies.length} cookies`);
    }

    console.log('✅ Logged in to FamilySearch');
}

/**
 * Fetch waypoint data via authenticated browser
 */
async function fetchWaypointData(waypointUrl) {
    try {
        const response = await page.evaluate(async (url) => {
            const res = await fetch(url, {
                headers: { 'Accept': 'application/json' },
                credentials: 'include'
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        }, waypointUrl);
        return response;
    } catch (error) {
        return { error: error.message };
    }
}

/**
 * Fetch image list by drilling down from county to districts
 * Our stored locations are at COUNTY level, images are at DISTRICT level
 */
async function fetchImageList(waypointUrl, collectionId) {
    const allImages = [];

    try {
        // Fetch county waypoint data
        const countyData = await fetchWaypointData(waypointUrl);

        if (countyData.error) {
            console.log(`   ⚠️ API fetch failed: ${countyData.error}`);
            return [];
        }

        // Find districts (children of this county)
        // They have componentOf.description === '#src_1' (the current waypoint)
        const districts = countyData.sourceDescriptions?.filter(sd =>
            sd.componentOf?.description === '#src_1' &&
            sd.about?.includes('/waypoints/')
        ) || [];

        if (districts.length === 0) {
            // Maybe this waypoint directly contains images (no district subdivision)
            const directImages = countyData.sourceDescriptions?.filter(sd =>
                sd.about?.includes('/ark:/61903/3:1')
            ) || [];

            for (const sd of directImages) {
                allImages.push({
                    id: sd.about,
                    title: sd.titles?.[0]?.value || 'Image',
                    url: sd.about
                });
            }

            return allImages;
        }

        console.log(`   Found ${districts.length} districts, drilling down...`);

        // For each district, get its images (process ALL districts)
        for (const district of districts) {
            const districtName = district.titles?.[0]?.value || 'Unknown';
            console.log(`      📂 District: ${districtName}`);

            const districtData = await fetchWaypointData(district.about);

            if (districtData.error) {
                console.log(`         ⚠️ Failed: ${districtData.error}`);
                continue;
            }

            // Find images in this district
            const districtImages = districtData.sourceDescriptions?.filter(sd =>
                sd.about?.includes('/ark:/61903/3:1')
            ) || [];

            console.log(`         📸 Found ${districtImages.length} images`);

            for (const img of districtImages) {
                allImages.push({
                    id: img.about,
                    title: `${districtName} - ${img.titles?.[0]?.value || 'Image'}`,
                    url: img.about,
                    district: districtName
                });
            }

            // Small delay between districts
            await new Promise(r => setTimeout(r, 500));
        }

        return allImages;
    } catch (error) {
        console.log(`   ⚠️ Image fetch failed: ${error.message}`);
        return [];
    }
}

/**
 * Take screenshot of a FamilySearch image
 */
async function captureImage(imageUrl) {
    try {
        await page.goto(imageUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        // Wait for image viewer to load
        await new Promise(r => setTimeout(r, 5000));

        // Try to wait for the actual image canvas/img element
        try {
            await page.waitForSelector('canvas, .image-viewer img, [class*="image"]', { timeout: 10000 });
            await new Promise(r => setTimeout(r, 2000)); // Let it fully render
        } catch (e) {
            // Continue anyway
        }

        // Take screenshot
        const screenshot = await page.screenshot({
            type: 'png',
            fullPage: false
        });

        return screenshot;
    } catch (error) {
        console.log(`   ⚠️ Could not capture image: ${error.message}`);
        return null;
    }
}

/**
 * Archive screenshot to S3 for permanent preservation
 * Creates integrity hash for tampering detection
 */
async function archiveToS3(imageBuffer, sourceUrl, metadata) {
    if (!s3Client || !S3_BUCKET) return null;

    try {
        const { PutObjectCommand } = require('@aws-sdk/client-s3');

        // Generate integrity hash
        const contentHash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
        const timestamp = new Date().toISOString();

        // Create S3 key: archives/slave-schedules/YEAR/STATE/COUNTY/hash.png
        const safeState = (metadata.state || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '-');
        const safeCounty = (metadata.county || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '-');
        const s3Key = `archives/slave-schedules/${metadata.year || 1860}/${safeState}/${safeCounty}/${contentHash.substring(0, 16)}.png`;

        await s3Client.send(new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: s3Key,
            Body: imageBuffer,
            ContentType: 'image/png',
            Metadata: {
                'source-url': sourceUrl.substring(0, 1024), // S3 metadata limit
                'archived-at': timestamp,
                'content-hash': contentHash,
                'state': metadata.state || '',
                'county': metadata.county || '',
                'year': String(metadata.year || '')
            }
        }));

        // Store archive reference in database
        if (sql) {
            await sql`
                INSERT INTO archived_urls (url, content_hash, s3_key, archived_at, hash_algorithm)
                VALUES (${sourceUrl}, ${contentHash}, ${s3Key}, ${timestamp}, 'sha256')
                ON CONFLICT (url) DO UPDATE SET
                    content_hash = ${contentHash},
                    s3_key = ${s3Key},
                    last_verified = CURRENT_TIMESTAMP
            `;
        }

        return { s3Key, contentHash };
    } catch (error) {
        console.log(`   ⚠️ S3 archive error: ${error.message}`);
        return null;
    }
}

/**
 * Perform OCR on image using Google Vision API
 */
async function performOCR(imageBuffer) {
    if (!GOOGLE_VISION_API_KEY) {
        console.log('   ⚠️ No GOOGLE_VISION_API_KEY - skipping OCR');
        return '';
    }

    try {
        // Resize for optimal OCR
        const resizedBuffer = await sharp(imageBuffer)
            .resize(2500, null, { fit: 'inside', withoutEnlargement: true })
            .png()
            .toBuffer();

        const response = await axios.post(
            `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_VISION_API_KEY}`,
            {
                requests: [{
                    image: { content: resizedBuffer.toString('base64') },
                    features: [{ type: 'DOCUMENT_TEXT_DETECTION' }]
                }]
            },
            { timeout: 120000 }
        );

        return response.data.responses[0]?.fullTextAnnotation?.text || '';
    } catch (error) {
        console.log(`   ⚠️ OCR error: ${error.message}`);
        return '';
    }
}

/**
 * Parse slave schedule OCR text to extract persons
 *
 * Slave schedule format (1850/1860):
 * - Owner name at top of each section
 * - Columns: Number | Age | Sex | Color | Fugitive | Manumitted | etc.
 * - Enslaved persons listed by row (usually no names, just demographics)
 */
function parseSlaveSchedule(ocrText, metadata) {
    const results = {
        owners: [],
        enslaved: []
    };

    if (!ocrText || ocrText.length < 50) {
        return results;
    }

    const lines = ocrText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    let currentOwner = null;
    let lineNumber = 0;

    // Patterns for owner detection - IMPROVED Dec 18, 2025
    // Owner names should be: "FirstName LastName" or "FirstName M. LastName" or "Mrs. LastName"
    const ownerPatterns = [
        // "Name of Slaveholder" or "Slave Owner" header followed by name
        /(?:name of slave\s*holder|slave\s*holder|slave\s*owner|owner)\s*[:\-]?\s*([A-Z][a-z]+\s+[A-Z]\.?\s*[A-Z]?[a-z]+)/i,
        // Full name: First Middle? Last (at least 2 words)
        /^([A-Z][a-z]+\s+(?:[A-Z]\.?\s+)?[A-Z][a-z]{2,})$/,
        // Name with title: Mrs./Mr./Dr./Rev./Col./Capt. + Name
        /^((?:Mrs?\.?|Dr\.?|Rev\.?|Col\.?|Capt\.?|Gen\.?|Hon\.?)\s+[A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?[A-Z]?[a-z]*)$/i,
        // Estate of / Heirs of + Name
        /^((?:Estate|Heirs|Widow)\s+of\s+[A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?[A-Z]?[a-z]*)$/i
    ];

    // Known OCR garbage and non-name words to filter
    const ocrGarbage = new Set([
        'beat', 'best', 'at', 'the', 'and', 'for', 'with', 'from', 'this',
        'male', 'female', 'black', 'mulatto', 'color', 'age', 'sex',
        'schedule', 'column', 'page', 'line', 'number', 'total', 'ditto',
        'census', 'slave', 'owner', 'district', 'county', 'state', 'township',
        'enumerated', 'marshal', 'assistant', 'image', 'document',
        // FamilySearch UI elements that OCR picks up
        'family', 'tree', 'search', 'memories', 'attach', 'print', 'share',
        'details', 'record', 'save', 'view', 'source', 'film', 'digital',
        'get', 'involved', 'sign', 'help', 'center', 'about', 'activities',
        'home', 'indexing', 'temple', 'blog', 'wiki', 'feedback', 'settings',
        // Additional website UI garbage - Dec 22, 2025
        'genealogies', 'catalog', 'full', 'text', 'browse', 'next', 'previous',
        'first', 'last', 'zoom', 'download', 'cite', 'research', 'collection',
        'collections', 'records', 'index', 'images', 'historical', 'archives'
    ]);

    // Multi-word phrases that are definitely not person names
    const garbagePhrases = new Set([
        'genealogies catalog', 'full text', 'image index', 'browse images',
        'research help', 'collection details', 'historical records',
        'family tree', 'source citation', 'record details'
    ]);

    // State names to filter (not owner names)
    const stateNames = new Set([
        'alabama', 'arkansas', 'delaware', 'florida', 'georgia', 'kentucky',
        'louisiana', 'maryland', 'mississippi', 'missouri', 'north carolina',
        'south carolina', 'tennessee', 'texas', 'virginia', 'district of columbia'
    ]);

    // Patterns for enslaved person rows (Age Sex Color format)
    const enslavedRowPatterns = [
        // Standard format: Number Age Sex Color
        /^(\d{1,3})?\s*(\d{1,2})\s+([MF]|male|female)\s+([BM]|black|mulatto)/i,
        // Age Sex Color (no number)
        /^(\d{1,2})\s+([MF]|male|female)\s+([BM]|black|mulatto)/i,
        // Just Age and Sex
        /^(\d{1,2})\s+([MF]|male|female)/i
    ];

    // Common enslaved names (when listed)
    const africanDayNames = new Set([
        'quash', 'quashee', 'cudjoe', 'cudjo', 'cuffee', 'cuffy',
        'quaco', 'kwaku', 'juba', 'phibba', 'phoebe', 'abba',
        'cuba', 'mingo', 'sambo', 'cato', 'pompey', 'caesar',
        'scipio', 'prince', 'fortune', 'july', 'monday', 'friday',
        'phillis', 'dinah', 'beck', 'betty', 'nancy', 'hannah',
        'rachel', 'leah', 'sarah', 'chloe', 'sukey', 'nelly',
        'jack', 'tom', 'peter', 'moses', 'sam', 'harry', 'joe',
        'ben', 'will', 'dick', 'bob', 'george', 'charles', 'jim',
        'frank', 'henry', 'isaac', 'jacob', 'abraham', 'daniel'
    ]);

    for (const line of lines) {
        lineNumber++;

        // Check for owner patterns
        for (const pattern of ownerPatterns) {
            const match = line.match(pattern);
            if (match && match[1]) {
                const potentialOwner = match[1].trim();
                const lowerOwner = potentialOwner.toLowerCase();
                const ownerWords = lowerOwner.split(/\s+/);

                // IMPROVED VALIDATION - Dec 18, 2025
                // Must pass ALL checks:

                // Allow middle initials: first and last word must be 2+ chars, middle can be 1 char
                const firstLastOk = ownerWords.length >= 2 &&
                    ownerWords[0].length >= 2 &&
                    ownerWords[ownerWords.length - 1].length >= 2;

                const isValidOwner =
                    // At least 5 characters total
                    potentialOwner.length >= 5 &&
                    // At least 2 words (first + last name)
                    ownerWords.length >= 2 &&
                    // First and last names are substantial
                    firstLastOk &&
                    // Not pure numbers
                    !/^\d+$/.test(potentialOwner) &&
                    // First word not OCR garbage
                    !ocrGarbage.has(ownerWords[0]) &&
                    // Last word not OCR garbage either
                    !ocrGarbage.has(ownerWords[ownerWords.length - 1]) &&
                    // Not a known garbage phrase (Dec 22, 2025)
                    !garbagePhrases.has(lowerOwner) &&
                    // Not a state name
                    !stateNames.has(lowerOwner) &&
                    // Not the county name we're in
                    lowerOwner !== metadata.county?.toLowerCase() &&
                    // Not the state we're in
                    lowerOwner !== metadata.state?.toLowerCase() &&
                    // Contains at least one letter
                    /[a-zA-Z]/.test(potentialOwner);

                if (isValidOwner) {
                    currentOwner = potentialOwner;
                    if (!results.owners.find(o => o.name.toLowerCase() === currentOwner.toLowerCase())) {
                        results.owners.push({
                            name: currentOwner,
                            type: 'slaveholder',
                            sourceUrl: metadata.imageUrl,
                            context: line,
                            state: metadata.state,
                            county: metadata.county,
                            year: metadata.year,
                            confidence: 0.7
                        });
                    }
                }
                break;
            }
        }

        // Check for enslaved person rows
        for (const pattern of enslavedRowPatterns) {
            const match = line.match(pattern);
            if (match) {
                let age, sex, color;

                if (match.length >= 4) {
                    // Full format with number
                    age = parseInt(match[2] || match[1]);
                    sex = (match[3] || match[2] || '').toUpperCase().charAt(0);
                    color = (match[4] || match[3] || '').toUpperCase().charAt(0);
                } else if (match.length >= 3) {
                    age = parseInt(match[1]);
                    sex = match[2].toUpperCase().charAt(0);
                    color = 'U'; // Unknown
                } else {
                    continue;
                }

                if (age > 0 && age < 120 && (sex === 'M' || sex === 'F')) {
                    // Check for disability/injury indicators (slave schedule columns)
                    const lineLower = line.toLowerCase();
                    const characteristics = [];
                    if (/deaf|dumb|mute/i.test(lineLower)) characteristics.push('deaf/mute');
                    if (/blind/i.test(lineLower)) characteristics.push('blind');
                    if (/insane|lunatic/i.test(lineLower)) characteristics.push('insane');
                    if (/idiot|idiotic|imbecile/i.test(lineLower)) characteristics.push('intellectually disabled');
                    if (/fugitive|runaway/i.test(lineLower)) characteristics.push('fugitive');
                    if (/manumit/i.test(lineLower)) characteristics.push('manumitted');

                    results.enslaved.push({
                        name: `Unknown (${sex === 'M' ? 'Male' : 'Female'}, age ${age})`,
                        age: age,
                        sex: sex === 'M' ? 'male' : 'female',
                        color: color === 'B' ? 'Black' : (color === 'M' ? 'Mulatto' : 'Unknown'),
                        type: 'enslaved',
                        owner: currentOwner,
                        sourceUrl: metadata.imageUrl,
                        context: line,
                        state: metadata.state,
                        county: metadata.county,
                        year: metadata.year,
                        confidence: 0.6,
                        characteristics: characteristics.length > 0 ? characteristics : null
                    });
                }
                break;
            }
        }

        // Check for named enslaved persons
        const words = line.toLowerCase().split(/\s+/);
        for (const word of words) {
            if (africanDayNames.has(word) && word.length >= 3) {
                // Found a potential enslaved name
                const capitalizedName = word.charAt(0).toUpperCase() + word.slice(1);
                if (!results.enslaved.find(e => e.name.toLowerCase() === word)) {
                    results.enslaved.push({
                        name: capitalizedName,
                        type: 'enslaved',
                        owner: currentOwner,
                        sourceUrl: metadata.imageUrl,
                        context: line,
                        state: metadata.state,
                        county: metadata.county,
                        year: metadata.year,
                        confidence: 0.7
                    });
                }
            }
        }
    }

    return results;
}

/**
 * Extract pre-indexed data from the Image Index panel
 *
 * FamilySearch has volunteer-transcribed data for many pages.
 * This is far more accurate than OCR (95% vs 30% accuracy).
 *
 * @param {string} imageUrl - FamilySearch image URL
 * @param {object} metadata - Location metadata (state, county, year)
 * @returns {object} { owners: [], enslaved: [], hasPreIndexedData: boolean }
 */
async function extractPreIndexedData(imageUrl, metadata = {}) {
    const result = {
        owners: [],
        enslaved: [],
        hasPreIndexedData: false,
        rawRows: []
    };

    try {
        // Navigate to the image page
        await page.goto(imageUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        // Wait for page to fully render
        await new Promise(r => setTimeout(r, 3000));

        // Try to click on "Image Index" tab if it exists
        try {
            const indexTabSelector = 'button:has-text("Image Index"), [role="tab"]:has-text("Image Index"), .tab:has-text("Image Index")';
            await page.click(indexTabSelector).catch(() => {});
            await new Promise(r => setTimeout(r, 1000));
        } catch (e) {
            // Tab might not exist or already selected
        }

        // Extract data from the page
        const extractedData = await page.evaluate(() => {
            const data = {
                rows: [],
                found: false
            };

            // Find all rows that contain Owner/Slave designation
            const allRows = document.querySelectorAll('tr, [role="row"], .record-row, .index-row');

            allRows.forEach(row => {
                const cells = row.querySelectorAll('td, [role="cell"], .cell, div[class*="cell"], span');
                const rowText = row.textContent || '';

                if (rowText.includes('Owner') || rowText.includes('Slave')) {
                    data.found = true;

                    const rowData = {
                        name: '',
                        sex: '',
                        age: '',
                        birthYear: '',
                        status: '',
                        pageNumber: '',
                        cellTexts: []
                    };

                    // Capture all cell contents
                    cells.forEach((cell, idx) => {
                        const text = cell.textContent.trim();
                        rowData.cellTexts.push({ idx, text: text.substring(0, 50), tag: cell.tagName });
                    });

                    // Extract structured data from cells
                    cells.forEach(cell => {
                        const text = cell.textContent.trim();

                        if (text === 'Owner' || text === 'Slave') {
                            rowData.status = text;
                        } else if (text === 'Male' || text === 'Female') {
                            rowData.sex = text;
                        } else if (text.match(/^\d{1,3}\s*years?$/i)) {
                            rowData.age = parseInt(text);
                        } else if (text.match(/^\d{4}$/)) {
                            if (parseInt(text) >= 1700 && parseInt(text) <= 1870) {
                                rowData.birthYear = parseInt(text);
                            } else {
                                rowData.pageNumber = text;
                            }
                        } else if (text.match(/^\d{1,2}$/)) {
                            rowData.pageNumber = text;
                        } else if (text.length > 1 && !text.match(/^(ATTACH|More|years?)$/i)) {
                            if (!rowData.name && text.length > 1) {
                                rowData.name = text;
                            }
                        }
                    });

                    if (rowData.status) {
                        data.rows.push(rowData);
                    }
                }
            });

            // Alternative: Look for ATTACH buttons
            if (!data.found) {
                const attachButtons = document.querySelectorAll('button, a');
                let currentOwner = null;

                attachButtons.forEach(btn => {
                    if (btn.textContent.includes('ATTACH')) {
                        const parentRow = btn.closest('tr, [role="row"], div');
                        if (parentRow) {
                            const rowText = parentRow.textContent;
                            if (rowText.includes('Owner')) {
                                const nameMatch = rowText.match(/ATTACH\s+([A-Z][a-zA-Z\s\.]+?)\s+Owner/);
                                if (nameMatch) {
                                    currentOwner = nameMatch[1].trim();
                                    data.rows.push({
                                        name: currentOwner,
                                        status: 'Owner'
                                    });
                                    data.found = true;
                                }
                            } else if (rowText.includes('Slave')) {
                                const ageMatch = rowText.match(/(\d+)\s*years/i);
                                const sexMatch = rowText.match(/(Male|Female)/i);
                                const yearMatch = rowText.match(/\b(1[78]\d{2})\b/);

                                data.rows.push({
                                    name: '',
                                    sex: sexMatch ? sexMatch[1] : '',
                                    age: ageMatch ? parseInt(ageMatch[1]) : null,
                                    birthYear: yearMatch ? parseInt(yearMatch[1]) : null,
                                    status: 'Slave',
                                    owner: currentOwner
                                });
                                data.found = true;
                            }
                        }
                    }
                });
            }

            return data;
        });

        if (extractedData.found && extractedData.rows.length > 0) {
            result.hasPreIndexedData = true;
            result.rawRows = extractedData.rows;

            let currentOwner = null;

            // Process rows into owners and enslaved
            for (const row of extractedData.rows) {
                if (row.status === 'Owner') {
                    currentOwner = row.name;
                    result.owners.push({
                        name: row.name,
                        type: 'slaveholder',
                        sourceUrl: imageUrl,
                        state: metadata.state,
                        county: metadata.county,
                        year: metadata.year,
                        confidence: 0.95,
                        extractionMethod: 'pre_indexed'
                    });
                } else if (row.status === 'Slave') {
                    const enslaved = {
                        name: row.age && row.sex
                            ? `Unknown (${row.sex}, age ${row.age})`
                            : 'Unknown',
                        age: row.age,
                        sex: row.sex ? row.sex.toLowerCase() : null,
                        birthYear: row.birthYear,
                        type: 'enslaved',
                        owner: row.owner || currentOwner,
                        sourceUrl: imageUrl,
                        state: metadata.state,
                        county: metadata.county,
                        year: metadata.year,
                        confidence: 0.95,
                        extractionMethod: 'pre_indexed'
                    };
                    result.enslaved.push(enslaved);
                }
            }
        }

    } catch (error) {
        console.error(`   ❌ Pre-indexed extraction error: ${error.message}`);
    }

    return result;
}

/**
 * Store extracted person in database
 */
async function storePerson(personData, dryRun = false) {
    if (!sql || dryRun) {
        console.log(`      → Would store: ${personData.name} (${personData.type})`);
        return null;
    }

    try {
        // Build relationships JSON with all extracted data
        const relationships = {
            owner: personData.owner,
            state: personData.state,
            county: personData.county,
            district: personData.district,
            year: personData.year,
            age: personData.age,
            color: personData.color,
            characteristics: personData.characteristics || null  // Injuries/disabilities from slave schedule
        };

        // Build locations array with actual county name
        const locations = personData.state && personData.county
            ? [`${personData.county}, ${personData.state}`]
            : [];

        // Build context text that includes owner info for front-end extraction
        let contextText = personData.context || personData.name;
        if (personData.type === 'enslaved' && personData.owner) {
            contextText = `${personData.name} | Owner: ${personData.owner} | ${personData.county}, ${personData.state} (${personData.year})`;
        } else if (personData.type === 'slaveholder') {
            contextText = `${personData.name} (slaveholder) | ${personData.county}, ${personData.state} (${personData.year})`;
        }

        // Check if already exists (avoid duplicates without constraint)
        const existing = await sql`
            SELECT lead_id FROM unconfirmed_persons
            WHERE full_name = ${personData.name}
            AND source_url = ${personData.sourceUrl}
            LIMIT 1
        `;

        if (existing.length > 0) {
            return existing[0].lead_id; // Already exists
        }

        const result = await sql`
            INSERT INTO unconfirmed_persons (
                full_name, person_type, source_url, context_text,
                confidence_score, extraction_method, gender,
                locations, relationships
            ) VALUES (
                ${personData.name},
                ${personData.type},
                ${personData.sourceUrl},
                ${contextText},
                ${personData.confidence || 0.6},
                ${personData.extractionMethod || 'census_ocr_extraction'},
                ${personData.sex || null},
                ${locations},
                ${JSON.stringify(relationships)}
            )
            RETURNING lead_id
        `;

        return result[0]?.lead_id;
    } catch (error) {
        console.log(`      ⚠️ Store error: ${error.message}`);
        return null;
    }
}

/**
 * Store owner-enslaved relationship
 */
async function storeRelationship(ownerName, enslavedName, sourceUrl, dryRun = false) {
    if (!sql || dryRun) {
        return;
    }

    try {
        // Check if relationship exists
        const existing = await sql`
            SELECT id FROM family_relationships
            WHERE person1_name = ${ownerName}
            AND person2_name = ${enslavedName}
            AND source_url = ${sourceUrl}
            LIMIT 1
        `;

        if (existing.length > 0) {
            return; // Already exists
        }

        await sql`
            INSERT INTO family_relationships (
                person1_name, person1_role,
                person2_name, person2_role,
                relationship_type, source_url
            ) VALUES (
                ${ownerName}, 'slaveholder',
                ${enslavedName}, 'enslaved',
                'enslaved_by',
                ${sourceUrl}
            )
        `;
    } catch (error) {
        // Ignore relationship storage errors
    }
}

/**
 * Process a single location (county/district)
 */
async function processLocation(location, dryRun = false) {
    console.log(`\n📍 Processing: ${location.state} > ${location.county} > ${location.district || 'N/A'}`);

    if (!location.waypoint_url || !location.waypoint_id) {
        console.log('   ⚠️ No waypoint URL - skipping');
        return;
    }

    // Determine year from collection
    // NOTE: 1420440 = 1850 Slave Schedule, 3161105 = 1860 Slave Schedule
    // 1401638 is the REGULAR 1850 census, NOT slave schedule!
    const year = location.collection_id === '1420440' ? 1850 : 1860;

    // Fetch image list from waypoint
    console.log('   📚 Fetching image list...');
    const images = await fetchImageList(location.waypoint_url, location.collection_id);

    if (images.length === 0) {
        console.log('   ⚠️ No images found at this waypoint');
        return;
    }

    console.log(`   📸 Found ${images.length} images`);

    // Process ALL images per location (removed 5-image limit)
    const imagesToProcess = images;

    for (let i = 0; i < imagesToProcess.length; i++) {
        const image = imagesToProcess[i];
        console.log(`   [${i + 1}/${imagesToProcess.length}] Processing: ${image.title}`);

        // Note: In our data, "district" contains the actual county name (Autauga, Benton, etc.)
        // because "county" contains "Alabama" (a parent level in the FamilySearch hierarchy)
        const actualCounty = location.district || location.county;
        const districtName = image.district || location.district;

        const metadata = {
            imageUrl: image.url,
            state: location.state,
            county: actualCounty,
            district: districtName,
            year: year
        };

        // ============================================================
        // HYBRID EXTRACTION: Try pre-indexed data FIRST, OCR as fallback
        // ============================================================

        // Step 1: Try to extract pre-indexed data from Image Index panel
        console.log('      📊 Checking for pre-indexed data...');
        const preIndexedResult = await extractPreIndexedData(image.url, metadata);

        let parsed;
        let extractionMethod;

        if (preIndexedResult.hasPreIndexedData && preIndexedResult.owners.length > 0) {
            // Use pre-indexed data (high confidence, accurate)
            console.log(`      ✅ Pre-indexed: ${preIndexedResult.owners.length} owners, ${preIndexedResult.enslaved.length} enslaved`);
            parsed = preIndexedResult;
            extractionMethod = 'pre_indexed';
            stats.imagesProcessed++;
        } else {
            // Fall back to OCR (lower confidence, may have errors)
            console.log('      ⚠️ No pre-indexed data, falling back to OCR...');

            // Capture screenshot
            const screenshot = await captureImage(image.url);
            if (!screenshot) {
                stats.errors++;
                continue;
            }

            stats.imagesProcessed++;

            // Run OCR
            console.log('      🔍 Running OCR...');
            const ocrText = await performOCR(screenshot);

            if (!ocrText || ocrText.length < 50) {
                console.log('      ⚠️ OCR returned little text - may be title page');
                continue;
            }

            console.log(`      ✅ OCR extracted ${ocrText.length} characters`);

            // Archive to S3 for permanent preservation (non-blocking)
            archiveToS3(screenshot, image.url, {
                state: location.state,
                county: actualCounty,
                year: year
            }).catch(() => {}); // Don't fail if archiving fails

            parsed = parseSlaveSchedule(ocrText, metadata);
            extractionMethod = 'census_ocr_extraction';

            console.log(`      👥 Found: ${parsed.owners.length} owners, ${parsed.enslaved.length} enslaved (OCR - needs review)`);
        }

        // Store owners
        for (const owner of parsed.owners) {
            owner.extractionMethod = extractionMethod;
            owner.confidence = extractionMethod === 'pre_indexed' ? 0.95 : 0.60;
            const leadId = await storePerson(owner, dryRun);
            if (leadId) stats.ownersExtracted++;
        }

        // Store enslaved persons
        for (const enslaved of parsed.enslaved) {
            enslaved.extractionMethod = extractionMethod;
            enslaved.confidence = extractionMethod === 'pre_indexed' ? 0.95 : 0.60;
            const leadId = await storePerson(enslaved, dryRun);
            if (leadId) {
                stats.personsExtracted++;
                // Create relationship to owner if known
                if (enslaved.owner) {
                    await storeRelationship(enslaved.owner, enslaved.name, enslaved.sourceUrl, dryRun);
                }
            }
        }

        // Rate limiting - wait between images
        await new Promise(r => setTimeout(r, 2000));
    }

    // Mark location as scraped
    if (sql && !dryRun) {
        try {
            await sql`
                UPDATE familysearch_locations
                SET scraped_at = CURRENT_TIMESTAMP,
                    image_count = ${images.length}
                WHERE id = ${location.id}
            `;
        } catch (e) {
            // Ignore update errors
        }
    }

    stats.locationsProcessed++;
}

/**
 * Main extraction function
 */
async function main() {
    console.log('======================================================================');
    console.log('🔍 FAMILYSEARCH CENSUS OCR EXTRACTION');
    console.log('======================================================================');
    console.log(`Database: ${DATABASE_URL ? 'Connected' : 'Dry Run'}`);
    console.log(`Google Vision: ${GOOGLE_VISION_API_KEY ? 'Available' : 'Not configured'}`);
    console.log(`Interactive: ${INTERACTIVE}`);
    console.log('======================================================================\n');

    // Parse command line args - handle both --arg value and --arg=value formats
    const args = process.argv.slice(2);

    function getArgValue(argName) {
        // Check for --arg=value format first
        const equalsArg = args.find(a => a.startsWith(`--${argName}=`));
        if (equalsArg) {
            return equalsArg.split('=')[1];
        }
        // Then check for --arg value format
        const idx = args.indexOf(`--${argName}`);
        if (idx !== -1 && args[idx + 1]) {
            return args[idx + 1];
        }
        return null;
    }

    // Support single state (--state) or multiple states (--states)
    let stateFilter = getArgValue('state');
    const statesArg = getArgValue('states');
    const statesFilter = statesArg ? statesArg.split(',').map(s => s.trim()) : (stateFilter ? [stateFilter] : null);

    const countyFilter = getArgValue('county');
    // Use high limit for multi-state runs (2000 per state should cover most states)
    const defaultLimit = statesFilter && statesFilter.length > 1 ? statesFilter.length * 2000 : 50;
    const limitArgStr = getArgValue('limit');
    const limitArg = limitArgStr ? parseInt(limitArgStr) : defaultLimit;
    const dryRun = args.includes('--dry-run');

    if (statesFilter && statesFilter.length > 1) {
        console.log(`📍 Multi-state mode: ${statesFilter.join(', ')} (limit: ${limitArg})`);
    } else if (statesFilter) {
        console.log(`📍 State filter: ${statesFilter[0]} (limit: ${limitArg})`);
    }

    // Year filter: 1850 = collection 1420440 (slave schedule), 1860 = collection 3161105
    // NOTE: Collection 1401638 is the REGULAR 1850 census, NOT slave schedule!
    const yearFilterStr = getArgValue('year');
    const yearFilter = yearFilterStr ? parseInt(yearFilterStr) : null;
    const directCollection = getArgValue('collection');
    const collectionFilter = directCollection || (yearFilter === 1850 ? '1420440' : yearFilter === 1860 ? '3161105' : null);

    if (directCollection) {
        console.log(`📅 Collection filter: ${collectionFilter}`);
    } else if (yearFilter) {
        console.log(`📅 Year filter: ${yearFilter} (collection ${collectionFilter})`);
    }

    if (dryRun) {
        console.log('🏃 DRY RUN MODE - No data will be saved\n');
    }

    // Initialize
    initDatabase();
    await initBrowser();
    await ensureLoggedIn();

    // Fetch locations to process
    console.log('\n📋 Fetching locations to process...');

    let query = `
        SELECT * FROM familysearch_locations
        WHERE waypoint_id IS NOT NULL
        AND (scraped_at IS NULL OR scraped_at < NOW() - INTERVAL '7 days')
    `;

    const params = [];

    // Add collection/year filter first (most important filter)
    if (collectionFilter) {
        query += ` AND collection_id = $1`;
        params.push(collectionFilter);
    }

    if (statesFilter) {
        const paramNum = params.length + 1;
        query += ` AND state = ANY($${paramNum})`;
        params.push(statesFilter);
    }

    if (countyFilter) {
        const paramNum = params.length + 1;
        query += ` AND county = $${paramNum}`;
        params.push(countyFilter);
    }

    query += ` ORDER BY collection_id, state, county LIMIT ${limitArg}`;

    let locations;
    if (sql) {
        // Use neon tagged template for the query
        // Filter for actual districts (not parent entries where district=state or district=county)
        // Build dynamic query based on filters
        if (collectionFilter && statesFilter && countyFilter) {
            locations = await sql`
                SELECT * FROM familysearch_locations
                WHERE waypoint_id IS NOT NULL
                AND waypoint_id NOT LIKE '%collection%'
                AND district != state AND district != county
                AND (scraped_at IS NULL OR scraped_at < NOW() - INTERVAL '7 days')
                AND collection_id = ${collectionFilter}
                AND state = ANY(${statesFilter})
                AND county = ${countyFilter}
                ORDER BY collection_id, state, county, district
                LIMIT ${limitArg}
            `;
        } else if (collectionFilter && statesFilter) {
            locations = await sql`
                SELECT * FROM familysearch_locations
                WHERE waypoint_id IS NOT NULL
                AND waypoint_id NOT LIKE '%collection%'
                AND district != state AND district != county
                AND (scraped_at IS NULL OR scraped_at < NOW() - INTERVAL '7 days')
                AND collection_id = ${collectionFilter}
                AND state = ANY(${statesFilter})
                ORDER BY collection_id, state, county, district
                LIMIT ${limitArg}
            `;
        } else if (collectionFilter) {
            locations = await sql`
                SELECT * FROM familysearch_locations
                WHERE waypoint_id IS NOT NULL
                AND waypoint_id NOT LIKE '%collection%'
                AND district != state AND district != county
                AND (scraped_at IS NULL OR scraped_at < NOW() - INTERVAL '7 days')
                AND collection_id = ${collectionFilter}
                ORDER BY collection_id, state, county, district
                LIMIT ${limitArg}
            `;
        } else if (statesFilter && countyFilter) {
            locations = await sql`
                SELECT * FROM familysearch_locations
                WHERE waypoint_id IS NOT NULL
                AND waypoint_id NOT LIKE '%collection%'
                AND district != state AND district != county
                AND (scraped_at IS NULL OR scraped_at < NOW() - INTERVAL '7 days')
                AND state = ANY(${statesFilter})
                AND county = ${countyFilter}
                ORDER BY collection_id, state, county, district
                LIMIT ${limitArg}
            `;
        } else if (statesFilter) {
            locations = await sql`
                SELECT * FROM familysearch_locations
                WHERE waypoint_id IS NOT NULL
                AND waypoint_id NOT LIKE '%collection%'
                AND district != state AND district != county
                AND (scraped_at IS NULL OR scraped_at < NOW() - INTERVAL '7 days')
                AND state = ANY(${statesFilter})
                ORDER BY collection_id, state, county, district
                LIMIT ${limitArg}
            `;
        } else {
            // FALLBACK: Always apply collection filter if specified, even with no other filters
            // BUG FIX: Previously this clause had NO collection filter which caused
            // the scraper to pull from wrong collections (e.g., 1401638 regular census
            // when 3161105 slave schedule was requested)
            if (collectionFilter) {
                console.log(`   🔒 Applying collection filter: ${collectionFilter}`);
                locations = await sql`
                    SELECT * FROM familysearch_locations
                    WHERE waypoint_id IS NOT NULL
                    AND waypoint_id NOT LIKE '%collection%'
                    AND district != state AND district != county
                    AND (scraped_at IS NULL OR scraped_at < NOW() - INTERVAL '7 days')
                    AND collection_id = ${collectionFilter}
                    ORDER BY collection_id, state, county, district
                    LIMIT ${limitArg}
                `;
            } else {
                console.log('⚠️ WARNING: No collection filter - fetching from ALL collections');
                locations = await sql`
                    SELECT * FROM familysearch_locations
                    WHERE waypoint_id IS NOT NULL
                    AND waypoint_id NOT LIKE '%collection%'
                    AND district != state AND district != county
                    AND (scraped_at IS NULL OR scraped_at < NOW() - INTERVAL '7 days')
                    ORDER BY collection_id, state, county, district
                    LIMIT ${limitArg}
                `;
            }
        }
    } else {
        console.log('⚠️ No database - cannot fetch locations');
        locations = [];
    }

    console.log(`Found ${locations.length} locations to process`);

    if (locations.length === 0) {
        console.log('\n✅ No unscraped locations found. Exiting.');
        await browser.close();
        return;
    }

    // Initialize progress tracking
    await initProgress(yearFilter || 'mixed', collectionFilter || 'all', locations.length);

    // Process each location
    for (const location of locations) {
        try {
            // Update progress with current location
            await updateProgress(location.state, location.county, location.district);

            await processLocation(location, dryRun);
        } catch (error) {
            console.log(`   ❌ Error: ${error.message}`);
            stats.errors++;
        }

        // Save progress periodically
        if (stats.locationsProcessed % 10 === 0) {
            printStats();
            await updateProgress(location.state, location.county, location.district);
        }
    }

    // Mark as complete
    await completeProgress('completed');

    // Final stats
    console.log('\n======================================================================');
    console.log('📊 EXTRACTION COMPLETE');
    console.log('======================================================================');
    printStats();

    // Cleanup
    await browser.close();
}

function printStats() {
    const elapsed = Math.round((Date.now() - stats.startTime) / 1000);
    console.log(`
   Locations processed: ${stats.locationsProcessed}
   Images processed:    ${stats.imagesProcessed}
   Owners extracted:    ${stats.ownersExtracted}
   Enslaved extracted:  ${stats.personsExtracted}
   Errors:              ${stats.errors}
   Elapsed time:        ${Math.floor(elapsed / 60)}m ${elapsed % 60}s
`);
}

// Run
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
