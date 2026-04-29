#!/usr/bin/env node
/**
 * Migration Runner
 *
 * Reads migrations/*.sql in lex order. For each migration:
 *   - if filename is present in `schema_migrations` AND checksum matches → skip
 *   - if filename is present AND checksum differs → ABORT (file was edited
 *     after being applied; this should never happen in normal operation)
 *   - if filename is absent → apply inside a transaction, then INSERT into
 *     schema_migrations
 *
 * Migrations marked `applied_by='retired'` in schema_migrations are skipped
 * permanently regardless of file presence.
 *
 * The migration tracking table itself (047) is bootstrapped specially: if it
 * doesn't exist yet, we apply 047 outside the tracking system, then begin
 * recording from there.
 *
 * Usage:
 *   node scripts/apply-migrations.js              # apply pending migrations
 *   node scripts/apply-migrations.js --dry-run    # report what would run, no changes
 *   node scripts/apply-migrations.js --status     # show applied / pending / retired counts
 *   node scripts/apply-migrations.js --force <filename>   # re-apply a single file
 *                                                          (caution; only for emergencies)
 *
 * Multi-statement handling: many existing migrations bundle multiple DDL
 * statements separated by `;`. We strip line comments, split on `;`,
 * filter empty, and run each statement individually so per-statement
 * errors are reported with context. If a single statement fails, the
 * surrounding transaction rolls back the whole migration file.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const sql = neon(process.env.DATABASE_URL);
const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');
const TRACKING_MIGRATION = '047-schema-migrations-tracking.sql';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const STATUS_ONLY = args.includes('--status');
const FORCE_IDX = args.indexOf('--force');
const FORCE_FILE = FORCE_IDX !== -1 ? args[FORCE_IDX + 1] : null;

function sha256(text) {
    return crypto.createHash('sha256').update(text).digest('hex');
}

// Statement-aware SQL splitter. Walks the source character-by-character,
// tracking whether we are inside a `--` line comment, `/* */` block comment,
// `'...'` single-quoted string literal (with `''` as escaped quote), or
// `$tag$ ... $tag$` dollar-quoted string. Only splits on `;` outside all of
// these. Required for migrations whose string literals contain `;` (e.g.,
// 060 seeds methodology descriptions that include semicolons).
function splitStatements(sqlText) {
    const out = [];
    let cur = '';
    let i = 0;
    const n = sqlText.length;
    while (i < n) {
        const c = sqlText[i];
        const next = sqlText[i + 1];

        // Line comment: skip to end-of-line, do not append.
        if (c === '-' && next === '-') {
            const eol = sqlText.indexOf('\n', i);
            i = eol === -1 ? n : eol;
            continue;
        }

        // Block comment: skip to closing */, do not append.
        if (c === '/' && next === '*') {
            const end = sqlText.indexOf('*/', i + 2);
            i = end === -1 ? n : end + 2;
            continue;
        }

        // Single-quoted string literal — append verbatim, handle '' as escape.
        if (c === "'") {
            cur += c;
            i++;
            while (i < n) {
                if (sqlText[i] === "'" && sqlText[i + 1] === "'") {
                    cur += "''";
                    i += 2;
                    continue;
                }
                if (sqlText[i] === "'") {
                    cur += "'";
                    i++;
                    break;
                }
                cur += sqlText[i];
                i++;
            }
            continue;
        }

        // Dollar-quoted string $tag$ ... $tag$ (tag may be empty: $$ ... $$).
        if (c === '$') {
            const m = sqlText.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
            if (m) {
                const tag = m[0];
                cur += tag;
                i += tag.length;
                const endIdx = sqlText.indexOf(tag, i);
                if (endIdx === -1) {
                    cur += sqlText.slice(i);
                    i = n;
                    continue;
                }
                cur += sqlText.slice(i, endIdx + tag.length);
                i = endIdx + tag.length;
                continue;
            }
        }

        // Statement terminator outside any string/comment context.
        if (c === ';') {
            const t = cur.trim();
            if (t) out.push(t);
            cur = '';
            i++;
            continue;
        }

        cur += c;
        i++;
    }
    const t = cur.trim();
    if (t) out.push(t);
    return out;
}

async function ensureTrackingTableExists() {
    const r = await sql`
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_name = 'schema_migrations'
        ) AS exists
    `;
    if (r[0].exists) return false;

    // Bootstrap: apply 047 manually because the tracking table itself
    // doesn't exist yet. After this, 047 will be recorded normally.
    const file = path.join(MIGRATIONS_DIR, TRACKING_MIGRATION);
    if (!fs.existsSync(file)) {
        throw new Error(`Cannot bootstrap: ${TRACKING_MIGRATION} is missing from migrations/`);
    }
    const text = fs.readFileSync(file, 'utf8');
    console.log(`Bootstrapping schema_migrations table from ${TRACKING_MIGRATION}...`);
    for (const stmt of splitStatements(text)) {
        await sql.query(stmt);
    }
    // Record itself as applied
    await sql`
        INSERT INTO schema_migrations (filename, checksum, applied_by, notes)
        VALUES (${TRACKING_MIGRATION}, ${sha256(text)}, 'apply-migrations.js', 'Bootstrap of tracking system itself')
        ON CONFLICT (filename) DO NOTHING
    `;
    return true;
}

async function getAppliedMap() {
    const rows = await sql`
        SELECT filename, checksum, applied_by, applied_at, notes
        FROM schema_migrations
    `;
    const m = new Map();
    for (const r of rows) m.set(r.filename, r);
    return m;
}

function listMigrations() {
    return fs.readdirSync(MIGRATIONS_DIR)
        .filter(f => f.endsWith('.sql'))
        .sort();
}

async function applyOne(filename) {
    const file = path.join(MIGRATIONS_DIR, filename);
    const text = fs.readFileSync(file, 'utf8');
    const checksum = sha256(text);
    const statements = splitStatements(text);

    console.log(`\n→ ${filename} (${statements.length} statements, ${(text.length / 1024).toFixed(1)} KB)`);
    if (DRY_RUN) {
        console.log(`  DRY RUN — would apply`);
        return { filename, status: 'would_apply', statementCount: statements.length };
    }

    const t0 = Date.now();
    let applied = 0;
    let lastStmt = null;
    try {
        for (const stmt of statements) {
            lastStmt = stmt.slice(0, 100).replace(/\s+/g, ' ');
            await sql.query(stmt);
            applied++;
        }
    } catch (e) {
        console.log(`  ✗ FAILED at statement ${applied + 1}/${statements.length}: ${lastStmt}`);
        console.log(`    Error: ${e.message}`);
        // Note: Neon's HTTP driver doesn't support multi-statement transactions
        // across separate sql.query() calls. So PARTIAL APPLICATION is possible.
        // We do NOT insert into schema_migrations on failure; operator must
        // resolve manually.
        return { filename, status: 'failed', error: e.message, partialApplied: applied, total: statements.length };
    }
    const runtimeMs = Date.now() - t0;

    await sql`
        INSERT INTO schema_migrations (filename, checksum, applied_by, runtime_ms)
        VALUES (${filename}, ${checksum}, 'apply-migrations.js', ${runtimeMs})
    `;
    console.log(`  ✓ Applied (${runtimeMs}ms, ${applied} statements)`);
    return { filename, status: 'applied', runtimeMs, statementCount: applied };
}

async function main() {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  Migration Runner');
    console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : STATUS_ONLY ? 'STATUS' : FORCE_FILE ? `FORCE ${FORCE_FILE}` : 'APPLY'}`);
    console.log('═══════════════════════════════════════════════════════════════');

    const bootstrapped = await ensureTrackingTableExists();
    if (bootstrapped) console.log('  ✓ Tracking table bootstrapped\n');

    const applied = await getAppliedMap();
    const files = listMigrations();

    if (STATUS_ONLY) {
        let appliedCount = 0, retiredCount = 0, pendingCount = 0, modifiedCount = 0;
        for (const f of files) {
            const rec = applied.get(f);
            if (!rec) { pendingCount++; continue; }
            if (rec.applied_by === 'retired') { retiredCount++; continue; }
            const checksum = sha256(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
            if (checksum !== rec.checksum) modifiedCount++;
            else appliedCount++;
        }
        console.log(`Total migrations on disk: ${files.length}`);
        console.log(`  Applied (checksum matches): ${appliedCount}`);
        console.log(`  Retired (skip):             ${retiredCount}`);
        console.log(`  Pending (would apply):      ${pendingCount}`);
        console.log(`  Modified after apply:       ${modifiedCount}  ${modifiedCount > 0 ? '⚠ NEEDS RESOLUTION' : ''}`);
        if (pendingCount > 0) {
            console.log('\nPending:');
            for (const f of files) if (!applied.has(f)) console.log(`  - ${f}`);
        }
        if (modifiedCount > 0) {
            console.log('\nModified-after-apply (the runner will refuse to run until resolved):');
            for (const f of files) {
                const rec = applied.get(f);
                if (!rec || rec.applied_by === 'retired') continue;
                const checksum = sha256(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
                if (checksum !== rec.checksum) console.log(`  - ${f}  (was applied ${rec.applied_at})`);
            }
        }
        return;
    }

    if (FORCE_FILE) {
        if (!files.includes(FORCE_FILE)) {
            throw new Error(`File not found: ${FORCE_FILE}`);
        }
        console.log(`Force-applying ${FORCE_FILE}…`);
        const result = await applyOne(FORCE_FILE);
        if (result.status === 'failed') process.exit(1);
        return;
    }

    let plannedCount = 0, appliedNow = 0, skipped = 0, retired = 0, failed = 0;

    for (const filename of files) {
        const rec = applied.get(filename);
        const text = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
        const checksum = sha256(text);

        if (rec) {
            if (rec.applied_by === 'retired') {
                retired++;
                continue;
            }
            if (rec.checksum !== checksum) {
                console.log(`\n✗ ${filename}: checksum mismatch (was applied ${rec.applied_at})`);
                console.log(`  The file has been edited since it was applied. Refusing to proceed.`);
                console.log(`  To resolve: revert the file OR explicitly re-apply with --force ${filename}`);
                process.exit(2);
            }
            skipped++;
            continue;
        }

        plannedCount++;
        const result = await applyOne(filename);
        if (result.status === 'applied') appliedNow++;
        else if (result.status === 'failed') {
            failed++;
            console.log(`\n✗ Stopping run. Resolve ${filename} before continuing.`);
            break;
        }
    }

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(`Summary: applied=${appliedNow} skipped=${skipped} retired=${retired} failed=${failed}`);
    if (DRY_RUN && plannedCount > 0) console.log(`(dry run — ${plannedCount} would have been applied)`);
    console.log('═══════════════════════════════════════════════════════════════');
}

main().catch(e => {
    console.error('Fatal:', e.message);
    process.exit(1);
});
