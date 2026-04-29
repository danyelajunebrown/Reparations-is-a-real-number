#!/usr/bin/env node
/**
 * Backfill schema_migrations from observed DB state
 *
 * One-time script. Run AFTER scripts/apply-migrations.js has bootstrapped
 * the tracking table. For every migration file in migrations/, decides:
 *
 *   - RETIRED (hardcoded list): mark with applied_by='retired' + reason. The
 *     runner will skip these forever. These are migrations that exist as
 *     files but the project explicitly decided not to apply (concepts
 *     folded into later migrations, or aspirational schema the project
 *     drifted away from).
 *
 *   - APPLIED (default): mark with applied_by='backfill' + checksum. The
 *     runner will skip these because checksum matches. We don't actually
 *     know the exact apply date for pre-runner migrations, so we use NOW.
 *
 *   - PARTIAL: a few migrations were partially applied. Mark them
 *     'backfill' but include a note about the partial state, so a future
 *     auditor running `--status` can see the caveat in the notes column.
 *
 * Why no auto-detection-of-applied-state? Each migration introduces
 * different objects (tables, columns, indexes, views, triggers, data).
 * Auto-detecting "is this applied?" requires per-migration logic. The
 * pragmatic alternative: trust the operator's knowledge (encoded in the
 * RETIRED + PARTIAL lists below) and mark everything else as applied.
 * Future migrations go through the runner cleanly; this backfill is
 * a one-shot to establish the starting state.
 *
 * Usage:
 *   node scripts/backfill-migrations.js --dry-run   # show what would happen
 *   node scripts/backfill-migrations.js             # actually backfill
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const sql = neon(process.env.DATABASE_URL);
const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');
const DRY_RUN = process.argv.includes('--dry-run');

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

// Migrations the project decided NOT to apply. The runner will skip these
// permanently. Keys are filename prefixes; we match by `startsWith`.
//
// Sourced from the Apr 28, 2026 DB audit + memory notes:
//   - M007/008/009: old aspirational schemas, project drifted to canonical_persons model
//   - M030: documented in M033's comments as "never applied — concepts folded in here"
//   - M031: Triangle Trade legal framework, never applied per memory
const RETIRED = {
    '007-': 'Old aspirational schema, drifted to canonical_persons model',
    '008-': 'Old aspirational schema, drifted to canonical_persons model',
    '009-': 'Old aspirational schema, drifted to canonical_persons model',
    '030-': 'Documented as retired in M033 — concepts folded into M033',
    '031-': 'Triangle Trade framework — never applied per project memory',
};

// Migrations that were PARTIALLY applied — mark applied with a caveat note.
// Per the Apr 28 audit, M011 only created `historical_reparations_petitions`;
// the supporting tables (historical_reparations_payments, petition_documents,
// petition_fulfillment_analysis) are still missing.
const PARTIAL = {
    '011-': 'PARTIAL — only historical_reparations_petitions created. Missing: historical_reparations_payments, petition_documents, petition_fulfillment_analysis. M041 supersedes for the live table.',
};

function classify(filename) {
    for (const [prefix, reason] of Object.entries(RETIRED)) {
        if (filename.startsWith(prefix)) return { kind: 'retired', reason };
    }
    for (const [prefix, reason] of Object.entries(PARTIAL)) {
        if (filename.startsWith(prefix)) return { kind: 'partial', reason };
    }
    return { kind: 'applied', reason: null };
}

async function main() {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  Backfill schema_migrations  (mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'})`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    // Confirm tracking table exists
    const exists = await sql`
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_name='schema_migrations'
        ) AS exists
    `;
    if (!exists[0].exists) {
        console.error('ERROR: schema_migrations table does not exist.');
        console.error('Run `node scripts/apply-migrations.js` first to bootstrap it.');
        process.exit(1);
    }

    // What's already in the tracking table?
    const existing = await sql`SELECT filename FROM schema_migrations`;
    const known = new Set(existing.map(r => r.filename));
    if (known.size > 0) {
        console.log(`schema_migrations already has ${known.size} row(s). Will skip those (idempotent).\n`);
    }

    const files = fs.readdirSync(MIGRATIONS_DIR)
        .filter(f => f.endsWith('.sql'))
        .sort();

    let applied = 0, retired = 0, partial = 0, alreadyKnown = 0;
    const decisions = [];

    for (const filename of files) {
        if (known.has(filename)) {
            alreadyKnown++;
            continue;
        }
        const text = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
        const checksum = sha256(text);
        const c = classify(filename);
        decisions.push({ filename, kind: c.kind, reason: c.reason, checksum });
    }

    console.log(`Total files: ${files.length}    already in tracker: ${alreadyKnown}    to insert: ${decisions.length}\n`);

    if (decisions.length === 0) {
        console.log('Nothing to backfill — schema_migrations already covers all files on disk.');
        return;
    }

    console.log('Decisions:');
    for (const d of decisions) {
        const tag = d.kind === 'retired' ? '☓ retired' : d.kind === 'partial' ? '◑ partial' : '✓ applied';
        console.log(`  ${tag}  ${d.filename}${d.reason ? '\n      reason: ' + d.reason : ''}`);
    }
    console.log();

    if (DRY_RUN) {
        console.log('DRY RUN — no inserts performed.');
        return;
    }

    for (const d of decisions) {
        const appliedBy = d.kind === 'retired' ? 'retired' : 'backfill';
        const notes = d.reason || (d.kind === 'partial' ? 'partial-applied — see notes' : 'backfilled — assumed applied based on pre-runner deployment');
        await sql`
            INSERT INTO schema_migrations (filename, checksum, applied_by, notes)
            VALUES (${d.filename}, ${d.checksum}, ${appliedBy}, ${notes})
            ON CONFLICT (filename) DO NOTHING
        `;
        if (d.kind === 'retired') retired++;
        else if (d.kind === 'partial') partial++;
        else applied++;
    }

    console.log(`\nDONE: applied=${applied}  retired=${retired}  partial=${partial}  already_known=${alreadyKnown}`);

    // Verify final state
    const counts = await sql`
        SELECT applied_by, COUNT(*)::int AS n FROM schema_migrations GROUP BY applied_by ORDER BY n DESC
    `;
    console.log('\nschema_migrations now contains:');
    for (const r of counts) console.log(`  ${r.applied_by.padEnd(25)} ${r.n}`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
