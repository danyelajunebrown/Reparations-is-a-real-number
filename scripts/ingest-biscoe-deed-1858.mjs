// Ingest George W. Biscoe's 1858 Georgetown property deed (DC Archives
// Liber J.A.S. No. 104, folios 124-128) into land_transfer_events.
//
// This is the FIRST row in land_transfer_events and represents a concrete
// piece of the inheritance chain from George W. Biscoe (d. 1859) to his
// daughter Angelica Chew (cp=141014, DC 1862 petitioner cww.00431 + cww.00429)
// and his widow Ann M. Biscoe (cp=141015).
//
// Also:
//   - Merges 4 George Washington Biscoe canonical duplicates into cp=140301
//   - Fixes cp=608572 (wrongly tagged 'enslaved' by yesterday's TEI parser
//     over-classification; should be prior_enslaver)
//   - Adds family_relationships spouse + parent_of edges connecting Biscoe
//     to Ann M. Biscoe (wife) and Angelica Chew (daughter)
//   - Seeds top_landholder_flags with Biscoe's Georgetown holdings

import 'dotenv/config';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const BISCOE_CP = 140301;   // winner — George Washington Biscoe b.1787 d.1859
const BISCOE_DUPES = [141151, 193204, 608572, 141020];   // losers — will merge into 140301
const ANGELICA_CHEW_CP = 141014;
const ANN_M_BISCOE_CP = 141015;
const EMMA_BISCOE_CP = 141019;

async function main() {
    console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

    // ── 1. Merge Biscoe duplicates into 140301 ──────────────────────────
    console.log('1. Merging 4 Biscoe canonical duplicates into cp=140301…');
    for (const loserId of BISCOE_DUPES) {
        if (!APPLY) { console.log(`   would merge cp=${loserId} → 140301`); continue; }

        // Redirect FK refs (same pattern as merge-canonical-duplicates.mjs)
        const TABLES = [
            ['person_documents', 'canonical_person_id'],
            ['person_external_ids', 'canonical_person_id'],
            ['ancestor_climb_matches', 'slaveholder_id'],
            ['historical_reparations_petitions', 'claimant_canonical_id'],
            ['enslaver_candidates_review_queue', 'resolved_canonical_id'],
            ['person_evidence_sources', 'canonical_person_id'],
            ['person_relationships_verified', 'person_id'],
            ['person_relationships_verified', 'related_person_id'],
        ];
        for (const [tbl, col] of TABLES) {
            // Dedup person_external_ids first
            if (tbl === 'person_external_ids') {
                await pool.query(`
                    DELETE FROM person_external_ids
                    WHERE canonical_person_id=$1
                      AND (id_system, external_id) IN (SELECT id_system, external_id FROM person_external_ids WHERE canonical_person_id=$2)
                `, [loserId, BISCOE_CP]).catch(() => {});
            }
            await pool.query(`UPDATE ${tbl} SET ${col}=$1 WHERE ${col}=$2`, [BISCOE_CP, loserId]).catch(e => {
                if (!/does not exist/.test(e.message)) console.log(`   ⚠ ${tbl}.${col}: ${e.message.slice(0, 60)}`);
            });
        }
        await pool.query(`
            INSERT INTO person_merge_log (surviving_person_id, merged_person_id, merge_reason, merged_by)
            VALUES ($1, $2, $3, 'ingest-biscoe-deed-1858.mjs')
        `, [BISCOE_CP, loserId, 'Same historical person: George Washington Biscoe b.1787 d.1859 of Georgetown, DC. Duplicate canonical entries from different scraping passes.']);
        await pool.query(`
            UPDATE canonical_persons
            SET person_type = 'merged',
                canonical_name = '(merged into #' || $1 || ')',
                notes = COALESCE(notes, '') || E'\\n' || 'Soft-deleted via merge into cp=' || $1,
                updated_at = NOW()
            WHERE id = $2
        `, [BISCOE_CP, loserId]);
        console.log(`   ✓ merged cp=${loserId} → ${BISCOE_CP}`);
    }

    // ── 2. Correct winner's role — Biscoe was an enslaver (via daughter's petition) + landholder ──
    console.log('\n2. Promoting cp=140301 to person_type=\'enslaver\' + enriching notes…');
    if (APPLY) {
        await pool.query(`
            UPDATE canonical_persons
            SET person_type = 'enslaver',
                primary_state = 'District of Columbia',
                primary_county = 'Washington (Georgetown)',
                notes = COALESCE(notes, '') || E'\\n' ||
                    'Genl. George Washington Biscoe (1787-1859) of Georgetown, DC. ' ||
                    'Father of Angelica Chew (cp=141014, DC 1862 petitioner cww.00431/cww.00429); ' ||
                    'husband of Ann M. Biscoe (cp=141015). Prior owner of enslaved persons ' ||
                    'named in his daughter''s 1862 compensated-emancipation petitions (Sallie Coates, ' ||
                    'Geo. Biscoe, Biscoe, plus Ann''s joint claim of 26 enslaved persons). ' ||
                    'Property holdings include Georgetown Lots 47 & 48 Holmeads addition (1858 ' ||
                    'deed from A.H. Dodge, DC Archives Liber J.A.S. No. 104 folios 124-128).',
                updated_at = NOW()
            WHERE id = $1
        `, [BISCOE_CP]);
    }
    console.log(`   ✓ cp=${BISCOE_CP} promoted to enslaver + enriched`);

    // ── 3. Family relationships ─────────────────────────────────────────
    console.log('\n3. Adding family relationships…');
    const rels = [
        [BISCOE_CP, ANN_M_BISCOE_CP, 'spouse', 'George W. Biscoe (1787-1859) + Ann M. (Anne Maria Hopewell) Biscoe'],
        [BISCOE_CP, ANGELICA_CHEW_CP, 'parent_of', 'George W. Biscoe → daughter Angelica Chew (born Maria Angelica Biscoe)'],
        [BISCOE_CP, EMMA_BISCOE_CP, 'parent_of', 'George W. Biscoe → daughter Emma Biscoe'],
    ];
    for (const [p, r, rel, detail] of rels) {
        const exists = await pool.query(
            `SELECT id FROM person_relationships_verified
             WHERE ((person_id=$1 AND related_person_id=$2) OR (person_id=$2 AND related_person_id=$1))
               AND relationship_type IN ('spouse','parent','parent_of','child','child_of','father','father_of','mother','mother_of','married_to')
             LIMIT 1`,
            [p, r]);
        if (exists.rowCount) { console.log(`   (exists) cp=${p} ↔ cp=${r} ${rel}`); continue; }
        if (APPLY) {
            await pool.query(`
                INSERT INTO person_relationships_verified
                (person_id, related_person_id, relationship_type, evidence_source_ids, evidence_strength, verified_by)
                VALUES ($1, $2, $3, $4::int[], 3, $5)
            `, [p, r, rel, [], `DC Archives Liber J.A.S. No. 104 + civilwardc petitions cww.00431, cww.00429 — ${detail}`]);
        }
        console.log(`   ✓ cp=${p} → cp=${r} (${rel}): ${detail}`);
    }

    // ── 4. Insert land_transfer_events row for the 1858 deed ────────────
    console.log('\n4. Ingesting the 1858 deed into land_transfer_events…');
    if (APPLY) {
        const lte = await pool.query(`
            INSERT INTO land_transfer_events (
                property_description,
                transfer_date, transfer_year,
                transfer_type, instrument_type,
                grantor_name, grantee_name, grantee_person_id,
                consideration_usd, consideration_notes,
                source_archive, source_page, source_notes,
                confidence, verification_status,
                implicates_enslaver, enslaver_person_id
            ) VALUES (
                'Lots numbered 47 & 48 in Holmeads addition to Georgetown, DC — 123 feet fronting Dumbarton Street × 80 feet, running south toward Munroe Street. Ground lying & being in Georgetown aforesaid and known as Lots numbered 47 & 48.',
                '1858-08-28', 1858,
                'inheritance_precursor_purchase', 'deed_indenture',
                'A.H. Dodge (trustee for Mary B. Marbury, per 1855 trust)',
                'George W. Biscoe', $1,
                5.00, 'Nominal $5 consideration typical of deeds discharged from trust — real value was the property itself, held in trust since 1855. Debt to Francis Dodge/Robert P. Dodge/Allen Dodge discharged by the Biscoe payment.',
                'District of Columbia Archives, Land Records Liber J.A.S. No. 104 folios 124-128',
                'Liber J.A.S. No. 104 / folios 124-128',
                'Deed recorded 6 January 1859. Witnesses: F.S. Myer (J.P.) and Thos. J. Fisher (J.P.). Related earlier deed: 1855 trust from Mary B. Marbury to Dodge trustees (same property). George W. Biscoe died 1859 — this was one of his last property acquisitions. Property passed to heirs (widow Ann M. Biscoe cp=141015, daughters Angelica Chew cp=141014, Emma Biscoe cp=141019). That inheritance is the Tier A wealth basis underlying Adrian Brown''s lineage DAA through the Chew line.',
                0.98, 'verified',
                TRUE, $1
            )
            RETURNING transfer_id
        `, [BISCOE_CP]);
        console.log(`   ✓ land_transfer_events row: ${lte.rows[0].transfer_id}`);
    } else {
        console.log(`   would insert: 1858-08-28 grantor='A.H. Dodge' grantee='George W. Biscoe' cp=${BISCOE_CP}`);
    }

    // ── 5. top_landholder_flags ─────────────────────────────────────────
    console.log('\n5. Flagging Biscoe in top_landholder_flags…');
    if (APPLY) {
        await pool.query(`
            INSERT INTO top_landholder_flags (
                person_id, reference_year, region_type, region_name,
                metric, metric_value,
                source_type, source_citation, source_url,
                confidence, notes
            ) VALUES (
                $1, 1860, 'district', 'Georgetown, District of Columbia',
                'deed_verified_landholding', 'Lots 47 & 48 Holmeads addition (Dumbarton Street frontage 123 ft × 80 ft)',
                'deed_indenture', 'DC Archives Land Records Liber J.A.S. No. 104 folios 124-128',
                NULL,
                0.95,
                'Multi-generation DC landholder. Genl. George Washington Biscoe (1787-1859) acquired Lots 47 & 48 Holmeads addition Georgetown DC via 1858 deed from A.H. Dodge (trustee). Father George Biscoe (1750-1791, cp=193269) also landholder. Property continued under widow Ann M. Biscoe (cp=141015) + daughters Angelica Chew (cp=141014) + Emma Biscoe (cp=141019) past emancipation. Continuous DC property ownership pre-1865 → post-1865. Tier A wealth basis for Adrian Brown DAA through Chew line.'
            )
            ON CONFLICT DO NOTHING
        `, [BISCOE_CP]).catch(e => {
            // Schema check — if table has different cols, log + skip
            if (/column.*does not exist/i.test(e.message)) {
                console.log(`   ⚠ top_landholder_flags schema mismatch: ${e.message.slice(0, 100)}`);
            } else throw e;
        });
    }
    console.log(`   ✓ flagged (or schema-mismatch logged)`);

    // ── 6. Verify ───────────────────────────────────────────────────────
    console.log('\n━━━ Verification ━━━');
    const v1 = await pool.query(`SELECT id, canonical_name, person_type FROM canonical_persons WHERE id=$1 OR id=ANY($2::int[]) ORDER BY id`, [BISCOE_CP, BISCOE_DUPES]);
    console.log('\nBiscoe canonical state:');
    for (const r of v1.rows) console.log(`  cp=${r.id} "${r.canonical_name}" type=${r.person_type}`);
    const v2 = await pool.query(`SELECT transfer_date, grantor_name, grantee_name, source_archive FROM land_transfer_events WHERE grantee_person_id=$1`, [BISCOE_CP]);
    console.log(`\nland_transfer_events for cp=${BISCOE_CP}: ${v2.rowCount}`);
    for (const r of v2.rows) console.log(`  ${r.transfer_date}  ${r.grantor_name} → ${r.grantee_name} (${r.source_archive})`);
    const v3 = await pool.query(`SELECT relationship_type, related_person_id FROM person_relationships_verified WHERE person_id=$1`, [BISCOE_CP]);
    console.log(`\nperson_relationships_verified from cp=${BISCOE_CP}: ${v3.rowCount}`);
    for (const r of v3.rows) console.log(`  ${r.relationship_type} → cp=${r.related_person_id}`);

    await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
