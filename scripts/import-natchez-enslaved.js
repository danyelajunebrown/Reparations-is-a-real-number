#!/usr/bin/env node
/**
 * Historic Natchez Enslaved Mississippians Import
 *
 * Imports ~50,700 records from probate, sale, and legal records documenting
 * enslaved people in the Natchez District, Mississippi (1801-1865).
 *
 * Source: Harvard Dataverse / Journal of Slavery and Data Preservation
 * DOI: 10.7910/DVN/LSZJDQ
 * CSV: https://dataverse.harvard.edu/api/access/datafile/12080863
 *
 * Fields: enslaved person name, gender, age, race, occupation, skills,
 *   owner names, buyer names, plantation, county, amounts, document type
 *
 * Usage:
 *   node scripts/import-natchez-enslaved.js
 *   node scripts/import-natchez-enslaved.js --dry-run
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { neon } = require('@neondatabase/serverless');
const { parse } = require('csv-parse/sync');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL;
const DRY_RUN = process.argv.includes('--dry-run');
const CSV_PATH = path.resolve(__dirname, '../storage/population-data/natchez-enslaved-mississippians.csv');

const SOURCE_URL = 'https://doi.org/10.7910/DVN/LSZJDQ';
const SOURCE_CITATION = 'Historic Natchez Enslaved Mississippians. Harvard Dataverse / Journal of Slavery and Data Preservation. doi:10.7910/DVN/LSZJDQ';

let sql = null;

const stats = {
    total: 0,
    enslaved_imported: 0,
    owners_imported: 0,
    owners_existing: 0,
    skipped: 0,
    errors: 0,
    startTime: Date.now()
};

async function main() {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  NATCHEZ ENSLAVED MISSISSIPPIANS IMPORT`);
    console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
    console.log(`${'═'.repeat(60)}\n`);

    sql = neon(DATABASE_URL);

    // Check for existing imports
    const existing = await sql`
        SELECT COUNT(*) as cnt FROM unconfirmed_persons
        WHERE extraction_method = 'natchez_enslaved_import'
    `;
    if (parseInt(existing[0].cnt) > 0) {
        console.log(`Already imported: ${existing[0].cnt} records. Delete first to re-import.`);
        process.exit(0);
    }

    const csvContent = fs.readFileSync(CSV_PATH, 'utf-8');
    const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
        relax_quotes: true,
        skip_records_with_error: true
    });

    console.log(`  Parsed ${records.length} records\n`);
    stats.total = records.length;

    const ownersSeen = new Set();

    for (let i = 0; i < records.length; i++) {
        const r = records[i];

        const slavFirstName = (r['slav_first_name'] || '').trim();
        const slavLastName = (r['slav_last_name'] || '').trim();
        const slavName = [slavFirstName, slavLastName].filter(Boolean).join(' ');

        if (!slavName || slavName.length < 2) {
            stats.skipped++;
            continue;
        }

        const ownerFirst = (r['owner_first_name'] || '').trim();
        const ownerLast = (r['owner_last_name'] || '').trim();
        const ownerName = [ownerFirst, ownerLast].filter(Boolean).join(' ');

        const gender = (r['gender'] || '').trim().toLowerCase();
        const age = parseInt(r['age']) || null;
        const race = (r['color_or_race'] || '').trim();
        const county = (r['county'] || '').trim();
        const state = (r['state'] || 'MS').trim();
        const year = parseInt(r['recorded_year']) || null;
        const docType = (r['doc_type'] || '').trim();
        const plantation = (r['Plantation'] || '').trim();
        const occupation = (r['slav_occupation'] || '').trim();
        const skills = (r['slav_skills'] || '').trim();
        const amount = (r['amount'] || '').trim();

        const location = county && state ? `${county}, Mississippi` : 'Mississippi';

        const contextText = [
            `Natchez District probate/legal record`,
            year ? `Year: ${year}` : null,
            docType ? `Document: ${docType}` : null,
            ownerName ? `Owner: ${ownerName}` : null,
            plantation ? `Plantation: ${plantation}` : null,
            age ? `Age: ${age}` : null,
            race ? `Race: ${race}` : null,
            occupation ? `Occupation: ${occupation}` : null,
            skills ? `Skills: ${skills}` : null,
            amount ? `Value: $${amount}` : null
        ].filter(Boolean).join('. ');

        if (!DRY_RUN) {
            try {
                // Store enslaved person
                await sql`
                    INSERT INTO unconfirmed_persons (
                        full_name, person_type, gender, locations,
                        source_url, source_page_title, extraction_method,
                        context_text, confidence_score, source_type,
                        relationships
                    ) VALUES (
                        ${slavName},
                        ${'enslaved'},
                        ${gender === 'm' || gender === 'male' ? 'male' : gender === 'f' || gender === 'female' ? 'female' : null},
                        ${[location]},
                        ${SOURCE_URL},
                        ${'Historic Natchez Enslaved Mississippians'},
                        ${'natchez_enslaved_import'},
                        ${contextText},
                        ${0.90},
                        ${'probate_record'},
                        ${JSON.stringify({
                            enslaved_by: ownerName || null,
                            year,
                            document_type: docType || null,
                            age,
                            race: race || null,
                            occupation: occupation || null,
                            skills: skills || null,
                            plantation: plantation || null,
                            amount: amount || null,
                            county: county || null,
                            citation: SOURCE_CITATION
                        })}
                    )
                `;
                stats.enslaved_imported++;

                // Store owner in canonical_persons if not seen yet
                if (ownerName && ownerName.length > 3 && !ownersSeen.has(ownerName.toLowerCase())) {
                    ownersSeen.add(ownerName.toLowerCase());

                    const existingOwner = await sql`
                        SELECT id FROM canonical_persons
                        WHERE LOWER(canonical_name) = LOWER(${ownerName})
                        AND (primary_state ILIKE '%Mississippi%' OR primary_state ILIKE '%MS%' OR primary_state IS NULL)
                        LIMIT 1
                    `;

                    if (existingOwner.length === 0) {
                        await sql`
                            INSERT INTO canonical_persons (
                                canonical_name, first_name, last_name,
                                person_type, primary_state, primary_county,
                                confidence_score, verification_status,
                                notes, created_by
                            ) VALUES (
                                ${ownerName},
                                ${ownerFirst},
                                ${ownerLast},
                                ${'enslaver'},
                                ${'Mississippi'},
                                ${county || null},
                                ${0.90},
                                ${'unverified'},
                                ${'Natchez District probate records. ' + SOURCE_CITATION},
                                ${'import-natchez-enslaved.js'}
                            )
                        `;
                        stats.owners_imported++;
                    } else {
                        stats.owners_existing++;
                    }
                }
            } catch (err) {
                if (stats.errors < 5) console.error(`  Error at row ${i}: ${err.message.substring(0, 100)}`);
                stats.errors++;
            }
        } else {
            stats.enslaved_imported++;
        }

        if ((i + 1) % 5000 === 0) {
            console.log(`  Progress: ${i + 1}/${records.length} — ${stats.enslaved_imported} enslaved, ${stats.owners_imported} owners`);
        }
    }

    // Register source document
    if (!DRY_RUN) {
        const docExists = await sql`
            SELECT id FROM person_documents
            WHERE name_as_appears = 'Historic Natchez Enslaved Mississippians'
            LIMIT 1
        `;
        if (docExists.length === 0) {
            await sql`
                INSERT INTO person_documents (
                    name_as_appears, source_url, source_type,
                    collection_name, document_type, page_reference,
                    person_type, extraction_confidence, created_by
                ) VALUES (
                    ${'Historic Natchez Enslaved Mississippians'},
                    ${SOURCE_URL},
                    ${'probate_record'},
                    ${'population-records'},
                    ${'probate_enslaved_records'},
                    ${'50,702 entries, Natchez District MS, 1801-1865'},
                    ${'enslaved'},
                    ${0.90},
                    ${'import-natchez-enslaved.js'}
                )
            `;
            console.log('\n  Registered source document');
        }
    }

    const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  IMPORT COMPLETE`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`  Total records:     ${stats.total.toLocaleString()}`);
    console.log(`  Enslaved imported: ${stats.enslaved_imported.toLocaleString()}`);
    console.log(`  Owners created:    ${stats.owners_imported.toLocaleString()}`);
    console.log(`  Owners existing:   ${stats.owners_existing.toLocaleString()}`);
    console.log(`  Skipped (no name): ${stats.skipped.toLocaleString()}`);
    console.log(`  Errors:            ${stats.errors}`);
    console.log(`  Elapsed:           ${elapsed}s`);
    console.log('');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
