#!/usr/bin/env node
'use strict';

/**
 * scoped-benchmark.mjs  (GitHub #90)
 *
 * Benchmarks a model's raw aggregate to a POPULATION-SCOPED control total — one
 * that scales with OUR documented population, not the national total. This avoids
 * the coverage/denominator inflation bug (forcing a documented subset's sum up to
 * Brattle $36T / Darity $14T over-allocates to the documented part).
 *
 * MODEL: wage_theft. Raw = Σ compounded Craemer line items (~$30T, ~$617k/person-
 * year — the 5% compound-over-160yr level). SCOPED CONTROL = Brattle's forensic
 * $96,000/person-year (low end, cited) × OUR documented person-years. So the
 * control is Brattle's standard applied to exactly the person-years we hold; the
 * benchmark forces the compound-interest estimate to AGREE with Brattle's per-
 * person-year valuation. Two independent methods (Craemer compound vs Brattle PY)
 * reconciled — the calibration stack doing real work.
 *
 * Reports the global factor + a per-stratum consistency check (does each
 * freedom-year era, after benchmark, land near $96k/PY?), and records the result
 * in calibration_benchmarks. Does NOT overwrite the raw line items — benchmarking
 * is a disciplining layer on top of the raw predictor.
 *
 * USAGE: node scripts/scoped-benchmark.mjs [--apply]
 */

import 'dotenv/config';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Pool } = require('pg');
const MACRO = require('../src/services/reparations/macro-config.js');

const APPLY = process.argv.includes('--apply');
const DAILY = 0.80 * 300; // Craemer $/yr historical (to recover person-years from base)
const BRATTLE_PER_PY = MACRO.BRATTLE.per_person_year_low_usd.value; // $96,000 (cited)
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
    console.log(`═══ Scoped benchmark: wage_theft → Brattle per-person-year ═══  ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

    // Raw model aggregate + documented person-years (person-years = base / $240/yr).
    const agg = await pool.query(`
        SELECT COUNT(*) n,
               SUM(compounded_amount_usd) raw_sum,
               SUM(base_amount_usd) / ${DAILY} AS person_years
        FROM reparations_line_items
        WHERE calculation_method_key = 'wage_theft_craemer_2015'
    `);
    const rawSum = Number(agg.rows[0].raw_sum);
    const personYears = Number(agg.rows[0].person_years);
    const n = Number(agg.rows[0].n);

    const controlTotal = BRATTLE_PER_PY * personYears;   // SCOPED control (scales with us)
    const factor = controlTotal / rawSum;
    const rawPerPY = rawSum / personYears;

    console.log(`  line items:            ${n.toLocaleString()}`);
    console.log(`  documented person-yrs: ${Math.round(personYears).toLocaleString()}`);
    console.log(`  RAW (Craemer compound):$${Math.round(rawSum).toLocaleString()}   ( $${Math.round(rawPerPY).toLocaleString()}/person-year )`);
    console.log(`  SCOPED control (Brattle $${BRATTLE_PER_PY.toLocaleString()}/PY × our PY): $${Math.round(controlTotal).toLocaleString()}`);
    console.log(`  benchmark factor:      ${factor.toFixed(5)}`);
    console.log(`  BENCHMARKED wage_theft:$${Math.round(rawSum * factor).toLocaleString()}   ( = $${BRATTLE_PER_PY.toLocaleString()}/PY by construction )`);

    // Per-stratum consistency: benchmark is global, so each era's benchmarked $/PY
    // should equal $96k IF compounding horizon were uniform. Deviation reveals how
    // much the horizon (freedom year) drives the raw estimate per stratum.
    const strata = await pool.query(`
        SELECT (base_year/10)*10 AS decade,
               SUM(compounded_amount_usd) raw,
               SUM(base_amount_usd)/${DAILY} py
        FROM reparations_line_items
        WHERE calculation_method_key='wage_theft_craemer_2015' AND base_year IS NOT NULL
        GROUP BY 1 ORDER BY 1
    `);
    console.log(`\n  per-freedom-decade RAW $/PY (pre-benchmark — shows horizon effect):`);
    for (const s of strata.rows) {
        if (Number(s.py) < 1) continue;
        const perPY = Number(s.raw) / Number(s.py);
        console.log(`     ${s.decade}s:  $${Math.round(perPY).toLocaleString().padStart(10)}/PY   (benchmarked → $${Math.round(perPY*factor).toLocaleString()})`);
    }

    // ── Lineage ledger (ENSLAVER side) benchmarked to the SAME labor control ──
    // The ledger's Craemer component is the enslaver-side valuation of the same
    // documented labor; benchmarking it to the same $96k/PY control reconciles the
    // enslaver-owed and enslaved-suffered estimates — computed at different rates
    // (ledger 3%, wage_theft 5%) — into agreement from opposite directions.
    const led = await pool.query(`SELECT SUM(craemer_component_usd) craemer, COUNT(*) n FROM enslaver_lineage_ledger`);
    const ledCraemer = Number(led.rows[0].craemer);
    const ledFactor = controlTotal / ledCraemer;
    console.log(`\n  ── lineage ledger (enslaver side) ──`);
    console.log(`  ledger Craemer Σ:      $${Math.round(ledCraemer).toLocaleString()}  (at 3%, enslaver side)`);
    console.log(`  same scoped control:   $${Math.round(controlTotal).toLocaleString()}  → factor ${ledFactor.toFixed(5)} (scales ${ledFactor>1?'UP':'DOWN'})`);
    console.log(`  → both wage_theft (×${factor.toFixed(3)}, down) and ledger Craemer (×${ledFactor.toFixed(3)}, up) meet at $${Math.round(controlTotal).toLocaleString()}`);

    if (!APPLY) { console.log('\nDRY-RUN — re-run with --apply to record in calibration_benchmarks.'); await pool.end(); return; }

    const rec = async (model, scope, denomVal, raw, fac, meta) => pool.query(`
        INSERT INTO calibration_benchmarks
            (model_key, population_scope, scope_denominator, scope_denominator_value,
             control_total_usd, control_basis, control_citation, raw_sum_usd,
             benchmark_factor, benchmarked_sum_usd, metadata)
        VALUES ($1, $2, 'person_years', $3, $4,
                'brattle_per_person_year_low_x_documented_PY', $5, $6, $7, $8, $9::jsonb)
        ON CONFLICT (model_key, population_scope) DO UPDATE SET
            control_total_usd=EXCLUDED.control_total_usd, raw_sum_usd=EXCLUDED.raw_sum_usd,
            benchmark_factor=EXCLUDED.benchmark_factor, benchmarked_sum_usd=EXCLUDED.benchmarked_sum_usd,
            metadata=EXCLUDED.metadata, computed_at=NOW()
    `, [model, scope, denomVal, controlTotal, MACRO.BRATTLE.per_person_year_low_usd.cite, raw, fac, controlTotal, JSON.stringify(meta)]);

    await rec('wage_theft', `${n} documented enslaved-person wage_theft line items`, personYears, rawSum, factor,
        { raw_per_py: Math.round(rawPerPY), brattle_per_py: BRATTLE_PER_PY, line_items: n, side: 'enslaved', note: 'Scoped to documented person-years; reconciles Craemer-compound (5%) to Brattle PY.' });
    await rec('lineage_ledger_craemer', `${led.rows[0].n} documented enslaver lineages (Craemer component)`, personYears, ledCraemer, ledFactor,
        { brattle_per_py: BRATTLE_PER_PY, lineages: Number(led.rows[0].n), side: 'enslaver', rate: '3%',
          note: 'Enslaver-side labor benchmarked to the SAME control as wage_theft (enslaved side) — they reconcile from opposite directions. Uses total documented PY as the labor basis (approximation; enslaved under documented enslavers ⊆ all documented enslaved).' });
    console.log('\n✓ recorded calibration_benchmarks: wage_theft + lineage_ledger_craemer');
    await pool.end();
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
