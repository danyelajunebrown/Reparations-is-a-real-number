#!/usr/bin/env node
/**
 * Test Beyond Kin Entry Page Parser
 * Debug EP extraction issues
 */

const GenealogyEntityExtractor = require('./genealogy-entity-extractor');
const AutonomousWebScraper = require('./autonomous-web-scraper');

async function test() {
    const url = 'https://beyondkin.org/enslaved-population-research-view-details/?pdb=325';

    console.log('🧪 Testing Beyond Kin Entry Page Parser');
    console.log(`📄 URL: ${url}\n`);

    // Scrape the page
    const scraper = new AutonomousWebScraper(null); // No database needed
    console.log('📥 Fetching page content...');
    const results = await scraper.scrapeURL(url);

    console.log(`✓ Fetched ${results.rawText.length} characters\n`);
    console.log('Raw Text Preview:');
    console.log('================');
    console.log(results.rawText.substring(0, 500));
    console.log('================\n');

    // Parse with extractor
    const extractor = new GenealogyEntityExtractor();
    console.log('🔍 Parsing Beyond Kin Entry Page...\n');

    const entry = extractor.parseBeyondKinEntryPage(results.rawText, url);

    if (entry) {
        console.log('\n✅ ENTRY PARSED:');
        console.log('================');
        console.log('Slaveholder:', entry.slaveholderName);
        console.log('Locations:', entry.locations);
        console.log('Tree URL:', entry.treeUrl);
        console.log('Comments:', entry.comments);
        console.log('\nEnslaved Persons:', entry.enslavedPersons.length, 'entries');
        entry.enslavedPersons.forEach((ep, i) => {
            console.log(`  ${i+1}. ${ep.description} (count: ${ep.count}, year: ${ep.year || 'unknown'})`);
        });

        const totalCount = entry.enslavedPersons.reduce((sum, ep) => sum + ep.count, 0);
        console.log('\nTotal EP Count:', totalCount);
    } else {
        console.log('\n❌ No entry parsed');
    }

    process.exit(0);
}

test().catch(error => {
    console.error('💥 Error:', error);
    process.exit(1);
});
