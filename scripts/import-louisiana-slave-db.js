/**
 * Import Louisiana Slave Database (100,666+ records)
 *
 * Source: Afro-Louisiana History and Genealogy (ibiblio.org/laslave)
 * Data: DBF file with enslaved persons, sellers, buyers, estates
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { DBFFile } = require('dbffile');
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

// Location codes to parish names
const LOCATIONS = {
    1: 'St. Bernard Parish',
    2: 'Plaquemines Parish',
    3: 'Orleans Parish',
    4: 'Lafourche Parish',
    5: 'Assumption Parish',
    6: 'St. Charles Parish',
    7: 'St. John the Baptist Parish',
    8: 'St. James Parish',
    9: 'Ascension Parish',
    11: 'Iberville Parish',
    12: 'St. Martin Parish',
    13: 'St. Mary Parish',
    14: 'St. Landry Parish',
    15: 'Pointe Coupee Parish',
    16: 'Avoyelles Parish',
    17: 'West Baton Rouge Parish',
    20: 'Natchitoches Parish',
    21: 'Rapides Parish',
    23: 'Catahoula Parish',
    24: 'Ouachita Parish',
    25: 'East Baton Rouge Parish',
    26: 'Feliciana Parish',
    27: 'Manchak',
    28: 'St. Tammany Parish',
    29: 'St. Helena Parish',
    30: 'Mobile, Alabama',
    31: 'Pensacola, Florida',
    32: 'Natchez, Mississippi',
    33: 'Arkansas',
    34: 'Illinois',
    35: 'Concordia Parish',
    36: 'Red River Parish'
};

const RACE_CODES = {
    1: 'Grif (Black/Indian)',
    2: 'Indian',
    3: 'Black',
    4: 'Mulatto',
    5: 'Quadroon',
    6: 'Octoroon',
    7: 'Metis',
    8: 'Mixed',
    9: 'Unknown'
};

const SEX_CODES = {
    1: 'Female',
    2: 'Male',
    9: 'Unknown'
};

// Track statistics
const stats = {
    recordsRead: 0,
    enslavedCreated: 0,
    ownersCreated: 0,
    skipped: 0,
    errors: 0,
    duplicates: 0
};

async function importDatabase(dbfPath, limit = null) {
    console.log('='.repeat(60));
    console.log('LOUISIANA SLAVE DATABASE IMPORT');
    console.log('='.repeat(60));
    console.log(`Source: ${dbfPath}`);
    console.log(`Limit: ${limit || 'ALL'}`);
    console.log();

    const dbf = await DBFFile.open(dbfPath);
    console.log(`Total records in DBF: ${dbf.recordCount}`);
    console.log('Reading all records into memory...');

    // Read ALL records at once (more efficient than batched re-reads)
    const allRecords = await dbf.readRecords(limit || dbf.recordCount);
    console.log(`Loaded ${allRecords.length} records into memory`);
    console.log();

    const sourceUrl = 'https://www.ibiblio.org/laslave/';

    for (let i = 0; i < allRecords.length; i++) {
        const record = allRecords[i];
        stats.recordsRead++;

        try {
            await processRecord(record, sourceUrl);
        } catch (error) {
            stats.errors++;
            if (stats.errors <= 5) {
                console.log(`  Error at record ${i}: ${error.message}`);
            }
        }

        // Progress indicator every 5000 records
        if (stats.recordsRead % 5000 === 0) {
            console.log(`Progress: ${stats.recordsRead}/${allRecords.length} records | ${stats.enslavedCreated} enslaved | ${stats.ownersCreated} owners`);
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log('IMPORT COMPLETE');
    console.log('='.repeat(60));
    console.log(`Records read: ${stats.recordsRead}`);
    console.log(`Enslaved created: ${stats.enslavedCreated}`);
    console.log(`Owners created: ${stats.ownersCreated}`);
    console.log(`Skipped (no data): ${stats.skipped}`);
    console.log(`Duplicates: ${stats.duplicates}`);
    console.log(`Errors: ${stats.errors}`);
}

async function processRecord(record, sourceUrl) {
    const location = LOCATIONS[record.LOCATION] || `Louisiana (code ${record.LOCATION})`;
    const year = record.YEAR;

    // Get the enslaved person's name
    const enslavedName = cleanName(record.NAME);

    // Get potential owner names
    const seller = cleanName(record.SELLER);
    const sellerFirst = cleanName(record.FIRST1);
    const buyer = cleanName(record.BUYER);
    const buyerFirst = cleanName(record.FIRST2);
    const estate = cleanName(record.ESTATE_OF);

    // Only skip if no enslaved name AND no owner info
    const hasOwnerInfo = seller || buyer || estate;
    if (!enslavedName && !hasOwnerInfo) {
        stats.skipped++;
        return;
    }

    // Create enslaved person record
    const sex = SEX_CODES[record.SEX] || null;
    const race = RACE_CODES[record.RACE] || null;
    const age = record.AGE > 0 && record.AGE < 150 ? record.AGE : null;
    const skills = record.SKILLS?.trim() || null;

    // Build owner name from seller or buyer
    let ownerName = null;
    if (seller) {
        ownerName = sellerFirst ? `${sellerFirst} ${seller}` : seller;
    } else if (buyer) {
        ownerName = buyerFirst ? `${buyerFirst} ${buyer}` : buyer;
    } else if (estate) {
        ownerName = `Estate of ${estate}`;
    }

    // Build context with all available info
    const context = [
        enslavedName || 'Unnamed enslaved person',
        ownerName ? `Owner: ${ownerName}` : null,
        location,
        year ? `(${year})` : null,
        race,
        age ? `Age ${age}` : null,
        skills
    ].filter(Boolean).join(' | ');

    // Store enslaved person only if they have a name
    if (enslavedName) {
        await storeEnslaved({
            name: enslavedName,
            owner: ownerName,
            location: `${location}, Louisiana`,
            year,
            sex,
            age,
            race,
            skills,
            context,
            sourceUrl
        });
    }

    // Store owner if found (even if enslaved person has no name)
    if (ownerName) {
        await storeOwner({
            name: ownerName,
            location: `${location}, Louisiana`,
            year,
            context: `${ownerName} (slaveholder) | ${location}, Louisiana ${year ? `(${year})` : ''}`,
            sourceUrl
        });
    }
}

function cleanName(name) {
    if (!name) return null;
    const cleaned = name.toString().trim();
    // Skip if just a number or too short
    if (cleaned.length < 2 || /^\d+$/.test(cleaned)) return null;
    return cleaned;
}

async function storeEnslaved(data) {
    try {
        const relationships = {
            owner: data.owner,
            location: data.location,
            year: data.year,
            age: data.age,
            race: data.race,
            skills: data.skills
        };

        // Skip duplicate check for speed - dedupe later
        await sql`
            INSERT INTO unconfirmed_persons (
                full_name, person_type, source_url, context_text,
                confidence_score, extraction_method, gender,
                locations, relationships
            ) VALUES (
                ${data.name},
                'enslaved',
                ${data.sourceUrl},
                ${data.context},
                0.95,
                'louisiana_slave_db_import',
                ${data.sex},
                ${[data.location]},
                ${JSON.stringify(relationships)}
            )
        `;

        stats.enslavedCreated++;
    } catch (error) {
        if (error.message?.includes('duplicate')) {
            stats.duplicates++;
        } else {
            throw error;
        }
    }
}

async function storeOwner(data) {
    try {
        // Skip duplicate check for speed - dedupe later
        await sql`
            INSERT INTO unconfirmed_persons (
                full_name, person_type, source_url, context_text,
                confidence_score, extraction_method,
                locations, relationships
            ) VALUES (
                ${data.name},
                'slaveholder',
                ${data.sourceUrl},
                ${data.context},
                0.95,
                'louisiana_slave_db_import',
                ${[data.location]},
                ${JSON.stringify({ location: data.location, year: data.year })}
            )
        `;

        stats.ownersCreated++;
    } catch (error) {
        if (error.message?.includes('duplicate')) {
            stats.duplicates++;
        } else {
            throw error;
        }
    }
}

// Main
const args = process.argv.slice(2);
const dbfPath = args[0] || '/Users/danyelabrown/Downloads/Slave/SLAVE.DBF';
const limit = args[1] ? parseInt(args[1]) : null;

importDatabase(dbfPath, limit).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
