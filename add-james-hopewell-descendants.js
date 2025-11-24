#!/usr/bin/env node
/**
 * Add James Hopewell and his descendants to the database
 *
 * INSTRUCTIONS FOR USER:
 * 1. Fill in the descendants arrays below with real names and dates
 * 2. Run: node add-james-hopewell-descendants.js
 * 3. The script will:
 *    - Add James Hopewell to the individuals table
 *    - Add all descendants with relationships
 *    - Calculate inherited debt for each descendant
 *
 * Usage: node add-james-hopewell-descendants.js
 */

const database = require('./database');

// ============================================
// EDIT THIS SECTION WITH REAL DATA
// ============================================

const jamesHopewell = {
    fullName: 'James Hopewell',
    birthYear: 1780,  // EDIT: Replace with real birth year
    deathYear: 1825,  // EDIT: Replace with real death year
    location: 'Maryland',  // EDIT: Replace with real location
    notes: 'Documented slave owner with descendants tracked for reparations debt inheritance'
};

// Total debt James Hopewell owes (will be calculated based on documents)
// If you know the amount, set it here, otherwise it will be calculated from documents table
const originalDebt = null; // Set to number like 70400000 for $70.4M, or null to auto-calculate

// GENERATION 1: Children of James Hopewell
const children = [
    {
        fullName: 'CHILD_NAME_1',  // EDIT: Replace with real name
        birthYear: 1805,  // EDIT: Replace with real birth year
        deathYear: 1870,  // EDIT: Replace with real death year or null if unknown
        gender: 'Male',  // EDIT: 'Male' or 'Female'
        notes: 'Child of James Hopewell'
    },
    {
        fullName: 'CHILD_NAME_2',
        birthYear: 1808,
        deathYear: 1875,
        gender: 'Female',
        notes: 'Child of James Hopewell'
    }
    // ADD MORE CHILDREN HERE
];

// GENERATION 2: Grandchildren of James Hopewell
// Specify which child they belong to using 'parentName'
const grandchildren = [
    {
        fullName: 'GRANDCHILD_NAME_1',  // EDIT: Replace with real name
        birthYear: 1830,
        deathYear: 1900,
        gender: 'Male',
        parentName: 'CHILD_NAME_1',  // MUST match a name from children array above
        notes: 'Grandchild of James Hopewell'
    },
    {
        fullName: 'GRANDCHILD_NAME_2',
        birthYear: 1832,
        deathYear: 1905,
        gender: 'Female',
        parentName: 'CHILD_NAME_1',
        notes: 'Grandchild of James Hopewell'
    }
    // ADD MORE GRANDCHILDREN HERE
];

// ============================================
// DO NOT EDIT BELOW THIS LINE
// ============================================

async function addJamesHopewellDescendants() {
    console.log('\n📋 Adding James Hopewell and descendants to database...\n');

    try {
        // Check if placeholders are still present
        if (children.some(c => c.fullName.includes('CHILD_NAME')) ||
            grandchildren.some(g => g.fullName.includes('GRANDCHILD_NAME'))) {
            console.error('❌ ERROR: Please replace placeholder names (CHILD_NAME_1, etc.) with real names!');
            console.error('   Edit the arrays at the top of this file first.');
            process.exit(1);
        }

        // STEP 1: Add James Hopewell to individuals table
        console.log('1️⃣  Adding James Hopewell...');

        const jamesResult = await database.query(`
            INSERT INTO individuals (
                individual_id, full_name, birth_year, death_year, notes
            ) VALUES (
                $1, $2, $3, $4, $5
            )
            ON CONFLICT (individual_id) DO UPDATE
            SET full_name = EXCLUDED.full_name,
                birth_year = EXCLUDED.birth_year,
                death_year = EXCLUDED.death_year,
                notes = EXCLUDED.notes
            RETURNING individual_id
        `, [
            'james_hopewell_' + Date.now(),
            jamesHopewell.fullName,
            jamesHopewell.birthYear,
            jamesHopewell.deathYear,
            jamesHopewell.notes
        ]);

        const jamesId = jamesResult.rows[0].individual_id;
        console.log(`   ✓ Added: ${jamesHopewell.fullName} (ID: ${jamesId})`);

        // STEP 2: Calculate or get original debt
        let debtAmount = originalDebt;
        if (!debtAmount) {
            console.log('\n2️⃣  Calculating debt from documents...');
            const debtResult = await database.query(`
                SELECT SUM(total_reparations) as total_debt
                FROM documents
                WHERE LOWER(owner_name) = LOWER($1)
            `, [jamesHopewell.fullName]);

            debtAmount = parseFloat(debtResult.rows[0]?.total_debt) || 0;
            console.log(`   ✓ Total debt: $${(debtAmount / 1000000).toFixed(2)}M`);
        }

        if (debtAmount === 0) {
            console.log('\n⚠️  WARNING: No debt found for James Hopewell.');
            console.log('   Make sure documents have been uploaded for this person.');
        }

        // STEP 3: Add children (Generation 1)
        console.log('\n3️⃣  Adding children (Generation 1)...');
        const childIds = {};

        for (const child of children) {
            const childResult = await database.query(`
                INSERT INTO individuals (
                    individual_id, full_name, birth_year, death_year, notes
                ) VALUES (
                    $1, $2, $3, $4, $5
                )
                ON CONFLICT (individual_id) DO UPDATE
                SET full_name = EXCLUDED.full_name
                RETURNING individual_id
            `, [
                `child_hopewell_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                child.fullName,
                child.birthYear,
                child.deathYear,
                child.notes
            ]);

            const childId = childResult.rows[0].individual_id;
            childIds[child.fullName] = childId;

            // Create relationship: James -> Child
            await database.query(`
                INSERT INTO relationships (
                    individual_id_1, individual_id_2, relationship_type, is_directed
                ) VALUES ($1, $2, $3, true)
                ON CONFLICT DO NOTHING
            `, [jamesId, childId, 'parent-child']);

            console.log(`   ✓ Added: ${child.fullName}`);
        }

        // STEP 4: Add grandchildren (Generation 2)
        console.log('\n4️⃣  Adding grandchildren (Generation 2)...');

        for (const grandchild of grandchildren) {
            const grandchildResult = await database.query(`
                INSERT INTO individuals (
                    individual_id, full_name, birth_year, death_year, notes
                ) VALUES (
                    $1, $2, $3, $4, $5
                )
                ON CONFLICT (individual_id) DO UPDATE
                SET full_name = EXCLUDED.full_name
                RETURNING individual_id
            `, [
                `grandchild_hopewell_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                grandchild.fullName,
                grandchild.birthYear,
                grandchild.deathYear,
                grandchild.notes
            ]);

            const grandchildId = grandchildResult.rows[0].individual_id;
            const parentId = childIds[grandchild.parentName];

            if (!parentId) {
                console.error(`   ✗ ERROR: Parent '${grandchild.parentName}' not found for ${grandchild.fullName}`);
                continue;
            }

            // Create relationship: Parent -> Grandchild
            await database.query(`
                INSERT INTO relationships (
                    individual_id_1, individual_id_2, relationship_type, is_directed
                ) VALUES ($1, $2, $3, true)
                ON CONFLICT DO NOTHING
            `, [parentId, grandchildId, 'parent-child']);

            console.log(`   ✓ Added: ${grandchild.fullName} (child of ${grandchild.parentName})`);
        }

        // STEP 5: Calculate inherited debt for all descendants
        if (debtAmount > 0) {
            console.log('\n5️⃣  Calculating inherited debt for descendants...');

            const response = await fetch('http://localhost:3000/api/calculate-descendant-debt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    perpetratorId: jamesId,
                    originalDebt: debtAmount
                })
            });

            const result = await response.json();

            if (result.success) {
                console.log(`   ✓ Debt calculated for ${result.totalDescendants} descendants`);
                console.log(`   ✓ Total distributed: $${(result.totalDistributed / 1000000).toFixed(2)}M`);
            } else {
                console.error('   ✗ Failed to calculate debt:', result.error);
            }
        }

        console.log('\n✅ DONE! James Hopewell and descendants added successfully.\n');
        console.log('Next steps:');
        console.log('  1. Visit index.html and refresh the carousel');
        console.log('  2. Click on James Hopewell card to see descendants');
        console.log('  3. Descendants will show inherited debt amounts\n');

        process.exit(0);

    } catch (error) {
        console.error('\n❌ ERROR:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run the script
addJamesHopewellDescendants();
