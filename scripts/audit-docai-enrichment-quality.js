#!/usr/bin/env node
/**
 * audit-docai-enrichment-quality.js
 *
 * Read-only QC audit of Freedman's Bank DocAI enrichment results.
 * Safe to run from MacBook at any time — zero writes, zero impact on
 * the enrichment running on Mac Mini.
 *
 * Reports:
 *   1. Overall enrichment progress + coverage by branch
 *   2. Per-field extraction rates (what % of enriched records have each field)
 *   3. Confidence distribution across all enriched records
 *   4. parse_failure_queue breakdown (why records were flagged)
 *   5. Top 25 last_master values — human spot-check
 *   6. Top 25 plantation values
 *   7. Suspicious conf=1.00 + no critical fields (likely stale FamilySearch session)
 *   8. False-positive rate per branch
 *   9. Field-level confidence breakdown for critical fields
 *  10. Sample records: lowest-confidence enrichments (for manual review)
 *
 * Usage:
 *   node scripts/audit-docai-enrichment-quality.js
 *   node scripts/audit-docai-enrichment-quality.js --branch-like "Washington"
 *   node scripts/audit-docai-enrichment-quality.js --top 50   # show top N values
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Pool } = require('pg');

const argv = process.argv.slice(2);
const opt = (name, def = null) => {
    const i = argv.indexOf(name);
    return (i !== -1 && argv[i + 1]) ? argv[i + 1] : def;
};
const BRANCH_LIKE = opt('--branch-like');
const TOP_N       = parseInt(opt('--top', '25'));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 3,
});

const CRITICAL_FIELDS = ['last_master', 'last_mistress', 'plantation', 'old_title'];
const ALL_FIELDS = [
    'account_number', 'date_of_entry',
    'depositor_name', 'birthplace', 'where_brought_up', 'age', 'residence',
    'complexion', 'occupation', 'employer',
    'marital_status', 'spouse_name', 'spouse_residence', 'father_name',
    'mother_name', 'siblings_names', 'children_names', 'family_residences',
    'spouse_father', 'spouse_mother', 'spouse_siblings',
    'last_master', 'last_mistress', 'plantation', 'slave_residence', 'old_title',
    'union_lines', 'post_emancipation',
    'signature', 'further_facts', 'remarks',
];

function sep(char = '─', len = 72) { return char.repeat(len); }
function header(title) {
    console.log('\n' + sep('═'));
    console.log('  ' + title);
    console.log(sep('═'));
}
function sub(title) {
    console.log('\n' + sep('─'));
    console.log('  ' + title);
    console.log(sep('─'));
}

const branchClause = BRANCH_LIKE
    ? `AND EXISTS (SELECT 1 FROM unnest(locations) loc WHERE loc ILIKE '%${BRANCH_LIKE.replace(/'/g, "''")}%')`
    : '';

async function run() {
    console.log('\n' + sep('═'));
    console.log('  DOCAI ENRICHMENT QUALITY AUDIT  —  ' + new Date().toISOString());
    if (BRANCH_LIKE) console.log(`  Filter: branch ILIKE '%${BRANCH_LIKE}%'`);
    console.log(sep('═'));

    // ── 1. Overall progress ───────────────────────────────────────────────────
    header('1. OVERALL ENRICHMENT PROGRESS');

    const totals = await pool.query(`
        SELECT
            COUNT(*)                                                                    AS total,
            COUNT(*) FILTER (WHERE review_notes ILIKE '%docai_enrichment%')            AS enriched,
            COUNT(*) FILTER (
                WHERE review_notes ILIKE '%docai_enrichment%'
                AND relationships IS NOT NULL
                AND relationships::text ILIKE '%docai_fields%'
            )                                                                           AS has_docai_fields
        FROM unconfirmed_persons
        WHERE extraction_method = 'freedmens_bank_index'
        ${branchClause}
    `);
    const t = totals.rows[0];
    const enrichedN  = parseInt(t.enriched);
    const totalN     = parseInt(t.total);
    const pct        = totalN > 0 ? (enrichedN / totalN * 100).toFixed(2) : '0.00';
    const hasFields  = parseInt(t.has_docai_fields);

    console.log(`\n  Total depositors:        ${totalN.toLocaleString()}`);
    console.log(`  Enriched (tagged):       ${enrichedN.toLocaleString()}  (${pct}%)`);
    console.log(`  With docai_fields JSONB: ${hasFields.toLocaleString()}`);
    console.log(`  Remaining:               ${(totalN - enrichedN).toLocaleString()}`);

    // ── 2. Per-branch enrichment coverage ────────────────────────────────────
    sub('2. PER-BRANCH ENRICHMENT COVERAGE');

    const byBranch = await pool.query(`
        SELECT
            COALESCE(locations[1], '(no branch)') AS branch,
            COUNT(*)                               AS total,
            COUNT(*) FILTER (WHERE review_notes ILIKE '%docai_enrichment%') AS enriched,
            COUNT(*) FILTER (
                WHERE review_notes ILIKE '%docai_enrichment%'
                AND relationships::text ILIKE '%last_master%'
            )                                       AS has_last_master
        FROM unconfirmed_persons
        WHERE extraction_method = 'freedmens_bank_index'
        ${branchClause}
        GROUP BY locations[1]
        ORDER BY total DESC
    `);

    console.log(
        '  ' +
        'Branch'.padEnd(45) +
        'Total'.padStart(8) +
        'Enriched'.padStart(10) +
        'Pct'.padStart(7) +
        'last_master%'.padStart(14)
    );
    console.log('  ' + sep('-', 82));
    for (const r of byBranch.rows) {
        const tot = parseInt(r.total);
        const enr = parseInt(r.enriched);
        const lm  = parseInt(r.has_last_master);
        const ep  = tot > 0 ? (enr / tot * 100).toFixed(1) : '0.0';
        const lmp = enr > 0 ? (lm  / enr * 100).toFixed(1) : '0.0';
        const flag = enr === 0 ? ' ← not started' : enr < tot ? ' ← partial' : ' ✓';
        console.log(
            '  ' +
            String(r.branch).padEnd(45) +
            String(tot).padStart(8) +
            String(enr).padStart(10) +
            `${ep}%`.padStart(7) +
            `${lmp}%`.padStart(14) +
            flag
        );
    }

    // ── 3. Per-field extraction rates ─────────────────────────────────────────
    sub('3. PER-FIELD EXTRACTION RATES  (of enriched records with docai_fields)');

    // Count how many enriched records have each field non-null
    const fieldStats = await pool.query(`
        SELECT
            COUNT(*) AS enriched_total,
            -- Critical fields
            COUNT(*) FILTER (WHERE relationships->'docai_fields'->>'last_master'   IS NOT NULL AND relationships->'docai_fields'->>'last_master'   <> '') AS last_master,
            COUNT(*) FILTER (WHERE relationships->'docai_fields'->>'last_mistress' IS NOT NULL AND relationships->'docai_fields'->>'last_mistress' <> '') AS last_mistress,
            COUNT(*) FILTER (WHERE relationships->'docai_fields'->>'plantation'    IS NOT NULL AND relationships->'docai_fields'->>'plantation'    <> '') AS plantation,
            COUNT(*) FILTER (WHERE relationships->'docai_fields'->>'old_title'     IS NOT NULL AND relationships->'docai_fields'->>'old_title'     <> '') AS old_title,
            -- Biographical
            COUNT(*) FILTER (WHERE relationships->'docai_fields'->>'depositor_name' IS NOT NULL AND relationships->'docai_fields'->>'depositor_name' <> '') AS depositor_name,
            COUNT(*) FILTER (WHERE relationships->'docai_fields'->>'birthplace'    IS NOT NULL AND relationships->'docai_fields'->>'birthplace'    <> '') AS birthplace,
            COUNT(*) FILTER (WHERE relationships->'docai_fields'->>'age'           IS NOT NULL AND relationships->'docai_fields'->>'age'           <> '') AS age,
            COUNT(*) FILTER (WHERE relationships->'docai_fields'->>'occupation'    IS NOT NULL AND relationships->'docai_fields'->>'occupation'    <> '') AS occupation,
            COUNT(*) FILTER (WHERE relationships->'docai_fields'->>'complexion'    IS NOT NULL AND relationships->'docai_fields'->>'complexion'    <> '') AS complexion,
            COUNT(*) FILTER (WHERE relationships->'docai_fields'->>'residence'     IS NOT NULL AND relationships->'docai_fields'->>'residence'     <> '') AS residence,
            -- Family
            COUNT(*) FILTER (WHERE relationships->'docai_fields'->>'father_name'   IS NOT NULL AND relationships->'docai_fields'->>'father_name'   <> '') AS father_name,
            COUNT(*) FILTER (WHERE relationships->'docai_fields'->>'mother_name'   IS NOT NULL AND relationships->'docai_fields'->>'mother_name'   <> '') AS mother_name,
            COUNT(*) FILTER (WHERE relationships->'docai_fields'->>'spouse_name'   IS NOT NULL AND relationships->'docai_fields'->>'spouse_name'   <> '') AS spouse_name,
            COUNT(*) FILTER (WHERE relationships->'docai_fields'->>'children_names' IS NOT NULL AND relationships->'docai_fields'->>'children_names' <> '') AS children_names,
            COUNT(*) FILTER (WHERE relationships->'docai_fields'->>'siblings_names' IS NOT NULL AND relationships->'docai_fields'->>'siblings_names' <> '') AS siblings_names,
            -- Account
            COUNT(*) FILTER (WHERE relationships->'docai_fields'->>'account_number' IS NOT NULL AND relationships->'docai_fields'->>'account_number' <> '') AS account_number,
            COUNT(*) FILTER (WHERE relationships->'docai_fields'->>'date_of_entry'  IS NOT NULL AND relationships->'docai_fields'->>'date_of_entry'  <> '') AS date_of_entry
        FROM unconfirmed_persons
        WHERE extraction_method = 'freedmens_bank_index'
        AND review_notes ILIKE '%docai_enrichment%'
        AND relationships IS NOT NULL
        AND relationships::text ILIKE '%docai_fields%'
        ${branchClause}
    `);

    if (fieldStats.rows.length > 0) {
        const fs = fieldStats.rows[0];
        const etot = parseInt(fs.enriched_total) || 1;

        const FIELD_GROUPS = [
            { label: '── CRITICAL (enslaver / provenance) ──', fields: ['last_master','last_mistress','plantation','old_title'] },
            { label: '── BIOGRAPHICAL ──', fields: ['depositor_name','birthplace','age','complexion','occupation','residence'] },
            { label: '── FAMILY ──', fields: ['father_name','mother_name','spouse_name','children_names','siblings_names'] },
            { label: '── ACCOUNT ──', fields: ['account_number','date_of_entry'] },
        ];

        for (const grp of FIELD_GROUPS) {
            console.log(`\n  ${grp.label}`);
            for (const f of grp.fields) {
                const cnt = parseInt(fs[f]) || 0;
                const pct = (cnt / etot * 100).toFixed(1);
                const bar = '█'.repeat(Math.round(cnt / etot * 30));
                const isCrit = CRITICAL_FIELDS.includes(f);
                console.log(`  ${(isCrit ? '★ ' : '  ') + f.padEnd(20)} ${String(cnt).padStart(7)}  ${(pct + '%').padStart(6)}  ${bar}`);
            }
        }
        console.log(`\n  Total enriched records in this query: ${etot.toLocaleString()}`);
    }

    // ── 4. Confidence distribution ────────────────────────────────────────────
    sub('4. CONFIDENCE DISTRIBUTION  (avg confidence per record)');

    // We stored avg confidence inside _fp_warnings context — let's use a proxy:
    // last_master_confidence as a representative critical field confidence
    const confDist = await pool.query(`
        SELECT
            COUNT(*) FILTER (WHERE (relationships->'docai_fields'->>'last_master_confidence')::numeric >= 0.9)  AS conf_excellent,
            COUNT(*) FILTER (WHERE (relationships->'docai_fields'->>'last_master_confidence')::numeric >= 0.7
                                AND (relationships->'docai_fields'->>'last_master_confidence')::numeric < 0.9)  AS conf_good,
            COUNT(*) FILTER (WHERE (relationships->'docai_fields'->>'last_master_confidence')::numeric >= 0.4
                                AND (relationships->'docai_fields'->>'last_master_confidence')::numeric < 0.7)  AS conf_low,
            COUNT(*) FILTER (WHERE (relationships->'docai_fields'->>'last_master_confidence')::numeric < 0.4)   AS conf_fail,
            COUNT(*) FILTER (WHERE relationships->'docai_fields'->>'last_master_confidence' IS NULL
                                AND relationships::text ILIKE '%docai_fields%')                                  AS conf_no_lm,
            COUNT(*) AS total_enriched
        FROM unconfirmed_persons
        WHERE extraction_method = 'freedmens_bank_index'
        AND review_notes ILIKE '%docai_enrichment%'
        AND relationships IS NOT NULL
        ${branchClause}
    `);

    if (confDist.rows.length > 0) {
        const cd = confDist.rows[0];
        const ct = parseInt(cd.total_enriched) || 1;
        console.log(`\n  last_master_confidence distribution (${ct.toLocaleString()} enriched records with data):`);
        console.log(`  0.90–1.00 (excellent): ${String(cd.conf_excellent).padStart(7)}  (${(cd.conf_excellent/ct*100).toFixed(1)}%)`);
        console.log(`  0.70–0.89 (good):      ${String(cd.conf_good).padStart(7)}  (${(cd.conf_good/ct*100).toFixed(1)}%)`);
        console.log(`  0.40–0.69 (low):       ${String(cd.conf_low).padStart(7)}  (${(cd.conf_low/ct*100).toFixed(1)}%)`);
        console.log(`  0.00–0.39 (failed):    ${String(cd.conf_fail).padStart(7)}  (${(cd.conf_fail/ct*100).toFixed(1)}%)`);
        console.log(`  (no last_master field):${String(cd.conf_no_lm).padStart(7)}  (${(cd.conf_no_lm/ct*100).toFixed(1)}%)`);
    }

    // ── 5. parse_failure_queue breakdown ─────────────────────────────────────
    sub('5. PARSE FAILURE QUEUE  (records flagged for human review)');

    try {
        const pfq = await pool.query(`
            SELECT
                failure_reason,
                COUNT(*)::int AS cnt,
                AVG(engine_confidence)::numeric(5,3) AS avg_conf,
                MIN(created_at) AS first_seen,
                MAX(created_at) AS last_seen
            FROM parse_failure_queue
            WHERE document_type = 'freedmens_bank_ledger_page'
            ${BRANCH_LIKE ? `AND source_identifier ILIKE '%${BRANCH_LIKE.replace(/'/g,"''")}%'` : ''}
            GROUP BY failure_reason
            ORDER BY cnt DESC
        `);

        if (pfq.rows.length === 0) {
            console.log('\n  (no entries yet — parse_failure_queue may use different column names)');
        } else {
            const pfqTotal = pfq.rows.reduce((s, r) => s + r.cnt, 0);
            console.log(`\n  Total flagged: ${pfqTotal.toLocaleString()}`);
            console.log(`\n  ${'Reason'.padEnd(35)} ${'Count'.padStart(8)} ${'Avg conf'.padStart(10)}`);
            console.log('  ' + sep('-', 55));
            for (const r of pfq.rows) {
                console.log(
                    '  ' + String(r.failure_reason).padEnd(35) +
                    String(r.cnt).padStart(8) +
                    String(r.avg_conf || '—').padStart(10)
                );
            }
        }
    } catch (e) {
        console.log(`\n  (parse_failure_queue query failed: ${e.message})`);
        console.log('  This is expected if migration 044 used different column names.');
    }

    // ── 6. Top N last_master values ───────────────────────────────────────────
    sub(`6. TOP ${TOP_N} last_master VALUES  (human spot-check for quality)`);

    const topMasters = await pool.query(`
        SELECT
            relationships->'docai_fields'->>'last_master' AS last_master,
            COUNT(*)::int                                  AS freq,
            AVG((relationships->'docai_fields'->>'last_master_confidence')::numeric)::numeric(4,2) AS avg_conf
        FROM unconfirmed_persons
        WHERE extraction_method = 'freedmens_bank_index'
        AND review_notes ILIKE '%docai_enrichment%'
        AND relationships->'docai_fields'->>'last_master' IS NOT NULL
        AND relationships->'docai_fields'->>'last_master' <> ''
        ${branchClause}
        GROUP BY relationships->'docai_fields'->>'last_master'
        ORDER BY freq DESC
        LIMIT ${TOP_N}
    `);

    if (topMasters.rows.length === 0) {
        console.log('\n  (no last_master values extracted yet)');
    } else {
        console.log(`\n  ${'last_master value'.padEnd(40)} ${'Freq'.padStart(6)} ${'Avg conf'.padStart(10)}`);
        console.log('  ' + sep('-', 58));
        for (const r of topMasters.rows) {
            console.log(
                '  ' + String(r.last_master).substring(0, 39).padEnd(40) +
                String(r.freq).padStart(6) +
                String(r.avg_conf || '—').padStart(10)
            );
        }
    }

    // ── 7. Top N plantation values ────────────────────────────────────────────
    sub(`7. TOP ${TOP_N} plantation VALUES`);

    const topPlantations = await pool.query(`
        SELECT
            relationships->'docai_fields'->>'plantation' AS plantation,
            COUNT(*)::int                                 AS freq
        FROM unconfirmed_persons
        WHERE extraction_method = 'freedmens_bank_index'
        AND review_notes ILIKE '%docai_enrichment%'
        AND relationships->'docai_fields'->>'plantation' IS NOT NULL
        AND relationships->'docai_fields'->>'plantation' <> ''
        ${branchClause}
        GROUP BY relationships->'docai_fields'->>'plantation'
        ORDER BY freq DESC
        LIMIT ${TOP_N}
    `);

    if (topPlantations.rows.length === 0) {
        console.log('\n  (no plantation values extracted yet)');
    } else {
        console.log(`\n  ${'plantation value'.padEnd(45)} ${'Freq'.padStart(6)}`);
        console.log('  ' + sep('-', 53));
        for (const r of topPlantations.rows) {
            console.log('  ' + String(r.plantation).substring(0, 44).padEnd(45) + String(r.freq).padStart(6));
        }
    }

    // ── 8. Suspicious: conf=1.00 + no critical fields ────────────────────────
    sub('8. SUSPICIOUS: high conf=1.00 but NO critical fields  (likely login-page screenshots)');

    const suspicious = await pool.query(`
        SELECT
            COUNT(*) AS cnt,
            COUNT(*) FILTER (WHERE COALESCE(locations[1], '') ILIKE '%washington%') AS dc,
            COUNT(*) FILTER (WHERE COALESCE(locations[1], '') ILIKE '%charleston%') AS charleston,
            COUNT(*) FILTER (WHERE COALESCE(locations[1], '') ILIKE '%richmond%')  AS richmond
        FROM unconfirmed_persons
        WHERE extraction_method = 'freedmens_bank_index'
        AND review_notes ILIKE '%docai_enrichment%'
        AND relationships IS NOT NULL
        AND relationships::text ILIKE '%docai_fields%'
        -- last_master_confidence = 1.0 BUT last_master is null/empty
        AND (relationships->'docai_fields'->>'last_master_confidence')::numeric = 1.0
        AND (
            relationships->'docai_fields'->>'last_master'   IS NULL OR
            relationships->'docai_fields'->>'last_master'   = ''
        )
        AND (
            relationships->'docai_fields'->>'plantation'    IS NULL OR
            relationships->'docai_fields'->>'plantation'    = ''
        )
        AND (
            relationships->'docai_fields'->>'last_mistress' IS NULL OR
            relationships->'docai_fields'->>'last_mistress' = ''
        )
        ${branchClause}
    `);

    // Also check: enriched records with ZERO fields extracted at all
    const zeroFields = await pool.query(`
        SELECT COUNT(*) AS cnt
        FROM unconfirmed_persons
        WHERE extraction_method = 'freedmens_bank_index'
        AND review_notes ILIKE '%docai_enrichment%'
        AND relationships IS NOT NULL
        AND (
            relationships->'docai_fields' IS NULL
            OR relationships->'docai_fields' = '{}'::jsonb
            OR (
                relationships->'docai_fields'->>'last_master'   IS NULL OR relationships->'docai_fields'->>'last_master' = ''
            ) AND (
                relationships->'docai_fields'->>'last_mistress' IS NULL OR relationships->'docai_fields'->>'last_mistress' = ''
            ) AND (
                relationships->'docai_fields'->>'plantation'    IS NULL OR relationships->'docai_fields'->>'plantation' = ''
            ) AND (
                relationships->'docai_fields'->>'old_title'     IS NULL OR relationships->'docai_fields'->>'old_title' = ''
            ) AND (
                relationships->'docai_fields'->>'depositor_name' IS NULL OR relationships->'docai_fields'->>'depositor_name' = ''
            )
        )
        ${branchClause}
    `);

    const sr = suspicious.rows[0];
    console.log(`\n  Records with conf=1.00 + no critical fields:  ${sr.cnt.toLocaleString()}`);
    if (parseInt(sr.cnt) > 0) {
        console.log(`    DC: ${sr.dc}   Charleston: ${sr.charleston}   Richmond: ${sr.richmond}`);
        console.log(`  ⚠ These are candidates for --reprocess (FamilySearch session may have been logged out)`);
    }
    console.log(`  Records enriched but all critical fields empty: ${parseInt(zeroFields.rows[0].cnt).toLocaleString()}`);

    // ── 9. False-positive rate ────────────────────────────────────────────────
    sub('9. FALSE-POSITIVE WARNINGS  (fields removed by validator)');

    const fpStats = await pool.query(`
        SELECT
            COUNT(*) AS total_enriched,
            COUNT(*) FILTER (
                WHERE relationships->'docai_fields'->'_fp_warnings' IS NOT NULL
                AND jsonb_array_length(relationships->'docai_fields'->'_fp_warnings') > 0
            )                                                              AS fp_warned,
            COUNT(*) FILTER (
                WHERE relationships->'docai_fields'->'_fp_rejected_fields' IS NOT NULL
                AND jsonb_array_length(relationships->'docai_fields'->'_fp_rejected_fields') > 0
            )                                                              AS fp_rejected
        FROM unconfirmed_persons
        WHERE extraction_method = 'freedmens_bank_index'
        AND review_notes ILIKE '%docai_enrichment%'
        AND relationships IS NOT NULL
        AND relationships::text ILIKE '%docai_fields%'
        ${branchClause}
    `);

    if (fpStats.rows.length > 0) {
        const fp = fpStats.rows[0];
        const ft = parseInt(fp.total_enriched) || 1;
        const warned   = parseInt(fp.fp_warned);
        const rejected = parseInt(fp.fp_rejected);
        console.log(`\n  Total enriched with docai_fields: ${ft.toLocaleString()}`);
        console.log(`  Had ≥1 FP warning:   ${warned.toLocaleString()}  (${(warned/ft*100).toFixed(1)}%)`);
        console.log(`  Had ≥1 field removed: ${rejected.toLocaleString()}  (${(rejected/ft*100).toFixed(1)}%)`);

        // Most common FP warning messages
        const fpSamples = await pool.query(`
            SELECT
                warning_text,
                COUNT(*)::int AS cnt
            FROM (
                SELECT jsonb_array_elements_text(
                    relationships->'docai_fields'->'_fp_warnings'
                ) AS warning_text
                FROM unconfirmed_persons
                WHERE extraction_method = 'freedmens_bank_index'
                AND review_notes ILIKE '%docai_enrichment%'
                AND relationships->'docai_fields'->'_fp_warnings' IS NOT NULL
                ${branchClause}
                LIMIT 5000
            ) sub
            GROUP BY warning_text
            ORDER BY cnt DESC
            LIMIT 15
        `);

        if (fpSamples.rows.length > 0) {
            console.log('\n  Most common FP warning types:');
            for (const r of fpSamples.rows) {
                console.log(`    ${String(r.cnt).padStart(6)}×  ${r.warning_text.substring(0, 80)}`);
            }
        }
    }

    // ── 10. Sample lowest-confidence records ─────────────────────────────────
    sub('10. LOWEST-CONFIDENCE ENRICHMENTS  (sample for manual review)');

    const lowConf = await pool.query(`
        SELECT
            lead_id,
            full_name,
            COALESCE(locations[1], '(no branch)') AS branch,
            relationships->'docai_fields'->>'last_master'            AS last_master,
            relationships->'docai_fields'->>'last_master_confidence' AS lm_conf,
            relationships->'docai_fields'->>'plantation'             AS plantation,
            source_url
        FROM unconfirmed_persons
        WHERE extraction_method = 'freedmens_bank_index'
        AND review_notes ILIKE '%docai_enrichment%'
        AND relationships IS NOT NULL
        AND relationships::text ILIKE '%docai_fields%'
        AND (
            (relationships->'docai_fields'->>'last_master_confidence')::numeric < 0.5
            OR relationships->'docai_fields'->>'last_master' IS NULL
        )
        ${branchClause}
        ORDER BY (relationships->'docai_fields'->>'last_master_confidence')::numeric ASC NULLS FIRST
        LIMIT 10
    `);

    if (lowConf.rows.length > 0) {
        console.log(`\n  ${'Name'.padEnd(30)} ${'Branch'.padEnd(30)} ${'last_master'.padEnd(25)} ${'LM conf'.padStart(8)}`);
        console.log('  ' + sep('-', 95));
        for (const r of lowConf.rows) {
            console.log(
                '  ' +
                String(r.full_name || '').substring(0, 29).padEnd(30) +
                String(r.branch || '').substring(0, 29).padEnd(30) +
                String(r.last_master || '(none)').substring(0, 24).padEnd(25) +
                String(r.lm_conf || '—').padStart(8)
            );
        }
    } else {
        console.log('\n  (no low-confidence records found — model performing well, or enrichment still in progress)');
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log('\n' + sep('═'));
    console.log('  AUDIT COMPLETE  —  ' + new Date().toISOString());
    console.log('  Run again at any time: node scripts/audit-docai-enrichment-quality.js');
    console.log('  After enrichment: node scripts/clean-docai-enrichment.js --dry-run');
    console.log(sep('═') + '\n');

    await pool.end();
}

run().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});
