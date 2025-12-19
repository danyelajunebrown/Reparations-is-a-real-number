/**
 * Extract Family Relationships from Civil War DC Petitions
 *
 * These petitions have the richest family data with patterns like:
 * - "Nancy, wife of Robert"
 * - "Holdsworth, son of Louisiana"
 * - "Mary, mother of James"
 */

const { Pool } = require('pg');
const config = require('../config');
const pool = new Pool(config.database);

// Garbage word filter
const GARBAGE_WORDS = new Set([
    'the', 'he', 'she', 'it', 'that', 'this', 'with', 'from', 'for', 'and', 'but', 'not',
    'was', 'were', 'has', 'had', 'are', 'been', 'being', 'have', 'about', 'which', 'their',
    'mr', 'mrs', 'ms', 'dr', 'rev', 'hon', 'col', 'gen', 'capt',
    'african', 'negro', 'colored', 'slave', 'person', 'servant', 'property', 'claim',
    'district', 'service', 'labor', 'unknown', 'unnamed', 'deceased', 'living', 'dead',
    'participant', 'researcher', 'signed', 'body', 'house', 'nurse', 'cook', 'washer',
    'ironer', 'seamstress', 'field', 'hand', 'boy', 'girl', 'man', 'woman', 'child',
    'infant', 'baby', 'mulatto', 'black', 'white', 'yellow', 'brown', 'dark', 'light',
    'stout', 'healthy', 'sound', 'smart', 'first', 'second', 'third', 'fourth', 'fifth',
    'twenty', 'thirty', 'here', 'petition', 'petitioner', 'claimant', 'above', 'below',
    'said', 'named', 'aforesaid', 'following', 'mentioned', 'described', 'january',
    'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
    'october', 'november', 'december', 'year', 'born', 'died', 'years', 'old'
]);

function isValidName(name) {
    if (!name || typeof name !== 'string') return false;
    const trimmed = name.trim();
    if (trimmed.length < 3 || trimmed.length > 40) return false;
    if (!/^[A-Z]/.test(trimmed)) return false;
    if (trimmed === trimmed.toUpperCase() && trimmed.length > 3) return false;
    if (!/[aeiouAEIOU]/.test(trimmed)) return false;

    const words = trimmed.toLowerCase().split(/\s+/);
    for (const word of words) {
        if (GARBAGE_WORDS.has(word)) return false;
    }

    if (/^\d+$/.test(trimmed)) return false;
    if (/\s+(was|is|were|are|had|has)$/i.test(trimmed)) return false;

    return true;
}

function cleanName(name) {
    return name
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\s+(was|is|were|are|had|has|who|that|which|born|died|about|aged?).*$/i, '')
        .replace(/[,;:.]+$/, '')
        .trim();
}

// Relationship patterns
const PATTERNS = [
    { regex: /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),?\s+wife\s+of\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g, person1Role: 'wife', person2Role: 'husband', type: 'spouse' },
    { regex: /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),?\s+husband\s+of\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g, person1Role: 'husband', person2Role: 'wife', type: 'spouse' },
    { regex: /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),?\s+son\s+of\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g, person1Role: 'child', person2Role: 'parent', type: 'parent_child' },
    { regex: /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),?\s+daughter\s+of\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g, person1Role: 'child', person2Role: 'parent', type: 'parent_child' },
    { regex: /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),?\s+mother\s+of\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g, person1Role: 'parent', person2Role: 'child', type: 'parent_child' },
    { regex: /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),?\s+father\s+of\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g, person1Role: 'parent', person2Role: 'child', type: 'parent_child' },
    // Also match "the mother of [Name] is [Name]" pattern
    { regex: /mother\s+of\s+(?:the\s+)?(?:said\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g, person1Role: 'parent', person2Role: 'child', type: 'parent_child', useContextName: true },
];

function extractRelationships(text) {
    const relationships = [];
    if (!text) return relationships;

    for (const pattern of PATTERNS) {
        const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
        let match;
        while ((match = regex.exec(text)) !== null) {
            const person1 = cleanName(match[1]);
            const person2 = match[2] ? cleanName(match[2]) : null;

            if (person2 && isValidName(person1) && isValidName(person2)) {
                relationships.push({
                    person1: person1,
                    person1Role: pattern.person1Role,
                    person2: person2,
                    person2Role: pattern.person2Role,
                    type: pattern.type,
                    matchedText: match[0]
                });
            }
        }
    }

    return relationships;
}

async function processRecords(dryRun = true) {
    console.log(`=== CIVIL WAR DC FAMILY EXTRACTION ${dryRun ? '(DRY RUN)' : '(LIVE)'} ===\n`);

    // Get Civil War DC documents with family patterns
    const documents = await pool.query(`
        SELECT DISTINCT ON (source_url)
            source_url,
            context_text,
            lead_id
        FROM unconfirmed_persons
        WHERE source_url ILIKE '%civilwardc%'
        AND context_text ~* '(wife|husband|mother|father|son|daughter)\\s+of\\s+[A-Z]'
        AND source_url IS NOT NULL
        ORDER BY source_url, LENGTH(context_text) DESC
    `);

    console.log(`Found ${documents.rows.length} Civil War DC documents with family patterns\n`);

    const stats = {
        processed: 0,
        relationshipsFound: 0,
        relationshipsInserted: 0,
        uniquePeople: new Set(),
        byType: { spouse: 0, parent_child: 0 },
        duplicatesSkipped: 0,
        errors: 0
    };

    const samples = [];

    for (const doc of documents.rows) {
        stats.processed++;

        const extracted = extractRelationships(doc.context_text);

        for (const rel of extracted) {
            stats.relationshipsFound++;
            stats.byType[rel.type]++;
            stats.uniquePeople.add(rel.person1);
            stats.uniquePeople.add(rel.person2);

            if (samples.length < 30) {
                samples.push({ ...rel, sourceUrl: doc.source_url });
            }

            if (!dryRun) {
                try {
                    const result = await pool.query(`
                        INSERT INTO family_relationships (
                            person1_name, person1_role,
                            person2_name, person2_role,
                            relationship_type, source_url, matched_text
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                        ON CONFLICT (person1_name, person2_name, relationship_type, source_url) DO NOTHING
                        RETURNING id
                    `, [
                        rel.person1, rel.person1Role,
                        rel.person2, rel.person2Role,
                        rel.type, doc.source_url, rel.matchedText
                    ]);

                    if (result.rows.length > 0) {
                        stats.relationshipsInserted++;
                    } else {
                        stats.duplicatesSkipped++;
                    }
                } catch (err) {
                    console.error(`Error: ${err.message}`);
                    stats.errors++;
                }
            }
        }
    }

    // Display samples
    console.log('=== SAMPLE EXTRACTED RELATIONSHIPS ===\n');
    for (const rel of samples.slice(0, 20)) {
        console.log(`${rel.person1} (${rel.person1Role}) <-> ${rel.person2} (${rel.person2Role})`);
        console.log(`  Type: ${rel.type}`);
        console.log(`  Source: ${(rel.sourceUrl || '').substring(0, 70)}...`);
        console.log('');
    }

    console.log('=== STATISTICS ===\n');
    console.log(`Documents processed: ${stats.processed}`);
    console.log(`Relationships found: ${stats.relationshipsFound}`);
    console.log(`Unique people: ${stats.uniquePeople.size}`);
    console.log(`\nBy type:`);
    console.log(`  Spouse: ${stats.byType.spouse}`);
    console.log(`  Parent-child: ${stats.byType.parent_child}`);

    if (!dryRun) {
        console.log(`\nInserted: ${stats.relationshipsInserted}`);
        console.log(`Duplicates: ${stats.duplicatesSkipped}`);
        console.log(`Errors: ${stats.errors}`);
    }

    // Show unique people
    console.log('\n=== SAMPLE PEOPLE WITH FAMILY LINKS ===\n');
    console.log(Array.from(stats.uniquePeople).slice(0, 40).join(', '));

    return stats;
}

async function main() {
    const dryRun = !process.argv.includes('--execute');
    if (dryRun) console.log('DRY RUN mode. Use --execute to apply.\n');

    try {
        await processRecords(dryRun);
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await pool.end();
    }
}

main();
