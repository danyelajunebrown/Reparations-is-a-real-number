/**
 * Extract Family Relationships from context_text
 *
 * Strategy:
 * 1. Scan all records with family patterns in context_text
 * 2. Extract named relationships (e.g., "Holdsworth, son of Louisiana")
 * 3. Find or create proper unconfirmed_persons records for valid names
 * 4. Store family relationships in a new family_relationships table
 *
 * This enables promotion to canonical_persons for trackable individuals
 */

const { Pool } = require('pg');
const config = require('../config');
const pool = new Pool(config.database);

// Name validation patterns
const GARBAGE_WORDS = new Set([
    'the', 'he', 'she', 'it', 'that', 'this', 'with', 'from', 'for', 'and', 'but', 'not',
    'was', 'were', 'has', 'had', 'are', 'been', 'being', 'have', 'about', 'which', 'their',
    'mr', 'mrs', 'ms', 'dr', 'rev', 'hon', 'col', 'gen', 'capt',
    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
    'october', 'november', 'december', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug',
    'sep', 'oct', 'nov', 'dec', 'novr',
    'african', 'negro', 'colored', 'slave', 'person', 'servant', 'property', 'claim',
    'district', 'service', 'labor', 'unknown', 'unnamed', 'deceased', 'living', 'dead',
    'participant', 'researcher', 'signed', 'body', 'house', 'nurse', 'cook', 'washer',
    'ironer', 'seamstress', 'field', 'hand', 'boy', 'girl', 'man', 'woman', 'child',
    'infant', 'baby', 'mulatto', 'black', 'white', 'yellow', 'brown', 'dark', 'light',
    'stout', 'healthy', 'sound', 'smart', 'first', 'second', 'third', 'fourth', 'fifth',
    'twenty', 'thirty', 'here', 'petition', 'petitioner', 'claimant'
]);

function isValidPersonName(name) {
    if (!name || typeof name !== 'string') return false;
    const trimmed = name.trim();

    // Length check
    if (trimmed.length < 3 || trimmed.length > 40) return false;

    // Must start with capital
    if (!/^[A-Z]/.test(trimmed)) return false;

    // No all-caps (headers)
    if (trimmed === trimmed.toUpperCase() && trimmed.length > 3) return false;

    // Must have vowel
    if (!/[aeiouAEIOU]/.test(trimmed)) return false;

    // Check against garbage words
    const lowerWords = trimmed.toLowerCase().split(/\s+/);
    for (const word of lowerWords) {
        if (GARBAGE_WORDS.has(word)) return false;
    }

    // No pure numbers or dates
    if (/^\d+$/.test(trimmed)) return false;
    if (/^\d{1,2}[\/\-]\d{1,2}/.test(trimmed)) return false;

    // No trailing "was", "is", etc
    if (/\s+(was|is|were|are|had|has)$/i.test(trimmed)) return false;

    return true;
}

function cleanName(name) {
    // Remove trailing filler words and normalize whitespace
    return name
        .replace(/[\r\n]+/g, ' ')  // Replace newlines with spaces
        .replace(/\s+/g, ' ')       // Normalize whitespace
        .replace(/\s+(was|is|were|are|had|has|who|that|which|born|died).*$/i, '')
        .replace(/[,;:.]+$/, '')
        .trim();
}

// Relationship extraction patterns
const PATTERNS = [
    {
        // "Nancy, wife of Robert"
        regex: /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),?\s+wife\s+of\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
        person1Role: 'wife',
        person2Role: 'husband',
        relationType: 'spouse'
    },
    {
        // "Robert, husband of Nancy"
        regex: /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),?\s+husband\s+of\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
        person1Role: 'husband',
        person2Role: 'wife',
        relationType: 'spouse'
    },
    {
        // "James, son of Mary" or "James son of Mary"
        regex: /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),?\s+son\s+of\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
        person1Role: 'child',
        person2Role: 'parent',
        relationType: 'parent_child'
    },
    {
        // "Sarah, daughter of Mary"
        regex: /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),?\s+daughter\s+of\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
        person1Role: 'child',
        person2Role: 'parent',
        relationType: 'parent_child'
    },
    {
        // "Mary, mother of James" or "Mary mother of James"
        regex: /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),?\s+mother\s+of\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
        person1Role: 'parent',
        person2Role: 'child',
        relationType: 'parent_child'
    },
    {
        // "John, father of James"
        regex: /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),?\s+father\s+of\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
        person1Role: 'parent',
        person2Role: 'child',
        relationType: 'parent_child'
    }
];

function extractRelationshipsFromText(text) {
    const relationships = [];
    if (!text) return relationships;

    for (const pattern of PATTERNS) {
        const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
        let match;
        while ((match = regex.exec(text)) !== null) {
            const person1 = cleanName(match[1]);
            const person2 = cleanName(match[2]);

            if (isValidPersonName(person1) && isValidPersonName(person2)) {
                relationships.push({
                    person1Name: person1,
                    person1Role: pattern.person1Role,
                    person2Name: person2,
                    person2Role: pattern.person2Role,
                    relationType: pattern.relationType,
                    matchedText: match[0]
                });
            }
        }
    }

    return relationships;
}

async function ensureFamilyRelationshipsTable() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS family_relationships (
            id SERIAL PRIMARY KEY,
            person1_name VARCHAR(255) NOT NULL,
            person1_role VARCHAR(50) NOT NULL,
            person1_lead_id INTEGER,
            person2_name VARCHAR(255) NOT NULL,
            person2_role VARCHAR(50) NOT NULL,
            person2_lead_id INTEGER,
            relationship_type VARCHAR(50) NOT NULL,
            source_url TEXT,
            source_document_id VARCHAR(255),
            matched_text TEXT,
            confidence DECIMAL(3,2) DEFAULT 0.80,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(person1_name, person2_name, relationship_type, source_url)
        );

        CREATE INDEX IF NOT EXISTS idx_family_rel_person1 ON family_relationships(person1_name);
        CREATE INDEX IF NOT EXISTS idx_family_rel_person2 ON family_relationships(person2_name);
        CREATE INDEX IF NOT EXISTS idx_family_rel_type ON family_relationships(relationship_type);
    `);
    console.log('family_relationships table ready.\n');
}

async function findPersonLeadId(name, sourceUrl) {
    // Try to find an existing unconfirmed_persons record for this name
    let result;
    if (sourceUrl) {
        result = await pool.query(`
            SELECT lead_id FROM unconfirmed_persons
            WHERE full_name = $1 AND source_url = $2
            LIMIT 1
        `, [name, sourceUrl]);
    } else {
        result = await pool.query(`
            SELECT lead_id FROM unconfirmed_persons
            WHERE full_name = $1
            LIMIT 1
        `, [name]);
    }

    return result.rows.length > 0 ? result.rows[0].lead_id : null;
}

async function processRecords(dryRun = true) {
    console.log(`=== FAMILY RELATIONSHIP EXTRACTION ${dryRun ? '(DRY RUN)' : '(LIVE)'} ===\n`);

    if (!dryRun) {
        await ensureFamilyRelationshipsTable();
    }

    // Get unique documents with family patterns (dedupe by source_url)
    const documents = await pool.query(`
        SELECT DISTINCT ON (source_url)
            source_url,
            context_text,
            lead_id
        FROM unconfirmed_persons
        WHERE person_type = 'enslaved'
        AND context_text ~* '(wife|husband|mother|father|son|daughter)\\s+of\\s+[A-Z]'
        AND source_url IS NOT NULL
        ORDER BY source_url, LENGTH(context_text) DESC
    `);

    console.log(`Found ${documents.rows.length} unique documents with family patterns\n`);

    const stats = {
        documentsProcessed: 0,
        relationshipsFound: 0,
        relationshipsInserted: 0,
        uniquePeople: new Set(),
        byType: { spouse: 0, parent_child: 0 },
        duplicatesSkipped: 0,
        errors: 0
    };

    const sampleRelationships = [];

    for (const doc of documents.rows) {
        stats.documentsProcessed++;

        const extracted = extractRelationshipsFromText(doc.context_text);

        for (const rel of extracted) {
            stats.relationshipsFound++;
            stats.byType[rel.relationType]++;
            stats.uniquePeople.add(rel.person1Name);
            stats.uniquePeople.add(rel.person2Name);

            if (sampleRelationships.length < 30) {
                sampleRelationships.push({
                    ...rel,
                    sourceUrl: doc.source_url
                });
            }

            if (!dryRun) {
                try {
                    // Insert relationship without lead_ids first (simpler)
                    const insertResult = await pool.query(`
                        INSERT INTO family_relationships (
                            person1_name, person1_role,
                            person2_name, person2_role,
                            relationship_type, source_url, matched_text
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                        ON CONFLICT (person1_name, person2_name, relationship_type, source_url) DO NOTHING
                        RETURNING id
                    `, [
                        rel.person1Name, rel.person1Role,
                        rel.person2Name, rel.person2Role,
                        rel.relationType, doc.source_url, rel.matchedText
                    ]);

                    if (insertResult.rows.length > 0) {
                        stats.relationshipsInserted++;
                    } else {
                        stats.duplicatesSkipped++;
                    }
                } catch (err) {
                    console.error(`Error inserting: ${err.message}`);
                    stats.errors++;
                }
            }
        }
    }

    // Display sample relationships
    console.log('=== SAMPLE EXTRACTED RELATIONSHIPS ===\n');
    for (const rel of sampleRelationships.slice(0, 20)) {
        console.log(`${rel.person1Name} (${rel.person1Role}) ↔ ${rel.person2Name} (${rel.person2Role})`);
        console.log(`  Type: ${rel.relationType}`);
        console.log(`  Match: "${rel.matchedText}"`);
        console.log(`  Source: ${(rel.sourceUrl || '').substring(0, 60)}...`);
        console.log('');
    }

    console.log('=== STATISTICS ===\n');
    console.log(`Documents processed: ${stats.documentsProcessed}`);
    console.log(`Relationships found: ${stats.relationshipsFound}`);
    console.log(`Unique people identified: ${stats.uniquePeople.size}`);
    console.log(`\nBy relationship type:`);
    console.log(`  Spouse: ${stats.byType.spouse}`);
    console.log(`  Parent-child: ${stats.byType.parent_child}`);

    if (!dryRun) {
        console.log(`\nRelationships inserted: ${stats.relationshipsInserted}`);
        console.log(`Duplicates skipped: ${stats.duplicatesSkipped}`);
        console.log(`Errors: ${stats.errors}`);
    }

    // Show some unique people found
    console.log('\n=== SAMPLE UNIQUE PEOPLE WITH FAMILY LINKS ===\n');
    const peopleArray = Array.from(stats.uniquePeople).slice(0, 30);
    console.log(peopleArray.join(', '));

    return stats;
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = !args.includes('--execute');

    if (dryRun) {
        console.log('Running in DRY RUN mode. Use --execute to apply changes.\n');
    }

    try {
        await processRecords(dryRun);
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await pool.end();
    }
}

main();
