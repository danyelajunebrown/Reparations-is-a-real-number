// Merge duplicate canonical_persons rows that represent the same historical
// person under different names / different climb-discovery contexts.
//
// First targets: Adrian Brown's lineage trio where the NameResolver module
// missed the married/maiden junction:
//
//   Maria Angelica Biscoe (born 1817, died 1898) married → Angelica Chew.
//   She appears as:
//     • cp=141014 "Angelica Chew"            (enslaver, DC)  ← WINNER
//       (claimant of record on cww.00431 + cww.00429 DC 1862 petitions)
//     • cp=198196 "Maria Angelica Biscoe"    (enslaver, DC)
//     • cp=140302 "Maria Angelica Biscoe"    (descendant)  FS L6K5-FRC
//     • cp=140458, 140645, 141111, 193164    (descendant duplicates)
//
//   James Hopewell (her father-in-law / Angelica Chesley's husband):
//     • cp=1070   "James Hopewell"  (enslaver, MD, will on record)  ← WINNER
//     • cp=193271 "James Hopewell"  (descendant, b. 1780)
//
//   Angelica Chesley (James Hopewell's wife; Maria's mother-in-law):
//     • cp=140299 "Angelica Chesley" (enslaver, b. 1783)  FS MTRV-Z7T  ← WINNER
//     • cp=193272 "Angelica Chesley" (descendant)
//
// For each cluster:
//   1. Redirect every FK reference (person_documents, person_external_ids,
//      ancestor_climb_matches, historical_reparations_petitions,
//      land_transfer_events, enslaver_*, daa_*, person_relationships_verified,
//      top_landholder_flags, etc.) from loser_id → winner_id.
//   2. Drop loser rows that would violate unique constraints on the winner
//      (e.g. same FS ID on both — keep the loser's FS ID on the winner,
//      drop the duplicate external_id row).
//   3. Copy any bio fact the winner is missing (birth year, death year,
//      FS ID) from the first loser that has it.
//   4. Insert a person_merge_log row so the decision is auditable.
//   5. Soft-delete the loser canonical_persons row (person_type='merged',
//      canonical_name='(merged into #W)', notes pointer).
//
// Usage:
//   node scripts/merge-canonical-duplicates.mjs             # dry-run
//   node scripts/merge-canonical-duplicates.mjs --apply     # execute

import 'dotenv/config';
import pg from 'pg';
const APPLY = process.argv.includes('--apply');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Every FK column that references canonical_persons.id. Gathered via
// information_schema earlier. If a new migration adds one, append here.
const FK_COLS = [
    ['daa_enslaved_persons', 'enslaved_canonical_id'],
    ['debt_acknowledgment_agreements', 'slaveholder_canonical_id'],
    ['enslaved_credit_calculations', 'enslaved_person_id'],
    ['enslaved_descendants_confirmed', 'enslaved_person_id'],
    ['enslaved_descendants_suspected', 'enslaved_person_id'],
    ['enslaved_descendants_suspected', 'enslaver_id'],
    ['enslaved_owner_relationships', 'enslaved_canonical_id'],
    ['enslaved_owner_relationships', 'owner_canonical_id'],
    ['enslaver_candidates_review_queue', 'resolved_canonical_id'],
    ['enslaver_lineage_ledger', 'enslaver_person_id'],
    ['flagrant_heirloom_assets', 'current_holder_person_id'],
    ['flagrant_heirloom_assets', 'enslaver_person_id'],
    ['flagrant_heirloom_assets', 'original_holder_person_id'],
    ['historical_reparations_petitions', 'claimant_canonical_id'],
    ['land_transfer_events', 'enslaver_person_id'],
    ['land_transfer_events', 'grantee_person_id'],
    ['land_transfer_events', 'grantor_person_id'],
    ['person_documents', 'canonical_person_id'],
    ['person_evidence_sources', 'canonical_person_id'],
    ['person_external_ids', 'canonical_person_id'],
    ['person_relationships_verified', 'person_id'],
    ['person_relationships_verified', 'related_person_id'],
    ['top_landholder_flags', 'person_id'],
    ['wikitree_search_queue', 'person_id'],
    // ancestor_climb_matches is NOT a FK in schema but is referenced by ID
    ['ancestor_climb_matches', 'slaveholder_id'],
];

const MERGES = [
    {
        winner: 141014,
        winner_display_name: 'Angelica Chew (born Maria Angelica Biscoe)',
        losers: [198196, 193164, 140302, 140458, 140645, 141111],
        reason: 'Same person: Maria Angelica Biscoe married into surname Chew; DC 1862 petitions claim her as Angelica Chew. FS ID L6K5-FRC confirms identity.',
    },
    {
        winner: 1070,
        winner_display_name: 'James Hopewell',
        losers: [193271],
        reason: 'Same person: enslaver (Maryland, died 1817, will on record) + tree-synced descendant entry (b.1780). FS ID MTRV-Z72 indicates shared identity.',
    },
    {
        winner: 140299,
        winner_display_name: 'Angelica Chesley',
        losers: [193272],
        reason: 'Same person: wife of James Hopewell (cp=1070). Enslaver b.1783 + tree-synced descendant entry b.1783. FS ID MTRV-Z7T.',
    },
];

async function getRow(id) {
    const r = await pool.query(`SELECT * FROM canonical_persons WHERE id=$1`, [id]);
    return r.rows[0];
}

async function mergeCluster(merge) {
    console.log(`\n━━━ Merge: winner=${merge.winner} losers=[${merge.losers.join(',')}] ━━━`);
    const winner = await getRow(merge.winner);
    if (!winner) {
        console.log(`  ❌ winner cp=${merge.winner} not found`);
        return;
    }
    console.log(`  WINNER cp=${winner.id} "${winner.canonical_name}" type=${winner.person_type} b=${winner.birth_year_estimate || '-'} d=${winner.death_year_estimate || '-'}`);

    // Bio enrichment: copy first-non-null from losers to winner
    const enrich = {};
    const bioCols = ['birth_year_estimate', 'death_year_estimate', 'primary_state', 'primary_county', 'gender'];
    for (const loserId of merge.losers) {
        const loser = await getRow(loserId);
        if (!loser) {
            console.log(`  ⚠ loser cp=${loserId} not found — skip`);
            continue;
        }
        console.log(`  loser cp=${loser.id} "${loser.canonical_name}" type=${loser.person_type} b=${loser.birth_year_estimate || '-'} d=${loser.death_year_estimate || '-'}`);
        for (const col of bioCols) {
            if (enrich[col] == null && !winner[col] && loser[col]) enrich[col] = loser[col];
        }
    }
    if (Object.keys(enrich).length) {
        console.log(`  enrich winner with:`, enrich);
    }

    // For each FK, redirect. Handle unique-constraint collisions on
    // person_external_ids specially (keep existing winner rows, drop duplicate
    // loser rows so the UPDATE doesn't violate uniqueness).
    for (const [table, col] of FK_COLS) {
        const count = await pool.query(
            `SELECT COUNT(*)::int c FROM ${table} WHERE ${col} = ANY($1::int[])`,
            [merge.losers]
        ).catch(e => ({ rows: [{ c: `err:${e.message.slice(0, 40)}` }] }));
        if (!count.rows || typeof count.rows[0].c !== 'number') {
            console.log(`    ${table}.${col}: ${count.rows[0].c}`);
            continue;
        }
        if (count.rows[0].c === 0) continue;

        if (table === 'person_external_ids') {
            // Avoid (canonical_person_id, id_system, external_id) unique conflict:
            // delete loser rows whose external_id already exists on winner.
            const dup = await pool.query(
                `DELETE FROM person_external_ids
                 WHERE canonical_person_id = ANY($1::int[])
                   AND (id_system, external_id) IN (
                     SELECT id_system, external_id FROM person_external_ids
                     WHERE canonical_person_id = $2
                   )
                 RETURNING canonical_person_id, external_id`,
                [merge.losers, merge.winner]
            ).catch(e => ({ rowCount: 0 }));
            if (dup.rowCount) console.log(`    person_external_ids: dropped ${dup.rowCount} duplicate-on-winner rows`);
        }

        if (!APPLY) {
            console.log(`    ${table}.${col}: would redirect ${count.rows[0].c}`);
            continue;
        }
        const upd = await pool.query(
            `UPDATE ${table} SET ${col} = $1 WHERE ${col} = ANY($2::int[])`,
            [merge.winner, merge.losers]
        ).catch(e => {
            console.log(`    ${table}.${col}: UPDATE failed: ${e.message}`);
            return { rowCount: 'err' };
        });
        console.log(`    ${table}.${col}: redirected ${upd.rowCount}`);
    }

    if (!APPLY) return;

    // Enrich winner
    if (Object.keys(enrich).length) {
        const sets = Object.keys(enrich).map((k, i) => `${k} = $${i + 1}`).join(', ');
        const vals = [...Object.values(enrich), merge.winner];
        await pool.query(
            `UPDATE canonical_persons SET ${sets}, updated_at=NOW() WHERE id = $${vals.length}`,
            vals
        );
    }

    // Update winner's canonical_name + notes with the merged-identity hint
    const winnerNotesAddition = `Merged into: ${merge.losers.map(id => '#' + id).join(', ')}. Reason: ${merge.reason}`;
    await pool.query(
        `UPDATE canonical_persons
         SET canonical_name = $1,
             notes = COALESCE(notes, '') || E'\\n' || $2,
             updated_at = NOW()
         WHERE id = $3`,
        [merge.winner_display_name, winnerNotesAddition, merge.winner]
    );

    // Log each merge + soft-delete losers
    for (const loserId of merge.losers) {
        await pool.query(
            `INSERT INTO person_merge_log (surviving_person_id, merged_person_id, merge_reason, merge_details, merged_by)
             VALUES ($1, $2, $3, $4::jsonb, 'merge-canonical-duplicates.mjs')`,
            [merge.winner, loserId, merge.reason, JSON.stringify({ winner_display_name: merge.winner_display_name })]
        );
        await pool.query(
            `UPDATE canonical_persons
             SET person_type = 'merged',
                 canonical_name = '(merged into #' || $1 || ')',
                 notes = COALESCE(notes, '') || E'\\n' || 'Soft-deleted via merge into cp=' || $1,
                 updated_at = NOW()
             WHERE id = $2`,
            [merge.winner, loserId]
        );
    }
    console.log(`  ✓ logged ${merge.losers.length} merges; winner renamed to "${merge.winner_display_name}"`);
}

async function main() {
    console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
    for (const m of MERGES) await mergeCluster(m);

    if (APPLY) {
        console.log('\n━━━ Post-merge verification ━━━');
        // 1. Maria's petitions should now all flow to cp=141014
        const maria = await pool.query(`
            SELECT COUNT(*)::int c FROM person_documents
            WHERE canonical_person_id = 141014
        `);
        console.log(`cp=141014 person_documents: ${maria.rows[0].c} (expect ≥ 7)`);

        // 2. James Hopewell
        const jh = await pool.query(`
            SELECT COUNT(*)::int docs, birth_year_estimate, death_year_estimate
            FROM canonical_persons cp
            LEFT JOIN person_documents pd ON pd.canonical_person_id=cp.id
            WHERE cp.id=1070 GROUP BY cp.id, birth_year_estimate, death_year_estimate
        `);
        console.log(`cp=1070 James Hopewell: docs=${jh.rows[0]?.docs || 0} b=${jh.rows[0]?.birth_year_estimate} d=${jh.rows[0]?.death_year_estimate}`);

        // 3. Angelica Chesley
        const ac = await pool.query(`
            SELECT cp.id, cp.canonical_name, cp.birth_year_estimate,
                   (SELECT COUNT(*)::int FROM person_external_ids WHERE canonical_person_id=cp.id) AS fs_ids
            FROM canonical_persons cp WHERE id=140299
        `);
        console.log(`cp=140299 Angelica Chesley: "${ac.rows[0]?.canonical_name}" b=${ac.rows[0]?.birth_year_estimate} FS-ids=${ac.rows[0]?.fs_ids}`);

        // 4. Merge log
        const log = await pool.query(`SELECT surviving_person_id, merged_person_id FROM person_merge_log ORDER BY merged_at DESC LIMIT 20`);
        console.log(`\nperson_merge_log entries written: ${log.rowCount}`);
        for (const r of log.rows) console.log(`  ${r.merged_person_id} → ${r.surviving_person_id}`);
    }
    await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
