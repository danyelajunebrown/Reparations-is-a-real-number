#!/usr/bin/env node
/**
 * Fix Civil War DC Emancipation Petition Data
 *
 * Issues to fix:
 * 1. Birth years - extract from context_text ages, calculate from petition date
 * 2. Locations - set to "Washington, D.C." for all
 * 3. Relationships - parse family relationships from context
 * 4. Owner links - link enslaved people to owners from same petition
 *
 * Usage:
 *   node scripts/fix-civilwardc-data.js --test          # Test on one petition (dry run)
 *   node scripts/fix-civilwardc-data.js --test --apply  # Test on one petition AND apply
 *   node scripts/fix-civilwardc-data.js --dry-run      # Show what would change for all
 *   node scripts/fix-civilwardc-data.js --run          # Actually update all petitions
 */

const { query } = require('../src/database/connection');

// Petition date extraction from URL or default to 1862
function getPetitionYear(sourceUrl) {
    // Most DC Emancipation petitions are from 1862
    // The act was passed April 16, 1862
    return 1862;
}

// Parse table format: "From table: Name, Age, Sex, Color"
function parseTableFormat(contextText) {
    if (!contextText || !contextText.startsWith('From table:')) return null;

    const content = contextText.replace('From table:', '').trim();
    const parts = content.split(',').map(p => p.trim());

    if (parts.length < 2) return null;

    const result = {
        rawName: parts[0],
        age: null,
        ageUnit: 'years',
        sex: null,
        color: null,
        relationship: null
    };

    // Parse age (could be "51", "30", "15.1 mo", "18 months", "6", "3", or just a number)
    // Also handle "Do" (ditto) entries
    if (parts[1] && parts[1].toLowerCase() !== 'do') {
        // Try matching number with optional months indicator
        const ageMatch = parts[1].match(/(\d+(?:\.\d+)?)\s*(mo(?:nths?)?)?/i);
        if (ageMatch) {
            result.age = parseFloat(ageMatch[1]);
            if (ageMatch[2] || parts[1].toLowerCase().includes('month')) {
                result.ageUnit = 'months';
            }
        }
    }

    // Special handling for Albert/Laura type entries where age might be in different position
    // "Albert (Do , Do, 18 months" -> check all parts for age
    if (result.age === null) {
        for (const part of parts.slice(1)) {
            if (part.toLowerCase() === 'do') continue;
            const ageMatch = part.match(/^(\d+(?:\.\d+)?)\s*(mo(?:nths?)?)?$/i);
            if (ageMatch) {
                result.age = parseFloat(ageMatch[1]);
                if (ageMatch[2] || part.toLowerCase().includes('month')) {
                    result.ageUnit = 'months';
                }
                break;
            }
        }
    }

    // Parse sex
    if (parts[2]) {
        result.sex = parts[2].toLowerCase().includes('female') ? 'female' : 'male';
    }

    // Parse color
    if (parts[3]) {
        result.color = parts[3];
    }

    // Parse relationship from name like "James (son of Selina" or "Lydia (daughter Do."
    const relMatch = result.rawName.match(/\((son|daughter)\s+(?:of\s+)?(\w+)?/i);
    if (relMatch) {
        result.relationship = {
            type: relMatch[1].toLowerCase() === 'son' ? 'child_of' : 'child_of',
            relatedTo: relMatch[2] || null
        };
    }

    // Clean up name - extract first name
    const nameMatch = result.rawName.match(/^([A-Z][a-z]+)/);
    if (nameMatch) {
        result.firstName = nameMatch[1];
    }

    return result;
}

// Extract age from context text
function extractAge(contextText, personName) {
    if (!contextText) return null;

    // First check if this is table format
    const tableData = parseTableFormat(contextText);
    if (tableData && tableData.age !== null) {
        if (tableData.ageUnit === 'months') {
            return { age: tableData.age / 12, unit: 'months', raw: tableData.age };
        }
        return { age: tableData.age, unit: 'years', raw: tableData.age };
    }

    const nameParts = personName.split(' ');
    const firstName = nameParts[0];
    const lastName = nameParts[nameParts.length - 1];

    // Patterns to match age near the person's name
    const patterns = [
        // "Jane Coney aged about 37 years"
        new RegExp(`${firstName}[^.]*?aged\\s+(?:about\\s+)?(\\d+)\\s*years?`, 'i'),
        // "Walter Butler, Grace's son 16 years old"
        new RegExp(`${firstName}[^.]*?(\\d+)\\s*years?\\s*(?:old|of age)`, 'i'),
        // "Martha her daughter about 34 years of age"
        new RegExp(`${firstName}[^.]*?(?:about\\s+)?(\\d+)\\s*years?\\s*of\\s*age`, 'i'),
        // "Lydia Williams | 24 |" (table format)
        new RegExp(`${firstName}[^|]*\\|\\s*(\\d+)\\s*\\|`, 'i'),
        // Generic: look for age near name
        new RegExp(`${firstName}[^.]{0,50}?(\\d{1,2})\\s*(?:years?|yrs?)`, 'i'),
    ];

    for (const pattern of patterns) {
        const match = contextText.match(pattern);
        if (match && match[1]) {
            const age = parseInt(match[1], 10);
            if (age >= 0 && age <= 100) {
                return { age, unit: 'years', raw: age };
            }
        }
    }

    return null;
}

// Extract family relationships from context
function extractRelationships(contextText, personName, allPeopleInPetition) {
    if (!contextText) return [];

    const relationships = [];
    const nameParts = personName.split(' ');
    const firstName = nameParts[0];

    // Patterns for relationships
    const patterns = [
        // "Martha her daughter"
        { pattern: new RegExp(`(\\w+)\\s+(?:her|his)\\s+daughter`, 'gi'), rel: 'child_of' },
        // "Walter Butler, Grace's son"
        { pattern: new RegExp(`${firstName}[^,]*,\\s*(\\w+)'s\\s+son`, 'i'), rel: 'child_of' },
        { pattern: new RegExp(`${firstName}[^,]*,\\s*(\\w+)'s\\s+daughter`, 'i'), rel: 'child_of' },
        // "son of Selina", "daughter of Selina"
        { pattern: new RegExp(`${firstName}[^.]*?(?:son|daughter)\\s+of\\s+(\\w+)`, 'i'), rel: 'child_of' },
        // "Gertrude Williams | 6 | Daughter of Marion"
        { pattern: new RegExp(`${firstName}[^|]*\\|[^|]*\\|[^|]*(?:son|daughter)\\s+of\\s+(\\w+)`, 'i'), rel: 'child_of' },
    ];

    for (const { pattern, rel } of patterns) {
        const match = contextText.match(pattern);
        if (match && match[1]) {
            const relatedName = match[1];
            // Find the full name in the petition
            const fullName = allPeopleInPetition.find(p =>
                p.toLowerCase().startsWith(relatedName.toLowerCase())
            );
            if (fullName) {
                relationships.push({
                    type: rel,
                    related_to: fullName
                });
            }
        }
    }

    return relationships;
}

// Process a single petition
async function processPetition(sourceUrl, dryRun = true) {
    console.log(`\nProcessing: ${sourceUrl}`);

    // Get all records from this petition
    const records = await query(
        "SELECT lead_id, full_name, person_type, context_text, birth_year, locations, relationships, gender FROM unconfirmed_persons WHERE source_url = $1",
        [sourceUrl]
    );

    console.log(`  Found ${records.rows.length} records`);

    const petitionYear = getPetitionYear(sourceUrl);
    const allNames = records.rows.map(r => r.full_name);

    // Find owner(s) - filter out garbage like "Here"
    const owners = records.rows.filter(r =>
        r.person_type === 'owner' &&
        r.full_name.length > 3 &&
        r.full_name.includes(' ') &&
        !['Here', 'The', 'This', 'That'].includes(r.full_name)
    );
    const ownerNames = owners.map(o => o.full_name);
    console.log(`  Owner(s): ${ownerNames.join(', ') || 'NOT FOUND'}`);

    // Build a map of table records by first name for cross-referencing
    const tableDataByFirstName = {};
    for (const record of records.rows) {
        const tableData = parseTableFormat(record.context_text);
        if (tableData && tableData.firstName) {
            tableDataByFirstName[tableData.firstName.toLowerCase()] = {
                ...tableData,
                lead_id: record.lead_id
            };
        }
    }

    let updates = [];

    for (const record of records.rows) {
        const changes = {};

        // 1. Fix location - all DC petitions are Washington, D.C.
        const currentLocs = record.locations || [];
        const hasProperLocation = currentLocs.some(l =>
            l.includes('Washington') || l.includes('D.C.') || l.includes('District')
        );
        if (!hasProperLocation) {
            changes.locations = ['Washington, D.C.'];
        }

        // 2. Extract birth year from age
        if (!record.birth_year) {
            let ageData = extractAge(record.context_text, record.full_name);

            // If no age in this record's context, try to find matching table record
            if (!ageData && record.full_name.includes(' ')) {
                const firstName = record.full_name.split(' ')[0].toLowerCase();
                let tableMatch = tableDataByFirstName[firstName];

                // Try common name variations if no exact match
                if (!tableMatch) {
                    const nameVariations = {
                        'selina': 'salina',
                        'salina': 'selina',
                        'sarah': 'sara',
                        'sara': 'sarah',
                        'elizabeth': 'elisabeth',
                        'elisabeth': 'elizabeth',
                        'catherine': 'katherine',
                        'katherine': 'catherine',
                        'ann': 'anne',
                        'anne': 'ann',
                    };
                    const variant = nameVariations[firstName];
                    if (variant) {
                        tableMatch = tableDataByFirstName[variant];
                    }
                }

                if (tableMatch && tableMatch.age !== null) {
                    const age = tableMatch.ageUnit === 'months' ? tableMatch.age / 12 : tableMatch.age;
                    ageData = { age, unit: tableMatch.ageUnit, raw: tableMatch.age };
                    changes.age_source = 'cross-referenced from table record';
                }
            }

            if (ageData !== null) {
                const birthYear = Math.round(petitionYear - ageData.age);
                changes.birth_year = birthYear;
                changes.age_extracted = ageData.raw;
                changes.age_unit = ageData.unit;
            }
        }

        // 2b. Also extract gender from table format or cross-reference
        const tableData = parseTableFormat(record.context_text);
        if (tableData) {
            if (tableData.sex && !record.gender) {
                changes.gender = tableData.sex;
            }
        } else if (!record.gender && record.full_name.includes(' ')) {
            // Try cross-reference from table record
            const firstName = record.full_name.split(' ')[0].toLowerCase();
            const tableMatch = tableDataByFirstName[firstName];
            if (tableMatch && tableMatch.sex) {
                changes.gender = tableMatch.sex;
                changes.gender_source = 'cross-referenced';
            }
        }

        if (tableData) {
            // Get relationship from table
            if (tableData.relationship && tableData.relationship.relatedTo) {
                const relatedName = tableData.relationship.relatedTo;
                // Find full name - handle "Do" (meaning ditto/same as above)
                if (relatedName.toLowerCase() !== 'do') {
                    const fullName = allNames.find(n =>
                        n.toLowerCase().startsWith(relatedName.toLowerCase())
                    );
                    if (fullName) {
                        changes.relationships = changes.relationships || [];
                        changes.relationships.push({
                            type: 'child_of',
                            related_to: fullName
                        });
                    }
                }
            }
        }

        // 3. Extract relationships
        const currentRels = record.relationships || [];
        if (currentRels.length === 0 && record.full_name.includes(' ')) {
            const rels = extractRelationships(record.context_text, record.full_name, allNames);
            if (rels.length > 0) {
                changes.relationships = rels;
            }
        }

        // 4. Link to owner (for enslaved people)
        if (record.person_type === 'enslaved' && ownerNames.length > 0) {
            const hasOwnerLink = currentRels.some(r => r.type === 'enslaved_by');
            if (!hasOwnerLink) {
                changes.owner_link = ownerNames[0];
            }
        }

        if (Object.keys(changes).length > 0) {
            updates.push({
                lead_id: record.lead_id,
                full_name: record.full_name,
                person_type: record.person_type,
                changes
            });
        }
    }

    console.log(`  Updates needed: ${updates.length}`);

    // Show sample updates
    const sample = updates.slice(0, 5);
    for (const u of sample) {
        console.log(`    ${u.full_name} (${u.person_type}):`);
        if (u.changes.birth_year) {
            const unit = u.changes.age_unit === 'months' ? 'months' : 'years';
            console.log(`      birth_year: NULL -> ${u.changes.birth_year} (age ${u.changes.age_extracted} ${unit} in ${petitionYear})`);
        }
        if (u.changes.gender) {
            console.log(`      gender: -> ${u.changes.gender}`);
        }
        if (u.changes.locations) {
            console.log(`      locations: -> ${JSON.stringify(u.changes.locations)}`);
        }
        if (u.changes.relationships) {
            console.log(`      relationships: -> ${JSON.stringify(u.changes.relationships)}`);
        }
        if (u.changes.owner_link) {
            console.log(`      owner: -> ${u.changes.owner_link}`);
        }
    }

    if (updates.length > 5) {
        console.log(`    ... and ${updates.length - 5} more`);
    }

    // Apply updates if not dry run
    if (!dryRun && updates.length > 0) {
        console.log(`  Applying ${updates.length} updates...`);

        for (const u of updates) {
            const sets = [];
            const values = [];
            let paramIdx = 1;

            if (u.changes.birth_year) {
                sets.push(`birth_year = $${paramIdx++}`);
                values.push(u.changes.birth_year);
            }

            if (u.changes.gender) {
                sets.push(`gender = $${paramIdx++}`);
                values.push(u.changes.gender);
            }

            if (u.changes.locations) {
                sets.push(`locations = $${paramIdx++}`);
                values.push(u.changes.locations);
            }

            if (u.changes.relationships || u.changes.owner_link) {
                const rels = u.changes.relationships || [];
                if (u.changes.owner_link) {
                    rels.push({ type: 'enslaved_by', related_to: u.changes.owner_link });
                }
                sets.push(`relationships = $${paramIdx++}`);
                values.push(JSON.stringify(rels));
            }

            if (sets.length > 0) {
                values.push(u.lead_id);
                const sql = `UPDATE unconfirmed_persons SET ${sets.join(', ')}, updated_at = NOW() WHERE lead_id = $${paramIdx}`;
                await query(sql, values);
            }
        }

        console.log(`  ✓ Updates applied`);
    }

    return updates;
}

// Main
async function main() {
    const args = process.argv.slice(2);
    const isTest = args.includes('--test');
    const isDryRun = args.includes('--dry-run');
    const isRun = args.includes('--run');
    const applyTest = args.includes('--apply');

    if (!isTest && !isDryRun && !isRun) {
        console.log('Usage:');
        console.log('  node scripts/fix-civilwardc-data.js --test           # Test on one petition (dry run)');
        console.log('  node scripts/fix-civilwardc-data.js --test --apply   # Test on one petition AND apply');
        console.log('  node scripts/fix-civilwardc-data.js --dry-run        # Show what would change for all');
        console.log('  node scripts/fix-civilwardc-data.js --run            # Actually update database');
        process.exit(1);
    }

    console.log('=== CIVIL WAR DC DATA FIX ===\n');

    if (isTest) {
        // Test on the Williams family petition
        const testUrl = 'https://civilwardc.org/texts/petitions/cww.00035.html';
        const dryRun = !applyTest;
        console.log(applyTest ? '*** APPLYING CHANGES ***\n' : '*** DRY RUN (use --apply to actually update) ***\n');
        await processPetition(testUrl, dryRun);
        if (applyTest) {
            console.log('\n✓ Test petition updated successfully!');
        }
    } else {
        // Process all Civil War DC petitions
        const petitions = await query(
            "SELECT DISTINCT source_url FROM unconfirmed_persons WHERE source_url LIKE '%civilwardc.org%' ORDER BY source_url"
        );

        console.log(`Found ${petitions.rows.length} petitions to process\n`);

        let totalUpdates = 0;
        let processedCount = 0;

        for (const p of petitions.rows) {
            const updates = await processPetition(p.source_url, !isRun);
            totalUpdates += updates.length;
            processedCount++;

            // Progress every 100
            if (processedCount % 100 === 0) {
                console.log(`\n--- Progress: ${processedCount}/${petitions.rows.length} petitions, ${totalUpdates} updates ---\n`);
            }
        }

        console.log(`\n=== SUMMARY ===`);
        console.log(`Petitions processed: ${processedCount}`);
        console.log(`Total updates: ${totalUpdates}`);
        if (!isRun) {
            console.log(`\nThis was a DRY RUN. Use --run to apply changes.`);
        }
    }

    process.exit(0);
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
