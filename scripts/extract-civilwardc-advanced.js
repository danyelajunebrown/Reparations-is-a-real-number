/**
 * Advanced Civil War DC Family Extraction
 *
 * Strategy: Each unconfirmed_persons record has:
 * - full_name: the person of interest
 * - context_text: surrounding text that may contain family info about that person
 *
 * We extract relationships where the full_name appears in a family context
 */

const { Pool } = require('pg');
const config = require('../config');
const pool = new Pool(config.database);

// Garbage filter
const GARBAGE_WORDS = new Set([
    'the', 'said', 'aforesaid', 'above', 'mentioned', 'following', 'named',
    'your', 'petitioner', 'claimant', 'property', 'servant', 'estate',
    'district', 'county', 'state', 'city', 'washington', 'maryland', 'virginia',
    'colored', 'negro', 'african', 'person', 'persons', 'men', 'women',
    'grand', 'great', 'late', 'deceased', 'living', 'born', 'died', 'here',
    'mother', 'father', 'owner', 'service', 'labor', 'claim', 'value',
    'descent', 'desent', 'act', 'congress', 'aggregate', 'body', 'called',
    'arundel', 'calvert', 'charles', 'prince', 'george', 'montgomery'
]);

// Also filter out common false positives
const GARBAGE_PHRASES = [
    'african descent', 'african desent', 'act of congress', 'aggregate value',
    'ann arundel', 'calvert county', 'charles county', 'prince george',
    'maryland about', 'virginia about', 'louisiana was', 'maria born',
    'ellen sanders of', 'french esqr', 'prince william', 'district columbia'
];

// Words that indicate this is NOT a person name (contextual markers)
const CONTEXT_MARKERS = ['about', 'was', 'born', 'of', 'esqr', 'county', 'state'];

function isValidName(name) {
    if (!name || typeof name !== 'string') return false;
    const trimmed = name.trim();
    if (trimmed.length < 3 || trimmed.length > 40) return false;
    if (!/^[A-Z]/.test(trimmed)) return false;
    if (trimmed === trimmed.toUpperCase() && trimmed.length > 4) return false;
    if (!/[aeiouAEIOU]/.test(trimmed)) return false;

    const lower = trimmed.toLowerCase();
    if (GARBAGE_WORDS.has(lower)) return false;

    // Check words individually
    const words = lower.split(/\s+/);
    if (words.every(w => GARBAGE_WORDS.has(w))) return false;

    // Check if ends with context marker (not a person name)
    const lastWord = words[words.length - 1];
    if (CONTEXT_MARKERS.includes(lastWord)) return false;

    // Check garbage phrases
    for (const phrase of GARBAGE_PHRASES) {
        if (lower.includes(phrase)) return false;
    }

    // Names shouldn't contain certain patterns
    if (/\b(county|state|district|esq|jr|sr)\b/i.test(trimmed)) return false;

    return true;
}

function cleanName(name) {
    return name
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/^(the|said|aforesaid)\s+/i, '')
        .replace(/[,;:.]+$/, '')
        .trim();
}

function extractRelationshipsForPerson(fullName, contextText) {
    const relationships = [];
    if (!fullName || !contextText || !isValidName(fullName)) return relationships;

    const cleanFullName = cleanName(fullName);
    const text = contextText.toLowerCase();
    const namePattern = cleanFullName.toLowerCase();

    // Check if this person's mother is mentioned
    // Pattern: "her mother" or "[Name]'s mother" or "the mother of [Name]"
    if (text.includes('mother')) {
        // "her mother was purchased" - the person (fullName) has a mother mentioned
        if (text.includes('her mother') || text.includes('his mother')) {
            relationships.push({
                person1: cleanFullName,
                person1Role: 'child',
                person2: 'Mother (unnamed)',
                person2Role: 'parent',
                type: 'parent_child',
                matchedText: 'mother reference in context',
                confidence: 0.7
            });
        }

        // "the mother of [other names]" - fullName might BE the mother
        const motherOfMatch = contextText.match(/the\s+[Mm]other\s+of\s+(?:said\s+)?([A-Za-z\s,and]+?)(?:\.|,|\s+they|\s+Being)/);
        if (motherOfMatch) {
            // Check if this context is describing this person as the mother
            const fullNameInContext = contextText.toLowerCase().includes(namePattern);
            if (fullNameInContext) {
                // This person might be the mother or the child
                const childrenPart = motherOfMatch[1];
                // Extract names from "James and William" or "said men"
                if (!childrenPart.includes('men') && !childrenPart.includes('person')) {
                    const names = childrenPart.split(/\s+and\s+|,\s+/).map(n => cleanName(n.trim())).filter(isValidName);
                    for (const child of names) {
                        relationships.push({
                            person1: cleanFullName,
                            person1Role: 'parent',
                            person2: child,
                            person2Role: 'child',
                            type: 'parent_child',
                            matchedText: motherOfMatch[0],
                            confidence: 0.8
                        });
                    }
                }
            }
        }
    }

    // Check for spouse patterns
    // "wife of [Name]" in context
    const wifeMatch = contextText.match(/wife\s+of\s+(?:the\s+)?(?:said\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
    if (wifeMatch) {
        const husband = cleanName(wifeMatch[1]);
        if (isValidName(husband)) {
            // If fullName is near this mention, they might be the wife
            const namePos = contextText.toLowerCase().indexOf(namePattern);
            const wifePos = contextText.toLowerCase().indexOf('wife of');
            if (namePos >= 0 && wifePos >= 0 && Math.abs(namePos - wifePos) < 100) {
                relationships.push({
                    person1: cleanFullName,
                    person1Role: 'wife',
                    person2: husband,
                    person2Role: 'husband',
                    type: 'spouse',
                    matchedText: wifeMatch[0],
                    confidence: 0.75
                });
            }
        }
    }

    // "daughter of [Name]" or "son of [Name]"
    const childOfMatch = contextText.match(/(daughter|son)\s+of\s+(?:the\s+)?(?:said\s+)?(?:aforesaid\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
    if (childOfMatch) {
        const parent = cleanName(childOfMatch[2]);
        if (isValidName(parent)) {
            const namePos = contextText.toLowerCase().indexOf(namePattern);
            const childPos = contextText.toLowerCase().indexOf(childOfMatch[1].toLowerCase() + ' of');
            if (namePos >= 0 && childPos >= 0 && Math.abs(namePos - childPos) < 100) {
                relationships.push({
                    person1: cleanFullName,
                    person1Role: 'child',
                    person2: parent,
                    person2Role: 'parent',
                    type: 'parent_child',
                    matchedText: childOfMatch[0],
                    confidence: 0.75
                });
            }
        }
    }

    return relationships;
}

async function processRecords(dryRun = true) {
    console.log(`=== CIVIL WAR DC ADVANCED EXTRACTION ${dryRun ? '(DRY RUN)' : '(LIVE)'} ===\n`);

    // Get all Civil War DC records with family keywords
    const records = await pool.query(`
        SELECT lead_id, full_name, context_text, source_url
        FROM unconfirmed_persons
        WHERE source_url ILIKE '%civilwardc%'
        AND person_type = 'enslaved'
        AND (
            context_text ILIKE '%mother%'
            OR context_text ILIKE '%father%'
            OR context_text ILIKE '%wife%'
            OR context_text ILIKE '%husband%'
            OR context_text ILIKE '%daughter%'
            OR context_text ILIKE '%son of%'
        )
        AND LENGTH(full_name) >= 3
    `);

    console.log(`Processing ${records.rows.length} Civil War DC records with family keywords\n`);

    const stats = {
        processed: 0,
        withRelationships: 0,
        relationshipsFound: 0,
        relationshipsInserted: 0,
        uniquePeople: new Set(),
        byType: { spouse: 0, parent_child: 0 },
        duplicates: 0,
        errors: 0
    };

    const samples = [];

    for (const record of records.rows) {
        stats.processed++;

        const relationships = extractRelationshipsForPerson(record.full_name, record.context_text);

        if (relationships.length > 0) {
            stats.withRelationships++;
        }

        for (const rel of relationships) {
            // Skip unnamed relationships
            if (rel.person2.includes('unnamed')) continue;

            // Skip self-relationships
            if (rel.person1.toLowerCase() === rel.person2.toLowerCase()) continue;
            if (rel.person1.toLowerCase().includes(rel.person2.toLowerCase())) continue;
            if (rel.person2.toLowerCase().includes(rel.person1.toLowerCase())) continue;

            // Skip if person2 has garbage suffix
            if (/\s+(and|the|for|female|male)$/i.test(rel.person2)) continue;

            stats.relationshipsFound++;
            stats.byType[rel.type]++;
            stats.uniquePeople.add(rel.person1);
            stats.uniquePeople.add(rel.person2);

            if (samples.length < 50) {
                samples.push({ ...rel, sourceUrl: record.source_url, leadId: record.lead_id });
            }

            if (!dryRun) {
                try {
                    const result = await pool.query(`
                        INSERT INTO family_relationships (
                            person1_name, person1_role,
                            person2_name, person2_role,
                            relationship_type, source_url, matched_text, confidence
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                        ON CONFLICT (person1_name, person2_name, relationship_type, source_url) DO NOTHING
                        RETURNING id
                    `, [
                        rel.person1, rel.person1Role,
                        rel.person2, rel.person2Role,
                        rel.type, record.source_url, rel.matchedText, rel.confidence
                    ]);

                    if (result.rows.length > 0) {
                        stats.relationshipsInserted++;
                    } else {
                        stats.duplicates++;
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
    for (const rel of samples.slice(0, 30)) {
        console.log(`${rel.person1} (${rel.person1Role}) <-> ${rel.person2} (${rel.person2Role})`);
        console.log(`  Type: ${rel.type}, Confidence: ${rel.confidence}`);
        console.log(`  Source: ${rel.sourceUrl}`);
        console.log('');
    }

    console.log('=== STATISTICS ===\n');
    console.log(`Records processed: ${stats.processed}`);
    console.log(`Records with relationships: ${stats.withRelationships}`);
    console.log(`Relationships found: ${stats.relationshipsFound}`);
    console.log(`Unique people: ${stats.uniquePeople.size}`);
    console.log(`\nBy type:`);
    console.log(`  Spouse: ${stats.byType.spouse}`);
    console.log(`  Parent-child: ${stats.byType.parent_child}`);

    if (!dryRun) {
        console.log(`\nInserted: ${stats.relationshipsInserted}`);
        console.log(`Duplicates: ${stats.duplicates}`);
        console.log(`Errors: ${stats.errors}`);
    }

    console.log('\n=== UNIQUE PEOPLE ===\n');
    const people = Array.from(stats.uniquePeople).filter(isValidName).sort();
    console.log(people.slice(0, 60).join(', '));
    if (people.length > 60) console.log(`... and ${people.length - 60} more`);

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
