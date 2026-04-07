#!/usr/bin/env node
/**
 * DC Emancipation Compensated Data Investigation
 * Search for Biscoe family and DC emancipation data
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('neon') ? { rejectUnauthorized: false } : false
});

async function investigate() {
    const client = await pool.connect();
    
    try {
        console.log('\n========================================================================');
        console.log('  DC EMANCIPATION COMPENSATED DATA INVESTIGATION');
        console.log('========================================================================\n');
        
        // 1. Search for Biscoe in ALL tables
        console.log('1️⃣  SEARCHING FOR "BISCOE" IN ALL RELEVANT TABLES:\n');
        
        // unconfirmed_persons
        const biscoeUnconfirmed = await client.query(`
            SELECT lead_id, full_name, person_type, source_url, confidence_score, status, created_at
            FROM unconfirmed_persons
            WHERE full_name ILIKE '%biscoe%'
            ORDER BY full_name
        `);
        
        console.log(`   unconfirmed_persons: ${biscoeUnconfirmed.rows.length} records`);
        if (biscoeUnconfirmed.rows.length > 0) {
            biscoeUnconfirmed.rows.forEach(row => {
                console.log(`     - ${row.full_name} (${row.person_type}) | status: ${row.status} | conf: ${row.confidence_score}`);
                console.log(`       Source: ${row.source_url?.substring(0, 80)}`);
            });
        }
        
        // canonical_persons
        const biscoeCanonical = await client.query(`
            SELECT id, canonical_name, person_type, verification_status, confidence_score
            FROM canonical_persons
            WHERE canonical_name ILIKE '%biscoe%'
            ORDER BY canonical_name
        `);
        
        console.log(`\n   canonical_persons: ${biscoeCanonical.rows.length} records`);
        if (biscoeCanonical.rows.length > 0) {
            biscoeCanonical.rows.forEach(row => {
                console.log(`     - ${row.canonical_name} (${row.person_type}) | ${row.verification_status}`);
            });
        } else {
            console.log(`     ❌ NO BISCOES IN CANONICAL_PERSONS`);
        }
        
        // enslaved_individuals
        const biscoeEnslaved = await client.query(`
            SELECT enslaved_id, enslaved_name, birth_year, enslaver_id
            FROM enslaved_individuals
            WHERE enslaved_name ILIKE '%biscoe%'
            ORDER BY enslaved_name
        `);
        
        console.log(`\n   enslaved_individuals: ${biscoeEnslaved.rows.length} records`);
        if (biscoeEnslaved.rows.length > 0) {
            biscoeEnslaved.rows.forEach(row => {
                console.log(`     - ${row.enslaved_name} | enslaver_id: ${row.enslaver_id}`);
            });
        }
        
        // 2. Search for DC Compensated Emancipation data
        console.log('\n\n2️⃣  SEARCHING FOR DC EMANCIPATION/COMPENSATED EMANCIPATION DATA:\n');
        
        const dcSources = await client.query(`
            SELECT DISTINCT
                source_url,
                COUNT(*) as record_count,
                MIN(created_at) as first_import,
                MAX(created_at) as last_import
            FROM unconfirmed_persons
            WHERE source_url ILIKE '%civilwardc%' 
               OR source_url ILIKE '%compensation%'
               OR source_url ILIKE '%emancipation%'
            GROUP BY source_url
            ORDER BY record_count DESC
            LIMIT 20
        `);
        
        console.log(`   Found ${dcSources.rows.length} DC-related data sources:\n`);
        dcSources.rows.forEach(row => {
            console.log(`     - ${row.source_url?.substring(0, 90)}`);
            console.log(`       Records: ${row.record_count} | Imported: ${row.first_import?.toLocaleDateString()} to ${row.last_import?.toLocaleDateString()}`);
        });
        
        // 3. Get extraction method breakdown for DC data
        console.log('\n\n3️⃣  DC DATA BREAKDOWN BY EXTRACTION METHOD:\n');
        
        const dcStats = await client.query(`
            SELECT
                extraction_method,
                person_type,
                COUNT(*) as count,
                AVG(confidence_score) as avg_confidence
            FROM unconfirmed_persons
            WHERE source_url ILIKE '%civilwardc%'
            GROUP BY extraction_method, person_type
            ORDER BY extraction_method, person_type
        `);
        
        dcStats.rows.forEach(row => {
            console.log(`   ${row.extraction_method || 'NULL'} | ${row.person_type}: ${row.count} (avg conf: ${parseFloat(row.avg_confidence).toFixed(2)})`);
        });
        
        // 4. Total DC data by person_type
        console.log('\n\n4️⃣  DC DATA TOTALS:\n');
        
        const dcTotal = await client.query(`
            SELECT
                person_type,
                COUNT(*) as count
            FROM unconfirmed_persons
            WHERE source_url ILIKE '%civilwardc%'
            GROUP BY person_type
            ORDER BY count DESC
        `);
        
        dcTotal.rows.forEach(row => {
            console.log(`   ${row.person_type || 'NULL'}: ${row.count} records`);
        });
        
        // 5. Check for promotion gap
        console.log('\n\n5️⃣  PROMOTION GAP (CivilWarDC data in unconfirmed but NOT in canonical):\n');
        
        const notPromoted = await client.query(`
            SELECT
                person_type,
                COUNT(*) as count,
                COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed,
                COUNT(*) FILTER (WHERE status = 'pending') as pending,
                COUNT(*) FILTER (WHERE status = 'needs_review') as needs_review
            FROM unconfirmed_persons
            WHERE source_url ILIKE '%civilwardc%'
            AND person_type IN ('slaveholder', 'owner', 'enslaver')
            GROUP BY person_type
        `);
        
        console.log(`   Slaveholders/Enslavers still in unconfirmed_persons:\n`);
        notPromoted.rows.forEach(row => {
            console.log(`   ${row.person_type}: ${row.count} total`);
            console.log(`     - Confirmed: ${row.confirmed}`);
            console.log(`     - Pending: ${row.pending}`);
            console.log(`     - Needs review: ${row.needs_review}`);
        });
        
        console.log('\n========================================================================\n');
        
    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        client.release();
        await pool.end();
    }
}

investigate().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
