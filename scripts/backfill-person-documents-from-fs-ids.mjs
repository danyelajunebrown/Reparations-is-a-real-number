// Backfill `person_documents` for canonical_persons that have a
// person_external_ids.familysearch entry but no corresponding
// person_documents row.
//
// After this runs, `DAAOrchestrator.getPrimarySourcesForEnslaver()`
// returns a document pointing at the FS tree-person URL instead of "TBD",
// which eliminates the "FamilySearch ARK TBD" placeholder the DAA template
// prints when no source is found.
//
// What it creates per target canonical_person:
//   - name_as_appears = canonical_persons.canonical_name
//   - source_url      = https://www.familysearch.org/tree/person/details/<FS_ID>
//   - source_type     = 'familysearch_tree'
//   - document_type   = 'tree_profile'
//   - extraction_confidence = person_external_ids.confidence
//   - human_verified  = FALSE (they've been FS-verified but not human-reviewed here)
//
// Safe to re-run — checks for existing rows before inserting.
//
// Usage:
//   node scripts/backfill-person-documents-from-fs-ids.mjs            # dry-run
//   node scripts/backfill-person-documents-from-fs-ids.mjs --apply    # write

import 'dotenv/config';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Find all canonical_persons with a FS ID but no tree-profile person_documents row.
const q = await pool.query(`
    SELECT
        pei.canonical_person_id,
        pei.external_id,
        pei.external_url,
        pei.confidence,
        cp.canonical_name,
        cp.person_type
    FROM person_external_ids pei
    INNER JOIN canonical_persons cp ON cp.id = pei.canonical_person_id
    LEFT JOIN person_documents pd
        ON pd.canonical_person_id = pei.canonical_person_id
        AND pd.source_type = 'familysearch_tree'
    WHERE pei.id_system = 'familysearch'
      AND pd.id IS NULL
    ORDER BY pei.canonical_person_id
`);

console.log(`Backfill targets: ${q.rowCount} canonical_persons`);
console.log(`Mode: ${APPLY ? 'APPLY (writing to DB)' : 'DRY-RUN'}`);
console.log();

const byType = {};
for (const r of q.rows) {
    byType[r.person_type || '(null)'] = (byType[r.person_type || '(null)'] || 0) + 1;
}
console.log('By person_type:');
for (const [k, v] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(15)} ${v}`);
}

if (q.rowCount === 0) {
    console.log('Nothing to backfill.');
    await pool.end();
    process.exit(0);
}

// Sample the first 5 so we can see what we're about to insert
console.log('\nSample rows to insert:');
for (const r of q.rows.slice(0, 5)) {
    const url = r.external_url || `https://www.familysearch.org/tree/person/details/${r.external_id}`;
    console.log(`  ${r.external_id.padEnd(10)} "${(r.canonical_name||'').slice(0, 40)}" → ${url}`);
}

if (!APPLY) {
    console.log('\nDRY-RUN — re-run with --apply to persist.');
    await pool.end();
    process.exit(0);
}

let inserted = 0;
let skipped = 0;
for (const r of q.rows) {
    const url = r.external_url || `https://www.familysearch.org/tree/person/details/${r.external_id}`;
    const name = r.canonical_name || `(unnamed, FS:${r.external_id})`;
    try {
        await pool.query(`
            INSERT INTO person_documents (
                canonical_person_id,
                name_as_appears,
                source_url,
                source_type,
                collection_name,
                person_type,
                document_type,
                extraction_confidence,
                human_verified,
                created_by
            ) VALUES (
                $1, $2, $3, 'familysearch_tree',
                'FamilySearch Family Tree',
                $4, 'tree_profile', $5, FALSE, 'backfill_person_documents_from_fs_ids'
            )
        `, [r.canonical_person_id, name, url, r.person_type, r.confidence || 0.80]);
        inserted++;
    } catch (err) {
        skipped++;
        if (skipped <= 5) console.error(`  skip cp=${r.canonical_person_id}: ${err.message}`);
    }
}

console.log(`\nInserted: ${inserted}`);
console.log(`Skipped:  ${skipped}`);

await pool.end();
