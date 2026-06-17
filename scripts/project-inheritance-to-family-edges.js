#!/usr/bin/env node
'use strict';

/**
 * project-inheritance-to-family-edges.js  (Front C, GitHub #72)
 *
 * De-silos the inheritance graph into the kinship graph. inheritance_edges
 * (4,007 rows) ALREADY has real canonical ids on both ends (testator_id, heir_id
 * → canonical_persons), so this is a clean set-based projection — no name
 * resolution needed. It maps relationship_to_testator → the canonical_family_edges
 * type vocabulary {parent_of, child_of, spouse, sibling_of} and inserts.
 *
 *   heir is son/daughter/child  → testator parent_of heir
 *   heir is wife/husband/spouse → spouse
 *   heir is brother/sister      → sibling_of
 *   heir is father/mother       → testator child_of heir
 *   anything else (nephew, grandchild, friend, NULL) → skipped (no clean type)
 *
 * This is the highest-leverage, lowest-risk slice of #72. The 382 Freedman's
 * cards and 191 probate heir-lists need NAME→canonical resolution and are a
 * separate, harder follow-up.
 *
 * Idempotent via ON CONFLICT (UNIQUE person_a,person_b,relationship_type). Dry-run
 * by default.
 *
 * USAGE: node scripts/project-inheritance-to-family-edges.js [--apply]
 */

require('dotenv').config();
const { Pool } = require('pg');
const APPLY = process.argv.includes('--apply');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Maps relationship_to_testator → (edge type, whether testator is person_a).
// Expressed as SQL so the whole projection is one set-based statement.
const TYPE_CASE = `
    CASE
        WHEN ie.relationship_to_testator ~* '(son|daughter|child)' AND ie.relationship_to_testator !~* 'grand' THEN 'parent_of'
        WHEN ie.relationship_to_testator ~* '(wife|husband|spouse|widow)' THEN 'spouse'
        WHEN ie.relationship_to_testator ~* '(brother|sister|sibling)' THEN 'sibling_of'
        WHEN ie.relationship_to_testator ~* '(father|mother|parent)' THEN 'child_of'
        ELSE NULL
    END`;

async function main() {
    console.log(`═══ inheritance_edges → canonical_family_edges ═══  ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

    const preview = await pool.query(`
        SELECT COALESCE(${TYPE_CASE}, '(unmapped)') AS edge_type, COUNT(*) n
        FROM inheritance_edges ie
        GROUP BY 1 ORDER BY 2 DESC
    `);
    console.log('Mapped edge types:');
    for (const r of preview.rows) console.log(`  ${String(r.n).padStart(5)}  ${r.edge_type}`);
    const before = (await pool.query(`SELECT COUNT(*) n FROM canonical_family_edges`)).rows[0].n;
    console.log(`\ncanonical_family_edges before: ${before}`);

    if (!APPLY) { console.log('\nDRY-RUN — re-run with --apply.'); await pool.end(); return; }

    const ins = await pool.query(`
        INSERT INTO canonical_family_edges
            (person_a_id, person_b_id, relationship_type, source_document_id, source_url, evidence_tier, confidence)
        SELECT ie.testator_id, ie.heir_id, ${TYPE_CASE},
               ie.source_document_id, ie.document_reference,
               COALESCE(ie.evidence_tier, 2), COALESCE(ie.confidence, 0.70)
        FROM inheritance_edges ie
        WHERE ${TYPE_CASE} IS NOT NULL
          AND ie.testator_id <> ie.heir_id
        ON CONFLICT (person_a_id, person_b_id, relationship_type) DO NOTHING
    `);
    const after = (await pool.query(`SELECT COUNT(*) n FROM canonical_family_edges`)).rows[0].n;
    console.log(`\n✓ inserted ${ins.rowCount} new edges (idempotent). canonical_family_edges: ${before} → ${after}`);
    await pool.end();
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
