/**
 * Match User Ancestry to Enslavers (Bottom-Up Matching)
 *
 * This is the core descendancy matching system. It takes a modern person's
 * FamilySearch pedigree (ancestors going UP) and matches against our database
 * of enslavers and enslaver descendants (built TOP-DOWN).
 *
 * WORKFLOW:
 * 1. User provides their FamilySearch pedigree chart (ancestors)
 * 2. System parses all ancestors with names and FamilySearch IDs
 * 3. System searches our database for matches:
 *    - Direct match: Ancestor IS an enslaver in our database
 *    - Descendant match: Ancestor is a known descendant of an enslaver
 *    - Name match: Ancestor name matches enslaver name (needs verification)
 * 4. Returns matched enslavers with confidence scores
 *
 * Usage:
 *   node scripts/match-ancestry-to-enslavers.js --interactive
 *   node scripts/match-ancestry-to-enslavers.js --file pedigree.txt
 *   node scripts/match-ancestry-to-enslavers.js --person "G21N-HD2"
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { neon } = require('@neondatabase/serverless');
const readline = require('readline');
const fs = require('fs');

const sql = neon(process.env.DATABASE_URL);

/**
 * Parse FamilySearch pedigree text (ancestors going UP)
 */
function parsePedigreeText(text) {
    const ancestors = [];
    const lines = text.split('\n');

    // Pattern for "Name (FS-ID)" or "Name FS-ID"
    const personPattern = /([A-Z][a-zA-Z\s\.\']+?)\s*[\(\[]?([A-Z0-9]{4}-[A-Z0-9]{2,4})[\)\]]?/g;
    const datePattern = /(\d{4})\s*[-–]\s*(\d{4})?/;

    let generation = 0;
    let lastIndent = 0;

    for (const line of lines) {
        if (!line.trim()) continue;

        // Estimate generation from indentation
        const indent = line.search(/\S/);
        if (indent > lastIndent + 2) generation++;
        else if (indent < lastIndent - 2) generation = Math.max(0, generation - 1);
        lastIndent = indent;

        // Find persons in line
        let match;
        while ((match = personPattern.exec(line)) !== null) {
            const name = match[1].trim();
            const fsId = match[2];

            // Skip garbage
            if (name.length < 3) continue;
            if (/^(the|and|for|with)$/i.test(name)) continue;

            // Get dates if present
            const dateMatch = line.match(datePattern);

            ancestors.push({
                name: name,
                fs_id: fsId,
                birth_year: dateMatch ? parseInt(dateMatch[1]) : null,
                death_year: dateMatch && dateMatch[2] ? parseInt(dateMatch[2]) : null,
                generation: generation,
                raw_line: line.trim()
            });
        }
        personPattern.lastIndex = 0;
    }

    return ancestors;
}

/**
 * Search for enslaver matches in database
 */
async function findEnslaverMatches(ancestors) {
    const matches = [];

    console.log(`\nSearching ${ancestors.length} ancestors against enslaver database...\n`);

    for (const ancestor of ancestors) {
        // 1. Check if ancestor IS an enslaver (by FamilySearch ID)
        if (ancestor.fs_id) {
            const fsMatch = await sql`
                SELECT canonical_name, person_type, birth_year_estimate, notes
                FROM canonical_persons
                WHERE notes::text LIKE ${'%"familysearch_id":"' + ancestor.fs_id + '"%'}
                AND person_type IN ('enslaver', 'slaveholder', 'owner')
                LIMIT 1
            `;

            if (fsMatch.length > 0) {
                matches.push({
                    ancestor: ancestor.name,
                    ancestor_fs_id: ancestor.fs_id,
                    match_type: 'DIRECT_ENSLAVER',
                    enslaver: fsMatch[0].canonical_name,
                    enslaver_type: fsMatch[0].person_type,
                    confidence: 0.99,
                    notes: 'Ancestor is directly identified as an enslaver'
                });
                continue;
            }
        }

        // 2. Check if ancestor is a DESCENDANT of a known enslaver (via parent chain)
        if (ancestor.fs_id) {
            const descendantMatch = await sql`
                SELECT canonical_name, notes
                FROM canonical_persons
                WHERE notes::text LIKE ${'%"familysearch_id":"' + ancestor.fs_id + '"%'}
                AND person_type = 'descendant'
                LIMIT 1
            `;

            if (descendantMatch.length > 0) {
                // Parse notes to find enslaver connection
                const notes = typeof descendantMatch[0].notes === 'string'
                    ? JSON.parse(descendantMatch[0].notes)
                    : descendantMatch[0].notes;

                // Trace back to find enslaver
                let enslaverInfo = await traceToEnslaver(ancestor.fs_id);

                if (enslaverInfo) {
                    matches.push({
                        ancestor: ancestor.name,
                        ancestor_fs_id: ancestor.fs_id,
                        match_type: 'DESCENDANT_OF_ENSLAVER',
                        enslaver: enslaverInfo.name,
                        enslaver_fs_id: enslaverInfo.fs_id,
                        generations_removed: enslaverInfo.generations,
                        confidence: 0.95,
                        notes: `Ancestor descends from enslaver ${enslaverInfo.name}`
                    });
                    continue;
                }
            }
        }

        // 3. Name-based matching (lower confidence)
        const nameParts = ancestor.name.split(' ');
        const lastName = nameParts[nameParts.length - 1];

        if (lastName.length >= 3) {
            // Check canonical enslavers
            const nameMatch = await sql`
                SELECT canonical_name, person_type, birth_year_estimate
                FROM canonical_persons
                WHERE person_type IN ('enslaver', 'slaveholder', 'owner')
                AND (
                    canonical_name ILIKE ${ancestor.name}
                    OR (last_name ILIKE ${lastName} AND birth_year_estimate BETWEEN ${(ancestor.birth_year || 1800) - 50} AND ${(ancestor.birth_year || 1900) + 20})
                )
                LIMIT 5
            `;

            for (const m of nameMatch) {
                // Calculate confidence based on name similarity
                const exactMatch = m.canonical_name.toLowerCase() === ancestor.name.toLowerCase();
                const confidence = exactMatch ? 0.7 : 0.4;

                matches.push({
                    ancestor: ancestor.name,
                    ancestor_fs_id: ancestor.fs_id,
                    match_type: 'NAME_MATCH',
                    enslaver: m.canonical_name,
                    enslaver_type: m.person_type,
                    confidence: confidence,
                    notes: exactMatch
                        ? 'Exact name match - needs verification'
                        : 'Surname match - needs verification'
                });
            }
        }
    }

    return matches;
}

/**
 * Trace from a descendant back to the original enslaver
 */
async function traceToEnslaver(fsId, depth = 0, maxDepth = 10) {
    if (depth >= maxDepth) return null;

    const person = await sql`
        SELECT canonical_name, person_type, notes
        FROM canonical_persons
        WHERE notes::text LIKE ${'%"familysearch_id":"' + fsId + '"%'}
        LIMIT 1
    `;

    if (person.length === 0) return null;

    // If this person is an enslaver, we found it
    if (['enslaver', 'slaveholder', 'owner'].includes(person[0].person_type)) {
        const notes = typeof person[0].notes === 'string'
            ? JSON.parse(person[0].notes)
            : person[0].notes;
        return {
            name: person[0].canonical_name,
            fs_id: notes.familysearch_id,
            generations: depth
        };
    }

    // Otherwise, try to trace through parent
    const notes = typeof person[0].notes === 'string'
        ? JSON.parse(person[0].notes)
        : person[0].notes;

    // Check father first, then mother
    if (notes.father_fs_id) {
        const result = await traceToEnslaver(notes.father_fs_id, depth + 1, maxDepth);
        if (result) return result;
    }

    if (notes.mother_fs_id) {
        const result = await traceToEnslaver(notes.mother_fs_id, depth + 1, maxDepth);
        if (result) return result;
    }

    return null;
}

/**
 * Get enslaved persons associated with a matched enslaver
 */
async function getEnslavedByEnslaver(enslaverName) {
    // Check unconfirmed_persons for enslaved linked to this owner
    const enslaved = await sql`
        SELECT full_name, context_text, relationships
        FROM unconfirmed_persons
        WHERE person_type = 'enslaved'
        AND (
            relationships::text ILIKE ${'%' + enslaverName + '%'}
            OR context_text ILIKE ${'%Owner: ' + enslaverName + '%'}
        )
        LIMIT 20
    `;

    return enslaved;
}

/**
 * Interactive mode
 */
async function interactiveMode() {
    console.log(`
${'═'.repeat(65)}
   ANCESTRY → ENSLAVER MATCHING SYSTEM
${'═'.repeat(65)}

This system matches your ancestors against our enslaver database.

INSTRUCTIONS:
1. Go to FamilySearch.org → Tree → Your profile
2. Click "Pedigree" or "Fan Chart" view
3. Copy the text showing your ancestors
4. Paste below and press Enter twice when done

Paste your pedigree (press Enter twice to finish):
${'─'.repeat(65)}
`);

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    let text = '';
    let emptyLines = 0;

    return new Promise((resolve) => {
        rl.on('line', (line) => {
            if (line === '') {
                emptyLines++;
                if (emptyLines >= 2) {
                    rl.close();
                    resolve(text);
                }
            } else {
                emptyLines = 0;
                text += line + '\n';
            }
        });
    });
}

/**
 * Main function
 */
async function main() {
    const args = process.argv.slice(2);

    let inputText = '';
    let testMode = args.includes('--test');

    if (args.includes('--help')) {
        console.log(`
Ancestry to Enslaver Matching System

Usage:
  node scripts/match-ancestry-to-enslavers.js --interactive
  node scripts/match-ancestry-to-enslavers.js --file <pedigree.txt>
  node scripts/match-ancestry-to-enslavers.js --test

This system takes a user's FamilySearch pedigree (ancestors going UP)
and matches against our database of enslavers built from primary sources
and WikiTree (going DOWN from known enslavers).

Match Types:
  DIRECT_ENSLAVER      - Your ancestor IS a known enslaver (99% confidence)
  DESCENDANT_OF_ENSLAVER - Your ancestor descends from enslaver (95% confidence)
  NAME_MATCH           - Name matches an enslaver (needs verification)
`);
        return;
    }

    // Test mode uses Danyela's known ancestry
    if (testMode) {
        console.log('Running test with Danyela Brown lineage...\n');
        inputText = `
Danyela June Brown (G21N-HD2) 1996-
├─ Billy Bob Brown Jr. (G21N-QTN) 1965-
│  └─ Billy Bob Brown Sr (LR87-Q4Y) 1939-2020
└─ Nancy Miller (G21N-4JF) 1962-
   ├─ Arthur Miller (G21Y-X4B)
   └─ Marjorie Lyman (G21Y-2S8)
      ├─ Charles Huntington Lyman III (KZ3H-GB2) 1903-1972
      └─ Marjorie Leigh Young (L5JP-ZRG) 1904-1990
         Charles Huntington Lyman Jr (KZJX-9K1) 1875-1945
            └─ Rebekah Freeland Chew (LH2D-183) 1847-1917
               └─ Maria Angelica Biscoe (L6K5-FRC) 1817-1898
                  └─ Anne Maria Hopewell (L64X-RH2) 1799-1881
                     └─ James Hopewell (MTRV-Z72) 1780-1817
`;
    } else if (args.includes('--file')) {
        const filePath = args[args.indexOf('--file') + 1];
        inputText = fs.readFileSync(filePath, 'utf8');
    } else if (args.includes('--interactive')) {
        inputText = await interactiveMode();
    } else {
        console.log('Use --interactive, --file, or --test. See --help for details.');
        return;
    }

    // Parse ancestors
    const ancestors = parsePedigreeText(inputText);

    console.log(`${'═'.repeat(65)}`);
    console.log('   PARSED ANCESTORS');
    console.log(`${'═'.repeat(65)}\n`);

    for (const a of ancestors) {
        const years = a.birth_year
            ? (a.death_year ? `${a.birth_year}-${a.death_year}` : `${a.birth_year}-`)
            : '';
        console.log(`  ${a.name} (${a.fs_id || 'no ID'}) ${years}`);
    }

    // Find matches
    const matches = await findEnslaverMatches(ancestors);

    console.log(`\n${'═'.repeat(65)}`);
    console.log('   ENSLAVER MATCHES');
    console.log(`${'═'.repeat(65)}\n`);

    if (matches.length === 0) {
        console.log('  No matches found in current database.\n');
        console.log('  This could mean:');
        console.log('  1. Your ancestors are not yet in our enslaver database');
        console.log('  2. The connection exists but needs WikiTree buildout');
        console.log('  3. Your family did not own enslaved people (good!)');
    } else {
        // Group by match type
        const direct = matches.filter(m => m.match_type === 'DIRECT_ENSLAVER');
        const descendant = matches.filter(m => m.match_type === 'DESCENDANT_OF_ENSLAVER');
        const nameMatch = matches.filter(m => m.match_type === 'NAME_MATCH');

        if (direct.length > 0) {
            console.log('DIRECT ENSLAVER MATCHES (your ancestor was an enslaver):');
            console.log('─'.repeat(65));
            for (const m of direct) {
                console.log(`  ⚠️  ${m.ancestor} IS ${m.enslaver}`);
                console.log(`      Confidence: ${Math.round(m.confidence * 100)}%`);

                // Get enslaved persons
                const enslaved = await getEnslavedByEnslaver(m.enslaver);
                if (enslaved.length > 0) {
                    console.log(`      Enslaved ${enslaved.length}+ people including:`);
                    for (const e of enslaved.slice(0, 3)) {
                        console.log(`        - ${e.full_name}`);
                    }
                }
                console.log('');
            }
        }

        if (descendant.length > 0) {
            console.log('DESCENDANT MATCHES (your ancestor descends from enslaver):');
            console.log('─'.repeat(65));
            for (const m of descendant) {
                console.log(`  📍 ${m.ancestor}`);
                console.log(`      Descends from: ${m.enslaver} (${m.generations_removed} generations)`);
                console.log(`      Confidence: ${Math.round(m.confidence * 100)}%`);
                console.log('');
            }
        }

        if (nameMatch.length > 0 && direct.length === 0 && descendant.length === 0) {
            console.log('POTENTIAL NAME MATCHES (needs verification):');
            console.log('─'.repeat(65));
            for (const m of nameMatch.slice(0, 5)) {
                console.log(`  ? ${m.ancestor} may be related to ${m.enslaver}`);
                console.log(`      Confidence: ${Math.round(m.confidence * 100)}%`);
                console.log(`      Note: ${m.notes}`);
                console.log('');
            }
        }
    }

    console.log(`${'═'.repeat(65)}\n`);
}

// Export for module use
module.exports = {
    parsePedigreeText,
    findEnslaverMatches,
    traceToEnslaver
};

if (require.main === module) {
    main().catch(console.error);
}
