/**
 * FamilySearch Full Document Processor
 *
 * Processes entire Thomas Porcher Ravenel Papers (970 images)
 * Uses Google Vision OCR with proper document waiting
 *
 * Usage:
 *   GOOGLE_VISION_API_KEY=... node scripts/test-fs-full-document.js [startImage] [endImage]
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');

puppeteer.use(StealthPlugin());

const GOOGLE_VISION_API_KEY = process.env.GOOGLE_VISION_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

// Film details
const FILM_NUMBER = '008891444';
const COLLECTION_NAME = 'Thomas Porcher Ravenel papers, 1731-1867';
const TOTAL_IMAGES = 970;
const BASE_URL = 'https://www.familysearch.org/ark:/61903/3:1:3QHV-R3G9-PBH9';

// Parse command line args
const START_IMAGE = parseInt(process.argv[2]) || 1;
const END_IMAGE = parseInt(process.argv[3]) || TOTAL_IMAGES;

// Results storage
const results = {
    totalProcessed: 0,
    totalWithText: 0,
    totalNames: 0,
    errors: [],
    findings: []
};

async function performOCR(imageBuffer, imageNum) {
    console.log(`   📷 OCR on image ${imageNum} (${Math.round(imageBuffer.length / 1024)}KB)...`);

    try {
        // Resize for optimal OCR - keep high res for handwritten text
        const resizedBuffer = await sharp(imageBuffer)
            .resize(3000, null, { fit: 'inside', withoutEnlargement: true })
            .sharpen()
            .png()
            .toBuffer();

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
    } catch (error) {
        console.log(`   ⚠️ OCR error: ${error.message}`);
        return '';
    }
}

function parseForEnslavedNames(text, imageNum) {
    // African day names and common enslaved names
    const enslavedNames = [
        // African day names
        'Quash', 'Quashee', 'Cudjoe', 'Cudjo', 'Cuffee', 'Cuffy', 'Quaco', 'Kwaku',
        'Juba', 'Phibba', 'Phoebe', 'Abba', 'Cuba', 'Mingo', 'Sambo', 'Cato',
        'Pompey', 'Caesar', 'Scipio', 'Prince', 'Fortune', 'July', 'Monday', 'Friday',
        // Common enslaved women's names
        'Phillis', 'Dinah', 'Beck', 'Betty', 'Nancy', 'Hannah', 'Rachel', 'Leah',
        'Sarah', 'Chloe', 'Sukey', 'Nelly', 'Venus', 'Violet', 'Rose', 'Charity',
        'Patience', 'Silvia', 'Daphne', 'Flora', 'Jenny', 'Judy', 'Lucy', 'Molly',
        'Peggy', 'Sary', 'Bess', 'Hagar', 'Tena', 'Minda', 'Clarissa',
        // Common enslaved men's names
        'Jack', 'Tom', 'Peter', 'Moses', 'Sam', 'Harry', 'Joe', 'Ben', 'Will',
        'Dick', 'Bob', 'George', 'Charles', 'Jim', 'Frank', 'Henry', 'Isaac',
        'Jacob', 'Abraham', 'Daniel', 'Ned', 'Robin', 'Tony', 'Primus', 'Bristol',
        'London', 'York', 'Dublin', 'Glasgow', 'Limerick', 'Toby', 'Stepney',
        'Sharper', 'Smart', 'Bacchus', 'Jupiter', 'Hercules', 'Neptune', 'Plato'
    ];

    const found = [];

    // Look for names in the text
    for (const name of enslavedNames) {
        const regex = new RegExp(`\\b${name}\\b`, 'gi');
        const matches = text.match(regex);
        if (matches) {
            // Get all contexts
            let searchText = text;
            let idx = 0;
            while ((idx = searchText.toLowerCase().indexOf(name.toLowerCase())) !== -1) {
                const start = Math.max(0, idx - 50);
                const end = Math.min(searchText.length, idx + name.length + 50);
                const context = searchText.slice(start, end).replace(/\n/g, ' ').trim();

                found.push({
                    name: name,
                    context: context,
                    imageNumber: imageNum
                });

                searchText = searchText.slice(idx + name.length);
            }
        }
    }

    // Also look for "negro/slave" patterns
    const patterns = [
        /\b(?:negro|negroe?s?|slave|enslaved|servant)\s+(?:man\s+|woman\s+|boy\s+|girl\s+|named\s+)?([A-Z][a-z]+)/gi,
        /\b([A-Z][a-z]+)\s+(?:a\s+)?(?:negro|negroe?|slave)/gi,
        /\bmy\s+(?:negro|slave)\s+([A-Z][a-z]+)/gi
    ];

    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const name = match[1];
            if (name && name.length > 2 && !found.find(f => f.name.toLowerCase() === name.toLowerCase() && f.imageNumber === imageNum)) {
                const start = Math.max(0, match.index - 30);
                const end = Math.min(text.length, match.index + match[0].length + 30);
                const context = text.slice(start, end).replace(/\n/g, ' ').trim();

                found.push({
                    name: name,
                    context: context,
                    imageNumber: imageNum
                });
            }
        }
    }

    // Look for slave counts
    const countPatterns = [
        /(\d+)\s*(?:negro(?:e?s)?|slave(?:s)?|head)/gi,
        /(?:negro(?:e?s)?|slave(?:s)?)\s*[:=]?\s*(\d+)/gi
    ];

    for (const pattern of countPatterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const count = parseInt(match[1] || match[2]);
            if (count > 0 && count < 500) {
                const start = Math.max(0, match.index - 40);
                const end = Math.min(text.length, match.index + match[0].length + 40);
                const context = text.slice(start, end).replace(/\n/g, ' ').trim();

                found.push({
                    name: `[${count} enslaved persons]`,
                    context: context,
                    imageNumber: imageNum,
                    isCount: true,
                    count: count
                });
            }
        }
    }

    return found;
}

async function waitForDocumentLoad(page) {
    // Click on the viewer area to ensure it's focused
    try {
        await page.click('.image-viewer, .filmstrip-viewer, [class*="viewer"]', { timeout: 5000 });
    } catch (e) {
        // OK if no click target
    }

    // Wait for image tiles to load
    await new Promise(r => setTimeout(r, 3000));

    // Check if we see document content (not just UI)
    const hasDocumentContent = await page.evaluate(() => {
        // Look for canvas elements which typically hold the rendered document
        const canvases = document.querySelectorAll('canvas');
        for (const canvas of canvases) {
            if (canvas.width > 500 && canvas.height > 500) {
                return true;
            }
        }
        // Or look for large images
        const images = document.querySelectorAll('img');
        for (const img of images) {
            if (img.naturalWidth > 500 && img.naturalHeight > 500) {
                return true;
            }
        }
        return false;
    });

    if (!hasDocumentContent) {
        // Wait longer if no large content detected
        await new Promise(r => setTimeout(r, 5000));
    }
}

async function navigateToImage(page, imageNum, isFirstImage = false) {
    console.log(`\n📄 Image ${imageNum}/${END_IMAGE} - Navigating...`);

    try {
        // For first image, navigate to base URL first
        if (isFirstImage) {
            const url = `${BASE_URL}?cat=559181`;
            await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: 60000
            });
            await new Promise(r => setTimeout(r, 8000)); // Wait longer for initial load
        }

        // Find and use the image number input field to navigate
        // Try multiple selectors to find the input
        let imageInput = await page.$('input[type="number"]');
        if (!imageInput) {
            imageInput = await page.$('input[aria-label*="image"]');
        }
        if (!imageInput) {
            imageInput = await page.$('input[aria-label*="Image"]');
        }
        if (!imageInput) {
            // Try to find by looking at all inputs with numeric values
            imageInput = await page.evaluateHandle(() => {
                const inputs = document.querySelectorAll('input');
                for (const input of inputs) {
                    const val = parseInt(input.value);
                    if (val > 0 && val <= 1000 && input.offsetParent !== null) {
                        return input;
                    }
                }
                return null;
            });
            if (imageInput.asElement()) {
                imageInput = imageInput.asElement();
            } else {
                imageInput = null;
            }
        }

        if (imageInput) {
            // Clear the input field completely
            await imageInput.click({ clickCount: 3 }); // Select all
            await new Promise(r => setTimeout(r, 200));
            await page.keyboard.press('Backspace');
            await new Promise(r => setTimeout(r, 200));

            // Type the image number
            await imageInput.type(String(imageNum), { delay: 50 });
            await new Promise(r => setTimeout(r, 300));
            await page.keyboard.press('Enter');

            console.log(`   📝 Entered image ${imageNum} in navigation input`);

            // Wait for navigation to complete - watch for URL change or image update
            await new Promise(r => setTimeout(r, 5000));

            // Additional wait for tiles to load
            await page.waitForFunction(() => {
                const canvases = document.querySelectorAll('canvas');
                for (const canvas of canvases) {
                    if (canvas.width > 500 && canvas.height > 500) return true;
                }
                const images = document.querySelectorAll('img');
                for (const img of images) {
                    if (img.naturalWidth > 500) return true;
                }
                return false;
            }, { timeout: 15000 }).catch(() => {});

        } else {
            // Fallback: Use the next button to navigate from current position
            console.log(`   ⚠️ No input found, using next button navigation`);

            // Get current image number
            const currentNum = await page.evaluate(() => {
                const inputs = document.querySelectorAll('input');
                for (const input of inputs) {
                    const val = parseInt(input.value);
                    if (val > 0 && val <= 1000) return val;
                }
                return 1;
            });

            const stepsNeeded = imageNum - currentNum;
            if (stepsNeeded > 0) {
                for (let i = 0; i < stepsNeeded; i++) {
                    const nextButton = await page.$('button[aria-label*="next"], button[aria-label*="Next"], [class*="next-button"], a[aria-label*="next"], .next-arrow');
                    if (nextButton) {
                        await nextButton.click();
                        await new Promise(r => setTimeout(r, 1000));
                    }
                }
            }
        }

        // Wait for document to fully load
        await waitForDocumentLoad(page);
        await new Promise(r => setTimeout(r, 2000));

        // Verify we're on the right image
        const currentImageText = await page.evaluate(() => {
            const inputs = document.querySelectorAll('input[type="number"], input[type="text"], input');
            for (const input of inputs) {
                const val = parseInt(input.value);
                if (val > 0 && val <= 1000) return val;
            }
            // Also check URL
            const url = window.location.href;
            const match = url.match(/[?&]i=(\d+)/);
            if (match) return parseInt(match[1]) + 1; // i is 0-indexed
            return null;
        });

        if (currentImageText) {
            console.log(`   📍 Currently on image: ${currentImageText}`);
            if (parseInt(currentImageText) !== imageNum) {
                console.log(`   ⚠️ Navigation mismatch - expected ${imageNum}, got ${currentImageText}`);
                // Try one more time with direct URL navigation
                if (Math.abs(parseInt(currentImageText) - imageNum) > 5) {
                    console.log(`   🔄 Attempting URL-based navigation...`);
                    await page.goto(`${BASE_URL}?i=${imageNum - 1}&cat=559181`, {
                        waitUntil: 'domcontentloaded',
                        timeout: 30000
                    });
                    await new Promise(r => setTimeout(r, 8000));
                }
            }
        }

        return true;
    } catch (error) {
        console.log(`   ❌ Navigation error: ${error.message}`);
        return false;
    }
}

async function captureDocumentImage(page, imageNum) {
    // Try to find and isolate just the document viewer area
    const viewerSelector = await page.evaluate(() => {
        // Find the main viewer container
        const selectors = [
            '.image-viewer-container',
            '.filmstrip-image-viewer',
            '[class*="viewer-container"]',
            '[class*="image-viewer"]',
            '.main-viewer',
            '#viewer'
        ];

        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el && el.offsetWidth > 400 && el.offsetHeight > 400) {
                return selector;
            }
        }
        return null;
    });

    if (viewerSelector) {
        try {
            const element = await page.$(viewerSelector);
            if (element) {
                const screenshot = await element.screenshot({ type: 'png' });
                return screenshot;
            }
        } catch (e) {
            console.log(`   ⚠️ Element screenshot failed, using full page`);
        }
    }

    // Fall back to viewport screenshot
    const screenshot = await page.screenshot({
        type: 'png',
        fullPage: false,
        clip: {
            x: 0,
            y: 50,  // Skip top navigation
            width: 1920,
            height: 900  // Focus on document area
        }
    });

    return screenshot;
}

async function saveToDatabase(findings) {
    if (!DATABASE_URL || findings.length === 0) return;

    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

    try {
        for (const finding of findings) {
            if (finding.isCount) continue; // Skip count entries for now

            await pool.query(`
                INSERT INTO unconfirmed_persons (
                    full_name, source_type, source_url, context_text,
                    locations, extraction_method, person_type, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                ON CONFLICT DO NOTHING
            `, [
                finding.name,
                'familysearch_scrape',
                `https://www.familysearch.org/ark:/61903/3:1:3QHV-R3G9-PBH9?i=${finding.imageNumber - 1}`,
                finding.context,
                ['Charleston County', 'South Carolina'],  // Ravenel papers are from Charleston area
                'ocr_scrape',
                'enslaved'
            ]);
        }
        console.log(`   💾 Saved ${findings.length} findings to database`);
    } catch (error) {
        console.log(`   ⚠️ Database save error: ${error.message}`);
    } finally {
        await pool.end();
    }
}

async function main() {
    if (!GOOGLE_VISION_API_KEY) {
        console.error('❌ GOOGLE_VISION_API_KEY required');
        process.exit(1);
    }

    console.log('======================================================================');
    console.log('📚 FAMILYSEARCH FULL DOCUMENT PROCESSOR');
    console.log('======================================================================');
    console.log(`Collection: ${COLLECTION_NAME}`);
    console.log(`Film: ${FILM_NUMBER}`);
    console.log(`Processing images: ${START_IMAGE} to ${END_IMAGE}`);
    console.log(`Total to process: ${END_IMAGE - START_IMAGE + 1} images`);
    console.log('======================================================================\n');

    const userDataDir = path.join(process.cwd(), '.chrome-profile');

    console.log('🚀 Launching Chrome with persistent profile...');
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

    // Initial navigation to check login
    console.log('\n🔗 Checking authentication...');
    await page.goto(`${BASE_URL}?i=0&cat=559181`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000
    });
    await new Promise(r => setTimeout(r, 5000));

    // Check if logged in
    let currentUrl = page.url();
    if (currentUrl.includes('ident.familysearch') || currentUrl.includes('/auth/') ||
        currentUrl.includes('accounts.google') || currentUrl.includes('signin')) {
        console.log('\n⚠️  LOGIN REQUIRED!');
        console.log('   Please log in manually in the browser window...');
        console.log('   Waiting up to 5 minutes for authentication...\n');

        let attempts = 0;
        while (attempts < 150) {
            await new Promise(r => setTimeout(r, 2000));
            currentUrl = page.url();

            if (currentUrl.includes('familysearch.org/ark') && !currentUrl.includes('ident.')) {
                console.log('✅ Login detected!');
                break;
            }
            attempts++;

            if (attempts % 15 === 0) {
                console.log(`   Still waiting... (${Math.round(attempts * 2 / 60)} min elapsed)`);
            }
        }

        // Save new cookies
        const newCookies = await page.cookies();
        fs.writeFileSync(cookieFile, JSON.stringify(newCookies, null, 2));
        console.log(`💾 Saved ${newCookies.length} cookies for future use`);
    }

    // Process each image
    const batchSize = 10;
    let batchFindings = [];
    const startTime = Date.now();
    let isFirstNavigation = true;

    try {
        for (let imgNum = START_IMAGE; imgNum <= END_IMAGE; imgNum++) {
            const success = await navigateToImage(page, imgNum, isFirstNavigation);
            isFirstNavigation = false;

            if (!success) {
                results.errors.push({ image: imgNum, error: 'Navigation failed' });
                continue;
            }

            // Wait extra time for document to render
            await new Promise(r => setTimeout(r, 2000));

            // Capture the document
            const screenshot = await captureDocumentImage(page, imgNum);

            // Save every 50th screenshot for reference
            if (imgNum % 50 === 0 || imgNum === START_IMAGE) {
                fs.writeFileSync(`/tmp/fs-image-${imgNum}.png`, screenshot);
                console.log(`   📷 Reference screenshot saved: /tmp/fs-image-${imgNum}.png`);
            }

            // Perform OCR
            const ocrText = await performOCR(screenshot, imgNum);
            results.totalProcessed++;

            if (ocrText.length > 100) {
                results.totalWithText++;
                console.log(`   ✅ OCR: ${ocrText.length} chars extracted`);

                // Parse for names
                const findings = parseForEnslavedNames(ocrText, imgNum);

                if (findings.length > 0) {
                    console.log(`   👥 Found ${findings.length} potential enslaved persons`);
                    results.findings.push(...findings);
                    batchFindings.push(...findings);
                    results.totalNames += findings.filter(f => !f.isCount).length;

                    // Show first few findings
                    for (const f of findings.slice(0, 3)) {
                        console.log(`      • ${f.name}: "${f.context.substring(0, 60)}..."`);
                    }
                }
            } else {
                console.log(`   ⚠️ Minimal text (${ocrText.length} chars) - may be blank page or image issue`);
            }

            // Save to database in batches
            if (batchFindings.length >= batchSize) {
                await saveToDatabase(batchFindings);
                batchFindings = [];
            }

            // Progress update every 10 images
            if (imgNum % 10 === 0) {
                const elapsed = (Date.now() - startTime) / 1000;
                const rate = results.totalProcessed / elapsed;
                const remaining = (END_IMAGE - imgNum) / rate;
                console.log(`\n📊 Progress: ${imgNum}/${END_IMAGE} (${Math.round((imgNum - START_IMAGE + 1) / (END_IMAGE - START_IMAGE + 1) * 100)}%)`);
                console.log(`   Rate: ${rate.toFixed(2)} images/sec`);
                console.log(`   ETA: ${Math.round(remaining / 60)} minutes\n`);
            }

            // Small delay between images to avoid rate limiting
            await new Promise(r => setTimeout(r, 500));
        }

        // Save any remaining findings
        if (batchFindings.length > 0) {
            await saveToDatabase(batchFindings);
        }

    } catch (error) {
        console.error(`\n❌ Fatal error: ${error.message}`);
        results.errors.push({ error: error.message });
    } finally {
        // Final report
        console.log('\n======================================================================');
        console.log('📊 FINAL REPORT');
        console.log('======================================================================');
        console.log(`Total images processed: ${results.totalProcessed}`);
        console.log(`Images with substantial text: ${results.totalWithText}`);
        console.log(`Total enslaved persons found: ${results.totalNames}`);
        console.log(`Total findings (including counts): ${results.findings.length}`);
        console.log(`Errors: ${results.errors.length}`);

        if (results.findings.length > 0) {
            // Deduplicate names
            const uniqueNames = [...new Set(results.findings.filter(f => !f.isCount).map(f => f.name))];
            console.log(`\nUnique names found: ${uniqueNames.length}`);
            console.log('Sample names:', uniqueNames.slice(0, 20).join(', '));
        }

        // Save full results
        const resultsFile = `/tmp/fs-results-${START_IMAGE}-${END_IMAGE}.json`;
        fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
        console.log(`\n📄 Full results saved to: ${resultsFile}`);

        console.log('\n🔒 Closing browser...');
        await browser.close();

        console.log('======================================================================');
        console.log('✅ PROCESSING COMPLETE');
        console.log('======================================================================\n');
    }
}

main();
