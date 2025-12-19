/**
 * Test the improved owner validation logic
 * Run: node scripts/test-owner-validation.js
 */

function testOwnerValidation(name, metadata = { state: 'Alabama', county: 'Montgomery' }) {
    const ocrGarbage = new Set([
        'beat', 'best', 'at', 'the', 'and', 'for', 'with', 'from', 'this',
        'male', 'female', 'black', 'mulatto', 'color', 'age', 'sex',
        'schedule', 'column', 'page', 'line', 'number', 'total', 'ditto',
        'census', 'slave', 'owner', 'district', 'county', 'state', 'township',
        'enumerated', 'marshal', 'assistant', 'image', 'document'
    ]);

    const stateNames = new Set([
        'alabama', 'arkansas', 'delaware', 'florida', 'georgia', 'kentucky',
        'louisiana', 'maryland', 'mississippi', 'missouri', 'north carolina',
        'south carolina', 'tennessee', 'texas', 'virginia', 'district of columbia'
    ]);

    const lowerOwner = name.toLowerCase();
    const ownerWords = lowerOwner.split(/\s+/);

    // Allow middle initials: first and last word must be 2+ chars, middle can be 1
    const firstLastOk = ownerWords.length >= 2 &&
        ownerWords[0].length >= 2 &&
        ownerWords[ownerWords.length - 1].length >= 2;

    const checks = {
        lengthOk: name.length >= 5,
        twoWords: ownerWords.length >= 2,
        firstLastOk: firstLastOk,
        notNumbers: !/^\d+$/.test(name),
        notGarbageFirst: !ocrGarbage.has(ownerWords[0]),
        notGarbageLast: !ocrGarbage.has(ownerWords[ownerWords.length - 1]),
        notState: !stateNames.has(lowerOwner),
        notCounty: lowerOwner !== metadata.county?.toLowerCase(),
        notStateMatch: lowerOwner !== metadata.state?.toLowerCase(),
        hasLetters: /[a-zA-Z]/.test(name)
    };

    const isValid = Object.values(checks).every(v => v);
    return { name, isValid, checks };
}

console.log('=== TESTING IMPROVED OWNER VALIDATION ===\n');

// Test cases - should PASS (valid owners)
const validOwners = [
    'Nancy C Wilson',
    'John Smith',
    'James M. Brown',
    'Mrs. Elizabeth Davis',
    'Dr. William Harris',
    'Estate of Thomas Johnson',
    'Alfred H Redus',
    'Andrew H Stanly',
    'Abner G Hammond',
    'Elizabeth A Owen'
];

// Test cases - should FAIL (garbage)
const invalidOwners = [
    'Beat',
    'Bob',
    'At Marshal',      // "At" is garbage
    'Alabama',         // State name
    'Montgomery',      // County name
    'Best M.',         // Too short
    'Image',           // Single word
    'The Call',        // "The" is garbage
    'Male Black',      // "Male" is garbage
    '123',             // Numbers
    'A',               // Too short
    'Beat Smith'       // "Beat" is garbage
];

// These SHOULD pass (valid 2-word names)
const shouldPassNames = [
    'Bella Mia',       // Valid 2-word name
    'Bob Jones'        // Valid 2-word name
];

let passed = 0;
let failed = 0;

console.log('SHOULD PASS (valid owners):');
validOwners.forEach(name => {
    const result = testOwnerValidation(name);
    if (result.isValid) {
        console.log(`  ✓ "${name}"`);
        passed++;
    } else {
        console.log(`  ✗ "${name}" - SHOULD HAVE PASSED`);
        const failedChecks = Object.entries(result.checks).filter(([k, v]) => !v).map(([k]) => k);
        console.log(`    Failed checks: ${failedChecks.join(', ')}`);
        failed++;
    }
});

console.log('\nSHOULD FAIL (garbage):');
invalidOwners.forEach(name => {
    const result = testOwnerValidation(name);
    if (!result.isValid) {
        console.log(`  ✓ "${name}" - correctly rejected`);
        passed++;
    } else {
        console.log(`  ✗ "${name}" - SHOULD HAVE FAILED`);
        failed++;
    }
});

console.log('\nADDITIONAL VALID NAMES (should pass):');
shouldPassNames.forEach(name => {
    const result = testOwnerValidation(name);
    if (result.isValid) {
        console.log(`  ✓ "${name}"`);
        passed++;
    } else {
        console.log(`  ✗ "${name}" - SHOULD HAVE PASSED`);
        const failedChecks = Object.entries(result.checks).filter(([k, v]) => !v).map(([k]) => k);
        console.log(`    Failed checks: ${failedChecks.join(', ')}`);
        failed++;
    }
});

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
