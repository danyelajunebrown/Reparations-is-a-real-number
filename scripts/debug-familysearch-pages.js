/**
 * FamilySearch Page Reconnaissance Script
 *
 * Captures screenshots, HTML, text, links, and FS IDs from every page type
 * we need to parse for the enhanced ancestor climber with parent discovery.
 *
 * Connects to existing Chrome on port 9222 (reuses logged-in session).
 * Run on the Mac Mini with Chrome already open and logged into FamilySearch.
 *
 * Usage:
 *   node scripts/debug-familysearch-pages.js
 *   node scripts/debug-familysearch-pages.js --test-person XXXX-XXX
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

// Default test cases
const SPARSE_TREE_PERSON = '657W-K77T';  // Mira Schor — no parents linked
const RICH_TREE_PERSON = 'G21N-HD2';     // Known person with full tree
const TEST_SEARCH = { givenName: 'Mira', surname: 'Schor', birthYear: 1950, birthPlace: 'New York' };

const OUTPUT_DIR = path.join(__dirname, '..', 'debug', 'familysearch-pages');
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');

async function capturePage(page, name, description) {
    const subdir = path.join(OUTPUT_DIR, `${TIMESTAMP}_${name}`);
    fs.mkdirSync(subdir, { recursive: true });

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  Capturing: ${description}`);
    console.log(`  URL: ${page.url()}`);
    console.log(`${'═'.repeat(60)}`);

    // Screenshot
    await page.screenshot({ path: path.join(subdir, 'screenshot.png'), fullPage: true });

    // Full HTML
    const html = await page.content();
    fs.writeFileSync(path.join(subdir, 'page.html'), html);

    // Body text (what the user sees)
    const bodyText = await page.evaluate(() => document.body.innerText);
    fs.writeFileSync(path.join(subdir, 'body-text.txt'), bodyText);

    // Page title
    const title = await page.title();
    fs.writeFileSync(path.join(subdir, 'title.txt'), title);

    // All links with href
    const links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href]')).map(a => ({
            href: a.href,
            text: (a.innerText || '').trim().substring(0, 100),
            classes: a.className
        }));
    });
    fs.writeFileSync(path.join(subdir, 'links.json'), JSON.stringify(links, null, 2));

    // All FS IDs found on page (XXXX-XX to XXXX-XXXX, no vowels)
    const fsIds = await page.evaluate(() => {
        const text = document.body.innerText;
        const matches = text.match(/\b[B-DF-HJ-NP-TV-Z0-9]{4}-[B-DF-HJ-NP-TV-Z0-9]{2,4}\b/g) || [];
        return [...new Set(matches)];
    });
    fs.writeFileSync(path.join(subdir, 'fs-ids.json'), JSON.stringify(fsIds, null, 2));

    // Key DOM elements — what selectors exist
    const domReport = await page.evaluate(() => {
        const report = {};

        // Check for key sections
        report.hasH1 = !!document.querySelector('h1');
        report.h1Text = document.querySelector('h1')?.innerText?.substring(0, 200) || null;
        report.hasMain = !!document.querySelector('main');
        report.hasRoleMain = !!document.querySelector('[role="main"]');

        // Family Members / Parents section
        const bodyText = document.body.innerText;
        report.hasFamilyMembers = bodyText.includes('Family Members');
        report.hasParentsAndSiblings = bodyText.includes('Parents and Siblings');
        report.hasVitalInformation = bodyText.includes('Vital Information');
        report.hasRecordHints = bodyText.includes('Record Hints') || bodyText.includes('Research Suggestions') || bodyText.includes('Possible Duplicates');
        report.hasPersonNotFound = bodyText.includes('Person Not Found');

        // Search results indicators
        report.hasSearchResults = bodyText.includes('results') || bodyText.includes('Results');
        report.hasNoResults = bodyText.includes('No results') || bodyText.includes('no results');
        report.resultCountText = (bodyText.match(/(\d[\d,]*)\s*results?/i) || [])[0] || null;

        // Record page indicators
        report.hasRecordDetails = bodyText.includes('Record Details') || bodyText.includes('Source Information');
        report.hasFatherField = bodyText.includes("Father") || bodyText.includes("father's");
        report.hasMotherField = bodyText.includes("Mother") || bodyText.includes("mother's");
        report.hasRelationship = bodyText.includes('Relationship') || bodyText.includes('relation to head');
        report.hasHousehold = bodyText.includes('Household') || bodyText.includes('household');

        // CAPTCHA / challenge indicators
        report.hasCaptcha = bodyText.includes('captcha') || bodyText.includes('CAPTCHA') ||
                           bodyText.includes('verify you are human') || bodyText.includes('challenge');
        report.isAuthPage = window.location.href.includes('ident.familysearch') ||
                           window.location.href.includes('/auth/');

        // Table detection (search results often use tables)
        const tables = document.querySelectorAll('table');
        report.tableCount = tables.length;
        if (tables.length > 0) {
            report.firstTableHeaders = Array.from(tables[0].querySelectorAll('th')).map(th => th.innerText.trim());
        }

        // Data-testid attributes (React components often use these)
        const testIds = document.querySelectorAll('[data-testid]');
        report.dataTestIds = Array.from(testIds).map(el => el.getAttribute('data-testid')).slice(0, 30);

        // Aria labels (accessible elements, often stable selectors)
        const ariaLabels = document.querySelectorAll('[aria-label]');
        report.ariaLabels = Array.from(ariaLabels).map(el => ({
            tag: el.tagName.toLowerCase(),
            label: el.getAttribute('aria-label'),
            classes: el.className?.substring?.(0, 80) || ''
        })).slice(0, 30);

        // Links to person pages (tree person links)
        const personLinks = document.querySelectorAll('a[href*="/tree/person/"]');
        report.personLinkCount = personLinks.length;
        report.personLinks = Array.from(personLinks).map(a => ({
            href: a.href,
            text: a.innerText?.trim()?.substring(0, 60)
        })).slice(0, 20);

        // Links to record pages (ARK links)
        const arkLinks = document.querySelectorAll('a[href*="/ark:/"]');
        report.arkLinkCount = arkLinks.length;
        report.arkLinks = Array.from(arkLinks).map(a => ({
            href: a.href,
            text: a.innerText?.trim()?.substring(0, 60)
        })).slice(0, 20);

        // Body text length (sanity check)
        report.bodyTextLength = bodyText.length;
        report.bodyTextPreview = bodyText.substring(0, 500);

        return report;
    });
    fs.writeFileSync(path.join(subdir, 'dom-report.json'), JSON.stringify(domReport, null, 2));

    // Summary to console
    console.log(`  Title: ${title}`);
    console.log(`  Body text: ${domReport.bodyTextLength} chars`);
    console.log(`  FS IDs found: ${fsIds.length} → ${fsIds.slice(0, 5).join(', ')}${fsIds.length > 5 ? '...' : ''}`);
    console.log(`  Person links: ${domReport.personLinkCount}`);
    console.log(`  ARK links: ${domReport.arkLinkCount}`);
    console.log(`  Tables: ${domReport.tableCount}`);
    console.log(`  data-testid elements: ${domReport.dataTestIds.length}`);
    console.log(`  Key sections: ${[
        domReport.hasFamilyMembers && 'FamilyMembers',
        domReport.hasParentsAndSiblings && 'Parents',
        domReport.hasVitalInformation && 'Vitals',
        domReport.hasRecordHints && 'RecordHints',
        domReport.hasSearchResults && 'SearchResults',
        domReport.hasRecordDetails && 'RecordDetails',
        domReport.hasFatherField && 'Father',
        domReport.hasMotherField && 'Mother',
        domReport.hasCaptcha && 'CAPTCHA!',
        domReport.isAuthPage && 'AUTH_PAGE!'
    ].filter(Boolean).join(', ') || 'none detected'}`);
    console.log(`  Saved to: ${subdir}`);

    return { subdir, domReport, fsIds, links, title, bodyText };
}

async function main() {
    // Parse args
    let testPerson = null;
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--test-person' && args[i + 1]) {
            testPerson = args[i + 1];
            i++;
        }
    }

    const sparsePerson = testPerson || SPARSE_TREE_PERSON;

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('   FAMILYSEARCH PAGE RECONNAISSANCE');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`Output: ${OUTPUT_DIR}`);
    console.log(`Timestamp: ${TIMESTAMP}`);
    console.log(`Sparse tree test: ${sparsePerson}`);
    console.log(`Rich tree test: ${RICH_TREE_PERSON}`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    // Connect to existing Chrome
    let browser;
    try {
        browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' });
        console.log('✓ Connected to Chrome on port 9222\n');
    } catch (e) {
        console.error('✗ Could not connect to Chrome on port 9222.');
        console.error('  Make sure Chrome is running with --remote-debugging-port=9222');
        console.error('  On Mac: open -a "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir=/tmp/familysearch-ancestor-climber');
        process.exit(1);
    }

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    const results = {};

    try {
        // ─────────────────────────────────────────────────────────
        // 1. PERSON DETAILS — Rich tree (known good)
        // ─────────────────────────────────────────────────────────
        console.log('\n[1/7] Person Details — Rich Tree');
        await page.goto(`https://www.familysearch.org/tree/person/details/${RICH_TREE_PERSON}`,
            { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(r => setTimeout(r,3000));
        // Scroll to load Family Members
        await page.evaluate(() => window.scrollTo(0, 800));
        await new Promise(r => setTimeout(r,2000));
        await page.evaluate(() => window.scrollTo(0, 1500));
        await new Promise(r => setTimeout(r,2000));
        results.richTree = await capturePage(page, '1_person_details_rich',
            `Person details page with parents — ${RICH_TREE_PERSON}`);

        // ─────────────────────────────────────────────────────────
        // 2. PERSON DETAILS — Sparse tree (the failure case)
        // ─────────────────────────────────────────────────────────
        console.log('\n[2/7] Person Details — Sparse Tree');
        await page.goto(`https://www.familysearch.org/tree/person/details/${sparsePerson}`,
            { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(r => setTimeout(r,3000));
        await page.evaluate(() => window.scrollTo(0, 800));
        await new Promise(r => setTimeout(r,2000));
        await page.evaluate(() => window.scrollTo(0, 1500));
        await new Promise(r => setTimeout(r,2000));
        results.sparseTree = await capturePage(page, '2_person_details_sparse',
            `Person details page WITHOUT parents — ${sparsePerson}`);

        // ─────────────────────────────────────────────────────────
        // 3. RECORD SEARCH RESULTS
        // ─────────────────────────────────────────────────────────
        console.log('\n[3/7] Record Search Results');
        const searchUrl = `https://www.familysearch.org/search/record/results?q.givenName=${encodeURIComponent(TEST_SEARCH.givenName)}&q.surname=${encodeURIComponent(TEST_SEARCH.surname)}&q.birthLikeDate.from=${TEST_SEARCH.birthYear - 2}&q.birthLikeDate.to=${TEST_SEARCH.birthYear + 2}&q.birthLikePlace=${encodeURIComponent(TEST_SEARCH.birthPlace)}`;
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(r => setTimeout(r,5000)); // Extra time for search results to render
        results.recordSearch = await capturePage(page, '3_record_search_results',
            `Record search: ${TEST_SEARCH.givenName} ${TEST_SEARCH.surname}, born ~${TEST_SEARCH.birthYear}`);

        // ─────────────────────────────────────────────────────────
        // 4. INDIVIDUAL RECORD (ARK page) — click first result if available
        // ─────────────────────────────────────────────────────────
        console.log('\n[4/7] Individual Record (ARK page)');
        const firstArkLink = await page.evaluate(() => {
            const links = document.querySelectorAll('a[href*="/ark:/"]');
            for (const link of links) {
                if (link.href.includes('/ark:/61903/1:1/')) return link.href;
            }
            // Fallback: any clickable result link
            const resultLinks = document.querySelectorAll('a[href*="/ark:/"]');
            return resultLinks.length > 0 ? resultLinks[0].href : null;
        });

        if (firstArkLink) {
            await page.goto(firstArkLink, { waitUntil: 'networkidle2', timeout: 30000 });
            await new Promise(r => setTimeout(r,4000));
            await page.evaluate(() => window.scrollTo(0, 500));
            await new Promise(r => setTimeout(r,1000));
            results.individualRecord = await capturePage(page, '4_individual_record_ark',
                `Individual record page — ${firstArkLink.substring(0, 80)}`);
        } else {
            console.log('  ⚠ No ARK links found in search results — skipping');
            // Try a known census record instead
            const fallbackArk = 'https://www.familysearch.org/ark:/61903/1:1:M4QD-GP7';
            console.log(`  Trying fallback ARK: ${fallbackArk}`);
            await page.goto(fallbackArk, { waitUntil: 'networkidle2', timeout: 30000 });
            await new Promise(r => setTimeout(r,4000));
            results.individualRecord = await capturePage(page, '4_individual_record_ark',
                'Individual record page (fallback ARK)');
        }

        // ─────────────────────────────────────────────────────────
        // 5. TREE PERSON SEARCH (Find a Person in Family Tree)
        // ─────────────────────────────────────────────────────────
        console.log('\n[5/7] Tree Person Search');
        const treeSearchUrl = `https://www.familysearch.org/tree/find/name?search=1&givenName=${encodeURIComponent(TEST_SEARCH.givenName)}&surname=${encodeURIComponent(TEST_SEARCH.surname)}`;
        await page.goto(treeSearchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(r => setTimeout(r,5000));
        results.treeSearch = await capturePage(page, '5_tree_person_search',
            `Tree search: ${TEST_SEARCH.givenName} ${TEST_SEARCH.surname}`);

        // ─────────────────────────────────────────────────────────
        // 6. RESEARCH HINTS — check sparse tree person for hints
        // ─────────────────────────────────────────────────────────
        console.log('\n[6/7] Research Hints (on sparse tree person)');
        await page.goto(`https://www.familysearch.org/tree/person/details/${sparsePerson}`,
            { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(r => setTimeout(r,3000));
        // Scroll all the way down to find Research Hints section
        for (let scrollY = 0; scrollY <= 3000; scrollY += 500) {
            await page.evaluate((y) => window.scrollTo(0, y), scrollY);
            await new Promise(r => setTimeout(r,800));
        }
        results.researchHints = await capturePage(page, '6_research_hints',
            `Research hints on sparse tree — ${sparsePerson}`);

        // ─────────────────────────────────────────────────────────
        // 7. CAPTCHA / CHALLENGE PAGE — attempt to capture if we hit one
        // ─────────────────────────────────────────────────────────
        console.log('\n[7/7] CAPTCHA Detection Test');
        // We can't reliably trigger a CAPTCHA, but check current state
        const currentUrl = page.url();
        const isCaptcha = currentUrl.includes('challenge') || currentUrl.includes('captcha');
        if (isCaptcha) {
            results.captcha = await capturePage(page, '7_captcha_page', 'CAPTCHA/Challenge page detected!');
        } else {
            console.log('  No CAPTCHA currently detected. URL patterns to watch for:');
            console.log('  - URLs containing "challenge" or "captcha"');
            console.log('  - Redirect to ident.familysearch.org');
            console.log('  - Page with image puzzle or "verify you are human" text');

            // Save a note about CAPTCHA detection
            const captchaNote = {
                detected: false,
                currentUrl,
                knownPatterns: [
                    'URL contains "challenge"',
                    'URL contains "captcha"',
                    'Redirect to ident.familysearch.org',
                    'Body text contains "verify you are human"',
                    'Image CAPTCHA with redirect, then return to original page'
                ],
                note: 'CAPTCHA appears unpredictably. Must be detected programmatically after each page.goto(). Operator solves manually in Chrome window.'
            };
            const captchaDir = path.join(OUTPUT_DIR, `${TIMESTAMP}_7_captcha_info`);
            fs.mkdirSync(captchaDir, { recursive: true });
            fs.writeFileSync(path.join(captchaDir, 'captcha-notes.json'), JSON.stringify(captchaNote, null, 2));
        }

    } catch (err) {
        console.error(`\n✗ Error during reconnaissance: ${err.message}`);
        // Capture whatever page we're on when the error happened
        try {
            await capturePage(page, 'ERROR_page', `Error state — ${err.message.substring(0, 80)}`);
        } catch (_) {}
    } finally {
        await page.close();
        await browser.disconnect();
    }

    // ─────────────────────────────────────────────────────────
    // SUMMARY REPORT
    // ─────────────────────────────────────────────────────────
    console.log('\n\n' + '═'.repeat(60));
    console.log('   RECONNAISSANCE SUMMARY');
    console.log('═'.repeat(60));

    const summary = {};
    for (const [key, result] of Object.entries(results)) {
        if (!result?.domReport) continue;
        const dr = result.domReport;
        summary[key] = {
            title: result.title,
            bodyChars: dr.bodyTextLength,
            fsIds: result.fsIds?.length || 0,
            personLinks: dr.personLinkCount,
            arkLinks: dr.arkLinkCount,
            tables: dr.tableCount,
            testIds: dr.dataTestIds?.length || 0,
            sections: [
                dr.hasFamilyMembers && 'FamilyMembers',
                dr.hasParentsAndSiblings && 'Parents',
                dr.hasRecordHints && 'Hints',
                dr.hasSearchResults && 'SearchResults',
                dr.hasRecordDetails && 'RecordDetails',
                dr.hasFatherField && 'Father',
                dr.hasMotherField && 'Mother',
                dr.hasCaptcha && 'CAPTCHA',
            ].filter(Boolean)
        };
        console.log(`\n  ${key}:`);
        console.log(`    ${summary[key].title}`);
        console.log(`    FS IDs: ${summary[key].fsIds}, Person links: ${summary[key].personLinks}, ARK links: ${summary[key].arkLinks}`);
        console.log(`    Sections: ${summary[key].sections.join(', ') || 'none'}`);
        console.log(`    data-testids: ${summary[key].testIds}, tables: ${summary[key].tables}`);
    }

    const summaryPath = path.join(OUTPUT_DIR, `${TIMESTAMP}_summary.json`);
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

    console.log(`\n  Full output: ${OUTPUT_DIR}`);
    console.log(`  Summary: ${summaryPath}`);
    console.log('\n  NEXT STEPS:');
    console.log('  1. Review screenshots in debug/familysearch-pages/');
    console.log('  2. Check dom-report.json for usable selectors (data-testid, aria-label)');
    console.log('  3. Check body-text.txt for extractable patterns');
    console.log('  4. Use findings to implement searchFamilySearchRecords() and extractParentsFromRecord()');
    console.log('═'.repeat(60) + '\n');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
