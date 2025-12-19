/**
 * Extract Owner-Enslaved Relationships from Civil War DC Petitions
 *
 * Civil War DC petitions contain slaveholders petitioning for compensation
 * for their enslaved persons. Each petition links an owner to enslaved persons.
 *
 * This script extracts those relationships for descendant tracking.
 */

const { Pool } = require('pg');
const config = require('../config');
const pool = new Pool(config.database);

// Name validation
const GARBAGE_WORDS = new Set([
    'the', 'said', 'aforesaid', 'your', 'petitioner', 'claimant', 'owner',
    'property', 'servant', 'slave', 'negro', 'colored', 'african', 'black',
    'district', 'county', 'state', 'city', 'washington', 'maryland', 'virginia',
    'congress', 'act', 'claim', 'service', 'labor', 'value', 'here', 'states',
    'healthy', 'mulatto', 'commission', 'slaves', 'petition', 'note', 'filed',
    'that', 'purchase', 'government', 'columbia', 'being', 'work', 'house',
    'good', 'clean', 'drinking', 'mount', 'pleasant', 'august', 'senr', 'jr'
]);

// Patterns that indicate non-person names
const GARBAGE_PATTERNS = [
    /^[A-Z]\.\s*$/,           // Single initial like "J. "
    /^[A-Z][a-z]+\s+[A-Z]\.\s*$/, // "William P. "
    /\bco\s*$/i,              // Ends with "Co"
    /\bmd\s*$/i,              // Ends with "Md"
    /house\s+servant/i,
    /house\s+work/i,
    /being/i,
    /filed\s+may/i,
    /note/i,
    /^\s*\n/,                 // Starts with newline
];

function isValidName(name) {
    if (!name || typeof name !== 'string') return false;
    const trimmed = name.trim();
    if (trimmed.length < 3 || trimmed.length > 50) return false;
    if (!/^[A-Z]/.test(trimmed)) return false;
    if (!/[aeiouAEIOU]/.test(trimmed)) return false;

    const lower = trimmed.toLowerCase();
    if (GARBAGE_WORDS.has(lower)) return false;

    // Check each word
    const words = lower.split(/\s+/);
    if (words.length === 1 && GARBAGE_WORDS.has(words[0])) return false;
    if (words.every(w => GARBAGE_WORDS.has(w))) return false;

    // Check patterns
    for (const pattern of GARBAGE_PATTERNS) {
        if (pattern.test(trimmed)) return false;
    }

    // Must look like a real name (at least 2 letters, first letter capital)
    if (!/^[A-Z][a-z]{2,}/.test(trimmed)) return false;

    // Reject if contains newlines
    if (/[\n\r]/.test(trimmed)) return false;

    if (/\b(county|state|district|esq|co|md|va)\b/i.test(trimmed)) return false;

    return true;
}

async function ensureRelationshipsTable() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS enslaved_owner_relationships (
            id SERIAL PRIMARY KEY,
            enslaved_person_id VARCHAR(255),
            enslaved_name VARCHAR(255) NOT NULL,
            owner_person_id INTEGER,
            owner_name VARCHAR(255) NOT NULL,
            source_url TEXT,
            source_type VARCHAR(100) DEFAULT 'civil_war_dc_petition',
            relationship_start_year INTEGER,
            relationship_end_year INTEGER,
            confidence DECIMAL(3,2) DEFAULT 0.75,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(enslaved_name, owner_name, source_url)
        );

        CREATE INDEX IF NOT EXISTS idx_eor_enslaved ON enslaved_owner_relationships(enslaved_name);
        CREATE INDEX IF NOT EXISTS idx_eor_owner ON enslaved_owner_relationships(owner_name);
    `);
    console.log('✅ enslaved_owner_relationships table ready\n');
}

async function extractOwnerEnslavedLinks(dryRun = true) {
    console.log(`=== OWNER-ENSLAVED RELATIONSHIP EXTRACTION ${dryRun ? '(DRY RUN)' : '(LIVE)'} ===\n`);

    if (!dryRun) {
        await ensureRelationshipsTable();
    }

    // Get Civil War DC petitions with both enslaved and owner records
    // Each petition URL represents one owner's claim for multiple enslaved
    const petitions = await pool.query(`
        SELECT DISTINCT source_url
        FROM unconfirmed_persons
        WHERE source_url ILIKE '%civilwardc%petitions%'
        AND source_url IS NOT NULL
    `);

    console.log(`Found ${petitions.rows.length} unique petition URLs\n`);

    const stats = {
        petitionsProcessed: 0,
        relationshipsFound: 0,
        relationshipsInserted: 0,
        uniqueOwners: new Set(),
        uniqueEnslaved: new Set(),
        duplicates: 0,
        errors: 0
    };

    const samples = [];

    for (const petition of petitions.rows) {
        stats.petitionsProcessed++;
        const url = petition.source_url;

        // Get all persons from this petition
        const persons = await pool.query(`
            SELECT full_name, person_type, context_text, confidence_score
            FROM unconfirmed_persons
            WHERE source_url = $1
            AND LENGTH(full_name) >= 3
        `, [url]);

        // Separate owners and enslaved
        const owners = persons.rows.filter(p =>
            p.person_type === 'owner' || p.person_type === 'slaveholder'
        ).filter(p => isValidName(p.full_name));

        const enslaved = persons.rows.filter(p =>
            p.person_type === 'enslaved'
        ).filter(p => isValidName(p.full_name));

        // If no explicit owners, try to extract from context
        if (owners.length === 0 && enslaved.length > 0) {
            // Check context for petitioner name
            for (const ep of enslaved) {
                const petitionerMatch = ep.context_text?.match(
                    /petitioner[,:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i
                );
                if (petitionerMatch && isValidName(petitionerMatch[1])) {
                    owners.push({
                        full_name: petitionerMatch[1].trim(),
                        person_type: 'owner',
                        context_text: ep.context_text
                    });
                    break;
                }
            }
        }

        // Create relationships between each owner and each enslaved
        for (const owner of owners) {
            stats.uniqueOwners.add(owner.full_name);

            for (const ep of enslaved) {
                stats.uniqueEnslaved.add(ep.full_name);
                stats.relationshipsFound++;

                if (samples.length < 30) {
                    samples.push({
                        enslaved: ep.full_name,
                        owner: owner.full_name,
                        sourceUrl: url
                    });
                }

                if (!dryRun) {
                    try {
                        const result = await pool.query(`
                            INSERT INTO enslaved_owner_relationships (
                                enslaved_name, owner_name, source_url
                            ) VALUES ($1, $2, $3)
                            ON CONFLICT (enslaved_name, owner_name, source_url) DO NOTHING
                            RETURNING id
                        `, [
                            ep.full_name,
                            owner.full_name,
                            url
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
    }

    // Display samples
    console.log('=== SAMPLE OWNER-ENSLAVED RELATIONSHIPS ===\n');
    for (const rel of samples.slice(0, 20)) {
        console.log(`${rel.enslaved} (enslaved) → owned by → ${rel.owner}`);
        console.log(`  Source: ${rel.sourceUrl}`);
        console.log('');
    }

    console.log('=== STATISTICS ===\n');
    console.log(`Petitions processed: ${stats.petitionsProcessed}`);
    console.log(`Relationships found: ${stats.relationshipsFound}`);
    console.log(`Unique owners: ${stats.uniqueOwners.size}`);
    console.log(`Unique enslaved: ${stats.uniqueEnslaved.size}`);

    if (!dryRun) {
        console.log(`\nInserted: ${stats.relationshipsInserted}`);
        console.log(`Duplicates: ${stats.duplicates}`);
        console.log(`Errors: ${stats.errors}`);
    }

    console.log('\n=== SAMPLE OWNERS ===');
    console.log(Array.from(stats.uniqueOwners).slice(0, 30).join(', '));

    console.log('\n=== SAMPLE ENSLAVED ===');
    console.log(Array.from(stats.uniqueEnslaved).slice(0, 30).join(', '));

    return stats;
}

async function main() {
    const dryRun = !process.argv.includes('--execute');
    if (dryRun) console.log('DRY RUN mode. Use --execute to apply.\n');

    try {
        await extractOwnerEnslavedLinks(dryRun);
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await pool.end();
    }
}

main();
