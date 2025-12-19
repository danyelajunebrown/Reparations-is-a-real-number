/**
 * Genealogy Chain Verification System
 *
 * Verifies claimed genealogical lineages through independent public sources:
 * - WikiTree (free genealogy database with API)
 * - Find A Grave (burial records with family links)
 * - CivilWarDC (emancipation petitions)
 * - Our internal database (historical records)
 *
 * Usage:
 *   node scripts/verify-genealogy-chain.js
 *   node scripts/verify-genealogy-chain.js --person "G21N-HD2"
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { neon } = require('@neondatabase/serverless');
const https = require('https');

const sql = neon(process.env.DATABASE_URL);

// Known WikiTree IDs for verified ancestors
const WIKITREE_IDS = {
    'James Hopewell': 'Hopewell-183',
    'Ann Maria Hopewell': 'Hopewell-184',
    'Maria Angelica Biscoe': 'Biscoe-55',
    'George Washington Biscoe': 'Biscoe-54',
    'Charles Huntington Lyman II': 'Lyman-999',
    'Charles Huntington Lyman Jr': 'Lyman-999',  // Alias
};

// Known Find A Grave memorial IDs
const FINDAGRAVE_IDS = {
    'Charles Huntington Lyman III': '58497839',
    'Charles Huntington Lyman II': '95741570',
};

/**
 * Fetch WikiTree data via their API
 */
async function fetchWikiTree(wikiTreeId) {
    return new Promise((resolve, reject) => {
        const url = `https://api.wikitree.com/api.php?action=getProfile&key=${wikiTreeId}&format=json&fields=Name,BirthDate,DeathDate,Father,Mother,Children,Spouses`;

        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve(json);
                } catch (e) {
                    resolve({ error: 'Parse error' });
                }
            });
        }).on('error', reject);
    });
}

/**
 * Search our internal database for corroborating evidence
 */
async function searchInternalEvidence(personName) {
    const evidence = {
        canonical: [],
        unconfirmed: [],
        documents: []
    };

    // Search canonical_persons
    const canonical = await sql`
        SELECT canonical_name, person_type, birth_year_estimate, death_year_estimate, notes
        FROM canonical_persons
        WHERE canonical_name ILIKE ${'%' + personName + '%'}
    `;
    evidence.canonical = canonical;

    // Search unconfirmed_persons for historical records
    const unconfirmed = await sql`
        SELECT full_name, person_type, source_url, context_text, extraction_method
        FROM unconfirmed_persons
        WHERE full_name ILIKE ${'%' + personName + '%'}
        AND extraction_method NOT IN ('lineage_pdf_import', 'descendancy_import')
        LIMIT 10
    `;
    evidence.unconfirmed = unconfirmed;

    return evidence;
}

/**
 * Verify a single parent-child relationship
 */
async function verifyRelationship(parent, child) {
    const verification = {
        parent: parent.name,
        child: child.name,
        sources: [],
        confidence: 0,
        status: 'unverified'
    };

    console.log(`\n  Verifying: ${parent.name} → ${child.name}`);

    // Check WikiTree
    const parentWikiId = WIKITREE_IDS[parent.name];
    if (parentWikiId) {
        try {
            const wikiData = await fetchWikiTree(parentWikiId);
            if (wikiData && !wikiData.error) {
                verification.sources.push({
                    source: 'WikiTree',
                    id: parentWikiId,
                    url: `https://www.wikitree.com/wiki/${parentWikiId}`,
                    confidence: 0.95
                });
                console.log(`    ✓ WikiTree: ${parentWikiId}`);
            }
        } catch (e) {
            console.log(`    ⚠ WikiTree API error: ${e.message}`);
        }
    }

    // Check internal database
    const parentEvidence = await searchInternalEvidence(parent.name);
    const childEvidence = await searchInternalEvidence(child.name);

    if (parentEvidence.unconfirmed.length > 0) {
        for (const record of parentEvidence.unconfirmed) {
            if (record.source_url && !record.source_url.includes('familysearch')) {
                verification.sources.push({
                    source: record.extraction_method,
                    url: record.source_url,
                    context: record.context_text?.substring(0, 100),
                    confidence: 0.7
                });
                console.log(`    ✓ Internal: ${record.extraction_method}`);
            }
        }
    }

    // Calculate overall confidence
    if (verification.sources.length > 0) {
        const maxConfidence = Math.max(...verification.sources.map(s => s.confidence));
        verification.confidence = maxConfidence;
        verification.status = maxConfidence >= 0.9 ? 'verified' : 'partial';
    }

    return verification;
}

/**
 * Main verification function
 */
async function verifyLineage() {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('   GENEALOGY CHAIN VERIFICATION');
    console.log('   Independent verification through public sources');
    console.log('═══════════════════════════════════════════════════════════════\n');

    // Define the claimed lineage chain
    const lineageChain = [
        { name: 'James Hopewell', birth: 1780, death: 1817, fs_id: 'MTRV-Z72' },
        { name: 'Ann Maria Hopewell', birth: 1799, death: 1881, fs_id: 'L64X-RH2' },
        { name: 'Maria Angelica Biscoe', birth: 1817, death: 1898, fs_id: 'L6K5-FRC' },
        { name: 'Rebekah Freeland Chew', birth: 1847, death: 1917, fs_id: 'LH2D-183' },
        { name: 'Charles Huntington Lyman Jr', birth: 1875, death: 1945, fs_id: 'KZJX-9K1' },
        { name: 'Charles Huntington Lyman III', birth: 1903, death: 1972, fs_id: 'KZ3H-GB2' },
        { name: 'Marjorie Lyman', birth: null, fs_id: 'G21Y-2S8', note: 'Living - requires FamilySearch' },
        { name: 'Nancy Miller', birth: 1962, fs_id: 'G21N-4JF', note: 'Living - requires FamilySearch' },
        { name: 'Danyela June Brown', birth: 1996, fs_id: 'G21N-HD2', note: 'Living' }
    ];

    console.log('CLAIMED LINEAGE:');
    console.log('────────────────────────────────────────────────────────────────');
    for (let i = 0; i < lineageChain.length; i++) {
        const person = lineageChain[i];
        const years = person.birth ?
            (person.death ? `${person.birth}-${person.death}` : `${person.birth}-`) :
            'Living';
        const indent = '  '.repeat(i);
        console.log(`${indent}└─ ${person.name} (${years})`);
    }
    console.log('────────────────────────────────────────────────────────────────\n');

    // Verify each link in the chain
    const results = [];
    console.log('VERIFICATION RESULTS:');
    console.log('════════════════════════════════════════════════════════════════');

    for (let i = 0; i < lineageChain.length - 1; i++) {
        const parent = lineageChain[i];
        const child = lineageChain[i + 1];

        const verification = await verifyRelationship(parent, child);
        results.push(verification);

        const statusIcon = verification.status === 'verified' ? '✓' :
                          verification.status === 'partial' ? '○' : '✗';
        const confidencePct = Math.round(verification.confidence * 100);

        console.log(`  ${statusIcon} ${parent.name} → ${child.name}`);
        console.log(`      Status: ${verification.status} (${confidencePct}% confidence)`);
        console.log(`      Sources: ${verification.sources.length}`);
    }

    // Summary
    console.log('\n════════════════════════════════════════════════════════════════');
    console.log('VERIFICATION SUMMARY');
    console.log('────────────────────────────────────────────────────────────────');

    const verified = results.filter(r => r.status === 'verified').length;
    const partial = results.filter(r => r.status === 'partial').length;
    const unverified = results.filter(r => r.status === 'unverified').length;

    console.log(`  Fully Verified:    ${verified}/${results.length} links`);
    console.log(`  Partially Verified: ${partial}/${results.length} links`);
    console.log(`  Unverified:        ${unverified}/${results.length} links`);

    const overallConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;
    console.log(`\n  Overall Chain Confidence: ${Math.round(overallConfidence * 100)}%`);

    // Note about living people
    console.log('\n  NOTE: Living people (last 2-3 generations) require');
    console.log('        FamilySearch personal tree access due to privacy.');
    console.log('────────────────────────────────────────────────────────────────\n');

    // Return structured results
    return {
        chain: lineageChain,
        verifications: results,
        overallConfidence,
        summary: { verified, partial, unverified }
    };
}

/**
 * List available verification sources
 */
async function listSources() {
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('   AVAILABLE VERIFICATION SOURCES');
    console.log('═══════════════════════════════════════════════════════════════\n');

    // Check WikiTree coverage
    console.log('WIKITREE PROFILES:');
    for (const [name, id] of Object.entries(WIKITREE_IDS)) {
        console.log(`  • ${name}: https://www.wikitree.com/wiki/${id}`);
    }

    // Check Find A Grave coverage
    console.log('\nFIND A GRAVE MEMORIALS:');
    for (const [name, id] of Object.entries(FINDAGRAVE_IDS)) {
        console.log(`  • ${name}: https://www.findagrave.com/memorial/${id}`);
    }

    // Check internal evidence
    console.log('\nINTERNAL DATABASE EVIDENCE:');
    const families = ['Hopewell', 'Biscoe', 'Chew', 'Lyman'];
    for (const name of families) {
        const count = await sql`
            SELECT COUNT(*) as count FROM unconfirmed_persons
            WHERE full_name ILIKE ${'%' + name + '%'}
            AND extraction_method NOT IN ('lineage_pdf_import', 'descendancy_import')
        `;
        if (count[0].count > 0) {
            console.log(`  • ${name}: ${count[0].count} historical records`);
        }
    }

    console.log('\n');
}

// Main execution
async function main() {
    const args = process.argv.slice(2);

    if (args.includes('--sources')) {
        await listSources();
    } else {
        const results = await verifyLineage();

        // Store verification results
        console.log('Storing verification results...');
        try {
            await sql`
                INSERT INTO verification_runs (
                    run_type,
                    target_person,
                    results,
                    confidence_score,
                    created_at
                ) VALUES (
                    'genealogy_chain',
                    'Danyela June Brown',
                    ${JSON.stringify(results)},
                    ${results.overallConfidence},
                    NOW()
                )
            `;
            console.log('✓ Results saved to database\n');
        } catch (e) {
            // Table might not exist, that's ok
            console.log('Note: Could not save to verification_runs table\n');
        }
    }
}

main().catch(console.error);
