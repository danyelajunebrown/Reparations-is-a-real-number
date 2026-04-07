#!/usr/bin/env node

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
        console.log('  DC EMANCIPATION DATA - PART 2: PROMOTION ANALYSIS');
        console.log('========================================================================\n');
        
        // Check what extraction_method the DC data has
        console.log('1. DC DATA EXTRACTION METHODS & STATUS:\n');
        
        const dcStats = await client.query(`
            SELECT
                extraction_method,
                person_type,
                status,
                COUNT(*) as count
            FROM unconfirmed_persons
            WHERE source_url ILIKE '%civilwardc%'
            GROUP BY extraction_method, person_type, status
            ORDER BY extraction_method, person_type, status
        `);
        
        let totalDC = 0;
        dcStats.rows.forEach(row => {
            totalDC += row.count;
            console.log(`   ${row.extraction_method || 'NULL'} | ${row.person_type} | ${row.status}: ${row.count}`);
        });
        console.log(`   TOTAL DC RECORDS: ${totalDC}\n`);
        
        // Total DC data breakdown
        console.log('2. DC DATA TOTALS BY PERSON_TYPE:\n');
        
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
            console.log(`   ${row.person_type || 'NULL'}: ${row.count}`);
        });
        
        // Enslaver/Slaveholder promotion gap
        console.log('\n\n3. PROMOTION GAP - ENSLAVERS/SLAVEHOLDERS:\n');
        
        const slaveholders = await client.query(`
            SELECT
                person_type,
                COUNT(*) as total_in_unconfirmed,
                COUNT(*) FILTER (WHERE status = 'confirmed') as promoted_confirmed,
                COUNT(*) FILTER (WHERE status = 'pending') as status_pending,
                COUNT(*) FILTER (WHERE status = 'needs_review') as status_needs_review,
                COUNT(*) FILTER (WHERE status = 'rejected') as status_rejected
            FROM unconfirmed_persons
            WHERE source_url ILIKE '%civilwardc%'
            AND person_type IN ('slaveholder', 'owner', 'enslaver')
            GROUP BY person_type
        `);
        
        console.log('   Slaveholders/Enslavers in unconfirmed_persons:\n');
        slaveholders.rows.forEach(row => {
            console.log(`   ${row.person_type}: ${row.total_in_unconfirmed} total`);
            console.log(`     - Status "confirmed": ${row.promoted_confirmed}`);
            console.log(`     - Status "pending": ${row.status_pending}`);
            console.log(`     - Status "needs_review": ${row.status_needs_review}`);
            console.log(`     - Status "rejected": ${row.status_rejected}`);
            console.log(`     - STILL NOT PROMOTED TO CANONICAL: ${row.total_in_unconfirmed - row.promoted_confirmed}\n`);
        });
        
        // Check what's actually in canonical_persons as enslavers
        console.log('\n4. WHAT IS ACTUALLY IN CANONICAL_PERSONS AS ENSLAVERS:\n');
        
        const canonicalEnslavers = await client.query(`
            SELECT
                person_type,
                COUNT(*) as count,
                COUNT(*) FILTER (WHERE verification_status ILIKE '%civilwardc%') as from_civilwardc
            FROM canonical_persons
            WHERE person_type = 'enslaver'
            GROUP BY person_type
        `);
        
        canonicalEnslavers.rows.forEach(row => {
            console.log(`   ${row.person_type}: ${row.count} total in canonical_persons`);
            console.log(`     - From CivilWarDC: ${row.from_civilwardc}`);
        });
        
        // List the DC enslavers that WERE promoted to canonical
        const promotedEnslavers = await client.query(`
            SELECT canonical_name, verification_status, confidence_score
            FROM canonical_persons
            WHERE person_type = 'enslaver'
            AND verification_status ILIKE '%civilwardc%'
            ORDER BY canonical_name
            LIMIT 10
        `);
        
        console.log('\n   Sample DC enslavers that WERE promoted:\n');
        promotedEnslavers.rows.forEach(row => {
            console.log(`     - ${row.canonical_name} (${row.verification_status})`);
        });
        
        // Check why Biscoes weren't promoted
        console.log('\n\n5. BISCOE PROMOTION STATUS ANALYSIS:\n');
        
        const biscoeStatus = await client.query(`
            SELECT
                full_name,
                person_type,
                status,
                COUNT(*) as count
            FROM unconfirmed_persons
            WHERE full_name ILIKE '%biscoe%'
            AND source_url ILIKE '%civilwardc%'
            AND person_type IN ('slaveholder', 'owner', 'enslaver')
            GROUP BY full_name, person_type, status
            ORDER BY full_name, person_type, status
        `);
        
        console.log(`   Biscoe slaveholders by status:\n`);
        let biscoePromoted = 0;
        let biscoeNotPromoted = 0;
        biscoeStatus.rows.forEach(row => {
            console.log(`     - ${row.full_name} (${row.person_type}) | status: ${row.status} | count: ${row.count}`);
            if (row.status === 'confirmed') {
                biscoePromoted += row.count;
            } else {
                biscoeNotPromoted += row.count;
            }
        });
        
        console.log(`\n   Biscoes promoted to canonical: ${biscoePromoted}`);
        console.log(`   Biscoes STILL in unconfirmed: ${biscoeNotPromoted}`);
        
        console.log('\n\n6. CHECKING HISTORICAL_REPARATIONS_PETITIONS FOR DC DATA:\n');
        
        try {
            const petitions = await client.query(`
                SELECT COUNT(*) as total
                FROM historical_reparations_petitions
            `);
            
            console.log(`   Total rows in historical_reparations_petitions: ${petitions.rows[0].total}`);
            
            // Check for any Biscoe petitions
            const biscoesPet = await client.query(`
                SELECT id, petitioner_name, enslaver_name, petition_date
                FROM historical_reparations_petitions
                WHERE petitioner_name ILIKE '%biscoe%' OR enslaver_name ILIKE '%biscoe%'
            `);
            
            console.log(`   Biscoe entries in historical_reparations_petitions: ${biscoesPet.rows.length}`);
            if (biscoesPet.rows.length > 0) {
                console.log(`   (This would indicate DC compensation data was imported)`);
            } else {
                console.log(`   (No Biscoes found - suggests DC compensation data NOT imported to this table)`);
            }
        } catch (err) {
            console.log(`   Table exists but query failed: ${err.message.substring(0, 60)}`);
        }
        
        console.log('\n========================================================================\n');
        
    } catch (error) {
        console.error('Error:', error.message);
        console.error('Full error:', error);
    } finally {
        client.release();
        await pool.end();
    }
}

investigate().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
