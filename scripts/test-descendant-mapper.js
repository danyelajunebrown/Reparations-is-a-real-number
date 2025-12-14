/**
 * Test DescendantMapper - Full 8 Generation Traversal
 * 
 * Test Case: James Hopewell → Nancy Miller Brown
 * 
 * Expected path (from FamilySearch screenshot):
 * Gen 0: James Hopewell (1792-1875)
 * Gen 1: George Washington Biscoe via Anne Maria Hopewell
 * Gen 2: Maria Angelica Biscoe
 * Gen 3: Frisby Freeland Chew or Rebekah Freeland Chew
 * Gen 4: Charles Huntington Lyman
 * Gen 5: Charles Huntington Lyman (son)
 * Gen 6: Marjorie Lyman
 * Gen 7: Nancy Miller
 * Gen 8: Nancy Miller Brown (modern descendant)
 */

const DescendantMapper = require('../src/services/genealogy/DescendantMapper');
const db = require('../database.js');

async function testDescendantMapper() {
    console.log('========================================');
    console.log('FULL SYSTEM TEST: Descendant Mapper');
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

        // Test with limited depth first (3 generations) to verify system works
        console.log('=== PHASE 1: Test with 3 generations ===\n');
        mapper.maxDepth = 3;
        
        const phase1Result = await mapper.mapDescendants(
            'James Hopewell',
            'Hopewell-183',
            {
                deathYear: 1817,
                location: "St. Mary's, Maryland"
            }
        );

        console.log('\n--- Phase 1 Results ---');
        console.log('Total descendants:', phase1Result.totalDescendants);
        console.log('Max generation:', phase1Result.maxGeneration);
        console.log('Duration:', phase1Result.durationSeconds.toFixed(1), 'seconds');

        // Display tree structure
        console.log('\nDescendant Tree (3 generations):');
        phase1Result.descendantsFound.forEach(d => {
            const indent = '  '.repeat(d.generation);
            console.log(`${indent}Gen ${d.generation}: ${d.name} (${d.childrenCount} children)`);
        });

        // Check if we found Maria Angelica Biscoe (critical path to Nancy)
        const mariaFound = phase1Result.descendantsFound.some(d => 
            d.name.includes('Maria') && d.name.includes('Biscoe')
        );
        
        if (mariaFound) {
            console.log('\n✓ Found Maria Angelica Biscoe - path to Nancy Miller Brown exists!');
        } else {
            console.log('\n⚠️  Maria Angelica Biscoe not found in first 3 generations');
        }

        // Get stats from database
        console.log('\n--- Database Statistics ---');
        const stats = await mapper.getMappingStats(phase1Result.ownerId);
        console.log('Total in database:', stats.total_descendants);
        console.log('Generations mapped:', stats.generations_mapped);
        console.log('Average confidence:', parseFloat(stats.avg_confidence).toFixed(2));
        console.log('High confidence (≥0.85):', stats.high_confidence);
        console.log('Medium confidence (0.60-0.84):', stats.medium_confidence);
        console.log('Low confidence (<0.60):', stats.low_confidence);
        console.log('Living descendants:', stats.living_descendants);

        // Verify database storage
        console.log('\n--- Verifying Database Storage ---');
        const verifyQuery = await db.query(`
            SELECT 
                descendant_name,
                wikitree_id,
                generation_from_owner,
                relationship_path,
                birth_year,
                death_year,
                is_living,
                confidence_score
            FROM slave_owner_descendants_suspected
            WHERE owner_id = $1
            ORDER BY generation_from_owner, descendant_name
            LIMIT 10
        `, [phase1Result.ownerId]);

        console.log(`Sample records (showing first 10 of ${stats.total_descendants}):`);
        verifyQuery.rows.forEach(row => {
            console.log(`  Gen ${row.generation_from_owner}: ${row.descendant_name}`);
            console.log(`    WikiTree: ${row.wikitree_id}`);
            console.log(`    Dates: ${row.birth_year || '?'} - ${row.death_year || '?'}`);
            console.log(`    Living: ${row.is_living}, Confidence: ${row.confidence_score}`);
            console.log(`    Relationship: ${row.relationship_path}`);
        });

        // Ask user if they want to continue with full 8 generations
        console.log('\n\n========================================');
        console.log('Phase 1 Complete - 3 Generations Mapped');
        console.log('========================================');
        console.log('\n⚠️  READY FOR PHASE 2: Full 8-Generation Traversal');
        console.log('\nThis will:');
        console.log('  - Scrape ~100-200 WikiTree profiles (estimate)');
        console.log('  - Take 5-10 minutes (2 second delay between requests)');
        console.log('  - Store all descendants in database');
        console.log('  - Attempt to reach Nancy Miller Brown');
        console.log('\nTo run Phase 2, uncomment the code in this script and run again.\n');

        // PHASE 2: Full 8-generation traversal (COMMENTED OUT FOR SAFETY)
        // Uncomment this section to run full traversal
        /*
        console.log('\n\n=== PHASE 2: Full 8-Generation Traversal ===\n');
        console.log('⚠️  This will take several minutes...\n');
        
        mapper.maxDepth = 8;
        const phase2Result = await mapper.mapDescendants(
            'James Hopewell',
            'Hopewell-183',
            {
                deathYear: 1817,
                location: "St. Mary's, Maryland"
            }
        );

        console.log('\n--- Phase 2 Results ---');
        console.log('Total descendants:', phase2Result.totalDescendants);
        console.log('Max generation reached:', phase2Result.maxGeneration);
        console.log('Duration:', (phase2Result.durationSeconds / 60).toFixed(1), 'minutes');

        // Search for Nancy Miller Brown
        console.log('\n--- Searching for Nancy Miller Brown ---');
        const nancyQuery = await db.query(`
            SELECT 
                descendant_name,
                wikitree_id,
                generation_from_owner,
                birth_year,
                confidence_score
            FROM slave_owner_descendants_suspected
            WHERE owner_id = $1
              AND (
                descendant_name ILIKE '%Nancy%Miller%' OR
                descendant_name ILIKE '%Miller%Nancy%' OR
                descendant_name ILIKE '%Nancy%Brown%'
              )
            ORDER BY generation_from_owner DESC
        `, [phase2Result.ownerId]);

        if (nancyQuery.rows.length > 0) {
            console.log(`✓ Found ${nancyQuery.rows.length} potential matches:`);
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
                
                console.log('\nComplete path:');
                lineage.forEach(person => {
                    const indent = '  '.repeat(person.generation_from_owner);
                    console.log(`${indent}${person.descendant_name} (${person.birth_year || '?'}-${person.death_year || '?'})`);
                });
            }
        } else {
            console.log('⚠️  Nancy Miller Brown not found in descendant tree');
            console.log('This may mean:');
            console.log('  1. She is beyond 8 generations');
            console.log('  2. The path diverges from WikiTree data');
            console.log('  3. Names differ on WikiTree vs FamilySearch');
        }

        // Final statistics
        const finalStats = await mapper.getMappingStats(phase2Result.ownerId);
        console.log('\n--- Final Statistics ---');
        console.log('Total descendants mapped:', finalStats.total_descendants);
        console.log('Generations reached:', finalStats.generations_mapped);
        console.log('Living descendants (protected):', finalStats.living_descendants);
        console.log('High confidence lineages:', finalStats.high_confidence);
        */

        console.log('\n========================================');
        console.log('✓ Test Complete!');
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
testDescendantMapper().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
