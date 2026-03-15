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

// Configuration
const INTERACTIVE = process.env.FAMILYSEARCH_INTERACTIVE === 'true';
const MAX_GENERATIONS = 50; // Increased - we use birth year cutoff instead
const HISTORICAL_CUTOFF_YEAR = 1450; // Start of transatlantic slave trade
const PERSON_PAGE_URL = 'https://www.familysearch.org/en/tree/person/details/';
const SAVE_PROGRESS_EVERY = 10; // Save to DB every N ancestors

let browser = null;
let page = null;

// Session state (can be restored for resume)
let sessionId = null;
let visited = new Set();
let ancestors = [];
let allMatches = []; // NEW: Store ALL matches, not just first
let failedExtractions = []; // Track failed profiles for diagnostics

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

        // Kill existing Chrome instances that use our temp profile (not user's regular Chrome)
        try {
            execSync(`pkill -9 -f "familysearch-ancestor-climber"`, { stdio: 'ignore' });
        } catch (e) {}

        await new Promise(r => setTimeout(r, 2000));

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
            // Helpful on some Pi setups
            '--password-store=basic',
            'about:blank'
        ];

        const chromeProcess = spawn(executable, chromeArgs, { detached: true, stdio: 'ignore' });

        chromeProcess.unref();

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

    const pages = await browser.pages();
    page = pages[0] || await browser.newPage();
}

/**
 * Ensure logged into FamilySearch
 */
async function ensureLoggedIn(startFsId) {
    // Navigate to starting person's page
    const url = PERSON_PAGE_URL + startFsId;
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
            if (navUrl.includes('/tree/person/details/')) {
                break;
            }
            attempts++;
        }

        // Save cookies
        const cookies = await page.cookies();
        fs.writeFileSync('./fs-climber-cookies.json', JSON.stringify(cookies, null, 2));
        console.log(`Saved ${cookies.length} cookies\n`);
    }

    // Wait for the React app to actually render the person data
    console.log('Waiting for person page to fully render...');
    try {
        await page.waitForFunction(() => {
            const title = document.title;
            // Title should contain a person name pattern like "Name (year" or "Name (Deceased"
            return title.match(/^[A-Z].*\((\d{4}|Deceased|Living)/) !== null;
        }, { timeout: 15000 });
        console.log(`Page rendered: ${await page.title()}`);
    } catch (e) {
        // Fallback: wait extra time for SPA to load
        console.log('Page title not in expected format, waiting extra time...');
        await new Promise(r => setTimeout(r, 5000));
    }

    console.log('✓ Logged in and ready to climb ancestors\n');
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

    const personLocations = person.locations || [];
    const personBirthYear = person.birth_year;

    // Helper: Check if birth years overlap (within 15-year window)
    const birthYearsOverlap = (dbYear) => {
        if (!personBirthYear || !dbYear) return null; // Unknown = can't verify
        return Math.abs(personBirthYear - dbYear) <= 15;
    };

    // Helper: Check if locations overlap
    const locationsOverlap = (dbState, dbCounty) => {
        if (personLocations.length === 0) return null; // Unknown = can't verify
        if (!dbState && !dbCounty) return null;

        return personLocations.some(loc => {
            const locLower = loc.toLowerCase();
            if (dbState && (locLower.includes(dbState.toLowerCase()) || dbState.toLowerCase().includes(locLower))) {
                return true;
            }
            if (dbCounty && (locLower.includes(dbCounty.toLowerCase()) || dbCounty.toLowerCase().includes(locLower))) {
                return true;
            }
            return false;
        });
    };

    // Check by FS ID first (strongest match - same person confirmed)
    if (person.fs_id) {
        const fsMatch = await sql`
            SELECT id, canonical_name, person_type, notes, primary_state, primary_county, birth_year_estimate
            FROM canonical_persons
            WHERE notes::text LIKE ${'%"familysearch_id":"' + person.fs_id + '"%'}
            AND person_type IN ('enslaver', 'slaveholder', 'owner')
            LIMIT 1
        `;
        if (fsMatch.length > 0) {
            return {
                type: 'exact_fs_match',
                confidence: 0.99,
                verified: false, // Still needs document review
                verification_notes: 'FamilySearch ID match - high confidence but needs document verification',
                ...fsMatch[0]
            };
        }
    }

    // Check by EXACT name match with strict date + location requirements
    const exactMatch = await sql`
        SELECT id, canonical_name, person_type, birth_year_estimate, primary_state, primary_county
        FROM canonical_persons
        WHERE person_type IN ('enslaver', 'slaveholder', 'owner')
        AND canonical_name = ${person.name}
        LIMIT 5
    `;

    if (exactMatch.length > 0) {
        for (const match of exactMatch) {
            const dateMatch = birthYearsOverlap(match.birth_year_estimate);
            const locationMatch = locationsOverlap(match.primary_state, match.primary_county);

            // Build verification notes
            const notes = [];
            if (dateMatch === true) notes.push('birth year matches');
            else if (dateMatch === false) notes.push('BIRTH YEAR MISMATCH');
            else notes.push('birth year unknown');

            if (locationMatch === true) notes.push('location matches');
            else if (locationMatch === false) notes.push('LOCATION MISMATCH');
            else notes.push('location unknown');

            // Skip if we have a definite mismatch
            if (dateMatch === false || locationMatch === false) {
                continue; // This is a different person with same name
            }

            // Calculate confidence based on what we can verify
            let confidence = 0.50; // Base: name only
            if (locationMatch === true) confidence += 0.25;
            if (dateMatch === true) confidence += 0.15;

            return {
                type: locationMatch === true ? 'exact_name_location_match' : 'exact_name_match',
                confidence,
                verified: false,
                verification_notes: `Name match. ${notes.join(', ')}. REQUIRES DOCUMENT REVIEW.`,
                date_verified: dateMatch === true,
                location_verified: locationMatch === true,
                ...match
            };
        }
    }

    // Check canonical with full name (case insensitive)
    const nameMatch = await sql`
        SELECT id, canonical_name, person_type, birth_year_estimate, primary_state, primary_county
        FROM canonical_persons
        WHERE person_type IN ('enslaver', 'slaveholder', 'owner')
        AND LOWER(canonical_name) = LOWER(${person.name})
        LIMIT 5
    `;

    if (nameMatch.length > 0) {
        for (const match of nameMatch) {
            const dateMatch = birthYearsOverlap(match.birth_year_estimate);
            const locationMatch = locationsOverlap(match.primary_state, match.primary_county);

            // Skip definite mismatches
            if (dateMatch === false || locationMatch === false) {
                continue;
            }

            let confidence = 0.45;
            if (locationMatch === true) confidence += 0.25;
            if (dateMatch === true) confidence += 0.15;

            return {
                type: locationMatch === true ? 'name_location_match' : 'name_match',
                confidence,
                verified: false,
                verification_notes: 'Case-insensitive name match. REQUIRES DOCUMENT REVIEW.',
                date_verified: dateMatch === true,
                location_verified: locationMatch === true,
                ...match
            };
        }
    }

    // Only check unconfirmed if name has 3+ words (very specific names only)
    if (nameParts.length >= 3) {
        const ownerMatch = await sql`
            SELECT lead_id as id, full_name, person_type, locations, source_url
            FROM unconfirmed_persons
            WHERE person_type IN ('owner', 'slaveholder')
            AND LOWER(full_name) = LOWER(${person.name})
            LIMIT 5
        `;

        if (ownerMatch.length > 0) {
            for (const match of ownerMatch) {
                const matchLocs = match.locations || [];

                // Check for location overlap
                let locationMatch = null;
                if (personLocations.length > 0 && matchLocs.length > 0) {
                    locationMatch = personLocations.some(loc =>
                        matchLocs.some(ml =>
                            ml.toLowerCase().includes(loc.toLowerCase()) ||
                            loc.toLowerCase().includes(ml.toLowerCase())
                        )
                    );
                }

                // Skip definite mismatches
                if (locationMatch === false) continue;

                let confidence = 0.40;
                if (locationMatch === true) confidence += 0.20;
                if (match.source_url) confidence += 0.10; // Has document link

                return {
                    type: locationMatch === true ? 'unconfirmed_owner_location_match' : 'unconfirmed_owner',
                    confidence,
                    verified: false,
                    verification_notes: `Unconfirmed record. Source: ${match.source_url || 'unknown'}. REQUIRES MANUAL VERIFICATION.`,
                    location_verified: locationMatch === true,
                    has_source_url: !!match.source_url,
                    ...match
                };
            }
        }
    }

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
                ${modernPersonFsId},
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
 * Save match to normalized matches table
 */
async function saveMatch(sessionId, modernPerson, match) {
    try {
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
                classification_reason
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
                ${match.classification?.classification || 'debt'},
                ${match.classification?.reason || 'Unknown'}
            )
        `;
    } catch (e) {
        console.log(`   ⚠ Could not save match: ${e.message}`);
    }
}

/**
 * BFS climb through ancestors - finds ALL slaveholder matches
 */
async function climbAncestors(startFsId, startName = null, resumeSession = null) {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('   FAMILYSEARCH ANCESTOR CLIMBER v2');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`Starting Person: ${startFsId}`);
    console.log(`Mode: Find ALL slaveholder connections`);
    console.log(`Historical Cutoff: ${HISTORICAL_CUTOFF_YEAR}`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    // Initialize or restore session state
    let queue, localVisited, localMatches;

    if (resumeSession) {
        console.log(`Resuming session ${resumeSession.sessionId}...`);
        queue = resumeSession.queue;
        localVisited = resumeSession.visited;
        localMatches = resumeSession.matches;
    } else {
        queue = [[startFsId, 0, []]];
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

    // Main BFS loop - NO LONGER STOPS AT FIRST MATCH
    while (queue.length > 0) {
        const [fsId, generation, path] = queue.shift();

        if (localVisited.has(fsId)) continue;
        if (generation > MAX_GENERATIONS) continue;

        localVisited.add(fsId);

        // Navigate to person's page
        const url = PERSON_PAGE_URL + fsId;
        console.log(`\n📍 Gen ${generation}: Visiting ${fsId} (queue: ${queue.length}, matches: ${localMatches.length})`);

        try {
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
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
                    await page.goto(PERSON_PAGE_URL + fsId, { waitUntil: 'networkidle2', timeout: 30000 });
                    await new Promise(r => setTimeout(r, 2000));
                    currentUrl = page.url();

                    // If STILL redirected, it means FS doesn't have details for this person
                    // or user preference forces portrait view - try to parse what we have
                    if (!currentUrl.includes('/tree/person/details/')) {
                        console.log(`   [Debug] Still on ${currentUrl.split('?')[0]}, will parse current view`);
                    }
                }
            }

            // Wait for React app to render the person name in the title
            try {
                await page.waitForFunction(() => {
                    const title = document.title;
                    return title.match(/^[A-Z].*\((\d{4}|Deceased|Living)/) !== null;
                }, { timeout: 8000 });
            } catch (e) {
                // Title may not match pattern for some ancestors - that's OK
                // Just wait a bit more for content to load
                await new Promise(r => setTimeout(r, 2000));
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
                console.log('   ⚠ No parents found, capturing diagnostics...');
                const diagnostic = await captureFailedExtraction(fsId, generation, page, 'no_parents');
                console.log(`   📁 Debug saved: ${diagnostic.folder}/${fsId}-gen${generation}-no_parents.*`);
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
                    console.log(`\n   🎯 POTENTIAL MATCH #${localMatches.length + 1}: ${enslaverMatch.canonical_name || enslaverMatch.full_name}`);
                    console.log(`   Match type: ${enslaverMatch.type} (confidence: ${(enslaverMatch.confidence * 100).toFixed(0)}%)`);

                    // Show verification details
                    const checks = [];
                    if (enslaverMatch.location_verified) checks.push('✓ location');
                    else checks.push('? location');
                    if (enslaverMatch.date_verified) checks.push('✓ dates');
                    else checks.push('? dates');
                    console.log(`   Verified: ${checks.join(', ')}`);

                    // NEW: Check for supporting documents
                    console.log(`   🔍 Checking for documents...`);
                    const docVerification = await documentVerifier.verifyMatch(
                        enslaverMatch.canonical_name || enslaverMatch.full_name,
                        modernPerson?.name || person.name,
                        [...path, person.name]
                    );

                    if (docVerification.hasDocuments) {
                        console.log(`   📄 Found ${docVerification.documentCount} document(s): ${docVerification.documentTypes.join(', ')}`);
                        console.log(`   📊 Verification level: ${docVerification.verificationLevel.toUpperCase()}`);
                        if (docVerification.enslavedPersonsDocumented.length > 0) {
                            console.log(`   👥 ${docVerification.enslavedPersonsDocumented.length} enslaved person(s) documented`);
                        }
                    } else {
                        console.log(`   ⚠️  No documents found - requires research`);
                    }

                    // Classification disabled - requires document verification
                    const classification = await classifyLineage([...path, person.name], person);
                    
                    // Update status based on document verification
                    let status = 'UNVERIFIED - requires document review';
                    if (docVerification.verificationLevel === 'documented') {
                        status = 'DOCUMENTED - has primary source evidence';
                    } else if (docVerification.verificationLevel === 'partial') {
                        status = 'PARTIAL - has documents but needs full verification';
                    }
                    console.log(`   Status: ${status}`);

                    const matchRecord = {
                        person,
                        match: enslaverMatch,
                        generation,
                        path: [...path, person.name],
                        classification,
                        documentVerification: docVerification // NEW: Include doc verification
                    };

                    localMatches.push(matchRecord);
                    allMatches.push(matchRecord); // Also update global

                    // Save match to DB
                    if (sessionId && modernPerson) {
                        await saveMatch(sessionId, modernPerson, matchRecord);
                    }

                    // DON'T BREAK - continue climbing to find more matches!
                    console.log(`   ✓ Match recorded, continuing climb...`);
                }
            } catch (dbErr) {
                console.log(`   ⚠ DB check error: ${dbErr.message.substring(0, 50)}`);
            }

            // Queue parents (BOTH sides)
            if (person.father_fs_id && !localVisited.has(person.father_fs_id)) {
                queue.push([person.father_fs_id, generation + 1, [...path, person.name]]);
            }
            if (person.mother_fs_id && !localVisited.has(person.mother_fs_id)) {
                queue.push([person.mother_fs_id, generation + 1, [...path, person.name]]);
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

    const startFsId = args.find(a => /^[A-Z0-9]{4}-[A-Z0-9]{2,4}$/.test(a));

    if (!startFsId && !resumeSessionId) {
        console.error('Error: Must provide either a FamilySearch ID or --resume <session_id>');
        process.exit(1);
    }

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

        } else {
            // New climb
            await ensureLoggedIn(startFsId);
            result = await climbAncestors(startFsId, personName);
            await saveResults(startFsId, result);
        }

    } catch (e) {
        console.error('Fatal error:', e.message);
        console.error(e.stack);
    } finally {
        if (browser) {
            await browser.disconnect();
        }
        // Don't close Chrome - let user keep it open
    }
}

main().catch(console.error);
