/**
 * WikiTree Batch Search - Lightweight Background Process
 *
 * Designed to run continuously in the background with minimal resource usage.
 * Searches WikiTree for enslavers in the database to find their descendants.
 *
 * FEATURES:
 * - Rate-limited (1 search every 3 seconds by default)
 * - Resumable (tracks progress in wikitree_search_queue table)
 * - Low memory footprint (processes one at a time)
 * - Graceful shutdown on SIGINT
 *
 * Usage:
 *   node scripts/wikitree-batch-search.js                    # Run continuously
 *   node scripts/wikitree-batch-search.js --queue 100        # Queue top 100 enslavers
 *   node scripts/wikitree-batch-search.js --test "James Hopewell"  # Test single name
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { neon } = require('@neondatabase/serverless');
const https = require('https');

const sql = neon(process.env.DATABASE_URL);

// Configuration - keep it lightweight!
const CONFIG = {
    RATE_LIMIT_MS: 3000,          // 3 seconds between requests
    MAX_RETRIES: 2,               // Retry failed searches twice
    BATCH_SIZE: 1,                // Process one at a time for low memory
    WIKITREE_SEARCH_URL: 'https://www.wikitree.com/wiki/Special:SearchPerson',
    USER_AGENT: 'ReparationsResearch/1.0 (genealogy research)'
};

let running = true;

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\nShutting down gracefully...');
    running = false;
});

/**
 * Check if a WikiTree profile exists and matches the person
 */
async function checkWikiTreeProfile(wikitreeId, firstName, lastName, birthYear, deathYear, state) {
    return new Promise((resolve, reject) => {
        const url = `https://www.wikitree.com/wiki/${wikitreeId}`;

        const req = https.get(url, {
            headers: {
                'User-Agent': CONFIG.USER_AGENT,
                'Accept': 'text/html'
            }
        }, (res) => {
            // Check for redirect (profile doesn't exist)
            if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 404) {
                resolve({ exists: false });
                return;
            }

            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                // Check if profile exists and matches
                const titleMatch = data.match(/<title>([^<]+)<\/title>/);
                if (!titleMatch) {
                    resolve({ exists: false });
                    return;
                }

                const title = titleMatch[1];

                // Check if this is a valid person profile
                if (title.includes('WikiTree FREE Family Tree') && title.includes(lastName)) {
                    // Extract birth/death info from meta description
                    const metaMatch = data.match(/content="[^"]*(?:born|died)\s+(\d{4})[^"]*(?:born|died)\s+(\d{4})?[^"]*"/i);
                    const locationMatch = data.match(new RegExp(state || 'United States', 'i'));

                    let confidence = 0.5; // Base confidence for name match

                    // Boost confidence for location match
                    if (locationMatch) {
                        confidence += 0.2;
                    }

                    // Check first name appears in title
                    if (title.toLowerCase().includes(firstName.toLowerCase())) {
                        confidence += 0.2;
                    }

                    resolve({
                        exists: true,
                        title: title,
                        confidence: confidence,
                        hasLocationMatch: !!locationMatch
                    });
                } else {
                    resolve({ exists: false });
                }
            });
        });

        req.on('error', (e) => reject(e));
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

/**
 * Search WikiTree for a person by trying common ID patterns
 * WikiTree IDs are LastName-N where N is a sequential number
 */
async function searchWikiTree(firstName, lastName, birthYear, deathYear, state) {
    // Clean up last name for WikiTree ID format
    const cleanLastName = lastName
        .split(' ')[0] // Take first word only
        .replace(/[^A-Za-z]/g, '') // Remove non-alpha
        .charAt(0).toUpperCase() + lastName.slice(1).toLowerCase(); // Capitalize

    const candidates = [];

    // Try common ID numbers (most people are in first few hundred)
    const idsToTry = [1, 2, 3, 4, 5, 10, 20, 50, 100, 183, 200];

    for (const num of idsToTry) {
        const wikitreeId = `${cleanLastName}-${num}`;

        try {
            const result = await checkWikiTreeProfile(wikitreeId, firstName, lastName, birthYear, deathYear, state);

            if (result.exists) {
                candidates.push({
                    wikitreeId,
                    ...result
                });

                // If we found a good match, we can stop early
                if (result.confidence >= 0.7) {
                    break;
                }
            }

            // Rate limit between profile checks
            await new Promise(r => setTimeout(r, 500));

        } catch (e) {
            // Continue to next ID
        }
    }

    if (candidates.length === 0) {
        return { status: 'not_found', matches: [] };
    }

    // Sort by confidence and return best match
    candidates.sort((a, b) => b.confidence - a.confidence);

    if (candidates.length === 1 || candidates[0].confidence >= 0.7) {
        return {
            status: 'found',
            wikitreeId: candidates[0].wikitreeId,
            url: `https://www.wikitree.com/wiki/${candidates[0].wikitreeId}`,
            confidence: candidates[0].confidence
        };
    } else {
        // Multiple candidates with similar confidence
        return {
            status: 'multiple_matches',
            matches: candidates.map(c => c.wikitreeId),
            confidence: candidates[0].confidence
        };
    }
}

/**
 * Queue high-confidence enslavers for WikiTree search
 */
async function queueEnslavers(limit = 100) {
    console.log(`Queuing top ${limit} enslavers for WikiTree search...`);

    // Get enslavers not already queued
    const enslavers = await sql`
        SELECT
            cp.id, cp.canonical_name, cp.first_name, cp.last_name,
            cp.birth_year_estimate, cp.death_year_estimate,
            cp.primary_state, cp.primary_county, cp.confidence_score
        FROM canonical_persons cp
        WHERE cp.person_type IN ('enslaver', 'owner')
        AND cp.confidence_score >= 0.85
        AND cp.first_name IS NOT NULL
        AND cp.last_name IS NOT NULL
        AND LENGTH(cp.first_name) >= 2
        AND LENGTH(cp.last_name) >= 2
        AND cp.first_name ~ '^[A-Z][a-z]+'
        AND cp.canonical_name NOT LIKE '%&%'
        AND cp.canonical_name NOT LIKE '%Co.%'
        AND cp.canonical_name NOT LIKE '%Unknown%'
        AND NOT EXISTS (
            SELECT 1 FROM wikitree_search_queue wsq
            WHERE wsq.person_id = cp.id
        )
        ORDER BY cp.confidence_score DESC
        LIMIT ${limit}
    `;

    let queued = 0;
    for (const e of enslavers) {
        try {
            await sql`
                INSERT INTO wikitree_search_queue (
                    person_id, person_name, person_type,
                    birth_year, death_year, primary_state, primary_county,
                    status, priority
                ) VALUES (
                    ${e.id}, ${e.canonical_name}, 'enslaver',
                    ${e.birth_year_estimate}, ${e.death_year_estimate},
                    ${e.primary_state}, ${e.primary_county},
                    'pending', ${Math.round((1 - e.confidence_score) * 10)}
                )
                ON CONFLICT DO NOTHING
            `;
            queued++;
        } catch (err) {
            // Ignore duplicates
        }
    }

    console.log(`Queued ${queued} new enslavers for WikiTree search`);
    return queued;
}

/**
 * Process one item from the queue
 */
async function processNextInQueue() {
    // Get next pending item
    const items = await sql`
        SELECT *
        FROM wikitree_search_queue
        WHERE status = 'pending'
        AND next_attempt <= NOW()
        ORDER BY priority ASC, created_at ASC
        LIMIT 1
    `;

    if (items.length === 0) {
        return null; // Queue empty
    }

    const item = items[0];

    // Mark as searching
    await sql`
        UPDATE wikitree_search_queue
        SET status = 'searching', last_attempt = NOW()
        WHERE id = ${item.id}
    `;

    // Parse name
    const nameParts = item.person_name.split(' ');
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ');

    console.log(`Searching WikiTree: ${item.person_name} (${item.primary_state || '?'})...`);

    try {
        const result = await searchWikiTree(
            firstName,
            lastName,
            item.birth_year,
            item.death_year,
            item.primary_state
        );

        if (result.status === 'found') {
            console.log(`  ✓ Found: ${result.wikitreeId}`);
            await sql`
                UPDATE wikitree_search_queue
                SET status = 'found',
                    wikitree_id = ${result.wikitreeId},
                    wikitree_url = ${result.url},
                    match_confidence = ${result.confidence},
                    completed_at = NOW(),
                    updated_at = NOW()
                WHERE id = ${item.id}
            `;
        } else if (result.status === 'multiple_matches') {
            console.log(`  ⚠ Multiple matches: ${result.matches.join(', ')}`);
            await sql`
                UPDATE wikitree_search_queue
                SET status = 'multiple_matches',
                    multiple_candidates = ${JSON.stringify(result.matches)},
                    match_confidence = ${result.confidence},
                    completed_at = NOW(),
                    updated_at = NOW()
                WHERE id = ${item.id}
            `;
        } else {
            console.log(`  ○ Not found`);
            await sql`
                UPDATE wikitree_search_queue
                SET status = 'not_found',
                    completed_at = NOW(),
                    updated_at = NOW()
                WHERE id = ${item.id}
            `;
        }

        return item;

    } catch (err) {
        console.log(`  ✗ Error: ${err.message}`);

        const newAttempts = (item.attempts || 0) + 1;

        if (newAttempts >= CONFIG.MAX_RETRIES) {
            await sql`
                UPDATE wikitree_search_queue
                SET status = 'error',
                    error_message = ${err.message},
                    attempts = ${newAttempts},
                    updated_at = NOW()
                WHERE id = ${item.id}
            `;
        } else {
            // Schedule retry in 5 minutes
            await sql`
                UPDATE wikitree_search_queue
                SET status = 'pending',
                    attempts = ${newAttempts},
                    next_attempt = NOW() + INTERVAL '5 minutes',
                    error_message = ${err.message},
                    updated_at = NOW()
                WHERE id = ${item.id}
            `;
        }

        return null;
    }
}

/**
 * Get queue statistics
 */
async function getStats() {
    const stats = await sql`
        SELECT
            status,
            COUNT(*) as count
        FROM wikitree_search_queue
        GROUP BY status
        ORDER BY status
    `;

    const result = {
        pending: 0,
        searching: 0,
        found: 0,
        not_found: 0,
        multiple_matches: 0,
        error: 0,
        total: 0
    };

    for (const row of stats) {
        result[row.status] = parseInt(row.count);
        result.total += parseInt(row.count);
    }

    return result;
}

/**
 * Test search for a single name
 */
async function testSearch(name) {
    const parts = name.split(' ');
    const firstName = parts[0];
    const lastName = parts.slice(1).join(' ');

    console.log(`\nTesting WikiTree search for: ${name}\n`);

    try {
        const result = await searchWikiTree(firstName, lastName);
        console.log('Result:', JSON.stringify(result, null, 2));
    } catch (err) {
        console.log('Error:', err.message);
    }
}

/**
 * Main continuous loop
 */
async function runContinuous() {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('   WIKITREE BATCH SEARCH - Background Process');
    console.log('   Press Ctrl+C to stop gracefully');
    console.log('═══════════════════════════════════════════════════════════════\n');

    let processed = 0;
    let found = 0;

    while (running) {
        const result = await processNextInQueue();

        if (result) {
            processed++;

            // Check if found
            const updated = await sql`
                SELECT status FROM wikitree_search_queue WHERE id = ${result.id}
            `;
            if (updated[0]?.status === 'found') {
                found++;
            }

            // Print stats every 10 items
            if (processed % 10 === 0) {
                const stats = await getStats();
                console.log(`\n[Progress] Processed: ${processed} | Found: ${found} | Queue: ${stats.pending} pending\n`);
            }

            // Rate limit
            await new Promise(r => setTimeout(r, CONFIG.RATE_LIMIT_MS));

        } else {
            // Queue empty or all items waiting for retry
            console.log('Queue empty or waiting for retries. Sleeping 30 seconds...');
            await new Promise(r => setTimeout(r, 30000));
        }
    }

    console.log(`\nShutdown complete. Processed ${processed} items, found ${found} WikiTree profiles.`);
}

/**
 * Main entry point
 */
async function main() {
    const args = process.argv.slice(2);

    if (args.includes('--help')) {
        console.log(`
WikiTree Batch Search - Lightweight Background Process

Usage:
  node scripts/wikitree-batch-search.js                    # Run continuously
  node scripts/wikitree-batch-search.js --queue 100        # Queue top 100 enslavers
  node scripts/wikitree-batch-search.js --test "James Hopewell"  # Test single name
  node scripts/wikitree-batch-search.js --stats            # Show queue statistics

Options:
  --queue <n>      Queue top N enslavers for search
  --test <name>    Test search for a single name
  --stats          Show queue statistics
  --help           Show this help message
`);
        return;
    }

    if (args.includes('--stats')) {
        const stats = await getStats();
        console.log('\nWikiTree Search Queue Statistics:\n');
        console.log(`  Pending:          ${stats.pending}`);
        console.log(`  Searching:        ${stats.searching}`);
        console.log(`  Found:            ${stats.found}`);
        console.log(`  Not Found:        ${stats.not_found}`);
        console.log(`  Multiple Matches: ${stats.multiple_matches}`);
        console.log(`  Errors:           ${stats.error}`);
        console.log(`  ─────────────────────`);
        console.log(`  Total:            ${stats.total}\n`);
        return;
    }

    const queueIndex = args.indexOf('--queue');
    if (queueIndex !== -1) {
        const limit = parseInt(args[queueIndex + 1]) || 100;
        await queueEnslavers(limit);
        return;
    }

    const testIndex = args.indexOf('--test');
    if (testIndex !== -1) {
        const name = args.slice(testIndex + 1).join(' ');
        await testSearch(name);
        return;
    }

    // Default: run continuous search
    await runContinuous();
}

main().catch(console.error);
