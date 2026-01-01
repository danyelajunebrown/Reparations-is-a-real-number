/**
 * Re-extract Civil War DC Petitions with Family-Aware Parsing
 *
 * The original extraction missed family relationships. This script:
 * 1. Fetches each of the 1,051 petition URLs
 * 2. Parses family groupings from narrative text
 * 3. Extracts parent-child and spouse relationships
 * 4. Updates database with proper family links
 */

require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const https = require('https');
const http = require('http');

const sql = neon(process.env.DATABASE_URL);

// Family relationship patterns
const FAMILY_PATTERNS = {
    // "Children: Louisa, Nannie, Aloysius, Joanna"
    childrenList: /Children[:\s]+([A-Z][a-z]+(?:\s*,\s*[A-Z][a-z]+)*)/gi,

    // "daughter of said Ellen Covington"
    daughterOf: /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*,?\s*(?:the\s+)?daughter\s+of\s+(?:said\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi,

    // "son of Mary Stuart"
    sonOf: /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*,?\s*(?:the\s+)?son\s+of\s+(?:said\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi,

    // "wife of Robert Bell"
    wifeOf: /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*,?\s*(?:the\s+)?wife\s+of\s+(?:said\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi,

    // "husband of Mary"
    husbandOf: /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*,?\s*(?:the\s+)?husband\s+of\s+(?:said\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi,

    // "mother of James, William, and Sarah"
    motherOf: /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*,?\s*(?:the\s+)?mother\s+of\s+(?:said\s+)?([A-Z][a-z]+(?:\s*(?:,|and)\s*[A-Z][a-z]+)*)/gi,

    // "father of" pattern
    fatherOf: /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*,?\s*(?:the\s+)?father\s+of\s+(?:said\s+)?([A-Z][a-z]+(?:\s*(?:,|and)\s*[A-Z][a-z]+)*)/gi,

    // "Parent and children" pattern like "Margery Sims... Children: William, Clement"
    parentChildren: /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)[^.]*?(?:her|his)\s+(?:following\s+)?children[:\s]+([A-Z][a-z]+(?:\s*,\s*[A-Z][a-z]+)*)/gi,

    // Sibling pattern "brother/sister of"
    siblingOf: /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*,?\s*(?:the\s+)?(?:brother|sister)\s+of\s+(?:said\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi,
};

// Garbage names to filter out (words that appear in context but aren't person names)
const GARBAGE_NAMES = new Set([
    'the', 'said', 'above', 'named', 'following', 'mentioned', 'described',
    'petitioner', 'claimant', 'commissioner', 'witness', 'district', 'columbia',
    'washington', 'county', 'city', 'note', 'here', 'form', 'oath', 'petition',
    'children', 'child', 'slave', 'negro', 'colored', 'mulatto', 'black',
    'unknown', 'unnamed', 'deceased', 'property', 'service', 'claim',
    'male', 'female', 'was', 'were', 'are', 'and', 'his', 'her', 'born',
    'right', 'african', 'descent', 'states', 'united', 'america',
    'per', 'person', 'persons', 'about', 'maryland', 'virginia', 'kentucky',
    'aged', 'old', 'months', 'years', 'man', 'woman', 'boy', 'girl', 'infant',
    'fou', 'dark', 'light', 'bright', 'sound', 'valued', 'worth', 'dollars',
    // Single letters or fragments
    'is', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'as', 'he', 'she'
]);

function isValidName(name) {
    if (!name || typeof name !== 'string') return false;
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 50) return false;
    if (!/^[A-Z]/.test(trimmed)) return false;
    if (GARBAGE_NAMES.has(trimmed.toLowerCase())) return false;
    if (/^\d+$/.test(trimmed)) return false;
    return true;
}

function cleanName(name) {
    return name
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/^(said|the|named)\s+/i, '')
        .replace(/\s+(the|elder|younger|jr|sr|junior|senior)\.?$/i, ' $1')
        .replace(/[,;:.]+$/, '')
        .trim();
}

function parseChildrenList(text) {
    // Split "William, Clement, Sally, and Henrietta" into array
    return text
        .split(/\s*(?:,|and)\s*/i)
        .map(n => cleanName(n))
        .filter(n => isValidName(n));
}

async function fetchPetition(url) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;

        const req = protocol.get(url, { timeout: 30000 }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchPetition(res.headers.location).then(resolve).catch(reject);
            }

            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

function extractFamilyRelationships(text, sourceUrl) {
    // Clean up text if it looks like HTML
    if (text.includes('<') && text.includes('>')) {
        text = text
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&');
    }
    text = text.replace(/\s+/g, ' ');

    const relationships = [];

    // Method 1: Find "are the children of" and look backwards for children list
    // Pattern: "Said FirstName LastName[; ,] FirstName LastName... are the children of [said/the said] ParentName"
    const searchPhrase = 'are the children of';
    let pos = 0;
    while ((pos = text.indexOf(searchPhrase, pos)) !== -1) {
        const beforeStart = Math.max(0, pos - 200);
        const beforeText = text.substring(beforeStart, pos);
        const afterText = text.substring(pos + searchPhrase.length, pos + searchPhrase.length + 80);

        // Extract parent name from after text
        // Pattern: "are the children of [said|the|the said] FirstName LastName"
        const parentMatch = afterText.match(/^\s*(?:(?:said|the)\s+)?(?:said\s+)?([A-Z][a-z]+)\s+([A-Z][a-z]+)/);
        if (parentMatch) {
            const parentName = `${parentMatch[1]} ${parentMatch[2]}`;
            const parentLastName = parentMatch[2];

            // Find the nearest 'Said' that starts a new sentence/clause
            let saidIdx = beforeText.lastIndexOf('Said ');
            const periodBeforeSaid = beforeText.lastIndexOf('. Said ');
            if (periodBeforeSaid !== -1 && periodBeforeSaid > saidIdx - 5) {
                saidIdx = periodBeforeSaid + 2;
            }

            if (saidIdx !== -1) {
                const childrenText = beforeText.substring(saidIdx + 5);

                // Parse "FirstName LastName" pairs
                const namePattern = /([A-Z][a-z]+)\s+([A-Z][a-z]+)/g;
                let nameMatch;
                const children = [];

                while ((nameMatch = namePattern.exec(childrenText)) !== null) {
                    const firstName = nameMatch[1];
                    const lastName = nameMatch[2];
                    const fullName = `${firstName} ${lastName}`;

                    // Skip garbage names
                    if (GARBAGE_NAMES.has(firstName.toLowerCase())) continue;
                    if (GARBAGE_NAMES.has(lastName.toLowerCase())) continue;
                    if (fullName === parentName) continue;

                    children.push(fullName);
                }

                // Prefer children with matching last name to parent
                const matchingLastName = children.filter(c => c.endsWith(parentLastName));
                const childrenToUse = matchingLastName.length >= 2 ? matchingLastName : children;
                const uniqueChildren = [...new Set(childrenToUse)];

                // Add relationships for valid children
                for (const child of uniqueChildren) {
                    relationships.push({
                        type: 'parent_child',
                        parent: parentName,
                        child: child,
                        matchedText: `${child} → ${parentName} (children of)`
                    });
                }
            }
        }
        pos += searchPhrase.length;
    }

    // Method 2: Extract "daughter of" / "son of" patterns
    // Use stricter patterns requiring "FirstName LastName daughter/son of FirstName LastName"
    let match;

    // "FirstName LastName daughter of [said] FirstName LastName"
    const daughterRegex = /([A-Z][a-z]+)\s+([A-Z][a-z]+)\s+daughter\s+of\s+(?:said\s+)?([A-Z][a-z]+)\s+([A-Z][a-z]+)/gi;
    while ((match = daughterRegex.exec(text)) !== null) {
        const childFirst = match[1];
        const childLast = match[2];
        const parentFirst = match[3];
        const parentLast = match[4];

        // Skip garbage words
        if (GARBAGE_NAMES.has(childFirst.toLowerCase())) continue;
        if (GARBAGE_NAMES.has(childLast.toLowerCase())) continue;
        if (GARBAGE_NAMES.has(parentFirst.toLowerCase())) continue;
        if (GARBAGE_NAMES.has(parentLast.toLowerCase())) continue;

        relationships.push({
            type: 'parent_child',
            parent: `${parentFirst} ${parentLast}`,
            child: `${childFirst} ${childLast}`,
            matchedText: match[0].substring(0, 100)
        });
    }

    // "FirstName LastName son of [said] FirstName LastName"
    const sonRegex = /([A-Z][a-z]+)\s+([A-Z][a-z]+)\s+son\s+of\s+(?:said\s+)?([A-Z][a-z]+)\s+([A-Z][a-z]+)/gi;
    while ((match = sonRegex.exec(text)) !== null) {
        const childFirst = match[1];
        const childLast = match[2];
        const parentFirst = match[3];
        const parentLast = match[4];

        // Skip garbage words
        if (GARBAGE_NAMES.has(childFirst.toLowerCase())) continue;
        if (GARBAGE_NAMES.has(childLast.toLowerCase())) continue;
        if (GARBAGE_NAMES.has(parentFirst.toLowerCase())) continue;
        if (GARBAGE_NAMES.has(parentLast.toLowerCase())) continue;

        relationships.push({
            type: 'parent_child',
            parent: `${parentFirst} ${parentLast}`,
            child: `${childFirst} ${childLast}`,
            matchedText: match[0].substring(0, 100)
        });
    }

    // Method 3: Extract "mother of" / "father of" patterns
    // Stricter: require "FirstName LastName mother of FirstName LastName"
    const motherRegex = /([A-Z][a-z]+)\s+([A-Z][a-z]+)\s+mother\s+of\s+(?:said\s+)?([A-Z][a-z]+)\s+([A-Z][a-z]+)/gi;
    while ((match = motherRegex.exec(text)) !== null) {
        const parentFirst = match[1];
        const parentLast = match[2];
        const childFirst = match[3];
        const childLast = match[4];

        if (GARBAGE_NAMES.has(parentFirst.toLowerCase())) continue;
        if (GARBAGE_NAMES.has(parentLast.toLowerCase())) continue;
        if (GARBAGE_NAMES.has(childFirst.toLowerCase())) continue;
        if (GARBAGE_NAMES.has(childLast.toLowerCase())) continue;

        relationships.push({
            type: 'parent_child',
            parent: `${parentFirst} ${parentLast}`,
            child: `${childFirst} ${childLast}`,
            matchedText: match[0].substring(0, 100)
        });
    }

    const fatherRegex = /([A-Z][a-z]+)\s+([A-Z][a-z]+)\s+father\s+of\s+(?:said\s+)?([A-Z][a-z]+)\s+([A-Z][a-z]+)/gi;
    while ((match = fatherRegex.exec(text)) !== null) {
        const parentFirst = match[1];
        const parentLast = match[2];
        const childFirst = match[3];
        const childLast = match[4];

        if (GARBAGE_NAMES.has(parentFirst.toLowerCase())) continue;
        if (GARBAGE_NAMES.has(parentLast.toLowerCase())) continue;
        if (GARBAGE_NAMES.has(childFirst.toLowerCase())) continue;
        if (GARBAGE_NAMES.has(childLast.toLowerCase())) continue;

        relationships.push({
            type: 'parent_child',
            parent: `${parentFirst} ${parentLast}`,
            child: `${childFirst} ${childLast}`,
            matchedText: match[0].substring(0, 100)
        });
    }

    // Method 4: Extract "wife of" / "husband of" patterns
    // Stricter: require "FirstName LastName wife of [said] FirstName LastName"
    const wifeRegex = /([A-Z][a-z]+)\s+([A-Z][a-z]+)\s+wife\s+of\s+(?:said\s+)?([A-Z][a-z]+)\s+([A-Z][a-z]+)/gi;
    while ((match = wifeRegex.exec(text)) !== null) {
        const wifeFirst = match[1];
        const wifeLast = match[2];
        const husbandFirst = match[3];
        const husbandLast = match[4];

        if (GARBAGE_NAMES.has(wifeFirst.toLowerCase())) continue;
        if (GARBAGE_NAMES.has(wifeLast.toLowerCase())) continue;
        if (GARBAGE_NAMES.has(husbandFirst.toLowerCase())) continue;
        if (GARBAGE_NAMES.has(husbandLast.toLowerCase())) continue;

        relationships.push({
            type: 'spouse',
            person1: `${wifeFirst} ${wifeLast}`,
            person2: `${husbandFirst} ${husbandLast}`,
            matchedText: match[0].substring(0, 100)
        });
    }

    const husbandRegex = /([A-Z][a-z]+)\s+([A-Z][a-z]+)\s+husband\s+of\s+(?:said\s+)?([A-Z][a-z]+)\s+([A-Z][a-z]+)/gi;
    while ((match = husbandRegex.exec(text)) !== null) {
        const husbandFirst = match[1];
        const husbandLast = match[2];
        const wifeFirst = match[3];
        const wifeLast = match[4];

        if (GARBAGE_NAMES.has(husbandFirst.toLowerCase())) continue;
        if (GARBAGE_NAMES.has(husbandLast.toLowerCase())) continue;
        if (GARBAGE_NAMES.has(wifeFirst.toLowerCase())) continue;
        if (GARBAGE_NAMES.has(wifeLast.toLowerCase())) continue;

        relationships.push({
            type: 'spouse',
            person1: `${husbandFirst} ${husbandLast}`,
            person2: `${wifeFirst} ${wifeLast}`,
            matchedText: match[0].substring(0, 100)
        });
    }

    // Method 5: Extract sibling relationships
    // Stricter: require "FirstName LastName brother/sister of [said] FirstName LastName"
    const siblingRegex = /([A-Z][a-z]+)\s+([A-Z][a-z]+)\s+(?:brother|sister)\s+of\s+(?:said\s+)?([A-Z][a-z]+)\s+([A-Z][a-z]+)/gi;
    while ((match = siblingRegex.exec(text)) !== null) {
        const sib1First = match[1];
        const sib1Last = match[2];
        const sib2First = match[3];
        const sib2Last = match[4];

        if (GARBAGE_NAMES.has(sib1First.toLowerCase())) continue;
        if (GARBAGE_NAMES.has(sib1Last.toLowerCase())) continue;
        if (GARBAGE_NAMES.has(sib2First.toLowerCase())) continue;
        if (GARBAGE_NAMES.has(sib2Last.toLowerCase())) continue;

        relationships.push({
            type: 'sibling',
            person1: `${sib1First} ${sib1Last}`,
            person2: `${sib2First} ${sib2Last}`,
            matchedText: match[0].substring(0, 100)
        });
    }

    return relationships;
}

async function findOrCreatePerson(name, sourceUrl) {
    // Try to find existing person from this source
    const existing = await sql`
        SELECT lead_id, full_name
        FROM unconfirmed_persons
        WHERE full_name ILIKE ${name}
        AND source_url = ${sourceUrl}
        LIMIT 1
    `;

    if (existing.length > 0) {
        return existing[0].lead_id;
    }

    // Try to find by name in Civil War DC records
    const byName = await sql`
        SELECT lead_id, full_name
        FROM unconfirmed_persons
        WHERE full_name ILIKE ${name}
        AND source_url ILIKE '%civilwardc%'
        LIMIT 1
    `;

    if (byName.length > 0) {
        return byName[0].lead_id;
    }

    return null;
}

async function updateFamilyLinks(relationships, sourceUrl, dryRun = true) {
    const stats = {
        parentChildLinks: 0,
        spouseLinks: 0,
        siblingLinks: 0,
        personsNotFound: 0,
        errors: 0
    };

    for (const rel of relationships) {
        try {
            if (rel.type === 'parent_child') {
                const parentId = await findOrCreatePerson(rel.parent, sourceUrl);
                const childId = await findOrCreatePerson(rel.child, sourceUrl);

                if (!parentId || !childId) {
                    stats.personsNotFound++;
                    continue;
                }

                if (!dryRun) {
                    // Update child's relationships to include parent
                    const parentData = JSON.stringify({ parent_name: rel.parent, parent_id: parentId });
                    await sql`
                        UPDATE unconfirmed_persons
                        SET relationships = COALESCE(relationships, '{}'::jsonb) || ${parentData}::jsonb
                        WHERE lead_id = ${childId}
                    `;

                    // Update parent's relationships to include child
                    // First get existing children, then append
                    const existing = await sql`
                        SELECT relationships->'children' as children
                        FROM unconfirmed_persons
                        WHERE lead_id = ${parentId}
                    `;
                    const currentChildren = existing[0]?.children || [];
                    const newChildren = [...new Set([...currentChildren, rel.child])];
                    const childData = JSON.stringify({ children: newChildren });
                    await sql`
                        UPDATE unconfirmed_persons
                        SET relationships = COALESCE(relationships, '{}'::jsonb) || ${childData}::jsonb
                        WHERE lead_id = ${parentId}
                    `;
                }
                stats.parentChildLinks++;

            } else if (rel.type === 'spouse') {
                const person1Id = await findOrCreatePerson(rel.person1, sourceUrl);
                const person2Id = await findOrCreatePerson(rel.person2, sourceUrl);

                if (!person1Id || !person2Id) {
                    stats.personsNotFound++;
                    continue;
                }

                if (!dryRun) {
                    const spouse1Data = JSON.stringify({ spouse_name: rel.person2, spouse_id: person2Id });
                    await sql`
                        UPDATE unconfirmed_persons
                        SET relationships = COALESCE(relationships, '{}'::jsonb) || ${spouse1Data}::jsonb
                        WHERE lead_id = ${person1Id}
                    `;

                    const spouse2Data = JSON.stringify({ spouse_name: rel.person1, spouse_id: person1Id });
                    await sql`
                        UPDATE unconfirmed_persons
                        SET relationships = COALESCE(relationships, '{}'::jsonb) || ${spouse2Data}::jsonb
                        WHERE lead_id = ${person2Id}
                    `;
                }
                stats.spouseLinks++;

            } else if (rel.type === 'sibling') {
                stats.siblingLinks++;
            }
        } catch (err) {
            console.error(`  Error processing relationship: ${err.message}`);
            stats.errors++;
        }
    }

    return stats;
}

async function processPetitions(dryRun = true, limit = null) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`CIVIL WAR DC FAMILY RE-EXTRACTION ${dryRun ? '(DRY RUN)' : '(LIVE)'}`);
    console.log(`${'='.repeat(60)}\n`);

    // Get aggregated text per petition from database (no web fetching needed)
    const petitions = await sql`
        SELECT
            source_url,
            STRING_AGG(context_text, ' ') as full_text,
            COUNT(*) as person_count
        FROM unconfirmed_persons
        WHERE source_url ILIKE '%civilwardc%'
        AND source_url IS NOT NULL
        AND context_text IS NOT NULL
        GROUP BY source_url
        ORDER BY source_url
        ${limit ? sql`LIMIT ${limit}` : sql``}
    `;

    console.log(`Found ${petitions.length} petitions with text to process\n`);

    const totalStats = {
        processed: 0,
        relationshipsFound: 0,
        parentChildLinks: 0,
        spouseLinks: 0,
        siblingLinks: 0,
        personsNotFound: 0,
        errors: 0
    };

    const sampleRelationships = [];

    for (let i = 0; i < petitions.length; i++) {
        const { source_url: url, full_text: text, person_count } = petitions[i];
        totalStats.processed++;

        if (i % 50 === 0) {
            console.log(`Processing ${i + 1}/${petitions.length}: ${url.substring(0, 60)}... (${person_count} persons)`);
        }

        try {
            const relationships = extractFamilyRelationships(text, url);

            totalStats.relationshipsFound += relationships.length;

            // Save sample relationships for display
            if (sampleRelationships.length < 30) {
                for (const rel of relationships.slice(0, 5)) {
                    sampleRelationships.push({ ...rel, sourceUrl: url });
                }
            }

            // Update database
            const stats = await updateFamilyLinks(relationships, url, dryRun);
            totalStats.parentChildLinks += stats.parentChildLinks;
            totalStats.spouseLinks += stats.spouseLinks;
            totalStats.siblingLinks += stats.siblingLinks;
            totalStats.personsNotFound += stats.personsNotFound;
            totalStats.errors += stats.errors;

        } catch (err) {
            console.error(`  Error for ${url}: ${err.message}`);
            totalStats.errors++;
        }
    }

    // Display sample relationships
    console.log(`\n${'='.repeat(60)}`);
    console.log('SAMPLE EXTRACTED RELATIONSHIPS');
    console.log(`${'='.repeat(60)}\n`);

    for (const rel of sampleRelationships.slice(0, 20)) {
        if (rel.type === 'parent_child') {
            console.log(`${rel.parent} → ${rel.child} (parent-child)`);
        } else if (rel.type === 'spouse') {
            console.log(`${rel.person1} ↔ ${rel.person2} (spouse)`);
        } else if (rel.type === 'sibling') {
            console.log(`${rel.person1} ↔ ${rel.person2} (sibling)`);
        }
        console.log(`  Source: ${rel.sourceUrl?.substring(30, 70)}...`);
        console.log(`  Match: "${rel.matchedText?.substring(0, 60)}..."`);
        console.log('');
    }

    // Final statistics
    console.log(`\n${'='.repeat(60)}`);
    console.log('STATISTICS');
    console.log(`${'='.repeat(60)}\n`);
    console.log(`Petitions processed: ${totalStats.processed}`);
    console.log(`Total relationships found: ${totalStats.relationshipsFound}`);
    console.log(`  Parent-child links: ${totalStats.parentChildLinks}`);
    console.log(`  Spouse links: ${totalStats.spouseLinks}`);
    console.log(`  Sibling links: ${totalStats.siblingLinks}`);
    console.log(`Persons not found in DB: ${totalStats.personsNotFound}`);
    console.log(`Errors: ${totalStats.errors}`);

    if (dryRun) {
        console.log(`\n⚠️  DRY RUN - no changes made. Use --execute to apply.`);
    } else {
        console.log(`\n✅ Changes applied to database.`);
    }

    return totalStats;
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = !args.includes('--execute');
    const limitArg = args.find(a => a.startsWith('--limit='));
    const limit = limitArg ? parseInt(limitArg.split('=')[1]) : null;

    if (dryRun) {
        console.log('DRY RUN mode. Use --execute to apply changes.');
    }
    if (limit) {
        console.log(`Limiting to ${limit} petitions.`);
    }

    try {
        await processPetitions(dryRun, limit);
    } catch (err) {
        console.error('Fatal error:', err);
    }
}

main();
