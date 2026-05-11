#!/usr/bin/env node
/**
 * audit-family-edges.js
 *
 * Read-only diagnostic. Quantifies the scope of all four bug classes
 * identified on 2026-05-11:
 *
 *   Bug 1 — Missing family edges on canonical_persons profiles
 *            (spouse_name text column not converted to navigable edges)
 *   Bug 2 — Descendants visible in public person search
 *            (canonical_persons rows with person_type = 'descendant')
 *   Bug 3 — Ancestor-climb data contaminating primary source display
 *            (FamilySearch profile URLs appearing as primary source docs)
 *   Bug 4 — inheritance_edges table absent (now created by M067)
 *            Audit what will_extractions rows have heir data to backfill
 *
 * Usage:
 *   node scripts/audit-family-edges.js
 *   node scripts/audit-family-edges.js --json   # machine-readable output
 *
 * Does NOT write any data to the database. Safe to run at any time.
 */

'use strict';

require('dotenv').config();
const { Pool } = require('pg');

const JSON_OUTPUT = process.argv.includes('--json');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const SEP = '─'.repeat(70);

function header(title) {
  if (!JSON_OUTPUT) {
    console.log('\n' + SEP);
    console.log('  ' + title);
    console.log(SEP);
  }
}

function log(msg) {
  if (!JSON_OUTPUT) console.log(msg);
}

async function q(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

async function scalar(sql, params = []) {
  const rows = await q(sql, params);
  return rows[0] ? Object.values(rows[0])[0] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// BUG 1: Missing family edges on canonical_persons
// ─────────────────────────────────────────────────────────────────────────────
async function auditFamilyEdges() {
  header('BUG 1 — Family edges missing on canonical_persons profiles');

  // Total canonical_persons with a non-null spouse_name
  const spouseNameCount = await scalar(
    `SELECT COUNT(*) FROM canonical_persons WHERE spouse_name IS NOT NULL AND spouse_name != ''`
  );

  // How many of those have a canonical_family_edges spouse edge (may be 0 if table is new)
  const cfeTableExists = await scalar(
    `SELECT to_regclass('canonical_family_edges') IS NOT NULL`
  );

  let cfeSpouseCount = 0;
  if (cfeTableExists) {
    cfeSpouseCount = await scalar(
      `SELECT COUNT(DISTINCT LEAST(person_a_id, person_b_id) || '-' || GREATEST(person_a_id, person_b_id))
       FROM canonical_family_edges WHERE relationship_type = 'spouse'`
    );
  }

  // Sample: top 20 canonical_persons with spouse_name where NO edge exists
  let spouseGaps = [];
  if (cfeTableExists) {
    spouseGaps = await q(
      `SELECT cp.id, cp.canonical_name, cp.spouse_name, cp.person_type,
              cp.birth_year_estimate AS birth_year, cp.primary_state
       FROM canonical_persons cp
       WHERE cp.spouse_name IS NOT NULL AND cp.spouse_name != ''
         AND NOT EXISTS (
           SELECT 1 FROM canonical_family_edges cfe
           WHERE relationship_type = 'spouse'
             AND (cfe.person_a_id = cp.id OR cfe.person_b_id = cp.id)
         )
       ORDER BY cp.canonical_name
       LIMIT 25`
    );
  } else {
    // Table doesn't exist yet — all spouse_name rows are gaps
    spouseGaps = await q(
      `SELECT id, canonical_name, spouse_name, person_type,
              birth_year_estimate AS birth_year, primary_state
       FROM canonical_persons
       WHERE spouse_name IS NOT NULL AND spouse_name != ''
       ORDER BY canonical_name
       LIMIT 25`
    );
  }

  // How many of those spouse_names resolve to an existing canonical_persons row
  const resolvableSpouses = await q(
    `SELECT
       cp.id        AS person_id,
       cp.canonical_name AS person_name,
       cp.spouse_name,
       s.id         AS spouse_id,
       s.canonical_name AS spouse_canonical_name
     FROM canonical_persons cp
     JOIN canonical_persons s
       ON LOWER(s.canonical_name) = LOWER(cp.spouse_name)
       OR (
         s.first_name IS NOT NULL AND s.last_name IS NOT NULL AND
         LOWER(s.first_name || ' ' || s.last_name) = LOWER(cp.spouse_name)
       )
     WHERE cp.spouse_name IS NOT NULL AND cp.spouse_name != ''
     LIMIT 50`
  );

  // person_relationships_verified count (M033 table — may have some rows)
  const prvCount = await scalar(
    `SELECT COUNT(*) FROM person_relationships_verified`
  ).catch(() => 'table not found');

  log(`\n  canonical_persons with spouse_name (text):  ${spouseNameCount}`);
  log(`  canonical_family_edges spouse edges:        ${cfeSpouseCount}`);
  log(`  spouse_names that resolve to a canonical ID:${resolvableSpouses.length} (sample of 50)`);
  log(`  person_relationships_verified total rows:   ${prvCount}`);
  log(`\n  Sample gap records (person with spouse_name but no navigable edge):`);
  spouseGaps.forEach(r => {
    log(`    [${r.id}] ${r.canonical_name} (${r.person_type}) → spouse_name: "${r.spouse_name}"`);
  });

  // Specific: Henry Weaver and Mary Ann Weaver
  const weavers = await q(
    `SELECT id, canonical_name, person_type, spouse_name, birth_year_estimate, death_year_estimate
     FROM canonical_persons
     WHERE canonical_name ILIKE '%weaver%'
     ORDER BY canonical_name`
  );
  log(`\n  Weaver family members in canonical_persons (${weavers.length}):`);
  weavers.forEach(r => {
    log(`    [${r.id}] ${r.canonical_name} (${r.person_type}) b.${r.birth_year_estimate} d.${r.death_year_estimate} spouse:"${r.spouse_name || '—'}"`);
  });

  return {
    spouseNameCount: parseInt(spouseNameCount),
    cfeSpouseCount: parseInt(cfeSpouseCount),
    resolvableSpouseCount: resolvableSpouses.length,
    prvCount,
    spouseGapSample: spouseGaps,
    resolvableSample: resolvableSpouses,
    weaverFamily: weavers,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BUG 2: Descendants visible in public person search
// ─────────────────────────────────────────────────────────────────────────────
async function auditDescendants() {
  header('BUG 2 — Descendants visible in public canonical_persons search');

  const descendantCount = await scalar(
    `SELECT COUNT(*) FROM canonical_persons WHERE person_type = 'descendant'`
  );

  const byCreationSource = await q(
    `SELECT
       CASE
         WHEN notes::text LIKE '%climb%' OR notes::text LIKE '%ancestor%' THEN 'from_climb'
         WHEN notes::text LIKE '%wikitree%' THEN 'from_wikitree'
         WHEN notes::text LIKE '%familysearch%' THEN 'from_familysearch'
         ELSE 'other/unknown'
       END AS creation_source,
       COUNT(*) AS count
     FROM canonical_persons
     WHERE person_type = 'descendant'
     GROUP BY 1
     ORDER BY count DESC`
  );

  const sample = await q(
    `SELECT id, canonical_name, person_type, birth_year_estimate, primary_state,
            LEFT(notes::text, 120) AS notes_preview
     FROM canonical_persons
     WHERE person_type = 'descendant'
     ORDER BY id DESC
     LIMIT 20`
  );

  // Also check unconfirmed_persons for descendants
  const unconfirmedDescendants = await scalar(
    `SELECT COUNT(*) FROM unconfirmed_persons WHERE person_type = 'descendant'`
  ).catch(() => 0);

  // Biscoe descendants specifically
  const biscoeDescendants = await q(
    `SELECT id, canonical_name, person_type, birth_year_estimate
     FROM canonical_persons
     WHERE canonical_name ILIKE '%biscoe%'
     ORDER BY canonical_name`
  );

  log(`\n  canonical_persons with person_type = 'descendant': ${descendantCount}`);
  log(`  unconfirmed_persons with person_type = 'descendant': ${unconfirmedDescendants}`);
  log(`\n  By creation source:`);
  byCreationSource.forEach(r => log(`    ${r.creation_source}: ${r.count}`));
  log(`\n  Recent 'descendant' rows (newest first):`);
  sample.forEach(r => {
    log(`    [${r.id}] ${r.canonical_name} b.${r.birth_year_estimate || '?'} ${r.primary_state || ''}`);
    if (r.notes_preview) log(`         notes: ${r.notes_preview}`);
  });
  log(`\n  Biscoe family in canonical_persons (${biscoeDescendants.length}):`);
  biscoeDescendants.forEach(r => {
    log(`    [${r.id}] ${r.canonical_name} (${r.person_type}) b.${r.birth_year_estimate || '?'}`);
  });

  return {
    descendantCount: parseInt(descendantCount),
    unconfirmedDescendants: parseInt(unconfirmedDescendants),
    byCreationSource,
    sample,
    biscoeFamily: biscoeDescendants,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BUG 3: FamilySearch URLs as "primary source documents"
// ─────────────────────────────────────────────────────────────────────────────
async function auditClimbContamination() {
  header('BUG 3 — Ancestor-climb data contaminating primary source display');

  // person_documents rows with FS/WikiTree URLs linked to enslaver canonical persons
  const fsDocsOnEnslavers = await q(
    `SELECT
       pd.id,
       pd.title,
       pd.document_type,
       pd.source_url,
       pd.s3_key,
       cp.id   AS canonical_person_id,
       cp.canonical_name,
       cp.person_type
     FROM person_documents pd
     JOIN canonical_persons cp ON cp.id = pd.canonical_person_id
     WHERE cp.person_type IN ('enslaver','slaveholder','owner','confirmed_owner','free_poc_slaveholder')
       AND pd.s3_key IS NULL
       AND pd.source_url IS NOT NULL
       AND (
         pd.source_url ILIKE '%familysearch.org%'
         OR pd.source_url ILIKE '%wikitree.com%'
         OR pd.source_url ILIKE '%findagrave.com%'
       )
     ORDER BY cp.canonical_name, pd.id
     LIMIT 40`
  );

  // canonical_persons with source_url set to a FamilySearch profile
  const canonicalWithFsUrl = await q(
    `SELECT id, canonical_name, person_type, source_url
     FROM canonical_persons
     WHERE source_url ILIKE '%familysearch.org%'
       AND person_type IN ('enslaver','slaveholder','owner','confirmed_owner','free_poc_slaveholder')
     ORDER BY canonical_name
     LIMIT 25`
  );

  // person_external_ids for enslavers — these are legitimate FS IDs
  const externalIdCount = await scalar(
    `SELECT COUNT(*) FROM person_external_ids pei
     JOIN canonical_persons cp ON cp.id = pei.canonical_person_id
     WHERE pei.id_system = 'familysearch'
       AND cp.person_type IN ('enslaver','slaveholder','owner','confirmed_owner','free_poc_slaveholder')`
  ).catch(() => 'table not found');

  // George Washington Biscoe specific
  const biscoeProfile = await q(
    `SELECT cp.id, cp.canonical_name, cp.person_type, cp.source_url,
            pd.id AS doc_id, pd.title, pd.document_type, pd.source_url AS doc_source_url, pd.s3_key
     FROM canonical_persons cp
     LEFT JOIN person_documents pd ON pd.canonical_person_id = cp.id
     WHERE cp.canonical_name ILIKE '%george%biscoe%'
       OR cp.canonical_name ILIKE '%george washington biscoe%'
     ORDER BY cp.id, pd.id`
  );

  log(`\n  person_documents with FS/WikiTree/FindAGrave URLs linked to enslaver canonical persons`);
  log(`  (these are appearing as "Primary source documents" — they should be in External References)`);
  log(`  Count: ${fsDocsOnEnslavers.length}`);
  fsDocsOnEnslavers.forEach(r => {
    log(`    [pd:${r.id}] → [cp:${r.canonical_person_id}] ${r.canonical_name} (${r.person_type})`);
    log(`           type: ${r.document_type || '—'}  url: ${r.source_url}`);
  });

  log(`\n  canonical_persons with source_url pointing to FamilySearch: ${canonicalWithFsUrl.length}`);
  canonicalWithFsUrl.forEach(r => {
    log(`    [${r.id}] ${r.canonical_name} (${r.person_type})  → ${r.source_url}`);
  });

  log(`\n  Legitimate person_external_ids FS entries for enslavers: ${externalIdCount}`);
  log(`  (These are fine — they go in External References, not Primary Documents)`);

  log(`\n  George Washington Biscoe profile + documents:`);
  biscoeProfile.forEach(r => {
    log(`    cp[${r.id}] ${r.canonical_name} (${r.person_type}) source_url: ${r.source_url || '—'}`);
    if (r.doc_id) {
      log(`      → pd[${r.doc_id}] "${r.title}" type:${r.document_type || '—'} s3:${r.s3_key || 'NULL'} url:${r.doc_source_url || '—'}`);
    }
  });

  return {
    fsDocsOnEnslav: fsDocsOnEnslavers.length,
    canonicalWithFsUrl: canonicalWithFsUrl.length,
    externalIdCount,
    fsDocsDetail: fsDocsOnEnslavers,
    canonicalFsUrlDetail: canonicalWithFsUrl,
    biscoeProfile,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BUG 4: inheritance_edges readiness
// ─────────────────────────────────────────────────────────────────────────────
async function auditInheritanceReadiness() {
  header('BUG 4 — Inheritance edges table status + backfill readiness');

  const ieTableExists = await scalar(
    `SELECT to_regclass('inheritance_edges') IS NOT NULL`
  );

  let ieCount = 0;
  if (ieTableExists) {
    ieCount = await scalar(`SELECT COUNT(*) FROM inheritance_edges`);
  }

  // will_extractions with structured data (not pending_extraction)
  const readyWills = await q(
    `SELECT
       we.id,
       we.canonical_person_id,
       cp.canonical_name,
       cp.person_type,
       we.structured_extraction_jsonb->>'status' AS status,
       we.document_id,
       pd.title AS doc_title
     FROM will_extractions we
     LEFT JOIN canonical_persons cp ON cp.id = we.canonical_person_id
     LEFT JOIN person_documents pd ON pd.id = we.document_id
     WHERE we.structured_extraction_jsonb->>'status' != 'pending_extraction'
       OR we.structured_extraction_jsonb IS NOT NULL
     ORDER BY we.id
     LIMIT 20`
  ).catch(() => []);

  // Count wills with linked canonical_persons (can potentially have heir edges written)
  const linkedWillCount = await scalar(
    `SELECT COUNT(*) FROM will_extractions WHERE canonical_person_id IS NOT NULL`
  ).catch(() => 0);

  const totalWillCount = await scalar(
    `SELECT COUNT(*) FROM will_extractions`
  ).catch(() => 0);

  // Ground-truth wills we know about
  const groundTruthWills = await q(
    `SELECT pd.id, pd.title, pd.document_type, pd.canonical_person_id,
            cp.canonical_name, cp.person_type,
            we.id AS extraction_id,
            we.structured_extraction_jsonb->>'status' AS extraction_status
     FROM person_documents pd
     LEFT JOIN canonical_persons cp ON cp.id = pd.canonical_person_id
     LEFT JOIN will_extractions we ON we.document_id = pd.id
     WHERE pd.document_type = 'will'
     ORDER BY pd.id`
  ).catch(() => []);

  log(`\n  inheritance_edges table exists: ${ieTableExists}`);
  log(`  inheritance_edges rows: ${ieCount}`);
  log(`\n  will_extractions totals:`);
  log(`    Total rows:                ${totalWillCount}`);
  log(`    With canonical_person_id:  ${linkedWillCount}`);
  log(`    (Linked wills are candidates for heir-edge backfill)`);
  log(`\n  person_documents with document_type = 'will' (${groundTruthWills.length}):`);
  groundTruthWills.forEach(r => {
    log(`    [pd:${r.id}] "${r.title}" → cp:${r.canonical_person_id || 'UNLINKED'} ${r.canonical_name || '—'} (${r.person_type || '—'})`);
    log(`           extraction: ${r.extraction_id ? `we:${r.extraction_id} [${r.extraction_status || '—'}]` : 'none'}`);
  });

  return {
    ieTableExists,
    ieCount: parseInt(ieCount),
    totalWillCount: parseInt(totalWillCount),
    linkedWillCount: parseInt(linkedWillCount),
    groundTruthWills,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  try {
    if (!JSON_OUTPUT) {
      console.log('\n' + '═'.repeat(70));
      console.log('  FAMILY & INHERITANCE EDGES AUDIT');
      console.log('  Reparations ∈ ℝ — ' + new Date().toISOString());
      console.log('═'.repeat(70));
    }

    const [bug1, bug2, bug3, bug4] = await Promise.all([
      auditFamilyEdges(),
      auditDescendants(),
      auditClimbContamination(),
      auditInheritanceReadiness(),
    ]);

    header('SUMMARY');
    const summary = {
      bug1_spouse_edges_missing: bug1.spouseNameCount - bug1.cfeSpouseCount,
      bug1_resolvable_spouses: bug1.resolvableSpouseCount,
      bug2_descendants_in_canonical: bug2.descendantCount,
      bug2_descendants_in_unconfirmed: bug2.unconfirmedDescendants,
      bug3_fs_docs_on_enslavers: bug3.fsDocsOnEnslav,
      bug3_canonical_with_fs_url: bug3.canonicalWithFsUrl,
      bug4_ie_table_exists: bug4.ieTableExists,
      bug4_ie_rows: bug4.ieCount,
      bug4_linked_wills: bug4.linkedWillCount,
    };

    if (!JSON_OUTPUT) {
      log('\n  ACTION ITEMS:');
      log(`  1. Run backfill-family-edges-from-spouse-names.js`);
      log(`     → Will create ~${bug1.resolvableSpouseCount} navigable spouse edges`);
      log(`  2. Fix contribute.js search to exclude person_type IN ('descendant','modern_person',...)`);
      log(`     → Will hide ${bug2.descendantCount} descendant rows from public search`);
      log(`  3. Fix contribute.js getPerson to filter FS URLs from primary doc display`);
      log(`     → Will fix ${bug3.fsDocsOnEnslav} false "primary source" entries`);
      log(`  4. Run backfill-inheritance-edges-from-will-extractions.js`);
      log(`     → Will populate inheritance_edges from ${bug4.linkedWillCount} linked wills`);
      log('');
    }

    if (JSON_OUTPUT) {
      console.log(JSON.stringify({ summary, bug1, bug2, bug3, bug4 }, null, 2));
    }
  } catch (err) {
    console.error('[audit-family-edges] FATAL:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
