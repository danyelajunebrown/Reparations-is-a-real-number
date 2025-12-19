/**
 * FamilySearch Descendancy View Parser
 *
 * Standardized parser for FamilySearch descendancy view exports.
 * This replaces unreliable Puppeteer scraping with a document-based workflow.
 *
 * WORKFLOW:
 * 1. Go to FamilySearch.org → Tree → Find your enslaver ancestor
 * 2. Click "Descendancy" view
 * 3. Print to PDF or copy text
 * 4. Run this parser on the PDF/text
 *
 * INPUT FORMAT (FamilySearch Descendancy View):
 * ┌─ James Hopewell (MTRV-Z72)
 * │  1780-1817
 * │  └─ Ann Maria Hopewell (L64X-RH2)
 * │     1799-1881
 * │     └─ Maria Angelica Biscoe (L6K5-FRC)
 * │        1817-1898
 *
 * OUTPUT: Structured JSON with FamilySearch IDs, relationships, ready for database import
 *
 * Usage:
 *   node scripts/parse-familysearch-descendancy.js --file descendancy.txt
 *   node scripts/parse-familysearch-descendancy.js --text "paste text here"
 *   node scripts/parse-familysearch-descendancy.js --interactive
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const sql = neon(process.env.DATABASE_URL);

/**
 * Parse FamilySearch descendancy text into structured data
 */
function parseDescendancyText(text) {
    const persons = [];
    const lines = text.split('\n');

    // Track parent stack by indentation level
    const parentStack = [];

    // Patterns to match FamilySearch descendancy format
    const patterns = {
        // "Name (FS-ID)" or "Name FS-ID"
        personWithId: /^[\s│├└─┬┼]*(.+?)\s*[\(\[]?([A-Z0-9]{4}-[A-Z0-9]{2,4})[\)\]]?\s*$/,
        // "Name" followed by ID on next line
        personName: /^[\s│├└─┬┼]*([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?(?:[A-Z][a-z]+)?(?:\s+(?:Sr\.?|Jr\.?|I{1,3}|IV|V))?)\s*$/,
        // FamilySearch ID alone
        fsId: /^[\s│├└─┬┼]*([A-Z0-9]{4}-[A-Z0-9]{2,4})\s*$/,
        // Date range: "1780-1817" or "1780–1817" or "b. 1780" or "d. 1817"
        dateRange: /(\d{4})\s*[-–]\s*(\d{4})?/,
        birthYear: /(?:b\.?|born)\s*(\d{4})/i,
        deathYear: /(?:d\.?|died)\s*(\d{4})/i,
        // Living indicator
        living: /living/i,
        // Indentation level (count leading spaces/tree chars)
        indent: /^([\s│├└─┬┼]*)/
    };

    let currentPerson = null;
    let lastIndent = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        // Calculate indentation level
        const indentMatch = line.match(patterns.indent);
        const indent = indentMatch ? indentMatch[1].length : 0;
        const normalizedIndent = Math.floor(indent / 3); // Normalize to generation level

        // Try to match person with ID
        let match = line.match(patterns.personWithId);
        if (match) {
            // Save previous person
            if (currentPerson && currentPerson.name) {
                persons.push(currentPerson);
            }

            // Determine parent from stack
            while (parentStack.length > normalizedIndent) {
                parentStack.pop();
            }
            const parent = parentStack.length > 0 ? parentStack[parentStack.length - 1] : null;

            currentPerson = {
                name: cleanName(match[1]),
                fs_id: match[2],
                birth_year: null,
                death_year: null,
                parent_fs_id: parent?.fs_id || null,
                generation: normalizedIndent,
                raw_line: line.trim()
            };

            // Push to parent stack
            parentStack.push(currentPerson);
            lastIndent = normalizedIndent;
            continue;
        }

        // Try to match standalone name (ID might be on next line)
        match = line.match(patterns.personName);
        if (match && !patterns.dateRange.test(line) && !patterns.fsId.test(line)) {
            // Save previous person
            if (currentPerson && currentPerson.name) {
                persons.push(currentPerson);
            }

            // Determine parent from stack
            while (parentStack.length > normalizedIndent) {
                parentStack.pop();
            }
            const parent = parentStack.length > 0 ? parentStack[parentStack.length - 1] : null;

            currentPerson = {
                name: cleanName(match[1]),
                fs_id: null,
                birth_year: null,
                death_year: null,
                parent_fs_id: parent?.fs_id || null,
                generation: normalizedIndent,
                raw_line: line.trim()
            };

            parentStack.push(currentPerson);
            lastIndent = normalizedIndent;
            continue;
        }

        // Try to match FS ID for current person
        match = line.match(patterns.fsId);
        if (match && currentPerson && !currentPerson.fs_id) {
            currentPerson.fs_id = match[1];
            continue;
        }

        // Try to match date range
        match = line.match(patterns.dateRange);
        if (match && currentPerson) {
            currentPerson.birth_year = parseInt(match[1]);
            if (match[2]) currentPerson.death_year = parseInt(match[2]);
            continue;
        }

        // Try birth year
        match = line.match(patterns.birthYear);
        if (match && currentPerson) {
            currentPerson.birth_year = parseInt(match[1]);
            continue;
        }

        // Try death year
        match = line.match(patterns.deathYear);
        if (match && currentPerson) {
            currentPerson.death_year = parseInt(match[1]);
            continue;
        }

        // Check for living
        if (patterns.living.test(line) && currentPerson) {
            currentPerson.is_living = true;
        }
    }

    // Don't forget the last person
    if (currentPerson && currentPerson.name) {
        persons.push(currentPerson);
    }

    return persons;
}

/**
 * Clean up name string
 */
function cleanName(name) {
    return name
        .replace(/[│├└─┬┼]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Parse a more freeform text format (like what user pasted)
 */
function parseFreeformText(text) {
    const persons = [];
    const lines = text.split('\n');

    // Pattern for "Name (FS-ID)" anywhere in line
    const personPattern = /([A-Z][a-zA-Z\s\.]+?)\s*[\(\[]([A-Z0-9]{4}-[A-Z0-9]{2,4})[\)\]]/g;
    const datePattern = /(\d{4})\s*[-–]\s*(\d{4})?/;
    const livingPattern = /living/i;

    let lastParent = null;
    let currentGeneration = 0;

    for (const line of lines) {
        // Find all persons in this line
        let match;
        while ((match = personPattern.exec(line)) !== null) {
            const name = cleanName(match[1]);
            const fsId = match[2];

            // Skip if name looks like garbage
            if (name.length < 3 || /^[a-z]/.test(name)) continue;

            // Look for dates in same line or nearby
            const dateMatch = line.match(datePattern);

            const person = {
                name: name,
                fs_id: fsId,
                birth_year: dateMatch ? parseInt(dateMatch[1]) : null,
                death_year: dateMatch && dateMatch[2] ? parseInt(dateMatch[2]) : null,
                is_living: livingPattern.test(line),
                raw_line: line.trim()
            };

            // Check for duplicate
            if (!persons.find(p => p.fs_id === fsId)) {
                persons.push(person);
            }
        }
        personPattern.lastIndex = 0; // Reset regex
    }

    return persons;
}

/**
 * Import parsed persons to database
 */
async function importToDatabase(persons, options = {}) {
    const { dryRun = false, sourceDescription = 'FamilySearch Descendancy View' } = options;

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`   IMPORTING ${persons.length} PERSONS TO DATABASE`);
    console.log(`${'═'.repeat(60)}\n`);

    let inserted = 0;
    let skipped = 0;
    let errors = 0;

    for (const person of persons) {
        if (!person.name || !person.fs_id) {
            console.log(`  ⚠ Skipping invalid: ${person.name || 'no name'} (no FS ID)`);
            skipped++;
            continue;
        }

        const nameParts = person.name.split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(' ');

        const notes = JSON.stringify({
            familysearch_id: person.fs_id,
            parent_fs_id: person.parent_fs_id || null,
            generation: person.generation,
            is_living: person.is_living || false,
            source: sourceDescription,
            import_date: new Date().toISOString()
        });

        if (dryRun) {
            console.log(`  → Would insert: ${person.name} (${person.fs_id})`);
            inserted++;
            continue;
        }

        try {
            const result = await sql`
                INSERT INTO canonical_persons (
                    canonical_name,
                    first_name,
                    last_name,
                    birth_year_estimate,
                    death_year_estimate,
                    person_type,
                    verification_status,
                    confidence_score,
                    created_by,
                    notes
                ) VALUES (
                    ${person.name},
                    ${firstName},
                    ${lastName || null},
                    ${person.birth_year || null},
                    ${person.death_year || null},
                    'descendant',
                    'familysearch_verified',
                    0.95,
                    'descendancy_parser',
                    ${notes}
                )
                ON CONFLICT DO NOTHING
                RETURNING id
            `;

            if (result.length > 0) {
                const years = person.birth_year
                    ? (person.death_year ? `${person.birth_year}-${person.death_year}` : `${person.birth_year}-`)
                    : (person.is_living ? 'Living' : '?');
                console.log(`  ✓ ${person.name} (${person.fs_id}) ${years}`);
                inserted++;
            } else {
                console.log(`  ○ ${person.name} (${person.fs_id}) - already exists`);
                skipped++;
            }
        } catch (e) {
            console.log(`  ✗ ${person.name}: ${e.message}`);
            errors++;
        }
    }

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`  Inserted: ${inserted}`);
    console.log(`  Skipped:  ${skipped}`);
    console.log(`  Errors:   ${errors}`);
    console.log(`${'─'.repeat(60)}\n`);

    return { inserted, skipped, errors };
}

/**
 * Interactive mode - prompt user to paste text
 */
async function interactiveMode() {
    console.log(`
${'═'.repeat(60)}
   FAMILYSEARCH DESCENDANCY PARSER - INTERACTIVE MODE
${'═'.repeat(60)}

INSTRUCTIONS:
1. Go to FamilySearch.org → Tree → Find your ancestor
2. Click "Descendancy" view
3. Select all text (Cmd+A) and copy (Cmd+C)
4. Paste below and press Enter twice when done

Paste descendancy text (press Enter twice to finish):
${'─'.repeat(60)}
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

    // Parse arguments
    let inputText = '';
    let dryRun = args.includes('--dry-run');
    let showHelp = args.includes('--help') || args.includes('-h');

    if (showHelp) {
        console.log(`
FamilySearch Descendancy Parser

Usage:
  node scripts/parse-familysearch-descendancy.js --interactive
  node scripts/parse-familysearch-descendancy.js --file <path>
  node scripts/parse-familysearch-descendancy.js --text "pasted text"

Options:
  --interactive  Prompt for text input
  --file <path>  Read from file
  --text <text>  Parse provided text
  --dry-run      Parse only, don't import to database
  --help         Show this help

Standard Document Format:
  FamilySearch Descendancy View (print or copy from web)
  Contains: Names, FamilySearch IDs (XXXX-XXX), dates, relationships
`);
        return;
    }

    // Get input text
    if (args.includes('--file')) {
        const filePath = args[args.indexOf('--file') + 1];
        inputText = fs.readFileSync(filePath, 'utf8');
    } else if (args.includes('--text')) {
        const textIdx = args.indexOf('--text');
        inputText = args.slice(textIdx + 1).join(' ');
    } else if (args.includes('--interactive')) {
        inputText = await interactiveMode();
    } else {
        // Default: read from stdin if piped
        if (!process.stdin.isTTY) {
            inputText = fs.readFileSync(0, 'utf8');
        } else {
            console.log('No input provided. Use --help for usage.');
            return;
        }
    }

    if (!inputText.trim()) {
        console.log('No text to parse.');
        return;
    }

    // Parse the text
    console.log(`\n${'═'.repeat(60)}`);
    console.log('   PARSING FAMILYSEARCH DESCENDANCY VIEW');
    console.log(`${'═'.repeat(60)}\n`);

    // Try structured parse first, fall back to freeform
    let persons = parseDescendancyText(inputText);

    if (persons.length === 0) {
        console.log('Structured parse found 0 persons, trying freeform parse...');
        persons = parseFreeformText(inputText);
    }

    console.log(`Found ${persons.length} persons:\n`);

    for (const person of persons) {
        const years = person.birth_year
            ? (person.death_year ? `${person.birth_year}-${person.death_year}` : `${person.birth_year}-`)
            : (person.is_living ? 'Living' : '?');
        console.log(`  ${person.name} (${person.fs_id || 'NO ID'}) - ${years}`);
    }

    // Import to database
    if (!dryRun && persons.length > 0) {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        const answer = await new Promise((resolve) => {
            rl.question('\nImport to database? (y/n): ', resolve);
        });
        rl.close();

        if (answer.toLowerCase() === 'y') {
            await importToDatabase(persons);
        } else {
            console.log('Import cancelled.');
        }
    } else if (dryRun) {
        console.log('\n[Dry run - no database changes]');
    }
}

// Export for use as module
module.exports = {
    parseDescendancyText,
    parseFreeformText,
    importToDatabase
};

// Run if executed directly
if (require.main === module) {
    main().catch(console.error);
}
