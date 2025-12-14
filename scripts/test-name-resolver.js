/**
 * Test script for NameResolver service
 * Tests phonetic matching with real OCR examples from MSA Montgomery County
 */

const { Pool } = require('pg');
const NameResolver = require('../src/services/NameResolver');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function runTests() {
    console.log('=== NameResolver Test Suite ===\n');

    const resolver = new NameResolver(pool);

    // Test 1: Soundex Algorithm
    console.log('--- Test 1: Soundex Algorithm ---');
    const soundexTests = [
        // Real OCR errors from MSA document
        ['Swailes', 'Swailer'],  // OCR misread 's' as 'r'
        ['Swailes', 'Swales'],   // Missing 'i'
        ['Key', 'Frey'],         // Very different - should NOT match
        ['Plummer', 'Plumme'],   // Missing 'r'
        ['Johnson', 'Johnsen'], // 'o' vs 'e'
        ['Butler', 'Butter'],    // OCR error
        ['Owen', 'Ower'],        // OCR error
        ['Louisa', 'Louise'],    // Variant spelling
        ['Kolman', 'Holman'],    // OCR misread 'K' as 'H'
        ['Regis', 'Regen'],      // OCR error
    ];

    for (const [name1, name2] of soundexTests) {
        const s1 = resolver.soundex(name1);
        const s2 = resolver.soundex(name2);
        const match = s1 === s2 ? '✓ MATCH' : '✗ NO MATCH';
        console.log(`  ${name1} (${s1}) vs ${name2} (${s2}) → ${match}`);
    }

    // Test 2: Metaphone Algorithm
    console.log('\n--- Test 2: Metaphone Algorithm ---');
    for (const [name1, name2] of soundexTests) {
        const m1 = resolver.metaphone(name1);
        const m2 = resolver.metaphone(name2);
        const match = m1 === m2 ? '✓ MATCH' : '✗ NO MATCH';
        console.log(`  ${name1} (${m1}) vs ${name2} (${m2}) → ${match}`);
    }

    // Test 3: Levenshtein Distance
    console.log('\n--- Test 3: Levenshtein Distance ---');
    const levenshteinTests = [
        ['Sally Swailes', 'Sally Swailer'],
        ['Regis Swailes', 'Regen Swailes'],
        ['William Key', 'William Frey'],
        ['Kolman Plummer', 'Holman Plumme'],
        ['Samuel Butler', 'Samuel Buller'],
        ['Edward W. Owen', 'Edward W. Ower'],
    ];

    for (const [name1, name2] of levenshteinTests) {
        const dist = resolver.levenshtein(name1, name2);
        const similarity = (1 - dist / Math.max(name1.length, name2.length)) * 100;
        console.log(`  "${name1}" vs "${name2}" → distance: ${dist}, similarity: ${similarity.toFixed(1)}%`);
    }

    // Test 4: Name Parsing
    console.log('\n--- Test 4: Name Parsing ---');
    const parseTests = [
        'Sally Swailes',
        'Edward W. Owen',
        'William Henry Johnson',
        'Mary Johnson',
        'Richard Lincoln Jr.',
        'Dr. James Smith III',
    ];

    for (const name of parseTests) {
        const parsed = resolver.parseName(name);
        console.log(`  "${name}" → first: "${parsed.first}", middle: "${parsed.middle || '-'}", last: "${parsed.last}", suffix: "${parsed.suffix || '-'}"`);
    }

    // Test 5: Database Integration - Create Canonical Persons
    console.log('\n--- Test 5: Database Integration ---');

    try {
        // First, clean up any existing test data
        console.log('  Cleaning up previous test data...');
        await pool.query("DELETE FROM name_variants WHERE source_type = 'test'");
        await pool.query("DELETE FROM canonical_persons WHERE created_by = 'test_script'");

        // Create a canonical person (the "true" identity)
        console.log('  Creating canonical person: Sally Swailes...');
        const canonical = await resolver.createCanonicalPerson('Sally Swailes', {
            sex: 'female',
            birthYear: 1839,  // calculated from age 28 in 1867
            personType: 'enslaved',
            state: 'Maryland',
            county: 'Montgomery',
            createdBy: 'test_script'
        });
        console.log(`  ✓ Created canonical person ID: ${canonical.id}`);
        console.log(`    Soundex: first=${canonical.first_name_soundex}, last=${canonical.last_name_soundex}`);
        console.log(`    Metaphone: first=${canonical.first_name_metaphone}, last=${canonical.last_name_metaphone}`);

        // Add the OCR variant
        console.log('\n  Adding name variant: Sally Swailer (OCR error)...');
        const variant = await resolver.addNameVariant(canonical.id, 'Sally Swailer', {
            sourceType: 'test',
            sourceUrl: 'https://msa.maryland.gov/test',
            matchMethod: 'soundex'
        });
        console.log(`  ✓ Created name variant ID: ${variant.id}`);
        console.log(`    Levenshtein distance: ${variant.levenshtein_distance}`);

        // Test 6: Find Candidate Matches
        console.log('\n--- Test 6: Find Candidate Matches ---');

        // Search for "Sally Swailer" - should find our canonical "Sally Swailes"
        console.log('  Searching for candidates matching "Sally Swailer"...');
        const candidates = await resolver.findCandidateMatches('Sally Swailer', {
            state: 'Maryland',
            county: 'Montgomery'
        });

        console.log(`  Found ${candidates.length} candidate(s):`);
        for (const c of candidates) {
            console.log(`    - ${c.canonical_name} (ID: ${c.id})`);
            console.log(`      Match type: ${c.match_type}, Confidence: ${(c.confidence * 100).toFixed(1)}%`);
        }

        // Test 7: resolveOrCreate with existing match
        console.log('\n--- Test 7: resolveOrCreate ---');

        // This should match the existing canonical person
        console.log('  Resolving "Sally Swales" (another variant)...');
        const resolution1 = await resolver.resolveOrCreate('Sally Swales', {
            sex: 'female',
            state: 'Maryland',
            county: 'Montgomery',
            sourceType: 'test'
        });
        console.log(`  Action: ${resolution1.action}`);
        if (resolution1.action === 'queued_for_review') {
            console.log(`  Candidates: ${resolution1.candidates?.length || 0}`);
            if (resolution1.candidates?.length > 0) {
                console.log(`  Top candidate: ${resolution1.candidates[0].canonical_name} (ID: ${resolution1.candidates[0].id})`);
            }
        } else {
            console.log(`  Canonical ID: ${resolution1.canonicalPerson.id}`);
        }
        console.log(`  Confidence: ${(resolution1.confidence * 100).toFixed(1)}%`);

        // This should create a new canonical person (different name entirely)
        console.log('\n  Resolving "William Key" (new person)...');
        const resolution2 = await resolver.resolveOrCreate('William Key', {
            sex: 'male',
            state: 'Maryland',
            county: 'Montgomery',
            sourceType: 'test',
            createdBy: 'test_script'
        });
        console.log(`  Action: ${resolution2.action}`);
        console.log(`  Canonical ID: ${resolution2.canonicalPerson.id}`);

        // Test 8: Search Similar Names
        console.log('\n--- Test 8: Search Similar Names ---');
        console.log('  Searching for names similar to "Swailes"...');
        const similar = await resolver.searchSimilarNames('Swailes', { limit: 10 });
        console.log(`  Found ${similar.totalMatches} similar name(s):`);
        console.log(`    Canonical: ${similar.canonical.length}`);
        for (const s of similar.canonical) {
            console.log(`      - ${s.canonical_name}`);
        }
        console.log(`    Variants: ${similar.variants.length}`);
        for (const s of similar.variants) {
            console.log(`      - ${s.variant_name} -> ${s.canonical_name}`);
        }

        // Test 9: Get Stats
        console.log('\n--- Test 9: System Stats ---');
        const stats = await resolver.getStats();
        console.log(`  Canonical persons: ${stats.canonical_persons}`);
        console.log(`  Name variants: ${stats.name_variants}`);
        console.log(`  Queue items: ${stats.queue_items}`);
        console.log(`  Pending review: ${stats.pending_review}`);

        // Cleanup
        console.log('\n--- Cleanup ---');
        console.log('  Removing test data...');
        await pool.query("DELETE FROM name_variants WHERE source_type = 'test'");
        await pool.query("DELETE FROM canonical_persons WHERE created_by = 'test_script'");
        console.log('  ✓ Test data cleaned up');

    } catch (err) {
        console.error('  ✗ Database error:', err.message);
        throw err;
    }

    console.log('\n=== All Tests Complete ===\n');
}

runTests()
    .then(() => pool.end())
    .catch(err => {
        console.error('Test failed:', err);
        pool.end();
        process.exit(1);
    });
