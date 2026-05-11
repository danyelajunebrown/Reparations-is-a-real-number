#!/usr/bin/env node
/**
 * backfill-family-edges-from-spouse-names.js
 *
 * Reads canonical_persons where spouse_name IS NOT NULL, attempts a name
 * lookup in canonical_persons to find a matching canonical ID for the spouse,
 * and writes canonical_family_edges rows with evidence_tier=3, verified=false.
 *
 * EVIDENCE TIER: These edges are tier 3 (compiled/inferred) because the
 * spouse_name column is a raw text string — not a FK to a verified person
 * record. They must be manually promoted to tier 1/2 via the review queue.
 *
 * IDEMPOTENT: Uses INSERT ... ON CONFLICT DO NOTHING so it is safe to
 * re-run without creating duplicates.
 *
 * USAGE:
 *   node scripts/backfill-family-edges-from-spouse-names.js
 *   node scripts/backfill-family-edges-from-spouse-names.js --dry-run
 *   node scripts/backfill-family-edges-from-spouse-names.js --limit 500
 */

'use strict';

require('dotenv').config();
const { Pool } = require('pg');

const isDryRun = process.argv.includes('--dry-run');
const limitArg = process.argv.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : 50000;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Minimum word overlap required for a name match (to avoid false positives)
// e.g. "Mary Ann Weaver" vs "Mary A. Weaver" → 2 matching tokens → OK
const MIN_WORD_OVERLAP = 1;

async function run() {
    const client = await pool.connect();
    try {
        console.log('[backfill-family-edges] Starting spouse_name backfill...');
        if (isDryRun) console.log('[backfill-family-edges] DRY RUN — no writes will be made');

        // 1. Fetch all canonical_persons with a spouse_name that isn't already
        //    covered by a canonical_family_edges spouse edge.
        //
        // NOTE: canonical_persons does NOT have a spouse_name column.
        // The spouse_name column exists on enslaved_individuals (which uses
        // spouse_ids FK array for canonical edges). For canonical_persons,
        // spouse data lives entirely in canonical_family_edges (M066).
        // This script exits gracefully with 0 candidates for canonical_persons.
        //
        // Check if spouse_name column exists before querying
        const colCheck = await client.query(`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'canonical_persons' AND column_name = 'spouse_name'
        `);
        if (colCheck.rows.length === 0) {
            console.log('[backfill-family-edges] canonical_persons.spouse_name column does not exist.');
            console.log('[backfill-family-edges] Spouse data for canonical_persons lives in canonical_family_edges (M066).');
            console.log('[backfill-family-edges] Use direct INSERT into canonical_family_edges for canonical_persons spouses.');
            console.log('[backfill-family-edges] Done — 0 candidates processed.');
            return;
        }

        const sourceResult = await client.query(`
            SELECT cp.id, cp.canonical_name, cp.spouse_name
            FROM canonical_persons cp
            WHERE cp.spouse_name IS NOT NULL
              AND cp.spouse_name <> ''
              AND NOT EXISTS (
                SELECT 1 FROM canonical_family_edges cfe
                WHERE cfe.relationship_type = 'spouse'
                  AND (cfe.person_a_id = cp.id OR cfe.person_b_id = cp.id)
              )
            LIMIT $1
        `, [LIMIT]);

        const candidates = sourceResult.rows;
        console.log(`[backfill-family-edges] ${candidates.length} canonical_persons have spouse_name with no existing edge`);

        let matched = 0;
        let unmatched = 0;
        let inserted = 0;
        let skipped = 0;

        for (const person of candidates) {
            const spouseNameRaw = person.spouse_name.trim();

            // Tokenize spouse name — try exact match first, then word-overlap
            const spouseTokens = spouseNameRaw
                .toLowerCase()
                .replace(/[^\w\s]/g, '')
                .split(/\s+/)
                .filter(t => t.length >= 2);

            if (spouseTokens.length === 0) {
                unmatched++;
                continue;
            }

            // Try exact ILIKE match first
            let matchResult = await client.query(`
                SELECT id, canonical_name
                FROM canonical_persons
                WHERE canonical_name ILIKE $1
                  AND id <> $2
                LIMIT 5
            `, [`%${spouseNameRaw}%`, person.id]);

            // If no exact match, try all-words must match (AND of ILIKE tokens)
            if (matchResult.rows.length === 0 && spouseTokens.length >= 2) {
                const conditions = spouseTokens
                    .map((_, i) => `canonical_name ILIKE $${i + 2}`)
                    .join(' AND ');
                const params = [`${person.id}`, ...spouseTokens.map(t => `%${t}%`)];
                matchResult = await client.query(`
                    SELECT id, canonical_name
                    FROM canonical_persons
                    WHERE ${conditions}
                      AND id <> $1
                    LIMIT 5
                `, params);
            }

            if (matchResult.rows.length === 0) {
                unmatched++;
                continue;
            }

            // Take the first match (best candidate)
            const spouseCanonical = matchResult.rows[0];
            matched++;

            // Canonical edge: always write person_a_id < person_b_id to ensure
            // the UNIQUE constraint (person_a_id, person_b_id, relationship_type,
            // source_document_id) is deterministic regardless of direction.
            const personAId = Math.min(person.id, spouseCanonical.id);
            const personBId = Math.max(person.id, spouseCanonical.id);

            if (isDryRun) {
                console.log(`  [DRY-RUN] Would insert edge: ${person.canonical_name} ↔ ${spouseCanonical.canonical_name} (tier 3, unverified)`);
                inserted++;
                continue;
            }

            try {
                const insertResult = await client.query(`
                    INSERT INTO canonical_family_edges (
                        person_a_id,
                        person_b_id,
                        relationship_type,
                        evidence_tier,
                        confidence,
                        verified,
                        notes,
                        created_at,
                        updated_at
                    )
                    VALUES ($1, $2, 'spouse', 3, 0.5, false,
                        $3,
                        NOW(), NOW()
                    )
                    ON CONFLICT (person_a_id, person_b_id, relationship_type, source_document_id)
                    DO NOTHING
                    RETURNING id
                `, [
                    personAId,
                    personBId,
                    `Inferred from canonical_persons.spouse_name: "${spouseNameRaw}" on person id=${person.id} (${person.canonical_name}). Evidence tier 3 — unverified. Promote to tier 1/2 once confirmed by documentary evidence.`
                ]);

                if (insertResult.rowCount > 0) {
                    inserted++;
                } else {
                    skipped++; // ON CONFLICT hit — already exists
                }
            } catch (insertErr) {
                // Table may not have been migrated yet — log and continue
                console.error(`  [ERROR] Insert failed for ${person.canonical_name}: ${insertErr.message}`);
            }
        }

        console.log('\n[backfill-family-edges] Results:');
        console.log(`  Total candidates:  ${candidates.length}`);
        console.log(`  Name matched:      ${matched}`);
        console.log(`  Unmatched (no ID): ${unmatched}`);
        console.log(`  Edges inserted:    ${inserted}`);
        console.log(`  Already existed:   ${skipped}`);
        if (isDryRun) console.log('  (DRY RUN — no changes written)');

        console.log('\n[backfill-family-edges] Next steps:');
        console.log('  1. Run node scripts/audit-family-edges.js to verify edge counts');
        console.log('  2. Manually verify high-value edges (Henry Weaver ↔ Mary Ann Weaver)');
        console.log('  3. Promote verified edges to evidence_tier=1 via SQL:');
        console.log('     UPDATE canonical_family_edges SET evidence_tier=1, verified=true');
        console.log('     WHERE id=<id> AND relationship_type=\'spouse\';');

    } finally {
        client.release();
        await pool.end();
    }
}

run().catch(err => {
    console.error('[backfill-family-edges] FATAL:', err);
    process.exit(1);
});
