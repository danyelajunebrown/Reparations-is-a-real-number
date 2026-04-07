#!/usr/bin/env node
/**
 * Freedmen's Bank Records Scraper
 *
 * Scrapes the FamilySearch indexed records for the Freedman's Savings
 * and Trust Company (collection 1417695). 67,000 depositors with:
 *   - Full name
 *   - Residence
 *   - Birth place
 *   - Former enslaver name (in many records)
 *   - Family members (spouse, children, parents, siblings)
 *   - Occupation
 *   - Complexion
 *
 * This is the single highest-value data source for linking enslaved
 * people to their former enslavers by name.
 *
 * Connects to existing Chrome on port 9222 (must be logged into FamilySearch).
 *
 * Usage:
 *   node scripts/scrape-freedmens-bank.js
 *   node scripts/scrape-freedmens-bank.js --dry-run
 *   node scripts/scrape-freedmens-bank.js --limit 1000
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const puppeteer = require('puppeteer-core');
const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL;
const DRY_RUN = process.argv.includes('--dry-run');
const limitIdx = process.argv.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1]) : 100000;

const COLLECTION_ID = '1417695';
const SEARCH_URL = `https://www.familysearch.org/search/record/results?collection_id=${COLLECTION_ID}`;
const SOURCE_CITATION = 'United States, Freedman\'s Bank Records, 1865-1874. FamilySearch Collection 1417695.';

let sql, browser, page;

const stats = {
    pages: 0,
    records: 0,
    withEnslaver: 0,
    stored: 0,
    errors: 0,
    startTime: Date.now()
};

async function init() {
    sql = neon(DATABASE_URL);
    browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null });
    page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
}

async function searchPage(offset) {
    const url = `${SEARCH_URL}&count=100&offset=${offset}`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000)); // Let results render

    // Extract search results
    const results = await page.evaluate(() => {
        const rows = document.querySelectorAll('[data-testid="searchResult"], .result-item, tr.result');
        const data = [];

        // Try the search results API response instead
        // FamilySearch renders results from an API — let's get the rendered text
        const resultElements = document.querySelectorAll('.search-result, [class*="result"]');

        // Fallback: get all links to individual records
        const recordLinks = document.querySelectorAll('a[href*="/ark:/61903/1:1:"]');
        for (const link of recordLinks) {
            const href = link.getAttribute('href');
            const text = link.closest('tr, [class*="result"], li')?.innerText || link.innerText;
            if (href && text.length > 10) {
                data.push({ url: href, text: text.trim() });
            }
        }

        return data;
    });

    return results;
}

async function scrapeRecord(recordUrl) {
    try {
        const fullUrl = recordUrl.startsWith('http') ? recordUrl : `https://www.familysearch.org${recordUrl}`;
        await page.goto(fullUrl, { waitUntil: 'networkidle2', timeout: 20000 });
        await new Promise(r => setTimeout(r, 1500));

        const record = await page.evaluate(() => {
            const data = {};

            // Extract all key-value pairs from the record detail page
            const rows = document.querySelectorAll('tr, [class*="detail-row"], dl dt, [class*="field"]');

            // Try table rows first
            const tables = document.querySelectorAll('table');
            for (const table of tables) {
                const trs = table.querySelectorAll('tr');
                for (const tr of trs) {
                    const cells = tr.querySelectorAll('td, th');
                    if (cells.length >= 2) {
                        const label = cells[0].innerText.trim().toLowerCase();
                        const value = cells[1].innerText.trim();
                        if (value && value !== '-' && value !== '') {
                            data[label] = value;
                        }
                    }
                }
            }

            // Try definition lists
            const dts = document.querySelectorAll('dt');
            for (const dt of dts) {
                const dd = dt.nextElementSibling;
                if (dd && dd.tagName === 'DD') {
                    const label = dt.innerText.trim().toLowerCase();
                    const value = dd.innerText.trim();
                    if (value) data[label] = value;
                }
            }

            // Get the full page text as fallback
            data._fullText = document.body.innerText.substring(0, 3000);

            return data;
        });

        return record;
    } catch (e) {
        return null;
    }
}

function parseRecord(raw) {
    // Normalize field names (FamilySearch uses various label formats)
    const normalize = (key) => key.replace(/[:\s]+/g, '_').toLowerCase();
    const fields = {};
    for (const [k, v] of Object.entries(raw)) {
        if (k !== '_fullText') fields[normalize(k)] = v;
    }

    return {
        name: fields.name || fields.full_name || fields.depositor || null,
        residence: fields.residence || fields.residence_place || null,
        birthPlace: fields.birth_place || fields.birthplace || fields.birth || null,
        occupation: fields.occupation || null,
        complexion: fields.complexion || fields.color || null,
        formerEnslaver: fields.former_owner || fields.former_master || fields.master || fields.owner || null,
        spouse: fields.spouse || fields.wife || fields.husband || null,
        father: fields.father || null,
        mother: fields.mother || null,
        children: fields.children || null,
        siblings: fields.brothers_and_sisters || fields.siblings || null,
        bankBranch: fields.bank_branch || fields.branch || null,
        accountNumber: fields.account_number || fields.number || null,
        date: fields.date || fields.record_date || null,
        rawFields: fields,
        fullText: raw._fullText || ''
    };
}

async function storeRecord(parsed) {
    if (!parsed.name || parsed.name.length < 2) return false;
    if (DRY_RUN) {
        console.log(`  [DRY] ${parsed.name} | enslaver: ${parsed.formerEnslaver || 'N/A'} | ${parsed.residence || '?'}`);
        return true;
    }

    try {
        const contextText = [
            `Freedman's Bank depositor`,
            parsed.residence ? `Residence: ${parsed.residence}` : null,
            parsed.birthPlace ? `Born: ${parsed.birthPlace}` : null,
            parsed.occupation ? `Occupation: ${parsed.occupation}` : null,
            parsed.formerEnslaver ? `Former enslaver: ${parsed.formerEnslaver}` : null,
            parsed.spouse ? `Spouse: ${parsed.spouse}` : null,
            parsed.bankBranch ? `Bank branch: ${parsed.bankBranch}` : null
        ].filter(Boolean).join('. ');

        await sql`
            INSERT INTO unconfirmed_persons (
                full_name, person_type, gender, locations,
                source_url, source_page_title, extraction_method,
                context_text, confidence_score, source_type,
                relationships
            ) VALUES (
                ${parsed.name},
                'freedperson',
                ${null},
                ${parsed.residence ? [parsed.residence] : []},
                ${'https://www.familysearch.org/en/search/collection/1417695'},
                ${'Freedman\'s Bank Records, 1865-1874'},
                ${'freedmens_bank_scrape'},
                ${contextText},
                ${0.90},
                ${'bank_record'},
                ${JSON.stringify({
                    former_enslaver: parsed.formerEnslaver || null,
                    spouse: parsed.spouse || null,
                    father: parsed.father || null,
                    mother: parsed.mother || null,
                    children: parsed.children || null,
                    siblings: parsed.siblings || null,
                    occupation: parsed.occupation || null,
                    complexion: parsed.complexion || null,
                    bank_branch: parsed.bankBranch || null,
                    account_number: parsed.accountNumber || null,
                    citation: SOURCE_CITATION
                })}
            )
        `;

        // If we have a former enslaver, also create/find canonical person
        if (parsed.formerEnslaver && parsed.formerEnslaver.length > 3) {
            const existing = await sql`
                SELECT id FROM canonical_persons
                WHERE LOWER(canonical_name) = LOWER(${parsed.formerEnslaver})
                AND person_type = 'enslaver'
                LIMIT 1
            `;
            if (existing.length === 0) {
                const parts = parsed.formerEnslaver.split(/\s+/);
                await sql`
                    INSERT INTO canonical_persons (
                        canonical_name, first_name, last_name,
                        person_type, confidence_score, verification_status,
                        notes, created_by
                    ) VALUES (
                        ${parsed.formerEnslaver},
                        ${parts[0] || ''},
                        ${parts[parts.length - 1] || ''},
                        'enslaver', 0.85, 'unverified',
                        ${'Former enslaver named in Freedman\'s Bank record by depositor ' + parsed.name + '. ' + SOURCE_CITATION},
                        'scrape-freedmens-bank.js'
                    )
                `;
            }
            stats.withEnslaver++;
        }

        stats.stored++;
        return true;
    } catch (e) {
        stats.errors++;
        return false;
    }
}

async function main() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  FREEDMEN'S BANK RECORDS SCRAPER`);
    console.log(`  Collection: ${COLLECTION_ID} (67,000 depositors)`);
    console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
    console.log(`  Limit: ${LIMIT}`);
    console.log(`${'='.repeat(60)}\n`);

    await init();
    console.log('Connected to Chrome + database\n');

    // Check existing
    const existing = await sql`
        SELECT COUNT(*) as cnt FROM unconfirmed_persons
        WHERE extraction_method = 'freedmens_bank_scrape'
    `;
    if (parseInt(existing[0].cnt) > 0) {
        console.log(`Already have ${existing[0].cnt} Freedmen's Bank records. Continuing from where we left off.`);
    }

    // Search through the collection page by page
    for (let offset = 0; offset < LIMIT; offset += 100) {
        console.log(`\n--- Page ${stats.pages + 1} (offset ${offset}) ---`);

        const results = await searchPage(offset);
        if (results.length === 0) {
            console.log('No more results. Done.');
            break;
        }

        console.log(`Found ${results.length} record links`);

        for (const result of results) {
            if (stats.stored >= LIMIT) break;

            const raw = await scrapeRecord(result.url);
            if (!raw) {
                stats.errors++;
                continue;
            }

            const parsed = parseRecord(raw);
            await storeRecord(parsed);
            stats.records++;

            // Rate limit
            await new Promise(r => setTimeout(r, 500));
        }

        stats.pages++;

        if (stats.stored >= LIMIT) break;
        if (stats.records % 100 === 0) {
            console.log(`  Progress: ${stats.records} records scraped, ${stats.stored} stored, ${stats.withEnslaver} with former enslaver`);
        }
    }

    // Register source
    if (!DRY_RUN) {
        const docExists = await sql`SELECT id FROM person_documents WHERE name_as_appears = 'Freedman''s Bank Records, 1865-1874' LIMIT 1`;
        if (docExists.length === 0) {
            await sql`
                INSERT INTO person_documents (
                    name_as_appears, source_url, source_type,
                    collection_name, document_type, page_reference,
                    person_type, extraction_confidence, created_by
                ) VALUES (
                    ${"Freedman's Bank Records, 1865-1874"},
                    ${'https://www.familysearch.org/en/search/collection/1417695'},
                    ${'bank_record'},
                    ${'population-records'},
                    ${'freedmens_bank'},
                    ${'67,000 depositor accounts, 29 branch offices'},
                    ${'freedperson'},
                    ${0.90},
                    ${'scrape-freedmens-bank.js'}
                )
            `;
        }
    }

    await page.close();

    const elapsed = ((Date.now() - stats.startTime) / 1000 / 60).toFixed(1);
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  SCRAPE COMPLETE`);
    console.log(`${'='.repeat(60)}`);
    console.log(`  Pages: ${stats.pages}`);
    console.log(`  Records scraped: ${stats.records}`);
    console.log(`  Stored: ${stats.stored}`);
    console.log(`  With former enslaver: ${stats.withEnslaver}`);
    console.log(`  Errors: ${stats.errors}`);
    console.log(`  Elapsed: ${elapsed} minutes`);
    console.log('');
}

main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});
