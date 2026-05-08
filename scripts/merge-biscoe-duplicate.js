#!/usr/bin/env node
/**
 * Merge stale Ann Maria Biscoe (id=141016) into canonical (id=141015).
 * 
 * Steps:
 * 1. Migrate 3 person_documents rows: canonical_person_id 141016 → 141015
 * 2. DELETE canonical_persons row id=141016
 */
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

const STALE_ID = 141016;
const KEEP_ID = 141015;
const DRY_RUN = process.argv.includes('--dry-run');

(async () => {
  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Merging id=${STALE_ID} → id=${KEEP_ID}`);

  // Step 1: migrate person_documents
  const docsBefore = await sql`SELECT id FROM person_documents WHERE canonical_person_id = ${STALE_ID}`;
  console.log(`person_documents to migrate: ${docsBefore.length}`);

  if (!DRY_RUN && docsBefore.length > 0) {
    const updated = await sql`
      UPDATE person_documents
      SET canonical_person_id = ${KEEP_ID}
      WHERE canonical_person_id = ${STALE_ID}
      RETURNING id
    `;
    console.log(`  Migrated ${updated.length} person_documents rows.`);
  }

  // Step 2: delete the stale canonical_persons row
  if (!DRY_RUN) {
    await sql`DELETE FROM canonical_persons WHERE id = ${STALE_ID}`;
    console.log(`  Deleted canonical_persons id=${STALE_ID}`);
  }

  // Verify
  const remaining = await sql`SELECT id, canonical_name, primary_state, primary_county, sex FROM canonical_persons WHERE canonical_name = 'Ann Maria Biscoe'`;
  console.log('\nRemaining "Ann Maria Biscoe" rows:', JSON.stringify(remaining, null, 2));

  console.log(DRY_RUN ? '\nDry run complete. Run without --dry-run to apply.' : '\nMerge complete.');
})().catch(e => { console.error(e.message); process.exit(1); });
