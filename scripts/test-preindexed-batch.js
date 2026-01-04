/**
 * Batch test of pre-indexed extraction on multiple pages
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

// Test URLs from different Arkansas counties
const TEST_URLS = [
    { county: 'Ashley', ocrName: 'Ptolerny T Harris', url: 'https://www.familysearch.org/ark:/61903/3:1:33S7-9YBJ-V5N?cc=3161105&wc=8B8Q-4WL%3A1610342401%2C1610445101%2C1610345201' },
    { county: 'Bradley', ocrName: 'Benjamin W Martins', url: 'https://www.familysearch.org/ark:/61903/3:1:33SQ-GYBJ-KZ3?cc=3161105&wc=8BNM-SP8%3A1610342401%2C1610446601%2C1610446701' },
    { county: 'Cherokee Nation', ocrName: 'Bryant Ward', url: 'https://www.familysearch.org/ark:/61903/3:1:33SQ-GYBP-NSP?cc=3161105&wc=81YT-JWL%3A1610342401%2C1610352301%2C1610354601' },
    { county: 'Chicot', ocrName: 'Saml R Walker', url: 'https://www.familysearch.org/ark:/61903/3:1:33S7-9YBJ-P4S?cc=3161105&wc=81VM-C68%3A1610342401%2C1610448201%2C1610448601' },
    { county: 'Clark', ocrName: 'Grunis Marton', url: 'https://www.familysearch.org/ark:/61903/3:1:33SQ-GYBJ-PHY?cc=3161105&wc=8BNM-C68%3A1610342401%2C1610632401%2C1610449201' },
    { county: 'Columbia', ocrName: 'William Godbott', url: 'https://www.familysearch.org/ark:/61903/3:1:33SQ-GYBJ-G1X?cc=3161105&wc=8BVX-MNL%3A1610342401%2C1610359901%2C1610347801' },
    { county: 'Conway', ocrName: 'Ala Kafandall', url: 'https://www.familysearch.org/ark:/61903/3:1:33S7-9YBJ-GP3?cc=3161105&wc=DM45-SP8%3A1610342401%2C1610732601%2C1610732701' },
    { county: 'Crawford', ocrName: 'Mink Before', url: 'https://www.familysearch.org/ark:/61903/3:1:33S7-9YBJ-GJW?cc=3161105&wc=8B1N-4WL%3A1610342401%2C1610733301%2C1610344801' },
    { county: 'Crittenden', ocrName: 'Las Martin', url: 'https://www.familysearch.org/ark:/61903/3:1:33SQ-GYBJ-GPY?cc=3161105&wc=8113-MNL%3A1610342401%2C1610632701%2C1610644001' },
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
        waitUntil: 'networkidle2',
        timeout: 30000
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

async function extractPreIndexedData(url) {
    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 3000));

        const data = await page.evaluate(() => {
            const result = { owners: [], enslaved: [], hasData: false };
            const allRows = document.querySelectorAll('tr, [role="row"]');
            let currentOwner = null;

            allRows.forEach(row => {
                const cells = row.querySelectorAll('td, [role="cell"], span');
                const rowText = row.textContent || '';

                if (rowText.includes('Owner') || rowText.includes('Slave')) {
                    result.hasData = true;

                    let name = '', sex = '', age = null, status = '';

                    cells.forEach(cell => {
                        const text = cell.textContent.trim();
                        if (text === 'Owner' || text === 'Slave') status = text;
                        else if (text === 'Male' || text === 'Female') sex = text;
                        else if (text.match(/^\d{1,3}\s*years?$/i)) age = parseInt(text);
                        else if (text.length > 2 && !text.match(/^(ATTACH|More|years?|\d+)$/i)) {
                            if (!name) name = text;
                        }
                    });

                    if (status === 'Owner' && name) {
                        currentOwner = name;
                        result.owners.push(name);
                    } else if (status === 'Slave') {
                        result.enslaved.push({ sex, age, owner: currentOwner });
                    }
                }
            });

            return result;
        });

        return data;
    } catch (e) {
        return { owners: [], enslaved: [], hasData: false, error: e.message };
    }
}

async function main() {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log('   BATCH TEST: Pre-Indexed Extraction on 9 Arkansas Pages');
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log('');

    await initBrowser();
    await checkLogin();

    const results = [];

    for (let i = 0; i < TEST_URLS.length; i++) {
        const test = TEST_URLS[i];
        console.log(`[${i + 1}/${TEST_URLS.length}] ${test.county}`);
        console.log(`   OCR captured: "${test.ocrName}"`);

        const data = await extractPreIndexedData(test.url);

        if (data.hasData) {
            console.log(`   ✅ Pre-indexed: ${data.owners.length} owners, ${data.enslaved.length} enslaved`);
            console.log(`   First 3 owners: ${data.owners.slice(0, 3).join(', ')}`);
        } else {
            console.log(`   ❌ No pre-indexed data found`);
        }
        console.log('');

        results.push({
            county: test.county,
            ocrName: test.ocrName,
            hasPreIndexed: data.hasData,
            owners: data.owners.length,
            enslaved: data.enslaved.length,
            firstOwners: data.owners.slice(0, 5)
        });
    }

    await browser.close();

    // Summary
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log('   SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log('');

    const withData = results.filter(r => r.hasPreIndexed).length;
    const withoutData = results.filter(r => !r.hasPreIndexed).length;
    const totalOwners = results.reduce((sum, r) => sum + r.owners, 0);
    const totalEnslaved = results.reduce((sum, r) => sum + r.enslaved, 0);

    console.log(`Pages with pre-indexed data: ${withData}/${results.length}`);
    console.log(`Pages without pre-indexed data: ${withoutData}/${results.length}`);
    console.log(`Total owners extracted: ${totalOwners}`);
    console.log(`Total enslaved extracted: ${totalEnslaved}`);
    console.log('');

    console.log('Per-page comparison:');
    console.log('─────────────────────────────────────────────────────────────────────');
    console.log('County            | OCR Name              | Pre-indexed | Owners | Enslaved');
    console.log('─────────────────────────────────────────────────────────────────────');

    results.forEach(r => {
        const county = r.county.padEnd(17);
        const ocr = r.ocrName.substring(0, 20).padEnd(21);
        const hasData = r.hasPreIndexed ? '✅ YES' : '❌ NO ';
        const owners = String(r.owners).padStart(6);
        const enslaved = String(r.enslaved).padStart(8);
        console.log(`${county} | ${ocr} | ${hasData}     | ${owners} | ${enslaved}`);
    });

    console.log('');
}

main().catch(console.error);
