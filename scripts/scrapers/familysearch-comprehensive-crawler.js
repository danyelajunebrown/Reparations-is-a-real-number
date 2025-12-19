/**
 * FamilySearch Comprehensive Crawler
 *
 * Navigates the entire FamilySearch collection hierarchy:
 * Collection → State → County → District → Images
 *
 * Features:
 * - Crawls all slave schedules and related collections
 * - Extracts and promotes enslaved persons and owners
 * - Archives URLs with integrity hashes (tampering detection)
 * - Tracks scraping progress for resumption
 *
 * Usage:
 *   FAMILYSEARCH_INTERACTIVE=true node scripts/scrapers/familysearch-comprehensive-crawler.js
 *
 * Collections to crawl:
 * - 3161105: US Census Slave Schedule 1860
 * - 1420440: US Census Slave Schedule 1850 (NOT 1401638 which is regular census!)
 * - Various state-specific slavery records
 */

// Load environment variables from .env
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

puppeteer.use(StealthPlugin());

// FamilySearch API endpoints
const FS_API_BASE = 'https://www.familysearch.org/service/cds/recapi';
const FS_COLLECTION_WAYPOINTS_URL = (collectionId) => `${FS_API_BASE}/collections/${collectionId}/waypoints`;
const FS_DRILL_WAYPOINTS_URL = (waypointId, collectionId) => `${FS_API_BASE}/waypoints/${waypointId}?cc=${collectionId}`;

// Slave-related collections on FamilySearch
// IMPORTANT: Collection 1401638 is the REGULAR 1850 census, NOT slave schedule!
const SLAVE_COLLECTIONS = [
    { id: '3161105', name: 'United States Census (Slave Schedule), 1860', priority: 1 },
    { id: '1420440', name: 'United States Census (Slave Schedule), 1850', priority: 2 },
    { id: '1919430', name: 'Freedmen\'s Bureau Records', priority: 3 },
    // NOTE: 1401638 is the 1850 REGULAR Census - do NOT use for slavery data
];

// Configuration
const DATABASE_URL = process.env.DATABASE_URL;
const INTERACTIVE = process.env.FAMILYSEARCH_INTERACTIVE === 'true';
const PROGRESS_DIR = path.join(__dirname, '.fs-crawler-progress');
const HASH_ALGORITHM = 'sha256';

// Ensure progress directory exists
if (!fs.existsSync(PROGRESS_DIR)) {
    fs.mkdirSync(PROGRESS_DIR, { recursive: true });
}

let sql = null;
let browser = null;

/**
 * Initialize database connection using Neon serverless (HTTP)
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
 * Helper to run SQL queries (works like pool.query but for neon serverless)
 */
async function dbQuery(query, params = []) {
    if (!sql) return { rows: [] };
    // Neon serverless uses tagged template literals, but we can also use sql.query()
    const result = await sql(query, params);
    return { rows: result };
}

/**
 * Generate integrity hash for a URL and its content
 */
function generateIntegrityHash(url, content, timestamp) {
    const data = JSON.stringify({ url, content, timestamp });
    return crypto.createHash(HASH_ALGORITHM).update(data).digest('hex');
}

/**
 * Archive a URL with tampering detection
 */
async function archiveUrl(url, content, metadata = {}) {
    const timestamp = new Date().toISOString();
    const hash = generateIntegrityHash(url, content, timestamp);

    if (sql) {
        await sql`
            INSERT INTO archived_urls (
                url, content_hash, content_snapshot, metadata,
                archived_at, hash_algorithm
            ) VALUES (${url}, ${hash}, ${content.substring(0, 10000)}, ${JSON.stringify(metadata)}, ${timestamp}, ${HASH_ALGORITHM})
            ON CONFLICT (url) DO UPDATE SET
                content_hash = ${hash},
                content_snapshot = ${content.substring(0, 10000)},
                metadata = ${JSON.stringify(metadata)},
                archived_at = ${timestamp},
                last_verified = CURRENT_TIMESTAMP
        `;
    }

    return { url, hash, timestamp };
}

/**
 * Verify URL integrity (check for tampering)
 */
async function verifyUrlIntegrity(url, currentContent) {
    if (!sql) return { verified: false, reason: 'No database' };

    const result = await sql`
        SELECT content_hash, content_snapshot, archived_at
        FROM archived_urls WHERE url = ${url}
    `;

    if (result.length === 0) {
        return { verified: false, reason: 'URL not archived' };
    }

    const { content_hash, archived_at } = result[0];
    const currentHash = generateIntegrityHash(url, currentContent, archived_at);

    if (currentHash === content_hash) {
        return { verified: true, unchanged: true };
    } else {
        // Content changed - possible tampering
        console.log(`⚠️  TAMPERING ALERT: Content changed for ${url}`);
        return { verified: true, unchanged: false, alert: 'Content modified since archival' };
    }
}

/**
 * Save crawler progress for resumption
 */
function saveProgress(collectionId, state, county, district, lastItem) {
    const progressFile = path.join(PROGRESS_DIR, `${collectionId}.json`);
    const progress = {
        collectionId,
        state,
        county,
        district,
        lastItem,
        timestamp: new Date().toISOString()
    };
    fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2));
}

/**
 * Load crawler progress for resumption
 */
function loadProgress(collectionId) {
    const progressFile = path.join(PROGRESS_DIR, `${collectionId}.json`);
    if (fs.existsSync(progressFile)) {
        return JSON.parse(fs.readFileSync(progressFile, 'utf8'));
    }
    return null;
}

// Store cookies after login
let sessionCookies = null;

/**
 * Launch browser using user's Chrome profile (has existing logins)
 */
async function initBrowserWithLogin() {
    const chromeUserDataDir = process.env.HOME + '/Library/Application Support/Google/Chrome';
    const tempProfileDir = '/tmp/puppeteer-chrome-profile';

    console.log('🌐 Launching browser for FamilySearch...\n');
    console.log('⚠️  IMPORTANT: Close ALL Chrome windows first!\n');
    console.log('Waiting 5 seconds for you to close Chrome...\n');
    await new Promise(r => setTimeout(r, 5000));

    try {
        // Try to use the user's existing Chrome profile
        browser = await puppeteer.launch({
            headless: false,
            executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            userDataDir: chromeUserDataDir,
            defaultViewport: null,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--start-maximized',
                '--profile-directory=Default'
            ]
        });
        console.log('✅ Using your existing Chrome profile (should have your logins)\n');
    } catch (e) {
        console.log('⚠️  Could not use existing Chrome profile: ' + e.message);
        console.log('   Falling back to fresh browser...\n');

        // Fallback to fresh Chromium
        browser = await puppeteer.launch({
            headless: false,
            defaultViewport: null,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--start-maximized',
                '--disable-blink-features=AutomationControlled'
            ],
            ignoreDefaultArgs: ['--enable-automation']
        });
    }

    const page = await browser.newPage();

    console.log('📍 Navigating to FamilySearch...');
    await page.goto('https://www.familysearch.org/en/', { waitUntil: 'networkidle2' });

    // Check if already logged in
    const isLoggedIn = await page.evaluate(() => {
        return document.cookie.includes('fssessionid') ||
               document.querySelector('[data-testid="signed-in-user-menu"]') !== null ||
               document.querySelector('.signed-in') !== null;
    });

    if (isLoggedIn) {
        console.log('✅ Already logged in to FamilySearch!\n');
    } else {
        console.log('\n' + '='.repeat(50));
        console.log('👤 MANUAL LOGIN REQUIRED');
        console.log('='.repeat(50));
        console.log('1. Click "Sign In" in the browser window');
        console.log('2. Log in with your FamilySearch account');
        console.log('3. Once logged in, the script will continue automatically');
        console.log('='.repeat(50) + '\n');

        // Poll for login instead of waitForFunction (more robust)
        let loginDetected = false;
        const maxAttempts = 300; // 5 minutes at 1 second intervals
        for (let attempt = 0; attempt < maxAttempts && !loginDetected; attempt++) {
            await new Promise(r => setTimeout(r, 1000));
            try {
                loginDetected = await page.evaluate(() => {
                    return document.cookie.includes('fssessionid') ||
                           document.querySelector('[data-testid="signed-in-user-menu"]') !== null ||
                           document.querySelector('.signed-in') !== null ||
                           document.querySelector('[data-testid="user-icon"]') !== null ||
                           window.location.href.includes('/tree/');
                });
                if (attempt > 0 && attempt % 10 === 0) {
                    console.log(`  Waiting for login... (${attempt}s)`);
                }
            } catch (e) {
                // Page might be navigating, continue polling
            }
        }
        if (!loginDetected) {
            console.log('⚠️  Login timeout - continuing anyway in case session exists');
        } else {
            console.log('✅ Login detected!\n');
        }
    }

    // Get cookies for API requests
    sessionCookies = await page.cookies();
    console.log(`📦 Captured ${sessionCookies.length} session cookies\n`);

    return page;
}

/**
 * Fetch waypoints for a collection or drill into a waypoint
 * @param collectionId - The collection ID
 * @param waypointId - Optional waypoint ID for drilling (e.g., "8B44-929:1610302401")
 */
async function fetchWaypoints(collectionId, waypointId = null) {
    // Top-level: /collections/{id}/waypoints
    // Drill-down: /waypoints/{waypointId}?cc={collectionId}
    const url = waypointId
        ? FS_DRILL_WAYPOINTS_URL(waypointId, collectionId)
        : FS_COLLECTION_WAYPOINTS_URL(collectionId);

    try {
        // Build cookie header from session
        const cookieHeader = sessionCookies
            ? sessionCookies.map(c => `${c.name}=${c.value}`).join('; ')
            : '';

        console.log(`    [DEBUG] Fetching: ${url}`);

        const response = await axios.get(url, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                'Cookie': cookieHeader
            }
        });

        // Archive this API response
        await archiveUrl(url, JSON.stringify(response.data), {
            type: 'waypoints',
            collectionId,
            waypointId: waypointId
        });

        return response.data;
    } catch (err) {
        console.error(`Error fetching waypoints (${url}): ${err.response?.status || err.message}`);
        return null;
    }
}

/**
 * Parse GEDCOMX waypoints response to extract hierarchy
 * Returns { waypoints, isLeafLevel } - isLeafLevel true if these are images not sub-waypoints
 */
function parseWaypoints(data) {
    const waypoints = [];
    let isLeafLevel = false;

    // Handle XML or JSON format
    if (data.sourceDescriptions) {
        for (const sd of data.sourceDescriptions) {
            // Check if this is an image (leaf node) vs a waypoint (branch)
            const isImage = sd.about?.includes('/image/') ||
                           sd.resourceType === 'http://gedcomx.org/DigitalArtifact' ||
                           sd.titles?.[0]?.value?.match(/^(Image|Page|Film)\s+\d+/i);

            if (isImage) {
                isLeafLevel = true;
            }

            // Extract the REAL waypoint ID from the 'about' URL
            // Format: https://www.familysearch.org/service/cds/recapi/waypoints/8B44-929:1610302401?cc=3161105
            let waypointId = null;
            if (sd.about) {
                const match = sd.about.match(/\/waypoints\/([^?]+)/);
                if (match) {
                    waypointId = match[1];
                }
            }

            waypoints.push({
                id: sd.id,
                waypointId: waypointId, // The REAL ID for drilling down
                title: sd.titles?.[0]?.value || 'Unknown',
                identifier: sd.identifiers?.['http://gedcomx.org/Primary']?.[0] || null,
                about: sd.about,
                sortKey: sd.sortKey,
                isImage
            });
        }
    }

    return { waypoints, isLeafLevel };
}

/**
 * Extract enslaved persons from image OCR/transcript
 */
async function extractEnslavedFromImage(imageUrl, transcript, metadata) {
    const extracted = [];

    // Common patterns in slave schedules
    const patterns = [
        // Age, sex, color pattern
        /(\d{1,2})\s+(M|F|male|female)\s+(B|M|black|mulatto)/gi,
        // Name patterns (if available)
        /(?:slave|servant|negro)\s+(?:named?\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi,
        // Owner patterns
        /(?:owner|slaveholder|master)\s*[:.]?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi
    ];

    // Extract from transcript
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(transcript)) !== null) {
            extracted.push({
                matchedText: match[0],
                groups: match.slice(1),
                imageUrl,
                metadata
            });
        }
    }

    return extracted;
}

/**
 * Store extracted person in database with promotion logic
 */
async function storeExtractedPerson(personData) {
    if (!sql) {
        console.log('  Would store:', personData);
        return;
    }

    const name = personData.name;
    const type = personData.type || 'enslaved';
    const sourceUrl = personData.sourceUrl;
    const context = personData.context;
    const confidence = personData.confidence || 0.7;
    const method = 'familysearch_comprehensive_crawler';
    const relationships = JSON.stringify(personData.relationships || {});

    // Insert into unconfirmed_persons
    const result = await sql`
        INSERT INTO unconfirmed_persons (
            full_name, person_type, source_url, context_text,
            confidence_score, extraction_method, relationships
        ) VALUES (${name}, ${type}, ${sourceUrl}, ${context}, ${confidence}, ${method}, ${relationships})
        ON CONFLICT (full_name, source_url) DO NOTHING
        RETURNING lead_id
    `;

    // If person has family links, add to family_relationships
    if (personData.relationships?.family) {
        for (const rel of personData.relationships.family) {
            await sql`
                INSERT INTO family_relationships (
                    person1_name, person1_role,
                    person2_name, person2_role,
                    relationship_type, source_url
                ) VALUES (${name}, ${rel.role}, ${rel.relatedName}, ${rel.relatedRole}, ${rel.type}, ${sourceUrl})
                ON CONFLICT DO NOTHING
            `;
        }
    }

    return result[0]?.lead_id;
}

/**
 * Main crawl function for a collection - drills down to county level
 * Handles variable hierarchy: some counties have districts, some go directly to images
 */
async function crawlCollection(collection) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Crawling: ${collection.name}`);
    console.log(`Collection ID: ${collection.id}`);
    console.log(`${'='.repeat(60)}\n`);

    // Load progress if available
    const progress = loadProgress(collection.id);
    let startState = 0;
    let startCounty = 0;
    if (progress) {
        console.log(`Resuming from: State ${progress.state}, County ${progress.county}`);
        startState = progress.state || 0;
        startCounty = progress.county || 0;
    }

    // Fetch top-level waypoints (states)
    const topWaypoints = await fetchWaypoints(collection.id);
    if (!topWaypoints) {
        console.error('Failed to fetch top-level waypoints');
        return;
    }

    const { waypoints: states } = parseWaypoints(topWaypoints);
    console.log(`Found ${states.length} states/territories\n`);

    // Debug: print first state entry structure
    if (states.length > 2) {
        console.log('Sample state entry:', JSON.stringify(states[2], null, 2));
    }

    // Debug: print raw sourceDescription to see full structure
    if (topWaypoints.sourceDescriptions?.length > 2) {
        console.log('Raw sourceDescription:', JSON.stringify(topWaypoints.sourceDescriptions[2], null, 2));
    }

    // Stats tracking
    const stats = {
        statesProcessed: 0,
        countiesProcessed: 0,
        districtsProcessed: 0,
        countiesWithoutDistricts: 0,
        imagesFound: 0
    };

    for (let i = startState; i < states.length; i++) {
        const state = states[i];

        // Skip non-state entries (like collection-level items)
        if (state.title.includes('Census') || state.title.includes('United States')) {
            console.log(`\n--- Skipping: ${state.title} (metadata entry) ---`);
            continue;
        }

        console.log(`\n--- Processing: ${state.title} (${i + 1}/${states.length}) ---`);
        console.log(`    Waypoint ID: ${state.waypointId}`);
        stats.statesProcessed++;

        if (!state.waypointId) {
            console.log(`    ⚠️ No waypoint ID, skipping...`);
            continue;
        }

        // Fetch county-level waypoints for this state using REAL waypoint ID
        const stateWaypoints = await fetchWaypoints(collection.id, state.waypointId);

        if (stateWaypoints) {
            const { waypoints: counties, isLeafLevel: stateIsLeaf } = parseWaypoints(stateWaypoints);
            console.log(`  📍 Found ${counties.length} counties in ${state.title}`);

            const countyStart = (i === startState) ? startCounty : 0;

            for (let j = countyStart; j < counties.length; j++) {
                const county = counties[j];
                console.log(`    📂 ${county.title} (${j + 1}/${counties.length})`);
                stats.countiesProcessed++;

                if (!county.waypointId) {
                    console.log(`      ⚠️ No waypoint ID for county, skipping...`);
                    continue;
                }

                // Fetch sub-level waypoints (districts OR images) using REAL waypoint ID
                const countyWaypoints = await fetchWaypoints(collection.id, county.waypointId);

                if (countyWaypoints) {
                    const { waypoints: subItems, isLeafLevel } = parseWaypoints(countyWaypoints);

                    if (isLeafLevel) {
                        // This county goes directly to images (no districts)
                        stats.countiesWithoutDistricts++;
                        stats.imagesFound += subItems.length;
                        console.log(`      📄 ${subItems.length} images (no district subdivision)`);

                        // Store county as a leaf location
                        if (sql) {
                            const collId = collection.id;
                            const stateTitle = state.title;
                            const countyTitle = county.title;
                            const countyWpId = county.waypointId;
                            const countyAbout = county.about;
                            const imgCount = subItems.length;
                            await sql`
                                INSERT INTO familysearch_locations (
                                    collection_id, state, county, district,
                                    waypoint_id, waypoint_url, image_count
                                ) VALUES (${collId}, ${stateTitle}, ${countyTitle}, ${null}, ${countyWpId}, ${countyAbout}, ${imgCount})
                                ON CONFLICT DO NOTHING
                            `;
                        }
                    } else if (subItems.length > 0) {
                        // This county has districts/townships
                        console.log(`      📋 ${subItems.length} districts/townships`);

                        for (const district of subItems) {
                            stats.districtsProcessed++;

                            // Store this as a scrapeable location
                            if (sql) {
                                const collId = collection.id;
                                const stateTitle = state.title;
                                const countyTitle = county.title;
                                const districtTitle = district.title;
                                const districtWpId = district.waypointId;
                                const districtAbout = district.about;
                                await sql`
                                    INSERT INTO familysearch_locations (
                                        collection_id, state, county, district,
                                        waypoint_id, waypoint_url
                                    ) VALUES (${collId}, ${stateTitle}, ${countyTitle}, ${districtTitle}, ${districtWpId}, ${districtAbout})
                                    ON CONFLICT DO NOTHING
                                `;
                            }
                        }
                    }
                }

                // Save progress after each county
                saveProgress(collection.id, i, j, null, null);

                // Rate limiting - be nice to FamilySearch
                await new Promise(r => setTimeout(r, 500));
            }
        }

        // Reset county counter for next state
        startCounty = 0;
    }

    console.log(`\n✅ Completed crawling: ${collection.name}`);
    console.log(`   States: ${stats.statesProcessed}`);
    console.log(`   Counties: ${stats.countiesProcessed}`);
    console.log(`   Districts: ${stats.districtsProcessed}`);
    console.log(`   Counties without districts: ${stats.countiesWithoutDistricts}`);
    console.log(`   Direct images found: ${stats.imagesFound}`);
}

/**
 * Create required tables if they don't exist
 */
async function ensureTablesExist() {
    if (!sql) return;

    await sql`
        CREATE TABLE IF NOT EXISTS archived_urls (
            id SERIAL PRIMARY KEY,
            url TEXT UNIQUE NOT NULL,
            content_hash VARCHAR(64) NOT NULL,
            content_snapshot TEXT,
            metadata JSONB,
            archived_at TIMESTAMP NOT NULL,
            last_verified TIMESTAMP,
            hash_algorithm VARCHAR(20) DEFAULT 'sha256',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_archived_urls_hash ON archived_urls(content_hash)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_archived_urls_archived_at ON archived_urls(archived_at)`;
    console.log('✅ archived_urls table ready');

    await sql`
        CREATE TABLE IF NOT EXISTS familysearch_locations (
            id SERIAL PRIMARY KEY,
            collection_id VARCHAR(50) NOT NULL,
            state VARCHAR(100),
            county VARCHAR(100),
            district VARCHAR(200),
            waypoint_id VARCHAR(100),
            waypoint_url TEXT,
            image_count INTEGER,
            scraped_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(collection_id, state, county, district)
        )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_fsl_collection ON familysearch_locations(collection_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_fsl_state ON familysearch_locations(state)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_fsl_county ON familysearch_locations(county)`;
    console.log('✅ familysearch_locations table ready');
}

/**
 * Main entry point
 */
async function main() {
    console.log('🔍 FamilySearch Slave Schedule Crawler');
    console.log('======================================\n');
    console.log('Target Collections:');
    console.log('  - 1860 US Census Slave Schedule');
    console.log('  - 1850 US Census Slave Schedule');
    console.log('  - Freedmen\'s Bureau Records\n');

    initDatabase();
    await ensureTablesExist();

    // Initialize browser and login
    if (INTERACTIVE) {
        await initBrowserWithLogin();
    } else {
        console.log('⚠️  Running without authentication - API calls may fail');
        console.log('   Use FAMILYSEARCH_INTERACTIVE=true for authenticated access\n');
    }

    // Process collections in priority order (slave schedules first)
    const sortedCollections = [...SLAVE_COLLECTIONS].sort((a, b) => a.priority - b.priority);

    for (const collection of sortedCollections) {
        await crawlCollection(collection);
    }

    // Cleanup
    if (browser) await browser.close();
    // Neon serverless uses HTTP - no connection to close
    console.log('\n🏁 Crawling complete!');
}

// Export for testing
module.exports = {
    crawlCollection,
    fetchWaypoints,
    parseWaypoints,
    archiveUrl,
    verifyUrlIntegrity,
    generateIntegrityHash
};

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}
