#!/usr/bin/env node
/**
 * Continuous Scraping Worker
 *
 * Polls scraping_queue table every 30 seconds
 * Processes pending URLs automatically
 * Runs 24/7 in background with PM2
 */

const database = require('./database');
const AutonomousResearchOrchestrator = require('./autonomous-research-orchestrator');

const POLL_INTERVAL = 30000; // 30 seconds
const MAX_CONCURRENT = 1; // Process one at a time to avoid overload

class ContinuousScraper {
    constructor() {
        this.orchestrator = new AutonomousResearchOrchestrator(database);
        this.isProcessing = false;
        this.processedCount = 0;
        this.errorCount = 0;
    }

    async start() {
        console.log('🤖 Continuous Scraping Worker Started');
        console.log(`⏰ Polling every ${POLL_INTERVAL / 1000} seconds`);
        console.log(`🔄 Max concurrent: ${MAX_CONCURRENT}`);
        console.log('=====================================\n');

        // Initial check
        await this.checkQueue();

        // Set up polling
        setInterval(() => this.checkQueue(), POLL_INTERVAL);
    }

    async checkQueue() {
        if (this.isProcessing) {
            console.log('⏳ Already processing, skipping this cycle...');
            return;
        }

        try {
            // Get next pending URL (highest priority first)
            const result = await database.query(
                `SELECT * FROM scraping_queue
                 WHERE status = 'pending'
                 ORDER BY priority DESC, submitted_at ASC
                 LIMIT 1`
            );

            if (result.rows.length === 0) {
                // Check every 5th poll
                if (this.processedCount % 5 === 0) {
                    console.log(`✓ Queue empty (processed: ${this.processedCount}, errors: ${this.errorCount})`);
                }
                return;
            }

            const queueEntry = result.rows[0];
            await this.processQueueEntry(queueEntry);

        } catch (error) {
            console.error('❌ Queue check error:', error.message);
        }
    }

    async processQueueEntry(entry) {
        this.isProcessing = true;
        const startTime = Date.now();

        console.log('\n=====================================');
        console.log(`🔍 Processing queue entry #${entry.id}`);
        console.log(`📄 URL: ${entry.url}`);
        console.log(`📁 Category: ${entry.category}`);
        console.log(`⭐ Priority: ${entry.priority}`);
        console.log(`👤 Submitted by: ${entry.submitted_by}`);
        console.log('=====================================\n');

        try {
            // Mark as processing
            await database.query(
                `UPDATE scraping_queue
                 SET status = 'processing',
                     processing_started_at = CURRENT_TIMESTAMP
                 WHERE id = $1`,
                [entry.id]
            );

            // Check if this is a Beyond Kin submission
            const isBeyondKin = entry.category === 'beyondkin';

            // Process the URL
            const result = await this.orchestrator.processURL(entry.url, {
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
                    personsFound: result.personsCount || 0,
                    documentsFound: result.documentsCount || 0,
                    duration: duration
                }), entry.id]
            );

            this.processedCount++;

            console.log('\n✅ COMPLETED SUCCESSFULLY');
            console.log(`⏱️  Duration: ${duration}s`);
            console.log(`👥 Persons found: ${result.personsCount || 0}`);
            console.log(`📄 Documents found: ${result.documentsCount || 0}`);

            if (isBeyondKin) {
                console.log(`🌟 Beyond Kin entry - added to review queue`);
            }

        } catch (error) {
            this.errorCount++;
            const duration = ((Date.now() - startTime) / 1000).toFixed(2);

            console.error('\n❌ PROCESSING FAILED');
            console.error(`⏱️  Duration: ${duration}s`);
            console.error(`🔴 Error: ${error.message}`);

            // Increment retry count
            const retryCount = (entry.retry_count || 0) + 1;
            const maxRetries = entry.max_retries || 3;

            if (retryCount >= maxRetries) {
                // Max retries reached - mark as failed
                await database.query(
                    `UPDATE scraping_queue
                     SET status = 'failed',
                         processing_completed_at = CURRENT_TIMESTAMP,
                         error_message = $1,
                         retry_count = $2
                     WHERE id = $3`,
                    [error.message, retryCount, entry.id]
                );
                console.log(`🛑 Max retries (${maxRetries}) reached - marked as failed`);
            } else {
                // Reset to pending for retry
                await database.query(
                    `UPDATE scraping_queue
                     SET status = 'pending',
                         retry_count = $1,
                         error_message = $2
                     WHERE id = $3`,
                    [retryCount, error.message, entry.id]
                );
                console.log(`🔄 Will retry (attempt ${retryCount + 1}/${maxRetries})`);
            }
        } finally {
            this.isProcessing = false;
        }
    }

    async shutdown() {
        console.log('\n🛑 Shutting down continuous scraper...');
        console.log(`📊 Final stats: Processed: ${this.processedCount}, Errors: ${this.errorCount}`);
        process.exit(0);
    }
}

// Start the worker
const scraper = new ContinuousScraper();

// Handle shutdown signals
process.on('SIGINT', () => scraper.shutdown());
process.on('SIGTERM', () => scraper.shutdown());

// Start processing
scraper.start().catch(error => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
});
