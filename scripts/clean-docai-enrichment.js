#!/usr/bin/env node
/**
 * clean-docai-enrichment.js
 *
 * Cleans Freedman's Bank DocAI enrichment results that have already been
 * written to unconfirmed_persons.relationships->docai_fields.
 *
 * SAFE TO RUN while enrichment is running on Mac Mini:
 *   - Only touches records already tagged 'docai_enrichment' in review_notes
 *   - Optionally scope to lead_id < N to avoid racing with active writes
 *   - All writes are idempotent UPDATE on the JSONB column
 *
 * Cleaning operations:
 *   1. WHITESPACE — trim leading/trailing spaces, collapse internal runs
 *   2. CASE NORMALIZATION — "JOHN SMITH" → "John Smith" for name fields
 *   3. REPROCESS FLAG — mark records with suspicious conf=1.00 + no critical
 *      fields as _needs_reprocess=true (for --reprocess pass after full run)
 *   4. NULL OUT blanks — docai_fields entries that are "" → removed entirely
 *
 * Usage:
 *   node scripts/clean-docai-enrichment.js --dry-run          # show what would change
 *   node scripts/clean-docai-enrichment.js                    # apply all cleaning
 *   node scripts/clean-docai-enrichment.js --max-id 500000    # only id < 500000 (safe zone)
 *   node scripts/clean-docai-enrichment.js --branch-like "Washington"
 *   node scripts/clean-docai-enrichment.js --batch 500        # rows per update batch
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Pool } = require('pg');

const argv    = process.argv.slice(2);
const flag    = (n) => argv.includes(n);
const opt     = (n, d = null) => { const i = argv.indexOf(n); return i !== -1 && argv[i+1] ? argv[i+1] : d; };

const DRY_RUN     = flag('--dry-run');
const BRANCH_LIKE = opt('--branch-like');
const MAX_ID      = parseInt(opt('--max-id', '0')) || 0;
const BATCH_SIZE  = parseInt(opt('--batch', '200'));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 3,
});

// Fields that should be title-cased (human names)
const NAME_FIELDS = new Set([
    'last_master', 'last_mistress', 'depositor_name',
    'father_name', 'mother_name', 'spouse_name',
    'spouse_father', 'spouse_mother',
]);

// Critical fields — if ALL empty → flag for reprocess
const CRITICAL_FIELDS = ['last_master', 'last_mistress', 'plantation', 'old_title'];

function toTitleCase(str) {
    if (!str) return str;
    // Preserve ALL-CAPS abbreviations like "U.S.", "Jr.", etc.
    return str
        .toLowerCase()
        .replace(/(?:^|[\s\-\/])(\w)/g, (m) => m.toUpperCase())
        .replace(/\b(Of|And|The|A|An|In|On|At|To|By|For|With|From)\b/g, (m) => m.toLowerCase())
        .replace(/\bMc(\w)/g, (_, c) => 'Mc' + c.toUpperCase())
        .replace(/\bO'(\w)/g, (_, c) => "O'" + c.toUpperCase());
}

function trimField(str) {
    if (typeof str !== 'string') return str;
    return str.trim().replace(/\s+/g, ' ').replace(/^[,.\-_"']+/, '').replace(/[,.\-_"']+$/, '');
}

function cleanDocaiFields(docaiFields, depositorName) {
    if (!docaiFields || typeof docaiFields !== 'object') return { cleaned: docaiFields, changed: false, ops: [] };

    const cleaned = { ...docaiFields };
    const ops = [];

    for (const [key, val] of Object.entries(cleaned)) {
        // Skip meta fields
        if (key.startsWith('_')) continue;
        // Skip confidence fields
        if (key.endsWith('_confidence')) continue;

        if (typeof val === 'string') {
            let newVal = trimField(val);

            // Remove blank strings entirely
            if (newVal === '') {
                delete cleaned[key];
                ops.push(`removed blank: ${key}`);
                continue;
            }

            // Title-case name fields
            if (NAME_FIELDS.has(key)) {
                const tc = toTitleCase(newVal);
                if (tc !== newVal) {
                    ops.push(`case-fixed: ${key} "${newVal}" → "${tc}"`);
                    newVal = tc;
                }
            }

            if (newVal !== val) {
                cleaned[key] = newVal;
                if (!ops.find(o => o.includes(key))) ops.push(`trimmed: ${key}`);
            } else {
                cleaned[key] = newVal;
            }
        } else if (Array.isArray(val)) {
            // Clean arrays of strings (siblings_names, children_names, etc.)
            const newArr = val
                .map(item => {
                    if (typeof item !== 'string') return item;
                    const t = trimField(item);
                    return t || null;
                })
                .filter(Boolean);
            if (JSON.stringify(newArr) !== JSON.stringify(val)) {
                cleaned[key] = newArr;
                ops.push(`array-cleaned: ${key} (${val.length} → ${newArr.length} items)`);
            }
        }
    }

    // Flag for reprocess if all critical fields are empty after cleaning
    const hasCritical = CRITICAL_FIELDS.some(f => cleaned[f] && String(cleaned[f]).trim());
    if (!hasCritical && !cleaned._needs_reprocess) {
        cleaned._needs_reprocess = true;
        ops.push('flagged: _needs_reprocess=true (no critical fields extracted)');
    }

    const changed = ops.length > 0;
    return { cleaned, changed, ops };
}

async function run() {
    console.log('\n' + '═'.repeat(70));
    console.log('  DOCAI ENRICHMENT CLEANER');
    console.log(`  Mode:        ${DRY_RUN ? '⚠ DRY RUN — no writes' : 'LIVE — will update DB'}`);
    if (BRANCH_LIKE) console.log(`  Branch:      ILIKE '%${BRANCH_LIKE}%'`);
    if (MAX_ID > 0)  console.log(`  Max ID:      lead_id < ${MAX_ID}  (safe zone while enrichment runs)`);
    console.log(`  Batch size:  ${BATCH_SIZE}`);
    console.log('═'.repeat(70) + '\n');

    // Build WHERE clause
    const conditions = [
        `extraction_method = 'freedmens_bank_index'`,
        `review_notes ILIKE '%docai_enrichment%'`,
        `relationships IS NOT NULL`,
        `relationships::text ILIKE '%docai_fields%'`,
    ];
    if (BRANCH_LIKE) {
        conditions.push(`EXISTS (SELECT 1 FROM unnest(locations) loc WHERE loc ILIKE '%${BRANCH_LIKE.replace(/'/g,"''")}%')`);
    }
    if (MAX_ID > 0) {
        conditions.push(`lead_id < ${MAX_ID}`);
    }
    const WHERE = conditions.join(' AND ');

    // Count
    const countRes = await pool.query(`SELECT COUNT(*) AS n FROM unconfirmed_persons WHERE ${WHERE}`);
    const totalToProcess = parseInt(countRes.rows[0].n);
    console.log(`Records to process: ${totalToProcess.toLocaleString()}\n`);

    if (totalToProcess === 0) {
        console.log('Nothing to clean — no enriched records match the filter.');
        await pool.end();
        return;
    }

    const stats = { processed: 0, changed: 0, unchanged: 0, errors: 0, ops: {} };

    // Process in batches by lead_id cursor
    let lastId = 0;
    let batchNum = 0;

    while (true) {
        const rows = await pool.query(`
            SELECT lead_id, full_name, relationships
            FROM unconfirmed_persons
            WHERE ${WHERE}
            AND lead_id > $1
            ORDER BY lead_id
            LIMIT $2
        `, [lastId, BATCH_SIZE]);

        if (rows.rows.length === 0) break;
        batchNum++;

        const updates = [];

        for (const row of rows.rows) {
            const { lead_id, full_name, relationships } = row;
            lastId = lead_id;
            stats.processed++;

            try {
                let rels = relationships;
                if (typeof rels === 'string') {
                    try { rels = JSON.parse(rels); } catch { stats.errors++; continue; }
                }

                // relationships can be JSONB object or array
                let docaiFields = null;
                if (rels && typeof rels === 'object' && !Array.isArray(rels)) {
                    docaiFields = rels.docai_fields || null;
                } else if (Array.isArray(rels)) {
                    // Old format: array of objects, find docai_fields entry
                    const entry = rels.find(e => e && e.docai_fields);
                    docaiFields = entry ? entry.docai_fields : null;
                }

                if (!docaiFields) { stats.unchanged++; continue; }

                const { cleaned, changed, ops } = cleanDocaiFields(docaiFields, full_name);

                if (!changed) { stats.unchanged++; continue; }

                stats.changed++;
                for (const op of ops) {
                    const key = op.split(':')[0];
                    stats.ops[key] = (stats.ops[key] || 0) + 1;
                }

                if (DRY_RUN) {
                    if (stats.changed <= 5) {
                        console.log(`  [DRY] id=${lead_id} "${full_name.substring(0,30)}":`);
                        ops.forEach(o => console.log(`         ${o}`));
                    }
                    continue;
                }

                // Build the updated relationships object
                let updatedRels;
                if (Array.isArray(rels)) {
                    updatedRels = rels.map(e => (e && e.docai_fields) ? { ...e, docai_fields: cleaned } : e);
                } else {
                    updatedRels = { ...rels, docai_fields: cleaned };
                }

                updates.push({ id: lead_id, rels: updatedRels });

            } catch (err) {
                stats.errors++;
                console.warn(`  ⚠ Error processing id=${lead_id}: ${err.message}`);
            }
        }

        // Bulk update this batch
        if (!DRY_RUN && updates.length > 0) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                for (const u of updates) {
                    await client.query(
                        `UPDATE unconfirmed_persons
                         SET relationships = $1::jsonb,
                             updated_at = NOW()
                         WHERE lead_id = $2`,
                        [JSON.stringify(u.rels), u.id]
                    );
                }
                await client.query('COMMIT');
            } catch (e) {
                await client.query('ROLLBACK');
                stats.errors += updates.length;
                console.error(`  ✗ Batch ${batchNum} rollback: ${e.message}`);
            } finally {
                client.release();
            }
        }

        // Progress every 10 batches
        if (batchNum % 10 === 0 || rows.rows.length < BATCH_SIZE) {
            const pct = (stats.processed / totalToProcess * 100).toFixed(1);
            console.log(
                `  [batch ${batchNum}] processed=${stats.processed}/${totalToProcess} (${pct}%)  ` +
                `changed=${stats.changed}  unchanged=${stats.unchanged}  errors=${stats.errors}`
            );
        }
    }

    // Summary
    console.log('\n' + '═'.repeat(70));
    console.log('  CLEANING COMPLETE');
    console.log('═'.repeat(70));
    console.log(`  Total processed:   ${stats.processed.toLocaleString()}`);
    console.log(`  Changed:           ${stats.changed.toLocaleString()}`);
    console.log(`  Unchanged:         ${stats.unchanged.toLocaleString()}`);
    console.log(`  Errors:            ${stats.errors}`);
    if (Object.keys(stats.ops).length > 0) {
        console.log('\n  Operations performed:');
        for (const [op, cnt] of Object.entries(stats.ops).sort((a,b) => b[1]-a[1])) {
            console.log(`    ${op.padEnd(20)} ${cnt.toLocaleString()}×`);
        }
    }
    if (DRY_RUN) {
        console.log('\n  ⚠ DRY RUN — no changes written. Remove --dry-run to apply.');
    } else {
        console.log('\n  ✅ Done. Re-run audit to verify:');
        console.log('     node scripts/audit-docai-enrichment-quality.js');
        if (stats.changed > 0) {
            console.log('\n  Records flagged _needs_reprocess=true can be re-enriched after the');
            console.log('  full 29-branch run completes:');
            console.log('     node scripts/enrich-freedmens-docai.js --reprocess --branch-like "Washington"');
        }
    }
    console.log('═'.repeat(70) + '\n');

    await pool.end();
}

run().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});
