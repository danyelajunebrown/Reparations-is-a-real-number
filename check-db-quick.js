require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function check() {
    console.log('=== DATABASE CONTENT CHECK ===\n');
    
    try {
        // Check all relevant tables
        const tables = ['documents', 'unconfirmed_persons', 'individuals', 'enslaved_people', 'enslaved_individuals'];
        
        for (const table of tables) {
            try {
                const res = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
                console.log(`${table}: ${res.rows[0].count} rows`);
                
                // Show sample if there are rows
                if (parseInt(res.rows[0].count) > 0) {
                    const sample = await pool.query(`SELECT * FROM ${table} LIMIT 1`);
                    console.log(`  Sample columns: ${Object.keys(sample.rows[0]).slice(0, 5).join(', ')}...`);
                }
            } catch (e) {
                console.log(`${table}: ❌ TABLE NOT FOUND`);
            }
        }

        console.log('\n=== CHECKING STATS QUERY ===');
        try {
            const stats = await pool.query(`
                SELECT
                    COUNT(*) as total_records,
                    COUNT(DISTINCT source_url) as unique_sources,
                    COUNT(CASE WHEN person_type IN ('owner', 'slaveholder', 'confirmed_owner') THEN 1 END) as slaveholders,
                    COUNT(CASE WHEN person_type IN ('enslaved', 'confirmed_enslaved') THEN 1 END) as enslaved
                FROM unconfirmed_persons
            `);
            console.log('Stats result:', stats.rows[0]);
        } catch (e) {
            console.log('Stats query error:', e.message);
        }

        console.log('\n=== CHECKING DOCUMENTS FOR VIEWER ===');
        try {
            const docs = await pool.query(`
                SELECT document_id, owner_name, file_path, storage_type, mime_type 
                FROM documents 
                ORDER BY created_at DESC 
                LIMIT 3
            `);
            console.log(`Found ${docs.rows.length} documents:`);
            docs.rows.forEach(doc => {
                console.log(`  - ${doc.owner_name}: ${doc.file_path || 'NO PATH'} (${doc.storage_type || 'NO TYPE'})`);
            });
        } catch (e) {
            console.log('Documents query error:', e.message);
        }

    } catch (e) {
        console.error('❌ Error:', e.message);
    } finally {
        await pool.end();
    }
}

check();
