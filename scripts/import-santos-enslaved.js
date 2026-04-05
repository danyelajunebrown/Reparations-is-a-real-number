#!/usr/bin/env node
/**
 * Santos Enslaved and Enslaver Dataset Import (Brazil)
 *
 * Imports ~42,800 records documenting enslaved people and enslavers
 * in Santos, Brazil — the largest slave economy in the Americas.
 *
 * Source: Harvard Dataverse / Journal of Slavery and Data Preservation
 * DOI: 10.7910/DVN/GBDHNC
 *
 * Fields: enslaved person name, sex, age, race/origin, occupation,
 *   enslaver name, gender, age, race, marital status, address
 *
 * Usage:
 *   node scripts/import-santos-enslaved.js
 *   node scripts/import-santos-enslaved.js --dry-run
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { neon } = require('@neondatabase/serverless');
const { parse } = require('csv-parse/sync');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL;
const DRY_RUN = process.argv.includes('--dry-run');
const CSV_PATH = path.resolve(__dirname, '../storage/population-data/santos-enslaved-enslaver.csv');

const SOURCE_URL = 'https://doi.org/10.7910/DVN/GBDHNC';
const SOURCE_CITATION = 'Santos Enslaved and Enslaver Dataset. Harvard Dataverse / JSDP. doi:10.7910/DVN/GBDHNC';

let sql = null;

const stats = {
    total: 0,
    enslaved_imported: 0,
    owners_imported: 0,
    skipped: 0,
    errors: 0,
    startTime: Date.now()
};

async function main() {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  SANTOS ENSLAVED & ENSLAVER IMPORT (BRAZIL)`);
    console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
    console.log(`${'═'.repeat(60)}\n`);

    sql = neon(DATABASE_URL);

    const existing = await sql`
        SELECT COUNT(*) as cnt FROM unconfirmed_persons
        WHERE extraction_method = 'santos_enslaved_import'
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
        skip_records_with_error: true,
        bom: true
    });

    console.log(`  Parsed ${records.length} records\n`);
    stats.total = records.length;

    const ownersSeen = new Set();

    for (let i = 0; i < records.length; i++) {
        const r = records[i];

        const enslavedName = (r['Name of Enslaved (Nome2)'] || '').trim();
        const enslaverName = (r['Name of non-enslaved (Nome)'] || '').trim();
        const year = parseInt(r['Year (Ano)']) || null;
        const enslavedSex = (r['Sex of Enslaved'] || '').trim().toLowerCase();
        const enslavedAge = parseInt(r['Age (Idade)']) || null; // Note: might get enslaver age
        const enslavedRace = (r['Race and origin (Raça e origem)'] || '').trim();
        const enslavedOrigin = (r['Origin 2 (Origem2)'] || '').trim();
        const occupation = (r['Occupacion (Ocupação)'] || '').trim();
        const street = (r['Street (rua)'] || '').trim();

        if (!enslavedName || enslavedName.length < 2) {
            stats.skipped++;
            continue;
        }

        const contextText = [
            'Santos, Brazil — enslaved person record',
            year ? `Year: ${year}` : null,
            enslaverName ? `Enslaver: ${enslaverName}` : null,
            enslavedRace ? `Race/origin: ${enslavedRace}` : null,
            enslavedOrigin ? `African origin: ${enslavedOrigin}` : null,
            occupation ? `Occupation: ${occupation}` : null,
            street ? `Location: ${street}, Santos` : null
        ].filter(Boolean).join('. ');

        if (!DRY_RUN) {
            try {
                await sql`
                    INSERT INTO unconfirmed_persons (
                        full_name, person_type, gender, locations,
                        source_url, source_page_title, extraction_method,
                        context_text, confidence_score, source_type,
                        relationships
                    ) VALUES (
                        ${enslavedName},
                        ${'enslaved'},
                        ${enslavedSex === 'm' || enslavedSex === 'masculino' ? 'male' : enslavedSex === 'f' || enslavedSex === 'feminino' ? 'female' : null},
                        ${['Santos, São Paulo, Brazil']},
                        ${SOURCE_URL},
                        ${'Santos Enslaved and Enslaver Dataset (Brazil)'},
                        ${'santos_enslaved_import'},
                        ${contextText},
                        ${0.85},
                        ${'census_record'},
                        ${JSON.stringify({
                            enslaved_by: enslaverName || null,
                            year,
                            race: enslavedRace || null,
                            african_origin: enslavedOrigin || null,
                            occupation: occupation || null,
                            jurisdiction: 'Brazil',
                            city: 'Santos',
                            state: 'São Paulo',
                            citation: SOURCE_CITATION
                        })}
                    )
                `;
                stats.enslaved_imported++;

                // Store enslaver
                if (enslaverName && enslaverName.length > 3 && !ownersSeen.has(enslaverName.toLowerCase())) {
                    ownersSeen.add(enslaverName.toLowerCase());
                    await sql`
                        INSERT INTO unconfirmed_persons (
                            full_name, person_type, locations,
                            source_url, source_page_title, extraction_method,
                            context_text, confidence_score, source_type
                        ) VALUES (
                            ${enslaverName},
                            ${'enslaver'},
                            ${['Santos, São Paulo, Brazil']},
                            ${SOURCE_URL},
                            ${'Santos Enslaved and Enslaver Dataset (Brazil)'},
                            ${'santos_enslaved_import'},
                            ${'Brazilian enslaver, Santos. ' + SOURCE_CITATION},
                            ${0.85},
                            ${'census_record'}
                        )
                    `;
                    stats.owners_imported++;
                }
            } catch (err) {
                if (stats.errors < 5) console.error(`  Error row ${i}: ${err.message.substring(0, 100)}`);
                stats.errors++;
            }
        } else {
            stats.enslaved_imported++;
        }

        if ((i + 1) % 5000 === 0) {
            console.log(`  Progress: ${i + 1}/${records.length} — ${stats.enslaved_imported} enslaved, ${stats.owners_imported} enslavers`);
        }
    }

    // Register source
    if (!DRY_RUN) {
        const docExists = await sql`
            SELECT id FROM person_documents
            WHERE name_as_appears = 'Santos Enslaved and Enslaver Dataset (Brazil)'
            LIMIT 1
        `;
        if (docExists.length === 0) {
            await sql`
                INSERT INTO person_documents (
                    name_as_appears, source_url, source_type,
                    collection_name, document_type, page_reference,
                    person_type, extraction_confidence, created_by
                ) VALUES (
                    ${'Santos Enslaved and Enslaver Dataset (Brazil)'},
                    ${SOURCE_URL},
                    ${'census_record'},
                    ${'population-records'},
                    ${'enslaved_census_brazil'},
                    ${'42,795 entries, Santos, São Paulo, Brazil'},
                    ${'enslaved'},
                    ${0.85},
                    ${'import-santos-enslaved.js'}
                )
            `;
            console.log('\n  Registered source document');
        }
    }

    const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  IMPORT COMPLETE`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`  Total:             ${stats.total.toLocaleString()}`);
    console.log(`  Enslaved imported: ${stats.enslaved_imported.toLocaleString()}`);
    console.log(`  Enslavers:         ${stats.owners_imported.toLocaleString()}`);
    console.log(`  Skipped:           ${stats.skipped.toLocaleString()}`);
    console.log(`  Errors:            ${stats.errors}`);
    console.log(`  Elapsed:           ${elapsed}s`);
    console.log('');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
