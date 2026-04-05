#!/usr/bin/env node
/**
 * SlaveVoyages Trans-Atlantic & Intra-American Import
 *
 * Imports voyage-level data including ship OWNERS and CAPTAINS —
 * the people who financed and operated the trans-Atlantic slave trade.
 *
 * Sources:
 *   Trans-Atlantic: doi:10.7910/DVN/DGIHX9 (36,080 voyages)
 *   Intra-American: doi:10.7910/DVN/QD3JSH (28,775 voyages)
 *
 * Key fields: OWNERA-P (up to 16 owners per voyage), CAPTAINA-C,
 *   SHIPNAME, embarkation/disembarkation ports, dates, enslaved counts
 *
 * Usage:
 *   node scripts/import-slavevoyages.js
 *   node scripts/import-slavevoyages.js --dry-run
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL;
const DRY_RUN = process.argv.includes('--dry-run');

const TRANSATLANTIC_PATH = path.resolve(__dirname, '../storage/population-data/slavevoyages-transatlantic-2023.tab');
const INTRAAMERICAN_PATH = path.resolve(__dirname, '../storage/population-data/slavevoyages-intra-american-2023.tab');

let sql = null;

const stats = {
    voyages: 0,
    owners_extracted: 0,
    captains_extracted: 0,
    owners_new: 0,
    owners_existing: 0,
    errors: 0,
    startTime: Date.now()
};

function parseTSV(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    const headers = lines[0].split('\t');
    return lines.slice(1).map(line => {
        const values = line.split('\t');
        const obj = {};
        headers.forEach((h, i) => { obj[h.trim()] = (values[i] || '').trim(); });
        return obj;
    });
}

async function importVoyages(filePath, tradeType) {
    const label = tradeType === 'transatlantic' ? 'Trans-Atlantic' : 'Intra-American';
    console.log(`\n── ${label} Slave Trade Database ──`);

    if (!fs.existsSync(filePath)) {
        console.log(`  File not found: ${filePath}`);
        return;
    }

    const records = parseTSV(filePath);
    console.log(`  Parsed ${records.length} voyages`);

    const ownersSeen = new Set();
    const captainsSeen = new Set();

    for (let i = 0; i < records.length; i++) {
        const r = records[i];
        const voyageId = r['VOYAGEID'] || '';
        const shipName = r['SHIPNAME'] || '';
        const year = parseInt(r['YEARDEP'] || r['YEARAM'] || r['YEAR5']) || null;

        // Extract all owners (OWNERA through OWNERP)
        const ownerKeys = ['OWNERA','OWNERB','OWNERC','OWNERD','OWNERE','OWNERF',
                          'OWNERG','OWNERH','OWNERI','OWNERJ','OWNERK','OWNERL',
                          'OWNERM','OWNERN','OWNERO','OWNERP'];
        for (const key of ownerKeys) {
            const name = (r[key] || '').trim();
            if (!name || name.length < 3) continue;

            stats.owners_extracted++;
            const nameKey = name.toLowerCase();

            if (!ownersSeen.has(nameKey) && !DRY_RUN) {
                ownersSeen.add(nameKey);

                const existing = await sql`
                    SELECT lead_id FROM unconfirmed_persons
                    WHERE LOWER(full_name) = LOWER(${name})
                    AND extraction_method = 'slavevoyages_import'
                    LIMIT 1
                `;

                if (existing.length === 0) {
                    try {
                        await sql`
                            INSERT INTO unconfirmed_persons (
                                full_name, person_type, locations,
                                source_url, source_page_title, extraction_method,
                                context_text, confidence_score, source_type,
                                relationships
                            ) VALUES (
                                ${name},
                                ${'enslaver'},
                                ${['Trans-Atlantic']},
                                ${'https://www.slavevoyages.org/'},
                                ${'SlaveVoyages ' + label + ' Slave Trade Database'},
                                ${'slavevoyages_import'},
                                ${'Slave ship owner. Ship: ' + shipName + '. Voyage #' + voyageId + (year ? '. Year: ' + year : '') + '. ' + label + ' slave trade.'},
                                ${0.90},
                                ${'academic_database'},
                                ${JSON.stringify({
                                    role: 'ship_owner',
                                    trade_type: tradeType,
                                    voyage_id: voyageId,
                                    ship: shipName,
                                    year,
                                    citation: 'SlaveVoyages.org, ' + label + ' Slave Trade Database. doi:10.7910/DVN/' + (tradeType === 'transatlantic' ? 'DGIHX9' : 'QD3JSH')
                                })}
                            )
                        `;
                        stats.owners_new++;
                    } catch (err) {
                        if (stats.errors < 5) console.error(`  Error: ${err.message.substring(0, 80)}`);
                        stats.errors++;
                    }
                } else {
                    stats.owners_existing++;
                }
            }
        }

        // Extract captains (CAPTAINA through CAPTAINC)
        for (const key of ['CAPTAINA', 'CAPTAINB', 'CAPTAINC']) {
            const name = (r[key] || '').trim();
            if (!name || name.length < 3) continue;

            stats.captains_extracted++;
            const nameKey = name.toLowerCase();

            if (!captainsSeen.has(nameKey) && !DRY_RUN) {
                captainsSeen.add(nameKey);

                const existing = await sql`
                    SELECT lead_id FROM unconfirmed_persons
                    WHERE LOWER(full_name) = LOWER(${name})
                    AND extraction_method = 'slavevoyages_import'
                    LIMIT 1
                `;

                if (existing.length === 0) {
                    try {
                        await sql`
                            INSERT INTO unconfirmed_persons (
                                full_name, person_type, locations,
                                source_url, source_page_title, extraction_method,
                                context_text, confidence_score, source_type,
                                relationships
                            ) VALUES (
                                ${name},
                                ${'enslaver'},
                                ${['Trans-Atlantic']},
                                ${'https://www.slavevoyages.org/'},
                                ${'SlaveVoyages ' + label + ' Slave Trade Database'},
                                ${'slavevoyages_import'},
                                ${'Slave ship captain. Ship: ' + shipName + '. Voyage #' + voyageId + (year ? '. Year: ' + year : '') + '. ' + label + ' slave trade.'},
                                ${0.90},
                                ${'academic_database'},
                                ${JSON.stringify({
                                    role: 'ship_captain',
                                    trade_type: tradeType,
                                    voyage_id: voyageId,
                                    ship: shipName,
                                    year,
                                    citation: 'SlaveVoyages.org, ' + label + ' Slave Trade Database'
                                })}
                            )
                        `;
                        stats.owners_new++;
                    } catch (err) {
                        stats.errors++;
                    }
                }
            }
        }

        stats.voyages++;
        if ((i + 1) % 5000 === 0) {
            console.log(`  Progress: ${i + 1}/${records.length} — ${stats.owners_new} new owners/captains`);
        }
    }
}

async function main() {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  SLAVEVOYAGES IMPORT — SHIP OWNERS & CAPTAINS`);
    console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
    console.log(`${'═'.repeat(60)}`);

    sql = neon(DATABASE_URL);

    const existing = await sql`
        SELECT COUNT(*) as cnt FROM unconfirmed_persons
        WHERE extraction_method = 'slavevoyages_import'
    `;
    if (parseInt(existing[0].cnt) > 0) {
        console.log(`\n  Already imported: ${existing[0].cnt} records. Delete first to re-import.`);
        process.exit(0);
    }

    await importVoyages(TRANSATLANTIC_PATH, 'transatlantic');
    await importVoyages(INTRAAMERICAN_PATH, 'intraamerican');

    // Register sources
    if (!DRY_RUN) {
        for (const src of [
            { name: 'SlaveVoyages Trans-Atlantic Slave Trade Database (2023)', doi: 'DGIHX9', count: '36,080 voyages' },
            { name: 'SlaveVoyages Intra-American Slave Trade Database (2023)', doi: 'QD3JSH', count: '28,775 voyages' }
        ]) {
            const exists = await sql`SELECT id FROM person_documents WHERE name_as_appears = ${src.name} LIMIT 1`;
            if (exists.length === 0) {
                await sql`
                    INSERT INTO person_documents (
                        name_as_appears, source_url, source_type,
                        collection_name, document_type, page_reference,
                        person_type, extraction_confidence, created_by
                    ) VALUES (
                        ${src.name},
                        ${'https://doi.org/10.7910/DVN/' + src.doi},
                        ${'academic_database'},
                        ${'population-records'},
                        ${'slave_trade_voyages'},
                        ${src.count},
                        ${'enslaver'},
                        ${0.90},
                        ${'import-slavevoyages.js'}
                    )
                `;
            }
        }
    }

    const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  IMPORT COMPLETE`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`  Voyages processed:   ${stats.voyages.toLocaleString()}`);
    console.log(`  Owner names found:   ${stats.owners_extracted.toLocaleString()}`);
    console.log(`  Captain names found: ${stats.captains_extracted.toLocaleString()}`);
    console.log(`  New records stored:  ${stats.owners_new.toLocaleString()}`);
    console.log(`  Already existed:     ${stats.owners_existing.toLocaleString()}`);
    console.log(`  Errors:              ${stats.errors}`);
    console.log(`  Elapsed:             ${elapsed}s`);
    console.log('');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
