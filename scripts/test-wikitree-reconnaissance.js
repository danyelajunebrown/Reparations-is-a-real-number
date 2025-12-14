/**
 * Phase 0: WikiTree Reconnaissance
 * Explore WikiTree HTML structure to identify selectors for scraping
 * 
 * Test Case: James Hopewell (died ~1817)
 * WikiTree ID: Hopewell-183
 * URL: https://www.wikitree.com/wiki/Hopewell-183
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function exploreWikiTreeStructure() {
    console.log('========================================');
    console.log('Phase 0: WikiTree Reconnaissance');
    console.log('========================================\n');

    let browser;
    try {
        // Launch browser
        console.log('Launching Puppeteer browser...');
        browser = await puppeteer.launch({
            headless: false, // Set to false so we can see what's happening
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        // Navigate to James Hopewell's profile
        const url = 'https://www.wikitree.com/wiki/Hopewell-183';
        console.log(`\nNavigating to: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        console.log('✓ Page loaded successfully\n');

        // Extract basic profile information
        console.log('=== BASIC PROFILE INFO ===');
        const profileInfo = await page.evaluate(() => {
            const data = {};
            
            // Name
            const nameEl = document.querySelector('h1[itemprop="name"]');
            data.name = nameEl ? nameEl.textContent.trim() : null;
            
            // Birth info
            const birthEl = document.querySelector('#Birth');
            data.birth = birthEl ? birthEl.textContent.trim() : null;
            
            // Death info
            const deathEl = document.querySelector('#Death');
            data.death = deathEl ? deathEl.textContent.trim() : null;
            
            // WikiTree ID from URL
            data.wikiTreeId = window.location.pathname.split('/wiki/')[1];
            
            return data;
        });
        
        console.log('Name:', profileInfo.name);
        console.log('Birth:', profileInfo.birth);
        console.log('Death:', profileInfo.death);
        console.log('WikiTree ID:', profileInfo.wikiTreeId);
        console.log();

        // Find children section
        console.log('=== CHILDREN SECTION ===');
        const childrenData = await page.evaluate(() => {
            const data = { found: false, children: [] };
            
            // Try multiple potential selectors for children section
            const possibleSelectors = [
                '#Children',
                '.children',
                '[id*="Children"]',
                '[class*="children"]'
            ];
            
            let childrenSection = null;
            for (const selector of possibleSelectors) {
                const el = document.querySelector(selector);
                if (el) {
                    childrenSection = el;
                    data.selector = selector;
                    break;
                }
            }
            
            if (childrenSection) {
                data.found = true;
                
                // Get all links in the children section
                const links = childrenSection.querySelectorAll('a[href*="/wiki/"]');
                data.linkCount = links.length;
                
                // Extract first few children as examples
                links.forEach((link, index) => {
                    if (index < 5) { // Only first 5 for reconnaissance
                        const href = link.getAttribute('href');
                        const text = link.textContent.trim();
                        const parentLi = link.closest('li');
                        const fullText = parentLi ? parentLi.textContent.trim() : text;
                        
                        data.children.push({
                            name: text,
                            url: href,
                            fullText: fullText
                        });
                    }
                });
                
                // Get HTML structure sample
                data.htmlSample = childrenSection.innerHTML.substring(0, 500);
            }
            
            return data;
        });

        if (childrenData.found) {
            console.log('✓ Children section found!');
            console.log('Selector used:', childrenData.selector);
            console.log('Total links found:', childrenData.linkCount);
            console.log('\nFirst few children:');
            childrenData.children.forEach((child, i) => {
                console.log(`  ${i + 1}. ${child.name}`);
                console.log(`     URL: ${child.url}`);
                console.log(`     Full text: ${child.fullText.substring(0, 100)}...`);
            });
            console.log('\nHTML structure sample:');
            console.log(childrenData.htmlSample);
        } else {
            console.log('✗ Children section not found - need manual inspection');
        }
        console.log();

        // Check for privacy indicators
        console.log('=== PRIVACY INDICATORS ===');
        const privacyInfo = await page.evaluate(() => {
            const data = {};
            
            // Check for "Private" text
            data.hasPrivateText = document.body.textContent.includes('Private');
            
            // Check for privacy-related classes
            const privacyClasses = [
                '.privacy-private',
                '[class*="private"]',
                '[class*="Privacy"]'
            ];
            
            data.privacyElements = [];
            privacyClasses.forEach(selector => {
                const els = document.querySelectorAll(selector);
                if (els.length > 0) {
                    data.privacyElements.push({
                        selector,
                        count: els.length
                    });
                }
            });
            
            return data;
        });
        
        console.log('Has "Private" text:', privacyInfo.hasPrivateText);
        console.log('Privacy elements found:', privacyInfo.privacyElements);
        console.log();

        // Take screenshot for reference
        const screenshotPath = path.join(__dirname, '../logs/wikitree-reconnaissance.png');
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`Screenshot saved to: ${screenshotPath}\n`);

        // Save page HTML for offline analysis
        const html = await page.content();
        const htmlPath = path.join(__dirname, '../logs/wikitree-hopewell-183.html');
        fs.writeFileSync(htmlPath, html);
        console.log(`HTML saved to: ${htmlPath}\n`);

        // Save reconnaissance data as JSON
        const reconData = {
            url,
            profileInfo,
            childrenData,
            privacyInfo,
            timestamp: new Date().toISOString()
        };
        const jsonPath = path.join(__dirname, '../logs/wikitree-reconnaissance.json');
        fs.writeFileSync(jsonPath, JSON.stringify(reconData, null, 2));
        console.log(`Reconnaissance data saved to: ${jsonPath}\n`);

        console.log('========================================');
        console.log('✓ Phase 0: Reconnaissance Complete!');
        console.log('========================================');
        console.log('\nFindings:');
        console.log('  • Profile data: ✓ Accessible');
        console.log('  • Children section:', childrenData.found ? '✓ Found' : '✗ Not found');
        console.log('  • Total children links:', childrenData.linkCount || 0);
        console.log('  • Privacy indicators:', privacyInfo.privacyElements.length > 0 ? '✓ Detected' : 'None found');
        console.log('\nReady for Phase 1: Document fix & Phase 2: Scraper development\n');

    } catch (error) {
        console.error('\n❌ Reconnaissance failed!');
        console.error('Error:', error.message);
        console.error('\nFull error:');
        console.error(error);
    } finally {
        if (browser) {
            await browser.close();
            console.log('Browser closed.');
        }
    }
}

// Run reconnaissance
exploreWikiTreeStructure().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
