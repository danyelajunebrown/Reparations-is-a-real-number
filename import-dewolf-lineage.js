#!/usr/bin/env node
/**
 * Import DeWolf Family Lineage
 * Handles complex nested genealogy: Children → Grandchildren
 *
 * Usage: node import-dewolf-lineage.js
 */

const database = require('./database');

// ============================================
// DEWOLF FAMILY DATA
// ============================================

const deWolfFamily = {
    parents: [
        {
            fullName: 'James DeWolf',
            birthYear: 1764,
            deathYear: 1837,
            gender: 'Male',
            role: 'enslaver', // or 'perpetrator'
            notes: 'U.S. Senator, slave trader, plantation owner'
        },
        {
            fullName: 'Nancy D\'Wolf',
            birthYear: 1769,
            deathYear: 1850,
            gender: 'Female',
            role: 'enslaver',
            familysearchId: 'LZDN-4B8',
            notes: 'Wife of James DeWolf'
        }
    ],

    children: [
        {
            fullName: 'Mary Ann DeWolf Sumner',
            birthYear: 1795,
            deathYear: 1834,
            gender: 'Female',
            notes: 'Daughter of James and Nancy DeWolf',
            grandchildren: [
                {
                    fullName: 'James DeWolf Perry',
                    birthYear: 1815,
                    deathYear: 1876,
                    gender: 'Male'
                },
                {
                    fullName: 'Nancy Bradford Perry Lay',
                    birthYear: 1819,
                    deathYear: 1883,
                    gender: 'Female'
                },
                {
                    fullName: 'Alexander Perry',
                    birthYear: 1822,
                    deathYear: 1888,
                    gender: 'Female'  // Note: Name suggests male but data says female - verify
                }
            ]
        },
        {
            fullName: 'Mark Antony "Don Marcos" D\'Wolf IV',
            birthYear: 1799,
            deathYear: 1851,
            gender: 'Male',
            notes: 'Son of James and Nancy DeWolf, known as "Don Marcos"',
            grandchildren: [
                {
                    fullName: 'Francis LeBaron D\'Wolf',
                    birthYear: 1826,
                    deathYear: 1861,
                    gender: 'Male'
                }
            ]
        },
        {
            fullName: 'William Henry "The Commodore" D\'Wolf',
            birthYear: 1802,
            deathYear: 1853,
            gender: 'Male',
            notes: 'Son of James and Nancy DeWolf, known as "The Commodore"',
            grandchildren: [
                {
                    fullName: 'Rosalie DeWolf Hopper',
                    birthYear: 1826,
                    deathYear: 1910,
                    gender: 'Female'
                }
            ]
        },
        {
            fullName: 'Nancy Bradford DeWolf Homer',
            birthYear: 1808,
            deathYear: 1856,
            gender: 'Female',
            notes: 'Daughter of James and Nancy DeWolf',
            grandchildren: []  // No grandchildren listed
        },
        {
            fullName: 'William Bradford D\'Wolf',
            birthYear: 1810,
            deathYear: 1852,
            gender: 'Male',
            notes: 'Son of James and Nancy DeWolf',
            grandchildren: [
                {
                    fullName: 'William Bradford D\'Wolf Jr',
                    birthYear: 1840,
                    deathYear: 1902,
                    gender: 'Male'
                },
                {
                    fullName: 'Mary Louisa D\'Wolf',
                    birthYear: 1845,
                    deathYear: 1903,
                    gender: 'Female'
                },
                {
                    fullName: 'Harriette Prescott D\'Wolf Aspinwall',
                    birthYear: null,  // Unknown
                    deathYear: 1888,
                    gender: 'Female'
                }
            ]
        }
    ]
};

// ============================================
// IMPORT LOGIC
// ============================================

async function importDeWolfLineage() {
    console.log('\n📋 Importing DeWolf Family Lineage...\n');

    try {
        // STEP 1: Add James and Nancy to individuals table
        console.log('1️⃣  Adding James and Nancy DeWolf...');

        const parentIds = {};

        for (const parent of deWolfFamily.parents) {
            const parentId = `dewolf_parent_${parent.fullName.replace(/[^a-zA-Z]/g, '_').toLowerCase()}_${Date.now()}`;

            await database.query(`
                INSERT INTO individuals (
                    individual_id, full_name, birth_year, death_year, gender, notes
                ) VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (individual_id) DO UPDATE
                SET full_name = EXCLUDED.full_name
                RETURNING individual_id
            `, [
                parentId,
                parent.fullName,
                parent.birthYear,
                parent.deathYear,
                parent.gender,
                parent.notes
            ]);

            parentIds[parent.fullName] = parentId;
            console.log(`   ✓ Added: ${parent.fullName} (ID: ${parentId})`);

            // Update FamilySearch ID if present
            if (parent.familysearchId) {
                await database.query(`
                    UPDATE documents
                    SET owner_familysearch_id = $1
                    WHERE LOWER(owner_name) = LOWER($2)
                `, [parent.familysearchId, parent.fullName]);
                console.log(`     ✓ FamilySearch ID: ${parent.familysearchId}`);
            }
        }

        // STEP 2: Calculate debt for James and Nancy
        console.log('\n2️⃣  Calculating original debt...');

        const debtResult = await database.query(`
            SELECT SUM(total_reparations) as total_debt
            FROM documents
            WHERE LOWER(owner_name) = LOWER($1) OR LOWER(owner_name) = LOWER($2)
        `, ['James DeWolf', 'Nancy D\'Wolf']);

        const totalDebt = parseFloat(debtResult.rows[0]?.total_debt) || 0;
        console.log(`   ✓ Total debt: $${(totalDebt / 1000000).toFixed(2)}M`);

        if (totalDebt === 0) {
            console.log('   ⚠️  WARNING: No debt found. Make sure documents are uploaded first.');
        }

        // STEP 3: Add children (Generation 1)
        console.log('\n3️⃣  Adding children (Generation 1)...');

        const childIds = {};

        for (const child of deWolfFamily.children) {
            const childId = `dewolf_child_${child.fullName.replace(/[^a-zA-Z]/g, '_').toLowerCase()}_${Date.now()}`;

            await database.query(`
                INSERT INTO individuals (
                    individual_id, full_name, birth_year, death_year, gender, notes
                ) VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (individual_id) DO UPDATE
                SET full_name = EXCLUDED.full_name
                RETURNING individual_id
            `, [
                childId,
                child.fullName,
                child.birthYear,
                child.deathYear,
                child.gender,
                child.notes
            ]);

            childIds[child.fullName] = childId;

            // Create relationship: James → Child
            await database.query(`
                INSERT INTO relationships (
                    individual_id_1, individual_id_2, relationship_type, is_directed
                ) VALUES ($1, $2, $3, true)
                ON CONFLICT DO NOTHING
            `, [parentIds['James DeWolf'], childId, 'parent-child']);

            // Create relationship: Nancy → Child
            await database.query(`
                INSERT INTO relationships (
                    individual_id_1, individual_id_2, relationship_type, is_directed
                ) VALUES ($1, $2, $3, true)
                ON CONFLICT DO NOTHING
            `, [parentIds['Nancy D\'Wolf'], childId, 'parent-child']);

            console.log(`   ✓ Added: ${child.fullName}`);
        }

        // STEP 4: Add grandchildren (Generation 2)
        console.log('\n4️⃣  Adding grandchildren (Generation 2)...');

        for (const child of deWolfFamily.children) {
            if (!child.grandchildren || child.grandchildren.length === 0) {
                continue;
            }

            const parentId = childIds[child.fullName];

            console.log(`\n   From ${child.fullName}:`);

            for (const grandchild of child.grandchildren) {
                const grandchildId = `dewolf_grandchild_${grandchild.fullName.replace(/[^a-zA-Z]/g, '_').toLowerCase()}_${Date.now()}`;

                await database.query(`
                    INSERT INTO individuals (
                        individual_id, full_name, birth_year, death_year, gender, notes
                    ) VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (individual_id) DO UPDATE
                    SET full_name = EXCLUDED.full_name
                    RETURNING individual_id
                `, [
                    grandchildId,
                    grandchild.fullName,
                    grandchild.birthYear,
                    grandchild.deathYear,
                    grandchild.gender,
                    `Grandchild of James and Nancy DeWolf, child of ${child.fullName}`
                ]);

                // Create relationship: Parent → Grandchild
                await database.query(`
                    INSERT INTO relationships (
                        individual_id_1, individual_id_2, relationship_type, is_directed
                    ) VALUES ($1, $2, $3, true)
                    ON CONFLICT DO NOTHING
                `, [parentId, grandchildId, 'parent-child']);

                console.log(`     ✓ ${grandchild.fullName} (${grandchild.birthYear || '?'}-${grandchild.deathYear || '?'})`);
            }
        }

        // STEP 5: Calculate inherited debt for all descendants
        if (totalDebt > 0) {
            console.log('\n5️⃣  Calculating inherited debt for descendants...');

            // Calculate for James's line
            const jamesResponse = await fetch('http://localhost:3000/api/calculate-descendant-debt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    perpetratorId: parentIds['James DeWolf'],
                    originalDebt: totalDebt / 2  // Split between James and Nancy
                })
            });

            const jamesResult = await jamesResponse.json();

            if (jamesResult.success) {
                console.log(`   ✓ James's line: ${jamesResult.totalDescendants} descendants`);
                console.log(`     Distributed: $${(jamesResult.totalDistributed / 1000000).toFixed(2)}M`);
            }

            // Calculate for Nancy's line
            const nancyResponse = await fetch('http://localhost:3000/api/calculate-descendant-debt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    perpetratorId: parentIds['Nancy D\'Wolf'],
                    originalDebt: totalDebt / 2  // Split between James and Nancy
                })
            });

            const nancyResult = await nancyResponse.json();

            if (nancyResult.success) {
                console.log(`   ✓ Nancy's line: ${nancyResult.totalDescendants} descendants`);
                console.log(`     Distributed: $${(nancyResult.totalDistributed / 1000000).toFixed(2)}M`);
            }
        }

        console.log('\n✅ DONE! DeWolf family lineage imported successfully.\n');
        console.log('Summary:');
        console.log(`  • Parents: 2 (James and Nancy)`);
        console.log(`  • Children: ${deWolfFamily.children.length}`);

        const totalGrandchildren = deWolfFamily.children.reduce((sum, child) =>
            sum + (child.grandchildren?.length || 0), 0);
        console.log(`  • Grandchildren: ${totalGrandchildren}`);
        console.log(`  • Total individuals: ${2 + deWolfFamily.children.length + totalGrandchildren}\n`);

        console.log('Next steps:');
        console.log('  1. Visit index.html and refresh carousel');
        console.log('  2. Click on James or Nancy to see descendants');
        console.log('  3. Descendants will show inherited debt amounts\n');

        process.exit(0);

    } catch (error) {
        console.error('\n❌ ERROR:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run the import
importDeWolfLineage();
