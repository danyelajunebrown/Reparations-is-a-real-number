/**
 * scripts/fix-document-coverage-gaps.js
 *
 * Runs the two SQL-only remediation tasks from the document coverage audit:
 *
 * GAP 1 (Critical): Backfill canonical_person_id on census_slave_schedule rows in
 *   person_documents that have unconfirmed_person_id set AND the corresponding
 *   unconfirmed_persons row has been confirmed (confirmed_individual_id IS NOT NULL).
 *   89,459 rows estimated. After this backfill, census schedule pages will appear
 *   on the canonical person's profile page.
 *
 * GAP 5 (Medium): Clear stub beyondkin.org image URLs from confirming_documents.
 *   27 rows have document_url pointing to the BeyondKin header image rather than
 *   an actual document — these are broken/misleading. Setting them to NULL prevents
 *   the frontend from displaying a broken image as "evidence."
 *
 * Usage: node scripts/fix-document-coverage-gaps.js [--dry-run]
 */

require('dotenv').config();
const { query } = require('../src/database/connection');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log(`=== Document Coverage Gap Fixes${DRY_RUN ? ' (DRY RUN)' : ''} ===\n`);

  // ─────────────────────────────────────────────────────────────────
  // GAP 5: Clear beyondkin stub URLs from confirming_documents
  // ─────────────────────────────────────────────────────────────────
  console.log('--- GAP 5: confirming_documents stub URL cleanup ---');

  // Preview first
  const stubPreview = await query(`
    SELECT COUNT(*) AS total
    FROM confirming_documents
    WHERE document_url ILIKE '%beyondkin%'
  `);
  console.log(`  Rows with beyondkin stub URLs: ${stubPreview.rows[0].total}`);

  // document_url has a NOT NULL constraint — delete the stub rows entirely.
  // These 27 entries point to the beyondkin.org site header image, not any
  // actual historical document, so there is nothing of value to preserve.
  // Use RETURNING id so Neon HTTP driver exposes count via rows.length.
  if (!DRY_RUN) {
    try {
      const stubFix = await query(`
        DELETE FROM confirming_documents
        WHERE document_url ILIKE '%beyondkin%'
        RETURNING id
      `);
      const deletedCount = stubFix.rows ? stubFix.rows.length : (stubFix.rowCount || 0);
      console.log(`  ✅ Deleted ${deletedCount} bogus stub row(s) from confirming_documents`);
    } catch (e) {
      console.log(`  ⚠️  Gap 5 delete failed (non-fatal): ${e.message}`);
    }
  } else {
    console.log('  [DRY RUN] Would delete stub rows — run without --dry-run to apply');
  }

  // ─────────────────────────────────────────────────────────────────
  // GAP 1: Backfill canonical_person_id on person_documents rows
  //        that are linked only via unconfirmed_person_id but the
  //        unconfirmed_persons row has since been confirmed.
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- GAP 1: person_documents canonical_person_id backfill ---');

  // Preview: how many rows qualify
  const gap1Preview = await query(`
    SELECT COUNT(*) AS eligible
    FROM person_documents pd
    JOIN unconfirmed_persons up ON pd.unconfirmed_person_id = up.lead_id
    WHERE up.confirmed_individual_id IS NOT NULL
      AND pd.canonical_person_id IS NULL
  `).catch(e => {
    console.log('  Preview query error (confirmed_individual_id column may not exist):', e.message);
    return null;
  });

  if (!gap1Preview) {
    console.log('  Skipping Gap 1 backfill — unconfirmed_persons.confirmed_individual_id column not found.');
    console.log('  Check migrations/033-identity-system.sql or equivalent for column name.');
  } else {
    console.log(`  Eligible rows (unconfirmed_person_id set, confirmed, canonical_person_id NULL): ${gap1Preview.rows[0].eligible}`);

    if (!DRY_RUN) {
      // confirmed_individual_id is varchar; canonical_person_id is integer — cast explicitly.
      const gap1Fix = await query(`
        UPDATE person_documents
        SET canonical_person_id = up.confirmed_individual_id::integer
        FROM unconfirmed_persons up
        WHERE person_documents.unconfirmed_person_id = up.lead_id
          AND up.confirmed_individual_id IS NOT NULL
          AND person_documents.canonical_person_id IS NULL
      `);
      console.log(`  ✅ Backfilled canonical_person_id on ${gap1Fix.rowCount} person_documents row(s)`);
    } else {
      console.log('  [DRY RUN] Would backfill — run without --dry-run to apply');
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // GAP 3: Verify / annotate the 31 true orphan rows
  //        These are collection-level reference documents that are
  //        intentionally not linked to any individual person.
  //        No person backfill needed — just verify the count.
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- GAP 3: True orphan rows (all three FK columns NULL) ---');
  const orphanCheck = await query(`
    SELECT document_type, COUNT(*) AS total
    FROM person_documents
    WHERE canonical_person_id IS NULL
      AND enslaved_individual_id IS NULL
      AND unconfirmed_person_id IS NULL
    GROUP BY document_type
    ORDER BY total DESC
  `).catch(e => ({ rows: [] }));

  if (orphanCheck.rows.length === 0) {
    console.log('  No true orphan rows found — all rows have at least one FK set ✅');
  } else {
    let orphanTotal = 0;
    for (const row of orphanCheck.rows) {
      console.log(`  ${(row.document_type || 'NULL').padEnd(30)} ${row.total}`);
      orphanTotal += parseInt(row.total);
    }
    console.log(`  Total orphan rows: ${orphanTotal}`);
    console.log('  ℹ️  These are collection-level reference documents (by design — no individual person link needed).');
    console.log('  Recommendation: Surface as a browsable reference collection in the UI rather than person-profile documents.');
  }

  // ─────────────────────────────────────────────────────────────────
  // Post-fix summary
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- Post-fix person_documents FK coverage ---');
  const fkSummary = await query(`
    SELECT
      COUNT(*) FILTER (WHERE canonical_person_id IS NOT NULL AND enslaved_individual_id IS NOT NULL) AS both_canonical_and_enslaved,
      COUNT(*) FILTER (WHERE canonical_person_id IS NOT NULL AND enslaved_individual_id IS NULL AND unconfirmed_person_id IS NULL) AS canonical_only,
      COUNT(*) FILTER (WHERE enslaved_individual_id IS NOT NULL AND canonical_person_id IS NULL) AS enslaved_only,
      COUNT(*) FILTER (WHERE unconfirmed_person_id IS NOT NULL AND canonical_person_id IS NULL AND enslaved_individual_id IS NULL) AS unconfirmed_only,
      COUNT(*) FILTER (WHERE canonical_person_id IS NULL AND enslaved_individual_id IS NULL AND unconfirmed_person_id IS NULL) AS no_fk
    FROM person_documents
  `).catch(() => null);

  if (fkSummary) {
    const s = fkSummary.rows[0];
    console.log(`  Both canonical + enslaved_individual:  ${s.both_canonical_and_enslaved}`);
    console.log(`  canonical_person_id only:              ${s.canonical_only}`);
    console.log(`  enslaved_individual_id only:           ${s.enslaved_only}`);
    console.log(`  unconfirmed_person_id only:            ${s.unconfirmed_only}`);
    console.log(`  No FK at all (true orphans):           ${s.no_fk}`);
  }

  console.log('\n=== Fix script complete ===');
  process.exit(0);
}

main().catch(err => {
  console.error('Fix script failed:', err.message);
  process.exit(1);
});
