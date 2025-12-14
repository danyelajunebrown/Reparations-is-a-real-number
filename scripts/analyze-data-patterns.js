require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function analyzePatternsDatabase() {
    console.log('=== ANALYZING DATA PATTERNS IN DATABASE ===\n');
    
    try {
        // Get sample of enslaved people
        console.log('📊 ENSLAVED PEOPLE SAMPLES (50 random):');
        const enslaved = await pool.query(`
            SELECT full_name, person_type, birth_year, death_year, gender, locations, context_text, source_url
            FROM unconfirmed_persons
            WHERE person_type IN ('enslaved', 'suspected_enslaved', 'confirmed_enslaved')
            ORDER BY RANDOM()
            LIMIT 50
        `);
        
        console.log(`Found ${enslaved.rows.length} enslaved records\n`);
        
        let ownersExtracted = 0;
        let datesExtracted = 0;
        const ownerPatterns = new Set();
        
        enslaved.rows.forEach((person, idx) => {
            if (idx < 10) { // Show first 10 in detail
                console.log(`\n${idx + 1}. ${person.full_name} (${person.person_type})`);
                console.log(`   Birth: ${person.birth_year || 'N/A'}, Death: ${person.death_year || 'N/A'}`);
                console.log(`   Gender: ${person.gender || 'N/A'}`);
                console.log(`   Context: ${person.context_text ? person.context_text.substring(0, 200) : 'NO CONTEXT'}...`);
                console.log(`   Source: ${person.source_url ? new URL(person.source_url).hostname : 'N/A'}`);
            }
            
            // Try to extract owner
            if (person.context_text) {
                const patterns = [
                    /Owner:\s*([A-Za-z\s\.]+?)(?:\s*\||$)/i,
                    /Slaveholder:\s*([A-Za-z\s\.]+?)(?:\s*\||$)/i,
                    /Enslaved by:\s*([A-Za-z\s\.]+?)(?:\s*\||$)/i,
                    /held by:\s*([A-Za-z\s\.]+?)(?:\s*\||$)/i,
                    /Property of:\s*([A-Za-z\s\.]+?)(?:\s*\||$)/i,
                    /Owned by:\s*([A-Za-z\s\.]+?)(?:\s*\||$)/i
                ];
                
                for (const pattern of patterns) {
                    const match = person.context_text.match(pattern);
                    if (match && match[1]) {
                        ownersExtracted++;
                        ownerPatterns.add(pattern.source);
                        break;
                    }
                }
            }
            
            if (person.birth_year || person.death_year) {
                datesExtracted++;
            }
        });
        
        console.log(`\n📈 EXTRACTION SUCCESS RATES (Enslaved):`);
        console.log(`   Owner names extracted: ${ownersExtracted}/${enslaved.rows.length} (${(ownersExtracted/enslaved.rows.length*100).toFixed(1)}%)`);
        console.log(`   Birth/Death dates available: ${datesExtracted}/${enslaved.rows.length} (${(datesExtracted/enslaved.rows.length*100).toFixed(1)}%)`);
        console.log(`   Patterns used: ${ownerPatterns.size}`);
        
        // Get sample of owners
        console.log('\n\n📊 SLAVEHOLDER SAMPLES (20 random):');
        const owners = await pool.query(`
            SELECT full_name, person_type, birth_year, death_year, locations, context_text, source_url
            FROM unconfirmed_persons
            WHERE person_type IN ('owner', 'slaveholder', 'suspected_owner', 'confirmed_owner')
            ORDER BY RANDOM()
            LIMIT 20
        `);
        
        console.log(`Found ${owners.rows.length} owner records\n`);
        
        owners.rows.forEach((person, idx) => {
            if (idx < 5) {
                console.log(`\n${idx + 1}. ${person.full_name} (${person.person_type})`);
                console.log(`   Birth: ${person.birth_year || 'N/A'}, Death: ${person.death_year || 'N/A'}`);
                console.log(`   Context: ${person.context_text ? person.context_text.substring(0, 200) : 'NO CONTEXT'}...`);
            }
        });
        
        // Check context_text patterns across all
        console.log('\n\n🔍 CONTEXT_TEXT PATTERNS ANALYSIS:');
        const patternCheck = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN context_text LIKE '%Owner:%' THEN 1 END) as has_owner_label,
                COUNT(CASE WHEN context_text LIKE '%Slaveholder:%' THEN 1 END) as has_slaveholder_label,
                COUNT(CASE WHEN context_text LIKE '%enslaved by%' THEN 1 END) as has_enslaved_by,
                COUNT(CASE WHEN context_text LIKE '%Property of%' THEN 1 END) as has_property_of,
                COUNT(CASE WHEN context_text LIKE '%|%' THEN 1 END) as has_pipe_delimiter,
                COUNT(CASE WHEN birth_year IS NOT NULL THEN 1 END) as has_birth_year,
                COUNT(CASE WHEN death_year IS NOT NULL THEN 1 END) as has_death_year,
                COUNT(CASE WHEN gender IS NOT NULL THEN 1 END) as has_gender
            FROM unconfirmed_persons
            WHERE person_type IN ('enslaved', 'suspected_enslaved', 'confirmed_enslaved')
        `);
        
        const stats = patternCheck.rows[0];
        console.log(`Total enslaved records: ${stats.total}`);
        console.log(`Has "Owner:" label: ${stats.has_owner_label} (${(stats.has_owner_label/stats.total*100).toFixed(1)}%)`);
        console.log(`Has "Slaveholder:" label: ${stats.has_slaveholder_label} (${(stats.has_slaveholder_label/stats.total*100).toFixed(1)}%)`);
        console.log(`Has "enslaved by": ${stats.has_enslaved_by} (${(stats.has_enslaved_by/stats.total*100).toFixed(1)}%)`);
        console.log(`Has "Property of": ${stats.has_property_of} (${(stats.has_property_of/stats.total*100).toFixed(1)}%)`);
        console.log(`Has pipe delimiter (|): ${stats.has_pipe_delimiter} (${(stats.has_pipe_delimiter/stats.total*100).toFixed(1)}%)`);
        console.log(`Has birth_year: ${stats.has_birth_year} (${(stats.has_birth_year/stats.total*100).toFixed(1)}%)`);
        console.log(`Has death_year: ${stats.has_death_year} (${(stats.has_death_year/stats.total*100).toFixed(1)}%)`);
        console.log(`Has gender: ${stats.has_gender} (${(stats.has_gender/stats.total*100).toFixed(1)}%)`);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await pool.end();
    }
}

analyzePatternsDatabase();
