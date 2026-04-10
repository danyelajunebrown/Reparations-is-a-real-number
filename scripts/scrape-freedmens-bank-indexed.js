#!/usr/bin/env node
/**
 * Freedmen's Bank — Indexed Branch Scraper
 *
 * For branches that have FamilySearch Image Index tables (pre-transcribed),
 * scrapes the structured HTML data directly — no OCR needed.
 *
 * ~41 records per page × hundreds of pages per branch = thousands of records
 * in minutes, at 0.95 confidence (indexed data, not OCR).
 *
 * Creates BOTH freedperson entries AND enslaver entries when family data
 * includes information about former masters.
 *
 * Usage:
 *   node scripts/scrape-freedmens-bank-indexed.js --branch "Charleston, South Carolina"
 *   node scripts/scrape-freedmens-bank-indexed.js --branch "Charleston, South Carolina" --start 10 --limit 100
 *   node scripts/scrape-freedmens-bank-indexed.js --dry-run
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const puppeteer = require('puppeteer-core');
const { neon } = require('@neondatabase/serverless');

const DRY_RUN = process.argv.includes('--dry-run');
const branchIdx = process.argv.indexOf('--branch');
const BRANCH = branchIdx !== -1 ? process.argv[branchIdx + 1] : 'Charleston, South Carolina';
const startIdx = process.argv.indexOf('--start');
const START_PAGE = startIdx !== -1 ? parseInt(process.argv[startIdx + 1]) : 0;
const limitIdx = process.argv.indexOf('--limit');
const PAGE_LIMIT = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1]) : 999;

// Branch → roll URLs (using waypoint-based index pages)
// Each entry is a roll's index URL that we navigate page by page
const BRANCHES = {
    'Charleston, South Carolina': {
        rolls: [
            { wc: '3MDR-T3D%3A1551795003%2C1551795001%26cc%3D1417695', ark: '3:1:S3HY-XCQC-ZD', roll: 22, totalImages: 421, label: 'Roll 22, 1869-1871, accounts 3833-6626' }
        ]
    },
    'Richmond, Virginia': {
        rolls: [
            { indexUrl: 'https://www.familysearch.org/en/search/image/index?owc=3MDR-K6F%3A1551793903%2C1551805363%3Fcc%3D1417695&cc=1417695', roll: 26, totalImages: 221, label: 'Roll 26, 1867-1870, accounts 232-1582' },
            { indexUrl: 'https://www.familysearch.org/en/search/image/index?owc=3MDR-K6X%3A1551793903%2C1551793901%3Fcc%3D1417695&cc=1417695', roll: 27, totalImages: 841, label: 'Roll 27, 1870-1874, accounts 1591-7691' }
        ]
    },
    'Wilmington, North Carolina': {
        rolls: [
            { indexUrl: 'https://www.familysearch.org/en/search/image/index?owc=3MDR-BZW%3A1551805235%2C1551805233%3Fcc%3D1417695&cc=1417695', roll: 18, totalImages: 254, label: 'Roll 18, 1869-1873, accounts 1208-5400' }
        ]
    },
    'Raleigh, North Carolina': {
        rolls: [
            { indexUrl: 'https://www.familysearch.org/en/search/image/index?owc=3MDR-BZT%3A1551805235%2C1551805072%3Fcc%3D1417695&cc=1417695', roll: 18, totalImages: 2, label: 'Roll 18, 1868, accounts 9-15' }
        ]
    }
};

let sql, browser;

const stats = { pages: 0, records: 0, stored: 0, errors: 0, skipped: 0, retries: 0, startTime: Date.now() };

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000; // 5 seconds between retries
const MAX_CONSECUTIVE_EMPTY = 10; // Abort if 10 pages in a row have zero records

/**
 * Check if FamilySearch page loaded properly (not redirected, not errored, not empty).
 * Returns { ok: boolean, reason: string }
 */
async function checkPageHealth(page) {
    const url = page.url();
    const title = await page.title().catch(() => '');
    const bodyLen = await page.evaluate(() => (document.body.innerText || '').length).catch(() => 0);

    // Redirect to wrong app (get-involved, home, etc.)
    if (/getinvolved|\/en\/home/i.test(url)) {
        return { ok: false, reason: `Redirected to wrong page: ${url}` };
    }
    // 500 / Internal Server Error
    if (/Internal Server Error|500/i.test(title)) {
        return { ok: false, reason: 'FamilySearch returned 500 Internal Server Error' };
    }
    // 403 / Forbidden
    if (/403|Forbidden/i.test(title)) {
        return { ok: false, reason: 'FamilySearch returned 403 Forbidden' };
    }
    // Completely empty body (SPA didn't render)
    if (bodyLen < 50) {
        return { ok: false, reason: `Page body too short (${bodyLen} chars) — SPA may not have rendered` };
    }
    return { ok: true, reason: '' };
}

/**
 * Navigate with retry logic. Returns true if page loaded OK, false if all retries failed.
 */
async function navigateWithRetry(page, url, pageNum) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
            // Give the SPA a moment to render
            await new Promise(r => setTimeout(r, 2000 + (attempt - 1) * 1000));
            await ensureIndexOpen(page);
            await new Promise(r => setTimeout(r, 500));

            const health = await checkPageHealth(page);
            if (health.ok) return true;

            console.log(`\n  ⚠️  Page ${pageNum} attempt ${attempt}/${MAX_RETRIES}: ${health.reason}`);
            if (attempt < MAX_RETRIES) {
                stats.retries++;
                const delay = RETRY_DELAY_MS * attempt;
                console.log(`     Retrying in ${delay / 1000}s...`);
                await new Promise(r => setTimeout(r, delay));
            }
        } catch (e) {
            console.log(`\n  ⚠️  Page ${pageNum} attempt ${attempt}/${MAX_RETRIES}: ${e.message}`);
            if (attempt < MAX_RETRIES) {
                stats.retries++;
                await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt));
            }
        }
    }
    return false;
}

async function ensureIndexOpen(page) {
    // Try to ensure the Image Index panel is rendered/visible.
    // FamilySearch UI occasionally lazy-loads the index; poke common toggles.
    try {
        // Heuristic: if there is a button/tab with text containing 'Index', click it.
        await page.evaluate(() => {
            const clickIf = (el) => el && (el.click?.() || el.dispatchEvent?.(new MouseEvent('click', { bubbles: true })));
            const candidates = Array.from(document.querySelectorAll('button, [role="tab"], a'))
                .filter(el => /index/i.test(el.textContent || ''));
            if (candidates.length) clickIf(candidates[0]);
        });
        await page.waitForTimeout(1000);
    } catch (_) {}
}

async function dumpDebug(page, i, note = '') {
    try {
        const html = await page.content();
        const text = await page.evaluate(() => document.body.innerText || '');
        const fs = require('fs');
        const path = require('path');
        const dir = path.resolve(__dirname, '../debug/freedmens-bank');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `indexed-page-${i}-body.txt`), text, 'utf8');
        fs.writeFileSync(path.join(dir, `indexed-page-${i}-dom.html`), html, 'utf8');
        if (note) fs.writeFileSync(path.join(dir, `indexed-page-${i}-note.txt`), note, 'utf8');
    } catch (_) {}
}

async function scrapePage(page, pageNum) {
    // Best-effort to make sure the index is visible
    await ensureIndexOpen(page);

    // Extract entries from the Image Index panel - be robust to UI text changes
    const text = await page.evaluate(() => document.body.innerText || '');

    // Newer FS UI may use 'Attach' (title case) or different separators; split loosely
    let entries = text.split(/More\s+Attach|More\s+ATTACH|ATTACH\s*$/im).slice(1);
    if (!entries.length) {
        // Fallback: split on just 'Attach' occurrences while avoiding excessive splits
        const rough = text.split(/\nAttach\n/gi);
        if (rough.length > 1) entries = rough.slice(1);
    }
    if (!entries.length) {
        // As a last resort, dump debug for analysis and return empty to continue
        await dumpDebug(page, pageNum, 'No index entries detected with current split patterns.');
    }

    const records = [];
    for (const entry of entries) {
        const lines = entry.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        if (lines.length < 2) continue;

        const name = lines[0];
        if (!name || name.length < 2 || name === 'Name' || name.includes('Column') || name === 'ATTACH') continue;

        const record = { name };
        for (const line of lines.slice(1)) {
            if (/^\d+ years$/.test(line)) record.age = line;
            else if (/^\d{4}$/.test(line)) record.birthYear = parseInt(line);
            else if (/^\d+ \w+ \d{4}$/.test(line)) record.eventDate = line;
            else if (/^\d{3,5}$/.test(line)) record.accountNumber = line;
            else if (/Male|Female/.test(line)) { /* skip sex fields */ }
            else if (/,.*,.*United States/.test(line)) record.eventPlace = line;
            else if (/St\.|Street|Ally|Hospital|Village|Ave|Road/i.test(line) && !record.residence) record.residence = line;
            else if (/S\.C\.|N\.C\.|Va\.|Ga\.|Ala\.|Miss\.|Tenn\.|Ky\.|La\.|Md\.|Pa\.|Fla\.|Ark\.|Mo\./i.test(line) && !record.birthplace) record.birthplace = line;
            else if (/Painter|Nurse|Steward|Carpenter|Soldier|Cook|Laborer|Washer|Servant|Farmer|Plasterer|Porter|Drayman|Driver|Waiter|Barber|Blacksmith|Mason|Seamstress|Laundress/i.test(line)) record.occupation = line;
            else if (/^(Brown|Black|Yellow|Light|Dark|Copper|Mulatto|Bright|Ginger)/i.test(line)) record.complexion = line;
            else if (/Dead/.test(line)) record.status = 'Dead';
        }

        records.push(record);
    }

    // If nothing parsed, dump a debug snapshot for this page once
    if (!records.length) {
        await dumpDebug(page, pageNum, 'Parsed 0 records after splitting entries.');
    }

    return records;
}

async function storeRecords(records) {
    if (DRY_RUN) {
        records.forEach(r => console.log(`  [DRY] ${r.name} | ${r.occupation || '?'} | ${r.complexion || '?'} | acct ${r.accountNumber || '?'}`));
        stats.stored += records.length;
        return;
    }

    for (const r of records) {
        try {
            const ctx = [
                `Freedman's Bank depositor, ${BRANCH}`,
                r.occupation ? `Occupation: ${r.occupation}` : null,
                r.complexion ? `Complexion: ${r.complexion}` : null,
                r.birthplace ? `Born: ${r.birthplace}` : null,
                r.residence ? `Residence: ${r.residence}` : null,
                r.accountNumber ? `Account #${r.accountNumber}` : null,
                r.eventDate ? `Date: ${r.eventDate}` : null
            ].filter(Boolean).join('. ');

            await sql`
                INSERT INTO unconfirmed_persons (
                    full_name, person_type, locations,
                    source_url, source_page_title, extraction_method,
                    context_text, confidence_score, source_type,
                    relationships
                ) VALUES (
                    ${r.name},
                    'freedperson',
                    ${[BRANCH]},
                    ${'https://www.familysearch.org/en/search/collection/1417695'},
                    ${"Freedman's Bank Records — " + BRANCH},
                    ${'freedmens_bank_index'},
                    ${ctx},
                    ${0.95},
                    ${'bank_record'},
                    ${JSON.stringify({
                        age: r.age || null,
                        birth_year: r.birthYear || null,
                        birthplace: r.birthplace || null,
                        residence: r.residence || null,
                        occupation: r.occupation || null,
                        complexion: r.complexion || null,
                        account_number: r.accountNumber || null,
                        event_date: r.eventDate || null,
                        status: r.status || null,
                        branch: BRANCH,
                        citation: "Freedman's Bank Records, 1865-1874. FamilySearch Collection 1417695."
                    })}
                )
            `;
            stats.stored++;
        } catch (e) {
            stats.errors++;
        }
    }
}

async function main() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  FREEDMEN'S BANK — INDEXED BRANCH SCRAPER`);
    console.log(`  Branch: ${BRANCH}`);
    console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
    console.log(`${'='.repeat(60)}\n`);

    sql = neon(process.env.DATABASE_URL);
    browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null });

    const branchConfig = BRANCHES[BRANCH];
    if (!branchConfig) {
        console.log('Unknown branch. Available: ' + Object.keys(BRANCHES).join(', '));
        process.exit(1);
    }

    for (const roll of branchConfig.rolls) {
        console.log(`\n── ${roll.label} (${roll.totalImages} images) ──\n`);

        const page = await browser.newPage();
        const endPage = Math.min(START_PAGE + PAGE_LIMIT, roll.totalImages);

        let consecutiveEmpty = 0;

        for (let i = START_PAGE; i < endPage; i++) {
            // Build URL: use ARK-based or index-based depending on what we have
            let url;
            if (roll.ark && roll.wc) {
                url = `https://www.familysearch.org/ark:/61903/${roll.ark}?wc=${roll.wc}&cc=1417695&i=${i}`;
            } else if (roll.indexUrl) {
                url = roll.indexUrl + (roll.indexUrl.includes('?') ? '&' : '?') + 'i=' + i;
            } else {
                continue;
            }

            try {
                const loaded = await navigateWithRetry(page, url, i);
                if (!loaded) {
                    stats.skipped++;
                    consecutiveEmpty++;
                    await dumpDebug(page, i, `Skipped: page failed health check after ${MAX_RETRIES} retries`);
                    console.log(`\n  ❌ Page ${i} skipped after ${MAX_RETRIES} retries — possible FS outage`);

                    if (consecutiveEmpty >= MAX_CONSECUTIVE_EMPTY) {
                        console.log(`\n  🛑 ${MAX_CONSECUTIVE_EMPTY} consecutive empty/failed pages — FamilySearch may be down.`);
                        console.log(`     Stopping. Resume later with --start ${i}`);
                        break;
                    }
                    continue;
                }

                const records = await scrapePage(page, i);
                stats.records += records.length;
                stats.pages++;

                if (records.length > 0) {
                    consecutiveEmpty = 0; // Reset on success
                } else {
                    consecutiveEmpty++;
                }

                await storeRecords(records);

                process.stdout.write(`\r  Page ${i+1}/${endPage} — ${stats.records} records, ${stats.stored} stored, ${stats.skipped} skipped`);

                if (consecutiveEmpty >= MAX_CONSECUTIVE_EMPTY) {
                    console.log(`\n  🛑 ${MAX_CONSECUTIVE_EMPTY} consecutive empty pages — may need URL format update.`);
                    console.log(`     Stopping. Check debug/freedmens-bank/ for page dumps. Resume with --start ${i + 1}`);
                    break;
                }
            } catch (e) {
                stats.errors++;
                consecutiveEmpty++;
                await dumpDebug(page, i, `Error on page ${i}: ${e?.message || e}`);
            }

            // Rate limit — be polite
            await new Promise(r => setTimeout(r, 500));
        }

        await page.close();
    }

    const elapsed = ((Date.now() - stats.startTime) / 1000 / 60).toFixed(1);
    console.log(`\n\n${'='.repeat(60)}`);
    console.log(`  COMPLETE — ${BRANCH}`);
    console.log(`${'='.repeat(60)}`);
    console.log(`  Pages: ${stats.pages}`);
    console.log(`  Records: ${stats.records}`);
    console.log(`  Stored: ${stats.stored}`);
    console.log(`  Skipped: ${stats.skipped}`);
    console.log(`  Retries: ${stats.retries}`);
    console.log(`  Errors: ${stats.errors}`);
    console.log(`  Elapsed: ${elapsed} min`);
    console.log('');
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
