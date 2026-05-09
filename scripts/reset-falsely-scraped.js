/**
 * reset-falsely-scraped.js
 *
 * One-time repair: clears scraped_at for locations in Mississippi, Louisiana,
 * and Virginia (1860 slave schedule, collection 3161105) where image_count = 0
 * or image_count IS NULL after a scraped_at was recorded.
 *
 * These rows were incorrectly marked as "done" because the scraper had a bug
 * where FamilySearch API fetch failures were silently swallowed — the location
 * appeared processed but no images were ever retrieved.
 *
 * After running this script, finish-1860-remaining.sh will re-queue those
 * locations on the next run and actually scrape them.
 *
 * Usage:
 *   node scripts/reset-falsely-scraped.js              # dry-run (show counts only)
 *   node scripts/reset-falsely-scraped.js --commit     # actually reset scraped_at
 *   node scripts/reset-falsely-scraped.js --state "Mississippi" --commit
 *
 * Safety:
 *   - Default mode is DRY RUN — prints counts but makes no changes.
 *   - Requires explicit --commit flag to write to the database.
 *   - Only touches collection_id = '3161105' (1860 slave schedule).
 *   - Only resets rows where scraped_at IS NOT NULL AND (image_count = 0 OR image_count IS NULL).
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL not set in .env');
    process.exit(1);
}

const sql = neon(DATABASE_URL);

// Default affected states — can be narrowed with --state flag
const DEFAULT_STATES = ['Mississippi', 'Louisiana', 'Virginia'];
const COLLECTION_ID = '3161105'; // 1860 Slave Schedule only

async function main() {
    const args = process.argv.slice(2);
    const commit = args.includes('--commit');
    const stateArg = args.find(a => a.startsWith('--state=')) || null;
    const stateFromFlag = args.indexOf('--state') !== -1 ? args[args.indexOf('--state') + 1] : null;
    const singleState = stateArg ? stateArg.split('=')[1] : stateFromFlag;

    const targetStates = singleState ? [singleState] : DEFAULT_STATES;

    console.log('====================================================');
    console.log('  RESET FALSELY-SCRAPED LOCATIONS');
    console.log('====================================================');
    console.log(`Collection:    ${COLLECTION_ID} (1860 Slave Schedule)`);
    console.log(`Target states: ${targetStates.join(', ')}`);
    console.log(`Mode:          ${commit ? '⚠️  COMMIT (will reset scraped_at)' : '🔍 DRY RUN (no changes)'}`);
    console.log('====================================================\n');

    // ------------------------------------------------------------------
    // Step 1: Show current status table before any changes
    // ------------------------------------------------------------------
    console.log('📊 Current status (before reset):\n');

    for (const state of targetStates) {
        const totals = await sql`
            SELECT
                COUNT(*) AS total,
                COUNT(scraped_at) AS scraped,
                COUNT(CASE WHEN scraped_at IS NOT NULL AND (image_count = 0 OR image_count IS NULL) THEN 1 END) AS falsely_scraped
            FROM familysearch_locations
            WHERE collection_id = ${COLLECTION_ID}
            AND state = ${state}
            AND waypoint_id IS NOT NULL
            AND waypoint_id NOT LIKE '%collection%'
            AND district != state
        `;

        const { total, scraped, falsely_scraped } = totals[0];
        const pct = total > 0 ? ((scraped / total) * 100).toFixed(1) : '0.0';
        console.log(`  ${state}:`);
        console.log(`    Total locations:   ${total}`);
        console.log(`    Scraped (any):     ${scraped} (${pct}%)`);
        console.log(`    Falsely scraped*:  ${falsely_scraped}  ← will be reset`);
        console.log('');
    }

    console.log('  * "Falsely scraped" = scraped_at IS NOT NULL AND image_count IN (0, NULL)\n');

    if (!commit) {
        console.log('ℹ️  DRY RUN complete — no changes made.');
        console.log('   Re-run with --commit to apply the reset.\n');
        return;
    }

    // ------------------------------------------------------------------
    // Step 2: Apply the reset
    // ------------------------------------------------------------------
    console.log('🔧 Applying reset...\n');

    let totalReset = 0;

    for (const state of targetStates) {
        const result = await sql`
            UPDATE familysearch_locations
            SET scraped_at = NULL,
                image_count = NULL
            WHERE collection_id = ${COLLECTION_ID}
            AND state = ${state}
            AND waypoint_id IS NOT NULL
            AND waypoint_id NOT LIKE '%collection%'
            AND district != state
            AND scraped_at IS NOT NULL
            AND (image_count = 0 OR image_count IS NULL)
        `;

        // neon returns rowCount on UPDATE
        const rowsAffected = result.length ?? result.rowCount ?? 0;
        totalReset += rowsAffected;
        console.log(`  ✅ ${state}: reset ${rowsAffected} location(s)`);
    }

    console.log(`\n✅ Done. Total locations reset: ${totalReset}`);

    // ------------------------------------------------------------------
    // Step 3: Show updated status table after reset
    // ------------------------------------------------------------------
    console.log('\n📊 Updated status (after reset):\n');

    for (const state of targetStates) {
        const totals = await sql`
            SELECT
                COUNT(*) AS total,
                COUNT(scraped_at) AS scraped
            FROM familysearch_locations
            WHERE collection_id = ${COLLECTION_ID}
            AND state = ${state}
            AND waypoint_id IS NOT NULL
            AND waypoint_id NOT LIKE '%collection%'
            AND district != state
        `;

        const { total, scraped } = totals[0];
        const remaining = total - scraped;
        const pct = total > 0 ? ((scraped / total) * 100).toFixed(1) : '0.0';
        console.log(`  ${state}: ${scraped}/${total} scraped (${pct}%) — ${remaining} still queued`);
    }

    console.log('\n🚀 Ready to re-run finish-1860-remaining.sh\n');
}

main().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
});
