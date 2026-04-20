// Clean up 44 canonical_persons rows whose canonical_name is the FamilySearch
// page navigation breadcrumb ("Family Tree\nSearch\nMemories\nGet Involved\n
// Activities") saved as a person name by a scraper bug. All are person_type=
// 'descendant'. They have FS external_ids so a human can look them up later.
//
// What this does:
//   - Renames canonical_name to "(unresolved name — FS: <external_id>)" so the
//     DAA recitals don't print the nav breadcrumb. Preserves the FS ID link
//     for future human review or re-scraping.
//   - Appends to `notes` a marker + pattern seen + timestamp.
//   - Does NOT delete the rows (FK references from person_external_ids /
//     person_documents stay intact).
//   - Does NOT modify person_type (someone marked them descendant; that
//     classification may be what's incorrect but we won't guess).
//
// Safe to re-run — only touches rows whose canonical_name still matches the
// junk pattern.
//
// Usage:
//   node scripts/cleanup-canonical-junk-names.mjs             # dry-run
//   node scripts/cleanup-canonical-junk-names.mjs --apply     # write

import 'dotenv/config';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const JUNK_PATTERNS = [
    '%Memories%Get Involved%',
    '%Family Tree%Search%Memories%',
    '%SOURCE BOX%ATTACH TO TREE%',
];

const sql = `
    SELECT cp.id, cp.canonical_name, cp.person_type, cp.notes,
           (SELECT external_id FROM person_external_ids pei
            WHERE pei.canonical_person_id = cp.id AND pei.id_system='familysearch'
            LIMIT 1) AS fs_id
    FROM canonical_persons cp
    WHERE cp.canonical_name ILIKE ANY($1::text[])
    ORDER BY cp.id
`;

const q = await pool.query(sql, [JUNK_PATTERNS]);
console.log(`Junk canonical_persons rows found: ${q.rowCount}`);
console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
console.log();

if (q.rowCount === 0) {
    console.log('Nothing to clean.');
    await pool.end();
    process.exit(0);
}

const now = new Date().toISOString();
let updated = 0;
for (const row of q.rows) {
    const newName = `(unresolved — FS:${row.fs_id || 'unknown'})`;
    const noteLine = `[${now.slice(0, 10)}] cleanup-canonical-junk-names: original canonical_name was FS page nav breadcrumb (scraper artifact); renamed to "${newName}"; requires_human_review=true`;
    const mergedNotes = row.notes ? `${row.notes}\n${noteLine}` : noteLine;
    console.log(`  id=${row.id} fs=${row.fs_id || '-'} "${(row.canonical_name || '').slice(0, 50).replace(/\n/g, '\\n')}" → "${newName}"`);
    if (APPLY) {
        await pool.query(
            `UPDATE canonical_persons SET canonical_name=$1, notes=$2, updated_at=NOW() WHERE id=$3`,
            [newName, mergedNotes, row.id]
        );
        updated++;
    }
}
console.log();
console.log(APPLY ? `Rows updated: ${updated}` : 'DRY-RUN — re-run with --apply.');

await pool.end();
