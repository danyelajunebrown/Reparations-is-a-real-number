/**
 * Inspect Page Structure
 * Analyzes a FamilySearch page to find the best way to extract the person's name
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { spawn } = require('child_process');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const PERSON_PAGE_URL = 'https://www.familysearch.org/en/tree/person/details/';

async function inspectPage(fsId) {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('   PAGE STRUCTURE INSPECTOR');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`Inspecting: ${fsId}\n`);

    // Launch Chrome
    const tempProfileDir = '/tmp/familysearch-inspector';
    if (!fs.existsSync(tempProfileDir)) {
        fs.mkdirSync(tempProfileDir, { recursive: true });
    }

    const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
        '--remote-debugging-port=9223',
        `--user-data-dir=${tempProfileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=1200,900'
    ], { detached: true, stdio: 'ignore' });

    chromeProcess.unref();
    await new Promise(r => setTimeout(r, 3000));

    const browser = await puppeteer.connect({
        browserURL: 'http://127.0.0.1:9223',
        defaultViewport: null
    });

    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();

    // Navigate
    const url = PERSON_PAGE_URL + fsId;
    console.log(`Navigating to: ${url}\n`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 3000));

    // Extract detailed page structure
    const structure = await page.evaluate(() => {
        const result = {
            title: document.title,
            h1Elements: [],
            mainContentText: null,
            personVitals: null,
            structuredData: null,
            allH1s: [],
            allH2s: [],
            bodyInnerTextSample: document.body.innerText.substring(0, 500)
        };

        // Find all H1 elements
        const h1s = document.querySelectorAll('h1');
        h1s.forEach(h1 => {
            result.allH1s.push({
                text: h1.innerText,
                className: h1.className,
                id: h1.id
            });
        });

        // Find all H2 elements
        const h2s = document.querySelectorAll('h2');
        h2s.forEach(h2 => {
            result.allH2s.push({
                text: h2.innerText.substring(0, 100),
                className: h2.className
            });
        });

        // Try to find main content area
        const mainContent = document.querySelector('main') || 
                          document.querySelector('[role="main"]') ||
                          document.querySelector('.main-content');
        if (mainContent) {
            result.mainContentText = mainContent.innerText.substring(0, 300);
        }

        // Look for person vitals/details sections
        const vitalsSelectors = [
            '[data-test="person-vitals"]',
            '.person-vitals',
            '.person-details',
            '[data-testid="person-vitals"]'
        ];
        
        for (const selector of vitalsSelectors) {
            const element = document.querySelector(selector);
            if (element) {
                result.personVitals = {
                    selector,
                    text: element.innerText.substring(0, 200)
                };
                break;
            }
        }

        // Check for JSON-LD structured data
        const jsonLd = document.querySelector('script[type="application/ld+json"]');
        if (jsonLd) {
            try {
                result.structuredData = JSON.parse(jsonLd.textContent);
            } catch (e) {}
        }

        return result;
    });

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('   PAGE STRUCTURE ANALYSIS');
    console.log('═══════════════════════════════════════════════════════════════\n');

    console.log('📄 Page Title:', structure.title);
    console.log('');

    console.log('🏷️  H1 Elements Found:', structure.allH1s.length);
    structure.allH1s.forEach((h1, i) => {
        console.log(`   ${i + 1}. "${h1.text}"`);
        if (h1.className) console.log(`      Class: ${h1.className}`);
        if (h1.id) console.log(`      ID: ${h1.id}`);
    });
    console.log('');

    console.log('📋 H2 Elements Found:', structure.allH2s.length);
    structure.allH2s.slice(0, 5).forEach((h2, i) => {
        console.log(`   ${i + 1}. "${h2.text}"`);
    });
    console.log('');

    if (structure.mainContentText) {
        console.log('📦 Main Content Area:');
        console.log(structure.mainContentText);
        console.log('');
    }

    if (structure.personVitals) {
        console.log('👤 Person Vitals Section:');
        console.log(`   Selector: ${structure.personVitals.selector}`);
        console.log(`   Text: ${structure.personVitals.text}`);
        console.log('');
    }

    console.log('📝 Body InnerText Sample (first 500 chars):');
    console.log(structure.bodyInnerTextSample);
    console.log('');

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('   RECOMMENDATIONS');
    console.log('═══════════════════════════════════════════════════════════════\n');

    if (structure.allH1s.length > 0) {
        const firstH1 = structure.allH1s[0];
        console.log('✅ Best extraction method: H1 element');
        console.log(`   Selector: document.querySelector('h1')`);
        console.log(`   Text: "${firstH1.text}"`);
        
        // Check if H1 contains the person name (vs UI garbage)
        if (firstH1.text.includes('\n') || firstH1.text.includes('Family Tree')) {
            console.log('   ⚠️  WARNING: H1 contains UI garbage!');
            console.log('   Need to use a more specific selector or filter');
        }
    }

    if (structure.personVitals) {
        console.log('✅ Alternative: Person vitals section');
        console.log(`   Selector: ${structure.personVitals.selector}`);
    }

    await browser.disconnect();
}

const fsId = process.argv[2] || 'G21Y-X4B';
inspectPage(fsId).catch(console.error);
