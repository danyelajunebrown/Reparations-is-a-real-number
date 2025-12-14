#!/usr/bin/env node
/**
 * Louisiana Slave Database Scraper
 *
 * Processes the Afro-Louisiana History and Genealogy Database from ibiblio.org
 * Created by Dr. Gwendolyn Midlo Hall
 *
 * Data source: https://www.ibiblio.org/laslave/downloads/
 * - Slave.zip (18.03 MB) - ~100,000+ records of enslaved persons
 * - Free.zip (1.28 MB) - Records of free Black persons
 *
 * This scraper:
 * 1. Downloads ZIP files from ibiblio.org
 * 2. Extracts DBF (dBase) files
 * 3. Parses code translation files for human-readable values
 * 4. Imports records into unconfirmed_persons with rich metadata
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const AdmZip = require('adm-zip');
const { DBFFile } = require('dbffile');

// Database connection
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable required');
    process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

// Configuration
const DOWNLOAD_DIR = path.join(__dirname, '../../temp/la-slave-db');
const BASE_URL = 'https://www.ibiblio.org/laslave/downloads/';

// Code lookup tables (parsed from TXT files)
const CODE_LOOKUPS = {
    BIRTHPL: {},
    SKILLCAT: {},
    SICKCAT: {},
    CHARCAT: {},
    RACE: {},
    SEX: {},
    DOCTYPE: {},
    LOCATION: {},
    MEANS: {},      // Manumission means (Free DB)
    FREERREL: {}    // Freer relationship (Free DB)
};

// Hard-coded essential codes (from the TXT files)
const BIRTHPLACE_CODES = {
    // North American
    4: 'Arkansas', 5: 'Massachusetts', 6: 'Mississippi', 11: 'Louisiana Creole',
    12: 'New Orleans Creole', 16: 'Alabama', 17: 'Florida', 18: 'Georgia',
    21: 'Maryland', 26: 'Virginia', 27: 'Carolinas',
    // Caribbean
    31: 'Bermuda', 33: 'Cuba', 34: 'Santo Domingo', 35: 'St Domingue (Haiti)',
    36: 'Guadeloupe', 37: 'Martinique', 38: 'Jamaica',
    // West Africa - Senegambia
    101: 'Bamana', 102: 'Diola', 103: 'Manding', 104: 'Moor', 105: 'Fulbe',
    106: 'Wolof', 107: 'Serer', 108: 'Soninke',
    // Guinea Coast
    199: 'Guinea Coast',
    // Gold Coast/Akan
    303: 'Fanti', 398: 'Gold Coast', 399: 'Coromanti',
    // Bight of Benin
    401: 'Aja/Fon/Arada', 406: 'Hausa', 410: 'Mina', 411: 'Nago/Yoruba',
    // Bight of Biafra
    501: 'Igbo', 502: 'Ibibio',
    // West-Central Africa
    551: 'Congo', 590: 'Angola', 591: 'Gabon', 695: 'Mozambique',
    // Unidentified
    699: 'Nation Unidentified', 701: 'Africa', 703: 'Brut (African-born)', 704: 'Imputed African'
};

const SKILL_CODES = {
    1: 'Commander/Driver', 2: 'Field Laborer', 6: 'Plowman', 11: 'Gardener',
    20: 'Wetnurse', 21: 'Domestic Servant', 22: 'Cook', 23: 'Laundry',
    25: 'Personal Servant', 27: 'Childcare', 30: 'Watchman',
    31: 'Fisherman', 41: 'Hunter', 44: 'Shoemaker', 45: 'Butcher',
    46: 'Cowboy', 63: 'Sailor', 64: 'Rower', 67: 'Ship\'s Pilot',
    75: 'Sugar Worker', 76: 'Sugar Refiner', 77: 'Miner',
    101: 'Carpenter', 102: 'Mason', 105: 'Brick Maker', 108: 'Cooper',
    109: 'Cabinet Maker', 110: 'Blacksmith', 117: 'Barber',
    121: 'Tailor', 122: 'Seamstress', 125: 'Baker', 138: 'Musician',
    153: 'Surgeon', 154: 'Curer/Healer', 155: 'Midwife', 156: 'Nurse'
};

const RACE_CODES = {
    1: 'Grif', 2: 'Indian', 3: 'Black', 4: 'Mulatto',
    5: 'Quadroon', 6: 'Octoroon', 7: 'Metis', 8: 'Mulatto grif/rouge', 9: 'Missing'
};

const SEX_CODES = { 1: 'Female', 2: 'Male', 9: 'Unidentified' };

const DOCTYPE_CODES = {
    1: 'Estate Inventory', 2: 'Estate Sale', 7: 'Sale without Probate',
    8: 'Criminal Litigation', 9: 'Other Litigation', 10: 'Mortgage',
    11: 'Marriage Contract', 12: 'Will', 13: 'Seizure for Debt',
    14: 'Confiscation', 15: 'Runaway Report', 22: 'List/Census',
    24: 'Slave Testimony', 25: 'Atlantic Slave Trade'
};

const LOCATION_CODES = {
    1: 'Ascension', 2: 'Assumption', 3: 'Attakapas', 4: 'Avoyelles',
    5: 'Baton Rouge', 6: 'Concordia', 7: 'Feliciana', 8: 'Iberville',
    9: 'Jefferson', 10: 'Lafourche', 11: 'Natchitoches', 12: 'New Orleans',
    13: 'Opelousas', 14: 'Orleans', 15: 'Ouachita', 16: 'Plaquemines',
    17: 'Pointe Coupee', 18: 'Rapides', 19: 'St. Bernard', 20: 'St. Charles',
    21: 'St. James', 22: 'St. John Baptist', 23: 'St. Landry', 24: 'St. Martin',
    25: 'St. Mary', 26: 'St. Tammany', 27: 'Terrebonne', 28: 'West Baton Rouge'
};

/**
 * Download a file from URL
 */
function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        console.log(`   📥 Downloading: ${url}`);

        const file = fs.createWriteStream(destPath);
        const protocol = url.startsWith('https') ? https : http;

        protocol.get(url, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                // Follow redirect
                downloadFile(response.headers.location, destPath)
                    .then(resolve)
                    .catch(reject);
                return;
            }

            if (response.statusCode !== 200) {
                reject(new Error(`HTTP ${response.statusCode}`));
                return;
            }

            const totalSize = parseInt(response.headers['content-length'], 10);
            let downloadedSize = 0;

            response.on('data', (chunk) => {
                downloadedSize += chunk.length;
                if (totalSize) {
                    const percent = ((downloadedSize / totalSize) * 100).toFixed(1);
                    process.stdout.write(`\r   📥 Progress: ${percent}%`);
                }
            });

            response.pipe(file);

            file.on('finish', () => {
                file.close();
                console.log(`\n   ✅ Downloaded: ${path.basename(destPath)}`);
                resolve(destPath);
            });
        }).on('error', (err) => {
            fs.unlink(destPath, () => {});
            reject(err);
        });
    });
}

/**
 * Extract ZIP file
 */
function extractZip(zipPath, extractDir) {
    console.log(`   📦 Extracting: ${path.basename(zipPath)}`);
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractDir, true);
    console.log(`   ✅ Extracted to: ${extractDir}`);
}

/**
 * Parse code lookup file (TXT format)
 */
function parseCodeFile(content, codeType) {
    const codes = {};
    const lines = content.split('\n');

    // Different parsing based on code type
    // Format varies but generally: CODE = DESCRIPTION or CODE DESCRIPTION
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

        // Try different patterns
        let match = trimmed.match(/^(\d+)\s*[=:]\s*(.+)$/);
        if (!match) {
            match = trimmed.match(/^(\d+)\s+(.+)$/);
        }

        if (match) {
            const code = parseInt(match[1], 10);
            const description = match[2].trim();
            codes[code] = description;
        }
    }

    return codes;
}

/**
 * Decode a coded field value
 */
function decodeValue(value, codeType) {
    if (value === null || value === undefined || value === '') return null;

    const numValue = parseInt(value, 10);
    if (isNaN(numValue)) return value;

    // Use hardcoded lookups first, then parsed ones
    switch (codeType) {
        case 'BIRTHPL':
            return BIRTHPLACE_CODES[numValue] || CODE_LOOKUPS.BIRTHPL[numValue] || `Code ${numValue}`;
        case 'SKILLCAT':
            return SKILL_CODES[numValue] || CODE_LOOKUPS.SKILLCAT[numValue] || `Skill ${numValue}`;
        case 'RACE':
            return RACE_CODES[numValue] || `Race ${numValue}`;
        case 'SEX':
            return SEX_CODES[numValue] || `Sex ${numValue}`;
        case 'DOCTYPE':
            return DOCTYPE_CODES[numValue] || `DocType ${numValue}`;
        case 'LOCATION':
            return LOCATION_CODES[numValue] || `Location ${numValue}`;
        default:
            return CODE_LOOKUPS[codeType]?.[numValue] || value;
    }
}

/**
 * Process a single DBF record and insert into database
 */
async function processSlaveRecord(record, sourceFile) {
    // Extract and decode fields
    const name = record.NAME?.trim() || 'Unknown';
    const sex = decodeValue(record.SEX, 'SEX');
    const race = decodeValue(record.RACE, 'RACE');
    const age = record.AGE;
    const birthplace = decodeValue(record.BIRTHPL, 'BIRTHPL');
    const birthplaceSpelling = record.SPELL?.trim();

    // Skills
    const skills = [];
    if (record.SKILLCAT) skills.push(decodeValue(record.SKILLCAT, 'SKILLCAT'));
    if (record.SKILL2) skills.push(decodeValue(record.SKILL2, 'SKILLCAT'));
    if (record.SKILL3) skills.push(decodeValue(record.SKILL3, 'SKILLCAT'));
    const skillsText = record.SKILLS?.trim();

    // Document info
    const docDate = record.DOCDATE;
    const year = record.YEAR || (docDate ? new Date(docDate).getFullYear() : null);
    const docType = decodeValue(record.DOCTYPE, 'DOCTYPE');
    const location = decodeValue(record.LOCATION, 'LOCATION');
    const notary = record.NOTARY?.trim();

    // Transaction parties
    const seller = record.SELLER?.trim();
    const buyer = record.BUYER?.trim();
    const estateOf = record.ESTATE_OF?.trim();

    // Values
    const invValue = record.INVVALP;
    const saleValue = record.SALEVALP;

    // Family info
    const family = record.FAMILY?.trim();
    const children = record.CHILDREN;
    const pregnant = record.PREGNANT === 1;
    const mother = record.MOTHER === 1;
    const mate = record.MATE === 1 ? record.MATENAME?.trim() : null;

    // Status flags
    const runaway = record.RUNAWAY === 1;
    const maroon = record.MAROON === 1;
    const revolts = record.REVOLTS === 1;
    const emancipated = record.EMANCIP === 1;
    const brut = record.BRUT === 1; // Newly arrived from Africa

    // Character and health
    const character = record.CHARACTER?.trim();
    const sick = record.SICK?.trim();

    // Name explanation (for African names)
    const nameExplain = record.NAMEXPLAIN?.trim();

    // Build context text with all available information
    const contextParts = [];
    contextParts.push(`Louisiana Slave Database Record`);
    contextParts.push(`Source: Afro-Louisiana History and Genealogy Database (Dr. Gwendolyn Midlo Hall)`);
    if (year) contextParts.push(`Year: ${year}`);
    if (docType) contextParts.push(`Document Type: ${docType}`);
    if (location) contextParts.push(`Location: ${location}, Louisiana`);
    if (notary) contextParts.push(`Notary: ${notary}`);

    if (sex) contextParts.push(`Sex: ${sex}`);
    if (age) contextParts.push(`Age: ${age}`);
    if (race) contextParts.push(`Race/Color: ${race}`);
    if (birthplace) contextParts.push(`Origin: ${birthplace}${birthplaceSpelling ? ` (spelled: ${birthplaceSpelling})` : ''}`);
    if (brut) contextParts.push(`Status: Recently arrived from Africa (Bozal)`);

    if (skills.length > 0) contextParts.push(`Skills: ${skills.filter(Boolean).join(', ')}`);
    if (skillsText) contextParts.push(`Occupation details: ${skillsText}`);

    if (estateOf) contextParts.push(`Estate of: ${estateOf}`);
    if (seller) contextParts.push(`Seller: ${seller}${record.FIRST1 ? ' ' + record.FIRST1.trim() : ''}`);
    if (buyer) contextParts.push(`Buyer: ${buyer}${record.FIRST2 ? ' ' + record.FIRST2.trim() : ''}`);

    if (invValue) contextParts.push(`Inventory Value: ${invValue} piastres`);
    if (saleValue) contextParts.push(`Sale Value: ${saleValue} piastres`);

    if (family) contextParts.push(`Family: ${family}`);
    if (children) contextParts.push(`Children: ${children}`);
    if (pregnant) contextParts.push(`Pregnant: Yes`);
    if (mate) contextParts.push(`Mate: ${mate}`);

    if (runaway) contextParts.push(`⚠️ Runaway status noted`);
    if (maroon) contextParts.push(`⚠️ Maroon community connection`);
    if (revolts) contextParts.push(`⚠️ Involvement in conspiracy/revolt`);
    if (emancipated) contextParts.push(`📜 Being emancipated`);

    if (character) contextParts.push(`Character: ${character}`);
    if (sick) contextParts.push(`Health: ${sick}`);
    if (nameExplain) contextParts.push(`Name meaning: ${nameExplain}`);

    const contextText = contextParts.join('\n');

    // Build relationships JSON
    const relationships = {};
    if (estateOf) relationships.estate_owner = estateOf;
    if (seller) relationships.seller = `${seller}${record.FIRST1 ? ' ' + record.FIRST1.trim() : ''}`;
    if (buyer) relationships.buyer = `${buyer}${record.FIRST2 ? ' ' + record.FIRST2.trim() : ''}`;
    if (mate) relationships.mate = mate;
    if (mother) relationships.has_mother_listed = true;
    if (record.FATHER === 1) relationships.has_father_listed = true;

    // Determine gender
    const gender = sex === 'Female' ? 'female' : sex === 'Male' ? 'male' : null;

    // Calculate birth year from age and document year
    let birthYear = null;
    if (year && age) {
        birthYear = year - Math.round(age);
    }

    // Build location array
    const locations = [];
    if (location) locations.push(`${location}, Louisiana`);
    if (birthplace && !birthplace.includes('Creole') && !birthplace.includes('Louisiana')) {
        locations.push(birthplace);
    }

    // Insert into database
    try {
        await pool.query(`
            INSERT INTO unconfirmed_persons (
                full_name, person_type, birth_year, gender, locations,
                source_url, source_page_title, extraction_method,
                context_text, confidence_score, relationships, status, source_type
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        `, [
            name,
            'enslaved',  // All records in Slave.dbf are enslaved persons
            birthYear,
            gender,
            locations.length > 0 ? locations : null,
            `https://www.ibiblio.org/laslave/downloads/${sourceFile}`,
            `Louisiana Slave Database - ${docType || 'Record'}`,
            'la_slave_db_import',
            contextText,
            0.95,  // High confidence - this is a scholarly database
            JSON.stringify(relationships),
            'pending',
            'la_slave_db'
        ]);

        return { success: true, name };
    } catch (error) {
        if (error.code === '23505') {
            // Duplicate - skip
            return { success: false, duplicate: true, name };
        }
        throw error;
    }
}

/**
 * Process Free.dbf records (free Black persons)
 */
async function processFreeRecord(record, sourceFile) {
    const name = record.NAME?.trim() || 'Unknown';
    const sex = decodeValue(record.SEX, 'SEX');
    const race = decodeValue(record.RACE, 'RACE');
    const age = record.AGE;
    const birthplace = decodeValue(record.BIRTHPL, 'BIRTHPL');

    // Free-specific fields
    const means = record.MEANS; // Means of manumission
    const freerRel = record.FREERREL; // Relationship to freer
    const freed = record.FREED;
    const terms = record.TERMS?.trim();
    const reasons = record.REASONS?.trim();
    const whiteDad = record.WHITEDAD;

    // Freer info
    const freererName = record.FREERNAME?.trim();
    const freererFirst = record.FIRSTNAME?.trim();

    // Master info
    const masterName = record.MASTER_NAM?.trim();
    const masterFirst = record.M_FIRST_NAM?.trim();

    const year = record.YEAR;
    const docType = decodeValue(record.DOCTYPE, 'DOCTYPE');
    const location = decodeValue(record.LOCATION, 'LOCATION');

    // Build context
    const contextParts = [];
    contextParts.push(`Louisiana Free Database Record`);
    contextParts.push(`Source: Afro-Louisiana History and Genealogy Database (Dr. Gwendolyn Midlo Hall)`);
    if (year) contextParts.push(`Year: ${year}`);
    if (docType) contextParts.push(`Document Type: ${docType}`);
    if (location) contextParts.push(`Location: ${location}, Louisiana`);

    if (sex) contextParts.push(`Sex: ${sex}`);
    if (age) contextParts.push(`Age: ${age}`);
    if (race) contextParts.push(`Race/Color: ${race}`);
    if (birthplace) contextParts.push(`Origin: ${birthplace}`);

    if (masterName) contextParts.push(`Former Master: ${masterFirst || ''} ${masterName}`.trim());
    if (freererName) contextParts.push(`Freed by: ${freererFirst || ''} ${freererName}`.trim());
    if (means) contextParts.push(`Means of Freedom: Code ${means}`);
    if (terms) contextParts.push(`Terms: ${terms}`);
    if (reasons) contextParts.push(`Reason: ${reasons}`);
    if (whiteDad === 1) contextParts.push(`White father: Certainly`);
    else if (whiteDad === 2) contextParts.push(`White father: Probably`);

    const contextText = contextParts.join('\n');

    // Relationships
    const relationships = {};
    if (masterName) relationships.former_master = `${masterFirst || ''} ${masterName}`.trim();
    if (freererName) relationships.freed_by = `${freererFirst || ''} ${freererName}`.trim();

    const gender = sex === 'Female' ? 'female' : sex === 'Male' ? 'male' : null;
    let birthYear = null;
    if (year && age) birthYear = year - Math.round(age);

    const locations = [];
    if (location) locations.push(`${location}, Louisiana`);

    try {
        await pool.query(`
            INSERT INTO unconfirmed_persons (
                full_name, person_type, birth_year, gender, locations,
                source_url, source_page_title, extraction_method,
                context_text, confidence_score, relationships, status, source_type
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        `, [
            name,
            'free_black',
            birthYear,
            gender,
            locations.length > 0 ? locations : null,
            `https://www.ibiblio.org/laslave/downloads/${sourceFile}`,
            `Louisiana Free Database - ${docType || 'Record'}`,
            'la_slave_db_import',
            contextText,
            0.95,
            JSON.stringify(relationships),
            'pending',
            'la_free_db'
        ]);

        return { success: true, name };
    } catch (error) {
        if (error.code === '23505') {
            return { success: false, duplicate: true, name };
        }
        throw error;
    }
}

/**
 * Main processing function
 */
async function processLouisianaSlaveDatabase() {
    console.log(`
╔══════════════════════════════════════════════════════════════════╗
║     LOUISIANA SLAVE DATABASE SCRAPER                             ║
║     Afro-Louisiana History and Genealogy Database                ║
║     Dr. Gwendolyn Midlo Hall                                     ║
╠══════════════════════════════════════════════════════════════════╣
║  Source: https://www.ibiblio.org/laslave/downloads/              ║
║  Data: Slave.zip (~100,000+ records) + Free.zip                  ║
╚══════════════════════════════════════════════════════════════════╝
`);

    // Create download directory
    if (!fs.existsSync(DOWNLOAD_DIR)) {
        fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    }

    const startTime = Date.now();
    let totalRecords = 0;
    let successCount = 0;
    let duplicateCount = 0;
    let errorCount = 0;

    try {
        // Step 1: Download files
        console.log('\n📥 STEP 1: Downloading data files...\n');

        const slaveZipPath = path.join(DOWNLOAD_DIR, 'Slave.zip');
        const freeZipPath = path.join(DOWNLOAD_DIR, 'Free.zip');

        if (!fs.existsSync(slaveZipPath)) {
            await downloadFile(`${BASE_URL}Slave.zip`, slaveZipPath);
        } else {
            console.log('   ✅ Slave.zip already downloaded');
        }

        if (!fs.existsSync(freeZipPath)) {
            await downloadFile(`${BASE_URL}Free.zip`, freeZipPath);
        } else {
            console.log('   ✅ Free.zip already downloaded');
        }

        // Step 2: Extract files
        console.log('\n📦 STEP 2: Extracting archives...\n');

        const slaveDir = path.join(DOWNLOAD_DIR, 'slave');
        const freeDir = path.join(DOWNLOAD_DIR, 'free');

        if (!fs.existsSync(path.join(slaveDir, 'Slave.dbf'))) {
            extractZip(slaveZipPath, slaveDir);
        } else {
            console.log('   ✅ Slave files already extracted');
        }

        if (!fs.existsSync(path.join(freeDir, 'Free.dbf'))) {
            extractZip(freeZipPath, freeDir);
        } else {
            console.log('   ✅ Free files already extracted');
        }

        // Step 3: Process Slave.dbf
        console.log('\n📄 STEP 3: Processing Slave database...\n');

        const slaveDbfPath = path.join(slaveDir, 'Slave.dbf');
        if (fs.existsSync(slaveDbfPath)) {
            const dbf = await DBFFile.open(slaveDbfPath);
            console.log(`   📊 Found ${dbf.recordCount} records in Slave.dbf`);
            console.log(`   📋 Fields: ${dbf.fields.map(f => f.name).join(', ')}`);

            const batchSize = 100;
            let processed = 0;

            for await (const records of dbf.readRecords(batchSize)) {
                for (const record of records) {
                    totalRecords++;
                    processed++;

                    try {
                        const result = await processSlaveRecord(record, 'Slave.dbf');
                        if (result.success) {
                            successCount++;
                        } else if (result.duplicate) {
                            duplicateCount++;
                        }
                    } catch (error) {
                        errorCount++;
                        if (errorCount <= 5) {
                            console.error(`   ❌ Error processing record: ${error.message}`);
                        }
                    }

                    if (processed % 1000 === 0) {
                        const percent = ((processed / dbf.recordCount) * 100).toFixed(1);
                        console.log(`   📝 Processed ${processed}/${dbf.recordCount} (${percent}%) - ${successCount} imported`);
                    }
                }
            }

            console.log(`\n   ✅ Slave.dbf complete: ${successCount} imported, ${duplicateCount} duplicates, ${errorCount} errors`);
        } else {
            console.log('   ⚠️  Slave.dbf not found');
        }

        // Step 4: Process Free.dbf
        console.log('\n📄 STEP 4: Processing Free database...\n');

        const freeDbfPath = path.join(freeDir, 'Free.dbf');
        if (fs.existsSync(freeDbfPath)) {
            const dbf = await DBFFile.open(freeDbfPath);
            console.log(`   📊 Found ${dbf.recordCount} records in Free.dbf`);

            const freeStartSuccess = successCount;
            let processed = 0;

            for await (const records of dbf.readRecords(100)) {
                for (const record of records) {
                    totalRecords++;
                    processed++;

                    try {
                        const result = await processFreeRecord(record, 'Free.dbf');
                        if (result.success) {
                            successCount++;
                        } else if (result.duplicate) {
                            duplicateCount++;
                        }
                    } catch (error) {
                        errorCount++;
                    }

                    if (processed % 500 === 0) {
                        console.log(`   📝 Processed ${processed}/${dbf.recordCount} Free records`);
                    }
                }
            }

            console.log(`\n   ✅ Free.dbf complete: ${successCount - freeStartSuccess} imported`);
        }

        // Summary
        const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
        console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                    IMPORT COMPLETE                                ║
╠══════════════════════════════════════════════════════════════════╣
║  Duration: ${duration} minutes
║  Total Records Processed: ${totalRecords.toLocaleString()}
║  Successfully Imported: ${successCount.toLocaleString()}
║  Duplicates Skipped: ${duplicateCount.toLocaleString()}
║  Errors: ${errorCount.toLocaleString()}
╚══════════════════════════════════════════════════════════════════╝
`);

    } catch (error) {
        console.error('\n❌ Fatal error:', error);
        throw error;
    } finally {
        await pool.end();
    }
}

// Run if called directly
if (require.main === module) {
    processLouisianaSlaveDatabase()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error('Fatal error:', error);
            process.exit(1);
        });
}

module.exports = { processLouisianaSlaveDatabase };
