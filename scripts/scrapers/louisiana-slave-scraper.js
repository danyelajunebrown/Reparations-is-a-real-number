/**
 * Louisiana Slave Database Scraper
 *
 * Imports data from the Afro-Louisiana History and Genealogy Database
 * Source: https://www.ibiblio.org/laslave/
 * Created by: Dr. Gwendolyn Midlo Hall
 *
 * Contains ~100,000 enslaved individuals from Louisiana (1699-1820)
 * PRIMARY SOURCE DATA from courthouse records, French/Spanish/Texas archives
 *
 * Usage:
 *   node scripts/scrapers/louisiana-slave-scraper.js [--test] [--free]
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');
const { DBFFile } = require('dbffile');

// Configuration
const DATABASE_URL = process.env.DATABASE_URL;
const DATA_DIR = path.join(__dirname, '../../data/louisiana');
const BATCH_SIZE = 1000;

// Database connection
let sql = null;

// Statistics
const stats = {
    recordsProcessed: 0,
    enslavedInserted: 0,
    ownersInserted: 0,
    freeInserted: 0,
    skipped: 0,
    errors: 0,
    startTime: Date.now()
};

// Code mappings from Slave_DB_Codes.txt
const GENDER_CODES = { 1: 'female', 2: 'male', 9: null };

const RACE_CODES = {
    1: 'grif', 2: 'indian', 3: 'black', 4: 'mulatto',
    5: 'quadroon', 6: 'octoroon', 7: 'metis', 8: 'other', 9: null
};

const LOCATION_CODES = {
    1: 'St. Bernard', 2: 'Plaquemines', 3: 'Orleans', 4: 'Lafourche',
    5: 'Assumption', 6: 'St. Charles', 7: 'St. John the Baptist',
    8: 'St. James', 9: 'Ascension', 11: 'Iberville', 12: 'St. Martin',
    13: 'St. Mary', 14: 'St. Landry', 15: 'Pointe Coupee', 16: 'Avoyelles',
    17: 'West Baton Rouge', 20: 'Natchitoches', 21: 'Rapides',
    23: 'Catahoula', 24: 'Ouachita', 25: 'East Baton Rouge',
    26: 'Feliciana', 30: 'Mobile', 31: 'Pensacola', 32: 'Natchez'
};

const DOCTYPE_CODES = {
    1: 'estate_inventory', 2: 'estate_sale', 7: 'sale',
    8: 'criminal_litigation', 9: 'litigation', 10: 'mortgage',
    11: 'marriage_contract', 12: 'will', 13: 'seizure_for_debt',
    15: 'runaway_report', 22: 'census', 24: 'slave_testimony', 25: 'slave_trade'
};

const AFRICAN_ORIGINS = {
    101: 'Bamana', 102: 'Diola', 103: 'Manding', 104: 'Moor',
    105: 'Fulbe/Pular', 106: 'Wolof', 107: 'Serer', 111: 'Soninke',
    118: 'Mende', 120: 'Temne', 199: 'Guinea Coast',
    401: 'Aja/Fon/Arada', 408: 'Hausa', 409: 'Mina', 411: 'Nago/Yoruba',
    501: 'Igbo', 502: 'Ibibio/Moko', 551: 'Congo', 590: 'Angola',
    695: 'Mozambique', 701: 'Africa'
};

/**
 * Initialize database connection
 */
function initDatabase() {
    if (!DATABASE_URL) {
        console.log('⚠️  No DATABASE_URL - dry run mode');
        return null;
    }
    sql = neon(DATABASE_URL);
    return sql;
}

/**
 * Parse DBF file and return record count and file handle
 */
async function openDBF(filePath) {
    const dbf = await DBFFile.open(filePath);
    console.log(`   📊 DBF contains ${dbf.recordCount} records`);
    return dbf;
}

/**
 * Process an enslaved person record
 */
async function processEnslavedRecord(record) {
    if (!sql) {
        stats.skipped++;
        return null;
    }

    try {
        // NAME field: "9" or empty means unknown, skip those
        let name = record.NAME ? String(record.NAME).trim() : '';
        if (!name || name === '9' || name.length < 2) {
            stats.skipped++;
            return null;
        }

        // Parse fields - handle numeric codes
        const sexCode = typeof record.SEX === 'number' ? record.SEX : null;
        const gender = sexCode === 1 ? 'female' : sexCode === 2 ? 'male' : null;

        const raceCode = typeof record.RACE === 'number' ? record.RACE : null;
        const race = RACE_CODES[raceCode] || null;

        const age = typeof record.AGE === 'number' && record.AGE > 0 ? record.AGE : null;

        const locationCode = typeof record.LOCATION === 'number' ? record.LOCATION : null;
        const location = LOCATION_CODES[locationCode] || null;

        const docTypeCode = typeof record.DOCTYPE === 'number' ? record.DOCTYPE : null;
        const docType = DOCTYPE_CODES[docTypeCode] || null;

        const birthplCode = typeof record.BIRTHPL === 'number' ? record.BIRTHPL : null;
        const africanOrigin = AFRICAN_ORIGINS[birthplCode] || null;

        // Parse year from DOCDATE (format: YYYYMMDD)
        let year = record.YEAR || null;
        if (!year && record.DOCDATE) {
            const docStr = String(record.DOCDATE);
            if (docStr.length >= 4) {
                year = parseInt(docStr.substring(0, 4));
            }
        }

        // Calculate birth year estimate
        let birthYear = null;
        if (age && year) {
            birthYear = year - Math.round(age);
        }

        // Build source citation
        const sourceParts = ['Afro-Louisiana History and Genealogy Database'];
        if (record.NOTARY) sourceParts.push(`Notary: ${record.NOTARY}`);
        if (record.DOCNO) sourceParts.push(`Doc #${record.DOCNO}`);
        if (year) sourceParts.push(`Year: ${year}`);
        const sourceCitation = sourceParts.join(' | ');

        // Build notes with all available data
        const notesParts = [];
        if (africanOrigin) notesParts.push(`African origin: ${africanOrigin}`);
        if (race) notesParts.push(`Race: ${race}`);
        if (record.SKILLS) notesParts.push(`Skills: ${record.SKILLS}`);
        if (record.CHARACTER) notesParts.push(`Character: ${record.CHARACTER}`);
        if (record.SICK) notesParts.push(`Health: ${record.SICK}`);
        if (record.FAMILY) notesParts.push(`Family: ${record.FAMILY}`);
        if (record.BUYER) notesParts.push(`Buyer: ${record.BUYER} ${record.FIRST2 || ''}`);
        if (record.SELLER) notesParts.push(`Seller: ${record.SELLER} ${record.FIRST1 || ''}`);
        if (record.INVVALUE) notesParts.push(`Inventory value: ${record.INVVALUE}`);
        if (record.SALEVALUE) notesParts.push(`Sale value: ${record.SALEVALUE}`);
        if (record.SHIP) notesParts.push(`Ship: ${record.SHIP}`);
        if (record.CAPTAIN) notesParts.push(`Captain: ${record.CAPTAIN}`);
        if (record.ESTATE_OF) notesParts.push(`Estate of: ${record.ESTATE_OF}`);
        if (record.COMMENTS) notesParts.push(`Notes: ${record.COMMENTS.substring(0, 200)}`);

        // Insert into canonical_persons (PRIMARY SOURCE data)
        const result = await sql`
            INSERT INTO canonical_persons (
                canonical_name,
                first_name,
                sex,
                birth_year_estimate,
                person_type,
                confidence_score,
                verification_status,
                primary_state,
                primary_county,
                notes,
                created_by
            ) VALUES (
                ${name},
                ${name},
                ${gender},
                ${birthYear},
                'enslaved',
                0.95,
                'verified_scholarly',
                'Louisiana',
                ${location},
                ${notesParts.join(' | ')},
                'louisiana_import'
            )
            ON CONFLICT DO NOTHING
            RETURNING id
        `;

        if (result && result[0]?.id) {
            stats.enslavedInserted++;

            // Also insert buyer/seller as enslavers
            if (record.BUYER) {
                await insertOwner(record.BUYER, record.FIRST2, 'buyer', location, year);
            }
            if (record.SELLER) {
                await insertOwner(record.SELLER, record.FIRST1, 'seller', location, year);
            }
        } else {
            stats.skipped++;
        }

        return result?.[0]?.id;
    } catch (error) {
        stats.errors++;
        if (stats.errors < 10) {
            console.log(`   ⚠️ Insert error: ${error.message}`);
        }
        return null;
    }
}

/**
 * Insert an owner (buyer/seller) into canonical_persons
 */
async function insertOwner(lastName, firstName, role, location, year) {
    if (!lastName || !sql) return;

    try {
        const fullName = firstName ? `${firstName} ${lastName}` : lastName;

        await sql`
            INSERT INTO canonical_persons (
                canonical_name,
                first_name,
                last_name,
                person_type,
                primary_state,
                primary_county,
                confidence_score,
                verification_status,
                notes,
                created_by
            ) VALUES (
                ${fullName},
                ${firstName || null},
                ${lastName},
                'enslaver',
                'Louisiana',
                ${location},
                0.85,
                'verified_scholarly',
                ${`Role: ${role} | Year: ${year} | Source: Louisiana Slave Database`},
                'louisiana_import'
            )
            ON CONFLICT DO NOTHING
        `;

        stats.ownersInserted++;
    } catch (e) {
        // Ignore duplicate errors
    }
}

/**
 * Process a free person record
 */
async function processFreeRecord(record) {
    if (!sql) {
        stats.skipped++;
        return null;
    }

    try {
        const name = (record.NAME || '').trim();
        if (!name) {
            stats.skipped++;
            return null;
        }

        const gender = GENDER_CODES[record.SEX] || null;
        const location = LOCATION_CODES[record.LOCATION] || null;
        let year = record.YEAR || null;

        const result = await sql`
            INSERT INTO canonical_persons (
                canonical_name,
                sex,
                person_type,
                primary_state,
                primary_county,
                confidence_score,
                verification_status,
                notes,
                created_by
            ) VALUES (
                ${name},
                ${gender},
                'freedperson',
                'Louisiana',
                ${location},
                0.90,
                'verified_scholarly',
                ${`Year: ${year} | Source: Louisiana Free Database`},
                'louisiana_free_import'
            )
            ON CONFLICT DO NOTHING
            RETURNING id
        `;

        if (result && result[0]?.id) {
            stats.freeInserted++;
        }
        return result?.[0]?.id;
    } catch (error) {
        stats.errors++;
        return null;
    }
}

/**
 * Print statistics
 */
function printStats() {
    const elapsed = Math.round((Date.now() - stats.startTime) / 1000);
    console.log(`
📊 IMPORT STATISTICS
════════════════════════════════════════
Records processed:      ${stats.recordsProcessed.toLocaleString()}
Enslaved inserted:      ${stats.enslavedInserted.toLocaleString()}
Owners inserted:        ${stats.ownersInserted.toLocaleString()}
Free persons inserted:  ${stats.freeInserted.toLocaleString()}
Skipped (no name):      ${stats.skipped.toLocaleString()}
Errors:                 ${stats.errors}
Elapsed time:           ${Math.floor(elapsed / 60)}m ${elapsed % 60}s
════════════════════════════════════════
Target table: canonical_persons
`);
}

/**
 * Main function
 */
async function main() {
    console.log('══════════════════════════════════════════════════════════════');
    console.log('🏛️  LOUISIANA SLAVE DATABASE IMPORTER');
    console.log('══════════════════════════════════════════════════════════════');
    console.log('Source: Afro-Louisiana History and Genealogy Database');
    console.log('Creator: Dr. Gwendolyn Midlo Hall');
    console.log('Records: ~100,000 enslaved individuals (1699-1820)');
    console.log('Data Type: PRIMARY SOURCE (courthouse records)');
    console.log('══════════════════════════════════════════════════════════════\n');

    const args = process.argv.slice(2);
    const testMode = args.includes('--test');
    const freeOnly = args.includes('--free');

    initDatabase();

    // Check for DBF files
    const slaveDbf = path.join(DATA_DIR, 'SLAVE.DBF');
    const freeDbf = path.join(DATA_DIR, 'FREE.DBF');

    if (!freeOnly && fs.existsSync(slaveDbf)) {
        console.log('📂 Processing Slave Database...');
        const dbf = await openDBF(slaveDbf);

        const totalRecords = dbf.recordCount;
        const limit = testMode ? 100 : totalRecords;
        console.log(`   Processing ${limit.toLocaleString()} records${testMode ? ' (test mode)' : ''}...\n`);

        let processed = 0;
        while (processed < limit) {
            const batchSize = Math.min(BATCH_SIZE, limit - processed);
            const records = await dbf.readRecords(batchSize);

            for (const record of records) {
                await processEnslavedRecord(record);
                stats.recordsProcessed++;
                processed++;

                if (processed >= limit) break;
            }

            if (stats.recordsProcessed % 5000 === 0) {
                console.log(`   Progress: ${stats.recordsProcessed.toLocaleString()} / ${limit.toLocaleString()} (${stats.enslavedInserted} inserted)`);
            }
        }
    }

    if (fs.existsSync(freeDbf)) {
        console.log('\n📂 Processing Free Database...');
        const dbf = await openDBF(freeDbf);

        const totalRecords = dbf.recordCount;
        const limit = testMode ? 100 : totalRecords;
        console.log(`   Processing ${limit.toLocaleString()} records${testMode ? ' (test mode)' : ''}...\n`);

        let processed = 0;
        while (processed < limit) {
            const batchSize = Math.min(BATCH_SIZE, limit - processed);
            const records = await dbf.readRecords(batchSize);

            for (const record of records) {
                await processFreeRecord(record);
                stats.recordsProcessed++;
                processed++;

                if (processed >= limit) break;
            }

            if (stats.recordsProcessed % 1000 === 0) {
                console.log(`   Progress: ${stats.recordsProcessed.toLocaleString()}`);
            }
        }
    }

    console.log('\n✅ Import complete!');
    printStats();
}

// Run
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
