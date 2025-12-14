/**
 * Test FamilySearch OCR - Single Document Test
 *
 * Takes screenshot of FamilySearch document and OCRs it with Google Vision
 *
 * Usage:
 *   GOOGLE_VISION_API_KEY=... node scripts/test-fs-ocr.js
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');

puppeteer.use(StealthPlugin());

const GOOGLE_VISION_API_KEY = process.env.GOOGLE_VISION_API_KEY;

// Target document from user
const TARGET_URL = 'https://www.familysearch.org/ark:/61903/3:1:3QHV-R3G9-PBH9?i=119&cat=559181';

async function performOCR(imageBuffer) {
    console.log(`\n📷 Preparing image for OCR (${Math.round(imageBuffer.length / 1024)}KB)...`);

    // Resize for optimal OCR
    const resizedBuffer = await sharp(imageBuffer)
        .resize(2500, null, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();

    console.log(`   Resized to ${Math.round(resizedBuffer.length / 1024)}KB`);

    console.log('🔍 Calling Google Vision API...');
    const response = await axios.post(
        `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_VISION_API_KEY}`,
        {
            requests: [{
                image: { content: resizedBuffer.toString('base64') },
                features: [{ type: 'DOCUMENT_TEXT_DETECTION' }]
            }]
        },
        { timeout: 120000 }
    );

    const text = response.data.responses[0]?.fullTextAnnotation?.text || '';
    return text;
}

function parseForEnslavedNames(text) {
    console.log('\n👥 Parsing for enslaved persons...\n');

    // African day names and common enslaved names
    const africanDayNames = [
        'Quash', 'Quashee', 'Cudjoe', 'Cudjo', 'Cuffee', 'Cuffy',
        'Quaco', 'Kwaku', 'Juba', 'Phibba', 'Phoebe', 'Abba',
        'Cuba', 'Mingo', 'Sambo', 'Cato', 'Pompey', 'Caesar',
        'Scipio', 'Prince', 'Fortune', 'July', 'Monday', 'Friday',
        'Phillis', 'Dinah', 'Beck', 'Betty', 'Nancy', 'Hannah',
        'Rachel', 'Leah', 'Sarah', 'Chloe', 'Sukey', 'Nelly',
        'Jack', 'Tom', 'Peter', 'Moses', 'Sam', 'Harry', 'Joe',
        'Ben', 'Will', 'Dick', 'Bob', 'George', 'Charles', 'Jim',
        'Frank', 'Henry', 'Isaac', 'Jacob', 'Abraham', 'Daniel'
    ];

    const found = [];

    // Look for names in the text
    for (const name of africanDayNames) {
        const regex = new RegExp(`\\b${name}\\b`, 'gi');
        const matches = text.match(regex);
        if (matches) {
            // Get context
            const idx = text.toLowerCase().indexOf(name.toLowerCase());
            const start = Math.max(0, idx - 30);
            const end = Math.min(text.length, idx + name.length + 30);
            const context = text.slice(start, end).replace(/\n/g, ' ');

            found.push({
                name: name,
                count: matches.length,
                context: context
            });
        }
    }

    // Also look for "negro" patterns
    const negroPattern = /\b(?:negro|negroe|slave|servant)\s+([A-Z][a-z]+)/gi;
    let match;
    while ((match = negroPattern.exec(text)) !== null) {
        const name = match[1];
        if (!found.find(f => f.name.toLowerCase() === name.toLowerCase())) {
            found.push({
                name: name,
                count: 1,
                context: text.slice(Math.max(0, match.index - 20), match.index + match[0].length + 20).replace(/\n/g, ' ')
            });
        }
    }

    return found;
}

async function main() {
    if (!GOOGLE_VISION_API_KEY) {
        console.error('❌ GOOGLE_VISION_API_KEY required');
        process.exit(1);
    }

    console.log('======================================================================');
    console.log('🔍 FAMILYSEARCH SINGLE DOCUMENT OCR TEST');
    console.log('======================================================================');
    console.log(`Target: ${TARGET_URL}`);
    console.log('======================================================================\n');

    const userDataDir = path.join(process.cwd(), '.chrome-profile');

    console.log('🚀 Launching Chrome...');
    const browser = await puppeteer.launch({
        headless: false,
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        userDataDir: userDataDir,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--window-size=1920,1080',
            '--disable-infobars'
        ],
        ignoreDefaultArgs: ['--enable-automation'],
        defaultViewport: null
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    // Load cookies
    const cookieFile = './fs-cookies.json';
    if (fs.existsSync(cookieFile)) {
        const cookies = JSON.parse(fs.readFileSync(cookieFile, 'utf8'));
        await page.setCookie(...cookies);
        console.log(`✅ Loaded ${cookies.length} cookies`);
    }

    try {
        console.log('\n🔗 Navigating to document...');
        await page.goto(TARGET_URL, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        // Wait for page to settle
        console.log('⏳ Waiting for viewer to load...');
        await new Promise(r => setTimeout(r, 10000));

        // Check if logged in
        const currentUrl = page.url();
        if (currentUrl.includes('ident.familysearch') || currentUrl.includes('/auth/')) {
            console.log('\n⚠️  Not logged in! Please log in manually in the browser window...');
            console.log('   Waiting up to 3 minutes...\n');

            // Wait for login
            let attempts = 0;
            while (attempts < 90 && (page.url().includes('ident.') || page.url().includes('/auth/'))) {
                await new Promise(r => setTimeout(r, 2000));
                attempts++;
            }

            // Save new cookies
            const newCookies = await page.cookies();
            fs.writeFileSync(cookieFile, JSON.stringify(newCookies, null, 2));
            console.log(`💾 Saved ${newCookies.length} cookies`);

            // Navigate back to target
            await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await new Promise(r => setTimeout(r, 10000));
        }

        // Take screenshot
        console.log('\n📸 Taking screenshot of document...');
        const screenshot = await page.screenshot({
            type: 'png',
            fullPage: false
        });

        // Save screenshot for reference
        fs.writeFileSync('/tmp/fs-test-document.png', screenshot);
        console.log('   Saved to /tmp/fs-test-document.png');

        // Perform OCR
        const ocrText = await performOCR(screenshot);

        if (ocrText.length < 50) {
            console.log('\n⚠️  OCR returned very little text. The image might not have loaded.');
            console.log('   Let me try waiting longer and taking another screenshot...\n');

            await new Promise(r => setTimeout(r, 15000));

            const screenshot2 = await page.screenshot({ type: 'png', fullPage: false });
            fs.writeFileSync('/tmp/fs-test-document-2.png', screenshot2);
            const ocrText2 = await performOCR(screenshot2);

            if (ocrText2.length > ocrText.length) {
                console.log('\n✅ Second attempt got more text!\n');
                processResults(ocrText2);
            } else {
                console.log('\n❌ Still not much text. Please check /tmp/fs-test-document.png');
            }
        } else {
            processResults(ocrText);
        }

    } catch (error) {
        console.error(`\n❌ Error: ${error.message}`);
    } finally {
        console.log('\n🔒 Closing browser...');
        await browser.close();
    }
}

function processResults(ocrText) {
    console.log('\n======================================================================');
    console.log('📝 OCR TEXT EXTRACTED');
    console.log('======================================================================');
    console.log(`Total characters: ${ocrText.length}\n`);

    // Show first 2000 chars
    console.log('--- First 2000 characters ---');
    console.log(ocrText.substring(0, 2000));
    console.log('--- End preview ---\n');

    // Parse for names
    const enslavedNames = parseForEnslavedNames(ocrText);

    console.log('======================================================================');
    console.log('👥 ENSLAVED PERSONS FOUND');
    console.log('======================================================================');

    if (enslavedNames.length === 0) {
        console.log('No names matching known patterns found.');
        console.log('This might be a title page, index, or document without enslaved names.');
    } else {
        console.log(`Found ${enslavedNames.length} potential enslaved persons:\n`);
        for (const person of enslavedNames) {
            console.log(`  • ${person.name} (appears ${person.count}x)`);
            console.log(`    Context: "...${person.context}..."`);
            console.log('');
        }
    }

    // Save full OCR text
    fs.writeFileSync('/tmp/fs-ocr-text.txt', ocrText);
    console.log('\n📄 Full OCR text saved to /tmp/fs-ocr-text.txt');

    console.log('\n======================================================================');
    console.log('✅ TEST COMPLETE');
    console.log('======================================================================\n');
}

main();
