/**
 * FamilySearch Ancestor Climber
 *
 * Simple, stable scraper that climbs UP through ancestors using person details pages.
 * Uses the stable URL pattern: /tree/person/details/{FS_ID}
 *
 * ALGORITHM:
 * 1. Start with user's FamilySearch ID
 * 2. Go to their person details page
 * 3. Extract: name, dates, father_fs_id, mother_fs_id
 * 4. Check if person matches our enslaver database
 * 5. If no match, queue BOTH parents for processing
 * 6. Repeat BFS until enslaver found or tree exhausted
 *
 * Usage:
 *   FAMILYSEARCH_INTERACTIVE=true node scripts/scrapers/familysearch-ancestor-climber.js G21N-HD2
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
const MAX_GENERATIONS = 15;
const PERSON_PAGE_URL = 'https://www.familysearch.org/en/tree/person/details/';

let browser = null;
let page = null;

// Track visited to avoid cycles
const visited = new Set();
const ancestors = [];

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

        // METHOD 2: If title didn't work, try the page content
        if (!result.name) {
            // Look for the person info area - usually has name in prominent position
            const allText = document.body.innerText;

            // The FS ID appears after the name with format "• G21N-HD2"
            const nameIdMatch = allText.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*\n[^•]*•\s*([A-Z0-9]{4}-[A-Z0-9]{2,4})/);
            if (nameIdMatch && nameIdMatch[2] === result.fs_id) {
                result.name = nameIdMatch[1].trim();
            }
        }

        // Get page text for parent extraction
        const allText = document.body.innerText;

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
 * IMPORTANT: Requires strong matches to avoid false positives on generic names
 */
async function checkEnslaverDatabase(person) {
    if (!person.name) return null;

    // Skip generic single-word names that cause false positives
    const nameParts = person.name.trim().split(/\s+/);
    if (nameParts.length < 2 || person.name.length < 5) {
        return null; // Skip "Ann", "John", etc.
    }

    // Check by FS ID first (strongest match)
    if (person.fs_id) {
        const fsMatch = await sql`
            SELECT canonical_name, person_type, notes
            FROM canonical_persons
            WHERE notes::text LIKE ${'%"familysearch_id":"' + person.fs_id + '"%'}
            AND person_type IN ('enslaver', 'slaveholder', 'owner')
            LIMIT 1
        `;
        if (fsMatch.length > 0) {
            return { type: 'exact_fs_match', confidence: 0.99, ...fsMatch[0] };
        }
    }

    // Check by EXACT name match with birth year validation
    const exactMatch = await sql`
        SELECT canonical_name, person_type, birth_year_estimate
        FROM canonical_persons
        WHERE person_type IN ('enslaver', 'slaveholder', 'owner')
        AND canonical_name = ${person.name}
        AND (birth_year_estimate IS NULL OR birth_year_estimate BETWEEN ${(person.birth_year || 1800) - 10} AND ${(person.birth_year || 1900) + 10})
        LIMIT 1
    `;
    if (exactMatch.length > 0) {
        return { type: 'exact_name_match', confidence: 0.85, ...exactMatch[0] };
    }

    // Check canonical with full name (case insensitive but full match)
    const nameMatch = await sql`
        SELECT canonical_name, person_type, birth_year_estimate
        FROM canonical_persons
        WHERE person_type IN ('enslaver', 'slaveholder', 'owner')
        AND LOWER(canonical_name) = LOWER(${person.name})
        LIMIT 1
    `;
    if (nameMatch.length > 0) {
        return { type: 'name_match', confidence: 0.75, ...nameMatch[0] };
    }

    // Only check unconfirmed if name has 3+ words (very specific)
    if (nameParts.length >= 3) {
        const ownerMatch = await sql`
            SELECT full_name, person_type
            FROM unconfirmed_persons
            WHERE person_type IN ('owner', 'slaveholder')
            AND LOWER(full_name) = LOWER(${person.name})
            LIMIT 1
        `;
        if (ownerMatch.length > 0) {
            return { type: 'unconfirmed_owner', confidence: 0.6, ...ownerMatch[0] };
        }
    }

    return null;
}

/**
 * BFS climb through ancestors
 */
async function climbAncestors(startFsId, targetEnslaver = null) {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('   FAMILYSEARCH ANCESTOR CLIMBER');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`Starting Person: ${startFsId}`);
    console.log(`Target: ${targetEnslaver || 'Any enslaver in database'}`);
    console.log(`Max Generations: ${MAX_GENERATIONS}`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    // BFS queue: [fs_id, generation, path]
    const queue = [[startFsId, 0, []]];
    let enslaverFound = null;

    while (queue.length > 0 && !enslaverFound) {
        const [fsId, generation, path] = queue.shift();

        if (visited.has(fsId)) continue;
        if (generation > MAX_GENERATIONS) continue;

        visited.add(fsId);

        // Navigate to person's page
        const url = PERSON_PAGE_URL + fsId;
        console.log(`\n📍 Gen ${generation}: Visiting ${fsId}`);

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
            console.log(`   Father: ${person.father_fs_id || 'not found'}`);
            console.log(`   Mother: ${person.mother_fs_id || 'not found'}`);

            // Store ancestor
            ancestors.push({
                ...person,
                generation,
                path: [...path, person.name]
            });

            // Check enslaver database
            const enslaverMatch = await checkEnslaverDatabase(person);

            if (enslaverMatch) {
                console.log(`\n   🎯 ENSLAVER MATCH: ${enslaverMatch.canonical_name || enslaverMatch.full_name}`);
                console.log(`   Match type: ${enslaverMatch.type}`);
                enslaverFound = {
                    person,
                    match: enslaverMatch,
                    generation,
                    path: [...path, person.name]
                };
                break;
            }

            // Queue parents (BOTH sides - we don't know which line leads to enslaver)
            if (person.father_fs_id && !visited.has(person.father_fs_id)) {
                queue.push([person.father_fs_id, generation + 1, [...path, person.name]]);
            }
            if (person.mother_fs_id && !visited.has(person.mother_fs_id)) {
                queue.push([person.mother_fs_id, generation + 1, [...path, person.name]]);
            }

            // Rate limiting
            await new Promise(r => setTimeout(r, 1500));

        } catch (e) {
            console.log(`   ⚠ Error: ${e.message}`);
        }
    }

    return enslaverFound;
}

/**
 * Save results to database
 */
async function saveResults(startFsId, enslaverFound) {
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('   RESULTS');
    console.log('═══════════════════════════════════════════════════════════════\n');

    console.log(`Ancestors scraped: ${ancestors.length}`);
    console.log(`Generations climbed: ${Math.max(...ancestors.map(a => a.generation))}`);

    if (enslaverFound) {
        console.log(`\n✓ ENSLAVER CONNECTION FOUND!`);
        console.log(`  Enslaver: ${enslaverFound.match.canonical_name || enslaverFound.match.full_name}`);
        console.log(`  Generations removed: ${enslaverFound.generation}`);
        console.log(`  Path: ${enslaverFound.path.join(' → ')}`);
    } else {
        console.log('\n○ No enslaver connection found in database');
        console.log('  (May need to expand enslaver database or WikiTree buildout)');
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
                    'ancestor_climber',
                    ${JSON.stringify({
                        familysearch_id: ancestor.fs_id,
                        father_fs_id: ancestor.father_fs_id,
                        mother_fs_id: ancestor.mother_fs_id,
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
FamilySearch Ancestor Climber

Usage:
  FAMILYSEARCH_INTERACTIVE=true node scripts/scrapers/familysearch-ancestor-climber.js <FS_ID>

Example:
  FAMILYSEARCH_INTERACTIVE=true node scripts/scrapers/familysearch-ancestor-climber.js G21N-HD2

Options:
  --target <enslaver_name>  Stop when specific enslaver found
  --max-gen <n>             Maximum generations to climb (default: 15)

This scraper:
1. Starts at the given person's FamilySearch page
2. Extracts name, dates, and parent links
3. Checks each ancestor against our enslaver database
4. Climbs BOTH parent lines (father and mother)
5. Stops when enslaver found or max generations reached
`);
        return;
    }

    const startFsId = args.find(a => /^[A-Z0-9]{4}-[A-Z0-9]{2,4}$/.test(a)) || args[0];

    try {
        await launchBrowser();
        await ensureLoggedIn(startFsId);

        const enslaverFound = await climbAncestors(startFsId);

        await saveResults(startFsId, enslaverFound);

    } catch (e) {
        console.error('Fatal error:', e.message);
    } finally {
        if (browser) {
            await browser.disconnect();
        }
        // Don't close Chrome - let user keep it open
    }
}

main().catch(console.error);
