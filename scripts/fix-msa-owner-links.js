/**
 * Fix MSA Owner Links
 *
 * This script extracts owner names from unconfirmed_persons.context_text
 * and creates proper links between enslaved_individuals and their owners.
 *
 * Usage: DATABASE_URL=... node scripts/fix-msa-owner-links.js
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function main() {
    const client = await pool.connect();

    try {
        console.log('='.repeat(70));
        console.log('MSA OWNER LINK FIXER');
        console.log('='.repeat(70));

        // Step 1: Get unique owner names from unconfirmed_persons
        console.log('\n📊 Step 1: Extracting unique owner names...');
        const ownerResult = await client.query(`
            SELECT
                TRIM(substring(context_text from 'Owner: (.+)$')) as owner_name,
                COUNT(*) as enslaved_count
            FROM unconfirmed_persons
            WHERE source_url LIKE '%msa.maryland.gov%'
              AND person_type = 'enslaved'
              AND context_text ~ 'Owner: [A-Z]'
              AND context_text NOT LIKE '%Owner: unknown%'
              AND context_text NOT LIKE '%Owner: UNKNOWN%'
            GROUP BY TRIM(substring(context_text from 'Owner: (.+)$'))
            HAVING COUNT(*) > 0
            ORDER BY enslaved_count DESC
        `);

        console.log(`   Found ${ownerResult.rows.length} unique owners`);

        // Step 2: Create canonical_persons for each owner (if not exists)
        console.log('\n📝 Step 2: Creating canonical owner records...');
        let ownersCreated = 0;
        let ownersExisting = 0;
        const ownerIdMap = new Map(); // owner_name -> canonical_persons.id

        for (const row of ownerResult.rows) {
            const ownerName = row.owner_name;
            if (!ownerName || ownerName === 'UNKNOWN') continue;

            // Check if owner already exists
            const existingOwner = await client.query(`
                SELECT id FROM canonical_persons
                WHERE canonical_name ILIKE $1
                LIMIT 1
            `, [ownerName]);

            if (existingOwner.rows.length > 0) {
                ownerIdMap.set(ownerName.toLowerCase(), existingOwner.rows[0].id);
                ownersExisting++;
            } else {
                // Create new canonical_persons record
                const insertResult = await client.query(`
                    INSERT INTO canonical_persons (
                        canonical_name,
                        person_type,
                        primary_county,
                        primary_state,
                        notes,
                        confidence_score,
                        created_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
                    RETURNING id
                `, [
                    ownerName,
                    'enslaver',
                    'Montgomery County',
                    'Maryland',
                    `Slaveholder identified from Maryland State Archives SC 2908 Vol. 812 records. Owned ${row.enslaved_count} enslaved persons in Montgomery County, Maryland at the time of the 1864 Constitution.`,
                    0.85
                ]);

                ownerIdMap.set(ownerName.toLowerCase(), insertResult.rows[0].id);
                ownersCreated++;
            }
        }

        console.log(`   Created ${ownersCreated} new owner records`);
        console.log(`   Found ${ownersExisting} existing owner records`);
        console.log(`   Total owners mapped: ${ownerIdMap.size}`);

        // Step 3: Update enslaved_individuals with owner links
        console.log('\n🔗 Step 3: Linking enslaved persons to owners...');

        // First, get all enslaved persons from unconfirmed_persons with known owners
        const enslavedResult = await client.query(`
            SELECT
                lead_id,
                full_name,
                gender,
                context_text,
                TRIM(substring(context_text from 'Owner: (.+)$')) as owner_name,
                source_url
            FROM unconfirmed_persons
            WHERE source_url LIKE '%msa.maryland.gov%'
              AND person_type = 'enslaved'
              AND context_text ~ 'Owner: [A-Z]'
              AND context_text NOT LIKE '%Owner: unknown%'
              AND context_text NOT LIKE '%Owner: UNKNOWN%'
        `);

        console.log(`   Processing ${enslavedResult.rows.length} enslaved persons...`);

        let linked = 0;
        let created = 0;
        let skipped = 0;

        // Process in batches
        const batchSize = 100;
        for (let i = 0; i < enslavedResult.rows.length; i += batchSize) {
            const batch = enslavedResult.rows.slice(i, i + batchSize);

            await client.query('BEGIN');

            for (const person of batch) {
                const ownerName = person.owner_name;
                if (!ownerName) {
                    skipped++;
                    continue;
                }

                const ownerId = ownerIdMap.get(ownerName.toLowerCase());
                if (!ownerId) {
                    skipped++;
                    continue;
                }

                // Check if enslaved person already exists in enslaved_individuals
                const existingEnslaved = await client.query(`
                    SELECT enslaved_id FROM enslaved_individuals
                    WHERE full_name = $1
                      AND notes LIKE $2
                    LIMIT 1
                `, [person.full_name, `%${person.source_url}%`]);

                if (existingEnslaved.rows.length > 0) {
                    // Update existing record with owner link
                    await client.query(`
                        UPDATE enslaved_individuals
                        SET enslaved_by_individual_id = $1,
                            updated_at = NOW()
                        WHERE enslaved_id = $2
                    `, [ownerId.toString(), existingEnslaved.rows[0].enslaved_id]);
                    linked++;
                } else {
                    // Create new enslaved_individuals record
                    const enslavedId = `ENS-${require('crypto').randomBytes(4).toString('hex').toUpperCase()}`;

                    await client.query(`
                        INSERT INTO enslaved_individuals (
                            enslaved_id,
                            full_name,
                            gender,
                            enslaved_by_individual_id,
                            notes,
                            verified,
                            created_at
                        ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
                        ON CONFLICT DO NOTHING
                    `, [
                        enslavedId,
                        person.full_name,
                        person.gender,
                        ownerId.toString(),
                        person.context_text,
                        false
                    ]);
                    created++;
                }
            }

            await client.query('COMMIT');

            // Progress update
            if ((i + batchSize) % 1000 === 0 || i + batchSize >= enslavedResult.rows.length) {
                const progress = Math.min(i + batchSize, enslavedResult.rows.length);
                console.log(`   Progress: ${progress}/${enslavedResult.rows.length} (${linked} linked, ${created} created, ${skipped} skipped)`);
            }
        }

        // Step 4: Summary
        console.log('\n' + '='.repeat(70));
        console.log('📊 SUMMARY');
        console.log('='.repeat(70));
        console.log(`   Unique owners processed: ${ownerIdMap.size}`);
        console.log(`   New owner records created: ${ownersCreated}`);
        console.log(`   Existing enslaved records linked: ${linked}`);
        console.log(`   New enslaved records created: ${created}`);
        console.log(`   Skipped (no owner match): ${skipped}`);

        // Verify results
        const verifyResult = await client.query(`
            SELECT COUNT(*) as count
            FROM enslaved_individuals
            WHERE enslaved_by_individual_id IS NOT NULL
        `);
        console.log(`\n   Total enslaved_individuals with owner links: ${verifyResult.rows[0].count}`);

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

main()
    .then(() => {
        console.log('\n✅ Done!');
        process.exit(0);
    })
    .catch(err => {
        console.error('❌ Failed:', err);
        process.exit(1);
    });
