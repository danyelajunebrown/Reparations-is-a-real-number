/**
 * Save Honore Fredieu WikiTree descendants to database
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { neon } = require("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);

// Descendants from WikiTree scrape of Fredieu-5 (Honore Fredieu 1801-1866)
const descendants = [
    { wikitreeId: "Fredieu-4", name: "Pierre Edouard Fredieu", birthYear: 1813, deathYear: 1870, generation: 1 },
    { wikitreeId: "Vercher-27", name: "Marie Celina Fredieu Vercher", birthYear: 1848, deathYear: 1927, generation: 2 },
    { wikitreeId: "Vercher-28", name: "Virginia Marzelie Fredieu Rachal", birthYear: 1853, deathYear: 1933, generation: 2 },
    { wikitreeId: "Vercher-57", name: "Marie Olive Fredieu Vercher", birthYear: 1841, deathYear: 1927, generation: 2 },
    { wikitreeId: "Vercher-32", name: "Unknown Vercher", birthYear: 1894, deathYear: 1981, generation: 3 },
    { wikitreeId: "Vercher-72", name: "Unknown Vercher", birthYear: 1880, deathYear: 1947, generation: 3 },
    { wikitreeId: "Vercher-19", name: "Unknown Vercher", birthYear: 1883, deathYear: 1965, generation: 3 },
    { wikitreeId: "LaCour-173", name: "Unknown LaCour", birthYear: 1912, deathYear: 2008, generation: 4 },
    { wikitreeId: "LaCour-180", name: "Unknown LaCour", birthYear: 1920, deathYear: 1987, generation: 4 }
];

async function saveDescendants() {
    const ownerLeadId = "473727"; // Honore Fredieu
    const ownerName = "Honore Fredieu";

    let saved = 0;

    for (const desc of descendants) {
        try {
            // Check if exists
            const existing = await sql`
                SELECT id FROM slave_owner_descendants_suspected
                WHERE owner_individual_id = ${ownerLeadId}
                AND familysearch_person_id = ${desc.wikitreeId}
            `;

            if (existing.length > 0) {
                console.log("Already exists:", desc.wikitreeId);
                continue;
            }

            await sql`
                INSERT INTO slave_owner_descendants_suspected (
                    owner_individual_id,
                    owner_name,
                    owner_birth_year,
                    owner_death_year,
                    descendant_name,
                    descendant_birth_year,
                    descendant_death_year,
                    generation_from_owner,
                    is_living,
                    estimated_living_probability,
                    familysearch_person_id,
                    discovered_via,
                    discovery_date,
                    status,
                    confidence_score,
                    research_notes
                ) VALUES (
                    ${ownerLeadId},
                    ${ownerName},
                    1801,
                    1866,
                    ${desc.name},
                    ${desc.birthYear},
                    ${desc.deathYear},
                    ${desc.generation},
                    false,
                    0,
                    ${desc.wikitreeId},
                    'wikitree_scraping',
                    CURRENT_DATE,
                    'suspected',
                    0.85,
                    ${"WikiTree: https://www.wikitree.com/wiki/" + desc.wikitreeId}
                )
            `;
            saved++;
            console.log("Saved:", desc.name, "- Gen", desc.generation);
        } catch (err) {
            console.log("Error saving", desc.name, ":", err.message);
        }
    }

    console.log("\nSaved", saved, "descendants for Honore Fredieu");

    // Verify
    const count = await sql`
        SELECT COUNT(*) as count FROM slave_owner_descendants_suspected
        WHERE owner_individual_id = ${ownerLeadId}
    `;
    console.log("Total descendants in DB:", count[0].count);
}

saveDescendants().catch(console.error);
