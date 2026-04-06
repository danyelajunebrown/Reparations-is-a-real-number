#!/usr/bin/env node
/**
 * Book of Negroes — Scrape Former Enslaver Names from LAC
 *
 * The Nova Scotia CSV has names but NOT former owners.
 * Library and Archives Canada detail pages have "Name of Owner" field.
 * URL pattern: item.aspx?IdNumber=1 through ~2831
 *
 * Extracts: name, age, gender, race, legal status, owner name,
 *   destination, ship, date of inspection
 *
 * Updates existing unconfirmed_persons (book_of_negroes_import) with
 * enslaver relationship data, and creates canonical_persons for enslavers.
 *
 * Source: https://www.bac-lac.gc.ca/eng/discover/military-heritage/loyalists/book-of-negroes/
 *
 * Usage:
 *   node scripts/scrape-book-of-negroes-owners.js
 *   node scripts/scrape-book-of-negroes-owners.js --dry-run
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { neon } = require('@neondatabase/serverless');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL;
const DRY_RUN = process.argv.includes('--dry-run');
const BASE_URL = 'https://www.bac-lac.gc.ca/eng/discover/military-heritage/loyalists/book-of-negroes/Pages/item.aspx';
const MAX_ID = 2831;

let sql = null;

const stats = {
    scraped: 0,
    withOwner: 0,
    ownersCreated: 0,
    ownersExisting: 0,
    updated: 0,
    errors: 0,
    startTime: Date.now()
};

function extractField(html, fieldName) {
    const regex = new RegExp(fieldName + ':</dt>\\s*<dd[^>]*>([^<]*)</dd>', 'i');
    const match = html.match(regex);
    return match ? match[1].trim() : null;
}

async function scrapeRecord(id) {
    try {
        const res = await axios.get(`${BASE_URL}?IdNumber=${id}`, {
            timeout: 15000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Reparations Research Project)' }
        });

        const html = res.data;

        const record = {
            id,
            surname: extractField(html, 'Surname'),
            givenName: extractField(html, 'Given Name\\(s\\)'),
            age: extractField(html, 'Age'),
            gender: extractField(html, 'Gender'),
            race: extractField(html, 'Race'),
            militaryService: extractField(html, 'Military Service'),
            legalStatus: extractField(html, 'Current Legal Status'),
            certificateOfFreedom: extractField(html, 'Certificate of Freedom'),
            ownerName: extractField(html, 'Name of Owner'),
            destination: extractField(html, 'Destination'),
            shipName: extractField(html, 'Name of Ship'),
            inspectionDate: extractField(html, 'Date of Inspection'),
            documentPage: extractField(html, 'Document / Page Number')
        };

        return record;
    } catch (err) {
        return null;
    }
}

async function main() {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  BOOK OF NEGROES — SCRAPING FORMER ENSLAVER NAMES`);
    console.log(`  Source: Library and Archives Canada`);
    console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
    console.log(`${'═'.repeat(60)}\n`);

    sql = neon(DATABASE_URL);

    const ownersSeen = new Set();
    const allRecords = [];

    for (let id = 1; id <= MAX_ID; id++) {
        const record = await scrapeRecord(id);
        if (!record) {
            stats.errors++;
            continue;
        }

        stats.scraped++;
        const fullName = [record.givenName, record.surname].filter(Boolean).join(' ');

        if (record.ownerName && record.ownerName !== 'Unknown' && record.ownerName.length > 2) {
            stats.withOwner++;

            // Create canonical_persons entry for the enslaver
            const ownerKey = record.ownerName.toLowerCase();
            if (!ownersSeen.has(ownerKey) && !DRY_RUN) {
                ownersSeen.add(ownerKey);

                // Parse "LASTNAME, Firstname" format
                const ownerParts = record.ownerName.split(',').map(s => s.trim());
                const ownerLast = ownerParts[0] || '';
                const ownerFirst = ownerParts[1] || '';

                const existing = await sql`
                    SELECT id FROM canonical_persons
                    WHERE LOWER(canonical_name) = LOWER(${record.ownerName})
                    AND (notes ILIKE '%book of negroes%' OR notes ILIKE '%1783%')
                    LIMIT 1
                `;

                if (existing.length === 0) {
                    await sql`
                        INSERT INTO canonical_persons (
                            canonical_name, first_name, last_name,
                            person_type, confidence_score, verification_status,
                            notes, created_by
                        ) VALUES (
                            ${record.ownerName},
                            ${ownerFirst}, ${ownerLast},
                            'enslaver', 0.90, 'unverified',
                            ${'Slaveholder documented in Book of Negroes (1783). Enslaved person: ' + fullName + '. LAC Carleton Papers.'},
                            'scrape-book-of-negroes-owners.js'
                        )
                    `;
                    stats.ownersCreated++;
                } else {
                    stats.ownersExisting++;
                }
            }

            // Update the existing unconfirmed_persons record with enslaver info
            if (!DRY_RUN && fullName.length > 2) {
                const updated = await sql`
                    UPDATE unconfirmed_persons
                    SET relationships = jsonb_set(
                        COALESCE(relationships, '{}'::jsonb),
                        '{enslaved_by}',
                        ${JSON.stringify(record.ownerName)}::jsonb
                    ),
                    context_text = context_text || ${'. Former enslaver: ' + record.ownerName + '. Legal status: ' + (record.legalStatus || 'unknown') + '. LAC record #' + id}
                    WHERE extraction_method = 'book_of_negroes_import'
                    AND full_name = ${fullName}
                    AND (relationships->>'enslaved_by') IS NULL
                    RETURNING lead_id
                `;
                stats.updated += updated.length;
            }
        }

        allRecords.push(record);

        if (id % 100 === 0) {
            console.log(`  Progress: ${id}/${MAX_ID} — ${stats.withOwner} with owner, ${stats.ownersCreated} enslavers created`);
        }

        // Rate limit — be polite to LAC servers
        await new Promise(r => setTimeout(r, 200));
    }

    // Save full scrape to CSV for reference
    if (allRecords.length > 0) {
        const csvPath = path.resolve(__dirname, '../storage/population-data/book-of-negroes-full-lac.json');
        fs.writeFileSync(csvPath, JSON.stringify(allRecords, null, 2));
        console.log(`\n  Saved ${allRecords.length} records to ${csvPath}`);
    }

    const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  SCRAPE COMPLETE`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`  Records scraped:      ${stats.scraped}`);
    console.log(`  With owner name:      ${stats.withOwner}`);
    console.log(`  Enslavers created:    ${stats.ownersCreated}`);
    console.log(`  Enslavers existing:   ${stats.ownersExisting}`);
    console.log(`  Persons updated:      ${stats.updated}`);
    console.log(`  Errors:               ${stats.errors}`);
    console.log(`  Elapsed:              ${elapsed}s`);
    console.log('');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
