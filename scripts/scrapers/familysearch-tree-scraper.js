/**
 * FamilySearch Personal Tree Scraper
 *
 * Scrapes a user's personal family tree via Puppeteer with authenticated session.
 * This bridges the genealogy gap between historical records (WikiTree) and living descendants.
 *
 * Model Case: Danyela June Brown → James Hopewell (1792-1817)
 *
 * Usage:
 *   FAMILYSEARCH_INTERACTIVE=true node scripts/scrapers/familysearch-tree-scraper.js <your_person_id> [target_ancestor_id]
 *
 * Example:
 *   FAMILYSEARCH_INTERACTIVE=true node scripts/scrapers/familysearch-tree-scraper.js G21N-HD2
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

puppeteer.use(StealthPlugin());

// Configuration
const FAMILYSEARCH_INTERACTIVE = process.env.FAMILYSEARCH_INTERACTIVE === 'true';
const DATABASE_URL = process.env.DATABASE_URL;
const MAX_GENERATIONS = parseInt(process.env.MAX_GENERATIONS || '12');
const RATE_LIMIT_MS = parseInt(process.env.RATE_LIMIT_MS || '3000');
const COOKIE_FILE = path.join(__dirname, '../../fs-cookies.json');

// Database
let sql = null;

function initDatabase() {
    if (!DATABASE_URL) {
        console.log('WARNING: No DATABASE_URL - running in dry-run mode');
        return null;
    }
    sql = neon(DATABASE_URL);
    return sql;
}

// Statistics
const stats = {
    personsScraped: 0,
    relationshipsFound: 0,
    errors: 0,
    startTime: Date.now()
};

// --- UTILITIES ---

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function loadCookies() {
    try {
        if (fs.existsSync(COOKIE_FILE)) {
            return JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
        }
    } catch (e) {
        console.log('No existing cookies found');
    }
    return [];
}

function saveCookies(cookies) {
    fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
    console.log(`Saved ${cookies.length} cookies`);
}

// --- BROWSER SETUP ---

async function launchBrowser() {
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║         LAUNCHING CHROME FOR FAMILYSEARCH                  ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log('║  A Chrome window will open.                                ║');
    console.log('║  You can sign in with Google - it will work!               ║');
    console.log('║  After login, the scraper will start automatically.        ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');

    // Kill any existing Chrome processes
    console.log('Closing any existing Chrome windows...');
    try {
        execSync('pkill -9 -f "Google Chrome"', { stdio: 'ignore' });
        await sleep(3000);
    } catch (e) {
        // Chrome might not be running
    }

    // Create temp profile directory
    const tempProfileDir = '/tmp/familysearch-chrome-profile';
    if (!fs.existsSync(tempProfileDir)) {
        fs.mkdirSync(tempProfileDir, { recursive: true });
    }

    console.log('Launching Chrome with remote debugging...');

    // Spawn Chrome
    const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
        '--remote-debugging-port=9222',
        `--user-data-dir=${tempProfileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=1400,900',
        '--disable-features=TranslateUI',
        'about:blank'
    ], {
        detached: true,
        stdio: 'ignore'
    });
    chromeProcess.unref();

    console.log('Waiting for Chrome to initialize...');
    await sleep(5000);

    // Connect Puppeteer
    let browser;
    for (let i = 0; i < 5; i++) {
        try {
            console.log(`Connecting to Chrome (attempt ${i + 1})...`);
            browser = await puppeteer.connect({
                browserURL: 'http://127.0.0.1:9222',
                defaultViewport: null
            });
            break;
        } catch (e) {
            if (i === 4) throw e;
            await sleep(2000);
        }
    }

    let pages = await browser.pages();
    let page = pages[0] || await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });

    console.log('Connected to Chrome successfully!\n');
    return { browser, page };
}

async function ensureLoggedIn(page, startPersonId) {
    const treeUrl = `https://www.familysearch.org/tree/person/details/${startPersonId}`;
    console.log(`Navigating to: ${treeUrl}`);

    await page.goto(treeUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    const currentUrl = page.url();
    if (currentUrl.includes('ident.familysearch') || currentUrl.includes('/auth/') || currentUrl.includes('signin')) {
        if (!FAMILYSEARCH_INTERACTIVE) {
            throw new Error('Login required but not in interactive mode. Run with FAMILYSEARCH_INTERACTIVE=true');
        }

        console.log('\n╔════════════════════════════════════════════════════════════╗');
        console.log('║              MANUAL LOGIN REQUIRED                         ║');
        console.log('╠════════════════════════════════════════════════════════════╣');
        console.log('║  1. Log in with FamilySearch or Google                     ║');
        console.log('║  2. If prompted to SELECT A PROFILE, pick yours            ║');
        console.log('║  3. Wait until you see your tree/profile page              ║');
        console.log('╚════════════════════════════════════════════════════════════╝\n');

        const startWait = Date.now();
        const timeoutMs = 600000; // 10 minutes

        while (Date.now() - startWait < timeoutMs) {
            const url = page.url();
            if (url.includes('/tree/person/') || url.includes('/tree/pedigree/') || url.includes('/tree/fan')) {
                await sleep(3000);
                break;
            }
            await sleep(2000);

            const elapsed = Math.round((Date.now() - startWait) / 1000);
            if (elapsed % 30 === 0 && elapsed > 0) {
                console.log(`   Waiting for login... (${Math.round((timeoutMs - (Date.now() - startWait)) / 60000)} min remaining)`);
            }
        }

        const finalUrl = page.url();
        if (!finalUrl.includes('/tree/')) {
            throw new Error('Login timed out after 10 minutes');
        }

        const newCookies = await page.cookies();
        saveCookies(newCookies);
        console.log('\n✓ Login successful! Cookies saved.\n');

        // Navigate to the specific person
        console.log(`Navigating to profile: ${startPersonId}...\n`);
        await page.goto(`https://www.familysearch.org/tree/person/details/${startPersonId}`, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        await sleep(2000);
    } else {
        console.log('Already logged in!');
    }

    return true;
}

// --- DATA EXTRACTION ---

async function extractPersonData(page, personId, generation) {
    console.log(`\n📍 Extracting: ${personId} (Generation ${generation})`);

    // Wait for page to load
    try {
        await page.waitForNetworkIdle({ idleTime: 500, timeout: 15000 });
    } catch (e) {
        // Continue
    }

    await sleep(3000);

    // Debug: check current URL and page title
    const currentUrl = page.url();
    const pageTitle = await page.title();
    console.log(`   URL: ${currentUrl}`);
    console.log(`   Title: ${pageTitle}`);

    // Debug: get h1 content
    const h1Content = await page.evaluate(() => {
        const h1 = document.querySelector('h1');
        return h1 ? h1.textContent : 'NO H1 FOUND';
    });
    console.log(`   H1: ${h1Content.substring(0, 50)}...`);

    const person = await page.evaluate((expectedId) => {
        const data = {
            familysearch_id: expectedId,
            full_name: null,
            given_name: null,
            surname: null,
            gender: null,
            birth_date: null,
            death_date: null,
            father_id: null,
            mother_id: null,
            spouse_ids: [],
            child_ids: []
        };

        // Extract ID from URL
        const urlMatch = window.location.pathname.match(/\/([A-Z0-9]{4}-[A-Z0-9]{2,4})(?:\/|$)/i);
        if (urlMatch) data.familysearch_id = urlMatch[1].toUpperCase();

        // Extract name from h1 (clean up extra text)
        const h1 = document.querySelector('h1');
        if (h1) {
            let nameText = h1.textContent.trim();
            // Remove trailing info (dates, sex, ID)
            nameText = nameText.split('Unknown')[0];
            nameText = nameText.split('Male')[0];
            nameText = nameText.split('Female')[0];
            nameText = nameText.split(/\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i)[0];
            nameText = nameText.split('•')[0];
            nameText = nameText.replace(/\s+/g, ' ').trim();
            if (nameText && nameText.length > 1) {
                data.full_name = nameText;
                const parts = nameText.split(' ');
                data.given_name = parts[0];
                data.surname = parts.slice(1).join(' ');
            }
        }

        // Extract birth/death from page text
        const pageText = document.body.innerText || '';
        const birthMatch = pageText.match(/(?:Birth|Born)[:\s]*(?:(\d{1,2}\s+\w+\s+)?(\d{4}))/i);
        if (birthMatch) data.birth_date = birthMatch[2] || birthMatch[1];

        const deathMatch = pageText.match(/(?:Death|Died)[:\s]*(?:(\d{1,2}\s+\w+\s+)?(\d{4}))/i);
        if (deathMatch) data.death_date = deathMatch[2] || deathMatch[1];

        // Look for FAMILY MEMBERS section with labeled relationships
        // FamilySearch details page has sections like "Parents", "Spouse and Children"
        const allText = document.body.innerHTML.toLowerCase();

        // Find all person links
        const links = document.querySelectorAll('a[href*="/tree/person/"]');
        const linksByContext = [];

        links.forEach(link => {
            const href = link.getAttribute('href') || '';
            const idMatch = href.match(/\/tree\/person\/(?:details\/)?([A-Z0-9]{4}-[A-Z0-9]{2,4})/i);
            if (!idMatch || idMatch[1].toUpperCase() === data.familysearch_id) return;

            const foundId = idMatch[1].toUpperCase();

            // Get context from surrounding elements
            let context = '';
            let el = link;
            for (let i = 0; i < 10 && el; i++) {
                const text = el.textContent?.toLowerCase() || '';
                context = text + ' ' + context;
                el = el.parentElement;
            }

            // Also check aria labels and nearby headers
            const ariaLabel = (link.getAttribute('aria-label') || '').toLowerCase();
            context += ' ' + ariaLabel;

            // Look for section headers
            const section = link.closest('section, [role="region"], .family-section, div[class*="family"]');
            if (section) {
                const header = section.querySelector('h2, h3, h4, [role="heading"]');
                if (header) {
                    context = (header.textContent?.toLowerCase() || '') + ' ' + context;
                }
            }

            linksByContext.push({ id: foundId, context });
        });

        // Store debug info
        data._debugLinks = linksByContext.slice(0, 10).map(({ id, context }) => ({
            id,
            context: context.substring(0, 150)
        }));

        // Categorize by relationship
        linksByContext.forEach(({ id, context }) => {
            // Check for explicit parent indicators
            if (context.includes('parent') && (context.includes('father') || context.match(/\bfather\b/))) {
                if (!data.father_id) data.father_id = id;
            } else if (context.includes('parent') && (context.includes('mother') || context.match(/\bmother\b/))) {
                if (!data.mother_id) data.mother_id = id;
            } else if (context.match(/\bfather\b/) && !context.includes('grandfather')) {
                if (!data.father_id) data.father_id = id;
            } else if (context.match(/\bmother\b/) && !context.includes('grandmother')) {
                if (!data.mother_id) data.mother_id = id;
            } else if (context.includes('spouse') || context.includes('wife') || context.includes('husband')) {
                if (!data.spouse_ids.includes(id)) data.spouse_ids.push(id);
            } else if (context.includes('child') || context.includes('son') || context.includes('daughter')) {
                if (!data.child_ids.includes(id)) data.child_ids.push(id);
            }
        });

        // If still no parents, look for "Parents" section specifically
        if (!data.father_id || !data.mother_id) {
            const sections = document.querySelectorAll('section, div[class*="family"], [data-testid*="family"]');
            sections.forEach(section => {
                const sectionText = section.textContent?.toLowerCase() || '';
                // Only look at sections that mention "parents" but NOT "spouse" or "children"
                if (sectionText.includes('parent') && !sectionText.includes('spouse') && !sectionText.includes('child')) {
                    const sectionLinks = section.querySelectorAll('a[href*="/tree/person/"]');
                    let idx = 0;
                    sectionLinks.forEach(link => {
                        const href = link.getAttribute('href') || '';
                        const idMatch = href.match(/\/tree\/person\/(?:details\/)?([A-Z0-9]{4}-[A-Z0-9]{2,4})/i);
                        if (idMatch && idMatch[1].toUpperCase() !== data.familysearch_id) {
                            const foundId = idMatch[1].toUpperCase();
                            if (idx === 0 && !data.father_id) {
                                data.father_id = foundId;
                                idx++;
                            } else if (idx === 1 && !data.mother_id) {
                                data.mother_id = foundId;
                            }
                        }
                    });
                }
            });
        }

        return data;
    }, personId);

    // Validate name
    const invalidNames = ['sign in', 'sign up', 'loading', 'please wait', 'error', 'undefined', 'null', ''];
    if (person.full_name && invalidNames.includes(person.full_name.toLowerCase().trim())) {
        person.full_name = null;
    }

    person.generation = generation;

    console.log(`   Name: ${person.full_name || 'Unknown'}`);
    console.log(`   Life: ${person.birth_date || '?'} - ${person.death_date || '?'}`);
    console.log(`   Father: ${person.father_id || 'Not found'}`);
    console.log(`   Mother: ${person.mother_id || 'Not found'}`);

    // Debug: show found links
    if (person._debugLinks && person._debugLinks.length > 0) {
        console.log(`   Links found (${person._debugLinks.length}):`);
        person._debugLinks.forEach(link => {
            console.log(`      ${link.id}: ${link.context.substring(0, 80)}...`);
        });
    } else {
        console.log('   No person links found on page!');
    }
    delete person._debugLinks;

    if (person.full_name) {
        stats.personsScraped++;
        if (person.father_id) stats.relationshipsFound++;
        if (person.mother_id) stats.relationshipsFound++;
    } else {
        stats.errors++;
    }

    return person;
}

// --- TREE TRAVERSAL ---

async function scrapeAncestralLine(page, startPersonId, targetAncestorId = null) {
    const visited = new Set();
    const lineage = [];
    const queue = [{ id: startPersonId, generation: 0 }];

    console.log('\n══════════════════════════════════════════════════════════════');
    console.log('   FAMILYSEARCH TREE SCRAPER - ANCESTRAL LINE');
    console.log('══════════════════════════════════════════════════════════════');
    console.log(`Start Person: ${startPersonId}`);
    console.log(`Target Ancestor: ${targetAncestorId || 'None (full tree)'}`);
    console.log(`Max Generations: ${MAX_GENERATIONS}`);
    console.log('══════════════════════════════════════════════════════════════\n');

    while (queue.length > 0) {
        const { id, generation } = queue.shift();

        if (visited.has(id)) continue;
        if (generation > MAX_GENERATIONS) continue;

        visited.add(id);

        // Navigate to person page
        const personUrl = `https://www.familysearch.org/tree/person/details/${id}`;
        try {
            await page.goto(personUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        } catch (navError) {
            console.log(`   Navigation failed for ${id}: ${navError.message}`);
            stats.errors++;
            continue;
        }

        await sleep(RATE_LIMIT_MS);

        // Extract data
        let person = await extractPersonData(page, id, generation);

        // Retry once if failed
        if (!person.full_name) {
            console.log('   Retrying after refresh...');
            await page.reload({ waitUntil: 'networkidle2' });
            await sleep(3000);
            person = await extractPersonData(page, id, generation);
        }

        if (person.full_name) {
            lineage.push(person);
        } else {
            console.log(`   Skipping ${id} - could not extract data`);
            continue;
        }

        // Check if target found
        if (targetAncestorId && id.toUpperCase() === targetAncestorId.toUpperCase()) {
            console.log('\n═══ TARGET ANCESTOR FOUND! ═══\n');
            break;
        }

        // Queue parents (climb the tree)
        if (person.father_id && !visited.has(person.father_id)) {
            queue.push({ id: person.father_id, generation: generation + 1 });
        }
        if (person.mother_id && !visited.has(person.mother_id)) {
            queue.push({ id: person.mother_id, generation: generation + 1 });
        }

        // Progress update
        if (lineage.length % 5 === 0) {
            console.log(`\n   Progress: ${lineage.length} persons, queue: ${queue.length}\n`);
        }
    }

    return lineage;
}

// --- DATABASE STORAGE ---

async function saveLineageToDatabase(lineage) {
    if (!sql) {
        console.log('\nDry run mode - would save:', lineage.length, 'persons');
        return;
    }

    console.log(`\nSaving ${lineage.length} persons to database...`);

    for (const person of lineage) {
        try {
            await sql`
                INSERT INTO canonical_persons (
                    canonical_name,
                    first_name,
                    last_name,
                    sex,
                    birth_year_estimate,
                    death_year_estimate,
                    person_type,
                    verification_status,
                    confidence_score,
                    created_by,
                    notes
                ) VALUES (
                    ${person.full_name},
                    ${person.given_name},
                    ${person.surname},
                    ${person.gender},
                    ${person.birth_date ? parseInt(person.birth_date) : null},
                    ${person.death_date ? parseInt(person.death_date) : null},
                    'descendant',
                    'familysearch_tree',
                    0.95,
                    'tree_scraper',
                    ${JSON.stringify({
                        familysearch_id: person.familysearch_id,
                        generation: person.generation,
                        father_fs_id: person.father_id,
                        mother_fs_id: person.mother_id
                    })}
                )
                ON CONFLICT DO NOTHING
            `;
            console.log(`   ✓ ${person.full_name} (Gen ${person.generation})`);
        } catch (dbError) {
            console.log(`   ✗ ${person.full_name}: ${dbError.message}`);
            stats.errors++;
        }
    }

    console.log('Database save complete!');
}

// --- MAIN ---

function printStats(lineage) {
    const elapsed = Math.round((Date.now() - stats.startTime) / 1000);
    const maxGen = lineage.length > 0 ? Math.max(...lineage.map(p => p.generation)) : 0;

    console.log(`
══════════════════════════════════════════════════════════════
   SCRAPE COMPLETE
══════════════════════════════════════════════════════════════
   Persons scraped:      ${stats.personsScraped}
   Relationships found:  ${stats.relationshipsFound}
   Generations:          ${maxGen}
   Errors:               ${stats.errors}
   Elapsed time:         ${Math.floor(elapsed / 60)}m ${elapsed % 60}s
══════════════════════════════════════════════════════════════
`);

    console.log('LINEAGE SUMMARY:');
    console.log('────────────────────────────────────────────────────────────');
    lineage.sort((a, b) => a.generation - b.generation).forEach(p => {
        const dates = `${p.birth_date || '?'} - ${p.death_date || '?'}`;
        console.log(`   Gen ${p.generation}: ${p.full_name || 'Unknown'} (${p.familysearch_id}) [${dates}]`);
    });
    console.log('────────────────────────────────────────────────────────────\n');
}

async function main() {
    const args = process.argv.slice(2);

    if (args.length < 1) {
        console.log(`
FamilySearch Personal Tree Scraper
══════════════════════════════════════════════════════════════

Usage:
   FAMILYSEARCH_INTERACTIVE=true node scripts/scrapers/familysearch-tree-scraper.js <person_id> [target_id]

Example:
   FAMILYSEARCH_INTERACTIVE=true node scripts/scrapers/familysearch-tree-scraper.js G21N-HD2
        `);
        process.exit(1);
    }

    const startPersonId = args[0].toUpperCase();
    const targetAncestorId = args[1] ? args[1].toUpperCase() : null;

    console.log('\n══════════════════════════════════════════════════════════════');
    console.log('   FAMILYSEARCH PERSONAL TREE SCRAPER');
    console.log('══════════════════════════════════════════════════════════════');
    console.log(`Interactive Mode: ${FAMILYSEARCH_INTERACTIVE}`);
    console.log(`Start Person ID: ${startPersonId}`);
    console.log(`Target Ancestor: ${targetAncestorId || 'None'}`);
    console.log('══════════════════════════════════════════════════════════════\n');

    initDatabase();

    const { browser, page } = await launchBrowser();

    try {
        await ensureLoggedIn(page, startPersonId);
        const lineage = await scrapeAncestralLine(page, startPersonId, targetAncestorId);
        printStats(lineage);
        await saveLineageToDatabase(lineage);
    } catch (error) {
        console.error('\nFatal error:', error.message);
        stats.errors++;
    } finally {
        await browser.close();
    }
}

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
