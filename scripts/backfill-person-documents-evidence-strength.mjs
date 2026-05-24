#!/usr/bin/env node
/**
 * Backfill person_documents.evidence_strength.
 *
 * Categorises every row by document_type + presence/shape of source URL,
 * mirroring the rules in memory-bank/plan-source-classification.md so the UI
 * can render Primary vs Secondary sources honestly.
 *
 *   node scripts/backfill-person-documents-evidence-strength.mjs            # dry run
 *   node scripts/backfill-person-documents-evidence-strength.mjs --apply    # write
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const APPLY = process.argv.includes('--apply');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Categories in the order they should be applied. The first matching WHERE
// clause wins per row. (We run UPDATEs left-to-right with a guard so a row
// touched by an earlier rule is not re-touched.)
const RULES = [
  {
    label: 'direct_primary  (probate scans + freedom certs with S3 object)',
    target: 'direct_primary',
    where: `document_type IN ('will','deed','estate_inventory','guardian_account',
                              'estate_account','plantation_record',
                              'certificate_of_freedom','insurance_register',
                              'insurance_register_index')
            AND s3_key IS NOT NULL`,
  },
  {
    label: 'indirect_primary  (same types but URL-only, no S3 scan)',
    target: 'indirect_primary',
    where: `document_type IN ('will','deed','estate_inventory','guardian_account',
                              'estate_account','plantation_record',
                              'certificate_of_freedom','insurance_register',
                              'insurance_register_index')
            AND s3_key IS NULL`,
  },
  {
    label: 'indirect_primary  (FamilySearch /ark:/ indexed records — Bucket B)',
    target: 'indirect_primary',
    where: `document_type = 'familysearch_record'
            AND source_url ILIKE '%familysearch.org/ark:/%'`,
  },
  {
    label: 'secondary_database  (SlaveVoyages — Bucket C1)',
    target: 'secondary_database',
    where: `document_type = 'slavevoyages_record'`,
  },
  {
    label: 'secondary_published  (case_register published compilations)',
    target: 'secondary_published',
    where: `document_type = 'case_register'`,
  },
  {
    label: 'secondary_database  (Freedmen’s Bank ledgers — indexed db)',
    target: 'secondary_database',
    where: `document_type = 'freedmens_bank'`,
  },
  {
    label: 'direct_primary  (DC compensated emancipation petitions — scanned originals)',
    target: 'direct_primary',
    where: `document_type = 'compensated_emancipation_petition' AND s3_key IS NOT NULL`,
  },
  {
    label: 'indirect_primary  (census slave schedule transcripts — Bucket A)',
    target: 'indirect_primary',
    where: `document_type = 'census_slave_schedule'`,
  },
  {
    label: 'tree_profile      (identity provenance, NOT a source — leave NULL)',
    target: null,    // no-op; documented for clarity
    where: `document_type = 'tree_profile'`,
  },
];

async function main() {
  console.log(APPLY ? '=== evidence_strength backfill (APPLY) ===' : '=== evidence_strength backfill (DRY RUN) ===');

  // baseline
  const base = (await pool.query(
    `SELECT COUNT(*) total, COUNT(evidence_strength) already_set FROM person_documents`
  )).rows[0];
  console.log(`\nperson_documents: ${base.total} total, ${base.already_set} already have evidence_strength.`);

  let touched = 0;
  for (const rule of RULES) {
    // Only count/update rows still NULL — the first matching rule wins.
    const guard = `evidence_strength IS NULL AND (${rule.where})`;
    const n = Number((await pool.query(`SELECT COUNT(*) c FROM person_documents WHERE ${guard}`)).rows[0].c);
    console.log(`  ${String(n).padStart(7)}  ${rule.label}`);
    if (APPLY && rule.target && n > 0) {
      const r = await pool.query(
        `UPDATE person_documents SET evidence_strength = $1 WHERE ${guard}`,
        [rule.target]
      );
      touched += r.rowCount;
    }
  }

  const unclassified = Number((await pool.query(
    `SELECT COUNT(*) c FROM person_documents WHERE evidence_strength IS NULL`
  )).rows[0].c);
  console.log(`\nremaining NULL (will render as "unverified"): ${unclassified}`);

  if (APPLY) {
    console.log(`\nApplied. ${touched} row(s) updated.`);
    // Final distribution
    const dist = (await pool.query(
      `SELECT evidence_strength, COUNT(*) FROM person_documents GROUP BY 1 ORDER BY 2 DESC`
    )).rows;
    console.log('\nFinal distribution:');
    for (const d of dist) console.log(`  ${String(d.count).padStart(7)}  ${d.evidence_strength || 'NULL'}`);
  } else {
    console.log('\nDry run — nothing written. Re-run with --apply.');
  }
  await pool.end();
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
