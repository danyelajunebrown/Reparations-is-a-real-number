/**
 * Test the Autonomous Research Agent
 *
 * Usage:
 *   node test-autonomous-agent.js "https://example.com/genealogy-page"
 */

const AutonomousResearchOrchestrator = require('./autonomous-research-orchestrator');
const { pool } = require('./database');

async function main() {
    // Get URL from command line
    const url = process.argv[2];

    if (!url) {
        console.error('❌ Please provide a URL to scrape');
        console.error('Usage: node test-autonomous-agent.js "https://example.com"');
        process.exit(1);
    }

    console.log('Initializing Autonomous Research Agent...\n');

    const agent = new AutonomousResearchOrchestrator(pool, {
        autoDownloadDocuments: true,
        autoUploadDocuments: true,
        minConfidenceForConfirmed: 0.85,
        serverUrl: 'http://localhost:3000'
    });

    try {
        // Process the URL
        const results = await agent.processURL(url);

        // Print detailed results
        console.log('\n📊 DETAILED RESULTS:\n');

        if (results.extractionResults && results.extractionResults.persons.length > 0) {
            console.log('🧑 PERSONS EXTRACTED:\n');
            results.extractionResults.persons.forEach((person, i) => {
                console.log(`${i + 1}. ${person.fullName}`);
                console.log(`   Type: ${person.type}`);
                console.log(`   Confidence: ${(person.confidence * 100).toFixed(0)}%`);
                if (person.birthYear) console.log(`   Born: ${person.birthYear}`);
                if (person.deathYear) console.log(`   Died: ${person.deathYear}`);
                if (person.locations.length > 0) console.log(`   Locations: ${person.locations.join(', ')}`);
                console.log(`   Evidence: "${person.evidence.substring(0, 100)}..."`);
                console.log('');
            });
        }

        if (results.extractionResults && results.extractionResults.relationships.length > 0) {
            console.log('\n👨‍👩‍👧‍👦 RELATIONSHIPS FOUND:\n');
            results.extractionResults.relationships.forEach((rel, i) => {
                console.log(`${i + 1}. ${rel.type}: ${rel.person1 || rel.enslaved} ↔ ${rel.person2 || rel.owner}`);
                console.log(`   Evidence: "${rel.evidence}"`);
                console.log('');
            });
        }

        if (results.documentsDownloaded > 0) {
            console.log(`\n📎 DOCUMENTS PROCESSED: ${results.documentsDownloaded} downloaded, ${results.documentsUploaded} uploaded\n`);
        }

        if (results.errors.length > 0) {
            console.log('\n⚠️  ERRORS:\n');
            results.errors.forEach((err, i) => {
                console.log(`${i + 1}. [${err.stage}] ${err.error}`);
            });
        }

        console.log('\n✅ Test complete!');

    } catch (error) {
        console.error('\n❌ Test failed:', error);
    } finally {
        await agent.close();
        await pool.end();
        process.exit(0);
    }
}

main();
