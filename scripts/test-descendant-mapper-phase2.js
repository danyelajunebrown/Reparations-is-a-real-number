/**
 * Test DescendantMapper - PHASE 2: Full 8 Generation Traversal
 * 
 * This runs the complete 8-generation mapping to find Nancy Miller Brown
 */

const DescendantMapper = require('../src/services/genealogy/DescendantMapper');
const db = require('../database.js');

async function testPhase2() {
    console.log('========================================');
    console.log('PHASE 2: Full 8-Generation Traversal');
    console.log('James Hopewell → Nancy Miller Brown');
    console.log('========================================\n');

    const mapper = new DescendantMapper(db, {
        headless: false, // Show browser for observation
        rateLimit: 2000, // 2 seconds between requests
        maxDepth: 8      // 8 generations
    });

    try {
        // Initialize
        console.log('Initializing DescendantMapper...');
        await mapper.init();
        console.log('✓ Mapper initialized\n');

        console.log('⚠️  This will take several minutes...\n');
        console.log('Starting full 8-generation traversal...\n');
        
        const startTime = Date.now();
        
        const phase2Result = await mapper.mapDescendants(
            'James Hopewell',
            'Hopewell-183',
            {
                deathYear: 1817,
                location: "St. Mary's, Maryland"
            }
        );

        const duration = (Date.now() - startTime) / 1000;

        console.log('\n========================================');
        console.log('✓ Phase 2 Complete!');
        console.log('========================================');
        console.log('Total descendants:', phase2Result.totalDescendants);
        console.log('Max generation reached:', phase2Result.maxGeneration);
        console.log('Duration:', (duration / 60).toFixed(1), 'minutes');

        // Search for Nancy Miller Brown
        console.log('\n--- Searching for Nancy Miller Brown ---');
        const nancyQuery = await db.query(`
            SELECT 
                descendant_name,
                familysearch_person_id as wikitree_id,
                generation_from_owner,
                descendant_birth_year as birth_year,
                confidence_score
            FROM slave_owner_descendants_suspected
            WHERE owner_name = 'James Hopewell'
              AND (
                descendant_name ILIKE '%Nancy%Miller%' OR
                descendant_name ILIKE '%Miller%Nancy%' OR
                descendant_name ILIKE '%Nancy%Brown%'
              )
            ORDER BY generation_from_owner DESC
        `);

        if (nancyQuery.rows.length > 0) {
            console.log(`\n✅ Found ${nancyQuery.rows.length} potential matches:`);
            nancyQuery.rows.forEach(row => {
                console.log(`  ${row.descendant_name} (Gen ${row.generation_from_owner})`);
                console.log(`    WikiTree: ${row.wikitree_id}`);
                console.log(`    Birth: ${row.birth_year || 'Unknown'}`);
                console.log(`    Confidence: ${row.confidence_score}`);
            });

            // Get full lineage to Nancy
            if (nancyQuery.rows.length > 0) {
                const nancy = nancyQuery.rows[0];
                console.log(`\n--- Full Lineage to ${nancy.descendant_name} ---`);
                const lineage = await mapper.getFullLineage('James Hopewell', nancy.descendant_name);
                
                console.log('\nComplete path from James Hopewell:');
                lineage.forEach(person => {
                    const indent = '  '.repeat(person.generation_from_owner);
                    console.log(`${indent}Gen ${person.generation_from_owner}: ${person.descendant_name} (${person.birth_year || '?'}-${person.death_year || '?'})`);
                });
            }
        } else {
            console.log('\n⚠️  Nancy Miller Brown not found in descendant tree');
            console.log('This may mean:');
            console.log('  1. She is beyond 8 generations');
            console.log('  2. The path diverges from WikiTree data');
            console.log('  3. Names differ on WikiTree vs FamilySearch');
            
            // Search for any "Miller" or "Nancy" in later generations
            console.log('\n--- Searching for any Miller/Nancy in generations 6-8 ---');
            const millerQuery = await db.query(`
                SELECT 
                    descendant_name,
                    generation_from_owner,
                    descendant_birth_year
                FROM slave_owner_descendants_suspected
                WHERE owner_name = 'James Hopewell'
                  AND generation_from_owner >= 6
                  AND (
                    descendant_name ILIKE '%Miller%' OR
                    descendant_name ILIKE '%Nancy%'
                  )
                ORDER BY generation_from_owner DESC, descendant_name
            `);
            
            console.log(`Found ${millerQuery.rows.length} potential candidates:`);
            millerQuery.rows.forEach(row => {
                console.log(`  Gen ${row.generation_from_owner}: ${row.descendant_name} (${row.descendant_birth_year || '?'})`);
            });
        }

        // Final statistics
        const finalStats = await mapper.getMappingStats(phase2Result.ownerId);
        console.log('\n--- Final Statistics ---');
        console.log('Total descendants mapped:', finalStats.total_descendants);
        console.log('Generations reached:', finalStats.generations_mapped);
        console.log('Living descendants (protected):', finalStats.living_descendants);
        console.log('High confidence lineages:', finalStats.high_confidence);
        console.log('Medium confidence lineages:', finalStats.medium_confidence);
        console.log('Low confidence lineages:', finalStats.low_confidence);
        console.log('Average confidence:', parseFloat(finalStats.avg_confidence).toFixed(2));

        console.log('\n========================================');
        console.log('✓ Full 8-Generation Mapping Complete!');
        console.log('========================================\n');

    } catch (error) {
        console.error('\n❌ Test failed!');
        console.error('Error:', error.message);
        console.error(error.stack);
    } finally {
        await mapper.close();
        console.log('Mapper closed. Exiting...');
        process.exit(0);
    }
}

// Run the test
testPhase2().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
