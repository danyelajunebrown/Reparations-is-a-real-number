/**
 * Batch Name Resolution Script
 *
 * Processes existing unconfirmed_persons records through the NameResolver
 * to build canonical_persons and name_variants tables.
 *
 * Usage: DATABASE_URL="..." node scripts/batch-name-resolution.js [batchSize] [startOffset]
 */

const { Pool } = require('pg');
const NameResolver = require('../src/services/NameResolver');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Configuration
const BATCH_SIZE = parseInt(process.argv[2]) || 1000;
const START_OFFSET = parseInt(process.argv[3]) || 0;
const MAX_RECORDS = parseInt(process.argv[4]) || Infinity;

// Stats tracking
const stats = {
    processed: 0,
    linked: 0,
    queued: 0,
    created: 0,
    skipped: 0,
    errors: 0,
    startTime: Date.now()
};

function parseLocation(locations) {
    // Parse locations field which might be JSON string or null
    if (!locations) return { state: null, county: null };

    try {
        if (typeof locations === 'string') {
            // Try to extract state/county from string like "Montgomery County, Maryland"
            const parts = locations.split(',').map(p => p.trim());
            if (parts.length >= 2) {
                const county = parts[0].replace(/\s+County$/i, '');
                const state = parts[1];
                return { state, county };
            }
            return { state: null, county: locations };
        }
        return { state: null, county: null };
    } catch (e) {
        return { state: null, county: null };
    }
}

async function processBatch(resolver, offset) {
    const query = `
        SELECT lead_id, full_name, person_type, source_url, locations, gender, birth_year
        FROM unconfirmed_persons
        WHERE full_name IS NOT NULL
          AND full_name != ''
          AND full_name !~ '^[0-9\\s]+$'  -- Skip pure numbers
          AND LENGTH(TRIM(full_name)) >= 2  -- Skip single characters
        ORDER BY lead_id
        OFFSET $1
        LIMIT $2
    `;

    const result = await pool.query(query, [offset, BATCH_SIZE]);

    if (result.rows.length === 0) {
        return false; // No more records
    }

    for (const row of result.rows) {
        try {
            const { state, county } = parseLocation(row.locations);

            // Skip obviously bad names (OCR artifacts)
            const name = row.full_name.trim();
            if (name.length < 2 || /^[^a-zA-Z]+$/.test(name)) {
                stats.skipped++;
                continue;
            }

            const resolution = await resolver.resolveOrCreate(name, {
                sex: row.gender,
                birthYear: row.birth_year,
                personType: row.person_type || 'unknown',
                state: state,
                county: county,
                sourceUrl: row.source_url,
                sourceType: 'batch_migration',
                unconfirmedPersonId: row.lead_id
            });

            stats.processed++;

            switch (resolution.action) {
                case 'linked_existing':
                    stats.linked++;
                    break;
                case 'queued_for_review':
                    stats.queued++;
                    break;
                case 'created_new':
                    stats.created++;
                    break;
                default:
                    stats.skipped++;
            }

            // Progress logging every 100 records
            if (stats.processed % 100 === 0) {
                const elapsed = (Date.now() - stats.startTime) / 1000;
                const rate = stats.processed / elapsed;
                console.log(`📊 Progress: ${stats.processed} processed (${rate.toFixed(1)}/sec) | Linked: ${stats.linked} | Queued: ${stats.queued} | New: ${stats.created} | Skipped: ${stats.skipped}`);
            }

        } catch (err) {
            stats.errors++;
            if (stats.errors <= 10) {
                console.error(`❌ Error processing lead_id ${row.lead_id}:`, err.message);
            }
        }
    }

    return result.rows.length === BATCH_SIZE; // Continue if full batch
}

async function run() {
    console.log('=== Batch Name Resolution ===\n');
    console.log(`Configuration:`);
    console.log(`  Batch size: ${BATCH_SIZE}`);
    console.log(`  Start offset: ${START_OFFSET}`);
    console.log(`  Max records: ${MAX_RECORDS === Infinity ? 'unlimited' : MAX_RECORDS}`);
    console.log('');

    // Initialize NameResolver
    const resolver = new NameResolver(pool);

    // Get initial stats
    const initialStats = await resolver.getStats();
    console.log(`Initial database stats:`);
    console.log(`  Canonical persons: ${initialStats.canonical_persons}`);
    console.log(`  Name variants: ${initialStats.name_variants}`);
    console.log(`  Queue items: ${initialStats.queue_items}`);
    console.log('');

    // Count total records to process
    const countResult = await pool.query(`
        SELECT COUNT(*) as total
        FROM unconfirmed_persons
        WHERE full_name IS NOT NULL
          AND full_name != ''
          AND full_name !~ '^[0-9\\s]+$'
          AND LENGTH(TRIM(full_name)) >= 2
    `);
    const totalRecords = Math.min(parseInt(countResult.rows[0].total), MAX_RECORDS);
    console.log(`Total records to process: ${totalRecords}\n`);

    stats.startTime = Date.now();
    let offset = START_OFFSET;
    let hasMore = true;

    while (hasMore && stats.processed < MAX_RECORDS) {
        hasMore = await processBatch(resolver, offset);
        offset += BATCH_SIZE;
    }

    // Final stats
    const elapsed = (Date.now() - stats.startTime) / 1000;
    const finalStats = await resolver.getStats();

    console.log('\n=== Final Results ===\n');
    console.log(`Runtime: ${elapsed.toFixed(1)} seconds`);
    console.log(`Processing rate: ${(stats.processed / elapsed).toFixed(1)} records/sec`);
    console.log('');
    console.log('Records processed:');
    console.log(`  Total: ${stats.processed}`);
    console.log(`  Linked to existing: ${stats.linked}`);
    console.log(`  Queued for review: ${stats.queued}`);
    console.log(`  Created new canonical: ${stats.created}`);
    console.log(`  Skipped (bad data): ${stats.skipped}`);
    console.log(`  Errors: ${stats.errors}`);
    console.log('');
    console.log('Database state after:');
    console.log(`  Canonical persons: ${finalStats.canonical_persons} (was ${initialStats.canonical_persons})`);
    console.log(`  Name variants: ${finalStats.name_variants} (was ${initialStats.name_variants})`);
    console.log(`  Queue items: ${finalStats.queue_items} (was ${initialStats.queue_items})`);
}

run()
    .then(() => {
        console.log('\n✅ Batch name resolution complete');
        pool.end();
    })
    .catch(err => {
        console.error('\n❌ Fatal error:', err);
        pool.end();
        process.exit(1);
    });
