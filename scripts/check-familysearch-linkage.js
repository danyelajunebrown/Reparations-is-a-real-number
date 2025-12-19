#!/usr/bin/env node
/**
 * Check FamilySearch owner-enslaved linkage status
 */
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL_REQUIRED === 'true' ? { rejectUnauthorized: false } : false
});

async function check() {
    console.log('Checking FamilySearch linkage status...\n');

    // Check relationships column
    const result = await pool.query(`
        SELECT
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE relationships IS NOT NULL AND relationships != '[]'::jsonb) as with_relationships,
            COUNT(*) FILTER (WHERE context_text LIKE '%Owner:%') as with_owner_in_context,
            COUNT(*) FILTER (WHERE context_text LIKE '%Slaveholder:%') as with_slaveholder_in_context
        FROM unconfirmed_persons
        WHERE source_url LIKE '%familysearch%'
    `);
    console.log('FamilySearch Stats:');
    console.log('  Total records:', result.rows[0].total);
    console.log('  With relationships JSON:', result.rows[0].with_relationships);
    console.log('  With Owner: in context:', result.rows[0].with_owner_in_context);
    console.log('  With Slaveholder: in context:', result.rows[0].with_slaveholder_in_context);

    // Sample relationships
    const sample = await pool.query(`
        SELECT full_name, relationships, LEFT(context_text, 300) as context_preview
        FROM unconfirmed_persons
        WHERE source_url LIKE '%familysearch%'
          AND relationships IS NOT NULL
          AND relationships != '[]'::jsonb
        LIMIT 5
    `);

    if (sample.rows.length > 0) {
        console.log('\nSample records with relationships:');
        sample.rows.forEach(r => {
            console.log('  ' + r.full_name + ':');
            console.log('    Relationships:', JSON.stringify(r.relationships));
        });
    } else {
        console.log('\nNo records found with relationships JSON');
    }

    // Check slaveholders
    const slaveholders = await pool.query(`
        SELECT full_name, source_page_title
        FROM unconfirmed_persons
        WHERE source_url LIKE '%familysearch%'
          AND person_type IN ('slaveholder', 'owner')
        LIMIT 10
    `);
    console.log('\nSlaveholders in FamilySearch data:', slaveholders.rows.length);
    slaveholders.rows.forEach(r => {
        console.log('  ' + r.full_name + ' (' + r.source_page_title + ')');
    });

    await pool.end();
}

check().catch(console.error);
