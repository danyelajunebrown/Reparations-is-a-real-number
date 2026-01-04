/**
 * Test family relationship patterns on Civil War DC records
 */

require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

// Garbage filter
const GARBAGE_NAMES = new Set([
    'the', 'said', 'petitioner', 'claimant', 'male', 'female',
    'african', 'descent', 'was', 'were', 'about', 'states', 'united',
    'colored', 'person', 'service', 'labor', 'born', 'held', 'years'
]);

function extractFamilyGroups(text) {
    const relationships = [];
    const searchPhrase = 'are the children of';
    let pos = 0;

    while ((pos = text.indexOf(searchPhrase, pos)) !== -1) {
        const beforeStart = Math.max(0, pos - 200);
        const beforeText = text.substring(beforeStart, pos);
        const afterText = text.substring(pos + searchPhrase.length, pos + searchPhrase.length + 80);

        // Extract parent name from after text
        const parentMatch = afterText.match(/^\s*(?:(?:said|the)\s+)?(?:said\s+)?([A-Z][a-z]+)\s+([A-Z][a-z]+)/);
        if (parentMatch) {
            const parentName = `${parentMatch[1]} ${parentMatch[2]}`;
            const parentLastName = parentMatch[2];

            // Find the nearest 'Said' that starts a new sentence/clause
            // Look for "Said" after a period, or at sentence boundary
            let saidIdx = beforeText.lastIndexOf('Said ');

            // Also check for period before "Said" to ensure we're not crossing sentence boundaries
            const periodBeforeSaid = beforeText.lastIndexOf('. Said ');
            if (periodBeforeSaid !== -1 && periodBeforeSaid > saidIdx - 5) {
                saidIdx = periodBeforeSaid + 2; // Skip the period and space
            }

            if (saidIdx !== -1) {
                const childrenText = beforeText.substring(saidIdx + 5);

                // Parse FirstName LastName pairs - children typically share the parent's last name
                const namePattern = /([A-Z][a-z]+)\s+([A-Z][a-z]+)/g;
                let nameMatch;
                const children = [];

                while ((nameMatch = namePattern.exec(childrenText)) !== null) {
                    const firstName = nameMatch[1];
                    const lastName = nameMatch[2];
                    const fullName = `${firstName} ${lastName}`;

                    if (GARBAGE_NAMES.has(firstName.toLowerCase())) continue;
                    if (GARBAGE_NAMES.has(lastName.toLowerCase())) continue;
                    if (fullName === parentName) continue;

                    // Prefer children with matching last name to parent
                    if (lastName === parentLastName || children.length < 10) {
                        children.push(fullName);
                    }
                }

                // Deduplicate and filter to children with matching last names when possible
                const matchingLastName = children.filter(c => c.endsWith(parentLastName));
                const childrenToUse = matchingLastName.length >= 2 ? matchingLastName : children;

                if (childrenToUse.length > 0) {
                    relationships.push({
                        parent: parentName,
                        children: [...new Set(childrenToUse)] // Deduplicate
                    });
                }
            }
        }
        pos += searchPhrase.length;
    }

    return relationships;
}

async function testPatterns() {
    console.log('Fetching text from petition 345...\n');

    const result = await sql`
        SELECT STRING_AGG(context_text, ' ') as full_text
        FROM unconfirmed_persons
        WHERE source_url ILIKE '%cww.00345%'
    `;

    const text = result[0]?.full_text || '';
    console.log('Text length:', text.length);

    // Debug: Find Bell family context
    const bellIdx = text.indexOf('Frances Bell');
    if (bellIdx > 0) {
        console.log('\n=== CONTEXT AROUND Frances Bell ===');
        console.log(text.substring(Math.max(0, bellIdx - 150), bellIdx + 120));
    }

    const relationships = extractFamilyGroups(text);

    console.log('\n=== FAMILY GROUPS EXTRACTED ===\n');
    for (const rel of relationships.slice(0, 15)) {
        console.log(`PARENT: ${rel.parent}`);
        console.log(`CHILDREN: ${rel.children.join(', ')}`);
        console.log('---');
    }
    console.log(`\nTotal family groups: ${relationships.length}`);

    // Count unique parent-child relationships
    const uniqueRels = new Set();
    for (const rel of relationships) {
        for (const child of rel.children) {
            uniqueRels.add(`${rel.parent} -> ${child}`);
        }
    }
    console.log(`Unique parent-child links: ${uniqueRels.size}`);

    // Show unique parents
    const uniqueParents = new Set(relationships.map(r => r.parent));
    console.log(`\nUnique parents: ${uniqueParents.size}`);
    console.log([...uniqueParents].join(', '));
}

testPatterns().catch(console.error);
