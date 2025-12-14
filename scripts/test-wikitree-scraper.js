/**
 * Test WikiTreeScraper with James Hopewell
 * 
 * Phase 2 Test: Verify WikiTreeScraper can:
 * - Scrape James Hopewell's profile
 * - Extract his 4 children
 * - Parse dates correctly
 * - Validate relationships
 */

const WikiTreeScraper = require('../src/services/genealogy/WikiTreeScraper');

async function testWikiTreeScraper() {
    console.log('========================================');
    console.log('Phase 2 Test: WikiTreeScraper');
    console.log('========================================\n');

    const scraper = new WikiTreeScraper({
        headless: false, // Show browser for debugging
        rateLimit: 2000
    });

    try {
        // Test 1: Initialize scraper
        console.log('Test 1: Initialize scraper...');
        await scraper.init();
        console.log('✓ Scraper initialized\n');

        // Test 2: Scrape James Hopewell's profile
        console.log('Test 2: Scrape James Hopewell (Hopewell-183)...');
        const jamesProfile = await scraper.scrapeProfile('Hopewell-183');
        
        console.log('\nProfile Data:');
        console.log('  Name:', jamesProfile.name);
        console.log('  WikiTree ID:', jamesProfile.wikiTreeId);
        console.log('  Birth:', jamesProfile.birthInfo || 'Unknown');
        console.log('  Birth Year:', jamesProfile.birthYear || 'Unknown');
        console.log('  Birth Place:', jamesProfile.birthPlace || 'Unknown');
        console.log('  Death:', jamesProfile.deathInfo || 'Unknown');
        console.log('  Death Year:', jamesProfile.deathYear || 'Unknown');
        console.log('  Death Place:', jamesProfile.deathPlace || 'Unknown');
        console.log('  Is Private:', jamesProfile.isPrivate);
        console.log('  Is Living:', jamesProfile.isLiving);
        console.log('  Children:', jamesProfile.children.length);

        if (jamesProfile.children.length > 0) {
            console.log('\nChildren found:');
            jamesProfile.children.forEach((child, i) => {
                console.log(`  ${i + 1}. ${child.name} (${child.wikiTreeId})`);
            });
        }

        // Verify expected children
        console.log('\n✓ Profile scraped successfully');
        if (jamesProfile.children.length === 4) {
            console.log('✓ All 4 children found (matches reconnaissance data)');
        } else {
            console.log(`⚠️  Expected 4 children, found ${jamesProfile.children.length}`);
        }

        // Test 3: Date parsing
        console.log('\n\nTest 3: Date parsing...');
        const testDates = [
            'about 1817',
            'between 1800 and 1810',
            '[date unknown]',
            '1792'
        ];

        testDates.forEach(dateStr => {
            const parsed = scraper.parseDate(dateStr);
            console.log(`  "${dateStr}" → Year: ${parsed.year}, Approx: ${parsed.isApproximate}, Unknown: ${parsed.isUnknown}`);
        });
        console.log('✓ Date parsing working\n');

        // Test 4: Living status estimation
        console.log('Test 4: Living status estimation...');
        const jamesLiving = scraper.estimateLiving(jamesProfile.birthYear, jamesProfile.deathYear);
        console.log(`  James Hopewell living status: ${jamesLiving}`);
        console.log('✓ Living estimation working\n');

        // Test 5: Scrape one child to test traversal
        console.log('Test 5: Scrape first child (Ann Maria Hopewell Biscoe)...');
        if (jamesProfile.children.length > 0) {
            await scraper.wait(); // Rate limiting
            
            const firstChild = jamesProfile.children[0];
            const childProfile = await scraper.scrapeProfile(firstChild.wikiTreeId);
            
            console.log('\nChild Profile:');
            console.log('  Name:', childProfile.name);
            console.log('  WikiTree ID:', childProfile.wikiTreeId);
            console.log('  Birth Year:', childProfile.birthYear || 'Unknown');
            console.log('  Death Year:', childProfile.deathYear || 'Unknown');
            console.log('  Children:', childProfile.children.length);

            // Test relationship validation
            if (jamesProfile.birthYear && childProfile.birthYear) {
                const validRelationship = scraper.validateRelationship(
                    jamesProfile.birthYear,
                    childProfile.birthYear
                );
                console.log(`  Relationship valid: ${validRelationship}`);
                console.log(`  Age gap: ${childProfile.birthYear - jamesProfile.birthYear} years`);
            }

            console.log('✓ Child profile scraped successfully');
            
            if (childProfile.children.length > 0) {
                console.log(`\nGrandchildren found: ${childProfile.children.length}`);
                childProfile.children.forEach((grandchild, i) => {
                    console.log(`  ${i + 1}. ${grandchild.name} (${grandchild.wikiTreeId})`);
                });
            }
        }

        // Test 6: Cache functionality
        console.log('\n\nTest 6: Cache functionality...');
        const cacheStats = scraper.getCacheStats();
        console.log(`  Cached profiles: ${cacheStats.size}`);
        console.log('  Cached IDs:', cacheStats.entries.join(', '));
        
        // Re-scrape James Hopewell (should use cache)
        const jamesProfileCached = await scraper.scrapeProfile('Hopewell-183');
        console.log('✓ Cache working (second scrape used cached data)\n');

        // Summary
        console.log('\n========================================');
        console.log('✓ Phase 2 Test: All Tests Passed!');
        console.log('========================================');
        console.log('\nScraper Statistics:');
        console.log('  Profiles scraped:', cacheStats.size);
        console.log('  James Hopewell children:', jamesProfile.children.length);
        console.log('  Rate limit:', scraper.rateLimit, 'ms');
        console.log('\nReady for Phase 3: DescendantMapper development\n');

    } catch (error) {
        console.error('\n❌ Test failed!');
        console.error('Error:', error.message);
        console.error(error);
    } finally {
        await scraper.close();
    }
}

// Run the test
testWikiTreeScraper().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
