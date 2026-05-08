#!/usr/bin/env node
/**
 * insert-msa-person-documents.js
 *
 * Phase 2 of MSA preservation: create person_documents rows for all
 * enslaved_individuals whose MSA SC 2908 PDF is now in S3.
 *
 * Uses a single INSERT ... SELECT query (one DB round-trip) instead of
 * 17,876 individual inserts — completes in seconds.
 *
 * Run AFTER scripts/archive-msa-sc2908-to-s3.js (which uploads the PDFs).
 *
 * Usage:
 *   node scripts/insert-msa-person-documents.js
 *   node scripts/insert-msa-person-documents.js --dry-run
 */

'use strict';
require('dotenv').config();

const { neon } = require('@neondatabase/serverless');

const DRY_RUN = process.argv.includes('--dry-run');
const S3_BUCKET = process.env.S3_BUCKET || 'reparations-them';

async function main() {
  const sql = neon(process.env.DATABASE_URL);

  console.log(`\n${'═'.repeat(60)}`);
  console.log('MSA SC 2908 — INSERT person_documents (bulk SQL)');
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Mode:      ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`  S3 bucket: ${S3_BUCKET}`);

  // Count eligible rows
  const countResult = await sql`
    SELECT COUNT(*) AS cnt
    FROM enslaved_individuals
    WHERE notes ILIKE '%msa.maryland.gov%'
      AND (regexp_match(notes, '(am\\d+--\\d+\\.pdf)'))[1] IS NOT NULL
  `;
  const total = parseInt(countResult[0].cnt);
  console.log(`\n  Eligible enslaved_individuals: ${total}`);

  // Check existing
  const existingResult = await sql`
    SELECT COUNT(*) AS cnt FROM person_documents
    WHERE s3_key ILIKE 'msa/sc2908/%'
  `;
  const existing = parseInt(existingResult[0].cnt);
  console.log(`  Already have msa/sc2908 rows:  ${existing}`);

  if (existing >= total) {
    console.log('\n  All rows already inserted. Nothing to do.\n');
    return;
  }

  if (DRY_RUN) {
    console.log('\n  DRY RUN — would execute:');
    console.log(`    INSERT INTO person_documents ... SELECT from enslaved_individuals`);
    console.log(`    Expected inserts: up to ${total - existing}`);
    return;
  }

  console.log('\n  Running bulk INSERT ... SELECT …');
  const s3Base = `https://${S3_BUCKET}.s3.amazonaws.com/msa/sc2908/`;

  // Single-query bulk insert: build s3_key and s3_url directly in SQL.
  // canonical_person_id is INTEGER — cast enslaved_by_individual_id safely;
  // NULL if it is empty or non-numeric (enslaved_individual_id is the real FK here).
  const result = await sql`
    INSERT INTO person_documents
      (enslaved_individual_id,
       canonical_person_id,
       name_as_appears,
       document_type,
       title,
       source_url,
       s3_key,
       s3_url)
    SELECT
      ei.enslaved_id,
      CASE
        WHEN ei.enslaved_by_individual_id ~ '^[0-9]+$'
          THEN ei.enslaved_by_individual_id::integer
        ELSE NULL
      END,
      ei.full_name,
      'certificate_of_freedom',
      'Certificate of Freedom — ' || ei.full_name,
      COALESCE(
        (regexp_match(ei.notes, 'Source:\\s*(https?://[^\\s,;]+\\.pdf)'))[1],
        'https://msa.maryland.gov/megafile/msa/speccol/sc2900/sc2908/000001/000812/pdf/'
          || (regexp_match(ei.notes, '(am\\d+--\\d+\\.pdf)'))[1]
      ),
      'msa/sc2908/' || (regexp_match(ei.notes, '(am\\d+--\\d+\\.pdf)'))[1],
      ${s3Base} || (regexp_match(ei.notes, '(am\\d+--\\d+\\.pdf)'))[1]
    FROM enslaved_individuals ei
    WHERE ei.notes ILIKE '%msa.maryland.gov%'
      AND (regexp_match(ei.notes, '(am\\d+--\\d+\\.pdf)'))[1] IS NOT NULL
    ON CONFLICT DO NOTHING
  `;

  // neon returns affected row count differently — query the DB for confirmation
  const afterResult = await sql`
    SELECT COUNT(*) AS cnt FROM person_documents
    WHERE s3_key ILIKE 'msa/sc2908/%'
  `;
  const after = parseInt(afterResult[0].cnt);
  const inserted = after - existing;

  console.log(`  ✓ Done`);
  console.log(`\n${'═'.repeat(60)}`);
  console.log('RESULTS');
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Rows before:  ${existing}`);
  console.log(`  Rows after:   ${after}`);
  console.log(`  Inserted:     ${inserted}`);
  console.log(`  S3 prefix:    s3://${S3_BUCKET}/msa/sc2908/`);

  // Verify Otho Brown specifically
  const othoBrown = await sql`
    SELECT pd.id, pd.name_as_appears, pd.s3_key, pd.s3_url, pd.source_url
    FROM person_documents pd
    WHERE pd.name_as_appears ILIKE '%otho%brown%'
       OR pd.name_as_appears ILIKE '%otho%'
    LIMIT 5
  `;
  if (othoBrown.length > 0) {
    console.log('\n  Sample — Otho Brown person_documents row:');
    othoBrown.forEach(r => {
      console.log(`    id=${r.id}  name="${r.name_as_appears}"`);
      console.log(`    s3_key:    ${r.s3_key}`);
      console.log(`    s3_url:    ${r.s3_url}`);
      console.log(`    source_url: ${r.source_url}`);
    });
  }

  // Final totals
  const totals = await sql`
    SELECT
      COUNT(*) FILTER (WHERE s3_key IS NOT NULL)           AS s3_backed,
      COUNT(*) FILTER (WHERE s3_key ILIKE 'msa/sc2908/%') AS msa_rows,
      COUNT(*)                                              AS total
    FROM person_documents
  `;
  console.log('\n  Full person_documents table:');
  console.log(`    Total rows:        ${totals[0].total}`);
  console.log(`    S3-backed rows:    ${totals[0].s3_backed}`);
  console.log(`    MSA SC 2908 rows:  ${totals[0].msa_rows}`);
  console.log(`${'═'.repeat(60)}\n`);
}

main().catch(err => {
  console.error('\nFATAL ERROR:', err.message);
  process.exit(1);
});
