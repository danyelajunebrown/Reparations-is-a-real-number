#!/usr/bin/env node
/**
 * Slaveholder Promotion Script
 *
 * Promotes slaveholders from unconfirmed_persons to canonical_persons,
 * making them matchable by the ancestor climber.
 *
 * Pipeline:
 *   Step 1: Filter out garbage names (< 3 chars, numbers, "unknown", etc.)
 *   Step 2: Deduplicate by LOWER(full_name) + state
 *   Step 3: Parse first/last names for canonical_persons
 *   Step 4: Promote in batches by state
 *   Step 5: Post-promotion verification
 *
 * Usage:
 *   node scripts/promote-slaveholders.js --dry-run           # Audit only
 *   node scripts/promote-slaveholders.js --state Georgia      # Single state
 *   node scripts/promote-slaveholders.js --batch pre_indexed  # Single extraction method
 *   node scripts/promote-slaveholders.js --all                # All states, all methods
 *   node scripts/promote-slaveholders.js --verify             # Post-promotion check only
 *
 * Safety:
 *   - Always deduplicates before promoting
 *   - Checks for existing canonical_persons to avoid double-creation
 *   - Logs every promotion for audit trail
 *   - Processes in chunks of 500 to avoid overwhelming the DB
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL;
const DRY_RUN = process.argv.includes('--dry-run');
const VERIFY_ONLY = process.argv.includes('--verify');
const ALL_STATES = process.argv.includes('--all');
const CHUNK_SIZE = 500;

// Parse --state and --batch args
const stateIdx = process.argv.indexOf('--state');
const TARGET_STATE = stateIdx !== -1 ? process.argv[stateIdx + 1] : null;
const batchIdx = process.argv.indexOf('--batch');
const TARGET_BATCH = batchIdx !== -1 ? process.argv[batchIdx + 1] : null;

let sql = null;

const stats = {
    examined: 0,
    filtered_garbage: 0,
    filtered_duplicate: 0,
    already_canonical: 0,
    promoted: 0,
    errors: 0,
    byState: {},
    startTime: Date.now()
};

// ── Garbage Filter ──────────────────────────────────────────────────

function isGarbageName(name) {
    if (!name || name.length < 3) return true;
    if (/^\d/.test(name)) return true; // Starts with number
    if (/^[^a-zA-Z]/.test(name)) return true; // Starts with non-letter
    if (/^(unknown|ditto|do|same|above|illegible|blank|n\/a|none|test|\?+|\.+|-+)$/i.test(name.trim())) return true;
    // Single character names (initials only, no last name)
    if (/^[A-Z]\.?$/i.test(name.trim())) return true;
    // All caps single word under 3 chars
    if (name.trim().length < 3) return true;
    return false;
}

/**
 * Parse a full name into first/last components.
 * Handles: "John Smith", "J W Smith", "Mrs. John Smith", "Smith, John",
 *          "Wm H Dorsey", "Estate of John Smith"
 */
function parseName(fullName) {
    let cleaned = fullName.trim();

    // Remove common prefixes
    cleaned = cleaned.replace(/^(Mrs?\.?|Dr\.?|Rev\.?|Col\.?|Capt\.?|Gen\.?|Hon\.?|Judge|Major|Estate of|Heirs of|Widow of|Exr?\.? of)\s+/i, '');

    // Remove suffixes
    cleaned = cleaned.replace(/\s+(Jr\.?|Sr\.?|Esq\.?|III?|IV)$/i, '');

    // Handle "Last, First" format
    if (cleaned.includes(',')) {
        const parts = cleaned.split(',').map(s => s.trim());
        return {
            firstName: parts[1] || '',
            lastName: parts[0] || ''
        };
    }

    const parts = cleaned.split(/\s+/).filter(p => p.length > 0);

    if (parts.length === 0) return { firstName: '', lastName: '' };
    if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };

    return {
        firstName: parts[0],
        lastName: parts[parts.length - 1]
    };
}

/**
 * Extract state from location string.
 * Handles: "Clarke, Georgia", "3rd Ward Louisville, Kentucky", "Other, Texas"
 */
function extractState(locationStr) {
    if (!locationStr) return null;

    const statePatterns = [
        /,\s*(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|D\.?C\.?|District of Columbia)\s*$/i,
        /(Alabama|Georgia|Kentucky|Tennessee|North Carolina|South Carolina|Virginia|Maryland|Louisiana|Mississippi|Missouri|Arkansas|Texas|Florida|Delaware)/i
    ];

    for (const pattern of statePatterns) {
        const match = locationStr.match(pattern);
        if (match) return match[1].trim();
    }

    return null;
}

/**
 * Extract county from location string.
 */
function extractCounty(locationStr) {
    if (!locationStr) return null;
    const parts = locationStr.split(',');
    if (parts.length >= 2) {
        return parts[0].trim()
            .replace(/\s+(County|District|Ward|Parish|Beat|Division|Precinct)\s*\d*$/i, '')
            .trim();
    }
    return null;
}

// ── Main Promotion Logic ────────────────────────────────────────────

async function promoteState(state) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`  Promoting: ${state}`);
    console.log(`${'─'.repeat(60)}`);

    // Get deduplicated slaveholders for this state
    // Uses DISTINCT ON to pick one representative entry per unique name+state
    const methodFilter = TARGET_BATCH
        ? sql`AND extraction_method = ${TARGET_BATCH}`
        : sql``;

    const slaveholders = await sql`
        SELECT DISTINCT ON (LOWER(full_name))
            lead_id, full_name, locations, confidence_score,
            context_text, extraction_method, source_url
        FROM unconfirmed_persons
        WHERE person_type IN ('slaveholder', 'owner')
        AND locations::text ILIKE ${'%' + state + '%'}
        AND confirmed_individual_id IS NULL
        ${methodFilter}
        ORDER BY LOWER(full_name), confidence_score DESC, lead_id
    `;

    console.log(`  Found ${slaveholders.length} unique slaveholders (after dedup)`);
    stats.examined += slaveholders.length;

    if (!stats.byState[state]) stats.byState[state] = { examined: 0, promoted: 0, filtered: 0, existing: 0 };
    stats.byState[state].examined = slaveholders.length;

    let promoted = 0;
    let filtered = 0;
    let existing = 0;

    // Process in chunks
    for (let i = 0; i < slaveholders.length; i += CHUNK_SIZE) {
        const chunk = slaveholders.slice(i, i + CHUNK_SIZE);

        for (const sh of chunk) {
            // Filter garbage
            if (isGarbageName(sh.full_name)) {
                filtered++;
                stats.filtered_garbage++;
                continue;
            }

            const { firstName, lastName } = parseName(sh.full_name);
            const location = sh.locations?.[0] || '';
            const stateExtracted = extractState(location) || state;
            const county = extractCounty(location);

            // Check if already in canonical_persons
            const existingCheck = await sql`
                SELECT id FROM canonical_persons
                WHERE LOWER(canonical_name) = LOWER(${sh.full_name})
                AND (
                    primary_state ILIKE ${stateExtracted}
                    OR primary_state IS NULL
                )
                LIMIT 1
            `;

            if (existingCheck.length > 0) {
                existing++;
                stats.already_canonical++;

                // Link the unconfirmed to the existing canonical
                if (!DRY_RUN) {
                    await sql`
                        UPDATE unconfirmed_persons
                        SET confirmed_individual_id = ${String(existingCheck[0].id)}
                        WHERE lead_id = ${sh.lead_id}
                        AND confirmed_individual_id IS NULL
                    `;
                }
                continue;
            }

            // Promote to canonical_persons
            if (!DRY_RUN) {
                try {
                    const result = await sql`
                        INSERT INTO canonical_persons (
                            canonical_name, first_name, last_name,
                            person_type, primary_state, primary_county,
                            confidence_score, verification_status,
                            notes, created_by
                        ) VALUES (
                            ${sh.full_name},
                            ${firstName},
                            ${lastName},
                            ${'enslaver'},
                            ${stateExtracted},
                            ${county},
                            ${sh.confidence_score || 0.95},
                            ${'unverified'},
                            ${'Promoted from unconfirmed_persons (1860 Slave Schedule). ' + (sh.extraction_method || 'pre_indexed') + '. Lead #' + sh.lead_id},
                            ${'promote-slaveholders.js'}
                        )
                        RETURNING id
                    `;

                    // Link back
                    await sql`
                        UPDATE unconfirmed_persons
                        SET confirmed_individual_id = ${String(result[0].id)}
                        WHERE lead_id = ${sh.lead_id}
                    `;

                    promoted++;
                    stats.promoted++;
                } catch (err) {
                    if (err.code === '23505') {
                        // Duplicate key — race condition with another entry
                        existing++;
                        stats.already_canonical++;
                    } else {
                        console.error(`    Error promoting ${sh.full_name}: ${err.message}`);
                        stats.errors++;
                    }
                }
            } else {
                promoted++;
                stats.promoted++;
            }
        }

        // Progress update every chunk
        const pct = Math.round((i + chunk.length) / slaveholders.length * 100);
        process.stdout.write(`  Progress: ${i + chunk.length}/${slaveholders.length} (${pct}%) — ${promoted} promoted, ${filtered} filtered, ${existing} existing\r`);
    }

    console.log(`\n  Result: ${promoted} promoted, ${filtered} filtered (garbage), ${existing} already existed`);
    stats.byState[state].promoted = promoted;
    stats.byState[state].filtered = filtered;
    stats.byState[state].existing = existing;
}

async function postPromotionVerification() {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  POST-PROMOTION VERIFICATION`);
    console.log(`${'═'.repeat(60)}\n`);

    // Count canonical_persons by state
    const byState = await sql`
        SELECT COALESCE(primary_state, 'Unknown') as state, COUNT(*) as cnt
        FROM canonical_persons
        WHERE person_type = 'enslaver'
        GROUP BY primary_state
        ORDER BY cnt DESC
        LIMIT 20
    `;
    console.log('  canonical_persons (enslavers) by state:');
    byState.forEach(s => console.log(`    ${(s.state || 'Unknown').padEnd(25)} ${Number(s.cnt).toLocaleString()}`));

    const total = await sql`
        SELECT COUNT(*) as cnt FROM canonical_persons WHERE person_type = 'enslaver'
    `;
    console.log(`\n  Total enslavers in canonical_persons: ${Number(total[0].cnt).toLocaleString()}`);

    // Check remaining unpromoted
    const remaining = await sql`
        SELECT COUNT(*) as cnt FROM unconfirmed_persons
        WHERE person_type IN ('slaveholder', 'owner')
        AND confirmed_individual_id IS NULL
    `;
    console.log(`  Remaining unpromoted slaveholders: ${Number(remaining[0].cnt).toLocaleString()}`);

    // Sample verification: check 5 random new entries
    const samples = await sql`
        SELECT id, canonical_name, primary_state, primary_county, notes
        FROM canonical_persons
        WHERE created_by = 'promote-slaveholders.js'
        ORDER BY RANDOM()
        LIMIT 5
    `;
    if (samples.length > 0) {
        console.log('\n  Sample promoted entries:');
        samples.forEach(s => {
            console.log(`    #${s.id}: ${s.canonical_name} (${s.primary_state}, ${s.primary_county || 'no county'})`);
        });
    }
}

// ── CLI ─────────────────────────────────────────────────────────────

async function main() {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  SLAVEHOLDER PROMOTION — unconfirmed_persons → canonical_persons`);
    console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : VERIFY_ONLY ? 'VERIFY ONLY' : 'LIVE'}`);
    if (TARGET_STATE) console.log(`  State: ${TARGET_STATE}`);
    if (TARGET_BATCH) console.log(`  Batch: ${TARGET_BATCH}`);
    if (ALL_STATES) console.log(`  Scope: ALL STATES`);
    console.log(`${'═'.repeat(60)}\n`);

    sql = neon(DATABASE_URL);
    console.log('Connected to database\n');

    if (VERIFY_ONLY) {
        await postPromotionVerification();
        return;
    }

    if (!TARGET_STATE && !ALL_STATES) {
        console.log('Usage:');
        console.log('  --state Georgia       Promote one state');
        console.log('  --all                 Promote all states');
        console.log('  --batch pre_indexed   Limit to one extraction method');
        console.log('  --dry-run             Audit only, no writes');
        console.log('  --verify              Post-promotion check only');
        process.exit(1);
    }

    // Priority order: largest gaps first
    const allStates = [
        'Louisiana', 'Kentucky', 'Tennessee', 'North Carolina', 'Alabama',
        'Georgia', 'South Carolina', 'Missouri', 'Virginia', 'Maryland',
        'Arkansas', 'Mississippi', 'Texas', 'Florida', 'Delaware'
    ];

    const statesToProcess = TARGET_STATE ? [TARGET_STATE] : allStates;

    for (const state of statesToProcess) {
        await promoteState(state);
    }

    // Post-promotion verification
    await postPromotionVerification();

    // Summary
    const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  PROMOTION COMPLETE`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`  Examined:          ${stats.examined.toLocaleString()}`);
    console.log(`  Promoted:          ${stats.promoted.toLocaleString()}`);
    console.log(`  Filtered (garbage):${stats.filtered_garbage.toLocaleString()}`);
    console.log(`  Already existed:   ${stats.already_canonical.toLocaleString()}`);
    console.log(`  Errors:            ${stats.errors}`);
    console.log(`  Elapsed:           ${elapsed}s`);
    console.log(`  Mode:              ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);

    console.log('\n  By state:');
    for (const [state, data] of Object.entries(stats.byState)) {
        console.log(`    ${state.padEnd(20)} ${data.promoted} promoted / ${data.filtered} filtered / ${data.existing} existing`);
    }
    console.log('');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
