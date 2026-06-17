#!/usr/bin/env node
'use strict';

/**
 * project-probate-to-disgorgement.js  (GitHub #71, #78)
 *
 * De-silos probate_estate_extractions (JSONB) into the normalized edge tables
 * the DisgorgementCalculator reads, keyed by canonical enslaver_person_id:
 *
 *   estate_totals            -> estate_valuations           (the non-chattel VALUE source)
 *   non_chattel_assets[land] -> land_transfer_events        (provenance + item value)
 *   non_chattel_assets[other]-> flagrant_heirloom_assets    (provenance + item value)
 *
 * RESOLUTION: decedent_name -> canonical_persons (person_type='enslaver'),
 * ONE enslaver per extraction (DISTINCT ON, deterministic). ~89% of decedents
 * resolve. Unresolved extractions are skipped and counted (not invented).
 *
 * VALUE / DOUBLE-COUNT: the non-chattel VALUE lives ONLY in estate_valuations
 * (estate_totals.non_chattel_value_usd, the clean aggregate). The land/heirloom
 * rows are EVIDENCE + itemized values for display/provenance; DisgorgementCalculator
 * sums estate_valuations for probate-sourced value and only sums land/heirloom
 * values that are NOT probate-sourced (future deeds/appraisals), so nothing is
 * double-counted.
 *
 * IDEMPOTENT: deletes its own prior output (provenance-tagged) before re-inserting.
 *
 * USAGE:
 *   node scripts/project-probate-to-disgorgement.js            # dry-run
 *   node scripts/project-probate-to-disgorgement.js --apply
 */

require('dotenv').config();
const { Pool } = require('pg');
const APPLY = process.argv.includes('--apply');
const PROV = 'probate_estate_extraction'; // provenance tag for idempotent re-runs

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
    console.log('═══ Probate → Disgorgement Edge Projection ═══');
    console.log(`mode: ${APPLY ? 'APPLY (writes edges)' : 'DRY-RUN (no writes)'}\n`);
    const c = await pool.connect();
    try {
        await c.query('BEGIN'); // temp table + all writes live in one transaction
        // Resolve each extraction to ONE canonical enslaver (deterministic).
        await c.query(`
            CREATE TEMP TABLE _resolved ON COMMIT DROP AS
            SELECT DISTINCT ON (pe.id)
                   pe.id            AS extraction_id,
                   cp.id            AS enslaver_id,
                   pe.decedent_name,
                   pe.year,
                   pe.total_appraised_usd,
                   pe.estate_totals,
                   pe.non_chattel_assets
            FROM probate_estate_extractions pe
            JOIN canonical_persons cp
              ON LOWER(cp.canonical_name) = LOWER(pe.decedent_name)
             AND cp.person_type = 'enslaver'
            ORDER BY pe.id, cp.id
        `);
        const resolved = await c.query(`SELECT COUNT(*) n, COUNT(DISTINCT enslaver_id) e FROM _resolved`);
        const totalExtractions = (await c.query(`SELECT COUNT(*) n FROM probate_estate_extractions`)).rows[0].n;
        console.log(`Resolved ${resolved.rows[0].n} / ${totalExtractions} extractions → ${resolved.rows[0].e} distinct enslavers`);

        // ── Preview the projection volumes ──
        const ev = await c.query(`
            SELECT COUNT(*) n,
                   COUNT(*) FILTER (WHERE (estate_totals->>'non_chattel_value_usd') IS NOT NULL) with_nonchattel,
                   ROUND(SUM((estate_totals->>'non_chattel_value_usd')::numeric)) sum_nonchattel,
                   ROUND(SUM(COALESCE(total_appraised_usd,(estate_totals->>'total_appraised_value_usd')::numeric))) sum_total
            FROM _resolved
            WHERE year IS NOT NULL AND estate_totals IS NOT NULL AND estate_totals::text NOT IN ('null','{}')
        `);
        const land = await c.query(`
            SELECT COUNT(*) n, COUNT(*) FILTER (WHERE (a->>'value_usd') IS NOT NULL) valued
            FROM _resolved r, LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.non_chattel_assets)='array' THEN r.non_chattel_assets ELSE '[]'::jsonb END) a
            WHERE a->>'category' = 'land'
        `);
        const heir = await c.query(`
            SELECT COUNT(*) n, COUNT(*) FILTER (WHERE (a->>'value_usd') IS NOT NULL) valued
            FROM _resolved r, LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.non_chattel_assets)='array' THEN r.non_chattel_assets ELSE '[]'::jsonb END) a
            WHERE a->>'category' IS DISTINCT FROM 'land' AND jsonb_typeof(a)='object'
        `);
        console.log(`\nWould project:`);
        console.log(`  estate_valuations:      ${ev.rows[0].n} rows  (${ev.rows[0].with_nonchattel} w/ non-chattel value, Σ $${Number(ev.rows[0].sum_nonchattel||0).toLocaleString()} nominal; Σ total $${Number(ev.rows[0].sum_total||0).toLocaleString()})`);
        console.log(`  land_transfer_events:   ${land.rows[0].n} rows  (${land.rows[0].valued} valued)`);
        console.log(`  flagrant_heirloom:      ${heir.rows[0].n} rows  (${heir.rows[0].valued} valued)`);

        if (!APPLY) {
            console.log('\nDRY-RUN: no rows written. Re-run with --apply.');
            await c.query('ROLLBACK'); // drop temp
            return;
        }

        // (already inside the transaction opened above)
        // Idempotency: clear prior probate-sourced output.
        const d1 = await c.query(`DELETE FROM estate_valuations WHERE source_other_table = 'probate_estate_extractions'`);
        const d2 = await c.query(`DELETE FROM land_transfer_events WHERE source_archive = $1`, [PROV]);
        const d3 = await c.query(`DELETE FROM flagrant_heirloom_assets WHERE source_archive = $1`, [PROV]);
        console.log(`\nCleared prior output: estate_valuations ${d1.rowCount}, land ${d2.rowCount}, heirloom ${d3.rowCount}`);

        // estate_valuations (VALUE source). Requires currency_year → skip year-NULL.
        const iv = await c.query(`
            INSERT INTO estate_valuations
                (id, canonical_person_id, source_other_table, source_other_id,
                 total_estate_value_cents, currency_year, breakdown_jsonb, provenance_jsonb, created_at)
            SELECT gen_random_uuid(), r.enslaver_id, 'probate_estate_extractions', r.extraction_id::text,
                   ROUND(COALESCE(r.total_appraised_usd,(r.estate_totals->>'total_appraised_value_usd')::numeric,0)*100)::bigint,
                   r.year,
                   jsonb_build_object(
                     'enslaved_value_usd',         (r.estate_totals->>'enslaved_value_usd'),
                     'non_chattel_value_usd',      (r.estate_totals->>'non_chattel_value_usd'),
                     'total_appraised_value_usd',  (r.estate_totals->>'total_appraised_value_usd')),
                   jsonb_build_object('source', $1::text, 'extraction_id', r.extraction_id, 'decedent_name', r.decedent_name),
                   NOW()
            FROM _resolved r
            WHERE r.year IS NOT NULL AND r.estate_totals IS NOT NULL AND r.estate_totals::text NOT IN ('null','{}')
        `, [PROV]);

        // land_transfer_events (land items)
        const il = await c.query(`
            INSERT INTO land_transfer_events
                (transfer_id, transfer_year, transfer_type, instrument_type, grantor_name,
                 enslaver_person_id, implicates_enslaver, consideration_usd, property_description,
                 source_archive, source_notes, confidence, verification_status, created_at, updated_at)
            SELECT gen_random_uuid(), r.year, 'inheritance', 'will', r.decedent_name,
                   r.enslaver_id, TRUE, NULLIF(a->>'value_usd','')::numeric, a->>'description',
                   $1::text, 'probate_estate_extraction:'||r.extraction_id, 0.6, 'unverified', NOW(), NOW()
            FROM _resolved r, LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.non_chattel_assets)='array' THEN r.non_chattel_assets ELSE '[]'::jsonb END) a
            WHERE a->>'category' = 'land'
        `, [PROV]);

        // flagrant_heirloom_assets (non-land items)
        const ih = await c.query(`
            INSERT INTO flagrant_heirloom_assets
                (asset_id, original_holder_person_id, original_holder_name, enslaver_person_id,
                 implicates_enslaver, asset_category, asset_description, appraised_value_usd, appraised_year,
                 source_archive, source_notes, confidence, verification_status, created_at, updated_at)
            SELECT gen_random_uuid(), r.enslaver_id, r.decedent_name, r.enslaver_id,
                   TRUE,
                   CASE WHEN jsonb_typeof(a->'category')='string' THEN a->>'category' ELSE 'other' END,
                   a->>'description', NULLIF(a->>'value_usd','')::numeric, r.year,
                   $1::text, 'probate_estate_extraction:'||r.extraction_id, 0.6, 'unverified', NOW(), NOW()
            FROM _resolved r, LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.non_chattel_assets)='array' THEN r.non_chattel_assets ELSE '[]'::jsonb END) a
            WHERE a->>'category' IS DISTINCT FROM 'land' AND jsonb_typeof(a)='object'
        `, [PROV]);

        await c.query('COMMIT');
        console.log(`✓ wrote estate_valuations ${iv.rowCount}, land_transfer_events ${il.rowCount}, flagrant_heirloom ${ih.rowCount}`);
    } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
    } finally {
        c.release();
        await pool.end();
    }
}

main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
