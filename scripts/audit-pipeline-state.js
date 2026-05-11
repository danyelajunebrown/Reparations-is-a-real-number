#!/usr/bin/env node
/**
 * audit-pipeline-state.js
 *
 * Read-only audit of the two active scraping pipelines:
 *   1. 1860 Slave Schedule — records per state in unconfirmed_persons
 *   2. Freedman's Bank DocAI enrichment — depositor counts + enriched % per branch
 *   3. person_documents coverage — S3 screenshot rows for Freedman's Bank
 *
 * No writes. Safe to run from any machine.
 * Run: node scripts/audit-pipeline-state.js
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    })
  : new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT) || 5432,
      database: process.env.POSTGRES_DB || 'reparations',
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      ssl: false
    });

function sep(char = '─', len = 70) { return char.repeat(len); }
function header(title) {
  console.log('\n' + sep('═'));
  console.log(`  ${title}`);
  console.log(sep('═'));
}
function subheader(title) {
  console.log('\n' + sep('─'));
  console.log(`  ${title}`);
  console.log(sep('─'));
}

async function audit1860(client) {
  header('1860 SLAVE SCHEDULE  —  unconfirmed_persons');

  // Total 1860 records
  const totalRes = await client.query(`
    SELECT COUNT(*) AS total
    FROM unconfirmed_persons
    WHERE extraction_method ILIKE '%1860%'
       OR context_text      ILIKE '%slave schedule%'
       OR context_text      ILIKE '%1860 census%'
  `);
  console.log(`\nTotal 1860 records in unconfirmed_persons: ${totalRes.rows[0].total}`);

  // Per-state breakdown using locations[1] (the state stored there by extract-census-ocr)
  subheader('Records per state  (locations[1])');
  const stateRes = await client.query(`
    SELECT
      COALESCE(locations[1], '(no location)') AS state,
      COUNT(*)                                 AS total,
      COUNT(*) FILTER (WHERE person_type = 'enslaved')    AS enslaved,
      COUNT(*) FILTER (WHERE person_type = 'slaveholder') AS slaveholder
    FROM unconfirmed_persons
    WHERE extraction_method ILIKE '%1860%'
       OR context_text      ILIKE '%slave schedule%'
       OR context_text      ILIKE '%1860 census%'
    GROUP BY locations[1]
    ORDER BY total DESC
  `);

  if (stateRes.rows.length === 0) {
    console.log('  ⚠  No 1860 records found. Check extraction_method values.');
  } else {
    console.log(
      '  ' +
      'State'.padEnd(40) +
      'Total'.padStart(8) +
      'Enslaved'.padStart(12) +
      'Slaveholder'.padStart(14)
    );
    console.log('  ' + sep('-', 66));
    for (const r of stateRes.rows) {
      console.log(
        '  ' +
        String(r.state).padEnd(40) +
        String(r.total).padStart(8) +
        String(r.enslaved).padStart(12) +
        String(r.slaveholder).padStart(14)
      );
    }
  }

  // Also try by extraction_method for a cross-check
  subheader('Distinct extraction_method values seen in 1860 rows');
  const emRes = await client.query(`
    SELECT DISTINCT extraction_method, COUNT(*) AS cnt
    FROM unconfirmed_persons
    WHERE extraction_method ILIKE '%1860%'
       OR context_text      ILIKE '%slave schedule%'
    GROUP BY extraction_method
    ORDER BY cnt DESC
    LIMIT 20
  `);
  if (emRes.rows.length === 0) {
    console.log('  (none — 1860 rows may use a different extraction_method)');

    // Fallback: look at all extraction_methods to help diagnose
    const allEmRes = await client.query(`
      SELECT extraction_method, COUNT(*) AS cnt
      FROM unconfirmed_persons
      GROUP BY extraction_method
      ORDER BY cnt DESC
      LIMIT 15
    `);
    console.log('\n  Top extraction_method values across ALL unconfirmed_persons:');
    for (const r of allEmRes.rows) {
      console.log(`    ${String(r.extraction_method || '(null)').padEnd(50)} ${r.cnt}`);
    }
  } else {
    for (const r of emRes.rows) {
      console.log(`    ${String(r.extraction_method).padEnd(50)} ${r.cnt}`);
    }
  }

  // person_documents coverage for 1860
  subheader('person_documents rows linked to 1860 records');
  const pdRes = await client.query(`
    SELECT COUNT(*) AS pd_rows
    FROM person_documents pd
    JOIN unconfirmed_persons up ON up.lead_id = pd.unconfirmed_person_id
    WHERE up.extraction_method ILIKE '%1860%'
       OR up.context_text      ILIKE '%slave schedule%'
  `);
  console.log(`  person_documents rows (joined to 1860 unconfirmed_persons): ${pdRes.rows[0].pd_rows}`);

  const s3_1860 = await client.query(`
    SELECT COUNT(*) AS cnt
    FROM person_documents
    WHERE s3_key ILIKE '%1860%'
       OR s3_key ILIKE '%slave-schedule%'
       OR s3_key ILIKE '%census%'
  `);
  console.log(`  person_documents with 1860/census s3_key: ${s3_1860.rows[0].cnt}`);
}

async function auditFreedmens(client) {
  header("FREEDMAN'S BANK  —  unconfirmed_persons + DocAI enrichment");

  // Total depositors
  const totalRes = await client.query(`
    SELECT COUNT(*) AS total
    FROM unconfirmed_persons
    WHERE extraction_method = 'freedmens_bank_index'
  `);
  const total = parseInt(totalRes.rows[0].total, 10);
  console.log(`\nTotal Freedman's Bank depositors: ${total.toLocaleString()}`);

  // DocAI enriched count
  // enriched = relationships JSONB has a docai_fields entry
  // The DocAI enricher stores: relationships = '[{...}, {"docai_fields": {...}}]'
  // We check relationships @> '[{"docai_fields": {}}]' doesn't work for partial,
  // instead look for review_notes LIKE '%docai_enrichment%' (set by enrich-freedmens-docai.js)
  const enrichedByNotes = await client.query(`
    SELECT COUNT(*) AS enriched
    FROM unconfirmed_persons
    WHERE extraction_method = 'freedmens_bank_index'
      AND review_notes ILIKE '%docai_enrichment%'
  `);

  const enrichedByRelJson = await client.query(`
    SELECT COUNT(*) AS enriched
    FROM unconfirmed_persons
    WHERE extraction_method = 'freedmens_bank_index'
      AND relationships IS NOT NULL
      AND relationships::text ILIKE '%docai_fields%'
  `);

  const enrichedCount = Math.max(
    parseInt(enrichedByNotes.rows[0].enriched, 10),
    parseInt(enrichedByRelJson.rows[0].enriched, 10)
  );
  const pct = total > 0 ? ((enrichedCount / total) * 100).toFixed(2) : '0.00';

  console.log(`Enriched (docai_fields present):  ${enrichedCount.toLocaleString()}  (${pct}% of total)`);
  console.log(`Remaining (unenriched):           ${(total - enrichedCount).toLocaleString()}`);

  // Per-branch breakdown (locations[1] = branch name stored by scraper)
  subheader("Per-branch enrichment  (locations[1] = branch)");
  const branchRes = await client.query(`
    SELECT
      COALESCE(locations[1], '(no branch)') AS branch,
      COUNT(*)                               AS total,
      COUNT(*) FILTER (
        WHERE review_notes ILIKE '%docai_enrichment%'
           OR (relationships IS NOT NULL AND relationships::text ILIKE '%docai_fields%')
      )                                      AS enriched
    FROM unconfirmed_persons
    WHERE extraction_method = 'freedmens_bank_index'
    GROUP BY locations[1]
    ORDER BY total DESC
    LIMIT 40
  `);

  if (branchRes.rows.length === 0) {
    console.log('  ⚠  No Freedman\'s Bank rows found with extraction_method=freedmens_bank_index');
  } else {
    console.log(
      '  ' +
      'Branch'.padEnd(50) +
      'Total'.padStart(8) +
      'Enriched'.padStart(10) +
      'Pct'.padStart(8)
    );
    console.log('  ' + sep('-', 74));
    for (const r of branchRes.rows) {
      const t = parseInt(r.total, 10);
      const e = parseInt(r.enriched, 10);
      const p = t > 0 ? ((e / t) * 100).toFixed(1) : '0.0';
      const flag = e === 0 ? ' ← needs DocAI' : e < t ? ' ← partial' : ' ✓ done';
      console.log(
        '  ' +
        String(r.branch).padEnd(50) +
        String(t).padStart(8) +
        String(e).padStart(10) +
        `${p}%`.padStart(8) +
        flag
      );
    }
  }

  // parse_failure_queue for freedmens
  subheader('parse_failure_queue  (DocAI low-confidence / failures)');
  try {
    const pfRes = await client.query(`
      SELECT COUNT(*) AS cnt
      FROM parse_failure_queue
      WHERE source_table = 'unconfirmed_persons'
        AND reason ILIKE '%docai%'
    `);
    console.log(`  DocAI parse failures queued: ${pfRes.rows[0].cnt}`);

    const pfByReasonRes = await client.query(`
      SELECT reason, COUNT(*) AS cnt
      FROM parse_failure_queue
      WHERE source_table = 'unconfirmed_persons'
      GROUP BY reason
      ORDER BY cnt DESC
      LIMIT 10
    `);
    for (const r of pfByReasonRes.rows) {
      console.log(`    ${String(r.reason || '(null)').padEnd(60)} ${r.cnt}`);
    }
  } catch (e) {
    console.log(`  (parse_failure_queue query failed: ${e.message})`);
  }

  // S3 screenshot coverage
  subheader("S3 screenshots in person_documents  (freedmens-bank/)");
  const s3Res = await client.query(`
    SELECT COUNT(*) AS cnt
    FROM person_documents
    WHERE s3_key ILIKE 'freedmens-bank/%'
  `);
  console.log(`  person_documents rows with s3_key LIKE 'freedmens-bank/%': ${s3Res.rows[0].cnt}`);

  const s3DocaiRes = await client.query(`
    SELECT COUNT(*) AS cnt
    FROM person_documents
    WHERE s3_key ILIKE 'freedmens-bank/%/docai/%'
  `);
  console.log(`  …of which path contains /docai/: ${s3DocaiRes.rows[0].cnt}`);

  // Distinct branches with S3 screenshots
  const s3BranchRes = await client.query(`
    SELECT
      split_part(s3_key, '/', 2) AS branch_slug,
      COUNT(*) AS cnt
    FROM person_documents
    WHERE s3_key ILIKE 'freedmens-bank/%'
    GROUP BY branch_slug
    ORDER BY cnt DESC
    LIMIT 20
  `);
  if (s3BranchRes.rows.length > 0) {
    console.log('\n  S3 coverage by branch slug:');
    for (const r of s3BranchRes.rows) {
      console.log(`    ${String(r.branch_slug).padEnd(50)} ${r.cnt} screenshots`);
    }
  }
}

async function auditPersonDocuments(client) {
  header('PERSON_DOCUMENTS  —  overall coverage summary');

  const total = await client.query('SELECT COUNT(*) AS cnt FROM person_documents');
  console.log(`\nTotal person_documents rows: ${parseInt(total.rows[0].cnt, 10).toLocaleString()}`);

  const byType = await client.query(`
    SELECT
      COALESCE(document_type, '(null)')  AS doc_type,
      COUNT(*)                           AS cnt
    FROM person_documents
    GROUP BY document_type
    ORDER BY cnt DESC
    LIMIT 15
  `);
  console.log('\n  By document_type:');
  for (const r of byType.rows) {
    console.log(`    ${String(r.doc_type).padEnd(50)} ${parseInt(r.cnt).toLocaleString()}`);
  }

  const withS3 = await client.query(`
    SELECT COUNT(*) AS cnt FROM person_documents WHERE s3_key IS NOT NULL AND s3_key <> ''
  `);
  const withoutS3 = await client.query(`
    SELECT COUNT(*) AS cnt FROM person_documents WHERE s3_key IS NULL OR s3_key = ''
  `);
  console.log(`\n  With s3_key:    ${parseInt(withS3.rows[0].cnt).toLocaleString()}`);
  console.log(`  Without s3_key: ${parseInt(withoutS3.rows[0].cnt).toLocaleString()}`);
}

async function main() {
  console.log('\n' + sep('═'));
  console.log('  PIPELINE AUDIT  —  ' + new Date().toISOString());
  console.log(sep('═'));

  const client = await pool.connect();
  try {
    await audit1860(client);
    await auditFreedmens(client);
    await auditPersonDocuments(client);
  } finally {
    client.release();
    await pool.end();
  }

  console.log('\n' + sep('═'));
  console.log('  AUDIT COMPLETE');
  console.log(sep('═') + '\n');
}

main().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
