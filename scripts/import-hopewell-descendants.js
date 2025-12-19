/**
 * Import Additional James Hopewell Descendants
 *
 * Data extracted from FamilySearch Descendancy View (MTRV-Z72)
 * Dec 19, 2025
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

// All descendants from the descendancy view
const descendantsData = [
    // === CHEW CHILDREN (children of Maria Angelica Biscoe & Frisby Freeland Chew I) ===
    {
        fs_id: 'L5BY-3D6',
        name: 'William Lock Chew',
        birth_year: 1841,
        death_year: 1864,
        father_fs_id: 'L6K5-N4Z',
        mother_fs_id: 'L6K5-FRC',
        notes: 'Died young, possibly Civil War era'
    },
    {
        fs_id: 'L6KT-L76',
        name: 'Monroe Grayson Chew Sr.',
        birth_year: 1843,
        death_year: 1935,
        father_fs_id: 'L6K5-N4Z',
        mother_fs_id: 'L6K5-FRC'
    },
    {
        fs_id: 'L6KT-V2K',
        name: 'George Biscoe Chew',
        birth_year: 1845,
        death_year: 1923,
        father_fs_id: 'L6K5-N4Z',
        mother_fs_id: 'L6K5-FRC'
    },
    {
        fs_id: 'GVQC-9TH',
        name: 'Bowin Chew',
        birth_year: 1849,
        death_year: 1943,
        father_fs_id: 'L6K5-N4Z',
        mother_fs_id: 'L6K5-FRC'
    },
    {
        fs_id: 'L6KT-KVS',
        name: 'Fielder Bowie Chew',
        birth_year: 1849,
        death_year: 1943,
        father_fs_id: 'L6K5-N4Z',
        mother_fs_id: 'L6K5-FRC',
        notes: 'Twin with Bowin?'
    },

    // === LYMAN CHILDREN (children of Rebekah Freeland Chew & Charles Huntington Lyman) ===
    {
        fs_id: 'LXMR-FJ7',
        name: 'David Hinckley Lyman II',
        birth_year: 1877,
        death_year: 1923,
        father_fs_id: 'LWVQ-QDW',
        mother_fs_id: 'LH2D-183'
    },
    {
        fs_id: 'L5DP-DCF',
        name: 'Mary Kerr Lyman',
        birth_year: 1879,
        death_year: 1925,
        father_fs_id: 'LWVQ-QDW',
        mother_fs_id: 'LH2D-183'
    },
    {
        fs_id: 'L5JP-4PS',
        name: 'Frisby Freeland Chew Lyman',
        birth_year: 1880,
        death_year: 1934,
        father_fs_id: 'LWVQ-QDW',
        mother_fs_id: 'LH2D-183'
    },

    // === LYMAN GRANDCHILDREN ===
    {
        fs_id: 'L5DR-W1K',
        name: 'Andrew Irvine Lyman',
        birth_year: 1916,
        death_year: 1998,
        father_fs_id: 'KZJX-9K1',
        mother_fs_id: 'K4J9-8FR',
        notes: 'Sibling of Charles Huntington Lyman III'
    },
    {
        fs_id: 'G8DP-5WV',
        name: 'Marjorie Ann Lyman',
        birth_year: 1929,
        death_year: 2007,
        father_fs_id: 'KZ3H-GB2',
        mother_fs_id: 'L5JP-ZRG',
        notes: 'Sibling of Marjorie Lyman (G21Y-2S8)'
    },

    // === MILLER CONNECTION ===
    {
        fs_id: 'G8DP-VCV',
        name: 'Arthur Patterson Miller Jr',
        birth_year: 1924,
        death_year: 1993,
        notes: 'Spouse of Marjorie Ann Lyman - father of Marjorie Lyman (G21Y-2S8)'
    },

    // === BISCOE CHILDREN (children of Anne Maria Hopewell & George Washington Biscoe) ===
    {
        fs_id: 'L5BY-7V7',
        name: 'Ann Biscoe',
        birth_year: 1819,
        father_fs_id: 'KH7J-HH1',
        mother_fs_id: 'L64X-RH2'
    },
    {
        fs_id: 'L5BY-SXC',
        name: 'Araminta Thompson Biscoe',
        birth_year: 1825,
        death_year: 1825,
        father_fs_id: 'KH7J-HH1',
        mother_fs_id: 'L64X-RH2',
        notes: 'Infant death'
    },
    {
        fs_id: 'L5BT-BR5',
        name: 'Caroline Rebecca Biscoe',
        birth_year: 1832,
        death_year: 1834,
        father_fs_id: 'KH7J-HH1',
        mother_fs_id: 'L64X-RH2',
        notes: 'Childhood death'
    },
    {
        fs_id: 'L5BY-QNX',
        name: 'Clarence Biscoe',
        birth_year: 1836,
        death_year: 1836,
        father_fs_id: 'KH7J-HH1',
        mother_fs_id: 'L64X-RH2',
        notes: 'Infant death'
    },
    {
        fs_id: 'L648-LF8',
        name: 'Emma B. Biscoe',
        birth_year: 1839,
        death_year: 1895,
        father_fs_id: 'KH7J-HH1',
        mother_fs_id: 'L64X-RH2'
    },
    {
        fs_id: 'L5BY-9X5',
        name: 'Edgar Biscoe',
        birth_year: 1842,
        father_fs_id: 'KH7J-HH1',
        mother_fs_id: 'L64X-RH2'
    },

    // === HOPEWELL CHILDREN (children of James Hopewell & Angelica Chesley) ===
    {
        fs_id: 'LZNK-CBT',
        name: 'James Robert Hopewell',
        birth_year: 1813,
        death_year: 1872,
        father_fs_id: 'MTRV-Z72',
        mother_fs_id: 'MTRV-Z7T',
        notes: 'Son of James Hopewell the enslaver'
    },

    // === HOPEWELL GRANDCHILDREN (children of James Robert Hopewell) ===
    {
        fs_id: 'KCHF-WLQ',
        name: 'Maria Antoinette Culbreth',
        birth_year: 1815,
        death_year: 1873,
        notes: 'Wife of James Robert Hopewell'
    },
    {
        fs_id: 'L51W-JPD',
        name: 'Rebecca Angelica Chesley Hopewell',
        birth_year: 1838,
        death_year: 1913,
        father_fs_id: 'LZNK-CBT',
        mother_fs_id: 'KCHF-WLQ'
    },
    {
        fs_id: 'L51W-DQG',
        name: 'Olivia Caroline Hopewell',
        birth_year: 1843,
        death_year: 1920,
        father_fs_id: 'LZNK-CBT',
        mother_fs_id: 'KCHF-WLQ'
    },
    {
        fs_id: 'L51W-NLZ',
        name: 'Annie Maria Hopewell',
        birth_year: 1844,
        death_year: 1888,
        father_fs_id: 'LZNK-CBT',
        mother_fs_id: 'KCHF-WLQ'
    },
    {
        fs_id: 'L51W-6G2',
        name: 'Mary Harris Hopewell',
        birth_year: 1849,
        death_year: 1901,
        father_fs_id: 'LZNK-CBT',
        mother_fs_id: 'KCHF-WLQ'
    },
    {
        fs_id: 'L51W-V8S',
        name: 'James Hopewell Jr',
        birth_year: 1852,
        father_fs_id: 'LZNK-CBT',
        mother_fs_id: 'KCHF-WLQ'
    },
    {
        fs_id: '9J8Q-T1J',
        name: 'Antoinette Culbreth Hopewell',
        birth_year: 1855,
        death_year: 1922,
        father_fs_id: 'LZNK-CBT',
        mother_fs_id: 'KCHF-WLQ'
    },
    {
        fs_id: 'L51W-6PK',
        name: 'Thomas C Hopewell',
        birth_year: 1857,
        death_year: 1904,
        father_fs_id: 'LZNK-CBT',
        mother_fs_id: 'KCHF-WLQ'
    },

    // === UNKNOWN/EARLY DEATH ===
    {
        fs_id: 'MRLT-VFJ',
        name: 'Unknown Child Hopewell',
        birth_year: 1847,
        death_year: 1862,
        notes: 'Name unknown - early death'
    }
];

async function importDescendants() {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('   IMPORTING JAMES HOPEWELL DESCENDANTS');
    console.log('   From FamilySearch Descendancy View');
    console.log('═══════════════════════════════════════════════════════════════\n');

    let inserted = 0;
    let skipped = 0;

    for (const person of descendantsData) {
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
                    'descendant',
                    'familysearch_verified',
                    0.99,
                    'descendancy_import',
                    ${JSON.stringify({
                        familysearch_id: person.fs_id,
                        father_fs_id: person.father_fs_id || null,
                        mother_fs_id: person.mother_fs_id || null,
                        notes: person.notes || null,
                        source: 'FamilySearch Descendancy View - James Hopewell (MTRV-Z72) - Dec 19, 2025'
                    })}
                )
                ON CONFLICT DO NOTHING
                RETURNING id
            `;

            if (result.length > 0) {
                const years = person.birth_year
                    ? (person.death_year ? `${person.birth_year}-${person.death_year}` : `${person.birth_year}-`)
                    : '?';
                console.log(`  ✓ ${person.name} (${person.fs_id}) ${years}`);
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
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Total: ${descendantsData.length}`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    // Get total counts
    const counts = await sql`
        SELECT
            COUNT(*) FILTER (WHERE created_by = 'lineage_pdf_import') as lineage_count,
            COUNT(*) FILTER (WHERE created_by = 'descendancy_import') as descendants_count,
            COUNT(*) as total
        FROM canonical_persons
    `;

    console.log('DATABASE SUMMARY:');
    console.log('──────────────────────────────────────────────────────────────');
    console.log(`  Danyela's direct lineage: ${counts[0].lineage_count} persons`);
    console.log(`  Additional Hopewell descendants: ${counts[0].descendants_count} persons`);
    console.log(`  Total canonical_persons: ${counts[0].total}`);
    console.log('──────────────────────────────────────────────────────────────\n');
}

importDescendants().catch(console.error);
