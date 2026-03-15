#!/usr/bin/env node
/**
 * Promote CivilWarDC Slaveholders to Canonical Persons
 * 
 * Specifically targets Biscoe and Chew families for Nancy Brown's DAA
 * Promotes from unconfirmed_persons → canonical_persons
 * Then extracts enslaved_individuals links
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function promoteCivilWarDCSlaveholders() {
    const client = await pool.connect();
    
    try {
        console.log('=== PROMOTING CIVILWARDC SLAVEHOLDERS ===\n');
        
        await client.query('BEGIN');
        
        // Find all Biscoe/Chew slaveholders in unconfirmed_persons
        const slaveholders = await client.query(`
            SELECT DISTINCT
                full_name,
                person_type,
                source_url,
                confidence_score,
                birth_year,
                death_year,
                locations,
                context_text,
                lead_id
            FROM unconfirmed_persons
            WHERE source_url LIKE '%civilwardc%'
            AND (
                full_name ILIKE '%biscoe%' 
                OR full_name ILIKE '%chew%'
                OR full_name ILIKE '%angelica%'
            )
            AND person_type IN ('slaveholder', 'unknown')
            AND status IN ('pending', 'needs_review')
            ORDER BY full_name
        `);
        
        console.log(`Found ${slaveholders.rows.length} potential slaveholders:\n`);
        
        let promoted = 0;
        
        for (const sh of slaveholders.rows) {
            console.log(`Processing: ${sh.full_name} (${sh.person_type})`);
            
            // Check if already in canonical_persons
            const existing = await client.query(`
                SELECT id FROM canonical_persons 
                WHERE canonical_name = $1
            `, [sh.full_name]);
            
            if (existing.rows.length > 0) {
                console.log(`  ✓ Already in canonical_persons (id: ${existing.rows[0].id})`);
                continue;
            }
            
            // Determine person_type (default to enslaver if marked as slaveholder)
            let personType = sh.person_type === 'slaveholder' ? 'enslaver' : 'enslaver';
            
            // Insert into canonical_persons
            const result = await client.query(`
                INSERT INTO canonical_persons (
                    canonical_name,
                    person_type,
                    birth_year_estimate,
                    death_year_estimate,
                    primary_state,
                    verification_status,
                    confidence_score,
                    notes,
                    created_by
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING id
            `, [
                sh.full_name,
                personType,
                sh.birth_year,
                sh.death_year,
                sh.locations && sh.locations.length > 0 ? sh.locations[0] : null,
                'civilwardc_primary_source',
                sh.confidence_score || 0.95,
                `CivilWarDC: ${sh.context_text || 'Compensated Emancipation Petition'}\nSource: ${sh.source_url}`,
                'promote-civilwardc-slaveholders.js'
            ]);
            
            const canonicalId = result.rows[0].id;
            console.log(`  ✓ Promoted to canonical_persons (id: ${canonicalId})`);
            
            // Update unconfirmed_persons status
            await client.query(`
                UPDATE unconfirmed_persons
                SET status = 'confirmed',
                    reviewed_at = NOW()
                WHERE lead_id = $1
            `, [sh.lead_id]);
            
            promoted++;
        }
        
        await client.query('COMMIT');
        
        console.log(`\n=== SUMMARY ===`);
        console.log(`Slaveholders promoted: ${promoted}`);
        
        // Now extract enslaved persons for these slaveholders
        console.log(`\n=== EXTRACTING ENSLAVED PERSONS ===\n`);
        
        const enslaved = await client.query(`
            SELECT 
                full_name as enslaved_name,
                source_url,
                context_text,
                birth_year,
                death_year,
                gender
            FROM unconfirmed_persons
            WHERE source_url LIKE '%civilwardc%'
            AND source_url IN (
                SELECT DISTINCT source_url 
                FROM unconfirmed_persons 
                WHERE (full_name ILIKE '%biscoe%' OR full_name ILIKE '%chew%' OR full_name ILIKE '%angelica%')
                AND person_type = 'slaveholder'
            )
            AND person_type = 'enslaved'
            AND status IN ('pending', 'needs_review')
            LIMIT 100
        `);
        
        console.log(`Found ${enslaved.rows.length} enslaved persons in related petitions`);
        
        // Get the canonical IDs we just created
        const canonicalIds = await client.query(`
            SELECT id, canonical_name 
            FROM canonical_persons 
            WHERE canonical_name ILIKE '%biscoe%' 
               OR canonical_name ILIKE '%chew%'
               OR canonical_name ILIKE '%angelica%'
            AND person_type = 'enslaver'
        `);
        
        console.log(`\nWill link enslaved persons to ${canonicalIds.rows.length} slaveholders`);
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// Run
if (require.main === module) {
    promoteCivilWarDCSlaveholders()
        .then(() => {
            console.log('\n✓ Complete!');
            process.exit(0);
        })
        .catch(err => {
            console.error('\n✗ Failed:', err.message);
            process.exit(1);
        });
}

module.exports = { promoteCivilWarDCSlaveholders };
