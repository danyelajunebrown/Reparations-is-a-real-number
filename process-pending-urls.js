#!/usr/bin/env node
/**
 * One-time script to process all pending URLs in the queue
 *
 * Usage: node process-pending-urls.js
 */

const database = require('./database');
const AutonomousResearchOrchestrator = require('./autonomous-research-orchestrator');

async function processAllPending() {
    console.log('🔧 Processing all pending URLs in queue...\n');

    const orchestrator = new AutonomousResearchOrchestrator(database);
    let processed = 0;
    let failed = 0;

    while (true) {
        // Get next pending URL
        const result = await database.query(
            `SELECT * FROM scraping_queue
             WHERE status = 'pending'
             ORDER BY priority DESC, submitted_at ASC
             LIMIT 1`
        );

        if (result.rows.length === 0) {
            console.log('\n✅ All pending URLs processed!');
            console.log(`   Processed: ${processed}`);
            console.log(`   Failed: ${failed}`);
            break;
        }

        const entry = result.rows[0];
        console.log('\n' + '='.repeat(60));
        console.log(`Processing #${entry.id}: ${entry.url}`);
        console.log(`Category: ${entry.category} | Priority: ${entry.priority}`);
        console.log('='.repeat(60));

        try {
            // Mark as processing
            await database.query(
                `UPDATE scraping_queue
                 SET status = 'processing',
                     processing_started_at = CURRENT_TIMESTAMP
                 WHERE id = $1`,
                [entry.id]
            );

            const isBeyondKin = entry.category === 'beyondkin';
            const startTime = Date.now();

            // Process
            const processResult = await orchestrator.processURL(entry.url, {
                category: entry.category,
                isBeyondKin: isBeyondKin,
                queueEntryId: entry.id,
                submittedBy: entry.submitted_by
            });

            const duration = ((Date.now() - startTime) / 1000).toFixed(2);

            // Mark as completed
            await database.query(
                `UPDATE scraping_queue
                 SET status = 'completed',
                     processing_completed_at = CURRENT_TIMESTAMP,
                     metadata = jsonb_set(
                         COALESCE(metadata, '{}'::jsonb),
                         '{result}',
                         $1::jsonb
                     )
                 WHERE id = $2`,
                [JSON.stringify({
                    personsFound: processResult.personsCount || 0,
                    documentsFound: processResult.documentsCount || 0,
                    duration: duration
                }), entry.id]
            );

            processed++;
            console.log(`\n✅ SUCCESS in ${duration}s`);
            console.log(`   Persons: ${processResult.personsCount || 0}`);
            console.log(`   Documents: ${processResult.documentsCount || 0}`);
            if (isBeyondKin) {
                console.log(`   🌟 Added to Beyond Kin review queue`);
            }

        } catch (error) {
            failed++;
            console.error(`\n❌ FAILED: ${error.message}`);

            // Mark as failed
            await database.query(
                `UPDATE scraping_queue
                 SET status = 'failed',
                     processing_completed_at = CURRENT_TIMESTAMP,
                     error_message = $1
                 WHERE id = $2`,
                [error.message, entry.id]
            );
        }
    }

    console.log('\n🎉 Done!\n');
    process.exit(0);
}

processAllPending().catch(error => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
});
