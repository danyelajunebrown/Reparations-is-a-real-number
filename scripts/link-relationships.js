#!/usr/bin/env node
/**
 * Link Relationships — Connect name-string edges to actual entity IDs
 *
 * The family_relationships table has 1.9M edges where person1_lead_id
 * and person2_lead_id are NULL — just name strings. This script:
 *
 * 1. For each enslaver name (person1), finds matching canonical_persons ID
 * 2. For each enslaved name (person2), finds matching unconfirmed_persons ID
 * 3. Also syncs JSONB relationships.enslaved_by links to family_relationships
 *
 * This makes the graph queryable by ID, not just name.
 *
 * Usage:
 *   node scripts/link-relationships.js
 *   node scripts/link-relationships.js --dry-run
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { neon } = require('@neondatabase/serverless');

const DRY_RUN = process.argv.includes('--dry-run');
let sql;

const stats = { enslaver_linked: 0, enslaved_linked: 0, jsonb_synced: 0, errors: 0, startTime: Date.now() };

async function main() {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  LINK RELATIONSHIPS — Connect edges to entity IDs`);
    console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
    console.log(`${'═'.repeat(60)}\n`);

    sql = neon(process.env.DATABASE_URL);

    // Step 1: Link enslavers (person1) in family_relationships to canonical_persons
    console.log('── Step 1: Linking enslavers in family_relationships ──');
    if (!DRY_RUN) {
        const result = await sql`
            UPDATE family_relationships fr
            SET person1_lead_id = cp.id
            FROM canonical_persons cp
            WHERE fr.person1_lead_id IS NULL
            AND fr.person1_role = 'slaveholder'
            AND LOWER(fr.person1_name) = LOWER(cp.canonical_name)
            AND cp.person_type = 'enslaver'
        `;
        // Neon doesn't return rowCount easily, so check after
        const linked = await sql`SELECT COUNT(*) as cnt FROM family_relationships WHERE person1_lead_id IS NOT NULL`;
        console.log('  Enslavers linked: ' + Number(linked[0].cnt).toLocaleString());
        stats.enslaver_linked = linked[0].cnt;
    }

    // Step 2: Link enslaved (person2) in family_relationships to unconfirmed_persons
    console.log('\n── Step 2: Linking enslaved in family_relationships ──');
    console.log('  (Skipping — most enslaved in family_relationships are unnamed "Unknown (Male, age 25)")');
    console.log('  Only linking named enslaved persons...');
    if (!DRY_RUN) {
        const result = await sql`
            UPDATE family_relationships fr
            SET person2_lead_id = up.lead_id
            FROM unconfirmed_persons up
            WHERE fr.person2_lead_id IS NULL
            AND fr.person2_name NOT LIKE 'Unknown%'
            AND fr.person2_name = up.full_name
            AND up.person_type = 'enslaved'
            AND up.extraction_method = fr.source_url
        `;
        const linked = await sql`SELECT COUNT(*) as cnt FROM family_relationships WHERE person2_lead_id IS NOT NULL`;
        console.log('  Enslaved linked: ' + Number(linked[0].cnt).toLocaleString());
        stats.enslaved_linked = linked[0].cnt;
    }

    // Step 3: Sync JSONB enslaved_by links into family_relationships
    console.log('\n── Step 3: Syncing JSONB enslaver links to family_relationships ──');

    const jsonbLinks = await sql`
        SELECT lead_id, full_name, relationships->>'enslaved_by' as enslaver,
               source_url, extraction_method
        FROM unconfirmed_persons
        WHERE person_type = 'enslaved'
        AND relationships->>'enslaved_by' IS NOT NULL
        AND lead_id NOT IN (
            SELECT COALESCE(person2_lead_id, -1) FROM family_relationships
            WHERE person2_lead_id IS NOT NULL
        )
        LIMIT 50000
    `;

    console.log('  JSONB links not in family_relationships: ' + jsonbLinks.length);

    if (!DRY_RUN && jsonbLinks.length > 0) {
        let synced = 0;
        for (let i = 0; i < jsonbLinks.length; i += 500) {
            const batch = jsonbLinks.slice(i, i + 500);
            for (const link of batch) {
                try {
                    // Find the enslaver's canonical_persons ID
                    const enslaver = await sql`
                        SELECT id FROM canonical_persons
                        WHERE LOWER(canonical_name) = LOWER(${link.enslaver})
                        AND person_type = 'enslaver'
                        LIMIT 1
                    `;

                    await sql`
                        INSERT INTO family_relationships (
                            person1_name, person1_role, person1_lead_id,
                            person2_name, person2_role, person2_lead_id,
                            relationship_type, source_url, confidence
                        ) VALUES (
                            ${link.enslaver}, 'enslaver', ${enslaver.length > 0 ? enslaver[0].id : null},
                            ${link.full_name}, 'enslaved', ${link.lead_id},
                            'enslaved_by',
                            ${link.source_url},
                            0.85
                        )
                    `;
                    synced++;
                } catch (e) {
                    stats.errors++;
                }
            }
            if ((i + 500) % 5000 === 0) {
                console.log('  Progress: ' + (i + 500) + '/' + jsonbLinks.length + ' — ' + synced + ' synced');
            }
        }
        stats.jsonb_synced = synced;
        console.log('  Synced: ' + synced);
    }

    const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  LINKAGE COMPLETE`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`  Enslavers linked to canonical IDs: ${Number(stats.enslaver_linked).toLocaleString()}`);
    console.log(`  Enslaved linked to unconfirmed IDs: ${Number(stats.enslaved_linked).toLocaleString()}`);
    console.log(`  JSONB links synced to family_relationships: ${stats.jsonb_synced}`);
    console.log(`  Errors: ${stats.errors}`);
    console.log(`  Elapsed: ${elapsed}s`);

    // Final check
    const final = await sql`
        SELECT
            (SELECT COUNT(*) FROM family_relationships WHERE person1_lead_id IS NOT NULL) as p1_linked,
            (SELECT COUNT(*) FROM family_relationships WHERE person2_lead_id IS NOT NULL) as p2_linked,
            (SELECT COUNT(*) FROM family_relationships) as total
    `;
    console.log(`\n  family_relationships total: ${Number(final[0].total).toLocaleString()}`);
    console.log(`  person1 (enslaver) linked: ${Number(final[0].p1_linked).toLocaleString()} (${((final[0].p1_linked/final[0].total)*100).toFixed(1)}%)`);
    console.log(`  person2 (enslaved) linked: ${Number(final[0].p2_linked).toLocaleString()} (${((final[0].p2_linked/final[0].total)*100).toFixed(1)}%)`);
    console.log('');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
