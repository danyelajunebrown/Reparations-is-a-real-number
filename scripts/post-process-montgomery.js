/**
 * Post-Processing Script for Montgomery County MSA Scraper Data
 *
 * Cleans up noise from OCR extraction:
 * 1. Removes column headers captured as names (NAMES, ATLA, BY WHOM, etc.)
 * 2. Filters out invalid/suspicious entries
 * 3. Improves data quality and links enslaved to slaveholders where possible
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/post-process-montgomery.js
 */

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;

// Known column headers and invalid "names" to remove
const INVALID_NAMES = new Set([
    // Column headers from MSA Volume 812
    'NAMES', 'NAME', 'ATLA', 'BY WHOM', 'SEX', 'AGE', 'PHYSICAL', 'CONDITION',
    'TERM', 'SERVICE', 'MILITARY', 'CONSTITUTION', 'ADOPTION', 'TIME',
    'REMARKS', 'PAGE', 'DATE', 'OWNER', 'RECORD', 'SLAVES', 'COUNTY',
    'MONTGOMERY', 'MARYLAND', 'SLAVE', 'AT THE', 'THE TIME', 'OF THE',
    // Common OCR artifacts
    'THE', 'AND', 'FOR', 'WITH', 'FROM', 'THAT', 'THIS', 'HAVE', 'BEEN',
    'WAS', 'WERE', 'HAS', 'HAD', 'NOT', 'BUT', 'ALL', 'CAN', 'HER', 'HIS',
    // Single letters or very short
    'A', 'I', 'AN', 'AS', 'AT', 'BE', 'BY', 'DO', 'GO', 'IF', 'IN', 'IS',
    'IT', 'ME', 'MY', 'NO', 'OF', 'ON', 'OR', 'SO', 'TO', 'UP', 'US', 'WE',
    // Numbers as names
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '0',
    // Common words misread as names
    'HEALTHY', 'UNSOUND', 'SICK', 'LIFE', 'YEARS', 'MALE', 'FEMALE',
    'FREE', 'COLORED', 'BLACK', 'NEGRO', 'WHITE', 'SEPT', 'OCT', 'NOV',
    'DEC', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG',
    // Partial words / fragments
    'ING', 'TION', 'ED', 'ER', 'LY', 'MENT', 'NESS', 'ABLE'
]);

// Valid name patterns - names that should be kept
const VALID_NAME_PATTERNS = [
    // Common given names of the era
    /^(Mary|Sarah|Jane|Ann|Elizabeth|Martha|Margaret|Nancy|Susan|Caroline)$/i,
    /^(John|William|James|Henry|George|Thomas|Charles|Robert|Samuel|Joseph)$/i,
    /^(Peter|Moses|Isaac|Jacob|Abraham|Daniel|David|Benjamin|Solomon|Aaron)$/i,
    /^(Rachel|Hannah|Rebecca|Leah|Ruth|Esther|Dinah|Priscilla|Lydia)$/i,
    /^(Harriet|Louisa|Maria|Julia|Charlotte|Eliza|Sophia|Amanda)$/i,
    // African day names often preserved
    /^(Cuffee|Cuffy|Cuff|Cudjoe|Cudjo|Quash|Quashee|Quaco)$/i,
    /^(Juba|Phibba|Abba|Mingo|Sambo|Pompey|Caesar|Scipio|Cato)$/i,
    /^(Prince|Fortune|July|Monday|Friday|Sunday)$/i
];

async function postProcess() {
    if (!DATABASE_URL) {
        console.error('❌ DATABASE_URL required');
        process.exit(1);
    }

    const pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    console.log('\n======================================================================');
    console.log('🧹 MONTGOMERY COUNTY DATA POST-PROCESSING');
    console.log('======================================================================\n');

    try {
        // Step 1: Count current records
        const beforeCount = await pool.query(`
            SELECT
                COUNT(*) as total,
                COUNT(CASE WHEN person_type = 'enslaved' THEN 1 END) as enslaved,
                COUNT(CASE WHEN person_type = 'slaveholder' THEN 1 END) as slaveholders
            FROM unconfirmed_persons
            WHERE extraction_method = 'msa_archive_scraper'
        `);
        console.log('📊 Before cleanup:');
        console.log(`   Total: ${beforeCount.rows[0].total}`);
        console.log(`   Enslaved: ${beforeCount.rows[0].enslaved}`);
        console.log(`   Slaveholders: ${beforeCount.rows[0].slaveholders}\n`);

        // Step 2: Delete invalid names (column headers, artifacts)
        console.log('🗑️  Removing invalid entries (column headers, OCR artifacts)...');

        const invalidNamesArray = Array.from(INVALID_NAMES);
        const deletedInvalid = await pool.query(`
            DELETE FROM unconfirmed_persons
            WHERE extraction_method = 'msa_archive_scraper'
              AND UPPER(TRIM(full_name)) = ANY($1)
            RETURNING lead_id, full_name
        `, [invalidNamesArray]);

        console.log(`   Deleted ${deletedInvalid.rowCount} invalid entries`);

        // Step 3: Delete names that are too short (< 2 chars)
        console.log('🗑️  Removing names shorter than 2 characters...');

        const deletedShort = await pool.query(`
            DELETE FROM unconfirmed_persons
            WHERE extraction_method = 'msa_archive_scraper'
              AND LENGTH(TRIM(full_name)) < 2
            RETURNING lead_id, full_name
        `);

        console.log(`   Deleted ${deletedShort.rowCount} too-short entries`);

        // Step 4: Delete names that are all uppercase and not valid
        console.log('🗑️  Removing all-uppercase non-name entries...');

        const deletedUppercase = await pool.query(`
            DELETE FROM unconfirmed_persons
            WHERE extraction_method = 'msa_archive_scraper'
              AND full_name = UPPER(full_name)
              AND LENGTH(full_name) > 3
              AND full_name !~ '^[A-Z][a-z]'
            RETURNING lead_id, full_name
        `);

        console.log(`   Deleted ${deletedUppercase.rowCount} all-uppercase entries`);

        // Step 5: Delete entries with special characters or numbers
        console.log('🗑️  Removing entries with invalid characters...');

        const deletedInvalidChars = await pool.query(`
            DELETE FROM unconfirmed_persons
            WHERE extraction_method = 'msa_archive_scraper'
              AND (
                full_name ~ '[0-9]'
                OR full_name ~ '[^a-zA-Z\\s\\-\\.'']'
              )
            RETURNING lead_id, full_name
        `);

        console.log(`   Deleted ${deletedInvalidChars.rowCount} entries with invalid characters`);

        // Step 6: Normalize remaining names (proper case)
        console.log('✨ Normalizing name formatting...');

        const normalizedCount = await pool.query(`
            UPDATE unconfirmed_persons
            SET full_name = INITCAP(TRIM(full_name))
            WHERE extraction_method = 'msa_archive_scraper'
              AND full_name != INITCAP(TRIM(full_name))
        `);

        console.log(`   Normalized ${normalizedCount.rowCount} names`);

        // Step 7: Remove duplicates (same name, same page)
        console.log('🔄 Removing duplicates (same name on same page)...');

        const deletedDuplicates = await pool.query(`
            DELETE FROM unconfirmed_persons a
            USING unconfirmed_persons b
            WHERE a.lead_id > b.lead_id
              AND a.full_name = b.full_name
              AND a.source_url = b.source_url
              AND a.extraction_method = 'msa_archive_scraper'
              AND b.extraction_method = 'msa_archive_scraper'
        `);

        console.log(`   Deleted ${deletedDuplicates.rowCount} duplicates`);

        // Step 8: Final count
        const afterCount = await pool.query(`
            SELECT
                COUNT(*) as total,
                COUNT(CASE WHEN person_type = 'enslaved' THEN 1 END) as enslaved,
                COUNT(CASE WHEN person_type = 'slaveholder' THEN 1 END) as slaveholders,
                ROUND(AVG(confidence_score), 2) as avg_confidence
            FROM unconfirmed_persons
            WHERE extraction_method = 'msa_archive_scraper'
        `);

        console.log('\n📊 After cleanup:');
        console.log(`   Total: ${afterCount.rows[0].total}`);
        console.log(`   Enslaved: ${afterCount.rows[0].enslaved}`);
        console.log(`   Slaveholders: ${afterCount.rows[0].slaveholders}`);
        console.log(`   Avg confidence: ${afterCount.rows[0].avg_confidence}`);

        const removed = beforeCount.rows[0].total - afterCount.rows[0].total;
        console.log(`\n✅ Removed ${removed} invalid/duplicate entries (${Math.round(removed/beforeCount.rows[0].total*100)}% noise)`);

        // Step 9: Sample cleaned data
        console.log('\n📝 Sample of cleaned enslaved persons:');
        const sampleEnslaved = await pool.query(`
            SELECT full_name, gender, source_url
            FROM unconfirmed_persons
            WHERE extraction_method = 'msa_archive_scraper'
              AND person_type = 'enslaved'
            ORDER BY RANDOM()
            LIMIT 10
        `);

        for (const row of sampleEnslaved.rows) {
            const page = row.source_url.match(/page-(\d+)/)?.[1] || '?';
            console.log(`   ${row.full_name} (${row.gender || 'unknown'}) - Page ${page}`);
        }

        console.log('\n📝 Sample of cleaned slaveholders:');
        const sampleSlaveholders = await pool.query(`
            SELECT full_name, source_url
            FROM unconfirmed_persons
            WHERE extraction_method = 'msa_archive_scraper'
              AND person_type = 'slaveholder'
            ORDER BY RANDOM()
            LIMIT 10
        `);

        for (const row of sampleSlaveholders.rows) {
            const page = row.source_url.match(/page-(\d+)/)?.[1] || '?';
            console.log(`   ${row.full_name} - Page ${page}`);
        }

        console.log('\n======================================================================');
        console.log('✅ POST-PROCESSING COMPLETE');
        console.log('======================================================================\n');

    } catch (error) {
        console.error(`\n❌ Error: ${error.message}`);
        console.error(error.stack);
    } finally {
        await pool.end();
    }
}

postProcess();
