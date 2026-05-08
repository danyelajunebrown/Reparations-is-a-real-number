#!/usr/bin/env node
/**
 * backfill-document-collections.js
 *
 * Populates collection_name, collection_key, collection_page_number,
 * collection_page_count, and source_type_label on person_documents rows
 * so the person page can display grouped, labelled documents instead of
 * anonymous flat file listings.
 *
 * Handles four source types:
 *
 *  A. CivilWarDC compensated emancipation petition images
 *     - s3_key pattern: civilwardc/{docket}/{page}.jpg (or similar)
 *     - collection_key = docket number (e.g. 'cww.00430')
 *     - collection_name = 'DC Emancipation Petition {docket} — {claimant_name}'
 *     - page numbers assigned in s3_key sort order
 *
 *  B. MSA SC 2908 Certificates of Freedom
 *     - s3_key pattern: msa/sc2908/am812--{N}.pdf
 *     - One cert per person → collection of 1 page
 *     - collection_key = 'am812--{N}'
 *     - collection_name = 'Certificate of Freedom — {name_as_appears} · MSA AM 812'
 *     - source_type_label = 'Maryland Certificates of Freedom, 1806–1864'
 *
 *  C. Freedmen's Bank screenshots (from DocAI enrichment)
 *     - s3_key pattern: freedmens-bank/{branch-slug}/docai/{id}.png
 *     - One image per depositor
 *     - collection_name = 'Freedmen's Bank Record — {name_as_appears} ({branch})'
 *     - source_type_label = 'Freedmen's Savings and Trust Company Register'
 *
 *  D. FamilySearch tree profile docs
 *     - source_url contains familysearch.org
 *     - collection_name = 'FamilySearch Family Tree Profile'
 *     - source_type_label = 'FamilySearch Family Tree'
 *
 * Also propagates collection_page_count back to all rows in each collection.
 *
 * Usage:
 *   node scripts/backfill-document-collections.js            # dry-run (no writes)
 *   node scripts/backfill-document-collections.js --apply    # write to DB
 *   node scripts/backfill-document-collections.js --type msa --apply
 *   node scripts/backfill-document-collections.js --type civilwardc --apply
 *   node scripts/backfill-document-collections.js --type freedmens --apply
 *   node scripts/backfill-document-collections.js --type familysearch --apply
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { neon } = require('@neondatabase/serverless');

const APPLY   = process.argv.includes('--apply');
const TYPE    = (() => { const i = process.argv.indexOf('--type'); return i !== -1 ? process.argv[i+1] : 'all'; })();
const VERBOSE = process.argv.includes('--verbose');

const sql = neon(process.env.DATABASE_URL);

const stats = {
  msa_updated: 0,
  civilwardc_updated: 0,
  freedmens_updated: 0,
  familysearch_updated: 0,
  page_counts_updated: 0,
  errors: 0,
};

// ─────────────────────────────────────────────────────────────────────────────
// A. MSA SC 2908 Certificates of Freedom
// ─────────────────────────────────────────────────────────────────────────────
async function backfillMSA() {
  console.log('\n── A. MSA SC 2908 Certificates of Freedom ──');

  // These rows: s3_key starts with 'msa/sc2908/am812--'
  const rows = await sql`
    SELECT id, s3_key, name_as_appears, title
    FROM person_documents
    WHERE s3_key LIKE 'msa/sc2908/am812--%'
      AND (collection_name IS NULL OR collection_key IS NULL)
  `;
  console.log(`  Found ${rows.length} MSA cert rows needing collection metadata`);

  let updated = 0;
  for (const row of rows) {
    // Extract am812--N from s3_key
    const match = row.s3_key.match(/am812--(\d+)\.pdf$/i);
    if (!match) {
      if (VERBOSE) console.log(`  SKIP (no am812 match): ${row.s3_key}`);
      continue;
    }
    const fileKey = `am812--${match[1]}`;
    const personName = row.name_as_appears || 'Unknown';
    const collectionName = `Certificate of Freedom — ${personName} · MSA AM 812`;
    const sourceTypeLabel = 'Maryland Certificates of Freedom, 1806–1864 (Maryland State Archives)';
    const docTitle = row.title || `Certificate of Freedom: ${personName}`;

    if (APPLY) {
      await sql`
        UPDATE person_documents
        SET collection_name        = ${collectionName},
            collection_key         = ${fileKey},
            collection_page_number = 1,
            collection_page_count  = 1,
            source_type_label      = ${sourceTypeLabel},
            title                  = COALESCE(title, ${docTitle})
        WHERE id = ${row.id}
      `;
    } else {
      if (VERBOSE) console.log(`  [DRY-RUN] id=${row.id} → "${collectionName}"`);
    }
    updated++;
  }
  stats.msa_updated = updated;
  console.log(`  ${APPLY ? 'Updated' : 'Would update'}: ${updated} MSA cert rows`);
}

// ─────────────────────────────────────────────────────────────────────────────
// B. CivilWarDC compensated emancipation petition images
// ─────────────────────────────────────────────────────────────────────────────
async function backfillCivilWarDC() {
  console.log('\n── B. CivilWarDC Compensated Emancipation Petitions ──');

  // These rows: s3_key starts with 'civilwardc/' OR document_type contains 'petition'
  // AND they have a canonical_person_id we can look up
  const rows = await sql`
    SELECT
      pd.id,
      pd.s3_key,
      pd.source_url,
      pd.name_as_appears,
      pd.canonical_person_id,
      pd.document_type,
      pd.title
    FROM person_documents pd
    WHERE (
      pd.s3_key LIKE 'civilwardc/%'
      OR pd.document_type IN ('compensated_emancipation_petition', 'petition_image', 'dc_petition')
      OR pd.source_url LIKE '%civilwardc%'
    )
    AND (pd.collection_name IS NULL OR pd.collection_key IS NULL)
    ORDER BY pd.canonical_person_id, pd.s3_key NULLS LAST
  `;
  console.log(`  Found ${rows.length} civilwardc rows needing collection metadata`);

  if (rows.length === 0) {
    console.log('  (none to update)');
    return;
  }

  // Look up petition metadata for all unique canonical_person_ids in one query
  const canonicalIds = [...new Set(rows.map(r => r.canonical_person_id).filter(Boolean))];
  let petitionsByCanonicalId = {};

  if (canonicalIds.length > 0) {
    const petitions = await sql`
      SELECT
        claimant_canonical_id,
        docket_number,
        claimant_name,
        petition_type,
        filed_year
      FROM historical_reparations_petitions
      WHERE claimant_canonical_id = ANY(${canonicalIds}::integer[])
    `;
    for (const p of petitions) {
      if (!petitionsByCanonicalId[p.claimant_canonical_id]) {
        petitionsByCanonicalId[p.claimant_canonical_id] = [];
      }
      petitionsByCanonicalId[p.claimant_canonical_id].push(p);
    }
  }

  // Group rows by canonical_person_id + source_url (each unique petition is a collection)
  // Use source_url domain path fragment as collection_key if no docket available
  const groups = {};
  for (const row of rows) {
    // Derive a collection key
    let collectionKey = null;
    let petitionDocket = null;
    let claimantName = row.name_as_appears || null;

    // Try to extract docket from source_url (e.g. cww.00430)
    if (row.source_url) {
      const docketMatch = row.source_url.match(/cww[.\-](\d+)/i);
      if (docketMatch) petitionDocket = `cww.${docketMatch[1].padStart(5, '0')}`;
    }

    // Try to extract from s3_key pattern: civilwardc/cww.00430/page-1.jpg
    if (!petitionDocket && row.s3_key) {
      const s3Docket = row.s3_key.match(/civilwardc\/(cww[\.\-]\d+)/i);
      if (s3Docket) petitionDocket = s3Docket[1].replace('-', '.');
    }

    // Fall back: look up petition by canonical_person_id
    if (!petitionDocket && row.canonical_person_id) {
      const pets = petitionsByCanonicalId[row.canonical_person_id] || [];
      if (pets.length === 1) {
        petitionDocket = pets[0].docket_number;
        claimantName = claimantName || pets[0].claimant_name;
      } else if (pets.length > 1) {
        // Multiple petitions for same person — use canonical_person_id + index
        petitionDocket = `cp-${row.canonical_person_id}-petition`;
        claimantName = claimantName || pets[0].claimant_name;
      }
    }

    if (!petitionDocket) {
      // Last resort: use canonical_person_id
      petitionDocket = row.canonical_person_id
        ? `canonical-${row.canonical_person_id}`
        : `doc-${row.id}`;
    }

    collectionKey = petitionDocket;
    if (!groups[collectionKey]) {
      groups[collectionKey] = {
        key: collectionKey,
        claimantName,
        petitionDocket,
        rows: []
      };
    }
    groups[collectionKey].rows.push(row);
  }

  let updated = 0;
  for (const [key, group] of Object.entries(groups)) {
    // Sort pages within collection by s3_key alphabetically
    const sortedRows = [...group.rows].sort((a, b) => {
      const ka = a.s3_key || a.source_url || '';
      const kb = b.s3_key || b.source_url || '';
      return ka.localeCompare(kb);
    });
    const pageCount = sortedRows.length;
    const claimantName = group.claimantName || 'Unknown Claimant';
    const docket = group.petitionDocket || key;
    const collectionName = `DC Emancipation Petition ${docket} — ${claimantName}`;
    const sourceTypeLabel = 'DC Compensated Emancipation Petitions, 1862 (National Archives RG 217.6.5)';

    if (VERBOSE) {
      console.log(`  Collection "${collectionName}": ${pageCount} page(s)`);
    }

    for (let i = 0; i < sortedRows.length; i++) {
      const row = sortedRows[i];
      const pageNum = i + 1;
      const docTitle = pageCount === 1
        ? `DC Emancipation Petition — ${claimantName}`
        : `DC Emancipation Petition — ${claimantName} (page ${pageNum} of ${pageCount})`;

      if (APPLY) {
        await sql`
          UPDATE person_documents
          SET collection_name        = ${collectionName},
              collection_key         = ${key},
              collection_page_number = ${pageNum},
              collection_page_count  = ${pageCount},
              source_type_label      = ${sourceTypeLabel},
              title                  = COALESCE(title, ${docTitle})
          WHERE id = ${row.id}
        `;
      } else {
        if (VERBOSE) console.log(`    [DRY-RUN] id=${row.id} page ${pageNum}/${pageCount}`);
      }
      updated++;
    }
  }
  stats.civilwardc_updated = updated;
  console.log(`  ${APPLY ? 'Updated' : 'Would update'}: ${updated} civilwardc rows across ${Object.keys(groups).length} collections`);
}

// ─────────────────────────────────────────────────────────────────────────────
// C. Freedmen's Bank DocAI screenshots
// ─────────────────────────────────────────────────────────────────────────────
async function backfillFreedmensBank() {
  console.log('\n── C. Freedmen\'s Bank DocAI Screenshots ──');

  const rows = await sql`
    SELECT id, s3_key, name_as_appears, source_url, title
    FROM person_documents
    WHERE (
      s3_key LIKE 'freedmens-bank/%'
      OR document_type = 'freedmens_bank'
      OR source_url LIKE '%familysearch.org%1417695%'
    )
    AND (collection_name IS NULL OR collection_key IS NULL)
  `;
  console.log(`  Found ${rows.length} Freedmen's Bank rows needing collection metadata`);

  let updated = 0;
  for (const row of rows) {
    // Extract branch from s3_key: freedmens-bank/{branch-slug}/docai/{id}.png
    let branch = null;
    if (row.s3_key) {
      const slugMatch = row.s3_key.match(/^freedmens-bank\/([^/]+)\//);
      if (slugMatch) {
        // Convert slug back to title case: "washington-dc" → "Washington, DC"
        branch = slugMatch[1]
          .split('-')
          .map(w => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ')
          .replace(/ Dc$/, ', DC')
          .replace(/ Va$/, ', VA')
          .replace(/ Sc$/, ', SC')
          .replace(/ Nc$/, ', NC')
          .replace(/ Ga$/, ', GA')
          .replace(/ Tn$/, ', TN')
          .replace(/ Mo$/, ', MO')
          .replace(/ Ky$/, ', KY')
          .replace(/ Md$/, ', MD')
          .replace(/ Al$/, ', AL')
          .replace(/ Ms$/, ', MS')
          .replace(/ La$/, ', LA')
          .replace(/ Tx$/, ', TX');
      }
    }

    const personName = row.name_as_appears || 'Unknown Depositor';
    const branchSuffix = branch ? ` (${branch} branch)` : '';
    const collectionName = `Freedmen's Savings Bank Record — ${personName}${branchSuffix}`;
    const sourceTypeLabel = "Freedmen's Savings and Trust Company, Register of Signatures of Depositors";

    // collection_key: use s3_key basename without extension as unique ID
    let collectionKey = null;
    if (row.s3_key) {
      const base = row.s3_key.replace(/\.png$/i, '').replace(/\//g, '--');
      collectionKey = `freedmens-${base}`;
    } else if (row.source_url) {
      // FamilySearch ARK URL — use the ARK ID
      const arkMatch = row.source_url.match(/ark:\/[\d]+\/([A-Z0-9:]+)/i);
      collectionKey = arkMatch ? `freedmens-fs-${arkMatch[1]}` : `freedmens-${row.id}`;
    } else {
      collectionKey = `freedmens-${row.id}`;
    }

    const docTitle = row.title || collectionName;

    if (APPLY) {
      await sql`
        UPDATE person_documents
        SET collection_name        = ${collectionName},
            collection_key         = ${collectionKey},
            collection_page_number = 1,
            collection_page_count  = 1,
            source_type_label      = ${sourceTypeLabel},
            title                  = COALESCE(title, ${docTitle})
        WHERE id = ${row.id}
      `;
    } else {
      if (VERBOSE) console.log(`  [DRY-RUN] id=${row.id} → "${collectionName}"`);
    }
    updated++;
  }
  stats.freedmens_updated = updated;
  console.log(`  ${APPLY ? 'Updated' : 'Would update'}: ${updated} Freedmen's Bank rows`);
}

// ─────────────────────────────────────────────────────────────────────────────
// D. FamilySearch tree profile docs
// ─────────────────────────────────────────────────────────────────────────────
async function backfillFamilySearch() {
  console.log('\n── D. FamilySearch Tree Profile Documents ──');

  const rows = await sql`
    SELECT id, source_url, name_as_appears, document_type
    FROM person_documents
    WHERE source_url LIKE '%familysearch.org%'
      AND document_type = 'tree_profile'
      AND (collection_name IS NULL OR collection_key IS NULL)
    LIMIT 5000
  `;
  console.log(`  Found ${rows.length} FamilySearch tree profile rows needing metadata`);

  let updated = 0;
  for (const row of rows) {
    const personName = row.name_as_appears || 'Unknown';
    const collectionName = `FamilySearch Family Tree Profile — ${personName}`;
    const sourceTypeLabel = 'FamilySearch Family Tree (The Church of Jesus Christ of Latter-day Saints)';
    // Extract FS person ID from URL: /tree/person/details/XXXX or /tree/pedigree/portrait/XXXX
    const fsIdMatch = row.source_url?.match(/\/([A-Z0-9]{5,15})(?:\?|$)/);
    const collectionKey = fsIdMatch ? `fs-person-${fsIdMatch[1]}` : `fs-doc-${row.id}`;

    if (APPLY) {
      await sql`
        UPDATE person_documents
        SET collection_name        = ${collectionName},
            collection_key         = ${collectionKey},
            collection_page_number = 1,
            collection_page_count  = 1,
            source_type_label      = ${sourceTypeLabel}
        WHERE id = ${row.id}
      `;
    } else {
      if (VERBOSE) console.log(`  [DRY-RUN] id=${row.id} → "${collectionName}"`);
    }
    updated++;
  }
  stats.familysearch_updated = updated;
  console.log(`  ${APPLY ? 'Updated' : 'Would update'}: ${updated} FamilySearch tree profile rows`);
}

// ─────────────────────────────────────────────────────────────────────────────
// E. Final pass: propagate collection_page_count back to all pages in each collection
//    (necessary so all pages in a collection show "8 pages" not just the last-written)
// ─────────────────────────────────────────────────────────────────────────────
async function propagatePageCounts() {
  if (!APPLY) {
    console.log('\n── E. Page count propagation (skipped — dry-run) ──');
    return;
  }
  console.log('\n── E. Propagating collection_page_count to all pages ──');

  const result = await sql`
    WITH counts AS (
      SELECT collection_key, COUNT(*) AS page_count
      FROM person_documents
      WHERE collection_key IS NOT NULL
      GROUP BY collection_key
      HAVING COUNT(*) > 1
    )
    UPDATE person_documents pd
    SET collection_page_count = c.page_count
    FROM counts c
    WHERE pd.collection_key = c.collection_key
      AND pd.collection_page_count != c.page_count
    RETURNING pd.id
  `;
  stats.page_counts_updated = result.length;
  console.log(`  Propagated correct page_count to ${result.length} rows`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== backfill-document-collections.js ===');
  console.log(`Mode: ${APPLY ? 'APPLY (writing to DB)' : 'DRY-RUN (no writes)'}`);
  console.log(`Type filter: ${TYPE}`);

  if (TYPE === 'all' || TYPE === 'msa') await backfillMSA();
  if (TYPE === 'all' || TYPE === 'civilwardc') await backfillCivilWarDC();
  if (TYPE === 'all' || TYPE === 'freedmens') await backfillFreedmensBank();
  if (TYPE === 'all' || TYPE === 'familysearch') await backfillFamilySearch();
  await propagatePageCounts();

  console.log('\n=== Summary ===');
  console.log(`  MSA certs updated:           ${stats.msa_updated}`);
  console.log(`  CivilWarDC petitions updated: ${stats.civilwardc_updated}`);
  console.log(`  Freedmen's Bank updated:      ${stats.freedmens_updated}`);
  console.log(`  FamilySearch updated:         ${stats.familysearch_updated}`);
  console.log(`  Page counts propagated:       ${stats.page_counts_updated}`);
  console.log(`  Errors:                       ${stats.errors}`);

  if (!APPLY) {
    console.log('\nRe-run with --apply to commit changes to the database.');
  } else {
    // Final coverage check
    const coverage = await sql`
      SELECT
        COUNT(*)                                              AS total,
        COUNT(*) FILTER (WHERE collection_name IS NOT NULL)  AS has_collection,
        COUNT(*) FILTER (WHERE title IS NOT NULL)            AS has_title,
        COUNT(*) FILTER (WHERE collection_page_count > 1)    AS multi_page
      FROM person_documents
    `;
    const c = coverage[0];
    console.log(`\nPost-run coverage:`);
    console.log(`  Total rows:           ${c.total}`);
    console.log(`  Has collection_name:  ${c.has_collection} (${Math.round(c.has_collection/c.total*100)}%)`);
    console.log(`  Has title:            ${c.has_title} (${Math.round(c.has_title/c.total*100)}%)`);
    console.log(`  Multi-page docs:      ${c.multi_page} rows are part of multi-page collections`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
