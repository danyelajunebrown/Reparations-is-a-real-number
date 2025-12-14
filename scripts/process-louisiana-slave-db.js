/**
 * Process Louisiana Slave Database URLs from the scraping queue
 * Afro-Louisiana History and Genealogy database
 */

// Force load .env first
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

// Use direct PostgreSQL connection to Render
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Create a db-like interface
const db = {
    query: (text, params) => pool.query(text, params),
    close: () => pool.end()
};

const UnifiedScraper = require('../src/services/scraping/UnifiedScraper');

async function processLouisianaSlaveDB() {
    console.log('Starting Louisiana Slave Database queue processing...\n');
    console.log('📜 Afro-Louisiana History and Genealogy Database\n');
    console.log('Note: This database contains 100,000+ records in downloadable files.');
    console.log('The scraper will identify the downloads page for bulk import.\n');

    const scraper = new UnifiedScraper(db);

    // Get pending Louisiana Slave DB URLs
    const result = await db.query(`
        SELECT id, url, category, metadata
        FROM scraping_queue
        WHERE category = 'la_slave_database' AND status = 'pending'
        ORDER BY id
    `);

    console.log(`Found ${result.rows.length} pending Louisiana Slave DB URLs\n`);

    let processed = 0;
    let failed = 0;

    for (const entry of result.rows) {
        const num = processed + failed + 1;
        console.log(`[${num}/${result.rows.length}] Processing: ${entry.url}`);

        try {
            // Mark as processing
            await db.query(
                'UPDATE scraping_queue SET status = $1, processing_started_at = CURRENT_TIMESTAMP WHERE id = $2',
                ['processing', entry.id]
            );

            const scrapeResult = await scraper.scrapeURL(entry.url, {
                category: 'la_slave_database',
                queueEntryId: entry.id
            });

            // Update with results
            await db.query(`
                UPDATE scraping_queue
                SET status = $1,
                    processing_completed_at = CURRENT_TIMESTAMP,
                    metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{result}', $2::jsonb)
                WHERE id = $3
            `, [
                scrapeResult.success ? 'completed' : 'failed',
                JSON.stringify({
                    pageType: scrapeResult.metadata?.pageType,
                    documentsFound: scrapeResult.documents.length,
                    duration: scrapeResult.duration,
                    metadata: scrapeResult.metadata
                }),
                entry.id
            ]);

            console.log(`   Page type: ${scrapeResult.metadata?.pageType || 'unknown'}, Docs: ${scrapeResult.documents.length}`);
            processed++;

        } catch (error) {
            console.log(`   Failed: ${error.message}`);
            await db.query(
                'UPDATE scraping_queue SET status = $1, error_message = $2 WHERE id = $3',
                ['failed', error.message, entry.id]
            );
            failed++;
        }

        // Rate limit - 2 seconds between requests
        await new Promise(r => setTimeout(r, 2000));
    }

    console.log('\n' + '='.repeat(50));
    console.log(`Complete: ${processed} processed, ${failed} failed`);
    console.log('\nNote: For full data access, download the database files from:');
    console.log('https://www.ibiblio.org/laslave/downloads/');

    await db.close();
}

processLouisianaSlaveDB().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
});
