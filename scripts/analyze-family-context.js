/**
 * Analyze family relationship patterns in context_text
 * to identify extractable relationships for enslaved promotion
 */

const { Pool } = require('pg');
const config = require('../config');
const pool = new Pool(config.database);

async function analyzeFamilyPatterns() {
    console.log('=== FAMILY RELATIONSHIP PATTERN ANALYSIS ===\n');

    // Count by pattern type
    const patternCounts = await pool.query(`
        SELECT
            CASE
                WHEN context_text ~* '(^|[^a-z])wife of[^a-z]' THEN 'wife_of'
                WHEN context_text ~* '(^|[^a-z])husband of[^a-z]' THEN 'husband_of'
                WHEN context_text ~* '(^|[^a-z])mother of[^a-z]' THEN 'mother_of'
                WHEN context_text ~* '(^|[^a-z])father of[^a-z]' THEN 'father_of'
                WHEN context_text ~* '(^|[^a-z])son of[^a-z]' THEN 'son_of'
                WHEN context_text ~* '(^|[^a-z])daughter of[^a-z]' THEN 'daughter_of'
                WHEN context_text ~* '(^|[^a-z])child of[^a-z]' THEN 'child_of'
                WHEN context_text ~* '(^|[^a-z])children:?' THEN 'has_children'
                WHEN context_text ~* '(^|[^a-z])parent' THEN 'parent_mention'
                WHEN context_text ~* '(^|[^a-z])spouse' THEN 'spouse_mention'
                ELSE 'other_family'
            END as pattern_type,
            COUNT(*) as count
        FROM unconfirmed_persons
        WHERE person_type = 'enslaved'
        AND context_text ~* '(wife|husband|mother|father|son|daughter|child|spouse|parent)'
        GROUP BY 1
        ORDER BY count DESC
    `);

    console.log('Pattern Type Counts:');
    for (const row of patternCounts.rows) {
        console.log(`  ${row.pattern_type}: ${row.count}`);
    }

    // Sample extractable patterns (wife of, husband of - most structured)
    console.log('\n\n=== WIFE OF PATTERN SAMPLES ===\n');
    const wifeOfSamples = await pool.query(`
        SELECT lead_id, full_name, context_text, source_url
        FROM unconfirmed_persons
        WHERE person_type = 'enslaved'
        AND context_text ~* '(^|[^a-z])wife of[^a-z]'
        LIMIT 10
    `);

    for (const row of wifeOfSamples.rows) {
        console.log(`ID: ${row.lead_id}`);
        console.log(`NAME: ${row.full_name}`);
        console.log(`CONTEXT: ${(row.context_text || '').substring(0, 400)}`);
        console.log('---');
    }

    // Sample son/daughter of patterns
    console.log('\n\n=== SON/DAUGHTER OF PATTERN SAMPLES ===\n');
    const childOfSamples = await pool.query(`
        SELECT lead_id, full_name, context_text, source_url
        FROM unconfirmed_persons
        WHERE person_type = 'enslaved'
        AND context_text ~* '(^|[^a-z])(son|daughter) of[^a-z]'
        LIMIT 10
    `);

    for (const row of childOfSamples.rows) {
        console.log(`ID: ${row.lead_id}`);
        console.log(`NAME: ${row.full_name}`);
        console.log(`CONTEXT: ${(row.context_text || '').substring(0, 400)}`);
        console.log('---');
    }

    // Sample mother/father of patterns
    console.log('\n\n=== MOTHER/FATHER OF PATTERN SAMPLES ===\n');
    const parentOfSamples = await pool.query(`
        SELECT lead_id, full_name, context_text, source_url
        FROM unconfirmed_persons
        WHERE person_type = 'enslaved'
        AND context_text ~* '(^|[^a-z])(mother|father) of[^a-z]'
        LIMIT 10
    `);

    for (const row of parentOfSamples.rows) {
        console.log(`ID: ${row.lead_id}`);
        console.log(`NAME: ${row.full_name}`);
        console.log(`CONTEXT: ${(row.context_text || '').substring(0, 400)}`);
        console.log('---');
    }

    // Count by source
    console.log('\n\n=== FAMILY PATTERNS BY SOURCE ===\n');
    const sourceCounts = await pool.query(`
        SELECT
            CASE
                WHEN source_url ILIKE '%familysearch%' THEN 'FamilySearch'
                WHEN source_url ILIKE '%msa.maryland%' THEN 'Maryland Archives'
                WHEN source_url ILIKE '%civilwardc%' THEN 'Civil War DC'
                WHEN source_url ILIKE '%beyondkin%' THEN 'Beyond Kin'
                ELSE 'Other'
            END as source,
            COUNT(*) as total_with_family
        FROM unconfirmed_persons
        WHERE person_type = 'enslaved'
        AND context_text ~* '(wife|husband|mother|father|son|daughter|child|spouse|parent)'
        GROUP BY 1
        ORDER BY total_with_family DESC
    `);

    for (const row of sourceCounts.rows) {
        console.log(`  ${row.source}: ${row.total_with_family}`);
    }

    await pool.end();
}

analyzeFamilyPatterns().catch(console.error);
