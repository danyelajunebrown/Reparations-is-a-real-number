/**
 * FamilySearch Ancestor Climber v2
 *
 * Climbs UP through ancestors using person details pages to find ALL slaveholder connections.
 * Uses the stable URL pattern: /tree/person/details/{FS_ID}
 *
 * ALGORITHM:
 * 1. Start with user's FamilySearch ID
 * 2. Go to their person details page
 * 3. Extract: name, dates, location, father_fs_id, mother_fs_id
 * 4. Check if person matches our enslaver database (exact name + location)
 * 5. If MATCH: record it AND continue climbing (don't stop!)
 * 6. Queue BOTH parents for processing
 * 7. Repeat BFS until historical cutoff (1450s) or tree exhausted
 * 8. Classify each match as DEBT (inheritance) or CREDIT (rape/violence victim line)
 *
 * v2 IMPROVEMENTS:
 * - Finds ALL slaveholder matches, not just first
 * - Historical cutoff at 1450s (start of transatlantic slave trade)
 * - Location matching to reduce false positives
 * - Credit vs debt classification per lineage
 * - Session persistence for resume after interruption
 * - Auto-adds new slaveholders if documented
 *
 * Usage:
 *   FAMILYSEARCH_INTERACTIVE=true node scripts/scrapers/familysearch-ancestor-climber.js G21N-HD2
 *   FAMILYSEARCH_INTERACTIVE=true node scripts/scrapers/familysearch-ancestor-climber.js --resume <session_id>
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const { execSync, spawn } = require('child_process');
const DocumentVerifier = require('../../src/services/genealogy/DocumentVerifier');
const MatchVerifier = require('../../src/services/match-verification');
const BranchClassifier = require('../../src/services/genealogy/BranchClassifier');
const GarbageDetector = require('../../src/services/genealogy/GarbageDetector');

// Initialize branch classifier and garbage detector for context-aware climbing
const branchClassifier = new BranchClassifier();
const garbageDetector = new GarbageDetector();

puppeteer.use(StealthPlugin());

const sql = neon(process.env.DATABASE_URL);

// Initialize DocumentVerifier
const documentVerifier = new DocumentVerifier(process.env.DATABASE_URL, {
    bucket: process.env.S3_BUCKET_NAME,
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: process.env.AWS_ACCESS_KEY_ID ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    } : undefined
});

// Initialize MatchVerifier for race-aware post-match verification
const matchVerifier = new MatchVerifier(sql);

// Configuration
const INTERACTIVE = process.env.FAMILYSEARCH_INTERACTIVE === 'true';
const MAX_GENERATIONS = 50; // Increased - we use birth year cutoff instead
const MAX_NAME_ONLY_GENERATIONS = 12; // Hard cap for name-only BFS (no FS tree to validate)
const HISTORICAL_CUTOFF_YEAR = 1450; // Start of transatlantic slave trade
const MIN_ANCESTOR_BIRTH_YEAR = 1600; // Don't create identity records for estimated births before this
const PERSON_PAGE_URL = 'https://www.familysearch.org/en/tree/person/details/';
const SAVE_PROGRESS_EVERY = 10; // Save to DB every N ancestors

let browser = null;
let page = null;

/**
 * Build a flat lookup map from a nested participant family tree JSON.
 * Keys are normalized (lowercase, trimmed) person names.
 * Values contain the person's birth info and their declared parents.
 *
 * @param {object} node - Nested tree node: { name, birthYear, birthLocation, parents: [...] }
 * @param {object} map - Accumulator (internal use for recursion)
 * @returns {object} Flat map keyed by lowercase name
 */
function buildFamilyTreeMap(node, map = {}) {
    if (!node || !node.name) return map;
    const key = node.name.toLowerCase().trim();
    const entry = {
        name: node.name,
        birthYear: node.birthYear || null,
        birthLocation: node.birthLocation || null,
        parents: {}
    };
    if (node.parents && Array.isArray(node.parents)) {
        for (const p of node.parents) {
            if (!p || !p.name) continue;
            const rel = (p.relationship || '').toLowerCase();
            if (rel === 'father') {
                entry.parents.father = { name: p.name, birthYear: p.birthYear || null, birthLocation: p.birthLocation || null };
            } else if (rel === 'mother') {
                entry.parents.mother = { name: p.name, birthYear: p.birthYear || null, birthLocation: p.birthLocation || null };
            }
            buildFamilyTreeMap(p, map); // recurse into subtree
        }
    }
    map[key] = entry;
    return map;
}

/**
 * Look up a person's participant-provided parents from the family tree map.
 * Tries exact name match first, then first+last name match for fuzzy tolerance.
 * @param {string} personName
 * @param {object} familyTreeMap
 * @returns {object|null} Entry with .parents.father and .parents.mother, or null
 */
function lookupInFamilyTree(personName, familyTreeMap) {
    if (!personName || !familyTreeMap || Object.keys(familyTreeMap).length === 0) return null;
    const key = personName.toLowerCase().trim();
    // Exact match
    if (familyTreeMap[key]) return familyTreeMap[key];
    // Try first + last name only (handles middle name differences)
    // Prefer entries that actually have parents defined (more useful for discovery)
    const parts = key.split(/\s+/);
    if (parts.length >= 2) {
        const firstLast = parts[0] + ' ' + parts[parts.length - 1];
        let bestMatch = null;
        for (const [k, v] of Object.entries(familyTreeMap)) {
            const kParts = k.split(/\s+/);
            if (kParts.length >= 2) {
                const kFirstLast = kParts[0] + ' ' + kParts[kParts.length - 1];
                if (kFirstLast === firstLast) {
                    const hasParents = v.parents.father || v.parents.mother;
                    if (hasParents) return v; // Prefer entry with parents
                    if (!bestMatch) bestMatch = v;
                }
            }
        }
        if (bestMatch) return bestMatch;
    }
    return null;
}

// Session state (can be restored for resume)
let sessionId = null;
let visited = new Set();
let ancestors = [];
let allMatches = []; // NEW: Store ALL matches, not just first
let failedExtractions = []; // Track failed profiles for diagnostics

/**
 * Recover from detached frame errors by getting a fresh page from Chrome.
 * Returns true if recovery succeeded, false otherwise.
 */
async function recoverPage() {
    console.log('   🔄 Page frame detached — recovering...');
    try {
        // Close the dead page if possible
        try { await page.close(); } catch (_) {}
        // Get a fresh page from the connected browser
        page = await browser.newPage();
        // Quick smoke test: can we navigate?
        await page.goto('about:blank', { timeout: 10000 });
        console.log('   ✓ Page recovered successfully');
        return true;
    } catch (err) {
        console.log(`   ✗ Page recovery failed: ${err.message.substring(0, 60)}`);
        // Last resort: try reconnecting to Chrome entirely
        try {
            browser = await puppeteer.connect({
                browserURL: 'http://127.0.0.1:9222',
                defaultViewport: null
            });
            page = await browser.newPage();
            console.log('   ✓ Reconnected to Chrome and got fresh page');
            return true;
        } catch (reconnErr) {
            console.log(`   ✗ Chrome reconnect failed: ${reconnErr.message.substring(0, 60)}`);
            return false;
        }
    }
}

/**
 * Safe page.goto wrapper that detects detached frames and recovers.
 * Returns true if navigation succeeded, false if it failed even after recovery.
 */
async function safeGoto(url, options = {}) {
    const defaults = { waitUntil: 'networkidle2', timeout: 30000 };
    const opts = { ...defaults, ...options };
    try {
        await page.goto(url, opts);
        return true;
    } catch (err) {
        if (err.message.includes('detached') || err.message.includes('Target closed') ||
            err.message.includes('Session closed') || err.message.includes('Protocol error')) {
            const recovered = await recoverPage();
            if (recovered) {
                try {
                    await page.goto(url, opts);
                    return true;
                } catch (retryErr) {
                    console.log(`   ✗ Navigation failed after recovery: ${retryErr.message.substring(0, 60)}`);
                    return false;
                }
            }
            return false;
        }
        throw err; // Re-throw non-detachment errors
    }
}

/**
 * Check if page is still usable (not detached).
 */
async function isPageHealthy() {
    try {
        await page.evaluate(() => true);
        return true;
    } catch (err) {
        return false;
    }
}

/**
 * Detect if we've been redirected to login and wait for re-login.
 * Returns true if we were redirected and successfully re-logged in.
 */
async function checkAndRecoverLogin() {
    try {
        const currentUrl = page.url();
        if (currentUrl.includes('ident.familysearch') || currentUrl.includes('/auth/')) {
            console.log('   ⚠ Session expired — waiting for re-login (up to 3 min)...');
            let attempts = 0;
            while (attempts < 90) {
                await new Promise(r => setTimeout(r, 2000));
                const navUrl = page.url();
                if (!navUrl.includes('ident.familysearch') && !navUrl.includes('/auth/')) {
                    const cookies = await page.cookies();
                    fs.writeFileSync('./fs-climber-cookies.json', JSON.stringify(cookies, null, 2));
                    console.log(`   ✓ Re-logged in, saved ${cookies.length} cookies`);
                    return true;
                }
                attempts++;
            }
            console.log('   ✗ Login timeout after 3 minutes');
            return false;
        }
    } catch (_) {}
    return false;
}

/**
 * Capture diagnostics for failed extraction
 * 
 * Saves HTML, screenshot, and metadata to debug folder for analysis
 */
async function captureFailedExtraction(fsId, generation, page, failureType = 'no_name') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const debugDir = `debug/logs/failed-extractions/${sessionId || 'unknown'}`;
    
    // Create debug directory
    if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
    }
    
    const baseFilename = `${fsId}-gen${generation}-${failureType}`;
    
    try {
        // 1. Save full HTML
        const html = await page.content();
        const htmlPath = `${debugDir}/${baseFilename}.html`;
        fs.writeFileSync(htmlPath, html);
        
        // 2. Take screenshot
        const screenshotPath = `${debugDir}/${baseFilename}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: true });
        
        // 3. Extract visible text
        const visibleText = await page.evaluate(() => document.body.innerText);
        const textPath = `${debugDir}/${baseFilename}-text.txt`;
        fs.writeFileSync(textPath, visibleText);
        
        // 4. Extract all links and IDs
        const links = await page.evaluate(() => {
            const anchors = document.querySelectorAll('a[href*="/tree/person/details/"]');
            return Array.from(anchors).map(a => ({
                href: a.getAttribute('href'),
                text: a.innerText?.trim() || '',
                id: a.href.match(/details\/([A-Z0-9]{4}-[A-Z0-9]{2,4})/)?.[1]
            }));
        });
        
        // 5. Check for key indicators
        const indicators = await page.evaluate(() => {
            const text = document.body.innerText;
            return {
                hasFamilyMembers: text.includes('Family Members'),
                hasParentsAndSiblings: text.includes('Parents and Siblings'),
                hasLoginPrompt: text.includes('Sign In') || text.includes('Log In'),
                hasErrorMessage: text.includes('error') || text.includes('Error'),
                pageTitle: document.title,
                bodyTextLength: text.length,
                hasReactMarkers: !!document.querySelector('[data-reactroot]') || 
                                !!document.querySelector('[data-react-helmet]')
            };
        });
        
        // 6. Save metadata
        const metadata = {
            fs_id: fsId,
            generation,
            failure_type: failureType,
            timestamp,
            url: page.url(),
            indicators,
            links_found: links.length,
            fs_ids_on_page: links.map(l => l.id).filter(Boolean),
            html_size: html.length,
            text_length: visibleText.length,
            debug_files: {
                html: htmlPath,
                screenshot: screenshotPath,
                text: textPath
            }
        };
        
        const metadataPath = `${debugDir}/${baseFilename}-metadata.json`;
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
        
        // Track for summary
        failedExtractions.push({
            fs_id: fsId,
            generation,
            failure_type: failureType,
            folder: debugDir,
            ...metadata
        });
        
        return {
            folder: debugDir,
            htmlSize: html.length,
            linkCount: links.length,
            textLength: visibleText.length,
            screenshotPath,
            textSample: visibleText.substring(0, 200),
            indicators,
            fsIdsFound: links.map(l => l.id).filter(Boolean)
        };
    } catch (e) {
        console.log(`   ⚠ Error capturing diagnostics: ${e.message}`);
        return {
            error: e.message,
            folder: debugDir
        };
    }
}

/**
 * Launch Chrome with remote debugging (more stable than Puppeteer launch)
 */
async function launchBrowser() {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║         LAUNCHING CHROME FOR FAMILYSEARCH                  ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log('║  A Chrome window will open.                                ║');
    console.log('║  Log in if needed, then scraper will start automatically.  ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    // Try to connect to existing Chrome with remote debugging first
    let connected = false;
    try {
        browser = await puppeteer.connect({
            browserURL: 'http://127.0.0.1:9222',
            defaultViewport: null
        });
        connected = true;
        console.log('Connected to existing Chrome instance!\n');
    } catch (e) {
        console.log('No existing Chrome with remote debugging found, launching new instance...');
    }

    if (!connected) {
        // Determine executable (Pi/Linux vs Mac)
        const envExecutable = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.BROWSER_EXECUTABLE;
        // Common defaults
        const candidates = [
            envExecutable,
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium',
            'chromium-browser',
            'chromium',
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        ].filter(Boolean);

        // Resolve an executable: if absolute path, must exist; if command name, must be found via `which`
        function resolveExecutable(cmd) {
            if (!cmd) return null;
            try {
                const fs = require('fs');
                if (cmd.includes('/')) {
                    return fs.existsSync(cmd) ? cmd : null;
                }
                // command without path: check PATH via which
                try {
                    const out = execSync(`which ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
                    return out && fs.existsSync(out) ? out : null;
                } catch {
                    return null;
                }
            } catch {
                return null;
            }
        }

        // Pick first resolvable executable, fallback to last candidate (usually Google Chrome on macOS)
        let executable = null;
        for (const c of candidates) {
            const r = resolveExecutable(c);
            if (r) { executable = r; break; }
        }
        if (!executable) executable = candidates[candidates.length - 1];

        const execBase = executable.split('/').pop();

        // NOTE: Do NOT kill other climber processes — multiple climbs may run concurrently

        // Create temp profile
        const tempProfileDir = '/tmp/familysearch-ancestor-climber';
        if (!fs.existsSync(tempProfileDir)) {
            fs.mkdirSync(tempProfileDir, { recursive: true });
        }

        // Launch Chrome with remote debugging
        const chromeArgs = [
            '--remote-debugging-port=9222',
            `--user-data-dir=${tempProfileDir}`,
            '--no-first-run',
            '--no-default-browser-check',
            '--window-size=1200,900',
            '--password-store=basic',
            'about:blank'
        ];

        // On macOS, use 'open -a' to launch Chrome through the window server
        // (direct spawn from SSH/PM2 can't access the GUI session)
        if (process.platform === 'darwin') {
            const escaped = chromeArgs.map(a => `"${a}"`).join(' ');
            execSync(`open -a "Google Chrome" --args ${chromeArgs.join(' ')}`, { stdio: 'ignore' });
        } else {
            const chromeProcess = spawn(executable, chromeArgs, { detached: true, stdio: 'ignore' });
            chromeProcess.unref();
        }

        // Wait for Chrome to start
        console.log(`Launching ${execBase} and waiting for remote debugger...`);
        await new Promise(r => setTimeout(r, 4000));

        // Connect Puppeteer
        for (let i = 0; i < 20; i++) {
            try {
                browser = await puppeteer.connect({
                    browserURL: 'http://127.0.0.1:9222',
                    defaultViewport: null
                });
                connected = true;
                console.log('Connected to Chrome!\n');
                break;
            } catch (e) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }
    }

    if (!connected) {
        throw new Error('Could not connect to Chrome');
    }

    // Always create a new tab so concurrent climbs don't collide
    page = await browser.newPage();
}

/**
 * Ensure logged into FamilySearch
 */
async function ensureLoggedIn(startFsId) {
    // Name-only mode: navigate to search page instead of a person page
    const isNameOnly = startFsId === 'NAME-ONLY';
    const url = isNameOnly
        ? 'https://www.familysearch.org/search/record/results'
        : PERSON_PAGE_URL + startFsId;
    console.log(`Navigating to: ${url}\n`);

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 3000));

    // Check if we need to log in
    const currentUrl = page.url();
    if (currentUrl.includes('ident.familysearch') || currentUrl.includes('/auth/')) {
        console.log('╔════════════════════════════════════════════════════════════╗');
        console.log('║              MANUAL LOGIN REQUIRED                         ║');
        console.log('╠════════════════════════════════════════════════════════════╣');
        console.log('║  1. Log in with FamilySearch or Google                     ║');
        console.log('║  2. Wait until you see the person profile page             ║');
        console.log('╚════════════════════════════════════════════════════════════╝\n');

        // Wait for login (up to 3 minutes)
        let attempts = 0;
        while (attempts < 90) {
            await new Promise(r => setTimeout(r, 2000));
            const navUrl = page.url();
            // In name-only mode, login redirects back to search results, not a person page
            if (navUrl.includes('/tree/person/details/') ||
                (isNameOnly && !navUrl.includes('ident.familysearch') && !navUrl.includes('/auth/'))) {
                break;
            }
            attempts++;
        }

        // Save cookies
        const cookies = await page.cookies();
        fs.writeFileSync('./fs-climber-cookies.json', JSON.stringify(cookies, null, 2));
        console.log(`Saved ${cookies.length} cookies\n`);
    }

    // In name-only mode, we just need to verify we're logged in (not on a login page)
    if (isNameOnly) {
        const checkUrl = page.url();
        if (checkUrl.includes('ident.familysearch') || checkUrl.includes('/auth/')) {
            throw new Error('FamilySearch login required. Please log in via the Chrome window.');
        }
        console.log('✓ Logged in (name-only mode) — will search records for ancestors\n');
        return;
    }

    // Wait for the React app to actually render the person data
    console.log('Waiting for person page to fully render...');
    try {
        await page.waitForFunction(() => {
            const bodyText = document.body.innerText;
            const title = document.title;
            // Check for actual content rendering (not just nav bar)
            const hasPersonContent = bodyText.includes('Family Members') ||
                                     bodyText.includes('Parents and Siblings') ||
                                     bodyText.includes('Person Not Found') ||
                                     bodyText.includes('Vital Information');
            const hasTitleName = title.match(/^[A-Z].*\(/) !== null;
            const hasH1 = document.querySelector('h1')?.innerText?.length > 2;
            return hasPersonContent || hasTitleName || hasH1;
        }, { timeout: 15000 });
        console.log(`Page rendered: ${await page.title()}`);
    } catch (e) {
        // Fallback: wait extra time for SPA to load
        console.log('Page title not in expected format, waiting extra time...');
        await new Promise(r => setTimeout(r, 5000));
    }

    // Check if the starting person actually exists
    const startPageText = await page.evaluate(() => document.body.innerText);
    const pageTitle = await page.title();
    if (startPageText.includes('Person Not Found') ||
        pageTitle.includes('[Unknown Name]') ||
        pageTitle.includes('UNKNOWN')) {
        // If we have participant info (parent names, birth data), the person's tree page
        // may be empty but we can still discover parents via record search.
        // Don't fail — let the BFS loop handle it with discoverParents().
        if (ensureLoggedIn._hasParticipantInfo) {
            console.log(`⚠ Person ${startFsId} shows as Unknown on FamilySearch tree, but participant info provided — will use record search to discover parents.\n`);
        } else {
            throw new Error(`Starting person ${startFsId} not found on FamilySearch. Verify the FamilySearch ID is correct.`);
        }
    } else {
        console.log('✓ Logged in and ready to climb ancestors\n');
    }
}

/**
 * Extract person data from details page
 *
 * Page structure (from screenshots Dec 19, 2025):
 * - Page title format: "Danyele Brown (1996–Living) • Person • Family Tree"
 * - Header area has person name in large text
 * - Below that: "9 May 1996 – Living • G21N-HD2"
 * - "Family Members" section with "Parents and Siblings" subsection
 * - Parents show: "Name" then "dates • FS_ID" (FS ID visible in text!)
 */
async function extractPersonFromPage() {
    return await page.evaluate(() => {
        const result = {
            fs_id: null,
            name: null,
            birth_year: null,
            death_year: null,
            birth_place: null,
            locations: [], // NEW: Extract all location mentions
            father_fs_id: null,
            mother_fs_id: null,
            parents: [],
            raw: {}
        };

        // Get FS ID from URL
        const urlMatch = window.location.pathname.match(/details\/([A-Z0-9]{4}-[A-Z0-9]{2,4})/);
        if (urlMatch) result.fs_id = urlMatch[1];

        // METHOD 1: Get name from page title
        // Format examples:
        // "Danyele Brown (1996–Living) • Person • Family Tree"
        // "Fannie (Deceased) • Person • Family Tree"
        // "John Smith (Living) • Person • Family Tree"
        
        // Try with birth year first (preferred)
        const titleMatchWithYear = document.title.match(/^([^(]+)\s*\((\d{4})/);
        if (titleMatchWithYear) {
            result.name = titleMatchWithYear[1].trim();
            result.birth_year = parseInt(titleMatchWithYear[2]);
        } else {
            // Fallback: Extract name without year (handles "Fannie (Deceased)" cases)
            const titleMatchNoYear = document.title.match(/^([^(]+)\s*\((Deceased|Living|[\d?])/);
            if (titleMatchNoYear) {
                result.name = titleMatchNoYear[1].trim();
                // Mark as unknown year but person exists
                result.birth_year = null;
            }
        }

        // Check for death year in title
        const deathInTitle = document.title.match(/(\d{4})[–-](\d{4})/);
        if (deathInTitle) {
            result.birth_year = parseInt(deathInTitle[1]);
            result.death_year = parseInt(deathInTitle[2]);
        }

        // LOCATION EXTRACTION - look for US states and counties
        const allText = document.body.innerText;
        const usStates = [
            'Alabama', 'Arkansas', 'Delaware', 'Florida', 'Georgia', 'Kentucky',
            'Louisiana', 'Maryland', 'Mississippi', 'Missouri', 'North Carolina',
            'South Carolina', 'Tennessee', 'Texas', 'Virginia', 'West Virginia',
            'District of Columbia', 'Washington DC'
        ];
        for (const state of usStates) {
            if (allText.includes(state)) {
                result.locations.push(state);
            }
        }

        // Look for birth/death place patterns
        const placePatterns = [
            /born[^,]*?,\s*([A-Za-z\s]+(?:County)?),?\s*([A-Za-z]+)/i,
            /died[^,]*?,\s*([A-Za-z\s]+(?:County)?),?\s*([A-Za-z]+)/i,
            /Birthplace:\s*([^\n]+)/i,
            /Death Place:\s*([^\n]+)/i
        ];
        for (const pattern of placePatterns) {
            const match = allText.match(pattern);
            if (match) {
                result.birth_place = result.birth_place || match[1]?.trim();
                if (match[2]) result.locations.push(match[2].trim());
            }
        }

        // Deduplicate locations
        result.locations = [...new Set(result.locations)];

        // RACE INDICATOR EXTRACTION - parse race/color from page text (no extra navigation)
        const racePatterns = [
            /(?:Race|Color|Colour)[\s:]+(\w+)/i,
            /(Black|Negro|Colored|Mulatto|White)\s+(?:male|female)/i,
            /Free\s+(?:Black|Negro|Colored|Person of Color)/i
        ];
        result.race_indicators = [];
        for (const rPattern of racePatterns) {
            const rMatch = allText.match(rPattern);
            if (rMatch) result.race_indicators.push(rMatch[0].trim());
        }

        // OCCUPATION EXTRACTION
        const occMatch = allText.match(/Occupation[\s:]+([^\n]+)/i);
        if (occMatch) result.occupation = occMatch[1].trim();

        // METHOD 2: Try H1 element (most reliable for person pages)
        if (!result.name) {
            const h1 = document.querySelector('h1');
            if (h1) {
                // H1 contains: "Name\nMale\nLiving\n•\nFS_ID"
                // Extract just the first line (the name)
                const h1Text = h1.innerText || h1.textContent;
                const lines = h1Text.split('\n');
                if (lines.length > 0) {
                    const nameCandidate = lines[0].trim();
                    // Verify it's a name (has at least 2 words, not a UI element)
                    const words = nameCandidate.split(/\s+/);
                    if (words.length >= 2 && !nameCandidate.match(/Family Tree|Search|Memories|Activities/i)) {
                        result.name = nameCandidate;
                    }
                }
            }
        }

        // METHOD 3: If H1 didn't work, try page content (but avoid UI elements)
        if (!result.name) {
            // Try to find main content area first (excludes navigation)
            const mainContent = document.querySelector('main') || 
                              document.querySelector('[role="main"]') ||
                              document;
            
            const contentText = mainContent.innerText || mainContent.textContent;
            
            // The FS ID appears after the name with format "• G21N-HD2"
            const nameIdMatch = contentText.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*\n[^•]*•\s*([A-Z0-9]{4}-[A-Z0-9]{2,4})/);
            if (nameIdMatch && nameIdMatch[2] === result.fs_id) {
                const nameCandidate = nameIdMatch[1].trim();
                // Verify not UI garbage
                if (!nameCandidate.match(/Family Tree|Search|Memories|Activities/i)) {
                    result.name = nameCandidate;
                }
            }
        }

        // PARENT EXTRACTION - allText already declared above

        // PARENT EXTRACTION - Multiple methods

        // UI Garbage Filter - patterns to exclude
        const uiGarbagePatterns = [
            /Family Tree/i,
            /Search/i,
            /Memories/i,
            /Get Involved/i,
            /Activities/i,
            /Sign In/i,
            /Help/i,
            /\n.*\n.*\n/  // Multi-line strings (likely UI menus)
        ];

        const isUIGarbage = (text) => {
            if (!text) return true;
            // Check for newlines (UI menu text)
            if (text.includes('\n')) return true;
            // Check against known UI patterns
            return uiGarbagePatterns.some(pattern => pattern.test(text));
        };

        // Method 1: Find "Parents and Siblings" section and extract FS IDs
        // The section shows parents with format: "Name\ndate • FS_ID"
        const parentsSection = allText.match(/Parents and Siblings([\s\S]*?)(?=Children\s*\(|Add Parent|$)/i);

        if (parentsSection) {
            const sectionText = parentsSection[1];
            // Find FS IDs in format "• XXXX-XXX" or just "XXXX-XXX" after dates
            const fsIdPattern = /([A-Z0-9]{4}-[A-Z0-9]{2,4})/g;
            let match;
            const foundIds = [];
            while ((match = fsIdPattern.exec(sectionText)) !== null) {
                const foundId = match[1];
                if (foundId !== result.fs_id && !foundIds.includes(foundId)) {
                    foundIds.push(foundId);
                }
            }
            result.parents = foundIds.slice(0, 2); // Take first 2 (the parents)
        }

        // Method 2: Find links to person details pages
        if (result.parents.length === 0) {
            const links = document.querySelectorAll('a[href*="/tree/person/details/"]');
            const foundIds = [];

            for (const link of links) {
                const href = link.getAttribute('href');
                const idMatch = href.match(/details\/([A-Z0-9]{4}-[A-Z0-9]{2,4})/);
                if (idMatch) {
                    const foundId = idMatch[1];
                    if (foundId !== result.fs_id && !foundIds.includes(foundId)) {
                        foundIds.push(foundId);
                    }
                }
            }

            // The parents usually appear before children in the page
            // Take up to 4 to catch both parents even with some noise
            result.parents = foundIds.slice(0, 4);
        }

        // Method 3: Look for specific parent labels near FS IDs
        if (result.parents.length === 0) {
            // Try to find Billy Bob Brown Jr and Nancy Miller style entries
            const parentEntries = allText.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*\n\s*(?:\d{4}[–-])?(?:Living)?\s*•?\s*([A-Z0-9]{4}-[A-Z0-9]{2,4})/g);
            if (parentEntries) {
                for (const entry of parentEntries) {
                    // Extract name and ID
                    const nameMatch = entry.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/);
                    const idMatch = entry.match(/([A-Z0-9]{4}-[A-Z0-9]{2,4})/);
                    
                    if (nameMatch && idMatch) {
                        const name = nameMatch[1];
                        const foundId = idMatch[1];
                        
                        // Skip if UI garbage
                        if (isUIGarbage(name)) {
                            continue;
                        }
                        
                        if (foundId !== result.fs_id && !result.parents.includes(foundId)) {
                            result.parents.push(foundId);
                        }
                    }
                }
                result.parents = result.parents.slice(0, 2);
            }
        }

        // Method 4: Portrait/Pedigree view - parse FS IDs from visible text
        // In portrait view, persons appear as blocks of text with FS IDs visible
        // Format: "FirstName\nLastName\nMale/Female\nFS_ID\nYears"
        if (result.parents.length === 0) {
            const fsIdPattern = /([A-Z0-9]{4}-[A-Z0-9]{2,4})/g;
            let match;
            const allFoundIds = [];
            while ((match = fsIdPattern.exec(allText)) !== null) {
                const foundId = match[1];
                if (foundId !== result.fs_id && !allFoundIds.includes(foundId)) {
                    allFoundIds.push(foundId);
                }
            }
            // In portrait view, the first 2 IDs after the person's own ID are typically the parents
            if (allFoundIds.length > 0) {
                result.parents = allFoundIds.slice(0, 2);
            }
        }

        // Method 5: Find links to person pages (broader selector for pedigree view)
        if (result.parents.length === 0) {
            const allLinks = document.querySelectorAll('a[href*="/tree/person/"]');
            const foundIds = [];
            for (const link of allLinks) {
                const href = link.getAttribute('href');
                const idMatch = href.match(/(?:details|portrait)\/([A-Z0-9]{4}-[A-Z0-9]{2,4})/);
                if (idMatch) {
                    const foundId = idMatch[1];
                    if (foundId !== result.fs_id && !foundIds.includes(foundId)) {
                        foundIds.push(foundId);
                    }
                }
            }
            if (foundIds.length > 0) {
                result.parents = foundIds.slice(0, 2);
            }
        }

        // Assign to father/mother slots (after filtering)
        if (result.parents.length >= 1) result.father_fs_id = result.parents[0];
        if (result.parents.length >= 2) result.mother_fs_id = result.parents[1];

        result.raw = {
            url: window.location.href,
            title: document.title,
            parentsFound: result.parents.length,
            allParentIds: result.parents,
            garbageFiltered: true,
            viewType: window.location.href.includes('portrait') ? 'portrait' :
                      window.location.href.includes('pedigree') ? 'pedigree' : 'details'
        };

        return result;
    });
}

// ═══════════════════════════════════════════════════════════════
// MULTI-SOURCE PARENT DISCOVERY
// When FamilySearch tree has no parent links, discover parents
// from historical records, WikiTree, and other sources.
// ═══════════════════════════════════════════════════════════════

/**
 * Search FamilySearch historical records for a person.
 * Parses the search results page to find records that may contain parent info.
 *
 * Key recon findings (from debug-familysearch-pages.js):
 * - H1: "Historical Record Search Results (N)"
 * - Results in <table> with headers: Name | Events and Relationships
 * - Parent names appear INLINE in results for obituary/genealogy records:
 *   "Parents Ilya Schor, Resia Schor"
 * - ARK links in data-testid attributes: "/ark:/61903/1:1:XXXX-XXX"
 * - Result roles: Principal, Child, Bride, etc.
 */

// ─── US Census Collection IDs on FamilySearch ───
const US_CENSUS_COLLECTIONS = {
    1850: '1401638',
    1860: '1473181',
    1870: '1438024',
    1880: '1417683',
    1900: '1325221',
    1910: '1727033',
    1920: '1488411',
    1930: '1810731',
    1940: '2000219'
};
const CENSUS_YEARS = Object.keys(US_CENSUS_COLLECTIONS).map(Number); // [1850, 1860, ..., 1940]

/**
 * Determine which census years a person would appear in as a child (age ~2–18).
 * Returns array of { censusYear, collectionId, estimatedAge } sorted by best fit.
 */
function getTargetCensusYears(birthYear) {
    if (!birthYear) return [];
    const targets = [];
    for (const cy of CENSUS_YEARS) {
        const age = cy - birthYear;
        if (age >= 2 && age <= 18) {
            targets.push({ censusYear: cy, collectionId: US_CENSUS_COLLECTIONS[cy], estimatedAge: age });
        }
    }
    // Prefer ages 4–10 (most likely living with parents), sort by distance from ideal age 6
    targets.sort((a, b) => Math.abs(a.estimatedAge - 6) - Math.abs(b.estimatedAge - 6));
    return targets;
}

/**
 * Check if a location string refers to a US location.
 */
function isUSLocation(location) {
    if (!location) return false;
    const loc = location.toLowerCase();
    const usIndicators = [
        'united states', 'usa', 'u.s.', 'america',
        'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado',
        'connecticut', 'delaware', 'florida', 'georgia', 'hawaii', 'idaho',
        'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana',
        'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota',
        'mississippi', 'missouri', 'montana', 'nebraska', 'nevada',
        'new hampshire', 'new jersey', 'new mexico', 'new york',
        'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon',
        'pennsylvania', 'rhode island', 'south carolina', 'south dakota',
        'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington',
        'west virginia', 'wisconsin', 'wyoming', 'district of columbia',
        'detroit', 'chicago', 'new orleans', 'philadelphia', 'baltimore',
        'boston', 'st. louis', 'memphis', 'atlanta', 'richmond', 'charleston'
    ];
    return usIndicators.some(ind => loc.includes(ind));
}

async function searchFamilySearchRecords(person, branchContext = null) {
    if (!person.name) return [];

    // ─── Branch context skip: non-US Eastern European branches won't appear in US census ───
    const personLocation = person.birth_place || (person.locations && person.locations[0]) || '';
    const isNonUSBranch = ['eastern_european_jewish', 'eastern_european'].includes(branchContext)
        && !isUSLocation(personLocation);
    if (isNonUSBranch) {
        console.log(`   [RecordSearch] Skipping: branch=${branchContext}, non-US location "${personLocation}"`);
        // Fall through to generic search only (no census targeting)
    }

    const nameParts = person.name.trim().split(/\s+/);
    const givenName = nameParts[0];
    const surname = nameParts[nameParts.length - 1];

    // ─── Census-targeted search: try targeted census collections first ───
    const canDoCensus = !isNonUSBranch && person.birth_year && isUSLocation(personLocation);
    if (canDoCensus) {
        const censusTargets = getTargetCensusYears(person.birth_year);
        if (censusTargets.length > 0) {
            console.log(`   [RecordSearch] Census-targeted: ${censusTargets.map(t => `${t.censusYear}(age~${t.estimatedAge})`).join(', ')}`);
            // Try up to 2 best census years
            for (const target of censusTargets.slice(0, 2)) {
                const censusResult = await searchCensusCollection(person, givenName, surname, target);
                if (censusResult && censusResult.length > 0) {
                    console.log(`   [RecordSearch] Census ${target.censusYear} found ${censusResult.length} parent(s)`);
                    return censusResult;
                }
                await new Promise(r => setTimeout(r, 2000));
            }
            console.log('   [RecordSearch] Census-targeted search found nothing, falling back to generic...');
        }
    }

    // ─── Generic record search (original approach) ───
    const params = new URLSearchParams();
    params.set('q.givenName', givenName);
    params.set('q.surname', surname);
    if (person.birth_year) {
        params.set('q.birthLikeDate.from', String(person.birth_year - 3));
        params.set('q.birthLikeDate.to', String(person.birth_year + 3));
    }
    if (person.birth_place) {
        params.set('q.birthLikePlace', person.birth_place);
    } else if (person.locations && person.locations.length > 0) {
        params.set('q.birthLikePlace', person.locations[0]);
    }

    const searchUrl = `https://www.familysearch.org/search/record/results?${params.toString()}`;
    console.log(`   [RecordSearch] Navigating to: ${searchUrl.substring(0, 100)}...`);

    try {
        if (!await safeGoto(searchUrl)) {
            console.log('   [RecordSearch] Navigation failed (page recovery unsuccessful)');
            return [];
        }
        await new Promise(r => setTimeout(r, 5000)); // Wait for React SPA to render results

        // Check for login redirect mid-climb
        await checkAndRecoverLogin();

        // Check for CAPTCHA
        if (await detectCaptcha()) return [];

        // Extract results from the rendered page
        const results = await page.evaluate((personName, personSurname) => {
            const bodyText = document.body.innerText;
            const found = [];

            // Check if we got results
            const h1 = document.querySelector('h1');
            if (!h1 || h1.innerText.includes('0)')) return found;

            // Helper: clean a captured name — strip sibling lists, "More", card UI text, etc.
            const cleanName = (raw) => {
                if (!raw) return null;
                // Take only the first line (stops at newlines from adjacent cards)
                let name = raw.split('\n')[0].trim();
                // Strip trailing "Siblings ..." that got captured
                name = name.replace(/\s*Siblings\b.*$/i, '').trim();
                // Strip "More", "Principal", "United States", etc.
                name = name.replace(/\s*\bMore\b.*$/i, '').trim();
                name = name.replace(/\s*\bPrincipal\b.*$/i, '').trim();
                name = name.replace(/\s*\bSpouses?\b.*$/i, '').trim();
                name = name.replace(/\s*\bChildren\b.*$/i, '').trim();
                name = name.replace(/\s*\bResults?\b.*$/i, '').trim();
                // Strip trailing comma
                name = name.replace(/,\s*$/, '').trim();
                // Must be at least 2 chars and look like a name (starts with letter)
                if (name.length < 2 || !/^[A-Z]/i.test(name)) return null;
                // Reject if it looks like UI garbage
                if (/^(and|the|or|of|OPEN|ALL|Census|United|States?)$/i.test(name)) return null;
                return name;
            };

            // Strategy 1: Parse individual record cards via DOM structure
            // Each result card has a structured layout we can target
            const recordCards = document.querySelectorAll('[data-testid*="result"], .result-item, [class*="result"]');
            if (recordCards.length > 0) {
                for (const card of recordCards) {
                    const cardText = card.innerText || '';
                    // Look for "Parents" within this single card only
                    const parentMatch = cardText.match(/Parents\s+([^\n]+)/i);
                    if (parentMatch) {
                        // Split parents by comma — "Ilya Schor, Resia Schor"
                        const parentLine = parentMatch[1].trim();
                        // Stop at "Siblings", "Spouses", "Children", etc.
                        const cleanLine = parentLine.replace(/\s*(Siblings|Spouses|Children|More)\b.*$/i, '').trim();
                        const parentNames = cleanLine.split(/,\s*/);
                        if (parentNames.length >= 1) {
                            const p1 = cleanName(parentNames[0]);
                            if (p1) found.push({
                                parentName: p1, relationship: 'father',
                                discoveryMethod: 'record_search', sourceType: 'genealogy_record', confidence: 0.75
                            });
                        }
                        if (parentNames.length >= 2) {
                            const p2 = cleanName(parentNames[1]);
                            if (p2) found.push({
                                parentName: p2, relationship: 'mother',
                                discoveryMethod: 'record_search', sourceType: 'genealogy_record', confidence: 0.75
                            });
                        }
                        if (found.length >= 2) break; // Got both parents from one card
                    }
                }
            }

            // Strategy 2: Fallback to body text regex (original approach, but line-bounded)
            if (found.length === 0) {
                // Split body into lines and find lines containing "Parents"
                const lines = bodyText.split('\n');
                for (const line of lines) {
                    const parentMatch = line.match(/Parents\s+(.+)/i);
                    if (parentMatch) {
                        const parentLine = parentMatch[1].trim();
                        // Stop at "Siblings", "Spouses", etc.
                        const cleanLine = parentLine.replace(/\s*(Siblings|Spouses|Children|More)\b.*$/i, '').trim();
                        const parentNames = cleanLine.split(/,\s*/);
                        if (parentNames.length >= 1) {
                            const p1 = cleanName(parentNames[0]);
                            if (p1) found.push({
                                parentName: p1, relationship: 'father',
                                discoveryMethod: 'record_search', sourceType: 'genealogy_record', confidence: 0.75
                            });
                        }
                        if (parentNames.length >= 2) {
                            const p2 = cleanName(parentNames[1]);
                            if (p2) found.push({
                                parentName: p2, relationship: 'mother',
                                discoveryMethod: 'record_search', sourceType: 'genealogy_record', confidence: 0.75
                            });
                        }
                        if (found.length >= 2) break;
                    }
                }
            }

            // Also extract ARK links for individual record pages we could visit for more data
            const arkLinks = document.querySelectorAll('a[href*="/ark:/61903/1:1:"]');
            const recordLinks = [];
            for (const link of arkLinks) {
                const text = (link.innerText || '').trim();
                if (text && text.length > 2 && !recordLinks.some(r => r.href === link.href)) {
                    recordLinks.push({ href: link.href, text });
                }
            }

            // If no parents found in text, return the record links so we can navigate to them
            if (found.length === 0 && recordLinks.length > 0) {
                found.push({ _recordLinks: recordLinks.slice(0, 5) });
            }

            return found;
        }, person.name, surname);

        // Filter out the _recordLinks helper entry
        const parents = results.filter(r => !r._recordLinks);
        const recordLinks = results.find(r => r._recordLinks)?._recordLinks || [];

        if (parents.length > 0) {
            console.log(`   [RecordSearch] Found parents in search results: ${parents.map(p => p.parentName).join(', ')}`);
            return parents;
        }

        // If no inline parents, try clicking into individual records to find parent fields
        if (recordLinks.length > 0) {
            console.log(`   [RecordSearch] No inline parents. Checking ${recordLinks.length} individual records...`);
            for (const record of recordLinks.slice(0, 3)) { // Check top 3 records
                const recordParents = await extractParentsFromRecord(record.href);
                if (recordParents.length > 0) return recordParents;
                await new Promise(r => setTimeout(r, 2000)); // Rate limit
            }
        }

        console.log('   [RecordSearch] No parents found in records');
        return [];
    } catch (err) {
        console.log(`   [RecordSearch] Error: ${err.message.substring(0, 60)}`);
        return [];
    }
}

/**
 * Search a specific US Census collection on FamilySearch for a person.
 * Navigates to search results filtered by collection ID, then clicks into
 * the top result to extract household members.
 */
async function searchCensusCollection(person, givenName, surname, target) {
    const { censusYear, collectionId, estimatedAge } = target;

    const params = new URLSearchParams();
    params.set('q.givenName', givenName);
    params.set('q.surname', surname);
    // For census search, use the census year as the residence date, not birth date
    params.set('q.residenceDate.from', String(censusYear));
    params.set('q.residenceDate.to', String(censusYear));
    if (person.birth_year) {
        params.set('q.birthLikeDate.from', String(person.birth_year - 3));
        params.set('q.birthLikeDate.to', String(person.birth_year + 3));
    }
    if (person.birth_place) {
        params.set('q.residencePlace', person.birth_place);
    } else if (person.locations && person.locations.length > 0) {
        params.set('q.residencePlace', person.locations[0]);
    }
    params.set('f.collectionId', collectionId);

    const searchUrl = `https://www.familysearch.org/search/record/results?${params.toString()}`;
    console.log(`   [CensusSearch] ${censusYear} Census (age~${estimatedAge}): ${searchUrl.substring(0, 120)}...`);

    try {
        if (!await safeGoto(searchUrl)) {
            console.log(`   [CensusSearch] Navigation failed for ${censusYear} Census`);
            return [];
        }
        await new Promise(r => setTimeout(r, 5000));

        await checkAndRecoverLogin();
        if (await detectCaptcha()) return [];

        // Get the first census record ARK link from results
        const firstRecordUrl = await page.evaluate(() => {
            // Check result count
            const h1 = document.querySelector('h1');
            if (h1 && h1.innerText.includes('(0)')) return null;

            // Find the first ARK link to an individual record
            const arkLinks = document.querySelectorAll('a[href*="/ark:/61903/1:1:"]');
            for (const link of arkLinks) {
                const href = link.href;
                if (href && href.includes('/ark:/61903/1:1:')) return href;
            }
            return null;
        });

        if (!firstRecordUrl) {
            console.log(`   [CensusSearch] No results for ${censusYear} Census`);
            return [];
        }

        console.log(`   [CensusSearch] Clicking into record: ${firstRecordUrl.substring(0, 80)}...`);

        // Navigate to the individual census record and extract household
        const householdResult = await extractHouseholdFromCensusRecord(firstRecordUrl, person, censusYear);
        return householdResult;
    } catch (err) {
        console.log(`   [CensusSearch] Error (${censusYear}): ${err.message.substring(0, 60)}`);
        return [];
    }
}

/**
 * Navigate to a FamilySearch census record page and extract ALL household members.
 * Census records show a household table with columns like:
 *   Name | Relationship to Head | Age | Sex | Birthplace
 *
 * If the target person is listed as "Son"/"Daughter", the Head + Wife/Spouse
 * are likely their parents (returned with high confidence).
 */
async function extractHouseholdFromCensusRecord(arkUrl, targetPerson, censusYear) {
    console.log(`   [CensusHousehold] Navigating to: ${arkUrl.substring(0, 80)}`);

    try {
        if (!await safeGoto(arkUrl)) {
            console.log('   [CensusHousehold] Navigation failed');
            return [];
        }
        await new Promise(r => setTimeout(r, 4000));

        await checkAndRecoverLogin();
        if (await detectCaptcha()) return [];

        // Try to expand household/family section if collapsed
        try {
            const expandBtn = await page.$('[data-testid*="household"] button, [data-testid*="family"] button, button[aria-expanded="false"]');
            if (expandBtn) {
                await expandBtn.click();
                await new Promise(r => setTimeout(r, 2000));
            }
        } catch (_) { /* no expand button, that's fine */ }

        const result = await page.evaluate((targetName, targetSurname, year) => {
            const bodyText = document.body.innerText;
            const household = [];
            const parents = [];

            // Helper: clean a name string
            const cleanName = (raw) => {
                if (!raw) return null;
                let name = raw.split('\n')[0].split('\t')[0].trim();
                name = name.replace(/\s*(Siblings|Spouses|Children|More|Principal|OPEN|ALL)\b.*$/i, '').trim();
                name = name.replace(/,\s*$/, '').trim();
                if (name.length < 2 || !/^[A-Z]/i.test(name)) return null;
                if (/^(and|the|or|of|OPEN|ALL|Census|United|States?)$/i.test(name)) return null;
                return name;
            };

            // ─── Strategy 1: Parse household table rows ───
            // FamilySearch census records often have a "Household Members" or
            // "Other household members" section rendered as a table or list
            const allRows = document.querySelectorAll('tr');
            let foundHouseholdTable = false;

            for (const row of allRows) {
                const cells = row.querySelectorAll('td, th');
                if (cells.length >= 2) {
                    const cell0 = (cells[0].innerText || '').trim();
                    const cell1 = (cells[1].innerText || '').trim();

                    // Check if this is a household member row (has a link to a person record)
                    const personLink = row.querySelector('a[href*="/ark:/61903/1:1:"]');
                    if (personLink) {
                        foundHouseholdTable = true;
                        const member = {
                            name: cleanName(personLink.innerText || cell0),
                            relationship: null,
                            age: null,
                            sex: null,
                            birthplace: null
                        };

                        // Parse remaining cells for relationship, age, sex, birthplace
                        for (let i = 0; i < cells.length; i++) {
                            const cellText = (cells[i].innerText || '').trim().toLowerCase();
                            // Relationship keywords
                            if (/^(head|wife|husband|spouse|son|daughter|child|mother|father|boarder|lodger|servant|sister|brother|aunt|uncle|nephew|niece|grandchild|grandson|granddaughter|mother-in-law|father-in-law|self)$/i.test(cellText)) {
                                member.relationship = cellText;
                            }
                            // Age (1-3 digit number)
                            const ageMatch = cellText.match(/^(\d{1,3})$/);
                            if (ageMatch && !member.age) {
                                member.age = parseInt(ageMatch[1]);
                            }
                            // Sex
                            if (/^(m|f|male|female)$/i.test(cellText)) {
                                member.sex = cellText.charAt(0).toUpperCase();
                            }
                        }
                        if (member.name) household.push(member);
                    }
                }
            }

            // ─── Strategy 2: Parse body text for household member patterns ───
            // Census records may render household as text lines:
            //   "John Smith    Head    45    M    Virginia"
            //   "Mary Smith    Wife    42    F    Kentucky"
            if (!foundHouseholdTable || household.length === 0) {
                const lines = bodyText.split('\n');
                for (const line of lines) {
                    // Match lines with relationship keywords
                    const relKeywords = /\b(Head|Wife|Husband|Spouse|Son|Daughter|Child|Mother|Father|Self)\b/i;
                    const relMatch = line.match(relKeywords);
                    if (relMatch) {
                        // Try to extract name (text before the relationship keyword)
                        const beforeRel = line.substring(0, line.indexOf(relMatch[0])).trim();
                        const memberName = cleanName(beforeRel);
                        if (memberName) {
                            const ageMatch = line.match(/\b(\d{1,3})\b/);
                            const sexMatch = line.match(/\b(M|F|Male|Female)\b/i);
                            household.push({
                                name: memberName,
                                relationship: relMatch[1].toLowerCase(),
                                age: ageMatch ? parseInt(ageMatch[1]) : null,
                                sex: sexMatch ? sexMatch[1].charAt(0).toUpperCase() : null,
                                birthplace: null
                            });
                        }
                    }
                }
            }

            // ─── Strategy 3: Direct field extraction (single-person record view) ───
            // If no household table, fall back to extracting Father/Mother fields
            if (household.length === 0) {
                const lines = bodyText.split('\n');
                for (const line of lines) {
                    const fatherMatch = line.match(/^(?:Father|Father'?s?\s*Name)\s*[\t:]\s*(.+)/i);
                    if (fatherMatch) {
                        const name = cleanName(fatherMatch[1]);
                        if (name) parents.push({
                            parentName: name, relationship: 'father',
                            discoveryMethod: 'census_record', sourceType: 'census',
                            sourceUrl: window.location.href, confidence: 0.85
                        });
                    }
                    const motherMatch = line.match(/^(?:Mother|Mother'?s?\s*Name)\s*[\t:]\s*(.+)/i);
                    if (motherMatch) {
                        const name = cleanName(motherMatch[1]);
                        if (name) parents.push({
                            parentName: name, relationship: 'mother',
                            discoveryMethod: 'census_record', sourceType: 'census',
                            sourceUrl: window.location.href, confidence: 0.85
                        });
                    }
                }
                // Also check for "Relationship to Head" = Son/Daughter pattern
                const relToHead = bodyText.match(/Relationship\s*(?:to\s*Head)?\s*[\t:]\s*(Son|Daughter|Child)/i);
                if (relToHead && parents.length === 0) {
                    const lines2 = bodyText.split('\n');
                    for (const line of lines2) {
                        const headMatch = line.match(/^Head\s*[\t:]\s*(.+)/i);
                        if (headMatch) {
                            const name = cleanName(headMatch[1]);
                            if (name) parents.push({
                                parentName: name, relationship: 'father',
                                discoveryMethod: 'census_household', sourceType: 'census',
                                sourceUrl: window.location.href, confidence: 0.80
                            });
                        }
                        const wifeMatch = line.match(/^(?:Wife|Spouse)\s*[\t:]\s*(.+)/i);
                        if (wifeMatch) {
                            const name = cleanName(wifeMatch[1]);
                            if (name) parents.push({
                                parentName: name, relationship: 'mother',
                                discoveryMethod: 'census_household', sourceType: 'census',
                                sourceUrl: window.location.href, confidence: 0.80
                            });
                        }
                    }
                }
                return parents;
            }

            // ─── Identify parents from household roster ───
            // Find the target person in the household
            const targetSurnameLower = targetSurname.toLowerCase();
            const targetGivenLower = targetName.split(/\s+/)[0].toLowerCase();
            let targetMember = household.find(m =>
                m.name && m.name.toLowerCase().includes(targetGivenLower) &&
                m.name.toLowerCase().includes(targetSurnameLower)
            );
            if (!targetMember) {
                // Relaxed: just match given name
                targetMember = household.find(m =>
                    m.name && m.name.toLowerCase().includes(targetGivenLower) &&
                    (m.relationship === 'son' || m.relationship === 'daughter' || m.relationship === 'child')
                );
            }

            const isTargetChild = targetMember &&
                ['son', 'daughter', 'child'].includes(targetMember.relationship);

            // Find head of household and spouse
            const head = household.find(m => m.relationship === 'head' || m.relationship === 'self');
            const spouse = household.find(m =>
                ['wife', 'husband', 'spouse'].includes(m.relationship)
            );

            if (isTargetChild || !targetMember) {
                // Person is a child (or not found, assume record matched them) → head+spouse are parents
                if (head && head.name) {
                    const headSex = head.sex || 'M'; // Census heads default male in this era
                    parents.push({
                        parentName: head.name,
                        relationship: headSex === 'F' ? 'mother' : 'father',
                        discoveryMethod: 'census_household',
                        sourceType: 'census',
                        sourceUrl: window.location.href,
                        confidence: isTargetChild ? 0.88 : 0.75, // Higher if we confirmed child relationship
                        censusYear: year,
                        householdRole: 'head'
                    });
                }
                if (spouse && spouse.name) {
                    const spouseSex = spouse.sex || 'F';
                    parents.push({
                        parentName: spouse.name,
                        relationship: spouseSex === 'F' ? 'mother' : 'father',
                        discoveryMethod: 'census_household',
                        sourceType: 'census',
                        sourceUrl: window.location.href,
                        confidence: isTargetChild ? 0.88 : 0.75,
                        censusYear: year,
                        householdRole: 'spouse'
                    });
                }
            }

            // Attach full household roster as metadata on first parent result
            if (parents.length > 0 && household.length > 0) {
                parents[0]._householdMembers = household;
            }

            return parents;
        }, person.name, nameParts[nameParts.length - 1], censusYear);

        // Log household findings
        const householdMembers = result.find(r => r._householdMembers)?._householdMembers;
        if (householdMembers && householdMembers.length > 0) {
            console.log(`   [CensusHousehold] ${censusYear} household (${householdMembers.length} members):`);
            for (const m of householdMembers) {
                console.log(`      ${m.relationship || '?'}: ${m.name}${m.age ? ' (age ' + m.age + ')' : ''}${m.sex ? ' ' + m.sex : ''}`);
            }
        }

        // Clean up: remove _householdMembers metadata from results
        const parents = result.map(r => {
            const { _householdMembers, ...parent } = r;
            return parent;
        }).filter(r => r.parentName);

        if (parents.length > 0) {
            console.log(`   [CensusHousehold] Parents from ${censusYear}: ${parents.map(p => `${p.relationship}=${p.parentName}`).join(', ')}`);
        }

        return parents;
    } catch (err) {
        console.log(`   [CensusHousehold] Error: ${err.message.substring(0, 60)}`);
        return [];
    }
}

/**
 * Navigate to an individual FamilySearch record (ARK page) and extract parent info.
 *
 * Recon findings:
 * - H1 contains person name
 * - Body text has labeled fields: "Name\tValue", "Birth Date\tValue"
 * - Look for "Father", "Mother", "Relationship to Head" fields
 * - Tables contain the record data (3 tables found on test page)
 * - data-testid="documentInformationExpander-Button" for expanding details
 */
async function extractParentsFromRecord(arkUrl) {
    console.log(`   [RecordDetail] Navigating to: ${arkUrl.substring(0, 80)}`);

    try {
        if (!await safeGoto(arkUrl)) {
            console.log('   [RecordDetail] Navigation failed');
            return [];
        }
        await new Promise(r => setTimeout(r, 4000));

        if (await detectCaptcha()) return [];

        const parents = await page.evaluate(() => {
            const bodyText = document.body.innerText;
            const found = [];

            // Helper: extract a name from a field value, stopping at newline/tab boundaries
            const extractName = (raw) => {
                if (!raw) return null;
                let name = raw.split('\n')[0].split('\t')[0].trim();
                // Strip trailing UI junk
                name = name.replace(/\s*(Siblings|Spouses|Children|More|Principal|OPEN|ALL)\b.*$/i, '').trim();
                name = name.replace(/,\s*$/, '').trim();
                if (name.length < 2 || !/^[A-Z]/i.test(name)) return null;
                if (/^(and|the|or|of|OPEN|ALL|Census|United|States?)$/i.test(name)) return null;
                return name;
            };

            // Strategy 1: Parse structured table rows (FamilySearch record pages use tables)
            const rows = document.querySelectorAll('tr, [data-testid*="detail"]');
            for (const row of rows) {
                const cells = row.querySelectorAll('td, th, span');
                if (cells.length >= 2) {
                    const label = (cells[0].innerText || '').trim().toLowerCase();
                    const value = (cells[1].innerText || '').trim();
                    if (/^father/.test(label)) {
                        const name = extractName(value);
                        if (name) found.push({ parentName: name, relationship: 'father',
                            discoveryMethod: 'record_search', sourceType: 'indexed_record',
                            sourceUrl: window.location.href, confidence: 0.80 });
                    }
                    if (/^mother/.test(label)) {
                        const name = extractName(value);
                        if (name) found.push({ parentName: name, relationship: 'mother',
                            discoveryMethod: 'record_search', sourceType: 'indexed_record',
                            sourceUrl: window.location.href, confidence: 0.80 });
                    }
                }
            }

            // Strategy 2: Line-based text parsing (fallback)
            if (found.length === 0) {
                const lines = bodyText.split('\n');
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i].trim();
                    // "Father\tJohn Smith" or "Father's Name\tJohn Smith" pattern
                    const fatherMatch = line.match(/^(?:Father|Father'?s?\s*Name)\s*\t?\s*(.+)/i);
                    if (fatherMatch) {
                        const name = extractName(fatherMatch[1]);
                        if (name) found.push({ parentName: name, relationship: 'father',
                            discoveryMethod: 'record_search', sourceType: 'indexed_record',
                            sourceUrl: window.location.href, confidence: 0.80 });
                    }
                    const motherMatch = line.match(/^(?:Mother|Mother'?s?\s*Name)\s*\t?\s*(.+)/i);
                    if (motherMatch) {
                        const name = extractName(motherMatch[1]);
                        if (name) found.push({ parentName: name, relationship: 'mother',
                            discoveryMethod: 'record_search', sourceType: 'indexed_record',
                            sourceUrl: window.location.href, confidence: 0.80 });
                    }
                }
            }

            // Strategy 3: Census "Head of household" inference
            if (found.length === 0) {
                const relMatch = bodyText.match(/Relationship\s*(?:to\s*Head)?\s*[\t:]\s*(Son|Daughter|Child)/i);
                if (relMatch) {
                    const lines = bodyText.split('\n');
                    for (const line of lines) {
                        const headMatch = line.match(/^Head\s*\t\s*(.+)/i);
                        if (headMatch) {
                            const name = extractName(headMatch[1]);
                            if (name) found.push({ parentName: name, relationship: 'father',
                                discoveryMethod: 'census_household', sourceType: 'census',
                                sourceUrl: window.location.href, confidence: 0.70 });
                        }
                        const wifeMatch = line.match(/^(?:Wife|Spouse)\s*\t\s*(.+)/i);
                        if (wifeMatch) {
                            const name = extractName(wifeMatch[1]);
                            if (name) found.push({ parentName: name, relationship: 'mother',
                                discoveryMethod: 'census_household', sourceType: 'census',
                                sourceUrl: window.location.href, confidence: 0.70 });
                        }
                    }
                }
            }

            // Strategy 4: Inline "Parents FirstName, SecondName" field
            if (found.length === 0) {
                const lines = bodyText.split('\n');
                for (const line of lines) {
                    const parentsMatch = line.match(/Parents?\s*\t?\s*([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)\s*,\s*([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)/i);
                    if (parentsMatch) {
                        const p1 = extractName(parentsMatch[1]);
                        const p2 = extractName(parentsMatch[2]);
                        if (p1) found.push({ parentName: p1, relationship: 'father',
                            discoveryMethod: 'record_search', sourceType: 'indexed_record',
                            sourceUrl: window.location.href, confidence: 0.75 });
                        if (p2) found.push({ parentName: p2, relationship: 'mother',
                            discoveryMethod: 'record_search', sourceType: 'indexed_record',
                            sourceUrl: window.location.href, confidence: 0.75 });
                        break;
                    }
                }
            }

            return found;
        });

        if (parents.length > 0) {
            console.log(`   [RecordDetail] Found: ${parents.map(p => `${p.relationship}=${p.parentName}`).join(', ')}`);
        }
        return parents;
    } catch (err) {
        console.log(`   [RecordDetail] Error: ${err.message.substring(0, 60)}`);
        return [];
    }
}

/**
 * Search WikiTree API for a person and extract parent info.
 * WikiTree has a free JSON API — no Puppeteer needed.
 * API: https://api.wikitree.com/api.php
 */
async function searchWikiTree(person) {
    if (!person.name) return [];

    const nameParts = person.name.trim().split(/\s+/);
    const firstName = nameParts[0];
    const lastName = nameParts[nameParts.length - 1];

    console.log(`   [WikiTree] Searching for ${firstName} ${lastName}...`);

    try {
        const params = new URLSearchParams();
        params.set('action', 'searchPerson');
        params.set('LastName', lastName);
        params.set('FirstName', firstName);
        params.set('fields', 'Name,LongName,BirthDate,DeathDate,BirthLocation,Father,Mother');
        params.set('limit', '10');
        params.set('format', 'json');

        const response = await fetch('https://api.wikitree.com/api.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString()
        });

        const data = await response.json();
        const matches = data?.[0]?.matches || [];

        if (matches.length === 0) {
            console.log('   [WikiTree] No matches found');
            return [];
        }

        // Filter matches by birth year if available
        let bestMatches = matches;
        if (person.birth_year) {
            bestMatches = matches.filter(m => {
                if (!m.BirthDate) return true; // Keep if no date to compare
                const matchYear = parseInt(m.BirthDate.substring(0, 4));
                return !matchYear || Math.abs(matchYear - person.birth_year) <= 10;
            });
        }

        const results = [];
        for (const match of bestMatches.slice(0, 3)) {
            // If this person has Father/Mother IDs, look them up
            if (match.Father && match.Father > 0) {
                const fatherProfile = await fetchWikiTreeProfile(match.Father);
                // Use LongName (actual name) — Name is the WikiTree ID (e.g., "Rockwood-697")
                const fatherName = fatherProfile?.LongName;
                if (fatherName && fatherName.length >= 3 && !/^[A-Za-z]+-\d+$/.test(fatherName)) {
                    results.push({
                        parentName: fatherName,
                        relationship: 'father',
                        discoveryMethod: 'wikitree',
                        sourceType: 'profile',
                        sourceUrl: `https://www.wikitree.com/wiki/${fatherProfile.Name}`,
                        wikitreeId: fatherProfile.Name,
                        confidence: 0.65
                    });
                }
            }
            if (match.Mother && match.Mother > 0) {
                const motherProfile = await fetchWikiTreeProfile(match.Mother);
                const motherName = motherProfile?.LongName;
                if (motherName && motherName.length >= 3 && !/^[A-Za-z]+-\d+$/.test(motherName)) {
                    results.push({
                        parentName: motherName,
                        relationship: 'mother',
                        discoveryMethod: 'wikitree',
                        sourceType: 'profile',
                        sourceUrl: `https://www.wikitree.com/wiki/${motherProfile.Name}`,
                        wikitreeId: motherProfile.Name,
                        confidence: 0.65
                    });
                }
            }

            if (results.length > 0) break; // Got parents from first good match
        }

        if (results.length > 0) {
            console.log(`   [WikiTree] Found: ${results.map(r => `${r.relationship}=${r.parentName}`).join(', ')}`);
        } else {
            console.log('   [WikiTree] Matches found but no parent data');
        }
        return results;
    } catch (err) {
        console.log(`   [WikiTree] Error: ${err.message.substring(0, 60)}`);
        return [];
    }
}

/**
 * Fetch a WikiTree profile by ID number to get name and details.
 */
async function fetchWikiTreeProfile(profileId) {
    try {
        const params = new URLSearchParams();
        params.set('action', 'getProfile');
        params.set('key', String(profileId));
        params.set('fields', 'Name,LongName,BirthDate,DeathDate,BirthLocation,Father,Mother');
        params.set('format', 'json');

        const response = await fetch('https://api.wikitree.com/api.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString()
        });

        const data = await response.json();
        return data?.[0]?.profile || null;
    } catch (err) {
        return null;
    }
}

/**
 * Check SlaveVoyages API for enslaver match.
 * Supplements local DB check with international transatlantic slave trade data.
 */
async function checkSlaveVoyages(person) {
    try {
        const slavevoyagesApi = require('../sources/slavevoyages-api');
        return await slavevoyagesApi.checkEnslaver(person);
    } catch (err) {
        // Module not available or API error — non-fatal
        return null;
    }
}

/**
 * Detect CAPTCHA/challenge page and pause for operator intervention.
 * Returns true if CAPTCHA was detected (caller should skip this page).
 */
async function detectCaptcha() {
    const currentUrl = page.url();
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));

    const isCaptcha = currentUrl.includes('challenge') ||
                      currentUrl.includes('captcha') ||
                      currentUrl.includes('ident.familysearch') ||
                      bodyText.toLowerCase().includes('verify you are human') ||
                      bodyText.toLowerCase().includes('captcha');

    if (!isCaptcha) return false;

    console.log('   ⚠ CAPTCHA DETECTED — operator intervention required');
    console.log('   Solve the CAPTCHA in the Chrome window on the Mac Mini.');

    // Take screenshot for debugging
    const captchaDir = require('path').join(__dirname, '..', '..', 'debug', 'captcha');
    require('fs').mkdirSync(captchaDir, { recursive: true });
    await page.screenshot({ path: require('path').join(captchaDir, `captcha-${Date.now()}.png`) });

    // Poll for resolution (up to 5 minutes)
    const startTime = Date.now();
    const timeoutMs = 300000; // 5 minutes
    while ((Date.now() - startTime) < timeoutMs) {
        await new Promise(r => setTimeout(r, 5000));
        const newUrl = page.url();
        if (!newUrl.includes('challenge') && !newUrl.includes('captcha') && !newUrl.includes('ident.familysearch')) {
            console.log('   ✓ CAPTCHA resolved, continuing...');
            return false; // Resolved — caller can proceed
        }
    }

    console.log('   ⚠ CAPTCHA timeout — skipping this page');
    return true; // Timed out — caller should skip
}

/**
 * Search FamilySearch tree for a person by name to find their FS ID.
 * Used when we know a parent's name but need their tree person ID.
 *
 * Recon findings:
 * - URL: /tree/find/name shows search FORM (needs form submission)
 * - Alternative: use /search/record/results to find record, then check for tree person link
 */
async function searchTreeForPerson(name, birthYear, location) {
    if (!name) return null;

    const nameParts = name.trim().split(/\s+/);
    const givenName = nameParts[0];
    const surname = nameParts[nameParts.length - 1];

    console.log(`   [TreeSearch] Looking for ${name} in FamilySearch tree...`);

    try {
        // Use the record search to find the person, then look for tree person links
        const params = new URLSearchParams();
        params.set('q.givenName', givenName);
        params.set('q.surname', surname);
        if (birthYear) {
            params.set('q.birthLikeDate.from', String(birthYear - 5));
            params.set('q.birthLikeDate.to', String(birthYear + 5));
        }
        if (location) {
            params.set('q.birthLikePlace', location);
        }

        const searchUrl = `https://www.familysearch.org/search/record/results?${params.toString()}`;
        if (!await safeGoto(searchUrl)) return null;
        await new Promise(r => setTimeout(r, 5000));

        if (await detectCaptcha()) return null;
        await checkAndRecoverLogin();

        // Look for person links in results (tree person links have /tree/person/ pattern)
        const result = await page.evaluate((targetGiven, targetSurname) => {
            // Check for tree person links attached to search results
            const personLinks = document.querySelectorAll('a[href*="/tree/person/"]');
            for (const link of personLinks) {
                const href = link.href;
                const idMatch = href.match(/\/tree\/person\/(?:details\/|about\/)?([A-Z0-9]{4}-[A-Z0-9]{2,4})/);
                if (idMatch) {
                    return { fsId: idMatch[1], name: link.innerText?.trim() || null };
                }
            }

            // Also check data-testid for ARK IDs and look for "Attach to Tree" links
            // that indicate a tree person exists
            return null;
        }, givenName, surname);

        if (result) {
            console.log(`   [TreeSearch] Found: ${result.name || 'unknown'} (${result.fsId})`);
            return result;
        }

        console.log('   [TreeSearch] No tree person found');
        return null;
    } catch (err) {
        console.log(`   [TreeSearch] Error: ${err.message.substring(0, 60)}`);
        return null;
    }
}

/**
 * MASTER ORCHESTRATOR: Discover parents using multiple sources.
 * Called when extractPersonFromPage() returns no parent IDs.
 *
 * Priority chain:
 * 1. Participant-provided parent names → search FS tree for their IDs
 * 2. FamilySearch record search → extract parents from records
 * 3. WikiTree API search → extract parents from profiles
 *
 * @param {object} person - { name, birth_year, birth_place, locations, fs_id }
 * @param {object} participantInfo - { fatherName, motherName, birthYear, birthLocation }
 * @param {object} familyTreeMap - Flat lookup map from buildFamilyTreeMap()
 * @param {string|null} branchContext - Optional branch context (e.g. 'eastern_european_jewish') to skip irrelevant searches
 * @returns {Array} Array of { parentName, parentFsId, parentBirthYear, relationship, confidence, discoveryMethod, sourceUrl }
 */
async function discoverParents(person, participantInfo = {}, familyTreeMap = {}, branchContext = null) {
    console.log('   ═══ PARENT DISCOVERY (multi-source) ═══');
    const allDiscovered = [];

    // ─── Source 0: Participant family tree (per-person ground truth) ───
    const treeEntry = lookupInFamilyTree(person.name, familyTreeMap);
    if (treeEntry && (treeEntry.parents.father || treeEntry.parents.mother)) {
        console.log('   [0] Using participant-provided family tree for', person.name, '(ground truth)');

        if (treeEntry.parents.father) {
            const f = treeEntry.parents.father;
            console.log('       Father:', f.name, f.birthYear ? '(b.' + f.birthYear + ')' : '', f.birthLocation || '');
            // Skip expensive TreeSearch for family tree parents — they're ground truth
            // FS ID lookup will happen when they're processed in the BFS queue
            allDiscovered.push({
                parentName: f.name,
                parentFsId: null,
                parentBirthYear: f.birthYear || null,
                parentBirthLocation: f.birthLocation || null,
                relationship: 'father',
                confidence: 0.90,
                discoveryMethod: 'participant_family_tree',
                sourceUrl: null
            });
        }

        if (treeEntry.parents.mother) {
            const m = treeEntry.parents.mother;
            console.log('       Mother:', m.name, m.birthYear ? '(b.' + m.birthYear + ')' : '', m.birthLocation || '');
            allDiscovered.push({
                parentName: m.name,
                parentFsId: null,
                parentBirthYear: m.birthYear || null,
                parentBirthLocation: m.birthLocation || null,
                relationship: 'mother',
                confidence: 0.90,
                discoveryMethod: 'participant_family_tree',
                sourceUrl: null
            });
        }

        // Participant tree is ground truth — return immediately, skip FS record search
        console.log('   ═══ Parents from participant family tree (ground truth) ═══');
        return allDiscovered;
    }

    // ─── Source 1: Legacy participant-provided parent names (single generation, backward compat) ───
    if (participantInfo.fatherName || participantInfo.motherName) {
        console.log('   [1] Using participant-provided parent names');

        if (participantInfo.fatherName) {
            allDiscovered.push({
                parentName: participantInfo.fatherName,
                parentFsId: null,
                relationship: 'father',
                confidence: 0.70,
                discoveryMethod: 'participant_provided',
                sourceUrl: null
            });
        }

        if (participantInfo.motherName) {
            allDiscovered.push({
                parentName: participantInfo.motherName,
                parentFsId: null,
                relationship: 'mother',
                confidence: 0.70,
                discoveryMethod: 'participant_provided',
                sourceUrl: null
            });
        }
    }

    // If we already have both parents from participant info, skip record search
    const fatherFound = allDiscovered.find(p => p.relationship === 'father' && p.parentName);
    const motherFound = allDiscovered.find(p => p.relationship === 'mother' && p.parentName);
    if (fatherFound && motherFound) {
        console.log('   ═══ Both parents found via participant info ═══');
        return allDiscovered;
    }

    // ─── Source 2: FamilySearch record search ───
    if (allDiscovered.length === 0 || !fatherFound || !motherFound) {
        console.log('   [2] Searching FamilySearch historical records...');
        const recordParents = await searchFamilySearchRecords(person, branchContext);
        for (const rp of recordParents) {
            // Don't duplicate parents already found
            if (!allDiscovered.some(d => d.relationship === rp.relationship && d.parentName)) {
                // Skip TreeSearch for record-discovered parents — too expensive and rarely finds anyone.
                // FS ID lookup will happen when they're processed in the BFS queue via searchTreeForPerson.
                allDiscovered.push({
                    ...rp,
                    parentFsId: null,
                    sourceUrl: rp.sourceUrl || null
                });
            }
        }
    }

    // ─── Source 3: WikiTree API ───
    if (allDiscovered.length === 0) {
        console.log('   [3] Searching WikiTree...');
        const wikiParents = await searchWikiTree(person);
        for (const wp of wikiParents) {
            if (!allDiscovered.some(d => d.relationship === wp.relationship && d.parentName)) {
                allDiscovered.push({
                    ...wp,
                    parentFsId: null // WikiTree IDs are different from FS IDs
                });
            }
        }
    }

    // ─── Summary ───
    if (allDiscovered.length > 0) {
        console.log(`   ═══ Discovered ${allDiscovered.length} parent(s): ${allDiscovered.map(p => `${p.relationship}=${p.parentName}${p.parentFsId ? ' ('+p.parentFsId+')' : ''}`).join(', ')} ═══`);
    } else {
        console.log('   ═══ No parents discovered from any source ═══');
    }

    return allDiscovered;
}

/**
 * Save an inferred parent link to the database for audit trail.
 */
async function saveInferredParentLink(climbSessionId, childPerson, discoveredParent) {
    try {
        await sql`
            INSERT INTO inferred_parent_links
                (session_id, child_fs_id, child_name, parent_name, parent_fs_id,
                 relationship, discovery_method, source_url, source_type, confidence)
            VALUES
                (${climbSessionId}, ${childPerson.fs_id || null}, ${childPerson.name || 'unknown'},
                 ${discoveredParent.parentName}, ${discoveredParent.parentFsId || null},
                 ${discoveredParent.relationship}, ${discoveredParent.discoveryMethod},
                 ${discoveredParent.sourceUrl || null}, ${discoveredParent.sourceType || null},
                 ${discoveredParent.confidence || 0.5})
        `;
    } catch (err) {
        console.log(`   [DB] Error saving inferred link: ${err.message.substring(0, 60)}`);
    }
}

/**
 * findOrCreatePerson: Resolve a discovered name to a canonical_persons entry.
 * Uses find_person_match() for tiered matching, creates a new entry if no match found.
 * Returns { id, uuid, isNew, matchTier }.
 */
async function findOrCreatePerson(name, birthYear, location, source) {
    if (!name || name.trim().length < 3) return null;

    // Sanitize name: take first line only, strip UI junk
    name = name.split('\n')[0].trim();
    name = name.replace(/\s*(Siblings|More|Principal|United States|Spouses|Children|Results?|OPEN ALL)\b.*$/i, '').trim();
    name = name.replace(/,\s*$/, '').trim();

    // Reject garbage names
    if (name.length < 3) return null;
    if (/^(and|the|or|of|OPEN|ALL|Census|More|Principal|UNKNOWN|Matrimonio)$/i.test(name)) return null;
    if (!/^[A-Z]/i.test(name)) return null;
    // Reject WikiTree IDs passed as names (e.g., "Rockwood-697")
    if (/^[A-Za-z]+-\d+$/.test(name)) return null;

    // FIX 3: For non-enslaved ancestor climbing, require at least first + last name
    // (Enslaved persons may have single names, but we're climbing UP through free ancestors)
    const nameParts = name.trim().split(/\s+/);
    if (nameParts.length < 2) {
        console.log(`   [Identity] Skipping single-word name "${name}" — need first + last for ancestor chain`);
        return null;
    }

    // FIX 4: Birth year sanity — don't create records for estimated births before 1600
    // No American slaveholder ancestor is verifiable before that
    if (birthYear && birthYear < 1600) {
        console.log(`   [Identity] Skipping "${name}" — estimated birth ${birthYear} is before 1600`);
        return null;
    }

    try {
        // FIX 5: Dedup check — look for existing record with same name before creating
        const matches = await sql`SELECT * FROM find_person_match(
            ${name}, ${birthYear || null}, ${location || null}, NULL, NULL, NULL
        )`;

        // Accept Tier 1-2 as before
        if (matches.length > 0 && matches[0].match_tier <= 2) {
            return {
                id: matches[0].canonical_person_id,
                uuid: matches[0].canonical_uuid,
                isNew: false,
                matchTier: matches[0].match_tier
            };
        }

        // Also accept Tier 3 exact name match if it exists — reuse instead of creating duplicate
        if (matches.length > 0 && matches[0].match_tier === 3) {
            const existing = matches[0];
            // If same name and close birth year (or both null), reuse existing
            const yearClose = !birthYear || !existing.birth_year_estimate ||
                Math.abs(existing.birth_year_estimate - birthYear) <= 30;
            if (existing.canonical_name.toLowerCase() === name.toLowerCase() && yearClose) {
                return {
                    id: existing.canonical_person_id,
                    uuid: existing.canonical_uuid,
                    isNew: false,
                    matchTier: 3
                };
            }
        }

        // No match — create new canonical_persons entry
        const firstName = nameParts[0];
        const lastName = nameParts[nameParts.length - 1];

        const result = await sql`
            INSERT INTO canonical_persons (
                canonical_name, first_name, last_name,
                birth_year_estimate, primary_state, person_type,
                confidence_score, match_tier, verification_status, notes
            ) VALUES (
                ${name}, ${firstName}, ${lastName},
                ${birthYear || null}, ${location || null}, 'unknown',
                0.50, 3, 'auto_created',
                ${JSON.stringify({ source, created_by: 'ancestor_climber', needs_review: true })}
            )
            RETURNING id, uuid
        `;

        return {
            id: result[0].id,
            uuid: result[0].uuid,
            isNew: true,
            matchTier: 3
        };
    } catch (err) {
        // If find_person_match() doesn't exist, fall back to simple insert
        if (err.message.includes('find_person_match')) {
            console.log('   [Identity] find_person_match() not available, creating person directly');
            const nameParts = name.trim().split(/\s+/);
            const result = await sql`
                INSERT INTO canonical_persons (
                    canonical_name, first_name, last_name,
                    birth_year_estimate, primary_state, person_type,
                    confidence_score, verification_status, notes
                ) VALUES (
                    ${name}, ${nameParts[0]}, ${nameParts[nameParts.length - 1]},
                    ${birthYear || null}, ${location || null}, 'unknown',
                    0.50, 'auto_created',
                    ${JSON.stringify({ source, created_by: 'ancestor_climber', needs_review: true })}
                )
                RETURNING id
            `;
            return { id: result[0].id, uuid: null, isNew: true, matchTier: 3 };
        }
        console.log(`   [Identity] Error in findOrCreatePerson: ${err.message.substring(0, 80)}`);
        return null;
    }
}

/**
 * Save a verified parent-child relationship to person_relationships_verified.
 */
async function savePersonRelationship(parentPersonId, childPersonId, relationshipType, evidenceStrength) {
    try {
        await sql`
            INSERT INTO person_relationships_verified
                (person_id, related_person_id, relationship_type, evidence_strength)
            VALUES (${parentPersonId}, ${childPersonId}, ${relationshipType}, ${evidenceStrength || 30})
            ON CONFLICT (person_id, related_person_id, relationship_type) DO UPDATE
            SET evidence_strength = GREATEST(person_relationships_verified.evidence_strength, ${evidenceStrength || 30})
        `;
    } catch (err) {
        // Table may not exist yet
        if (!err.message.includes('person_relationships_verified')) throw err;
    }
}

// ═══════════════════════════════════════════════════════════════
// END MULTI-SOURCE PARENT DISCOVERY
// ═══════════════════════════════════════════════════════════════

/**
 * Check if person is in our enslaver database
 *
 * VERIFICATION REQUIREMENTS (v3 - stricter):
 * 1. Name match (required)
 * 2. Location match (required for high confidence)
 * 3. Date overlap (birth year within 15-year window)
 * 4. Document evidence (tracked in match result)
 *
 * All matches are flagged as UNVERIFIED until manual document review.
 */
async function checkEnslaverDatabase(person) {
    if (!person.name) return null;

    // Skip generic single-word names that cause false positives
    const nameParts = person.name.trim().split(/\s+/);
    if (nameParts.length < 2 || person.name.length < 5) {
        return null; // Skip "Ann", "John", etc.
    }

    const personLocation = (person.locations && person.locations[0]) || null;

    // ═══ TIER 1: Check external IDs via find_person_match() ═══
    if (person.fs_id) {
        try {
            const tier1 = await sql`SELECT * FROM find_person_match(
                ${person.name}, ${person.birth_year || null}, ${personLocation},
                NULL, ${person.fs_id}, 'familysearch'
            )`;
            if (tier1.length > 0 && tier1[0].match_tier <= 2) {
                // Only match enslavers
                if (['enslaver', 'slaveholder', 'owner'].includes(tier1[0].person_type)) {
                    return formatTieredMatch(tier1[0]);
                }
            }
        } catch (err) {
            // find_person_match may not exist yet (migration not applied) — fall through to legacy
            if (!err.message.includes('find_person_match')) throw err;
            console.log('   [Identity] find_person_match() not available, using legacy matching');
            return checkEnslaverDatabaseLegacy(person);
        }
    }

    // ═══ TIER 2+3: Tiered name matching via find_person_match() ═══
    try {
        const matches = await sql`SELECT * FROM find_person_match(
            ${person.name}, ${person.birth_year || null}, ${personLocation},
            NULL, NULL, NULL
        )`;

        // Only auto-accept Tier 1-2 enslaver matches
        const autoMatch = matches.find(m =>
            m.match_tier <= 2 &&
            m.match_confidence >= 0.65 &&
            ['enslaver', 'slaveholder', 'owner'].includes(m.person_type)
        );
        if (autoMatch) return formatTieredMatch(autoMatch);

        // Tier 3 candidates: save qualifying matches with human review flags
        const tier3 = matches.filter(m =>
            m.match_tier === 3 &&
            ['enslaver', 'slaveholder', 'owner'].includes(m.person_type)
        );
        if (tier3.length > 0) {
            // Filter out obvious junk before saving
            const qualifying = tier3.filter(m => {
                const name = (m.canonical_name || '').trim();
                // Skip single-word names (too common: "Ann", "John", etc.)
                if (!name.includes(' ')) return false;
                // Skip very short names
                if (name.length < 5) return false;
                // Skip pre-1600 births (predates American slavery)
                if (m.birth_year_estimate && m.birth_year_estimate < 1600) return false;
                return true;
            });

            if (qualifying.length > 0) {
                // Return the best qualifying Tier 3 match with human review flags
                const best = qualifying.reduce((a, b) =>
                    parseFloat(b.match_confidence) > parseFloat(a.match_confidence) ? b : a
                );
                const result = formatTieredMatch(best);
                result.requires_human_review = true;
                result.review_reason = 'Name-only match (Tier 3) — needs human verification';
                result.classification = 'unverified';
                result.verification_status = 'pending_review';
                console.log(`   ~ ${tier3.length} Tier 3 candidate(s), saving best: "${best.canonical_name}" (${(parseFloat(best.match_confidence) * 100).toFixed(0)}%) [pending review]`);
                return result;
            } else {
                console.log(`   ~ ${tier3.length} Tier 3 candidate(s) — all filtered out (single-word name, too short, or pre-1600)`);
            }
        }
    } catch (err) {
        if (!err.message.includes('find_person_match')) throw err;
        return checkEnslaverDatabaseLegacy(person);
    }

    // Fallback: check SlaveVoyages API for international slave traders
    const svMatch = await checkSlaveVoyages(person);
    if (svMatch) return svMatch;

    return null;
}

/**
 * Format a find_person_match() result into the match record format expected by the climber
 */
function formatTieredMatch(row) {
    const tierLabels = { 1: 'external_id_match', 2: 'name_date_location_match', 3: 'name_only_match' };
    return {
        type: tierLabels[row.match_tier] || 'tiered_match',
        confidence: parseFloat(row.match_confidence),
        verified: false,
        verification_notes: `${row.match_details}. REQUIRES DOCUMENT REVIEW.`,
        date_verified: row.match_tier <= 2 && row.birth_year_estimate != null,
        location_verified: row.match_tier <= 2 && row.primary_state != null,
        id: row.canonical_person_id,
        canonical_name: row.canonical_name,
        person_type: row.person_type,
        birth_year_estimate: row.birth_year_estimate,
        primary_state: row.primary_state
    };
}

/**
 * Legacy enslaver database check — used when migration 033 hasn't been applied yet.
 * Preserves the original matching logic as a fallback.
 */
async function checkEnslaverDatabaseLegacy(person) {
    const personLocations = person.locations || [];
    const personBirthYear = person.birth_year;

    const birthYearsOverlap = (dbYear) => {
        if (!personBirthYear || !dbYear) return null;
        return Math.abs(personBirthYear - dbYear) <= 15;
    };

    const locationsOverlap = (dbState, dbCounty) => {
        if (personLocations.length === 0) return null;
        if (!dbState && !dbCounty) return null;
        return personLocations.some(loc => {
            const locLower = loc.toLowerCase();
            if (dbState && (locLower.includes(dbState.toLowerCase()) || dbState.toLowerCase().includes(locLower))) return true;
            if (dbCounty && (locLower.includes(dbCounty.toLowerCase()) || dbCounty.toLowerCase().includes(locLower))) return true;
            return false;
        });
    };

    // Check by FS ID first
    if (person.fs_id) {
        const fsMatch = await sql`
            SELECT id, canonical_name, person_type, notes, primary_state, primary_county, birth_year_estimate
            FROM canonical_persons
            WHERE notes::text LIKE ${'%"familysearch_id":"' + person.fs_id + '"%'}
            AND person_type IN ('enslaver', 'slaveholder', 'owner')
            LIMIT 1
        `;
        if (fsMatch.length > 0) {
            return { type: 'exact_fs_match', confidence: 0.99, verified: false,
                verification_notes: 'FamilySearch ID match - high confidence but needs document verification', ...fsMatch[0] };
        }
    }

    // Exact name match
    const exactMatch = await sql`
        SELECT id, canonical_name, person_type, birth_year_estimate, primary_state, primary_county
        FROM canonical_persons WHERE person_type IN ('enslaver', 'slaveholder', 'owner')
        AND canonical_name = ${person.name} LIMIT 5
    `;
    for (const match of exactMatch) {
        const dateMatch = birthYearsOverlap(match.birth_year_estimate);
        const locationMatch = locationsOverlap(match.primary_state, match.primary_county);
        if (dateMatch === false || locationMatch === false) continue;
        let confidence = 0.50;
        if (locationMatch === true) confidence += 0.25;
        if (dateMatch === true) confidence += 0.15;
        return { type: locationMatch === true ? 'exact_name_location_match' : 'exact_name_match',
            confidence, verified: false, verification_notes: 'Legacy name match. REQUIRES DOCUMENT REVIEW.',
            date_verified: dateMatch === true, location_verified: locationMatch === true, ...match };
    }

    // Case-insensitive name match
    const nameMatch = await sql`
        SELECT id, canonical_name, person_type, birth_year_estimate, primary_state, primary_county
        FROM canonical_persons WHERE person_type IN ('enslaver', 'slaveholder', 'owner')
        AND LOWER(canonical_name) = LOWER(${person.name}) LIMIT 5
    `;
    for (const match of nameMatch) {
        const dateMatch = birthYearsOverlap(match.birth_year_estimate);
        const locationMatch = locationsOverlap(match.primary_state, match.primary_county);
        if (dateMatch === false || locationMatch === false) continue;
        let confidence = 0.45;
        if (locationMatch === true) confidence += 0.25;
        if (dateMatch === true) confidence += 0.15;
        return { type: locationMatch === true ? 'name_location_match' : 'name_match',
            confidence, verified: false, verification_notes: 'Legacy case-insensitive name match. REQUIRES DOCUMENT REVIEW.',
            date_verified: dateMatch === true, location_verified: locationMatch === true, ...match };
    }

    // Fallback: SlaveVoyages
    const svMatch = await checkSlaveVoyages(person);
    if (svMatch) return svMatch;

    return null;
}

/**
 * Classify lineage as DEBT (inheritance) or CREDIT (rape/violence victim)
 *
 * WARNING: This classification is DISABLED until proper verification is implemented.
 *
 * The previous implementation matched ancestor names against enslaved records
 * without verifying dates, locations, or documents. This led to FALSE POSITIVES
 * (e.g., Lydia Williams with a 1786 marriage certificate was falsely matched
 * to a "Lydia Williams" in enslaved records - marriage = FREE person).
 *
 * REQUIREMENTS FOR PROPER CLASSIFICATION:
 * 1. Document evidence (Slave Schedules, Wills, Deeds, etc.)
 * 2. Date verification (birth/death years must match)
 * 3. Location verification (county/state must match)
 * 4. Cross-reference with free status documents (marriage, property, voting records)
 *
 * Until these are implemented, all matches are marked as UNVERIFIED.
 */
async function classifyLineage(path, slaveholder) {
    // DISABLED: Name-only matching is unreliable and produces false positives
    // TODO: Implement proper document-based verification

    return {
        classification: 'unverified',
        reason: 'Classification disabled - requires document verification. Match found by name/location only.'
    };
}

/**
 * Save climb session progress to database (for resume capability)
 */
async function saveClimbProgress(sessionId, queue, visited, matches, status = 'in_progress') {
    if (!sessionId) return;

    try {
        await sql`
            UPDATE ancestor_climb_sessions
            SET current_queue = ${JSON.stringify(queue.map(q => ({ fs_id: q[0], generation: q[1], path: q[2] })))},
                visited_set = ${Array.from(visited)},
                all_matches = ${JSON.stringify(matches)},
                ancestors_visited = ${visited.size},
                matches_found = ${matches.length},
                last_activity = NOW(),
                status = ${status}
            WHERE id = ${sessionId}
        `;
    } catch (e) {
        console.log(`   ⚠ Could not save progress: ${e.message}`);
    }
}

/**
 * Create a new climb session in database
 */
async function createClimbSession(modernPersonName, modernPersonFsId, config = {}) {
    try {
        const result = await sql`
            INSERT INTO ancestor_climb_sessions (
                modern_person_name,
                modern_person_fs_id,
                status,
                config
            ) VALUES (
                ${modernPersonName},
                ${modernPersonFsId || 'NAME-ONLY'},
                'in_progress',
                ${JSON.stringify(config)}
            )
            RETURNING id
        `;
        return result[0]?.id;
    } catch (e) {
        console.log(`   ⚠ Could not create session: ${e.message}`);
        return null;
    }
}

/**
 * Load existing session for resume
 */
async function loadClimbSession(sessionId) {
    try {
        const result = await sql`
            SELECT * FROM ancestor_climb_sessions WHERE id = ${sessionId}
        `;
        if (result.length === 0) return null;

        const session = result[0];
        return {
            modernPersonName: session.modern_person_name,
            modernPersonFsId: session.modern_person_fs_id,
            queue: session.current_queue.map(q => [q.fs_id, q.generation, q.path]),
            visited: new Set(session.visited_set || []),
            matches: session.all_matches || [],
            config: session.config || {}
        };
    } catch (e) {
        console.log(`   ⚠ Could not load session: ${e.message}`);
        return null;
    }
}

/**
 * Save match to normalized matches table (with verification columns from migration 034)
 */
async function saveMatch(sessionId, modernPerson, match) {
    try {
        const verdict = match.verdict;
        await sql`
            INSERT INTO ancestor_climb_matches (
                session_id,
                modern_person_name,
                modern_person_fs_id,
                slaveholder_name,
                slaveholder_fs_id,
                slaveholder_birth_year,
                generation_distance,
                lineage_path,
                lineage_path_fs_ids,
                match_type,
                match_confidence,
                classification,
                classification_reason,
                verification_status,
                verification_evidence,
                confidence_adjusted,
                requires_human_review,
                review_reason
            ) VALUES (
                ${sessionId},
                ${modernPerson.name},
                ${modernPerson.fs_id},
                ${match.match.canonical_name || match.match.full_name},
                ${match.person.fs_id},
                ${match.person.birth_year},
                ${match.generation},
                ${match.path},
                ${[]},
                ${match.match.type},
                ${match.match.confidence},
                ${verdict ? verdict.classification : (match.classification?.classification || 'unverified')},
                ${verdict ? verdict.evidence.map(e => e.detail).join('; ') : (match.classification?.reason || 'Unknown')},
                ${verdict ? (verdict.requires_human_review ? 'needs_review' : 'auto_verified') : 'unverified'},
                ${verdict ? JSON.stringify(verdict.evidence) : '[]'},
                ${verdict ? verdict.confidence_adjusted : null},
                ${verdict ? verdict.requires_human_review : false},
                ${verdict ? verdict.review_reason : null}
            )
        `;
    } catch (e) {
        // Fallback: if new columns don't exist yet (migration 034 not applied), save without them
        if (e.message.includes('column') && (e.message.includes('verification_status') || e.message.includes('confidence_adjusted'))) {
            try {
                await sql`
                    INSERT INTO ancestor_climb_matches (
                        session_id, modern_person_name, modern_person_fs_id,
                        slaveholder_name, slaveholder_fs_id, slaveholder_birth_year,
                        generation_distance, lineage_path, lineage_path_fs_ids,
                        match_type, match_confidence, classification, classification_reason
                    ) VALUES (
                        ${sessionId}, ${modernPerson.name}, ${modernPerson.fs_id},
                        ${match.match.canonical_name || match.match.full_name},
                        ${match.person.fs_id}, ${match.person.birth_year},
                        ${match.generation}, ${match.path}, ${[]},
                        ${match.match.type}, ${match.match.confidence},
                        ${match.classification?.classification || 'unverified'},
                        ${match.classification?.reason || 'Unknown'}
                    )
                `;
                console.log(`   ⚠ Saved match without verification columns (run migration 034)`);
            } catch (e2) {
                console.log(`   ⚠ Could not save match: ${e2.message}`);
            }
        } else {
            console.log(`   ⚠ Could not save match: ${e.message}`);
        }
    }
}

/**
 * Learning loop: when the climber extracts race indicators from a FamilySearch page,
 * feed that data back into free_persons to improve future climbs.
 */
async function registerRaceEvidence(person) {
    if (!person.race_indicators || person.race_indicators.length === 0) return;
    if (!person.name || person.name.trim().split(/\s+/).length < 2) return;

    const raceText = person.race_indicators.join(' ').toLowerCase();
    let raceDesignation = null;
    if (raceText.includes('black') || raceText.includes('negro')) raceDesignation = 'black';
    else if (raceText.includes('mulatto')) raceDesignation = 'mulatto';
    else if (raceText.includes('colored')) raceDesignation = 'colored';
    else if (raceText.includes('white')) raceDesignation = 'white';

    if (!raceDesignation) return;
    // Only register non-white race evidence (white is the default assumption for slaveholders)
    if (raceDesignation === 'white') return;

    const location = (person.locations && person.locations[0]) || null;
    const fsUrl = person.fs_id ? `https://www.familysearch.org/tree/person/details/${person.fs_id}` : null;

    try {
        await sql`
            INSERT INTO free_persons (full_name, race_designation, birth_year, state, source_type, source_url, freedom_status)
            VALUES (${person.name}, ${raceDesignation}, ${person.birth_year || null}, ${location}, 'familysearch_climb', ${fsUrl}, 'unknown')
            ON CONFLICT DO NOTHING
        `;
    } catch (e) {
        // Non-fatal — table may not exist or have different constraints
    }
}

/**
 * BFS climb through ancestors - finds ALL slaveholder matches
 */
async function climbAncestors(startFsId, startName = null, resumeSession = null, participantInfo = {}, familyTreeMap = {}) {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('   FAMILYSEARCH ANCESTOR CLIMBER v2');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`Starting Person: ${startFsId}`);
    console.log(`Mode: Find ALL slaveholder connections`);
    console.log(`Historical Cutoff: ${HISTORICAL_CUTOFF_YEAR}`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    // Initialize or restore session state
    // Queue entries: [identifier, generation, path, entryType, metadata]
    // entryType: 'fs_id' (default), 'uuid', 'name_only'
    let queue, localVisited, localMatches;
    const visitedFsIds = new Set();   // Track visited FamilySearch IDs
    const visitedUuids = new Set();   // Track visited canonical_persons UUIDs

    if (resumeSession) {
        console.log(`Resuming session ${resumeSession.sessionId}...`);
        queue = resumeSession.queue;
        localVisited = resumeSession.visited;
        localMatches = resumeSession.matches;
        // Populate visited sets from legacy Set
        for (const id of localVisited) {
            visitedFsIds.add(id);
        }
    } else if (startFsId === 'NAME-ONLY' && participantInfo) {
        // Name-only mode: skip gen 0 FS page, queue parents directly
        queue = [];
        localVisited = new Set();
        localMatches = [];

        // Create session for name-only climbs so progress is tracked
        sessionId = await createClimbSession(startName || 'Unknown', null, {
            max_generations: MAX_GENERATIONS,
            historical_cutoff: HISTORICAL_CUTOFF_YEAR,
            mode: 'name_only',
            participant_info: participantInfo
        });
        console.log(`Session ID: ${sessionId}\n`);

        // Create identity records for provided parents and queue them
        if (participantInfo.fatherName) {
            const father = await findOrCreatePerson(
                participantInfo.fatherName,
                participantInfo.birthYear ? participantInfo.birthYear - 25 : null,
                participantInfo.birthLocation || null,
                'participant_provided'
            );
            if (father) {
                queue.push([father.uuid || `cp_${father.id}`, 1, [startName || 'participant'], 'uuid',
                    { name: participantInfo.fatherName, canonical_person_id: father.id,
                      birth_year: participantInfo.birthYear ? participantInfo.birthYear - 25 : null,
                      location: participantInfo.birthLocation || null }]);
                // Save inferred parent link
                await saveInferredParentLink(null, { name: startName, fs_id: null },
                    { parentName: participantInfo.fatherName, parentFsId: null,
                      relationship: 'father', discoveryMethod: 'participant_provided', confidence: 0.70 });
            }
        }
        if (participantInfo.motherName) {
            const mother = await findOrCreatePerson(
                participantInfo.motherName,
                participantInfo.birthYear ? participantInfo.birthYear - 25 : null,
                participantInfo.birthLocation || null,
                'participant_provided'
            );
            if (mother) {
                queue.push([mother.uuid || `cp_${mother.id}`, 1, [startName || 'participant'], 'uuid',
                    { name: participantInfo.motherName, canonical_person_id: mother.id,
                      birth_year: participantInfo.birthYear ? participantInfo.birthYear - 25 : null,
                      location: participantInfo.birthLocation || null }]);
                await saveInferredParentLink(null, { name: startName, fs_id: null },
                    { parentName: participantInfo.motherName, parentFsId: null,
                      relationship: 'mother', discoveryMethod: 'participant_provided', confidence: 0.70 });
            }
        }

        console.log(`Queued ${queue.length} parent(s) for name-only climbing\n`);
    } else {
        queue = [[startFsId, 0, [], 'fs_id']];
        localVisited = new Set();
        localMatches = [];

        // Create new session
        sessionId = await createClimbSession(startName || startFsId, startFsId, {
            max_generations: MAX_GENERATIONS,
            historical_cutoff: HISTORICAL_CUTOFF_YEAR
        });
        console.log(`Session ID: ${sessionId}\n`);
    }

    // Track modern person for match saving
    let modernPerson = null;

    // For name-only climbs, set modernPerson immediately so matches can be saved
    if (startFsId === 'NAME-ONLY' && startName) {
        modernPerson = {
            name: startName,
            fs_id: null,
            birth_year: participantInfo.birthYear || null,
            birth_place: participantInfo.birthLocation || null,
            locations: participantInfo.birthLocation ? [participantInfo.birthLocation] : []
        };
    }

    // Main BFS loop - NO LONGER STOPS AT FIRST MATCH
    while (queue.length > 0) {
        const entry = queue.shift();
        const [identifier, generation, path, entryType = 'fs_id', metadata = {}] = entry;

        if (generation > MAX_GENERATIONS) continue;

        // ─── Resolve entry to an FS ID for navigation ───
        let fsId = null;
        let nameOnlyPerson = null;

        if (entryType === 'fs_id') {
            fsId = identifier;
            if (visitedFsIds.has(fsId)) continue;
            visitedFsIds.add(fsId);
            localVisited.add(fsId); // backward compat
        } else if (entryType === 'uuid') {
            if (visitedUuids.has(identifier)) continue;
            visitedUuids.add(identifier);
            // Look up FS ID from person_external_ids
            try {
                const extId = await sql`
                    SELECT external_id FROM person_external_ids
                    WHERE canonical_person_id = ${metadata.canonical_person_id}
                    AND id_system = 'familysearch' LIMIT 1
                `;
                if (extId.length > 0) {
                    fsId = extId[0].external_id;
                    if (visitedFsIds.has(fsId)) continue;
                    visitedFsIds.add(fsId);
                    localVisited.add(fsId);
                } else {
                    // No FS ID — treat as name_only
                    nameOnlyPerson = metadata;
                }
            } catch (err) {
                // person_external_ids may not exist yet
                nameOnlyPerson = metadata;
            }
        } else if (entryType === 'name_only') {
            nameOnlyPerson = metadata;
            // Dedup by canonical_person_id if available
            if (metadata.canonical_person_id) {
                const dedupKey = `cp_${metadata.canonical_person_id}`;
                if (visitedUuids.has(dedupKey)) continue;
                visitedUuids.add(dedupKey);
            }
        }

        // ─── Handle name_only entries: search FS tree, then records ───
        if (nameOnlyPerson && !fsId) {
            // FIX 1: Generation cap for name-only entries
            if (generation > MAX_NAME_ONLY_GENERATIONS) {
                console.log(`\n📍 Gen ${generation}: Skipping name-only "${nameOnlyPerson.name}" — exceeds max name-only depth (${MAX_NAME_ONLY_GENERATIONS})`);
                continue;
            }
            console.log(`\n📍 Gen ${generation}: Name-only search for "${nameOnlyPerson.name}" (queue: ${queue.length})`);
            try {
                // Check page health before expensive TreeSearch; recover if needed
                if (!await isPageHealthy()) {
                    await recoverPage();
                }
                const treeResult = await searchTreeForPerson(
                    nameOnlyPerson.name,
                    nameOnlyPerson.birth_year || null,
                    nameOnlyPerson.location || null
                );
                if (treeResult && treeResult.fsId) {
                    fsId = treeResult.fsId;
                    if (visitedFsIds.has(fsId)) continue;
                    visitedFsIds.add(fsId);
                    localVisited.add(fsId);
                    console.log(`   ✓ Found tree person: ${fsId}`);
                    // Save the discovered FS ID to person_external_ids
                    if (nameOnlyPerson.canonical_person_id) {
                        try {
                            await sql`INSERT INTO person_external_ids
                                (canonical_person_id, id_system, external_id, external_url, confidence, discovered_by, session_id)
                                VALUES (${nameOnlyPerson.canonical_person_id}, 'familysearch', ${fsId},
                                    ${'https://www.familysearch.org/tree/person/details/' + fsId},
                                    0.80, 'ancestor_climber', ${sessionId})
                                ON CONFLICT (id_system, external_id) DO NOTHING`;
                        } catch (e) { /* table may not exist */ }
                    }
                } else {
                    // No tree person found — try record search + discoverParents
                    console.log(`   ~ No tree person found, searching records...`);
                    // Track name-only ancestors as visited for progress counting
                    const nameKey = `name:${nameOnlyPerson.name.toLowerCase()}`;
                    localVisited.add(nameKey);

                    const syntheticPerson = {
                        name: nameOnlyPerson.name,
                        birth_year: nameOnlyPerson.birth_year,
                        birth_place: nameOnlyPerson.location || null,
                        locations: nameOnlyPerson.location ? [nameOnlyPerson.location] : [],
                        fs_id: null
                    };

                    // Check enslaver DB for this name-only person
                    const enslaverMatch = await checkEnslaverDatabase(syntheticPerson);
                    if (enslaverMatch && enslaverMatch.confidence >= 0.50) {
                        const isTier3 = enslaverMatch.requires_human_review && enslaverMatch.type === 'name_only_match';
                        console.log(`   🎯 Name-only person "${nameOnlyPerson.name}" matches enslaver DB${isTier3 ? ' [Tier 3 — pending review]' : ''}`);
                        const matchRecord = {
                            person: syntheticPerson,
                            match: enslaverMatch,
                            generation,
                            path: [...path, nameOnlyPerson.name],
                            classification: isTier3
                                ? { classification: 'unverified', reason: 'Name-only match (Tier 3) — needs human verification' }
                                : { type: 'UNVERIFIED' },
                            documentVerification: { hasDocuments: false },
                            verdict: isTier3 ? {
                                classification: 'unverified',
                                confidence_adjusted: enslaverMatch.confidence,
                                requires_human_review: true,
                                review_reason: 'Name-only match (Tier 3) — needs human verification',
                                evidence: [{ type: 'info', detail: 'Tier 3 name-only match — requires human verification' }]
                            } : null
                        };
                        localMatches.push(matchRecord);
                        // Persist to DB
                        if (sessionId && modernPerson) {
                            await saveMatch(sessionId, modernPerson, matchRecord);
                        }
                    }

                    // Classify branch context for garbage detection
                    const branchCtx = branchClassifier.primaryContext(syntheticPerson);
                    // Try to discover THEIR parents via records (family tree map has priority)
                    const discoveredParents = await discoverParents(syntheticPerson, {}, familyTreeMap, branchCtx?.type || null);
                    for (const parent of discoveredParents) {
                        if (parent.confidence < 0.50) continue;
                        // Garbage detection: validate discovered parent against branch context
                        if (branchCtx && parent.discoveryMethod !== 'participant_family_tree' && parent.discoveryMethod !== 'participant_provided') {
                            const garbageCheck = garbageDetector.validate(syntheticPerson, parent, branchCtx);
                            if (garbageCheck.recommendation === 'reject') {
                                console.log(`   ✗ REJECTED ${parent.parentName}: ${garbageCheck.reason}`);
                                continue;
                            }
                            if (garbageCheck.adjustedConfidence !== undefined) {
                                parent.confidence = garbageCheck.adjustedConfidence;
                            }
                        }
                        await saveInferredParentLink(sessionId, syntheticPerson, parent);
                        if (parent.parentFsId && !visitedFsIds.has(parent.parentFsId)) {
                            queue.push([parent.parentFsId, generation + 1, [...path, nameOnlyPerson.name], 'fs_id']);
                        } else if (parent.parentName) {
                            // Create/find identity for discovered parent and queue
                            const personRecord = await findOrCreatePerson(
                                parent.parentName,
                                parent.parentBirthYear || (nameOnlyPerson.birth_year ? nameOnlyPerson.birth_year - 25 : null),
                                nameOnlyPerson.location,
                                parent.discoveryMethod
                            );
                            if (personRecord) {
                                if (nameOnlyPerson.canonical_person_id) {
                                    await savePersonRelationship(
                                        personRecord.id, nameOnlyPerson.canonical_person_id,
                                        parent.relationship === 'father' ? 'parent' : 'parent',
                                        Math.round(parent.confidence * 100)
                                    );
                                }
                                // Carry parent's own location if available (from family tree), else inherit child's
                                const parentLocation = parent.parentBirthLocation || parent.parentLocation || nameOnlyPerson.location;
                                queue.push([personRecord.uuid || `cp_${personRecord.id}`, generation + 1,
                                    [...path, nameOnlyPerson.name], 'uuid',
                                    { name: parent.parentName, canonical_person_id: personRecord.id,
                                      birth_year: parent.parentBirthYear, location: parentLocation }]);
                            }
                        }
                    }
                    // Rate limiting then continue to next queue entry
                    await new Promise(r => setTimeout(r, 1500));
                    continue;
                }
            } catch (err) {
                console.log(`   ⚠ Name-only search error: ${err.message.substring(0, 60)}`);
                continue;
            }
        }

        if (!fsId) continue; // Safety: nothing to navigate to

        if (localVisited.has(fsId) && !visitedFsIds.has(fsId)) {
            // Already visited via a different path
            continue;
        }

        // Navigate to person's page
        const url = PERSON_PAGE_URL + fsId;
        console.log(`\n📍 Gen ${generation}: Visiting ${fsId} (queue: ${queue.length}, matches: ${localMatches.length})`);

        try {
            if (!await safeGoto(url)) {
                console.log('   ⚠ Navigation failed, skipping this ancestor');
                continue;
            }
            await new Promise(r => setTimeout(r, 2000));

            // Check if we got redirected away from details page (e.g., to portrait/pedigree view)
            let currentUrl = page.url();
            if (!currentUrl.includes('/tree/person/details/')) {
                if (currentUrl.includes('ident.familysearch') || currentUrl.includes('/auth/')) {
                    console.log('   ⚠ Session expired - re-login required');
                    console.log('   Please log in via the Chrome window...');
                    try {
                        await page.waitForFunction(() => {
                            return window.location.href.includes('/tree/person/') ||
                                   window.location.href.includes('/tree/pedigree/');
                        }, { timeout: 180000 });
                        const cookies = await page.cookies();
                        fs.writeFileSync('./fs-climber-cookies.json', JSON.stringify(cookies, null, 2));
                        console.log(`   ✓ Re-logged in, saved ${cookies.length} cookies`);
                        currentUrl = page.url();
                    } catch (loginErr) {
                        console.log('   ⚠ Login timeout - skipping this ancestor');
                        continue;
                    }
                }

                // Redirected to portrait/pedigree view - navigate explicitly to details
                if (!currentUrl.includes('/tree/person/details/')) {
                    console.log(`   [Debug] Redirected to ${currentUrl}, forcing details view...`);
                    await safeGoto(PERSON_PAGE_URL + fsId);
                    await new Promise(r => setTimeout(r, 2000));
                    currentUrl = page.url();

                    // If STILL redirected, it means FS doesn't have details for this person
                    // or user preference forces portrait view - try to parse what we have
                    if (!currentUrl.includes('/tree/person/details/')) {
                        console.log(`   [Debug] Still on ${currentUrl.split('?')[0]}, will parse current view`);
                    }
                }
            }

            // Wait for React app to render actual person content
            try {
                await page.waitForFunction(() => {
                    const bodyText = document.body.innerText;
                    const title = document.title;
                    // Check for any sign the SPA has rendered person data
                    const hasPersonContent = bodyText.includes('Family Members') ||
                                             bodyText.includes('Parents and Siblings') ||
                                             bodyText.includes('Vital Information') ||
                                             bodyText.includes('Person Not Found');
                    const hasTitleName = title.match(/^[A-Z].*\(/) !== null;
                    const hasH1 = document.querySelector('h1')?.innerText?.length > 2;
                    return hasPersonContent || hasTitleName || hasH1;
                }, { timeout: 10000 });
            } catch (e) {
                // SPA may still be loading - give it a bit more time
                await new Promise(r => setTimeout(r, 3000));
            }

            // Check for "Person Not Found" before attempting extraction
            const pageBodyText = await page.evaluate(() => document.body.innerText);
            const pageTitle = await page.title();
            if (pageBodyText.includes('Person Not Found') ||
                pageTitle.includes('[Unknown Name]') ||
                pageTitle.includes('UNKNOWN')) {
                // For generation 0 with participant info, don't skip — let parent discovery handle it
                if (generation === 0 && participantInfo && (participantInfo.fatherName || participantInfo.motherName)) {
                    console.log(`   ⚠ Person Not Found on FamilySearch (${fsId}), but participant info provided — attempting parent discovery`);
                    // Fall through to extraction (which will also fail, triggering discoverParents)
                } else {
                    console.log(`   ⚠ Person Not Found on FamilySearch (${fsId}), skipping`);
                    continue;
                }
            }

            // ADAPTIVE WAIT TIMES based on generation depth
            const baseScrollDelay = generation <= 3 ? 1500 :
                                   generation <= 6 ? 2000 :
                                   generation <= 10 ? 2500 : 3000;
            const baseSectionWait = generation <= 3 ? 5000 :
                                   generation <= 6 ? 7000 :
                                   generation <= 10 ? 8000 : 10000;

            // Step 1: Scroll down to trigger Family Members section loading
            await page.evaluate(() => {
                window.scrollTo(0, 500);
            });
            await new Promise(r => setTimeout(r, baseScrollDelay));

            // Step 2: Scroll more to ensure section is in viewport
            await page.evaluate(() => {
                window.scrollTo(0, 1000);
            });
            await new Promise(r => setTimeout(r, baseScrollDelay));

            // Step 3: Wait for Family Members section to appear (with adaptive timeout)
            try {
                await page.waitForFunction(() => {
                    const bodyText = document.body.innerText;
                    return bodyText.includes('Family Members') ||
                           bodyText.includes('Parents and Siblings') ||
                           bodyText.includes('Children');
                }, { timeout: baseSectionWait });

                console.log('   [Debug] Family Members section loaded');
            } catch (e) {
                console.log('   [Debug] Family Members section not found (may have no family data)');
            }

            // Step 4: Brief wait for any final dynamic content
            await new Promise(r => setTimeout(r, 1000));

            // Extract person data
            const person = await extractPersonFromPage();

            // Store modern person on first iteration
            if (generation === 0) {
                modernPerson = person;
            }

            // Debug: show what we found
            if (person.raw.allParentIds) {
                console.log(`   [Debug] Found IDs: ${person.raw.allParentIds.join(', ') || 'none'}`);
            }

            if (!person.name) {
                // For generation 0 with participant info, use the provided name
                // and continue to parent discovery instead of skipping
                if (generation === 0 && participantInfo && (participantInfo.fatherName || participantInfo.motherName)) {
                    console.log('   ⚠ Person page is empty/unknown, but participant info provided — using provided name');
                    person.name = startName || participantInfo.name || fsId;
                    person.birth_year = person.birth_year || participantInfo.birthYear || null;
                    person.birth_place = person.birth_place || participantInfo.birthLocation || null;
                    if (participantInfo.birthLocation && !person.locations?.length) {
                        person.locations = [participantInfo.birthLocation];
                    }
                    person.fs_id = fsId;
                } else {
                    console.log('   ⚠ Could not extract name, capturing diagnostics...');

                    const diagnostic = await captureFailedExtraction(fsId, generation, page, 'no_name');

                    console.log(`   📁 Saved to: ${diagnostic.folder}`);
                    console.log(`   📄 HTML: ${diagnostic.htmlSize || 0} bytes`);
                    console.log(`   🔗 Links found: ${diagnostic.linkCount || 0}`);
                    if (diagnostic.fsIdsFound && diagnostic.fsIdsFound.length > 0) {
                        console.log(`   🆔 FS IDs on page: ${diagnostic.fsIdsFound.join(', ')}`);
                    }
                    if (diagnostic.indicators) {
                        console.log(`   📊 Page indicators:`);
                        console.log(`      - Family Members section: ${diagnostic.indicators.hasFamilyMembers ? 'YES' : 'NO'}`);
                        console.log(`      - Body text length: ${diagnostic.indicators.bodyTextLength} chars`);
                        console.log(`      - Login prompt: ${diagnostic.indicators.hasLoginPrompt ? 'YES' : 'NO'}`);
                    }
                    if (diagnostic.textSample) {
                        console.log(`   Preview: "${diagnostic.textSample.substring(0, 80)}..."`);
                    }

                    continue;
                }
            }

            // UI GARBAGE CHECK - Skip if person name is UI garbage
            const isUIGarbage = (text) => {
                if (!text) return true;
                if (text.includes('\n')) return true; // Multi-line text (UI menus)
                const uiPatterns = [
                    /Family Tree/i, /Search/i, /Memories/i, /Get Involved/i,
                    /Activities/i, /Sign In/i, /Help/i
                ];
                return uiPatterns.some(pattern => pattern.test(text));
            };

            if (isUIGarbage(person.name)) {
                console.log(`   ⚠ UI garbage detected in name ("${person.name.substring(0, 30)}..."), skipping`);
                continue;
            }

            const years = person.birth_year
                ? (person.death_year ? `${person.birth_year}-${person.death_year}` : `${person.birth_year}-`)
                : '?';

            console.log(`   Name: ${person.name} (${years})`);
            console.log(`   Locations: ${person.locations?.join(', ') || 'none found'}`);
            console.log(`   Father: ${person.father_fs_id || 'not found'}`);
            console.log(`   Mother: ${person.mother_fs_id || 'not found'}`);
            
            // Capture diagnostics if no parents found
            if (!person.father_fs_id && !person.mother_fs_id) {
                console.log('   ⚠ No parents found in tree, attempting multi-source discovery...');
                const diagnostic = await captureFailedExtraction(fsId, generation, page, 'no_parents');
                console.log(`   📁 Debug saved: ${diagnostic.folder}/${fsId}-gen${generation}-no_parents.*`);

                // Classify branch context for garbage detection and source routing
                const branchCtx = branchClassifier.primaryContext(person);

                // MULTI-SOURCE PARENT DISCOVERY
                // Only run for first few generations where participant info is most relevant
                const discoveredParents = await discoverParents(person, participantInfo, familyTreeMap, branchCtx?.type || null);

                for (const parent of discoveredParents) {
                    if (parent.confidence < 0.50) continue; // Skip very low confidence
                    // Garbage detection: validate discovered parent against branch context
                    if (branchCtx && parent.discoveryMethod !== 'participant_family_tree' && parent.discoveryMethod !== 'participant_provided') {
                        const garbageCheck = garbageDetector.validate(person, parent, branchCtx);
                        if (garbageCheck.recommendation === 'reject') {
                            console.log(`   ✗ REJECTED ${parent.parentName}: ${garbageCheck.reason}`);
                            continue;
                        }
                        if (garbageCheck.adjustedConfidence !== undefined) {
                            parent.confidence = garbageCheck.adjustedConfidence;
                        }
                    }

                    // Save evidence to audit trail
                    await saveInferredParentLink(sessionId, person, parent);

                    if (parent.parentFsId && !visitedFsIds.has(parent.parentFsId)) {
                        // Has FS ID — queue as fs_id (existing behavior)
                        console.log(`   ✓ Discovered ${parent.relationship}: ${parent.parentName} (${parent.parentFsId}) via ${parent.discoveryMethod}`);
                        queue.push([parent.parentFsId, generation + 1, [...path, person.name], 'fs_id']);
                    } else if (parent.parentName && !parent.parentFsId) {
                        // No FS ID — create/find identity record and queue as uuid for name-based climbing
                        const parentBirthYear = parent.parentBirthYear || (person.birth_year ? person.birth_year - 25 : null);
                        const parentLocation = (person.locations && person.locations[0]) || null;
                        const personRecord = await findOrCreatePerson(
                            parent.parentName, parentBirthYear, parentLocation, parent.discoveryMethod
                        );

                        if (personRecord) {
                            console.log(`   ✓ Discovered ${parent.relationship}: ${parent.parentName} → canonical_persons #${personRecord.id} (${personRecord.isNew ? 'NEW' : 'existing'}, tier ${personRecord.matchTier}) via ${parent.discoveryMethod}`);

                            // Save parent-child relationship
                            if (person.canonical_person_id || person._canonical_id) {
                                await savePersonRelationship(
                                    personRecord.id,
                                    person.canonical_person_id || person._canonical_id,
                                    'parent',
                                    Math.round(parent.confidence * 100)
                                );
                            }

                            // Queue for continued climbing via name-only path
                            queue.push([
                                personRecord.uuid || `cp_${personRecord.id}`,
                                generation + 1,
                                [...path, person.name],
                                'uuid',
                                { name: parent.parentName, canonical_person_id: personRecord.id,
                                  birth_year: parentBirthYear, location: parentLocation }
                            ]);
                        } else {
                            console.log(`   ~ Found ${parent.relationship} name "${parent.parentName}" but could not create identity record`);
                        }
                    }
                }
            }

            // Store ancestor in global list
            ancestors.push({
                ...person,
                generation,
                path: [...path, person.name]
            });

            // HISTORICAL CUTOFF - stop climbing if before 1450
            if (person.birth_year && person.birth_year < HISTORICAL_CUTOFF_YEAR) {
                console.log(`   ⏹ Historical cutoff reached (born ${person.birth_year})`);
                continue; // Don't queue parents, but don't break the whole loop
            }

            // Check enslaver database (wrapped in try-catch to not break queue logic)
            try {
                const enslaverMatch = await checkEnslaverDatabase(person);

                if (enslaverMatch) {
                    // Run race-aware verification pipeline
                    const verdict = await matchVerifier.verify(person, enslaverMatch, generation);

                    console.log(`\n   🎯 MATCH CANDIDATE: ${enslaverMatch.canonical_name || enslaverMatch.full_name}`);
                    console.log(`   Match type: ${enslaverMatch.type} (raw: ${(enslaverMatch.confidence * 100).toFixed(0)}%, adjusted: ${(verdict.confidence_adjusted * 100).toFixed(0)}%)`);
                    console.log(`   Classification: ${verdict.classification}${verdict.requires_human_review ? ' [NEEDS REVIEW]' : ''}`);
                    if (verdict.evidence.length > 0) {
                        for (const e of verdict.evidence) {
                            const prefix = e.type === 'disqualifying' ? '  ✗' : '  ✓';
                            console.log(`   ${prefix} ${e.detail}`);
                        }
                    }

                    // Check for supporting documents
                    const docVerification = await documentVerifier.verifyMatch(
                        enslaverMatch.canonical_name || enslaverMatch.full_name,
                        modernPerson?.name || person.name,
                        [...path, person.name]
                    );

                    if (docVerification.hasDocuments) {
                        console.log(`   📄 Found ${docVerification.documentCount} document(s): ${docVerification.documentTypes.join(', ')}`);
                    }

                    const matchRecord = {
                        person,
                        match: enslaverMatch,
                        generation,
                        path: [...path, person.name],
                        classification: { classification: verdict.classification, reason: verdict.evidence.map(e => e.detail).join('; ') || 'No evidence' },
                        documentVerification: docVerification,
                        verdict // Store full verdict for DB save
                    };

                    localMatches.push(matchRecord);
                    allMatches.push(matchRecord);

                    // Save ALL matches (even disqualified ones are valuable data)
                    if (sessionId && modernPerson) {
                        await saveMatch(sessionId, modernPerson, matchRecord);
                    }

                    // Learning loop: feed race data back to free_persons table
                    if (person.race_indicators && person.race_indicators.length > 0) {
                        await registerRaceEvidence(person);
                    }

                    console.log(`   ✓ Match recorded (${verdict.classification}), continuing climb...`);
                }
            } catch (dbErr) {
                console.log(`   ⚠ DB check error: ${dbErr.message.substring(0, 50)}`);
            }

            // Queue parents (BOTH sides)
            if (person.father_fs_id && !visitedFsIds.has(person.father_fs_id)) {
                queue.push([person.father_fs_id, generation + 1, [...path, person.name], 'fs_id']);
            }
            if (person.mother_fs_id && !visitedFsIds.has(person.mother_fs_id)) {
                queue.push([person.mother_fs_id, generation + 1, [...path, person.name], 'fs_id']);
            }

            // Save progress periodically
            if (localVisited.size % SAVE_PROGRESS_EVERY === 0) {
                await saveClimbProgress(sessionId, queue, localVisited, localMatches);
                console.log(`   💾 Progress saved (${localVisited.size} ancestors visited)`);
            }

            // Rate limiting
            await new Promise(r => setTimeout(r, 1500));

        } catch (e) {
            console.log(`   ⚠ Error: ${e.message}`);
        }
    }

    // Final save
    await saveClimbProgress(sessionId, queue, localVisited, localMatches, 'completed');

    return { matches: localMatches, visited: localVisited.size, sessionId };
}

/**
 * Save results to database
 */
async function saveResults(startFsId, result) {
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('   CLIMB RESULTS');
    console.log('═══════════════════════════════════════════════════════════════\n');

    const { matches, visited, sessionId: sid } = result;

    console.log(`Session ID: ${sid}`);
    console.log(`Ancestors visited: ${visited}`);
    console.log(`Ancestors scraped: ${ancestors.length}`);
    console.log(`Max generation reached: ${Math.max(...ancestors.map(a => a.generation), 0)}`);

    if (matches && matches.length > 0) {
        console.log(`\n✓ ${matches.length} POTENTIAL ENSLAVER CONNECTION(S) FOUND\n`);

        console.log(`⚠️  WARNING: These matches are UNVERIFIED`);
        console.log(`   Matched by: Name + Location only`);
        console.log(`   Required for verification:`);
        console.log(`   - Document evidence (Slave Schedule, Will, Deed)`);
        console.log(`   - Date verification (birth/death years)`);
        console.log(`   - Cross-reference with historical records\n`);

        console.log(`📋 MATCHES REQUIRING VERIFICATION:`);
        for (const match of matches) {
            const name = match.match.canonical_name || match.match.full_name;
            const matchType = match.match.type || 'unknown';
            const confidence = match.match.confidence ? `${(match.match.confidence * 100).toFixed(0)}%` : 'N/A';

            // Build verification status
            const checks = [];
            if (match.match.location_verified) checks.push('✓ location');
            else checks.push('? location');
            if (match.match.date_verified) checks.push('✓ dates');
            else checks.push('? dates');

            console.log(`   • ${name}`);
            console.log(`     Generation ${match.generation}: ${match.path.join(' → ')}`);
            console.log(`     Match type: ${matchType} | Confidence: ${confidence}`);
            console.log(`     Checks: ${checks.join(', ')}`);
            if (match.match.verification_notes) {
                console.log(`     Notes: ${match.match.verification_notes}`);
            }
            console.log('');
        }

        // Summary
        console.log(`═══════════════════════════════════════════════════════════════`);
        console.log(`   SUMMARY`);
        console.log(`═══════════════════════════════════════════════════════════════`);
        console.log(`   Potential matches: ${matches.length}`);
        console.log(`   Verified: 0 (manual document review required)`);
        console.log(`   Status: PENDING VERIFICATION`);
    } else {
        console.log('\n○ No enslaver connections found in database');
        console.log('  (May need to expand enslaver database or continue 1860 Slave Schedule scraping)');
    }

    // Save ancestors to database
    console.log('\nSaving ancestors to database...');
    let saved = 0;

    for (const ancestor of ancestors) {
        if (!ancestor.name || !ancestor.fs_id) continue;

        const nameParts = ancestor.name.split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(' ');

        try {
            const result = await sql`
                INSERT INTO canonical_persons (
                    canonical_name,
                    first_name,
                    last_name,
                    birth_year_estimate,
                    death_year_estimate,
                    person_type,
                    verification_status,
                    confidence_score,
                    created_by,
                    notes
                ) VALUES (
                    ${ancestor.name},
                    ${firstName},
                    ${lastName || null},
                    ${ancestor.birth_year || null},
                    ${ancestor.death_year || null},
                    'descendant',
                    'familysearch_scraped',
                    0.9,
                    'ancestor_climber_v2',
                    ${JSON.stringify({
                        familysearch_id: ancestor.fs_id,
                        father_fs_id: ancestor.father_fs_id,
                        mother_fs_id: ancestor.mother_fs_id,
                        locations: ancestor.locations,
                        generation_from_start: ancestor.generation,
                        start_person: startFsId,
                        scraped_at: new Date().toISOString()
                    })}
                )
                ON CONFLICT DO NOTHING
                RETURNING id
            `;

            if (result.length > 0) saved++;
        } catch (e) {
            // Ignore duplicates
        }
    }

    console.log(`Saved ${saved} new ancestors to database`);
    
    // Show failed extractions summary
    if (failedExtractions.length > 0) {
        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('   EXTRACTION FAILURES SUMMARY');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        console.log(`Failed profiles: ${failedExtractions.length}`);
        console.log(`Debug files saved to: debug/logs/failed-extractions/${sessionId || 'unknown'}/\n`);
        
        // Breakdown by failure type
        const byType = {};
        const byGen = {};
        for (const failure of failedExtractions) {
            byType[failure.failure_type] = (byType[failure.failure_type] || 0) + 1;
            byGen[failure.generation] = (byGen[failure.generation] || 0) + 1;
        }
        
        console.log('Failure breakdown:');
        for (const [type, count] of Object.entries(byType)) {
            console.log(`  - ${type.replace(/_/g, ' ')}: ${count} profiles`);
        }
        
        console.log('\nBy generation:');
        for (const [gen, count] of Object.entries(byGen).sort((a, b) => a[0] - b[0])) {
            console.log(`  - Gen ${gen}: ${count} failures`);
        }
        
        // Show sample of indicators
        const hasLoginIssues = failedExtractions.filter(f => f.indicators?.hasLoginPrompt).length;
        const emptyPages = failedExtractions.filter(f => f.indicators?.bodyTextLength < 1000).length;
        const noFamilySection = failedExtractions.filter(f => !f.indicators?.hasFamilyMembers).length;
        
        console.log('\nCommon issues detected:');
        if (hasLoginIssues > 0) console.log(`  - Login/session issues: ${hasLoginIssues} profiles`);
        if (emptyPages > 0) console.log(`  - Empty/incomplete pages: ${emptyPages} profiles`);
        if (noFamilySection > 0) console.log(`  - No Family Members section: ${noFamilySection} profiles`);
        
        console.log('\nTo review debug files:');
        console.log(`  cd debug/logs/failed-extractions/${sessionId || 'unknown'}`);
        console.log(`  open *.html  # View HTML in browser`);
        console.log(`  cat *-metadata.json | jq .  # View metadata`);
    }
    
    console.log('═══════════════════════════════════════════════════════════════\n');
}

/**
 * Main
 */
async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0 || args.includes('--help')) {
        console.log(`
FamilySearch Ancestor Climber v2

Usage:
  FAMILYSEARCH_INTERACTIVE=true node scripts/scrapers/familysearch-ancestor-climber.js <FS_ID>
  FAMILYSEARCH_INTERACTIVE=true node scripts/scrapers/familysearch-ancestor-climber.js --resume <session_id>

Examples:
  # Start new climb from Danyela Brown
  FAMILYSEARCH_INTERACTIVE=true node scripts/scrapers/familysearch-ancestor-climber.js G21N-HD2

  # Resume interrupted session
  FAMILYSEARCH_INTERACTIVE=true node scripts/scrapers/familysearch-ancestor-climber.js --resume abc123

Options:
  --resume <session_id>   Resume an interrupted climb session
  --name <name>           Specify person's name for better logging
  --birth-year <year>     Participant's birth year (enables record search)
  --birth-location <loc>  Participant's birth location
  --father-name <name>    Father's name (enables parent discovery)
  --mother-name <name>    Mother's name (enables parent discovery)
  --family-tree <path>    JSON file with nested family tree (ground truth for parent discovery)

v2 Features:
- Finds ALL slaveholder connections, not just the first
- Historical cutoff at 1450 (transatlantic slave trade start)
- Credit vs Debt classification (rape victim line vs inheritance)
- Session persistence for resume after interruption
- Location matching to reduce false positives
- Saves matches to ancestor_climb_matches table
`);
        return;
    }

    // Parse arguments
    const resumeIndex = args.indexOf('--resume');
    const nameIndex = args.indexOf('--name');
    let resumeSessionId = null;
    let personName = null;

    if (resumeIndex !== -1 && args[resumeIndex + 1]) {
        resumeSessionId = args[resumeIndex + 1];
    }
    if (nameIndex !== -1 && args[nameIndex + 1]) {
        personName = args[nameIndex + 1];
    }

    // Parse participant info for multi-source parent discovery
    const participantInfo = {};
    const birthYearIndex = args.indexOf('--birth-year');
    const birthLocationIndex = args.indexOf('--birth-location');
    const fatherNameIndex = args.indexOf('--father-name');
    const motherNameIndex = args.indexOf('--mother-name');

    if (birthYearIndex !== -1 && args[birthYearIndex + 1]) {
        participantInfo.birthYear = parseInt(args[birthYearIndex + 1]);
    }
    if (birthLocationIndex !== -1 && args[birthLocationIndex + 1]) {
        participantInfo.birthLocation = args[birthLocationIndex + 1];
    }
    if (fatherNameIndex !== -1 && args[fatherNameIndex + 1]) {
        participantInfo.fatherName = args[fatherNameIndex + 1];
    }
    if (motherNameIndex !== -1 && args[motherNameIndex + 1]) {
        participantInfo.motherName = args[motherNameIndex + 1];
    }

    // Parse family tree JSON file (nested multi-generation tree)
    const familyTreeArgIndex = args.indexOf('--family-tree');
    let familyTreeMap = {};
    if (familyTreeArgIndex !== -1 && args[familyTreeArgIndex + 1]) {
        const treePath = args[familyTreeArgIndex + 1];
        try {
            const treeJson = JSON.parse(fs.readFileSync(treePath, 'utf8'));
            familyTreeMap = buildFamilyTreeMap(treeJson);
            console.log(`Family tree loaded: ${Object.keys(familyTreeMap).length} persons from ${treePath}`);
            // Extract top-level info into participantInfo for backward compat
            if (treeJson.name && !personName) personName = treeJson.name;
            if (treeJson.birthYear && !participantInfo.birthYear) participantInfo.birthYear = treeJson.birthYear;
            if (treeJson.birthLocation && !participantInfo.birthLocation) participantInfo.birthLocation = treeJson.birthLocation;
            if (treeJson.parents) {
                for (const p of treeJson.parents) {
                    if (p.relationship === 'father' && !participantInfo.fatherName) participantInfo.fatherName = p.name;
                    if (p.relationship === 'mother' && !participantInfo.motherName) participantInfo.motherName = p.name;
                }
            }
        } catch (e) {
            console.error('Failed to load family tree JSON:', e.message);
            process.exit(1);
        }
    }

    if (Object.keys(participantInfo).length > 0) {
        console.log('Participant info provided:', JSON.stringify(participantInfo));
    }
    if (Object.keys(familyTreeMap).length > 0) {
        console.log('Family tree map persons:', Object.keys(familyTreeMap).join(', '));
    }

    const startFsId = args.find(a => /^[A-Z0-9]{4}-[A-Z0-9]{2,4}$/.test(a));
    const hasParticipantInfo = Object.keys(participantInfo).length > 0;

    if (!startFsId && !resumeSessionId && !hasParticipantInfo) {
        console.error('Error: Must provide a FamilySearch ID, --resume <session_id>, or participant info (--name + --father-name/--mother-name)');
        process.exit(1);
    }

    // Name-only mode: no FS ID, use participant info to start climbing via record search
    const nameOnlyMode = !startFsId && !resumeSessionId && hasParticipantInfo && personName;

    try {
        await launchBrowser();

        let result;

        if (resumeSessionId) {
            // Resume existing session
            console.log(`\nResuming session: ${resumeSessionId}\n`);
            const session = await loadClimbSession(resumeSessionId);

            if (!session) {
                console.error(`Session not found: ${resumeSessionId}`);
                process.exit(1);
            }

            await ensureLoggedIn(session.modernPersonFsId);
            result = await climbAncestors(session.modernPersonFsId, session.modernPersonName, {
                sessionId: resumeSessionId,
                queue: session.queue,
                visited: session.visited,
                matches: session.matches
            });
            await saveResults(session.modernPersonFsId, result);

        } else if (nameOnlyMode) {
            // Name-only climb: create a placeholder FS ID, use participant info for parent discovery
            const placeholderFsId = 'NAME-ONLY';
            console.log(`\n═══ NAME-ONLY MODE ═══`);
            console.log(`Participant: ${personName}`);
            console.log(`Parents: father=${participantInfo.fatherName || 'unknown'}, mother=${participantInfo.motherName || 'unknown'}`);
            console.log(`No FamilySearch ID — will discover ancestors from records\n`);

            // Still need Chrome for record searches
            ensureLoggedIn._hasParticipantInfo = true;
            await ensureLoggedIn(placeholderFsId);
            result = await climbAncestors(placeholderFsId, personName, null, participantInfo, familyTreeMap);
            await saveResults(placeholderFsId, result);

        } else {
            // Normal FS ID climb
            ensureLoggedIn._hasParticipantInfo = hasParticipantInfo;
            await ensureLoggedIn(startFsId);
            result = await climbAncestors(startFsId, personName, null, participantInfo, familyTreeMap);
            await saveResults(startFsId, result);
        }

    } catch (e) {
        console.error('Fatal error:', e.message);
        console.error(e.stack);
        // Save failed status to DB so kiosk UI can show the error
        if (sessionId) {
            try {
                await sql`
                    UPDATE ancestor_climb_sessions
                    SET status = 'failed',
                        last_activity = NOW(),
                        config = jsonb_set(COALESCE(config, '{}'), '{error}', ${JSON.stringify(e.message)}::jsonb)
                    WHERE id = ${sessionId}
                `;
            } catch (_) { /* best effort */ }
        }
    } finally {
        // Close our tab but leave Chrome and other tabs running
        if (page) {
            try { await page.close(); } catch (_) {}
        }
        if (browser) {
            await browser.disconnect();
        }
        // Don't close Chrome - other climbs may be using it
    }
}

main().catch(console.error);
