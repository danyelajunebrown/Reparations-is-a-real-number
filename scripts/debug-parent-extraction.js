/**
 * Debug Parent Extraction
 * 
 * Tests parent extraction on a specific FamilySearch page to see what's being found
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { spawn } = require('child_process');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const PERSON_PAGE_URL = 'https://www.familysearch.org/en/tree/person/details/';

async function debugParentExtraction(fsId) {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('   DEBUG PARENT EXTRACTION');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`Testing FS ID: ${fsId}\n`);

    // Launch Chrome
    const tempProfileDir = '/tmp/familysearch-debug';
    if (!fs.existsSync(tempProfileDir)) {
        fs.mkdirSync(tempProfileDir, { recursive: true });
    }

    const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
        '--remote-debugging-port=9222',
        `--user-data-dir=${tempProfileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=1200,900'
    ], { detached: true, stdio: 'ignore' });

    chromeProcess.unref();

    await new Promise(r => setTimeout(r, 3000));

    const browser = await puppeteer.connect({
        browserURL: 'http://127.0.0.1:9222',
        defaultViewport: null
    });

    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();

    // Navigate
    const url = PERSON_PAGE_URL + fsId;
    console.log(`Navigating to: ${url}\n`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 3000));

    // Check login
    if (page.url().includes('ident.familysearch') || page.url().includes('/auth/')) {
        console.log('⚠️  Please log in manually, then press Enter...');
        await new Promise(resolve => {
            process.stdin.once('data', resolve);
        });
    }

    // Scroll to load Family Members section
    await page.evaluate(() => {
        window.scrollTo(0, 500);
    });
    await new Promise(r => setTimeout(r, 1000));

    await page.evaluate(() => {
        window.scrollTo(0, 1000);
    });
    await new Promise(r => setTimeout(r, 1000));

    // Extract data
    const result = await page.evaluate(() => {
        const debug = {
            pageTitleActual: document.title,
            url: window.location.href,
            bodyTextSample: document.body.innerText.substring(0, 500),
            parentsSection: null,
            allFsIds: [],
            allLinks: []
        };

        // Check for Parents and Siblings section
        const parentsMatch = document.body.innerText.match(/Parents and Siblings([\s\S]{0,500})/i);
        if (parentsMatch) {
            debug.parentsSection = parentsMatch[0];
        }

        // Find all FS IDs in page text
        const fsIdPattern = /([A-Z0-9]{4}-[A-Z0-9]{2,4})/g;
        const pageText = document.body.innerText;
        let match;
        while ((match = fsIdPattern.exec(pageText)) !== null) {
            if (!debug.allFsIds.includes(match[1])) {
                debug.allFsIds.push(match[1]);
            }
        }

        // Find all person detail links
        const links = document.querySelectorAll('a[href*="/tree/person/details/"]');
        links.forEach(link => {
            const href = link.getAttribute('href');
            const text = link.textContent.trim();
            const idMatch = href.match(/details\/([A-Z0-9]{4}-[A-Z0-9]{2,4})/);
            if (idMatch) {
                debug.allLinks.push({
                    id: idMatch[1],
                    text: text.substring(0, 50),
                    href: href
                });
            }
        });

        return debug;
    });

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('   EXTRACTION DEBUG RESULTS');
    console.log('═══════════════════════════════════════════════════════════════\n');

    console.log('📄 Page Title:', result.pageTitleActual);
    console.log('🔗 URL:', result.url);
    console.log('');

    console.log('👥 Parents Section Found:', result.parentsSection ? 'YES' : 'NO');
    if (result.parentsSection) {
        console.log('Content:', result.parentsSection.substring(0, 200));
    }
    console.log('');

    console.log(`🆔 All FS IDs Found on Page: ${result.allFsIds.length}`);
    result.allFsIds.forEach((id, i) => {
        console.log(`   ${i + 1}. ${id}`);
    });
    console.log('');

    console.log(`🔗 Person Detail Links Found: ${result.allLinks.length}`);
    result.allLinks.forEach((link, i) => {
        console.log(`   ${i + 1}. ${link.id} - "${link.text}"`);
    });
    console.log('');

    console.log('📝 Body Text Sample:');
    console.log(result.bodyTextSample);
    console.log('');

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('   DIAGNOSIS');
    console.log('═══════════════════════════════════════════════════════════════\n');

    // Analyze
    const thisPersonId = fsId;
    const parentIds = result.allFsIds.filter(id => id !== thisPersonId);

    if (parentIds.length === 0) {
        console.log('❌ NO PARENT IDs FOUND');
        console.log('   Possible causes:');
        console.log('   - Person has no parents linked on FamilySearch');
        console.log('   - Page structure changed');
        console.log('   - Need to be logged in to see family');
    } else if (parentIds.length === 1) {
        console.log('⚠️  ONLY 1 PARENT ID FOUND');
        console.log(`   Parent ID: ${parentIds[0]}`);
        console.log('   This person may have only one parent linked');
    } else {
        console.log('✅ PARENT IDs FOUND');
        console.log(`   Likely parents: ${parentIds.slice(0, 2).join(', ')}`);
        console.log(`   Total other IDs: ${parentIds.length}`);
    }

    await browser.disconnect();
}

// Get FS ID from command line
const fsId = process.argv[2];

if (!fsId) {
    console.log('Usage: node scripts/debug-parent-extraction.js <FS_ID>');
    console.log('Example: node scripts/debug-parent-extraction.js LR87-Q4Y');
    process.exit(1);
}

debugParentExtraction(fsId).catch(console.error);
