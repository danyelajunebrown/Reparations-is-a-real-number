/**
 * Import SlaveVoyages Enslavers → canonical_persons
 *
 * Fetches enslaver records from SlaveVoyages.org API and inserts them
 * into the canonical_persons table for matching during ancestor climbs.
 *
 * This covers transatlantic, intra-American, and intra-African slave trade —
 * addressing international slave owners beyond the US.
 *
 * Usage:
 *   node scripts/importers/import-slavevoyages-enslavers.js
 *   node scripts/importers/import-slavevoyages-enslavers.js --dry-run
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

const BASE_URL = 'https://api.slavevoyages.org';
const AUTH_TOKEN = 'd3eb897a50604f6b995872caa6e8b23baabe2ddb';
const RATE_LIMIT_MS = 1500;
const BATCH_SIZE = 50;
const PAGE_SIZE = 100; // Max records per API page

let lastRequestTime = 0;

async function rateLimitedFetch(url, options) {
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < RATE_LIMIT_MS) {
        await new Promise(r => setTimeout(r, RATE_LIMIT_MS - elapsed));
    }
    lastRequestTime = Date.now();

    const response = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Token ${AUTH_TOKEN}`,
            ...(options?.headers || {})
        }
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`API error ${response.status}: ${text.substring(0, 200)}`);
    }

    return response.json();
}

async function fetchAllEnslavers() {
    console.log('Fetching enslavers from SlaveVoyages.org API...');

    // First, get the total count
    const countData = await rateLimitedFetch(`${BASE_URL}/past/enslaver/`, {
        method: 'POST',
        body: JSON.stringify({ filter: [], page: 1, page_size: 1 })
    });

    const totalCount = countData?.count || 0;
    console.log(`  Total enslavers in database: ${totalCount}`);

    if (totalCount === 0) return [];

    // Paginate through all records
    const allEnslavers = [];
    const totalPages = Math.ceil(totalCount / PAGE_SIZE);

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        try {
            const data = await rateLimitedFetch(`${BASE_URL}/past/enslaver/`, {
                method: 'POST',
                body: JSON.stringify({ filter: [], page: pageNum, page_size: PAGE_SIZE })
            });

            const results = data?.results || [];
            allEnslavers.push(...results);

            if (pageNum % 10 === 0 || pageNum === totalPages) {
                console.log(`  Page ${pageNum}/${totalPages}: fetched ${allEnslavers.length} total`);
            }
        } catch (err) {
            console.error(`  Page ${pageNum} error: ${err.message}`);
            // Continue with next page
        }
    }

    console.log(`  Total fetched: ${allEnslavers.length}`);
    return allEnslavers;
}

async function importEnslavers(enslavers, dryRun = false) {
    console.log(`\nImporting ${enslavers.length} enslavers into canonical_persons...`);
    if (dryRun) console.log('  (DRY RUN — no DB writes)');

    let imported = 0;
    let skipped = 0;
    let errors = 0;

    for (let i = 0; i < enslavers.length; i += BATCH_SIZE) {
        const batch = enslavers.slice(i, i + BATCH_SIZE);

        for (const enslaver of batch) {
            // API returns names as array: ['Last, First'] or ['Last, First Middle']
            const nameList = enslaver.names || [];
            const name = nameList[0] || '';
            if (!name || name.trim().length < 2) {
                skipped++;
                continue;
            }

            const canonicalName = name.trim();

            try {
                if (dryRun) {
                    console.log(`  [DRY] Would insert: ${canonicalName}`);
                    imported++;
                    continue;
                }

                // Check if already exists
                const existing = await sql`
                    SELECT id FROM canonical_persons
                    WHERE canonical_name = ${canonicalName}
                    AND person_type IN ('enslaver', 'slaveholder', 'owner')
                    LIMIT 1
                `;

                if (existing.length > 0) {
                    skipped++;
                    continue;
                }

                // Build notes JSONB with SlaveVoyages metadata
                const notes = {
                    source: 'slavevoyages.org',
                    slavevoyages_id: enslaver.id,
                    all_names: nameList,
                    import_date: new Date().toISOString()
                };

                // Extract available metadata
                if (enslaver.principal_location?.name) notes.location = enslaver.principal_location.name;
                if (enslaver.birth) notes.birth = enslaver.birth;
                if (enslaver.death) notes.death = enslaver.death;
                if (enslaver.voyages?.length) notes.voyage_count = enslaver.voyages.length;
                if (enslaver.named_enslaved_people?.length) notes.named_enslaved_count = enslaver.named_enslaved_people.length;

                await sql`
                    INSERT INTO canonical_persons (canonical_name, person_type, confidence_score, notes)
                    VALUES (${canonicalName}, 'enslaver', 0.60, ${JSON.stringify(notes)})
                    ON CONFLICT DO NOTHING
                `;

                imported++;
            } catch (err) {
                errors++;
                if (errors <= 5) {
                    console.error(`  Error importing "${canonicalName}": ${err.message}`);
                }
            }
        }

        // Progress
        const total = Math.min(i + BATCH_SIZE, enslavers.length);
        if (total % 200 === 0 || total === enslavers.length) {
            console.log(`  Progress: ${total}/${enslavers.length} (imported: ${imported}, skipped: ${skipped}, errors: ${errors})`);
        }
    }

    return { imported, skipped, errors };
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('   SLAVEVOYAGES ENSLAVER IMPORT');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`Database: ${process.env.DATABASE_URL ? 'configured' : 'MISSING!'}`);
    console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE IMPORT'}`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    if (!process.env.DATABASE_URL) {
        console.error('DATABASE_URL not set in .env');
        process.exit(1);
    }

    // Check current count
    const before = await sql`SELECT COUNT(*) as count FROM canonical_persons WHERE notes::text LIKE '%slavevoyages%'`;
    console.log(`Current SlaveVoyages records in DB: ${before[0].count}\n`);

    const enslavers = await fetchAllEnslavers();

    if (enslavers.length === 0) {
        console.log('No enslavers fetched. Check API connectivity.');
        process.exit(1);
    }

    // Log a sample record to understand the data shape
    console.log('\nSample enslaver record:');
    console.log(JSON.stringify(enslavers[0], null, 2).substring(0, 500));

    const result = await importEnslavers(enslavers, dryRun);

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('   IMPORT COMPLETE');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  Imported: ${result.imported}`);
    console.log(`  Skipped (duplicate/empty): ${result.skipped}`);
    console.log(`  Errors: ${result.errors}`);

    const after = await sql`SELECT COUNT(*) as count FROM canonical_persons WHERE notes::text LIKE '%slavevoyages%'`;
    console.log(`  Total SlaveVoyages records in DB: ${after[0].count}`);
    console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
