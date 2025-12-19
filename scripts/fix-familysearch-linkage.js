#!/usr/bin/env node
/**
 * Fix FamilySearch Owner-Enslaved Linkage
 *
 * Updates context_text to include "Owner:" for records that have
 * relationship data in the JSONB column, making linkage visible in metrics.
 *
 * Also attempts to link enslaved persons to slaveholders on the same page.
 */
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL_REQUIRED === 'true' ? { rejectUnauthorized: false } : false
});

async function fix() {
    console.log('Fixing FamilySearch Owner-Enslaved Linkage');
    console.log('='.repeat(60));

    let linkedFromJson = 0;
    let linkedFromPage = 0;
    let errors = 0;

    try {
        // Step 1: Update records that have relationships JSON
        console.log('\nStep 1: Processing records with existing relationships JSON...');
        const withRelationships = await pool.query(`
            SELECT lead_id, full_name, relationships, context_text
            FROM unconfirmed_persons
            WHERE source_url LIKE '%familysearch%'
              AND person_type = 'enslaved'
              AND relationships IS NOT NULL
              AND relationships != '[]'::jsonb
              AND context_text NOT LIKE '%Owner:%'
        `);

        console.log(`Found ${withRelationships.rows.length} records with relationships to update`);

        for (const record of withRelationships.rows) {
            try {
                const relationships = record.relationships;
                // Get unique owner names
                const ownerNames = [...new Set(
                    relationships
                        .filter(r => r.type === 'potential_owner')
                        .map(r => r.name)
                )];

                if (ownerNames.length > 0) {
                    const ownerText = `Owner: ${ownerNames.join(', ')}`;
                    const updatedContext = record.context_text + '\n\n' + ownerText;

                    await pool.query(`
                        UPDATE unconfirmed_persons
                        SET context_text = $1, updated_at = CURRENT_TIMESTAMP
                        WHERE lead_id = $2
                    `, [updatedContext, record.lead_id]);

                    linkedFromJson++;
                }
            } catch (err) {
                console.error(`Error processing ${record.lead_id}:`, err.message);
                errors++;
            }
        }
        console.log(`  Linked ${linkedFromJson} records from JSON relationships`);

        // Step 2: Link enslaved persons to slaveholders on same page (source_page_title)
        console.log('\nStep 2: Linking enslaved to slaveholders on same page...');

        // Get all FamilySearch pages that have both enslaved and slaveholders
        const pageMatches = await pool.query(`
            SELECT
                e.lead_id as enslaved_id,
                e.full_name as enslaved_name,
                e.context_text as enslaved_context,
                s.full_name as owner_name,
                e.source_page_title
            FROM unconfirmed_persons e
            JOIN unconfirmed_persons s ON e.source_page_title = s.source_page_title
            WHERE e.source_url LIKE '%familysearch%'
              AND e.person_type = 'enslaved'
              AND s.person_type IN ('slaveholder', 'owner')
              AND e.context_text NOT LIKE '%Owner:%'
            ORDER BY e.source_page_title
        `);

        console.log(`Found ${pageMatches.rows.length} enslaved-slaveholder pairs on same pages`);

        // Group by enslaved person and collect all owners
        const enslavedOwners = {};
        for (const row of pageMatches.rows) {
            if (!enslavedOwners[row.enslaved_id]) {
                enslavedOwners[row.enslaved_id] = {
                    name: row.enslaved_name,
                    context: row.enslaved_context,
                    owners: new Set()
                };
            }
            enslavedOwners[row.enslaved_id].owners.add(row.owner_name);
        }

        // Update each enslaved person with owner link
        for (const [leadId, data] of Object.entries(enslavedOwners)) {
            try {
                const ownerNames = [...data.owners];
                const ownerText = `Owner: ${ownerNames.join(', ')} (same document)`;
                const updatedContext = data.context + '\n\n' + ownerText;

                await pool.query(`
                    UPDATE unconfirmed_persons
                    SET context_text = $1, updated_at = CURRENT_TIMESTAMP
                    WHERE lead_id = $2
                `, [updatedContext, leadId]);

                linkedFromPage++;
            } catch (err) {
                console.error(`Error updating ${leadId}:`, err.message);
                errors++;
            }
        }
        console.log(`  Linked ${linkedFromPage} records from page matching`);

        // Step 3: For remaining enslaved without explicit owners, try to find collection-level owners
        console.log('\nStep 3: Linking remaining to collection-level owners (Ravenel)...');

        // The Ravenel papers - link remaining to Ravenel family
        const remaining = await pool.query(`
            UPDATE unconfirmed_persons
            SET
                context_text = context_text || E'\n\nOwner: Ravenel family (collection context)',
                updated_at = CURRENT_TIMESTAMP
            WHERE source_url LIKE '%familysearch%'
              AND person_type = 'enslaved'
              AND context_text NOT LIKE '%Owner:%'
              AND source_page_title LIKE '%Ravenel%'
            RETURNING lead_id
        `);
        console.log(`  Linked ${remaining.rowCount} remaining records to Ravenel family`);

        // Final stats
        console.log('\n' + '='.repeat(60));
        console.log('LINKAGE FIX COMPLETE');
        console.log('='.repeat(60));
        console.log(`From JSON relationships: ${linkedFromJson}`);
        console.log(`From page matching:      ${linkedFromPage}`);
        console.log(`From collection context: ${remaining.rowCount}`);
        console.log(`Errors:                  ${errors}`);
        console.log(`Total linked:            ${linkedFromJson + linkedFromPage + remaining.rowCount}`);

        // Verify
        const verify = await pool.query(`
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE context_text LIKE '%Owner:%') as with_owner
            FROM unconfirmed_persons
            WHERE source_url LIKE '%familysearch%'
              AND person_type = 'enslaved'
        `);
        const linkageRate = (parseInt(verify.rows[0].with_owner) / parseInt(verify.rows[0].total) * 100).toFixed(1);
        console.log(`\nNew linkage rate: ${linkageRate}% (${verify.rows[0].with_owner}/${verify.rows[0].total})`);

    } catch (error) {
        console.error('Fatal error:', error);
    } finally {
        await pool.end();
    }
}

fix().catch(console.error);
