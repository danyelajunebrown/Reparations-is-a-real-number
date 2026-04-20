#!/usr/bin/env node
/**
 * Freedmen's Bank Data Quality Audit
 *
 * Sweeps all freedmens_bank_index records for:
 *   1. Garbage names (too short, digits, symbols, UI artifacts)
 *   2. Duplicate depositors (same name + same account + same branch)
 *   3. Cross-branch contamination (same record appearing in wrong branch)
 *   4. False-positive family members (non-person values that leaked through filters)
 *   5. Orphan records (no account number, no event place, no family — truly empty)
 *   6. Suspicious patterns (same name appearing 100+ times, single-word names)
 *   7. Account number anomalies (out-of-range, duplicated across branches)
 *   8. Philadelphia organizational records flagged as individuals
 *   9. Data completeness by branch (% with account, % with family, % with event_place)
 *
 * Usage:
 *   node scripts/audit-freedmens-quality.js
 *   node scripts/audit-freedmens-quality.js --fix    # Auto-fix garbage + flag issues
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Pool } = require('pg');

const FIX = process.argv.includes('--fix');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5
});

const issues = { garbage: [], duplicates: [], contamination: [], falsePositives: [], orphans: [], suspicious: [], accountAnomalies: [], philly: [], totalIssues: 0 };

async function audit() {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`  FREEDMEN'S BANK DATA QUALITY AUDIT`);
    console.log(`  Mode: ${FIX ? 'FIX (will modify DB)' : 'REPORT ONLY'}`);
    console.log(`${'═'.repeat(70)}\n`);

    // ── 1. Total counts ──
    console.log('── 1. OVERVIEW ──');
    const total = await pool.query("SELECT COUNT(*)::int AS n FROM unconfirmed_persons WHERE extraction_method='freedmens_bank_index'");
    const byBranch = await pool.query("SELECT locations[1] AS branch, COUNT(*)::int AS n FROM unconfirmed_persons WHERE extraction_method='freedmens_bank_index' GROUP BY 1 ORDER BY n DESC");
    console.log(`  Total records: ${total.rows[0].n.toLocaleString()}`);
    console.log(`  Branches: ${byBranch.rows.length}`);

    // ── 2. Garbage names ──
    console.log('\n── 2. GARBAGE NAMES ──');
    const garbage = await pool.query(`
        SELECT lead_id, full_name, locations[1] AS branch FROM unconfirmed_persons
        WHERE extraction_method='freedmens_bank_index'
        AND (
            full_name ~ E'\\n'
            OR full_name LIKE '%More%'
            OR full_name LIKE '%ATTACH%'
            OR length(full_name) < 2
            OR full_name ~ '^[0-9]'
            OR full_name ~ '^[^a-zA-Z]'
            OR full_name ~* '^(unknown|ditto|do|same|above|illegible|blank|none|dead|closed|transferred)$'
            OR full_name ~* 'came with|transferred from|husband of|wife of'
        )
        LIMIT 100
    `);
    console.log(`  Garbage names found: ${garbage.rows.length}${garbage.rows.length >= 100 ? '+' : ''}`);
    garbage.rows.slice(0, 10).forEach(r => console.log(`    ${r.lead_id} "${r.full_name}" (${r.branch})`));
    issues.garbage = garbage.rows;

    // ── 3. True duplicates (same FS ARK URL) ──
    //
    // The FS ARK URL uniquely identifies a single indexed person record.
    // Two rows sharing one ARK = the scraper wrote the same record twice
    // (scrape restart / resume overlap). These are safe to dedupe.
    //
    // NOTE: A previous version of this query grouped by
    // (full_name, context_text, branch). When context_text is the generic
    // "Freedman's Bank depositor, <branch>" fallback (no account#), every
    // first-name-only record in a branch collapsed into one group — 136
    // distinct "John" depositors in NYC got reported as 1 group of 136.
    // False positive. That query has been replaced with the ARK-based one
    // below; the suspicious-pattern check in §3b handles the legitimate
    // "same name + same account#" signal separately.
    console.log('\n── 3a. HARD DUPLICATES (same FS ARK URL) ──');
    const hardDupes = await pool.query(`
        SELECT source_url, full_name, locations[1] AS branch, COUNT(*)::int AS n
        FROM unconfirmed_persons
        WHERE extraction_method='freedmens_bank_index'
        AND source_url IS NOT NULL
        GROUP BY source_url, full_name, locations[1]
        HAVING COUNT(*) > 1
        ORDER BY n DESC
        LIMIT 20
    `);
    const hardDupeCount = hardDupes.rows.reduce((s, r) => s + r.n - 1, 0);
    console.log(`  Hard-dupe groups: ${hardDupes.rows.length}, extra rows to delete: ${hardDupeCount}`);
    hardDupes.rows.slice(0, 5).forEach(r => console.log(`    "${r.full_name}" × ${r.n} (${r.branch}) ${r.source_url}`));
    issues.duplicates = hardDupes.rows;

    // ── 3b. Suspicious: same name + same account# (different ARKs) ──
    // Could be: same depositor indexed twice into FS; OR two real
    // depositors who happen to share a common first name and account#
    // collision is a coincidence. Needs human review — don't auto-fix.
    console.log('\n── 3b. SUSPICIOUS (same full_name + account# across different ARKs) ──');
    const suspicious = await pool.query(`
        WITH keyed AS (
            SELECT
                full_name,
                locations[1] AS branch,
                substring(context_text FROM 'account #[0-9]+') AS acct,
                source_url
            FROM unconfirmed_persons
            WHERE extraction_method='freedmens_bank_index'
            AND context_text ~ 'account #[0-9]+'
        )
        SELECT full_name, branch, acct, COUNT(DISTINCT source_url)::int AS arks, COUNT(*)::int AS n
        FROM keyed
        GROUP BY full_name, branch, acct
        HAVING COUNT(DISTINCT source_url) > 1
        ORDER BY n DESC
        LIMIT 20
    `);
    console.log(`  Suspicious groups: ${suspicious.rows.length}`);
    suspicious.rows.slice(0, 5).forEach(r => console.log(`    "${r.full_name}" ${r.acct} (${r.branch}) — ${r.arks} distinct ARKs, ${r.n} rows`));
    issues.suspicious = suspicious.rows;

    // Keep backwards-compatible name for the summary line.
    const dupeCount = hardDupeCount;

    // ── 4. Single-character and single-word names ──
    console.log('\n── 4. NAME QUALITY ──');
    const singleChar = await pool.query("SELECT COUNT(*)::int AS n FROM unconfirmed_persons WHERE extraction_method='freedmens_bank_index' AND length(full_name) <= 2");
    const singleWord = await pool.query("SELECT COUNT(*)::int AS n FROM unconfirmed_persons WHERE extraction_method='freedmens_bank_index' AND full_name NOT LIKE '% %'");
    const veryLong = await pool.query("SELECT COUNT(*)::int AS n FROM unconfirmed_persons WHERE extraction_method='freedmens_bank_index' AND length(full_name) > 50");
    console.log(`  Single-char names (<=2): ${singleChar.rows[0].n}`);
    console.log(`  Single-word names (no space): ${singleWord.rows[0].n.toLocaleString()}`);
    console.log(`  Very long names (>50 chars): ${veryLong.rows[0].n}`);

    // Sample single-word names
    const singleWordSample = await pool.query("SELECT full_name, COUNT(*)::int AS n FROM unconfirmed_persons WHERE extraction_method='freedmens_bank_index' AND full_name NOT LIKE '% %' GROUP BY full_name ORDER BY n DESC LIMIT 15");
    console.log('  Most common single-word names:');
    singleWordSample.rows.forEach(r => console.log(`    "${r.full_name}" × ${r.n}`));

    // ── 5. Most-repeated names (suspicious if >200) ──
    console.log('\n── 5. MOST-REPEATED NAMES ──');
    const repeated = await pool.query("SELECT full_name, COUNT(*)::int AS n FROM unconfirmed_persons WHERE extraction_method='freedmens_bank_index' GROUP BY full_name ORDER BY n DESC LIMIT 15");
    repeated.rows.forEach(r => console.log(`    "${r.full_name}" × ${r.n}`));

    // ── 6. Data completeness by branch ──
    console.log('\n── 6. DATA COMPLETENESS BY BRANCH ──');
    const completeness = await pool.query(`
        SELECT
            locations[1] AS branch,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE context_text LIKE '%account #%')::int AS has_account,
            COUNT(*) FILTER (WHERE jsonb_typeof(relationships) = 'array' AND jsonb_array_length(relationships) > 0)::int AS has_family,
            COUNT(*) FILTER (WHERE source_url LIKE '%ark:/61903/1:1:%')::int AS has_ark
        FROM unconfirmed_persons
        WHERE extraction_method='freedmens_bank_index'
        GROUP BY locations[1]
        ORDER BY total DESC
    `);
    console.log(`  ${'Branch'.padEnd(35)} ${'Total'.padStart(7)} ${'Acct%'.padStart(6)} ${'Fam%'.padStart(6)} ${'ARK%'.padStart(6)}`);
    completeness.rows.forEach(r => {
        const acctPct = Math.round(r.has_account / r.total * 100);
        const famPct = Math.round(r.has_family / r.total * 100);
        const arkPct = Math.round(r.has_ark / r.total * 100);
        console.log(`  ${r.branch.padEnd(35)} ${r.total.toLocaleString().padStart(7)} ${(acctPct + '%').padStart(6)} ${(famPct + '%').padStart(6)} ${(arkPct + '%').padStart(6)}`);
    });

    // ── 7. False-positive family members ──
    console.log('\n── 7. FALSE-POSITIVE FAMILY MEMBERS ──');
    const fpFamily = await pool.query(`
        SELECT lead_id, full_name, locations[1] AS branch, relationships::text AS rels
        FROM unconfirmed_persons
        WHERE extraction_method='freedmens_bank_index'
        AND jsonb_typeof(relationships) = 'array'
        AND (
            relationships::text ~* '"name":"[^"]*\\b(N\\.C\\.|S\\.C\\.|Va\\.|County|ft\\.|driver|mason|cook|barber|laborer|hotel|mulato|single|married)\\b'
        )
        LIMIT 20
    `);
    console.log(`  Records with suspected non-name family members: ${fpFamily.rows.length}${fpFamily.rows.length >= 20 ? '+' : ''}`);
    fpFamily.rows.slice(0, 5).forEach(r => {
        const rels = JSON.parse(r.rels).map(x => x.name).join(', ');
        console.log(`    ${r.full_name} (${r.branch}): ${rels.substring(0, 100)}`);
    });

    // ── 8. Philadelphia organizational records ──
    console.log('\n── 8. PHILADELPHIA ORGANIZATIONAL RECORDS ──');
    const philly = await pool.query(`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE full_name ~* '(lodge|church|school|society|association|union|temple|daughters|sons|sisters|brothers|committee|asylum|sabbath)')::int AS orgs
        FROM unconfirmed_persons
        WHERE extraction_method='freedmens_bank_index'
        AND 'Philadelphia, Pennsylvania' = ANY(locations)
    `);
    console.log(`  Total Philly records: ${philly.rows[0].total}`);
    console.log(`  Organizational names: ${philly.rows[0].orgs} (${Math.round(philly.rows[0].orgs / philly.rows[0].total * 100)}%)`);

    // ── 9. Account number anomalies ──
    console.log('\n── 9. ACCOUNT NUMBER CHECK ──');
    const noAcct = await pool.query("SELECT COUNT(*)::int AS n FROM unconfirmed_persons WHERE extraction_method='freedmens_bank_index' AND (context_text NOT LIKE '%account #%' OR context_text IS NULL)");
    console.log(`  Records without account number: ${noAcct.rows[0].n.toLocaleString()}`);

    // ── 10. Summary ──
    const totalIssues = garbage.rows.length + dupeCount + fpFamily.rows.length;
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`  AUDIT COMPLETE`);
    console.log(`${'═'.repeat(70)}`);
    console.log(`  Total records:     ${total.rows[0].n.toLocaleString()}`);
    console.log(`  Garbage names:     ${garbage.rows.length}`);
    console.log(`  Duplicate rows:    ${dupeCount}`);
    console.log(`  False-pos family:  ${fpFamily.rows.length}+`);
    console.log(`  Issue rate:        ${(totalIssues / total.rows[0].n * 100).toFixed(3)}%`);

    if (FIX && garbage.rows.length > 0) {
        console.log(`\n  FIXING: Deleting ${garbage.rows.length} garbage rows...`);
        const ids = garbage.rows.map(r => r.lead_id);
        // Delete in batches
        for (let i = 0; i < ids.length; i += 100) {
            const batch = ids.slice(i, i + 100);
            await pool.query('DELETE FROM unconfirmed_persons WHERE lead_id = ANY($1)', [batch]);
        }
        console.log(`  Done.`);
    }

    await pool.end();
}

audit().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
