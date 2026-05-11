#!/usr/bin/env node
/**
 * audit-climb-contamination.js
 *
 * Full contamination report for ancestor_climb_sessions data that has
 * leaked into canonical_persons and person_documents in ways that corrupt
 * the public-facing slavery records database.
 *
 * CONTAMINATION TYPES DETECTED:
 *
 *  A. canonical_persons rows with person_type = 'descendant' or 'modern_person'
 *     These are living/modern people inserted by the FamilySearch climber and must
 *     NEVER appear in the public search or as profile results.
 *
 *  B. person_documents rows where source_url is a FamilySearch profile URL (not a
 *     primary source document) AND s3_key IS NULL — these are external ID links
 *     masquerading as primary source documents in PersonProfile.jsx.
 *
 *  C. canonical_persons rows tagged as 'enslaver' whose ONLY supporting documents
 *     are FS profile URLs (no legitimate primary sources). These records may have
 *     been promoted through the climb pipeline without a real historical document.
 *
 * OUTPUTS:
 *  - Summary table to stdout
 *  - Proposed SQL patches printed at end (review before applying)
 *  - --json flag for machine-readable output
 *
 * USAGE:
 *   node scripts/audit-climb-contamination.js
 *   node scripts/audit-climb-contamination.js --json
 *   node scripts/audit-climb-contamination.js --fix-descendants  (applies DELETE for descendants)
 */

'use strict';

require('dotenv').config();
const { Pool } = require('pg');

const isJson = process.argv.includes('--json');
const applyFixDescendants = process.argv.includes('--fix-descendants');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function log(...args) {
    if (!isJson) console.log(...args);
}

function section(title) {
    if (!isJson) {
        console.log('\n' + '═'.repeat(70));
        console.log(`  ${title}`);
        console.log('═'.repeat(70));
    }
}

async function run() {
    const client = await pool.connect();
    const report = {};

    try {
        // ── A. Descendant contamination in canonical_persons ────────────────
        section('A. DESCENDANT ROWS IN canonical_persons');

        const descendantTypesResult = await client.query(`
            SELECT person_type, COUNT(*)::int AS count
            FROM canonical_persons
            WHERE person_type IN ('descendant', 'modern_person', 'participant')
            GROUP BY person_type
            ORDER BY count DESC
        `);
        report.A_descendant_types = descendantTypesResult.rows;
        log('By person_type:');
        descendantTypesResult.rows.forEach(r => log(`  ${r.person_type}: ${r.count}`));

        // Origin breakdown: how were they created?
        const descendantOriginResult = await client.query(`
            SELECT
                CASE
                    WHEN notes ILIKE '%ancestor_climb%' OR notes ILIKE '%familysearch climb%'
                        THEN 'ancestor_climb_notes'
                    WHEN notes ILIKE '%wikitree%' THEN 'wikitree_notes'
                    WHEN notes ILIKE '%familysearch%' THEN 'familysearch_notes'
                    ELSE 'unknown_origin'
                END AS origin,
                COUNT(*)::int AS count
            FROM canonical_persons
            WHERE person_type IN ('descendant', 'modern_person', 'participant')
            GROUP BY origin
            ORDER BY count DESC
        `);
        report.A_descendant_origins = descendantOriginResult.rows;
        log('\nOrigin breakdown:');
        descendantOriginResult.rows.forEach(r => log(`  ${r.origin}: ${r.count}`));

        // Sample 10 descendants for inspection
        const descendantSampleResult = await client.query(`
            SELECT id, canonical_name, person_type,
                   birth_year_estimate, death_year_estimate,
                   LEFT(notes, 100) AS notes_preview
            FROM canonical_persons
            WHERE person_type IN ('descendant', 'modern_person', 'participant')
            ORDER BY created_at DESC
            LIMIT 10
        `);
        report.A_descendant_sample = descendantSampleResult.rows;
        log('\nSample descendants (latest 10):');
        descendantSampleResult.rows.forEach(r =>
            log(`  [${r.id}] ${r.canonical_name} (${r.person_type}) b.${r.birth_year_estimate || '?'} — ${r.notes_preview || 'no notes'}`)
        );

        // Biscoe family check
        const biscoeDescendantsResult = await client.query(`
            SELECT id, canonical_name, person_type
            FROM canonical_persons
            WHERE canonical_name ILIKE '%biscoe%'
              AND person_type IN ('descendant', 'modern_person', 'participant')
        `);
        report.A_biscoe_descendants = biscoeDescendantsResult.rows;
        log(`\nBiscoe descendants in canonical_persons: ${biscoeDescendantsResult.rows.length}`);
        biscoeDescendantsResult.rows.forEach(r =>
            log(`  [${r.id}] ${r.canonical_name} (${r.person_type})`)
        );

        // ── B. FS/WikiTree profile URLs in person_documents ─────────────────
        section('B. FS/WIKITREE PROFILE URLs IN person_documents (no s3_key)');

        const fsUrlDocsResult = await client.query(`
            SELECT
                CASE
                    WHEN source_url ILIKE '%familysearch.org/tree/person%' THEN 'fs_person_profile'
                    WHEN source_url ILIKE '%familysearch.org%' THEN 'fs_other'
                    WHEN source_url ILIKE '%wikitree.com%' THEN 'wikitree_profile'
                    ELSE 'other'
                END AS url_type,
                COUNT(*)::int AS count,
                COUNT(canonical_person_id)::int AS with_canonical_id
            FROM person_documents
            WHERE s3_key IS NULL
              AND (
                source_url ILIKE '%familysearch.org%'
                OR source_url ILIKE '%wikitree.com%'
              )
            GROUP BY url_type
            ORDER BY count DESC
        `);
        report.B_fs_url_docs = fsUrlDocsResult.rows;
        log('FS/WikiTree URL rows by type:');
        fsUrlDocsResult.rows.forEach(r =>
            log(`  ${r.url_type}: ${r.count} total, ${r.with_canonical_id} linked to canonical_persons`)
        );

        // Top enslavers whose ONLY docs are FS URLs
        const enslaverFsOnlyResult = await client.query(`
            SELECT
                cp.id,
                cp.canonical_name,
                cp.person_type,
                COUNT(pd.id)::int AS fs_url_doc_count
            FROM canonical_persons cp
            JOIN person_documents pd ON pd.canonical_person_id = cp.id
            WHERE pd.s3_key IS NULL
              AND (pd.source_url ILIKE '%familysearch.org%' OR pd.source_url ILIKE '%wikitree.com%')
              AND cp.person_type IN ('enslaver', 'slaveholder', 'owner')
              AND NOT EXISTS (
                SELECT 1 FROM person_documents pd2
                WHERE pd2.canonical_person_id = cp.id
                  AND pd2.s3_key IS NOT NULL
              )
            GROUP BY cp.id, cp.canonical_name, cp.person_type
            ORDER BY fs_url_doc_count DESC
            LIMIT 20
        `);
        report.B_enslavers_with_only_fs_docs = enslaverFsOnlyResult.rows;
        log(`\nEnslavers whose ONLY person_documents are FS/WikiTree URLs (no real doc): ${enslaverFsOnlyResult.rows.length}`);
        enslaverFsOnlyResult.rows.forEach(r =>
            log(`  [${r.id}] ${r.canonical_name} (${r.person_type}) — ${r.fs_url_doc_count} FS URL docs`)
        );

        // George Washington Biscoe specific check
        const biscoeDocResult = await client.query(`
            SELECT pd.id, pd.document_type, pd.source_url, pd.s3_key, pd.title
            FROM person_documents pd
            JOIN canonical_persons cp ON cp.id = pd.canonical_person_id
            WHERE cp.canonical_name ILIKE '%george%biscoe%'
            ORDER BY pd.s3_key NULLS LAST
        `);
        report.B_biscoe_documents = biscoeDocResult.rows;
        log(`\nGeorge Biscoe documents: ${biscoeDocResult.rows.length}`);
        biscoeDocResult.rows.forEach(r =>
            log(`  [${r.id}] ${r.document_type || 'no type'} | s3_key=${r.s3_key ? 'SET' : 'NULL'} | ${r.source_url?.substring(0, 60)}`)
        );

        // ── C. ancestor_climb_sessions summary ──────────────────────────────
        section('C. ancestor_climb_sessions ACTIVITY');

        let climbSummary = { sessions: 0, matches: 0, descendant_canonical_rows: 0 };
        try {
            const climbResult = await client.query(`
                SELECT
                    COUNT(*)::int AS sessions,
                    SUM(match_count)::int AS total_matches
                FROM ancestor_climb_sessions
            `);
            climbSummary.sessions = climbResult.rows[0]?.sessions || 0;
            climbSummary.matches = climbResult.rows[0]?.total_matches || 0;
        } catch (e) {
            log('  ancestor_climb_sessions table not found or no match_count column');
        }

        // Count how many canonical_persons were inserted by the climb
        try {
            const climbCanonicalResult = await client.query(`
                SELECT COUNT(*)::int AS count
                FROM canonical_persons
                WHERE (notes ILIKE '%climb%' OR notes ILIKE '%ancestor_climb%')
                  AND person_type IN ('descendant', 'modern_person')
            `);
            climbSummary.descendant_canonical_rows = climbCanonicalResult.rows[0]?.count || 0;
        } catch (e) {
            // non-fatal
        }
        report.C_climb_summary = climbSummary;
        log(`Sessions: ${climbSummary.sessions} | Matches: ${climbSummary.matches} | Descendant canonical rows: ${climbSummary.descendant_canonical_rows}`);

        // ── D. Proposed patches ─────────────────────────────────────────────
        section('D. PROPOSED REMEDIATION SQL');

        const totalDescendants = descendantTypesResult.rows.reduce((s, r) => s + r.count, 0);
        const totalFsUrlDocs = fsUrlDocsResult.rows.reduce((s, r) => s + r.count, 0);

        const patches = [];

        if (totalDescendants > 0) {
            patches.push({
                label: 'DELETE descendant rows from canonical_persons',
                severity: 'HIGH',
                sql: `-- Review before applying: removes ${totalDescendants} descendant/modern_person rows
DELETE FROM canonical_persons
WHERE person_type IN ('descendant', 'modern_person')
  AND NOT EXISTS (
    SELECT 1 FROM enslaved_individuals ei WHERE ei.enslaved_by_individual_id::text = canonical_persons.id::text
  );`
            });
        }

        if (totalFsUrlDocs > 0) {
            patches.push({
                label: 'DELETE FS/WikiTree profile URL rows from person_documents',
                severity: 'MEDIUM',
                sql: `-- Review before applying: removes ${totalFsUrlDocs} FS/WikiTree URL-only rows
-- These should be in person_external_ids, NOT person_documents.
DELETE FROM person_documents
WHERE s3_key IS NULL
  AND (
    source_url ILIKE '%familysearch.org/tree/person%'
    OR source_url ILIKE '%wikitree.com/wiki%'
  );`
            });
            patches.push({
                label: 'Backfill FS/WikiTree IDs into person_external_ids instead',
                severity: 'MEDIUM',
                sql: `-- Migrate FS profile URLs to person_external_ids (correct table)
INSERT INTO person_external_ids (canonical_person_id, id_system, external_id, external_url, created_at)
SELECT
    pd.canonical_person_id,
    CASE WHEN pd.source_url ILIKE '%familysearch%' THEN 'familysearch' ELSE 'wikitree' END AS id_system,
    regexp_replace(pd.source_url, '.*/([A-Z0-9-]+)$', '\\1') AS external_id,
    pd.source_url AS external_url,
    NOW()
FROM person_documents pd
WHERE pd.s3_key IS NULL
  AND pd.canonical_person_id IS NOT NULL
  AND (pd.source_url ILIKE '%familysearch.org/tree/person%' OR pd.source_url ILIKE '%wikitree.com/wiki%')
ON CONFLICT (canonical_person_id, id_system, external_id) DO NOTHING;`
            });
        }

        report.D_proposed_patches = patches;

        if (!isJson) {
            patches.forEach(p => {
                log(`\n[${p.severity}] ${p.label}`);
                log(p.sql);
            });
        }

        // ── Summary ─────────────────────────────────────────────────────────
        section('SUMMARY');
        log(`  Descendant rows in canonical_persons: ${totalDescendants}`);
        log(`  FS/WikiTree URL rows in person_documents (no s3_key): ${totalFsUrlDocs}`);
        log(`  Enslavers with only FS docs (no real primary source): ${enslaverFsOnlyResult.rows.length}`);
        log(`  Biscoe descendants in search: ${biscoeDescendantsResult.rows.length}`);
        log(`  Biscoe documents total: ${biscoeDocResult.rows.length}`);

        if (totalDescendants === 0 && totalFsUrlDocs === 0) {
            log('\n  ✓ No contamination found. Climb data is properly isolated.');
        } else {
            log('\n  ✗ Contamination found. Apply patches above after review.');
            log('    Run with --fix-descendants to automatically DELETE descendant rows.');
        }

        // ── Optional: apply fix for descendants ─────────────────────────────
        if (applyFixDescendants && totalDescendants > 0) {
            section('APPLYING --fix-descendants');
            log('Deleting descendant rows that are not referenced by enslaved_individuals...');
            const deleteResult = await client.query(`
                DELETE FROM canonical_persons
                WHERE person_type IN ('descendant', 'modern_person')
                  AND NOT EXISTS (
                    SELECT 1 FROM enslaved_individuals ei
                    WHERE ei.enslaved_by_individual_id::text = canonical_persons.id::text
                  )
                RETURNING id, canonical_name
            `);
            report.applied_fix_descendants = {
                deleted: deleteResult.rowCount,
                sample: deleteResult.rows.slice(0, 10)
            };
            log(`  Deleted ${deleteResult.rowCount} descendant/modern_person rows.`);
        }

        if (isJson) {
            console.log(JSON.stringify(report, null, 2));
        }

    } finally {
        client.release();
        await pool.end();
    }
}

run().catch(err => {
    console.error('[audit-climb-contamination] FATAL:', err);
    process.exit(1);
});
