#!/usr/bin/env node
/**
 * audit-liberty-county-quality.js
 *
 * End-to-end quality check for the Georgia Probate Scraper output,
 * focused on Liberty County (FamilySearch collection 1999178).
 *
 * What this checks:
 *   1. probate_scrape_progress  — status distribution, error inventory
 *   2. person_documents         — field completeness on written records
 *   3. canonical_persons        — testator upsert hit rate
 *   4. unconfirmed_persons      — enslaved person extraction hit rate
 *   5. inheritance_edges        — heir linkage hit rate
 *   6. enslaver_evidence_compendium — evidence registration rate
 *   7. Five estate deep-dives   — full chain from transcript → DB → readable summary
 *   8. Stopword contamination   — scan unconfirmed_persons for known-bad tokens
 *   9. Accuracy score           — weighted composite
 *
 * No writes. Safe to run at any time, including while the scraper is active.
 *
 * Usage:
 *   node scripts/audit-liberty-county-quality.js
 *   node scripts/audit-liberty-county-quality.js --county Chatham
 *   node scripts/audit-liberty-county-quality.js --roll-group 9SYT-PT5
 *   node scripts/audit-liberty-county-quality.js --verbose
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pg = require('pg');

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt  = (n, d = null) => { const i = argv.indexOf(n); return i !== -1 && argv[i+1] ? argv[i+1] : d; };

const COUNTY_FILTER     = opt('--county', 'Liberty');
const ROLL_GROUP_FILTER = opt('--roll-group', null);
const VERBOSE           = flag('--verbose');
const COLLECTION_ID     = '1999178';

// Stopwords that should never appear as enslaved person names.
// Populated from the same set used in the scraper.
const NAME_STOPWORDS = new Set([
    'named','one','by','the','my','said','of','and','to','for','in','at','as',
    'is','it','he','she','his','her','their','our','its','or','but','not',
    'with','from','that','this','also','above','within','same','aforesaid',
    'following','certain','another','given','all','other',
    'man','woman','boy','girl','child','children','wench','fellow','servant',
    'slave','slaves','negro','negroes','old','young','little','big','aged',
    'faithful','trusty','female','male','mulatto','called',
    'two','three','four','five','six','seven','eight','nine','ten','eleven',
    'twelve','fourteen','fifteen','twenty',
    'executor','executrix','executors','witness','witnesses','subscriber',
    'subscribers','rector','deacon',
    'viz','lastly','likewise','furthermore','moreover','whereas','item',
    'valued','purchase','forward','house','field','born','cold','had','ditto',
    'do','gross','pair','mentioned','state','march','day',
    'pr','sew','suc','amht','god','lemale','foltowing',
]);

function sep(char = '─', len = 72) { return char.repeat(len); }
function hdr(t)  { console.log('\n' + sep('═')); console.log('  ' + t); console.log(sep('═')); }
function sub(t)  { console.log('\n' + sep('─')); console.log('  ' + t); console.log(sep('─')); }
function pct(n, d) { return d === 0 ? 'n/a' : ((n / d) * 100).toFixed(1) + '%'; }
function pad(s, w) { return String(s).padEnd(w); }
function rpad(s, w) { return String(s).padStart(w); }

async function main() {
    const client = await pool.connect();
    try {
        const countyClause = COUNTY_FILTER ? `AND p.county ILIKE $1` : `AND TRUE`;
        const countyParam  = COUNTY_FILTER ? [COUNTY_FILTER] : ['%'];

        hdr(`LIBERTY COUNTY QUALITY AUDIT  —  collection ${COLLECTION_ID}  county="${COUNTY_FILTER || 'all'}"`);
        console.log(`  Run at: ${new Date().toISOString()}`);

        // ── 1. Progress table status breakdown ────────────────────────────────
        sub('1. probate_scrape_progress  —  status distribution');

        const statusRes = await client.query(`
            SELECT
                status,
                COUNT(*)::int                                      AS count,
                COUNT(*) FILTER (WHERE record_type = 'will')::int  AS wills,
                COUNT(*) FILTER (WHERE record_type = 'inventory')::int AS inventories,
                COUNT(*) FILTER (WHERE record_type = 'estate_account')::int AS estate_accounts,
                COUNT(*) FILTER (WHERE record_type = 'guardian_account')::int AS guardian_accounts,
                COUNT(*) FILTER (WHERE record_type = 'letters')::int AS letters,
                COUNT(*) FILTER (WHERE record_type = 'other')::int AS other_type
            FROM probate_scrape_progress p
            WHERE collection_id = $1 ${countyClause.replace('$1','$2')}
            GROUP BY status
            ORDER BY count DESC
        `, [COLLECTION_ID, COUNTY_FILTER || '%']);

        let totalImages = 0, writtenCount = 0, failedCount = 0, noTranscriptCount = 0;
        console.log('\n  ' + pad('Status',18) + rpad('Count',8) + rpad('Wills',8) + rpad('Invs',7) + rpad('EstAcc',8) + rpad('GuardAcc',10) + rpad('Letters',9) + rpad('Other',7));
        for (const r of statusRes.rows) {
            totalImages += r.count;
            if (r.status === 'written')      writtenCount      = r.count;
            if (r.status === 'failed')       failedCount       = r.count;
            if (r.status === 'no_transcript') noTranscriptCount = r.count;
            console.log('  ' + pad(r.status,18) + rpad(r.count,8) + rpad(r.wills,8) + rpad(r.inventories,7) + rpad(r.estate_accounts,8) + rpad(r.guardian_accounts,10) + rpad(r.letters,9) + rpad(r.other_type,7));
        }
        console.log('  ' + sep('-', 68));
        console.log('  ' + pad('TOTAL',18) + rpad(totalImages,8));
        console.log(`\n  Coverage: ${pct(writtenCount + noTranscriptCount, totalImages)} processed  |  ${pct(writtenCount, totalImages)} written  |  ${pct(failedCount, totalImages)} failed`);

        if (totalImages === 0) {
            console.log('\n  WARNING: No rows found in probate_scrape_progress for this county.');
            console.log('  The scraper may not have run --apply yet, or the county filter may be wrong.');
            console.log('  Check: SELECT DISTINCT county FROM probate_scrape_progress;');
            return;
        }

        // ── 2. Failed-image error inventory ───────────────────────────────────
        if (failedCount > 0) {
            sub(`2. Failed images (${failedCount} total)  —  error inventory`);
            const failRes = await client.query(`
                SELECT image_number, roll_group_id, error_text, processed_at
                FROM probate_scrape_progress p
                WHERE collection_id = $1 ${countyClause.replace('$1','$2')}
                  AND status = 'failed'
                ORDER BY processed_at DESC
                LIMIT 20
            `, [COLLECTION_ID, COUNTY_FILTER || '%']);
            for (const r of failRes.rows) {
                console.log(`  img ${String(r.image_number).padStart(4)} [${r.roll_group_id}] ${(r.error_text || 'no error text').substring(0, 100)}`);
            }
            if (failedCount > 20) console.log(`  ... and ${failedCount - 20} more.`);
        }

        if (writtenCount === 0) {
            sub('No written records yet — skipping DB join checks.');
            console.log('  Run the scraper with --apply to generate data, then re-run this audit.');
            await printAccuracyScore(0, 0, 0, 0, 0, 0, totalImages, writtenCount);
            return;
        }

        // ── 3. person_documents field completeness ─────────────────────────────
        sub(`3. person_documents  —  field completeness (${writtenCount} written records)`);

        const pdRes = await client.query(`
            SELECT
                COUNT(*)::int                                                 AS total,
                COUNT(*) FILTER (WHERE pd.document_type != 'other')::int      AS typed,
                COUNT(*) FILTER (WHERE pd.document_year IS NOT NULL)::int     AS has_year,
                COUNT(*) FILTER (WHERE pd.name_as_appears IS NOT NULL
                                   AND pd.name_as_appears NOT LIKE 'Image %')::int AS has_testator_name,
                COUNT(*) FILTER (WHERE pd.ocr_text IS NOT NULL
                                   AND LENGTH(pd.ocr_text) > 20)::int         AS has_transcript,
                COUNT(*) FILTER (WHERE pd.s3_key IS NOT NULL)::int            AS has_s3,
                COUNT(*) FILTER (WHERE pd.canonical_person_id IS NOT NULL)::int AS linked_to_canonical,
                COUNT(*) FILTER (WHERE pd.collection_key NOT LIKE '%-unknown-%')::int AS has_valid_collection_key
            FROM probate_scrape_progress p
            JOIN person_documents pd ON pd.id = p.person_document_id
            WHERE p.collection_id = $1 ${countyClause.replace('$1','$2')}
              AND p.status = 'written'
        `, [COLLECTION_ID, COUNTY_FILTER || '%']);

        const pd = pdRes.rows[0];
        const pdTotal = pd.total || 0;
        const fields = [
            ['document_type (not other)',    pd.typed,                pdTotal],
            ['document_year',               pd.has_year,             pdTotal],
            ['testator name',               pd.has_testator_name,    pdTotal],
            ['transcript text (>20 chars)', pd.has_transcript,       pdTotal],
            ['S3 screenshot',               pd.has_s3,               pdTotal],
            ['canonical_person linked',     pd.linked_to_canonical,  pdTotal],
            ['valid collection_key',        pd.has_valid_collection_key, pdTotal],
        ];
        for (const [label, n, d] of fields) {
            const pctStr = pct(n, d);
            const bar = '█'.repeat(Math.round((n / (d || 1)) * 20)).padEnd(20);
            console.log(`  ${pad(label, 30)}  ${rpad(n,5)}/${d}  ${pctStr.padStart(6)}  ${bar}`);
        }

        const pdFieldScore = pdTotal > 0
            ? (pd.typed + pd.has_year + pd.has_testator_name + pd.has_transcript + pd.linked_to_canonical) / (pdTotal * 5)
            : 0;

        // ── 4. canonical_persons  —  testator hit rate ─────────────────────────
        sub('4. canonical_persons  —  testator upsert coverage');

        const cpRes = await client.query(`
            SELECT
                COUNT(DISTINCT cp.id)::int                         AS unique_testators,
                COUNT(DISTINCT cp.id) FILTER (
                    WHERE cp.verification_status = 'pending_review')::int AS pending_review,
                COUNT(DISTINCT cp.id) FILTER (
                    WHERE cp.death_year_estimate IS NOT NULL)::int  AS has_death_year,
                COUNT(DISTINCT cp.id) FILTER (
                    WHERE cp.person_type = 'enslaver')::int         AS typed_enslaver
            FROM probate_scrape_progress p
            JOIN person_documents pd ON pd.id = p.person_document_id
            JOIN canonical_persons cp ON cp.id = pd.canonical_person_id
            WHERE p.collection_id = $1 ${countyClause.replace('$1','$2')}
              AND p.status = 'written'
        `, [COLLECTION_ID, COUNTY_FILTER || '%']);

        const cp = cpRes.rows[0];
        console.log(`\n  Unique testators in canonical_persons:  ${cp.unique_testators}`);
        console.log(`  With death_year_estimate:               ${cp.has_death_year}  (${pct(cp.has_death_year, cp.unique_testators)})`);
        console.log(`  Typed as 'enslaver':                    ${cp.typed_enslaver}  (${pct(cp.typed_enslaver, cp.unique_testators)})`);
        console.log(`  Status pending_review:                  ${cp.pending_review}  (${pct(cp.pending_review, cp.unique_testators)})`);

        // Records written but testator NOT linked
        const unlinkedRes = await client.query(`
            SELECT COUNT(*)::int AS unlinked
            FROM probate_scrape_progress p
            JOIN person_documents pd ON pd.id = p.person_document_id
            WHERE p.collection_id = $1 ${countyClause.replace('$1','$2')}
              AND p.status = 'written'
              AND pd.canonical_person_id IS NULL
              AND p.testator_name IS NOT NULL
        `, [COLLECTION_ID, COUNTY_FILTER || '%']);
        console.log(`  Written with testator name but no canonical_person: ${unlinkedRes.rows[0].unlinked}`);

        // ── 5. unconfirmed_persons  —  enslaved extraction ────────────────────
        sub('5. unconfirmed_persons  —  enslaved person extraction');

        const upRes = await client.query(`
            SELECT
                COUNT(*)::int                                                  AS total_enslaved,
                COUNT(*) FILTER (WHERE up.gender = 'M')::int                  AS male,
                COUNT(*) FILTER (WHERE up.gender = 'F')::int                  AS female,
                COUNT(*) FILTER (WHERE up.gender IS NULL)::int                AS unknown_gender,
                COUNT(*) FILTER (WHERE (up.relationships->>'dollar_value_at_bequeathal') IS NOT NULL
                                   AND up.relationships->>'dollar_value_at_bequeathal' != 'null')::int AS has_dollar_value,
                COUNT(*) FILTER (WHERE (up.relationships->>'bequeathed_by_canonical_id') IS NOT NULL
                                   AND up.relationships->>'bequeathed_by_canonical_id' != 'null')::int AS linked_to_testator,
                COUNT(*) FILTER (WHERE (up.relationships->>'bequeathed_to_canonical_id') IS NOT NULL
                                   AND up.relationships->>'bequeathed_to_canonical_id' != 'null')::int AS linked_to_heir
            FROM probate_scrape_progress p
            JOIN person_documents pd ON pd.id = p.person_document_id
            JOIN unconfirmed_persons up ON up.source_url = pd.source_url
            WHERE p.collection_id = $1 ${countyClause.replace('$1','$2')}
              AND p.status = 'written'
              AND up.person_type = 'enslaved'
              AND up.extraction_method = 'full_text_transcript'
        `, [COLLECTION_ID, COUNTY_FILTER || '%']);

        const up = upRes.rows[0];
        console.log(`\n  Total enslaved persons extracted:   ${up.total_enslaved}`);
        if (up.total_enslaved > 0) {
            console.log(`  Gender M / F / unknown:             ${up.male} / ${up.female} / ${up.unknown_gender}`);
            console.log(`  Linked to testator (canonical_id):  ${up.linked_to_testator}  (${pct(up.linked_to_testator, up.total_enslaved)})`);
            console.log(`  Linked to heir (bequest recipient): ${up.linked_to_heir}  (${pct(up.linked_to_heir, up.total_enslaved)})`);
            console.log(`  Has dollar value:                   ${up.has_dollar_value}  (${pct(up.has_dollar_value, up.total_enslaved)})`);
        }

        // Average enslaved persons per will (of records that have any)
        const avgEnslaved = await client.query(`
            SELECT
                COUNT(*) FILTER (WHERE p.enslaved_count > 0)::int AS records_with_enslaved,
                ROUND(AVG(p.enslaved_count) FILTER (WHERE p.enslaved_count > 0), 1) AS avg_per_record,
                MAX(p.enslaved_count) AS max_per_record
            FROM probate_scrape_progress p
            WHERE p.collection_id = $1 ${countyClause.replace('$1','$2')}
              AND p.status = 'written'
        `, [COLLECTION_ID, COUNTY_FILTER || '%']);
        const av = avgEnslaved.rows[0];
        console.log(`  Records with ≥1 enslaved person:    ${av.records_with_enslaved}  (${pct(av.records_with_enslaved, writtenCount)} of written)`);
        if (av.avg_per_record) {
            console.log(`  Avg enslaved per such record:       ${av.avg_per_record}  (max: ${av.max_per_record})`);
        }

        // ── 6. inheritance_edges  —  heir linkage ─────────────────────────────
        sub('6. inheritance_edges  —  testator→heir linkage');

        const ieRes = await client.query(`
            SELECT
                COUNT(*)::int                                                    AS total_edges,
                COUNT(*) FILTER (WHERE ie.asset_type = 'enslaved_persons')::int  AS enslaved_edges,
                COUNT(*) FILTER (WHERE ie.asset_type = 'unspecified')::int       AS unspecified_edges,
                COUNT(DISTINCT ie.testator_id)::int                              AS unique_testators,
                COUNT(DISTINCT ie.heir_id)::int                                  AS unique_heirs,
                ROUND(AVG(ie.confidence)::numeric, 3)                            AS avg_confidence
            FROM probate_scrape_progress p
            JOIN person_documents pd ON pd.id = p.person_document_id
            JOIN inheritance_edges ie ON ie.source_document_id = pd.id
            WHERE p.collection_id = $1 ${countyClause.replace('$1','$2')}
              AND p.status = 'written'
        `, [COLLECTION_ID, COUNTY_FILTER || '%']);

        const ie = ieRes.rows[0];
        console.log(`\n  Total inheritance_edges:            ${ie.total_edges}`);
        if (ie.total_edges > 0) {
            console.log(`  Enslaved-person bequest edges:      ${ie.enslaved_edges}`);
            console.log(`  Unspecified (heir-only) edges:      ${ie.unspecified_edges}`);
            console.log(`  Unique testators with edges:        ${ie.unique_testators}`);
            console.log(`  Unique heirs:                       ${ie.unique_heirs}`);
            console.log(`  Avg confidence:                     ${ie.avg_confidence}`);
        } else {
            console.log('  No inheritance_edges found. Heirs may not be extracting correctly.');
        }

        // ── 7. enslaver_evidence_compendium ───────────────────────────────────
        sub('7. enslaver_evidence_compendium  —  evidence registration');

        const eecRes = await client.query(`
            SELECT COUNT(*)::int AS total_evidence_rows
            FROM probate_scrape_progress p
            JOIN person_documents pd ON pd.id = p.person_document_id
            JOIN enslaver_evidence_compendium eec ON eec.evidence_source_id = pd.id::text
            WHERE p.collection_id = $1 ${countyClause.replace('$1','$2')}
              AND p.status = 'written'
              AND eec.evidence_source_table = 'person_documents'
        `, [COLLECTION_ID, COUNTY_FILTER || '%']);
        console.log(`\n  enslaver_evidence_compendium rows for this county: ${eecRes.rows[0].total_evidence_rows}`);
        console.log(`  Expected: 1 per testator-linked written record (=${pd.linked_to_canonical})`);

        // ── 8. Stopword contamination check ───────────────────────────────────
        sub('8. Stopword contamination  —  unconfirmed_persons name quality');

        const nameRes = await client.query(`
            SELECT up.full_name, COUNT(*)::int AS occurrences
            FROM probate_scrape_progress p
            JOIN person_documents pd ON pd.id = p.person_document_id
            JOIN unconfirmed_persons up ON up.source_url = pd.source_url
            WHERE p.collection_id = $1 ${countyClause.replace('$1','$2')}
              AND p.status = 'written'
              AND up.person_type = 'enslaved'
              AND up.extraction_method = 'full_text_transcript'
            GROUP BY up.full_name
            ORDER BY occurrences DESC
            LIMIT 50
        `, [COLLECTION_ID, COUNTY_FILTER || '%']);

        const contaminated = nameRes.rows.filter(r =>
            NAME_STOPWORDS.has((r.full_name || '').toLowerCase().trim()) ||
            /^\d+$/.test((r.full_name || '').trim()) ||
            (r.full_name || '').length < 2
        );

        if (contaminated.length === 0) {
            console.log('\n  No stopword contamination detected in top-50 names.');
        } else {
            console.log(`\n  CONTAMINATED names found (${contaminated.length} — should be 0):`);
            for (const r of contaminated) {
                console.log(`    "${r.full_name}" × ${r.occurrences}`);
            }
        }

        if (VERBOSE) {
            console.log('\n  Top 20 extracted enslaved names:');
            nameRes.rows.slice(0, 20).forEach(r =>
                console.log(`    ${pad(r.full_name || '(null)', 25)} × ${r.occurrences}`)
            );
        }

        // ── 9. Five estate deep-dives ─────────────────────────────────────────
        sub('9. Five-estate end-to-end chain');

        const estateRes = await client.query(`
            SELECT
                p.image_number,
                p.roll_group_id,
                p.record_type,
                p.testator_name,
                p.enslaved_count,
                p.person_document_id,
                pd.document_year,
                pd.source_url,
                pd.canonical_person_id,
                cp.canonical_name       AS testator_canonical_name,
                cp.death_year_estimate  AS testator_death_year,
                cp.verification_status  AS testator_status
            FROM probate_scrape_progress p
            JOIN person_documents pd ON pd.id = p.person_document_id
            LEFT JOIN canonical_persons cp ON cp.id = pd.canonical_person_id
            WHERE p.collection_id = $1 ${countyClause.replace('$1','$2')}
              AND p.status = 'written'
              AND p.record_type = 'will'
              AND p.testator_name IS NOT NULL
            ORDER BY p.enslaved_count DESC NULLS LAST, p.image_number ASC
            LIMIT 5
        `, [COLLECTION_ID, COUNTY_FILTER || '%']);

        if (estateRes.rows.length === 0) {
            console.log('\n  No written will records found yet for deep-dive.');
        }

        for (const [i, estate] of estateRes.rows.entries()) {
            console.log(`\n  Estate ${i + 1}: Image ${estate.image_number} [${estate.roll_group_id}]`);
            console.log(`  ├─ Record type:    ${estate.record_type}`);
            console.log(`  ├─ Testator name:  ${estate.testator_name || '(none extracted)'}`);
            console.log(`  ├─ Doc year:       ${estate.document_year || '(none)'}`);
            console.log(`  ├─ Enslaved count: ${estate.enslaved_count}`);
            console.log(`  ├─ person_doc id:  ${estate.person_document_id}`);

            if (estate.testator_canonical_name) {
                console.log(`  ├─ canonical_person: id=${estate.canonical_person_id} "${estate.testator_canonical_name}" d.${estate.testator_death_year || '?'} [${estate.testator_status}]`);
            } else {
                console.log(`  ├─ canonical_person: NOT LINKED`);
            }

            if (!estate.person_document_id) continue;

            // Heirs
            const heirs = await client.query(`
                SELECT cp2.canonical_name AS heir_name, ie.asset_type, ie.asset_description, ie.confidence
                FROM inheritance_edges ie
                JOIN canonical_persons cp2 ON cp2.id = ie.heir_id
                WHERE ie.source_document_id = $1
                ORDER BY ie.asset_type, cp2.canonical_name
            `, [estate.person_document_id]);
            if (heirs.rows.length > 0) {
                console.log(`  ├─ Heirs (${heirs.rows.length}):`);
                for (const h of heirs.rows) {
                    console.log(`  │    ${h.heir_name}  [${h.asset_type}]  conf=${h.confidence}`);
                }
            } else {
                console.log(`  ├─ Heirs: none recorded`);
            }

            // Enslaved persons
            const enslaved = await client.query(`
                SELECT up.full_name, up.gender,
                       up.relationships->>'dollar_value_at_bequeathal' AS dollar_value,
                       up.relationships->>'bequeathed_to_canonical_id' AS heir_id
                FROM unconfirmed_persons up
                JOIN person_documents pd ON pd.source_url = up.source_url
                WHERE pd.id = $1
                  AND up.person_type = 'enslaved'
                  AND up.extraction_method = 'full_text_transcript'
                ORDER BY up.full_name
            `, [estate.person_document_id]);
            if (enslaved.rows.length > 0) {
                console.log(`  ├─ Enslaved persons (${enslaved.rows.length}):`);
                for (const ep of enslaved.rows) {
                    const val   = ep.dollar_value && ep.dollar_value !== 'null' ? `$${ep.dollar_value}` : '';
                    const heir  = ep.heir_id && ep.heir_id !== 'null' ? `→heir_id=${ep.heir_id}` : '';
                    console.log(`  │    ${pad(ep.full_name, 20)} ${ep.gender || '?'}  ${val}  ${heir}`);
                }
            } else {
                console.log(`  └─ Enslaved persons: none extracted`);
            }

            console.log(`  └─ Source: ${estate.source_url}`);
        }

        // ── 10. Accuracy score ────────────────────────────────────────────────
        await printAccuracyScore(
            pdFieldScore,
            pd.linked_to_canonical, pdTotal,
            up.total_enslaved, up.linked_to_testator,
            ie.total_edges,
            totalImages, writtenCount,
            contaminated.length
        );

    } finally {
        client.release();
        await pool.end();
    }
}

async function printAccuracyScore(fieldScore, linked, total, enslaved, enslavedLinked, edges, allImages, written, contamCount = 0) {
    hdr('ACCURACY SCORE  —  composite quality estimate');

    // Component weights
    const components = [
        {
            label: 'Field completeness (year, type, name, transcript, canonical link)',
            score: fieldScore,
            weight: 0.30,
        },
        {
            label: 'Testator → canonical_person link rate',
            score: total > 0 ? linked / total : 0,
            weight: 0.25,
        },
        {
            label: 'Enslaved persons extracted & linked to testator',
            score: enslaved > 0 ? enslavedLinked / enslaved : (written > 0 ? 0.5 : 0),
            weight: 0.25,
        },
        {
            label: 'Inheritance edges created',
            score: written > 0 ? Math.min(edges / (written * 0.5), 1.0) : 0,
            weight: 0.15,
        },
        {
            label: 'Stopword contamination absent',
            score: contamCount === 0 ? 1.0 : Math.max(0, 1 - contamCount / 10),
            weight: 0.05,
        },
    ];

    let composite = 0;
    for (const c of components) {
        const pctStr = (c.score * 100).toFixed(1) + '%';
        const bar = '█'.repeat(Math.round(c.score * 20)).padEnd(20);
        console.log(`\n  ${c.label}`);
        console.log(`    Score: ${pctStr.padStart(6)}  weight ${(c.weight * 100).toFixed(0)}%  ${bar}`);
        composite += c.score * c.weight;
    }

    const target = 0.95;
    const compositeStr = (composite * 100).toFixed(1) + '%';
    console.log('\n' + sep('─'));
    console.log(`  COMPOSITE ACCURACY:  ${compositeStr}  (target: ${(target * 100).toFixed(0)}%)`);

    if (written === 0) {
        console.log('  STATUS: No written records yet. Run --apply step first.');
    } else if (composite >= target) {
        console.log('  STATUS: TARGET REACHED. Ready to run full-county and all-county passes.');
    } else if (composite >= 0.80) {
        console.log('  STATUS: Good but not yet at 95%. Fix the lowest-scoring components above.');
    } else if (composite >= 0.60) {
        console.log('  STATUS: Moderate. Significant gaps remain — review estate deep-dives above.');
    } else {
        console.log('  STATUS: Low accuracy. Check for systematic parsing failures before proceeding.');
    }

    console.log(`\n  Images processed: ${written + (allImages - written)} total  |  ${written} written  |  ${allImages - written} remaining`);
    console.log(sep('═') + '\n');
}

main().catch(err => {
    console.error('FATAL:', err.message);
    if (process.env.NODE_ENV !== 'production') console.error(err.stack);
    process.exit(1);
});
