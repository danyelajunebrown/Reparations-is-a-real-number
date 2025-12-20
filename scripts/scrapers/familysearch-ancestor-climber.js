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

puppeteer.use(StealthPlugin());

const sql = neon(process.env.DATABASE_URL);

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

    // Kill existing Chrome
    try {
        execSync('pkill -9 -f "Google Chrome"', { stdio: 'ignore' });
    } catch (e) {}

    await new Promise(r => setTimeout(r, 2000));

    // Create temp profile
    const tempProfileDir = '/tmp/familysearch-ancestor-climber';
    if (!fs.existsSync(tempProfileDir)) {
        fs.mkdirSync(tempProfileDir, { recursive: true });
    }

    // Launch Chrome with remote debugging
    const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
        '--remote-debugging-port=9222',
        `--user-data-dir=${tempProfileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=1200,900',
        'about:blank'
    ], { detached: true, stdio: 'ignore' });

    chromeProcess.unref();

    // Wait for Chrome to start
    console.log('Waiting for Chrome to initialize...');
    await new Promise(r => setTimeout(r, 4000));

    // Connect Puppeteer
    let connected = false;
    for (let i = 0; i < 10; i++) {
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
            const url = page.url();
            if (url.includes('/tree/person/details/')) {
                break;
            }
            attempts++;
        }

        // Save cookies
        const cookies = await page.cookies();
        fs.writeFileSync('./fs-climber-cookies.json', JSON.stringify(cookies, null, 2));
        console.log(`Saved ${cookies.length} cookies\n`);
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
        // Format: "Danyele Brown (1996–Living) • Person • Family Tree"
        const titleMatch = document.title.match(/^([^(]+)\s*\((\d{4})/);
        if (titleMatch) {
            result.name = titleMatch[1].trim();
            result.birth_year = parseInt(titleMatch[2]);
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

        // METHOD 2: If title didn't work, try the page content
        if (!result.name) {
            // Look for the person info area - usually has name in prominent position
            // allText already declared above

            // The FS ID appears after the name with format "• G21N-HD2"
            const nameIdMatch = allText.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*\n[^•]*•\s*([A-Z0-9]{4}-[A-Z0-9]{2,4})/);
            if (nameIdMatch && nameIdMatch[2] === result.fs_id) {
                result.name = nameIdMatch[1].trim();
            }
        }

        // PARENT EXTRACTION - allText already declared above

        // PARENT EXTRACTION - Multiple methods

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
                    const idMatch = entry.match(/([A-Z0-9]{4}-[A-Z0-9]{2,4})/);
                    if (idMatch && idMatch[1] !== result.fs_id && !result.parents.includes(idMatch[1])) {
                        result.parents.push(idMatch[1]);
                    }
                }
                result.parents = result.parents.slice(0, 2);
            }
        }

        // Assign to father/mother slots
        if (result.parents.length >= 1) result.father_fs_id = result.parents[0];
        if (result.parents.length >= 2) result.mother_fs_id = result.parents[1];

        result.raw = {
            url: window.location.href,
            title: document.title,
            parentsFound: result.parents.length,
            allParentIds: result.parents
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

            // IMPORTANT: Scroll down to load Family Members section
            await page.evaluate(() => {
                window.scrollTo(0, 500);
            });
            await new Promise(r => setTimeout(r, 1000));

            // Scroll more to ensure section loads
            await page.evaluate(() => {
                window.scrollTo(0, 1000);
            });
            await new Promise(r => setTimeout(r, 1000));

            // Click "Details" tab if exists to ensure we're on right view
            try {
                await page.evaluate(() => {
                    const detailsTab = [...document.querySelectorAll('button, a')].find(
                        el => el.textContent.trim() === 'Details'
                    );
                    if (detailsTab) detailsTab.click();
                });
                await new Promise(r => setTimeout(r, 1000));
            } catch (e) {}

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
                console.log('   ⚠ Could not extract name, skipping');
                continue;
            }

            const years = person.birth_year
                ? (person.death_year ? `${person.birth_year}-${person.death_year}` : `${person.birth_year}-`)
                : '?';

            console.log(`   Name: ${person.name} (${years})`);
            console.log(`   Locations: ${person.locations?.join(', ') || 'none found'}`);
            console.log(`   Father: ${person.father_fs_id || 'not found'}`);
            console.log(`   Mother: ${person.mother_fs_id || 'not found'}`);

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

                    // Classification disabled - requires document verification
                    const classification = await classifyLineage([...path, person.name], person);
                    console.log(`   Status: UNVERIFIED - requires document review`);

                    const matchRecord = {
                        person,
                        match: enslaverMatch,
                        generation,
                        path: [...path, person.name],
                        classification
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
