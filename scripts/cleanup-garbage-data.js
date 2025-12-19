#!/usr/bin/env node
/**
 * Garbage Data Cleanup Script
 *
 * Removes invalid entries from unconfirmed_persons table
 * that are clearly not human names (OCR artifacts, headers, common words)
 *
 * Usage: node scripts/cleanup-garbage-data.js [--dry-run]
 */

require('dotenv').config();
const { Pool } = require('pg');
const NameValidator = require('../src/services/NameValidator');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
    console.log('========================================');
    console.log('GARBAGE DATA CLEANUP SCRIPT');
    console.log('========================================');
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE (will delete data)'}`);
    console.log('');

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        // Step 1: Count current state
        console.log('Step 1: Analyzing current database state...');
        const countResult = await pool.query('SELECT COUNT(*) FROM unconfirmed_persons');
        const totalBefore = parseInt(countResult.rows[0].count);
        console.log(`   Total records: ${totalBefore.toLocaleString()}`);

        // Step 2: Identify garbage using SQL patterns
        console.log('\nStep 2: Identifying garbage records...');

        const garbageQuery = `
            SELECT lead_id, full_name, person_type
            FROM unconfirmed_persons
            WHERE
                -- Common English words
                full_name ~* '^(the|he|she|it|that|this|with|from|for|and|but|not|our|its|his|her|they|them|their|who|what|where|when|how|why|which|your|you|we|us|me|my|be|is|are|was|were|been|have|has|had|do|does|did|will|would|could|should|may|might|must|can|shall|to|of|in|on|at|by|as|or|an|a|no|yes|so|if|than|then|now|up|out|only|also|very|just|even|more|most|other|some|any|all|both|each|few|many|much|own|same|such|too|into|over|after|before|between|under|during|through|above|below|against|within|without|along|among|around|behind|beyond|beside)$'

                -- Form field headers
                OR full_name ~* '^(participant info|researcher location|comments|beyond kin researcher|research record|your petitioner|slaveholder|enslaved|owner|descendant|locations|researcher|e-mail|website|mailing list|on-line tree|slave statistics|contact|information|participant|submitted|contributor)$'

                -- Document titles
                OR full_name ~* '^(federal census|baptist church|methodist church|statistics|records|index|schedule|list|roll|register|inventory|manifest|ledger|account)$'

                -- Column headers
                OR full_name ~* '^(year|month|day|week|date|time|age|born|died|death|birth|compensation|received|drafted|enlisted|paid|owed|amount|total|number|none|male|female|sex|gender|color|value|price|occupation|trade|remarks|description|condition|status|mole)$'

                -- Too short (1-2 chars)
                OR LENGTH(TRIM(full_name)) <= 2

                -- Contains @ (email)
                OR full_name LIKE '%@%'

                -- Contains URL patterns
                OR full_name ~* '(https?:|www\\.|\\.(com|org|gov|net))'

                -- Only numbers
                OR full_name ~ '^[0-9]+$'

                -- Starts with common word patterns
                OR full_name ~* '^(by the |the |a |an |in |on |at |to |for |from |with )'
        `;

        const garbageResult = await pool.query(garbageQuery);
        const garbageCount = garbageResult.rows.length;
        console.log(`   Garbage records found: ${garbageCount.toLocaleString()}`);
        console.log(`   Percentage: ${(100 * garbageCount / totalBefore).toFixed(1)}%`);

        // Step 3: Show samples
        console.log('\nStep 3: Sample garbage records:');
        const samples = garbageResult.rows.slice(0, 20);
        samples.forEach((row, i) => {
            console.log(`   ${i + 1}. "${row.full_name}" (${row.person_type})`);
        });

        // Step 4: Categorize garbage
        console.log('\nStep 4: Garbage by category:');
        const categories = {
            'Common words': 0,
            'Form headers': 0,
            'Column headers': 0,
            'Too short': 0,
            'Other': 0
        };

        garbageResult.rows.forEach(row => {
            const name = row.full_name.toLowerCase();
            if (NameValidator.COMMON_WORDS.has(name)) {
                categories['Common words']++;
            } else if (NameValidator.FORM_HEADERS.has(name)) {
                categories['Form headers']++;
            } else if (NameValidator.COLUMN_HEADERS.has(name)) {
                categories['Column headers']++;
            } else if (name.length <= 2) {
                categories['Too short']++;
            } else {
                categories['Other']++;
            }
        });

        Object.entries(categories).forEach(([cat, count]) => {
            if (count > 0) {
                console.log(`   ${cat}: ${count.toLocaleString()}`);
            }
        });

        // Step 5: Delete garbage (if not dry run)
        if (!DRY_RUN) {
            console.log('\nStep 5: DELETING garbage records...');

            const deleteQuery = `
                DELETE FROM unconfirmed_persons
                WHERE lead_id IN (
                    SELECT lead_id FROM unconfirmed_persons
                    WHERE
                        full_name ~* '^(the|he|she|it|that|this|with|from|for|and|but|not|our|its|his|her|they|them|their|who|what|where|when|how|why|which|your|you|we|us|me|my|be|is|are|was|were|been|have|has|had|do|does|did|will|would|could|should|may|might|must|can|shall|to|of|in|on|at|by|as|or|an|a|no|yes|so|if|than|then|now|up|out|only|also|very|just|even|more|most|other|some|any|all|both|each|few|many|much|own|same|such|too|into|over|after|before|between|under|during|through|above|below|against|within|without|along|among|around|behind|beyond|beside)$'
                        OR full_name ~* '^(participant info|researcher location|comments|beyond kin researcher|research record|your petitioner|slaveholder|enslaved|owner|descendant|locations|researcher|e-mail|website|mailing list|on-line tree|slave statistics|contact|information|participant|submitted|contributor)$'
                        OR full_name ~* '^(federal census|baptist church|methodist church|statistics|records|index|schedule|list|roll|register|inventory|manifest|ledger|account)$'
                        OR full_name ~* '^(year|month|day|week|date|time|age|born|died|death|birth|compensation|received|drafted|enlisted|paid|owed|amount|total|number|none|male|female|sex|gender|color|value|price|occupation|trade|remarks|description|condition|status|mole)$'
                        OR LENGTH(TRIM(full_name)) <= 2
                        OR full_name LIKE '%@%'
                        OR full_name ~* '(https?:|www\\.|\\.(com|org|gov|net))'
                        OR full_name ~ '^[0-9]+$'
                        OR full_name ~* '^(by the |the |a |an |in |on |at |to |for |from |with )'
                )
            `;

            const deleteResult = await pool.query(deleteQuery);
            console.log(`   Deleted: ${deleteResult.rowCount.toLocaleString()} records`);

            // Verify
            const countAfter = await pool.query('SELECT COUNT(*) FROM unconfirmed_persons');
            const totalAfter = parseInt(countAfter.rows[0].count);
            console.log(`   Records remaining: ${totalAfter.toLocaleString()}`);
            console.log(`   Reduction: ${((totalBefore - totalAfter) / totalBefore * 100).toFixed(1)}%`);
        } else {
            console.log('\nStep 5: SKIPPED (dry run mode)');
            console.log(`   Would delete: ${garbageCount.toLocaleString()} records`);
        }

        console.log('\n========================================');
        console.log('CLEANUP COMPLETE');
        console.log('========================================');

    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main();
