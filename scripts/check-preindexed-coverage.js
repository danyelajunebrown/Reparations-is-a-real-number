/**
 * Check pre-indexed data coverage - find pages WITHOUT pre-indexed data
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

const INTERACTIVE = process.env.FAMILYSEARCH_INTERACTIVE === 'true';

let browser = null;
let page = null;

const TEST_URLS = [
    'https://www.familysearch.org/ark:/61903/3:1:33S7-9YBP-NDD?cc=3161105',
    'https://www.familysearch.org/ark:/61903/3:1:33S7-9YBP-N8F?cc=3161105',
    'https://www.familysearch.org/ark:/61903/3:1:33SQ-GYBJ-GL8?cc=3161105',
    'https://www.familysearch.org/ark:/61903/3:1:33S7-9YBJ-GVQ?cc=3161105',
    'https://www.familysearch.org/ark:/61903/3:1:33S7-9YBJ-LGZ?cc=3161105',
    'https://www.familysearch.org/ark:/61903/3:1:33S7-9YBJ-G7C?cc=3161105',
    'https://www.familysearch.org/ark:/61903/3:1:33SQ-GYBJ-2ZF?cc=3161105',
    'https://www.familysearch.org/ark:/61903/3:1:33S7-9YBJ-V14?cc=3161105',
    'https://www.familysearch.org/ark:/61903/3:1:33SQ-GYBJ-21B?cc=3161105',
    'https://www.familysearch.org/ark:/61903/3:1:33S7-9YBJ-2DR?cc=3161105',
    'https://www.familysearch.org/ark:/61903/3:1:33S7-9YBP-NR7?cc=3161105',
    'https://www.familysearch.org/ark:/61903/3:1:33S7-9YBJ-KD8?cc=3161105',
    'https://www.familysearch.org/ark:/61903/3:1:33SQ-GYBP-FV4?cc=3161105',
    'https://www.familysearch.org/ark:/61903/3:1:33SQ-GYBP-NHH?cc=3161105',
    'https://www.familysearch.org/ark:/61903/3:1:33SQ-GYBJ-GQD?cc=3161105',
];

async function initBrowser() {
    const userDataDir = path.join(process.cwd(), '.chrome-profile');
    browser = await puppeteer.launch({
        headless: !INTERACTIVE,
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        userDataDir: userDataDir,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1200']
    });
    page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1200 });

    const cookiesPath = path.join(process.cwd(), 'fs-cookies.json');
    if (fs.existsSync(cookiesPath)) {
        const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
        await page.setCookie(...cookies);
    }
}

async function checkLogin() {
    await page.goto('https://www.familysearch.org/auth/familysearch/login', {
        waitUntil: 'networkidle2', timeout: 30000
    });
    await new Promise(r => setTimeout(r, 2000));

    if (page.url().includes('/auth/') || page.url().includes('/login')) {
        if (INTERACTIVE) {
            console.log('Please log in to FamilySearch...');
            await page.waitForFunction(
                () => !window.location.href.includes('/auth/') && !window.location.href.includes('/login'),
                { timeout: 300000 }
            );
            console.log('✅ Logged in');
        }
    }
}

async function checkForPreIndexedData(url) {
    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 2000));

        const hasData = await page.evaluate(() => {
            const pageText = document.body.textContent || '';
            // Check for indicators of pre-indexed data
            const hasOwner = pageText.includes('Owner');
            const hasSlave = pageText.includes('Slave');
            const hasImageIndex = pageText.includes('Image Index');

            // Also check for the actual data rows
            const rows = document.querySelectorAll('tr, [role="row"]');
            let dataRows = 0;
            rows.forEach(row => {
                const text = row.textContent || '';
                if (text.includes('Owner') || text.includes('Slave')) dataRows++;
            });

            return {
                hasOwner,
                hasSlave,
                hasImageIndex,
                dataRows,
                hasPreIndexedData: dataRows > 0
            };
        });

        return hasData;
    } catch (e) {
        return { error: e.message, hasPreIndexedData: false };
    }
}

async function main() {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('   CHECKING PRE-INDEXED DATA COVERAGE');
    console.log('   Looking for pages WITHOUT pre-indexed data...');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('');

    await initBrowser();
    await checkLogin();

    let withData = 0;
    let withoutData = 0;
    const noDataPages = [];

    for (let i = 0; i < TEST_URLS.length; i++) {
        const url = TEST_URLS[i];
        const shortUrl = url.split('?')[0].split('/').pop();

        process.stdout.write(`[${i + 1}/${TEST_URLS.length}] ${shortUrl}... `);

        const result = await checkForPreIndexedData(url);

        if (result.hasPreIndexedData) {
            withData++;
            console.log(`✅ Has data (${result.dataRows} rows)`);
        } else {
            withoutData++;
            noDataPages.push(url);
            console.log(`❌ NO DATA`);
        }
    }

    await browser.close();

    console.log('');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('   RESULTS');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('');
    console.log(`Pages WITH pre-indexed data:    ${withData}/${TEST_URLS.length} (${Math.round(withData/TEST_URLS.length*100)}%)`);
    console.log(`Pages WITHOUT pre-indexed data: ${withoutData}/${TEST_URLS.length} (${Math.round(withoutData/TEST_URLS.length*100)}%)`);
    console.log('');

    if (noDataPages.length > 0) {
        console.log('Pages without pre-indexed data (need OCR fallback):');
        noDataPages.forEach((url, i) => {
            console.log(`  ${i + 1}. ${url}`);
        });
    } else {
        console.log('🎉 ALL pages have pre-indexed data!');
        console.log('   OCR fallback may not be needed for 1860 Slave Schedule.');
    }
    console.log('');
}

main().catch(console.error);
