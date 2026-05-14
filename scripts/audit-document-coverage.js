/**
 * scripts/audit-document-coverage.js
 *
 * Audits the document coverage across all person types in the database.
 * Identifies S3 gaps, broken document links, and coverage by source type.
 *
 * Usage: node scripts/audit-document-coverage.js
 */

require('dotenv').config();
const { query } = require('../src/database/connection');

async function main() {
  console.log('=== DOCUMENT COVERAGE AUDIT ===\n');

  // 1. person_documents coverage
  console.log('--- person_documents table ---');
  const pdCoverage = await query(`
    SELECT
      COUNT(*)                                          AS total_rows,
      COUNT(*) FILTER (WHERE s3_key IS NOT NULL)        AS has_s3_key,
      COUNT(*) FILTER (WHERE s3_url IS NOT NULL)        AS has_s3_url,
      COUNT(*) FILTER (WHERE source_url IS NOT NULL)    AS has_source_url,
      COUNT(*) FILTER (WHERE s3_key IS NULL AND source_url IS NOT NULL
                         AND document_type NOT IN ('tree_profile','freedmens_bank')) AS needs_backfill,
      COUNT(*) FILTER (WHERE s3_key IS NULL AND source_url IS NULL)     AS no_file_at_all,
      COUNT(*) FILTER (WHERE canonical_person_id IS NOT NULL)           AS linked_to_canonical,
      COUNT(*) FILTER (WHERE canonical_person_id IS NULL)               AS unlinked
    FROM person_documents
  `);
  const pd = pdCoverage.rows[0];
  console.log(`  Total rows:          ${pd.total_rows}`);
  console.log(`  Has s3_key:          ${pd.has_s3_key}`);
  console.log(`  Has s3_url:          ${pd.has_s3_url}`);
  console.log(`  Has source_url:      ${pd.has_source_url}`);
  console.log(`  Needs backfill:      ${pd.needs_backfill}  (source_url exists but s3_key missing)`);
  console.log(`  No file at all:      ${pd.no_file_at_all}`);
  console.log(`  Linked to canonical: ${pd.linked_to_canonical}`);
  console.log(`  Unlinked:            ${pd.unlinked}`);

  // 2. person_documents by document_type
  console.log('\n--- person_documents by document_type ---');
  const pdByType = await query(`
    SELECT
      document_type,
      COUNT(*)                                          AS total,
      COUNT(*) FILTER (WHERE s3_key IS NOT NULL)        AS has_s3,
      COUNT(*) FILTER (WHERE source_url IS NOT NULL
                         AND s3_key IS NULL)            AS needs_backfill
    FROM person_documents
    GROUP BY document_type
    ORDER BY total DESC
  `);
  for (const row of pdByType.rows) {
    console.log(`  ${(row.document_type || 'NULL').padEnd(30)} total=${row.total}  s3=${row.has_s3}  backfill_needed=${row.needs_backfill}`);
  }

  // 3. person_documents by source_url domain
  console.log('\n--- person_documents by source domain (top 15) ---');
  const pdByDomain = await query(`
    SELECT
      REGEXP_REPLACE(source_url, '^https?://([^/]+).*$', '\\1') AS domain,
      COUNT(*)                                          AS total,
      COUNT(*) FILTER (WHERE s3_key IS NOT NULL)        AS has_s3
    FROM person_documents
    WHERE source_url IS NOT NULL
    GROUP BY domain
    ORDER BY total DESC
    LIMIT 15
  `);
  for (const row of pdByDomain.rows) {
    console.log(`  ${(row.domain || 'NULL').padEnd(40)} total=${row.total}  s3=${row.has_s3}`);
  }

  // 4. confirming_documents coverage
  console.log('\n--- confirming_documents table ---');
  const cdCheck = await query(`
    SELECT COUNT(*) AS total FROM confirming_documents LIMIT 1
  `).catch(() => null);

  if (cdCheck) {
    const cdCoverage = await query(`
      SELECT
        COUNT(*)                                            AS total_rows,
        COUNT(*) FILTER (WHERE document_url IS NOT NULL)   AS has_url,
        COUNT(DISTINCT document_type)                       AS distinct_types
      FROM confirming_documents
    `);
    const cd = cdCoverage.rows[0];
    console.log(`  Total rows:     ${cd.total_rows}`);
    console.log(`  Has URL:        ${cd.has_url}`);
    console.log(`  Distinct types: ${cd.distinct_types}`);

    const cdByType = await query(`
      SELECT document_type, COUNT(*) AS total
      FROM confirming_documents
      GROUP BY document_type
      ORDER BY total DESC
      LIMIT 10
    `);
    for (const row of cdByType.rows) {
      console.log(`    ${(row.document_type || 'NULL').padEnd(30)} ${row.total}`);
    }

    // Sample URLs
    console.log('\n--- confirming_documents sample URLs ---');
    const cdSample = await query(`
      SELECT id, document_type, LEFT(document_url, 100) AS url_preview
      FROM confirming_documents
      WHERE document_url IS NOT NULL
      LIMIT 10
    `);
    for (const row of cdSample.rows) {
      console.log(`  [${row.id}] ${row.document_type}: ${row.url_preview}`);
    }
  } else {
    console.log('  confirming_documents table does not exist or is inaccessible');
  }

  // 5. Otho Brown specifically
  console.log('\n--- Otho Brown (ENS-AEAF6972) ---');
  const otho = await query(`
    SELECT enslaved_id, full_name, enslaved_by_individual_id, verified, notes
    FROM enslaved_individuals
    WHERE enslaved_id = 'ENS-AEAF6972'
  `);
  if (otho.rows.length > 0) {
    const o = otho.rows[0];
    console.log(`  Found: ${o.full_name} (verified=${o.verified})`);
    console.log(`  enslaved_by_individual_id: ${o.enslaved_by_individual_id || 'NULL'}`);
    console.log(`  notes: ${(o.notes || '').substring(0, 200)}`);

    // person_documents by name match
    const othoDocs = await query(`
      SELECT id, document_type, name_as_appears, s3_key, s3_url, source_url,
             collection_name, page_reference
      FROM person_documents
      WHERE name_as_appears ILIKE '%Brown%'
        AND (name_as_appears ILIKE '%Otho%' OR name_as_appears ILIKE '%O.%')
      LIMIT 20
    `);
    console.log(`\n  person_documents name-match rows: ${othoDocs.rows.length}`);
    for (const d of othoDocs.rows) {
      console.log(`    [${d.id}] type=${d.document_type} name="${d.name_as_appears}" s3_key=${d.s3_key || 'NULL'} source_url=${d.source_url || 'NULL'}`);
    }

    // confirming_documents by name match (if table exists)
    if (cdCheck) {
      const othoCD = await query(`
        SELECT cd.id, cd.document_type, cd.document_url, up.full_name
        FROM confirming_documents cd
        JOIN unconfirmed_persons up ON cd.unconfirmed_person_id = up.lead_id
        WHERE up.full_name ILIKE '%Otho Brown%'
        LIMIT 10
      `);
      console.log(`\n  confirming_documents name-match rows: ${othoCD.rows.length}`);
      for (const d of othoCD.rows) {
        console.log(`    [${d.id}] type=${d.document_type} url=${d.document_url}`);
      }
    }
  } else {
    console.log('  ENS-AEAF6972 not found in enslaved_individuals');

    // Try wider name search
    const broader = await query(`
      SELECT enslaved_id, full_name FROM enslaved_individuals
      WHERE full_name ILIKE '%Otho%' OR full_name ILIKE '%Brown%'
      LIMIT 10
    `);
    console.log(`  Broader name search results: ${broader.rows.length}`);
    for (const r of broader.rows) console.log(`    ${r.enslaved_id}: ${r.full_name}`);
  }

  // 6. Does person_documents have enslaved_individual_id column?
  console.log('\n--- person_documents schema check ---');
  const colCheck = await query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'person_documents'
    ORDER BY ordinal_position
  `);
  console.log('  Columns:', colCheck.rows.map(r => r.column_name).join(', '));
  const hasEnslavedIdCol = colCheck.rows.some(r => r.column_name === 'enslaved_individual_id');
  console.log(`  Has enslaved_individual_id column: ${hasEnslavedIdCol}`);

  // 7. Documents table — coverage for enslaved-related docs
  console.log('\n--- documents table (top doc types) ---');
  const docsTable = await query(`
    SELECT doc_type, COUNT(*) AS total,
           COUNT(*) FILTER (WHERE s3_key IS NOT NULL OR file_path IS NOT NULL) AS has_file
    FROM documents
    GROUP BY doc_type
    ORDER BY total DESC
    LIMIT 15
  `).catch(() => ({ rows: [] }));
  for (const row of docsTable.rows) {
    console.log(`  ${(row.doc_type || 'NULL').padEnd(30)} total=${row.total}  has_file=${row.has_file}`);
  }

  // 8. Sample person_documents that need backfill (source_url set, s3_key null)
  console.log('\n--- person_documents backfill sample (first 10) ---');
  const backfillSample = await query(`
    SELECT id, document_type, name_as_appears, collection_name, source_url
    FROM person_documents
    WHERE s3_key IS NULL AND source_url IS NOT NULL
    ORDER BY id ASC
    LIMIT 10
  `);
  for (const row of backfillSample.rows) {
    console.log(`  [${row.id}] type=${row.document_type} name="${row.name_as_appears}" url=${row.source_url}`);
  }

  console.log('\n=== AUDIT COMPLETE ===');
  process.exit(0);
}

main().catch(err => {
  console.error('Audit failed:', err.message);
  process.exit(1);
});
