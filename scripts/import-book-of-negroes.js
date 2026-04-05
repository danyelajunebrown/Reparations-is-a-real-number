#!/usr/bin/env node
/**
 * Book of Negroes Import (1783)
 *
 * Imports the Inspection Roll of Negroes — 3,009 Black men, women, and children
 * evacuated from New York City by the British at the end of the American Revolution.
 * One of the earliest documents listing Black people by name with status.
 *
 * Source: Nova Scotia Open Data Portal
 * CSV: https://data.novascotia.ca/api/views/xxcy-v3fh/rows.csv?accessType=DOWNLOAD
 * Citation: "Book of Negroes, 1783," Nova Scotia Archives,
 *   archives.novascotia.ca/africanns/book-of-negroes/
 *
 * Original document: "Inspection Roll of Negroes" — NARA Record Group 360,
 *   Miscellaneous Papers of the Continental Congress, 1774-1789
 *
 * Usage:
 *   node scripts/import-book-of-negroes.js
 *   node scripts/import-book-of-negroes.js --dry-run
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { neon } = require('@neondatabase/serverless');
const { parse } = require('csv-parse/sync');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL;
const DRY_RUN = process.argv.includes('--dry-run');
const CSV_PATH = path.resolve(__dirname, '../storage/book-of-negroes-1783.csv');

const SOURCE_URL = 'https://data.novascotia.ca/Arts-Culture-and-History/-Book-of-Negroes-1783/xxcy-v3fh';
const SOURCE_CITATION = 'Book of Negroes (Inspection Roll of Negroes), 1783. Nova Scotia Archives. NARA RG 360.';

let sql = null;

const stats = {
    total: 0,
    imported: 0,
    skipped: 0,
    errors: 0,
    byGender: { m: 0, f: 0, child: 0, unknown: 0 },
    byDestination: {},
    startTime: Date.now()
};

async function main() {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  BOOK OF NEGROES IMPORT (1783)`);
    console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
    console.log(`${'═'.repeat(60)}\n`);

    if (!fs.existsSync(CSV_PATH)) {
        console.error('CSV not found. Download with:');
        console.error('  curl -sL "https://data.novascotia.ca/api/views/xxcy-v3fh/rows.csv?accessType=DOWNLOAD" -o storage/book-of-negroes-1783.csv');
        process.exit(1);
    }

    sql = neon(DATABASE_URL);
    console.log('Connected to database\n');

    // Check for existing imports
    const existing = await sql`
        SELECT COUNT(*) as cnt FROM unconfirmed_persons
        WHERE extraction_method = 'book_of_negroes_import'
    `;
    if (parseInt(existing[0].cnt) > 0) {
        console.log(`  Already imported: ${existing[0].cnt} records from Book of Negroes`);
        console.log('  To re-import, first delete: DELETE FROM unconfirmed_persons WHERE extraction_method = \'book_of_negroes_import\'');
        process.exit(0);
    }

    // Parse CSV
    const csvContent = fs.readFileSync(CSV_PATH, 'utf-8');
    const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true
    });

    console.log(`  Parsed ${records.length} records from CSV\n`);
    stats.total = records.length;

    // Process each record
    for (const record of records) {
        const name = (record.ARname || '').trim();
        if (!name || name.length < 2) {
            stats.skipped++;
            continue;
        }

        const gender = parseGender(record.ARgender);
        const age = parseInt(record.ARage) || null;
        const vessel = (record.ARvessel || '').trim();
        const commander = (record.ARcommander || '').trim();
        const destination = (record.ARbound || '').trim();
        const pageNum = record.ARpage || null;
        const serialNum = record.ARs || null;

        // Track stats
        if (gender === 'male') stats.byGender.m++;
        else if (gender === 'female') stats.byGender.f++;
        else if (gender === 'child_male' || gender === 'child_female') stats.byGender.child++;
        else stats.byGender.unknown++;

        if (destination) {
            stats.byDestination[destination] = (stats.byDestination[destination] || 0) + 1;
        }

        // Determine person type
        // The Book of Negroes documents people who were formerly enslaved
        // and gained freedom by escaping to British lines
        const personType = 'freedperson'; // They were freed by British proclamation

        const contextText = [
            `Book of Negroes entry #${serialNum || record.ID}`,
            `Vessel: ${vessel || 'unknown'}`,
            commander ? `Commander: ${commander}` : null,
            `Destination: ${destination || 'unknown'}`,
            age ? `Age: ${age}` : null,
            `Gender: ${gender}`,
            `Inspection Roll page ${pageNum || '?'}`,
            'Evacuated from New York City, 1783',
            'Formerly enslaved, freed by British proclamation during American Revolution'
        ].filter(Boolean).join('. ');

        const locations = ['New York City, New York'];
        if (destination) {
            // Map common destinations
            if (destination.includes('Port Roseway') || destination.includes('Shelburne')) {
                locations.push('Port Roseway (Shelburne), Nova Scotia');
            } else if (destination.includes('St. John')) {
                locations.push('Saint John, New Brunswick');
            } else if (destination.includes('Annapolis')) {
                locations.push('Annapolis Royal, Nova Scotia');
            } else {
                locations.push(destination);
            }
        }

        if (!DRY_RUN) {
            try {
                await sql`
                    INSERT INTO unconfirmed_persons (
                        full_name, person_type, gender, locations,
                        source_url, source_page_title, extraction_method,
                        context_text, confidence_score, source_type,
                        relationships
                    ) VALUES (
                        ${name},
                        ${personType},
                        ${gender === 'male' || gender === 'child_male' ? 'male' : gender === 'female' || gender === 'child_female' ? 'female' : null},
                        ${locations},
                        ${SOURCE_URL},
                        ${'Book of Negroes (Inspection Roll of Negroes), 1783'},
                        ${'book_of_negroes_import'},
                        ${contextText},
                        ${0.90},
                        ${'government_record'},
                        ${JSON.stringify({
                            document: 'Book of Negroes / Inspection Roll of Negroes',
                            year: 1783,
                            vessel: vessel || null,
                            commander: commander || null,
                            destination: destination || null,
                            age_at_evacuation: age,
                            page: pageNum,
                            serial: serialNum,
                            source_archive: 'NARA RG 360 (American copy) / TNA (British copy)',
                            citation: SOURCE_CITATION
                        })}
                    )
                `;
                stats.imported++;
            } catch (err) {
                console.error(`  Error importing ${name}: ${err.message}`);
                stats.errors++;
            }
        } else {
            stats.imported++;
        }

        // Progress
        if (stats.imported % 500 === 0 && stats.imported > 0) {
            process.stdout.write(`  Progress: ${stats.imported} imported\r`);
        }
    }

    // Register the source document
    if (!DRY_RUN) {
        const docExists = await sql`
            SELECT id FROM person_documents
            WHERE name_as_appears = 'Book of Negroes (Inspection Roll of Negroes), 1783'
            LIMIT 1
        `;
        if (docExists.length === 0) {
            await sql`
                INSERT INTO person_documents (
                    name_as_appears, source_url, source_type,
                    collection_name, document_type, page_reference,
                    person_type, extraction_confidence, created_by
                ) VALUES (
                    ${'Book of Negroes (Inspection Roll of Negroes), 1783'},
                    ${SOURCE_URL},
                    ${'government_record'},
                    ${'population-records'},
                    ${'evacuation_roll'},
                    ${'150 pages, ~3,009 entries'},
                    ${'freedperson'},
                    ${0.90},
                    ${'import-book-of-negroes.js'}
                )
            `;
            console.log('\n  Registered source document in person_documents');
        }
    }

    // Summary
    const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  IMPORT COMPLETE`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`  Total records:   ${stats.total}`);
    console.log(`  Imported:        ${stats.imported}`);
    console.log(`  Skipped:         ${stats.skipped} (no name)`);
    console.log(`  Errors:          ${stats.errors}`);
    console.log(`  Elapsed:         ${elapsed}s`);
    console.log(`  Mode:            ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
    console.log('');
    console.log('  By gender:');
    console.log(`    Male:          ${stats.byGender.m}`);
    console.log(`    Female:        ${stats.byGender.f}`);
    console.log(`    Children:      ${stats.byGender.child}`);
    console.log(`    Unknown:       ${stats.byGender.unknown}`);
    console.log('');
    console.log('  Top destinations:');
    Object.entries(stats.byDestination)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .forEach(([dest, count]) => console.log(`    ${dest}: ${count}`));
    console.log('');
}

function parseGender(raw) {
    if (!raw) return 'unknown';
    const g = raw.trim().toLowerCase();
    if (g === 'm' || g === 'male') return 'male';
    if (g === 'f' || g === 'female') return 'female';
    if (g === 'c m' || g === 'cm' || g === 'child m') return 'child_male';
    if (g === 'c f' || g === 'cf' || g === 'child f') return 'child_female';
    if (g === 'c' || g === 'child') return 'child_male'; // Default child gender
    return 'unknown';
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
