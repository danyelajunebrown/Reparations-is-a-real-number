#!/usr/bin/env node
'use strict';

/**
 * build-wage-theft-line-items.mjs  (Front b, GitHub #63; calibration agenda)
 *
 * Builds the wage_theft (Craemer cost-to-enslaved) harm calculator — the
 * highest-leverage of the 18 unrun harm-category calculators. Model A is today a
 * FLAT $47,501 constant (only freedmans_bank_collapse, on freedpersons). This
 * gives the ENSLAVED population per-person STRUCTURE: each line item's base
 * varies by documented years-enslaved, so Model A stops being a constant.
 *
 * SUBSTRATE: enslaved_persons_inferred_dates (epi) — 1.88M enslaved persons with
 * SCHEDULE-AGE-derived years (avg ~26yr, plausible 1–90), each with an
 * inferred_freedom_year and an evidence key (relationship_id). These are NOT yet
 * canonical persons, so the line items are keyed to evidence_source +
 * community_identifier (enslaved_name) with canonical_person_id NULL — to be
 * linked when the enslaved population is canonicalized (entity-resolution front).
 * (The canonical 'enslaved' birth-year substrate was rejected: sparse + overcounts
 * to the 90-yr cap — median 87yr, 92% unusable.)
 *
 * RATE: bond_yield (victim opportunity cost / make-whole) from anchor_rate_series,
 * joined by freedom-year range — the rate-resolver's logic expressed set-based.
 * Compounded freedom-year → present. Figures are accruing LOWER BOUNDS,
 * disciplined downstream by benchmarking + the consistency cap; the per-person
 * STRUCTURE is the point, not the magnitude.
 *
 * Idempotent (deletes its own wage_theft items then reinserts). Dry-run default.
 * USAGE: node scripts/build-wage-theft-line-items.mjs [--apply]
 */

import 'dotenv/config';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');
const PRESENT_YEAR = 2026;
const METHOD_KEY = 'wage_theft_craemer_2015';
const BASE_DAILY_WAGE = 0.80;   // Craemer (2015) Table 1 midpoint
const WORKING_DAYS = 300;
const DAILY = BASE_DAILY_WAGE * WORKING_DAYS; // $240/yr historical

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Common FROM/WHERE: epi rows with plausible years + a bond_yield anchor for the freedom year.
const SRC = `
    FROM enslaved_persons_inferred_dates epi
    JOIN anchor_rate_series ar
      ON ar.anchor_family = 'bond_yield'
     AND epi.inferred_freedom_year BETWEEN ar.year_start AND ar.year_end
    WHERE epi.inferred_years_enslaved BETWEEN 1 AND 90
      AND epi.inferred_freedom_year IS NOT NULL`;

async function main() {
    console.log(`═══ wage_theft line-item calculator (epi substrate) ═══  ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
    const harm = await pool.query(`SELECT id FROM reparations_harm_categories WHERE category_key='wage_theft' LIMIT 1`);
    if (!harm.rows.length) throw new Error('wage_theft harm category not found');
    const harmId = harm.rows[0].id;

    const stat = await pool.query(`
        SELECT COUNT(*) n,
               COUNT(DISTINCT ROUND((epi.inferred_years_enslaved * ${DAILY})::numeric)) distinct_base,
               MIN(epi.inferred_years_enslaved) min_y, MAX(epi.inferred_years_enslaved) max_y,
               ROUND(AVG(epi.inferred_years_enslaved)) avg_y,
               ROUND(SUM(epi.inferred_years_enslaved * ${DAILY})) sum_base,
               ROUND(SUM(epi.inferred_years_enslaved * ${DAILY} * power(1 + ar.annual_rate, ${PRESENT_YEAR} - epi.inferred_freedom_year))) sum_comp
        ${SRC}
    `);
    const s = stat.rows[0];
    console.log(`\n  computable line items:  ${Number(s.n).toLocaleString()}`);
    console.log(`  years-enslaved:         min ${s.min_y}, avg ${s.avg_y}, max ${s.max_y}`);
    console.log(`  distinct base amounts:  ${Number(s.distinct_base).toLocaleString()}  (vs Model A's 1 flat value — STRUCTURE)`);
    console.log(`  base (historical $):    Σ $${Number(s.sum_base).toLocaleString()}`);
    console.log(`  compounded (present):   Σ $${Number(s.sum_comp).toLocaleString()}  (lower bound; benchmarked + capped downstream)`);

    if (!APPLY) { console.log('\nDRY-RUN — re-run with --apply.'); await pool.end(); return; }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const del = await client.query(`DELETE FROM reparations_line_items WHERE calculation_method_key = $1`, [METHOD_KEY]);
        console.log(`\nCleared ${del.rowCount} prior wage_theft items. Inserting (set-based)…`);
        const ins = await client.query(`
            INSERT INTO reparations_line_items
                (id, beneficiary_type, canonical_person_id, community_identifier, harm_category_id,
                 evidence_tier, evidence_source_table, evidence_source_id, base_amount_usd, base_year,
                 compounded_amount_usd, compound_rate, compound_to_year, calculation_method_key, notes,
                 created_at, updated_at)
            SELECT gen_random_uuid(), 'individual', NULL, epi.enslaved_name, $1,
                   2, 'enslaved_persons_inferred_dates', epi.relationship_id::text,
                   epi.inferred_years_enslaved * ${DAILY}, epi.inferred_freedom_year,
                   epi.inferred_years_enslaved * ${DAILY} * power(1 + ar.annual_rate, ${PRESENT_YEAR} - epi.inferred_freedom_year),
                   ar.annual_rate, ${PRESENT_YEAR}, $2,
                   'Craemer cost-to-enslaved: ' || epi.inferred_years_enslaved || 'yr × $${BASE_DAILY_WAGE}/day × ${WORKING_DAYS}d (schedule-age-derived), compounded ' || epi.inferred_freedom_year || '→${PRESENT_YEAR} at bond_yield ' || ar.annual_rate || '. Accruing lower bound; canonical_person_id NULL pending enslaved-population canonicalization.',
                   NOW(), NOW()
            ${SRC}
        `, [harmId, METHOD_KEY]);
        await client.query('COMMIT');
        console.log(`✓ wrote ${ins.rowCount.toLocaleString()} wage_theft line items`);
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); await pool.end(); }
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
