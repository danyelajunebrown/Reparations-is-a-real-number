/**
 * Import Danyela Brown's Complete Lineage
 *
 * Data extracted from:
 * 1. FamilySearch Pedigree Chart (G21N-HD2) - Dec 19, 2025
 * 2. James Hopewell Descendancy View (MTRV-Z72)
 *
 * This connects Danyela Brown → James Hopewell (1780) through the Lyman line
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

// Complete lineage from James Hopewell to Danyela Brown
const lineageData = [
    // === JAMES HOPEWELL DESCENDANCY LINE ===
    // Gen -8 from Danyela (oldest ancestor)
    {
        fs_id: 'MTRV-Z72',
        name: 'James Hopewell',
        birth_year: 1780,
        notes: 'Enslaver - Earliest documented ancestor in this line',
        person_type: 'enslaver'
    },
    {
        fs_id: 'MTRV-Z7T',
        name: 'Angelica Chesley',
        birth_year: 1783,
        notes: 'Wife of James Hopewell',
        person_type: 'enslaver_family'
    },

    // Gen -7
    {
        fs_id: 'L64X-RH2',
        name: 'Anne Maria Hopewell',
        birth_year: 1799,
        death_year: 1881,
        father_fs_id: 'MTRV-Z72',
        mother_fs_id: 'MTRV-Z7T',
        person_type: 'descendant'
    },
    {
        fs_id: 'KH7J-HH1',
        name: 'George Washington Biscoe',
        birth_year: 1787,
        death_year: 1859,
        person_type: 'descendant'
    },

    // Gen -6
    {
        fs_id: 'L6K5-FRC',
        name: 'Maria Angelica Biscoe',
        birth_year: 1817,
        death_year: 1898,
        father_fs_id: 'KH7J-HH1',
        mother_fs_id: 'L64X-RH2',
        person_type: 'descendant'
    },
    {
        fs_id: 'L6K5-N4Z',
        name: 'Frisby Freeland Chew I',
        birth_year: 1808,
        death_year: 1849,
        person_type: 'descendant'
    },

    // Gen -5
    {
        fs_id: 'LH2D-183',
        name: 'Rebekah Freeland Chew',
        birth_year: 1847,
        death_year: 1917,
        father_fs_id: 'L6K5-N4Z',
        mother_fs_id: 'L6K5-FRC',
        person_type: 'descendant'
    },
    {
        fs_id: 'LWVQ-QDW',
        name: 'Charles Huntington Lyman',
        birth_year: 1849,
        death_year: 1897,
        person_type: 'descendant'
    },

    // Gen -4
    {
        fs_id: 'KZJX-9K1',
        name: 'Charles Huntington Lyman Jr',
        birth_year: 1875,
        death_year: 1945,
        father_fs_id: 'LWVQ-QDW',
        mother_fs_id: 'LH2D-183',
        person_type: 'descendant'
    },
    {
        fs_id: 'K4J9-8FR',
        name: 'Anne Blaine Irvine',
        birth_year: 1879,
        death_year: 1940,
        person_type: 'descendant'
    },

    // Gen -3 (Great-great-grandparents)
    {
        fs_id: 'KZ3H-GB2',
        name: 'Charles Huntington Lyman III',
        birth_year: 1903,
        death_year: 1972,
        birth_place: 'Philadelphia, Pennsylvania',
        death_place: 'US Naval Hospital, Bethesda, Montgomery',
        father_fs_id: 'KZJX-9K1',
        mother_fs_id: 'K4J9-8FR',
        person_type: 'descendant'
    },
    {
        fs_id: 'L5JP-ZRG',
        name: 'Marjorie Leigh Young',
        birth_year: 1904,
        death_year: 1990,
        birth_place: 'Guanajuato, Mexico',
        death_place: 'Annapolis, Anne Arundel, Maryland',
        person_type: 'descendant'
    },

    // Gen -2 (Great-grandparents)
    {
        fs_id: 'G21Y-2S8',
        name: 'Marjorie Lyman',
        birth_year: null,  // Living
        father_fs_id: 'KZ3H-GB2',
        mother_fs_id: 'L5JP-ZRG',
        notes: 'Living - Danyela\'s maternal grandmother',
        person_type: 'descendant'
    },
    {
        fs_id: 'G21Y-X4B',
        name: 'Arthur Miller',
        father_fs_id: 'G9X9-C22',
        mother_fs_id: 'LC3Q-MHP',
        person_type: 'descendant'
    },

    // === ADDITIONAL FROM PEDIGREE CHART ===
    // Paternal great-great-grandparents
    {
        fs_id: 'G21N-F4G',
        name: 'Walter Sherman Brown Sr.',
        birth_year: 1900,
        death_year: 1966,
        birth_place: 'Texas',
        death_place: 'Harrison, Texas',
        person_type: 'descendant'
    },
    {
        fs_id: 'L5G3-CDN',
        name: 'Frankie Lillian Knighten',
        birth_year: 1902,
        death_year: 1989,
        birth_place: 'Marshall, Harrison, Texas',
        death_place: 'Marshall, Harrison, Texas',
        person_type: 'descendant'
    },
    {
        fs_id: 'G21N-PD2',
        name: 'Robert Lee Hemphill',
        birth_year: 1897,
        death_year: 1972,
        birth_place: 'Carrollton, Carroll, Mississippi',
        death_place: 'Mississippi',
        person_type: 'descendant'
    },
    {
        fs_id: 'G21Y-L76',
        name: 'Georgia Mae Montgomery',
        birth_year: 1915,
        birth_place: 'Tupelo, Lee, Mississippi',
        person_type: 'descendant'
    },

    // Maternal great-grandparents (Miller side)
    {
        fs_id: 'G9X9-C22',
        name: 'Arthur Patterson Miller Sr',
        birth_year: 1896,
        death_year: 1974,
        birth_place: 'Steelton, Pennsylvania',
        death_place: 'Montgomery, Maryland',
        person_type: 'descendant'
    },
    {
        fs_id: 'LC3Q-MHP',
        name: 'Bertha Cecilia Redifer',
        birth_year: 1897,
        death_year: 1992,
        birth_place: 'Montgomery, Pennsylvania',
        person_type: 'descendant'
    },

    // Great-grandparents
    {
        fs_id: 'LR87-Q4Y',
        name: 'Billy Bob Brown Sr',
        birth_year: 1939,
        death_year: 2020,
        birth_place: 'Marshall, Harrison, Texas',
        death_place: 'Austin, Travis, Texas',
        father_fs_id: 'G21N-F4G',
        mother_fs_id: 'L5G3-CDN',
        person_type: 'descendant'
    },
    {
        fs_id: 'G21N-LGL',
        name: 'Valenda Hemphill',
        birth_year: 1941,
        birth_place: 'Greenwood, Leflore, Mississippi',
        father_fs_id: 'G21N-PD2',
        mother_fs_id: 'G21Y-L76',
        person_type: 'descendant'
    },

    // Grandparents
    {
        fs_id: 'G21N-QTN',
        name: 'Billy Bob Brown Jr.',
        birth_year: 1965,
        birth_place: 'Alexandria, Virginia',
        father_fs_id: 'LR87-Q4Y',
        mother_fs_id: 'G21N-LGL',
        notes: 'Danyela\'s father',
        person_type: 'descendant'
    },
    {
        fs_id: 'G21N-4JF',
        name: 'Nancy Miller',
        birth_year: 1962,
        birth_place: 'Alexandria, Virginia',
        father_fs_id: 'G21Y-X4B',
        mother_fs_id: 'G21Y-2S8',
        notes: 'Danyela\'s mother - CONNECTS TO JAMES HOPEWELL LINE',
        person_type: 'descendant'
    },

    // Danyela (Gen 0)
    {
        fs_id: 'G21N-HD2',
        name: 'Danyela June Brown',
        birth_year: 1996,
        birth_place: 'Alexandria, Virginia',
        father_fs_id: 'G21N-QTN',
        mother_fs_id: 'G21N-4JF',
        notes: 'Model case for genealogy system - descendant of James Hopewell (enslaver) through the Lyman line',
        person_type: 'descendant'
    }
];

async function importLineage() {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('   IMPORTING DANYELA BROWN LINEAGE');
    console.log('   James Hopewell (1780) → Danyela June Brown (1996)');
    console.log('═══════════════════════════════════════════════════════════════\n');

    let inserted = 0;
    let skipped = 0;

    for (const person of lineageData) {
        const nameParts = person.name.split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(' ');

        try {
            const result = await sql`
                INSERT INTO canonical_persons (
                    canonical_name,
                    first_name,
                    last_name,
                    birth_year_estimate,
                    death_year_estimate,
                    person_type,
                    verification_status,
                    confidence_score,
                    created_by,
                    notes
                ) VALUES (
                    ${person.name},
                    ${firstName},
                    ${lastName},
                    ${person.birth_year || null},
                    ${person.death_year || null},
                    ${person.person_type || 'descendant'},
                    'familysearch_verified',
                    0.99,
                    'lineage_pdf_import',
                    ${JSON.stringify({
                        familysearch_id: person.fs_id,
                        birth_place: person.birth_place || null,
                        death_place: person.death_place || null,
                        father_fs_id: person.father_fs_id || null,
                        mother_fs_id: person.mother_fs_id || null,
                        notes: person.notes || null,
                        source: 'FamilySearch Pedigree + Descendancy PDFs - Dec 19, 2025'
                    })}
                )
                ON CONFLICT DO NOTHING
                RETURNING id
            `;

            if (result.length > 0) {
                const typeIcon = person.person_type === 'enslaver' ? '⚠️' : '✓';
                console.log(`  ${typeIcon} ${person.name} (${person.fs_id}) - ${person.birth_year || 'Living'}`);
                inserted++;
            } else {
                console.log(`  ○ ${person.name} (already exists)`);
                skipped++;
            }
        } catch (e) {
            console.log(`  ✗ ${person.name}: ${e.message}`);
        }
    }

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(`   IMPORT COMPLETE`);
    console.log(`   Inserted: ${inserted}`);
    console.log(`   Skipped (already exist): ${skipped}`);
    console.log(`   Total in lineage: ${lineageData.length}`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    // Print the lineage path
    console.log('LINEAGE PATH (James Hopewell → Danyela Brown):');
    console.log('──────────────────────────────────────────────────────────────');
    console.log('  James Hopewell (MTRV-Z72) - 1780');
    console.log('    └─ Anne Maria Hopewell (L64X-RH2) - 1799');
    console.log('       └─ Maria Angelica Biscoe (L6K5-FRC) - 1817');
    console.log('          └─ Rebekah Freeland Chew (LH2D-183) - 1847');
    console.log('             └─ Charles Huntington Lyman Jr (KZJX-9K1) - 1875');
    console.log('                └─ Charles Huntington Lyman III (KZ3H-GB2) - 1903');
    console.log('                   └─ Marjorie Lyman (G21Y-2S8) - Living');
    console.log('                      └─ Nancy Miller (G21N-4JF) - 1962');
    console.log('                         └─ Danyela June Brown (G21N-HD2) - 1996');
    console.log('──────────────────────────────────────────────────────────────');
    console.log('\n  📍 8 generations from James Hopewell to Danyela Brown');
    console.log('  📍 Connection through the Lyman-Chew-Biscoe-Hopewell line\n');
}

importLineage().catch(console.error);
