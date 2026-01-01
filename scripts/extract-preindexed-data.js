/**
 * FamilySearch Pre-Indexed Data Extraction
 *
 * Extracts clean, accurate data from FamilySearch's "Image Index" panel
 * instead of relying on error-prone OCR.
 *
 * The Image Index panel contains volunteer-transcribed data with:
 * - Slaveholder names (marked as "Owner")
 * - Enslaved demographics: Sex, Age, Birth Year (marked as "Slave")
 * - Page numbers
 *
 * Usage:
 *   FAMILYSEARCH_INTERACTIVE=true node scripts/extract-preindexed-data.js --test-url "URL"
 *   FAMILYSEARCH_INTERACTIVE=true node scripts/extract-preindexed-data.js --state Arkansas --year 1860
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

// Configuration
const DATABASE_URL = process.env.DATABASE_URL;
const INTERACTIVE = process.env.FAMILYSEARCH_INTERACTIVE === 'true';

let sql = null;
let browser = null;
let page = null;

// Statistics
const stats = {
    pagesProcessed: 0,
    ownersExtracted: 0,
    enslavedExtracted: 0,
    pagesWithPreIndexedData: 0,
    pagesWithoutPreIndexedData: 0,
    errors: 0,
    startTime: Date.now()
};

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
            '--window-size=1920,1200'
        ]
    });

    page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1200 });

    // Load cookies if available
    const cookiesPath = path.join(process.cwd(), 'fs-cookies.json');
    if (fs.existsSync(cookiesPath)) {
        const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
        await page.setCookie(...cookies);
        console.log(`✅ Loaded ${cookies.length} cookies`);
    }

    return { browser, page };
}

/**
 * Check if user is logged in to FamilySearch
 */
async function checkLogin() {
    console.log('🔐 Checking FamilySearch login status...');

    await page.goto('https://www.familysearch.org/auth/familysearch/login', {
        waitUntil: 'networkidle2',
        timeout: 30000
    });

    await new Promise(r => setTimeout(r, 2000));

    const currentUrl = page.url();

    if (currentUrl.includes('/auth/') || currentUrl.includes('/login')) {
        if (INTERACTIVE) {
            console.log('');
            console.log('═══════════════════════════════════════════════════');
            console.log('   Please log in to FamilySearch in the browser');
            console.log('   The script will continue automatically after login');
            console.log('═══════════════════════════════════════════════════');
            console.log('');

            // Wait for redirect away from login page
            await page.waitForFunction(
                () => !window.location.href.includes('/auth/') && !window.location.href.includes('/login'),
                { timeout: 300000 } // 5 minutes
            );

            console.log('✅ Login detected!');

            // Save cookies for future sessions
            const cookies = await page.cookies();
            fs.writeFileSync(
                path.join(process.cwd(), 'fs-cookies.json'),
                JSON.stringify(cookies, null, 2)
            );
            console.log(`💾 Saved ${cookies.length} cookies for future sessions`);
        } else {
            throw new Error('Not logged in and not in interactive mode');
        }
    } else {
        console.log('✅ Already logged in');
    }
}

/**
 * Extract pre-indexed data from the Image Index panel
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
        console.log(`   📄 Loading: ${imageUrl.substring(0, 80)}...`);
        await page.goto(imageUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        // Wait for page to fully render
        await new Promise(r => setTimeout(r, 3000));

        // Look for the Image Index panel
        // Try multiple selectors since FamilySearch UI may vary
        const panelSelectors = [
            '.image-index-panel',
            '[data-testid="image-index"]',
            '.record-details-panel',
            '.indexed-records',
            // The panel has tabs "Image Index" and "Information"
            '.image-index',
            // Table container
            'table',
            '.data-table'
        ];

        // First, try to click on "Image Index" tab if it exists
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
                found: false,
                debug: []
            };

            // Look for table rows that contain indexed record data
            // Based on the user's screenshot, the data is in a table with columns:
            // Name | Sex | Age | Birth Year (Estimated) | Free or Enslaved | Page Number

            // Find all rows that look like record data
            const allRows = document.querySelectorAll('tr, [role="row"], .record-row, .index-row');

            allRows.forEach(row => {
                const cells = row.querySelectorAll('td, [role="cell"], .cell, div[class*="cell"], span');
                const rowText = row.textContent || '';

                // Check if this row contains "Owner" or "Slave" designation
                if (rowText.includes('Owner') || rowText.includes('Slave')) {
                    data.found = true;

                    const rowData = {
                        name: '',
                        sex: '',
                        age: '',
                        birthYear: '',
                        status: '', // Owner or Slave
                        pageNumber: '',
                        rawText: rowText.trim().substring(0, 200),
                        cellTexts: [] // Debug: capture all cell texts
                    };

                    // Capture all cell contents for debugging
                    cells.forEach((cell, idx) => {
                        const text = cell.textContent.trim();
                        rowData.cellTexts.push({ idx, text: text.substring(0, 50), tag: cell.tagName });
                    });

                    // Try to extract structured data from cells
                    cells.forEach((cell, idx) => {
                        const text = cell.textContent.trim();

                        // Detect what each cell contains
                        if (text === 'Owner' || text === 'Slave') {
                            rowData.status = text;
                        } else if (text === 'Male' || text === 'Female') {
                            rowData.sex = text;
                        } else if (text.match(/^\d{1,3}\s*years?$/i)) {
                            rowData.age = parseInt(text);
                        } else if (text.match(/^\d{4}$/)) {
                            // Could be birth year or page number
                            if (parseInt(text) >= 1700 && parseInt(text) <= 1870) {
                                rowData.birthYear = parseInt(text);
                            } else {
                                rowData.pageNumber = text;
                            }
                        } else if (text.match(/^\d{1,2}$/)) {
                            rowData.pageNumber = text;
                        } else if (text.length > 1 && !text.match(/^(ATTACH|More|years?)$/i)) {
                            // Likely a name
                            if (!rowData.name && text.length > 1) {
                                rowData.name = text;
                            }
                        }
                    });

                    // Only add if we got meaningful data
                    if (rowData.status) {
                        data.rows.push(rowData);
                    }
                }
            });

            // Alternative: Look for the specific panel structure
            if (!data.found) {
                // Try finding by looking for ATTACH buttons (seen in screenshot)
                const attachButtons = document.querySelectorAll('button, a');
                let currentOwner = null;

                attachButtons.forEach(btn => {
                    if (btn.textContent.includes('ATTACH')) {
                        // Find the parent row
                        const parentRow = btn.closest('tr, [role="row"], div');
                        if (parentRow) {
                            const rowText = parentRow.textContent;
                            if (rowText.includes('Owner')) {
                                // This is an owner row
                                const nameMatch = rowText.match(/ATTACH\s+([A-Z][a-zA-Z\s\.]+?)\s+Owner/);
                                if (nameMatch) {
                                    currentOwner = nameMatch[1].trim();
                                    data.rows.push({
                                        name: currentOwner,
                                        status: 'Owner',
                                        rawText: rowText.trim()
                                    });
                                    data.found = true;
                                }
                            } else if (rowText.includes('Slave')) {
                                // This is a slave row
                                const ageMatch = rowText.match(/(\d+)\s*years/i);
                                const sexMatch = rowText.match(/(Male|Female)/i);
                                const yearMatch = rowText.match(/\b(1[78]\d{2})\b/);

                                data.rows.push({
                                    name: '',
                                    sex: sexMatch ? sexMatch[1] : '',
                                    age: ageMatch ? parseInt(ageMatch[1]) : null,
                                    birthYear: yearMatch ? parseInt(yearMatch[1]) : null,
                                    status: 'Slave',
                                    owner: currentOwner,
                                    rawText: rowText.trim()
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

            // Process the rows into owners and enslaved
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
                        confidence: 0.95, // High confidence for pre-indexed data
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

            console.log(`   ✅ Pre-indexed: ${result.owners.length} owners, ${result.enslaved.length} enslaved`);
        } else {
            console.log(`   ⚠️ No pre-indexed data found - would fall back to OCR`);
        }

    } catch (error) {
        console.error(`   ❌ Error extracting: ${error.message}`);
        stats.errors++;
    }

    return result;
}

/**
 * Store extracted person to database
 */
async function storePerson(personData, dryRun = false) {
    if (!sql || dryRun) {
        console.log(`      → Would store: ${personData.name} (${personData.type})`);
        return null;
    }

    try {
        const locations = personData.state && personData.county
            ? [`${personData.county}, ${personData.state}`]
            : [];

        let contextText = personData.name;
        if (personData.type === 'enslaved' && personData.owner) {
            contextText = `${personData.name} | Owner: ${personData.owner} | ${personData.county}, ${personData.state} (${personData.year})`;
        } else if (personData.type === 'slaveholder') {
            contextText = `${personData.name} (slaveholder) | ${personData.county}, ${personData.state} (${personData.year})`;
        }

        const relationships = {
            owner: personData.owner,
            state: personData.state,
            county: personData.county,
            year: personData.year,
            age: personData.age,
            birthYear: personData.birthYear
        };

        // Check for duplicates
        const existing = await sql`
            SELECT lead_id FROM unconfirmed_persons
            WHERE full_name = ${personData.name}
            AND source_url = ${personData.sourceUrl}
            LIMIT 1
        `;

        if (existing.length > 0) {
            return existing[0].lead_id;
        }

        const result = await sql`
            INSERT INTO unconfirmed_persons (
                full_name, person_type, source_url, context_text,
                confidence_score, extraction_method, gender,
                locations, relationships, source_type
            ) VALUES (
                ${personData.name},
                ${personData.type},
                ${personData.sourceUrl},
                ${contextText},
                ${personData.confidence || 0.95},
                ${personData.extractionMethod || 'pre_indexed'},
                ${personData.sex || null},
                ${locations},
                ${JSON.stringify(relationships)},
                'primary'
            )
            RETURNING lead_id
        `;

        return result[0]?.lead_id;
    } catch (error) {
        console.error(`      ⚠️ Store error: ${error.message}`);
        return null;
    }
}

/**
 * Test extraction on a single URL
 */
async function testSingleUrl(url) {
    console.log('');
    console.log('═══════════════════════════════════════════════════');
    console.log('   PRE-INDEXED DATA EXTRACTION TEST');
    console.log('═══════════════════════════════════════════════════');
    console.log('');
    console.log(`URL: ${url}`);
    console.log('');

    initDatabase();
    await initBrowser();
    await checkLogin();

    const result = await extractPreIndexedData(url, {
        state: 'Arkansas',
        county: 'Hempstead',
        year: 1860
    });

    console.log('');
    console.log('═══════════════════════════════════════════════════');
    console.log('   EXTRACTION RESULTS');
    console.log('═══════════════════════════════════════════════════');
    console.log('');
    console.log(`Has pre-indexed data: ${result.hasPreIndexedData}`);
    console.log(`Owners found: ${result.owners.length}`);
    console.log(`Enslaved found: ${result.enslaved.length}`);
    console.log('');

    if (result.owners.length > 0) {
        console.log('SLAVEHOLDERS:');
        result.owners.forEach((o, i) => {
            console.log(`  ${i + 1}. ${o.name}`);
        });
        console.log('');
    }

    if (result.enslaved.length > 0) {
        console.log(`ENSLAVED (first 10 of ${result.enslaved.length}):`);
        result.enslaved.slice(0, 10).forEach((e, i) => {
            console.log(`  ${i + 1}. ${e.name} - Owner: ${e.owner || 'Unknown'}`);
        });
    }

    // Debug: show raw rows structure
    console.log('');
    console.log('DEBUG - First 3 raw rows:');
    result.rawRows.slice(0, 3).forEach((row, i) => {
        console.log(`Row ${i + 1}:`);
        console.log(`  Status: ${row.status}`);
        console.log(`  Name: "${row.name}"`);
        console.log(`  Raw text: ${row.rawText?.substring(0, 100)}...`);
        console.log(`  Cell texts: ${JSON.stringify(row.cellTexts?.slice(0, 8))}`);
        console.log('');
    });

    await browser.close();
}

// Main execution
async function main() {
    const args = process.argv.slice(2);

    if (args.includes('--test-url')) {
        const urlIndex = args.indexOf('--test-url');
        const url = args[urlIndex + 1] || 'https://www.familysearch.org/ark:/61903/3:1:33S7-9YBJ-L79?cc=3161105';
        await testSingleUrl(url);
    } else {
        console.log('Usage:');
        console.log('  FAMILYSEARCH_INTERACTIVE=true node scripts/extract-preindexed-data.js --test-url "URL"');
        console.log('');
        console.log('Example:');
        console.log('  FAMILYSEARCH_INTERACTIVE=true node scripts/extract-preindexed-data.js --test-url "https://www.familysearch.org/ark:/61903/3:1:33S7-9YBJ-L79?cc=3161105"');
    }
}

main().catch(console.error);
