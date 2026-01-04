/**
 * Check Louisiana Reuters ancestors in database and WikiTree status
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { neon } = require("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);

async function check() {
    // Louisiana Reuters ancestors
    const reutersAncestors = [
        { politician: 'John Bel Edwards (LA Governor)', ancestor: 'Daniel Edwards', enslaved: 57 },
        { politician: 'John Kennedy (LA Senator)', ancestor: 'Nathan Calhoun', enslaved: 65 },
        { politician: 'Amy Coney Barrett (SCOTUS)', ancestor: 'Joel J. Coney', enslaved: 21 },
        { politician: 'Mike Johnson (Speaker)', ancestor: 'Honore Fredieu', enslaved: 14 },
        { politician: 'Bill Cassidy (LA Senator)', ancestor: 'Pebles Hasty', enslaved: 4 },
        { politician: 'Garret Graves (LA Rep)', ancestor: 'Edmond Patin', enslaved: 4 },
        { politician: 'Julia Letlow (LA Rep)', ancestor: 'William N. Barnhill', enslaved: 2 }
    ];

    console.log("=== LOUISIANA REUTERS ANCESTORS - DATABASE STATUS ===\n");

    const needWikitree = [];

    for (const r of reutersAncestors) {
        // Search for this ancestor in database
        const nameParts = r.ancestor.split(' ');
        const surname = nameParts[nameParts.length - 1];
        const pattern = '%' + r.ancestor + '%';

        const results = await sql`
            SELECT full_name, person_type, locations, context_text
            FROM unconfirmed_persons
            WHERE full_name ILIKE ${pattern}
            AND person_type = 'slaveholder'
            LIMIT 5
        `;

        // Check if we have WikiTree descendants
        const descendants = await sql`
            SELECT COUNT(*) as count FROM slave_owner_descendants_suspected
            WHERE owner_name ILIKE ${'%' + surname + '%'}
        `;

        const hasDescendants = parseInt(descendants[0].count) > 0;

        if (results.length > 0) {
            console.log(`✅ ${r.ancestor} (${r.politician})`);
            console.log(`   Enslaved: ${r.enslaved} people`);
            results.forEach(p => {
                const loc = p.locations?.[0] || 'Louisiana';
                const yearMatch = p.context_text?.match(/\((\d{4})\)/);
                const year = yearMatch ? yearMatch[1] : '?';
                console.log(`   DB Record: ${p.full_name} | ${loc} | ${year}`);
            });
            if (hasDescendants) {
                console.log(`   WikiTree: ✓ Already scraped`);
            } else {
                console.log(`   WikiTree: ✗ NEED PROFILE`);
                needWikitree.push({
                    ...r,
                    location: results[0].locations?.[0] || 'Louisiana',
                    year: results[0].context_text?.match(/\((\d{4})\)/)?.[1] || 'unknown'
                });
            }
        } else {
            console.log(`❌ ${r.ancestor} (${r.politician})`);
            console.log(`   Enslaved: ${r.enslaved} people`);
            console.log(`   NOT IN DATABASE - need FamilySearch 1850/1860 scrape`);
        }
        console.log();
    }

    if (needWikitree.length > 0) {
        console.log("\n=== WIKITREE PROFILES NEEDED ===\n");
        needWikitree.forEach(n => {
            console.log(`${n.ancestor}`);
            console.log(`   Modern descendant: ${n.politician}`);
            console.log(`   Location: ${n.location}`);
            console.log(`   Year in records: ${n.year}`);
            console.log(`   Enslaved count: ${n.enslaved}`);
            console.log();
        });
    }
}

check().catch(console.error);
