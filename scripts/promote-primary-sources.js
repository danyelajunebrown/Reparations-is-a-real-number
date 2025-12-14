#!/usr/bin/env node
/**
 * Promote Primary Source Records to Confirmed Tables
 *
 * Moves records from unconfirmed_persons to:
 * - enslaved_individuals (for person_type='enslaved')
 * - individuals (for person_type='slaveholder')
 *
 * Primary sources being promoted:
 * 1. MSA Montgomery County Slave Schedules (extraction_method='msa_archive_scraper')
 * 2. Thomas Porcher Ravenel Papers (extraction_method='ocr_scrape' from FamilySearch)
 *
 * Features:
 * - Batch processing to avoid connection timeouts
 * - Connection retry on failure
 * - Skip already-promoted records (status='confirmed')
 */

const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

const BATCH_SIZE = 100; // Process 100 records at a time
const RETRY_DELAY = 5000; // Wait 5 seconds before retry

// Pool configuration with keepalive
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000
});

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getNewClient(retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const client = await pool.connect();
            return client;
        } catch (error) {
            console.log(`Connection attempt ${i + 1} failed: ${error.message}`);
            if (i < retries - 1) {
                await sleep(RETRY_DELAY);
            } else {
                throw error;
            }
        }
    }
}

async function promoteRecords() {
    let totalEnslavedPromoted = 0;
    let totalSlaveholdersPromoted = 0;

    console.log('===========================================');
    console.log('PROMOTING PRIMARY SOURCE RECORDS');
    console.log('===========================================\n');

    // Get counts first
    const countClient = await getNewClient();
    try {
        const counts = await countClient.query(`
            SELECT person_type, extraction_method, COUNT(*) as count
            FROM unconfirmed_persons
            WHERE extraction_method IN ('msa_archive_scraper', 'ocr_scrape')
            AND status = 'pending'
            GROUP BY person_type, extraction_method
        `);

        console.log('Records to promote:');
        counts.rows.forEach(r => {
            console.log(`  ${r.extraction_method} - ${r.person_type}: ${r.count}`);
        });
    } finally {
        countClient.release();
    }

    // 1. Promote ENSLAVED persons in batches
    console.log('\n--- Promoting enslaved persons ---');

    let hasMoreEnslaved = true;
    while (hasMoreEnslaved) {
        const client = await getNewClient();
        try {
            // Get next batch of enslaved records
            const batch = await client.query(`
                SELECT * FROM unconfirmed_persons
                WHERE extraction_method IN ('msa_archive_scraper', 'ocr_scrape')
                AND person_type = 'enslaved'
                AND status = 'pending'
                LIMIT ${BATCH_SIZE}
            `);

            if (batch.rows.length === 0) {
                hasMoreEnslaved = false;
                console.log('  No more enslaved records to promote');
                client.release();
                continue;
            }

            console.log(`  Processing batch of ${batch.rows.length} enslaved persons...`);

            await client.query('BEGIN');

            for (const record of batch.rows) {
                const enslaved_id = `ENS-${uuidv4().split('-')[0].toUpperCase()}`;

                let notes = record.context_text || '';
                if (record.source_url) {
                    notes += `\nSource: ${record.source_url}`;
                }

                await client.query(`
                    INSERT INTO enslaved_individuals (
                        enslaved_id, full_name, birth_year, death_year, gender,
                        verified, notes, created_at, updated_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
                    ON CONFLICT DO NOTHING
                `, [
                    enslaved_id,
                    record.full_name,
                    record.birth_year,
                    record.death_year,
                    record.gender,
                    true,
                    notes
                ]);

                await client.query(`
                    UPDATE unconfirmed_persons
                    SET status = 'confirmed',
                        confirmed_enslaved_id = $1,
                        reviewed_at = NOW()
                    WHERE lead_id = $2
                `, [enslaved_id, record.lead_id]);

                totalEnslavedPromoted++;
            }

            await client.query('COMMIT');
            console.log(`  Batch complete. Total enslaved promoted: ${totalEnslavedPromoted}`);
            client.release();

        } catch (error) {
            console.error(`  Error during enslaved batch: ${error.message}`);
            try {
                await client.query('ROLLBACK');
            } catch (e) {}
            client.release();

            // Wait and retry
            console.log('  Waiting before retry...');
            await sleep(RETRY_DELAY);
        }
    }

    // 2. Promote SLAVEHOLDERS in batches
    console.log('\n--- Promoting slaveholders ---');

    let hasMoreSlaveholders = true;
    while (hasMoreSlaveholders) {
        const client = await getNewClient();
        try {
            // Get next batch of slaveholder records
            const batch = await client.query(`
                SELECT * FROM unconfirmed_persons
                WHERE extraction_method IN ('msa_archive_scraper', 'ocr_scrape')
                AND person_type = 'slaveholder'
                AND status = 'pending'
                LIMIT ${BATCH_SIZE}
            `);

            if (batch.rows.length === 0) {
                hasMoreSlaveholders = false;
                console.log('  No more slaveholder records to promote');
                client.release();
                continue;
            }

            console.log(`  Processing batch of ${batch.rows.length} slaveholders...`);

            await client.query('BEGIN');

            for (const record of batch.rows) {
                const individual_id = `IND-${uuidv4().split('-')[0].toUpperCase()}`;

                let notes = record.context_text || '';
                if (record.source_url) {
                    notes += `\nSource: ${record.source_url}`;
                }

                const locations = record.locations && record.locations.length > 0
                    ? record.locations.join(', ')
                    : null;

                await client.query(`
                    INSERT INTO individuals (
                        individual_id, full_name, birth_year, death_year, gender,
                        locations, verified, notes, created_at, updated_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
                    ON CONFLICT DO NOTHING
                `, [
                    individual_id,
                    record.full_name,
                    record.birth_year,
                    record.death_year,
                    record.gender,
                    locations,
                    true,
                    notes
                ]);

                await client.query(`
                    UPDATE unconfirmed_persons
                    SET status = 'confirmed',
                        confirmed_individual_id = $1,
                        reviewed_at = NOW()
                    WHERE lead_id = $2
                `, [individual_id, record.lead_id]);

                totalSlaveholdersPromoted++;
            }

            await client.query('COMMIT');
            console.log(`  Batch complete. Total slaveholders promoted: ${totalSlaveholdersPromoted}`);
            client.release();

        } catch (error) {
            console.error(`  Error during slaveholder batch: ${error.message}`);
            try {
                await client.query('ROLLBACK');
            } catch (e) {}
            client.release();

            // Wait and retry
            console.log('  Waiting before retry...');
            await sleep(RETRY_DELAY);
        }
    }

    // Report final counts
    const finalClient = await getNewClient();
    try {
        const finalEnslaved = await finalClient.query('SELECT COUNT(*) as count FROM enslaved_individuals');
        const finalIndividuals = await finalClient.query('SELECT COUNT(*) as count FROM individuals');

        console.log('\n===========================================');
        console.log('PROMOTION COMPLETE');
        console.log('===========================================');
        console.log(`Enslaved individuals promoted this run: ${totalEnslavedPromoted}`);
        console.log(`Slaveholders promoted this run: ${totalSlaveholdersPromoted}`);
        console.log(`Total in enslaved_individuals: ${finalEnslaved.rows[0].count}`);
        console.log(`Total in individuals: ${finalIndividuals.rows[0].count}`);
    } finally {
        finalClient.release();
        await pool.end();
    }
}

// Run if called directly
if (require.main === module) {
    promoteRecords()
        .then(() => process.exit(0))
        .catch(err => {
            console.error(err);
            process.exit(1);
        });
}

module.exports = { promoteRecords };
