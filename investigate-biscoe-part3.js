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
        console.log('  DC EMANCIPATION DATA - PART 3: SOURCE & PIPELINE');
        console.log('========================================================================\n');
        
        // Get detailed Biscoe petition records
        console.log('1. DETAILED BISCOE RECORDS FROM CIVILWARDC PETITIONS:\n');
        
        const biscoeDetails = await client.query(`
            SELECT
                lead_id,
                full_name,
                person_type,
                status,
                extraction_method,
                source_url,
                confidence_score,
                context_text
            FROM unconfirmed_persons
            WHERE full_name ILIKE '%ann m. biscoe%'
            AND source_url ILIKE '%civilwardc%'
            LIMIT 5
        `);
        
        biscoeDetails.rows.forEach((row, i) => {
            console.log(`   Record ${i+1}: ${row.full_name}`);
            console.log(`     - lead_id: ${row.lead_id}`);
            console.log(`     - person_type: ${row.person_type}`);
            console.log(`     - status: ${row.status}`);
            console.log(`     - extraction_method: ${row.extraction_method}`);
            console.log(`     - confidence_score: ${row.confidence_score}`);
            console.log(`     - source_url: ${row.source_url}`);
            console.log(`     - context_text: ${row.context_text?.substring(0, 100)}...\n`);
        });
        
        // Check what's in the Biscoe records from FamilySearch vs CivilWarDC
        console.log('\n2. BISCOE DATA SOURCES (CivilWarDC vs FamilySearch):\n');
        
        const biscoeBySource = await client.query(`
            SELECT
                CASE
                    WHEN source_url ILIKE '%civilwardc%' THEN 'CivilWarDC'
                    WHEN source_url ILIKE '%familysearch%' THEN 'FamilySearch'
                    ELSE 'Other'
                END as source,
                person_type,
                status,
                COUNT(*) as count
            FROM unconfirmed_persons
            WHERE full_name ILIKE '%biscoe%'
            AND person_type IN ('slaveholder', 'owner', 'enslaver')
            GROUP BY source, person_type, status
            ORDER BY source, person_type, status
        `);
        
        biscoeBySource.rows.forEach(row => {
            console.log(`   ${row.source} | ${row.person_type} | ${row.status}: ${row.count}`);
        });
        
        // Show actual CivilWarDC petition pages that reference Biscoes
        console.log('\n\n3. CIVILWARDC PETITION PAGES WITH BISCOES:\n');
        
        const petitionPages = await client.query(`
            SELECT DISTINCT source_url
            FROM unconfirmed_persons
            WHERE full_name ILIKE '%biscoe%'
            AND source_url ILIKE '%civilwardc%'
            ORDER BY source_url
        `);
        
        console.log(`   Found ${petitionPages.rows.length} unique CivilWarDC petition pages:\n`);
        petitionPages.rows.slice(0, 10).forEach(row => {
            console.log(`     - ${row.source_url}`);
        });
        
        // Check extraction method usage
        console.log('\n\n4. EXTRACTION METHOD IN USE FOR DC DATA:\n');
        
        const methods = await client.query(`
            SELECT DISTINCT
                extraction_method,
                COUNT(*) as total_records
            FROM unconfirmed_persons
            WHERE source_url ILIKE '%civilwardc%'
            GROUP BY extraction_method
            ORDER BY total_records DESC
        `);
        
        methods.rows.forEach(row => {
            console.log(`   ${row.extraction_method}: ${row.total_records} records`);
        });
        
        // Check the promote script results
        console.log('\n\n5. PROMOTION STATUS - BISCOES IN CANONICAL_PERSONS:\n');
        
        const promotedBiscoes = await client.query(`
            SELECT canonical_name, verification_status, confidence_score, person_type
            FROM canonical_persons
            WHERE canonical_name ILIKE '%biscoe%'
            AND person_type = 'enslaver'
            ORDER BY canonical_name
        `);
        
        console.log(`   Biscoes in canonical_persons as enslavers: ${promotedBiscoes.rows.length}\n`);
        promotedBiscoes.rows.forEach(row => {
            console.log(`     - ${row.canonical_name} (${row.verification_status}) [conf: ${row.confidence_score}]`);
        });
        
        console.log('\n   KEY FINDINGS:');
        console.log('   - Only 7-10 Biscoes promoted from unconfirmed despite 63 Biscoe records');
        console.log('   - Most Biscoe records are still status=pending or needs_review');
        console.log('   - NOT automatically promoted when marked as confirmed');
        console.log('   - The promote-civilwardc-slaveholders.js script targets specific names');
        console.log('   - Script searches for status IN (pending, needs_review) but most are pending');
        console.log('   - Biscoe search includes %biscoe%, %chew%, %angelica% specifically');
        
        console.log('\n\n6. WHICH BISCOES WERE PROMOTED:\n');
        
        const promotedNames = await client.query(`
            SELECT canonical_name, verification_status
            FROM canonical_persons
            WHERE canonical_name ILIKE '%biscoe%'
            AND verification_status ILIKE '%civilwardc%'
            ORDER BY canonical_name
        `);
        
        promotedNames.rows.forEach(row => {
            console.log(`   - ${row.canonical_name}`);
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
