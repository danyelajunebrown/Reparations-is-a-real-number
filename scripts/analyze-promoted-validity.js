#!/usr/bin/env node
/**
 * Analyze validity of promoted records from MSA and FamilySearch
 *
 * Validity criteria:
 * 1. Real name (not garbage/OCR artifact)
 * 2. Has link to owner (for enslaved) OR link to enslaved persons (for owners)
 */
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Garbage patterns
const GARBAGE_PATTERNS = [
    /^(the|he|she|it|that|this|with|from|for|and|but|not|are|was|were|been|have|has|had|do|does|did|will|would|could|should|may|might|must|shall|can|need|dare|ought|used|to|of|in|on|at|by|as|or|an|a)$/i,
    /^[^a-zA-Z]*$/,  // No letters
    /^.{1,2}$/,  // Too short
    /^\d+$/,  // Just numbers
    /^(participant|researcher|unknown|statistics|county|city|state|month|year|page|volume|record|document|index|total|number|list|table|form|entry|item|row|column)$/i,
    /^(january|february|march|april|may|june|july|august|september|october|november|december)$/i,
    /county$/i,
    /river$/i,
    /valley$/i,
];

function isGarbage(name) {
    if (!name) return true;
    const trimmed = name.trim();
    return GARBAGE_PATTERNS.some(pattern => pattern.test(trimmed));
}

async function analyze() {
    console.log('='.repeat(80));
    console.log('VALIDITY ANALYSIS OF PROMOTED RECORDS');
    console.log('='.repeat(80));

    // 1. Analyze enslaved_individuals
    console.log('\n\n### ENSLAVED_INDIVIDUALS TABLE ###\n');

    const enslaved = await pool.query(`
        SELECT
            enslaved_id,
            full_name,
            enslaved_by_individual_id,
            notes
        FROM enslaved_individuals
    `);

    let enslavedTotal = enslaved.rows.length;
    let enslavedGarbage = 0;
    let enslavedWithOwner = 0;
    let enslavedValid = 0;
    let garbageNames = [];

    for (const row of enslaved.rows) {
        const isGarbageName = isGarbage(row.full_name);
        const hasOwnerLink = row.enslaved_by_individual_id != null;

        if (isGarbageName) {
            enslavedGarbage++;
            if (garbageNames.length < 20) {
                garbageNames.push(row.full_name);
            }
        }

        if (hasOwnerLink) {
            enslavedWithOwner++;
        }

        // Valid = real name AND has owner link
        if (!isGarbageName && hasOwnerLink) {
            enslavedValid++;
        }
    }

    console.log('Total records:', enslavedTotal.toLocaleString());
    console.log('Garbage names:', enslavedGarbage.toLocaleString(), `(${(enslavedGarbage/enslavedTotal*100).toFixed(1)}%)`);
    console.log('With owner link:', enslavedWithOwner.toLocaleString(), `(${(enslavedWithOwner/enslavedTotal*100).toFixed(1)}%)`);
    console.log('VALID (real name + owner link):', enslavedValid.toLocaleString(), `(${(enslavedValid/enslavedTotal*100).toFixed(1)}%)`);

    if (garbageNames.length > 0) {
        console.log('\nSample garbage names:');
        garbageNames.slice(0, 10).forEach(n => console.log('  - "' + n + '"'));
    }

    // 2. Check source breakdown for enslaved_individuals
    console.log('\n\nSource breakdown (from notes field):');
    const sourceBreakdown = await pool.query(`
        SELECT
            CASE
                WHEN notes LIKE '%familysearch%' THEN 'FamilySearch'
                WHEN notes LIKE '%msa.maryland%' THEN 'Maryland Archives'
                WHEN notes LIKE '%civilwardc%' THEN 'Civil War DC'
                WHEN notes LIKE '%beyondkin%' THEN 'Beyond Kin'
                ELSE 'Other/Unknown'
            END as source,
            COUNT(*) as count
        FROM enslaved_individuals
        GROUP BY 1
        ORDER BY count DESC
    `);
    sourceBreakdown.rows.forEach(r => console.log('  ' + r.source + ': ' + parseInt(r.count).toLocaleString()));

    // 3. Check what the owners look like in canonical_persons
    console.log('\n\n### CANONICAL_PERSONS (SLAVEHOLDERS) ###\n');

    const owners = await pool.query(`
        SELECT id, canonical_name, person_type, notes
        FROM canonical_persons
        WHERE person_type IN ('slaveholder', 'owner', 'enslaver')
    `);

    let ownersTotal = owners.rows.length;
    let ownersGarbage = 0;
    let ownerGarbageNames = [];

    for (const row of owners.rows) {
        if (isGarbage(row.canonical_name)) {
            ownersGarbage++;
            if (ownerGarbageNames.length < 20) {
                ownerGarbageNames.push(row.canonical_name);
            }
        }
    }

    // Check how many have enslaved linked to them
    const ownersWithEnslaved = await pool.query(`
        SELECT COUNT(DISTINCT enslaved_by_individual_id) as count
        FROM enslaved_individuals
        WHERE enslaved_by_individual_id IS NOT NULL
    `);

    console.log('Total owner records:', ownersTotal.toLocaleString());
    console.log('Garbage names:', ownersGarbage.toLocaleString(), `(${(ownersGarbage/ownersTotal*100).toFixed(1)}%)`);
    console.log('Owners with enslaved linked:', ownersWithEnslaved.rows[0].count);

    if (ownerGarbageNames.length > 0) {
        console.log('\nSample garbage owner names:');
        ownerGarbageNames.slice(0, 10).forEach(n => console.log('  - "' + n + '"'));
    }

    // 4. Sample of VALID linked pairs
    console.log('\n\n### SAMPLE VALID ENSLAVED-OWNER PAIRS ###\n');

    const validPairs = await pool.query(`
        SELECT
            e.full_name as enslaved_name,
            c.canonical_name as owner_name,
            e.notes
        FROM enslaved_individuals e
        JOIN canonical_persons c ON e.enslaved_by_individual_id = c.id::text
        WHERE e.enslaved_by_individual_id IS NOT NULL
        AND LENGTH(e.full_name) > 2
        AND LENGTH(c.canonical_name) > 2
        LIMIT 15
    `);

    validPairs.rows.forEach(r => {
        console.log('  Enslaved: "' + r.enslaved_name + '" → Owner: "' + r.owner_name + '"');
    });

    // 5. Check unconfirmed_persons that were promoted (status='confirmed')
    console.log('\n\n### UNCONFIRMED_PERSONS (status=confirmed) ###\n');

    const confirmed = await pool.query(`
        SELECT
            full_name,
            person_type,
            extraction_method,
            source_url
        FROM unconfirmed_persons
        WHERE status = 'confirmed'
        LIMIT 100
    `);

    let confirmedGarbage = 0;
    for (const row of confirmed.rows) {
        if (isGarbage(row.full_name)) confirmedGarbage++;
    }

    const confirmedTotal = await pool.query(`SELECT COUNT(*) FROM unconfirmed_persons WHERE status = 'confirmed'`);

    console.log('Total confirmed:', confirmedTotal.rows[0].count);
    console.log('Garbage in sample of 100:', confirmedGarbage);

    // 6. FINAL VALIDITY VERDICT
    console.log('\n\n' + '='.repeat(80));
    console.log('FINAL VALIDITY ASSESSMENT');
    console.log('='.repeat(80));

    const realNamesInEnslaved = enslavedTotal - enslavedGarbage;
    const realNamesWithLinks = enslavedValid;
    const overallValidity = (realNamesWithLinks / enslavedTotal * 100).toFixed(1);
    const nameValidity = (realNamesInEnslaved / enslavedTotal * 100).toFixed(1);
    const linkRate = (enslavedWithOwner / enslavedTotal * 100).toFixed(1);

    console.log('\nEnslaved Individuals:');
    console.log('  - Real names (not garbage): ' + nameValidity + '%');
    console.log('  - Has owner link: ' + linkRate + '%');
    console.log('  - FULLY VALID (real name + owner link): ' + overallValidity + '%');

    const ownerValidity = ((ownersTotal - ownersGarbage) / ownersTotal * 100).toFixed(1);
    console.log('\nCanonical Owners:');
    console.log('  - Real names (not garbage): ' + ownerValidity + '%');

    console.log('\n' + '='.repeat(80));
    if (parseFloat(overallValidity) >= 75) {
        console.log('✅ PASSES 75% VALIDITY THRESHOLD');
    } else {
        console.log('❌ FAILS 75% VALIDITY THRESHOLD');
        console.log('   Current: ' + overallValidity + '% | Required: 75%');
    }
    console.log('='.repeat(80));

    await pool.end();
}

analyze().catch(console.error);
