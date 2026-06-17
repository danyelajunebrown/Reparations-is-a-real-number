#!/usr/bin/env node
'use strict';

/**
 * seed-anchor-rates.js  (Front A, GitHub #83)
 *
 * Seeds anchor_rate_series with a COMPACT set of CITED benchmark rate
 * observations so the rate-resolver anchors (not just proxies) for the main
 * families while the scraped series (#84–#89) are still pending.
 *
 * HONESTY NOTE: GitHub #87's literal ask — probate APPRAISAL-vs-SALE spreads —
 * is NOT computable yet: probate_estate_extractions hold appraised values only
 * (no sale/settlement value). So #87 stays open on the extraction side, and this
 * seed instead loads published benchmark rates (Homer & Sylla, Conrad & Meyer,
 * Officer & Williamson, Freedman's Bank historical) as LABELED, LOW-CONFIDENCE
 * benchmarks — researched proxies per the proxy-explicitness rule, NOT silent
 * constants and NOT scraped series. Each is replaced automatically as the real
 * series land (the resolver prefers higher-specificity / higher-confidence rows).
 *
 * Idempotent: deletes its own seeded rows (methodology_note marker) then reinserts.
 *
 * USAGE: node scripts/seed-anchor-rates.js [--apply]
 */

require('dotenv').config();
const { Pool } = require('pg');
const APPLY = process.argv.includes('--apply');
const MARKER = 'SEED:benchmark-proxy';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// [family, asset_class, place_state, year_start, year_end, rate, compounding, source, citation, confidence, note]
const ROWS = [
    ['enterprise_roi', null, null, 1800, 1865, 0.08, 'compound',
     'Conrad & Meyer (1958)', 'Conrad AH, Meyer JR. "The Economics of Slavery in the Antebellum South." J. Political Economy 66(2):95–130.', 0.50,
     'Antebellum cliometric return on slave capital (~6–10%); wrongdoer-gain anchor pending plantation-ROI scrape (#88).'],
    ['bond_yield', null, null, 1790, 1900, 0.05, 'compound',
     'Homer & Sylla', 'Homer S, Sylla R. "A History of Interest Rates." 4th ed. Wiley, 2005.', 0.50,
     '19th-c. long-term US/UK government bond yield benchmark; risk-free opportunity-cost anchor (ICHEIC method). Pending series scrape (#85).'],
    ['bond_yield', null, null, 1901, 2026, 0.045, 'compound',
     'Homer & Sylla; FRED', 'Homer & Sylla (2005); Federal Reserve long-term Treasury series.', 0.50,
     '20th–21st-c. long-term Treasury benchmark. Pending series scrape (#85).'],
    ['price_index', null, null, 1790, 2026, 0.025, 'compound',
     'Officer & Williamson, MeasuringWorth', 'Officer LH, Williamson SH. "The Annual Consumer Price Index for the United States." MeasuringWorth.', 0.60,
     'Long-run US inflation; purchasing-power-preservation FLOOR (most conservative). Pending full CPI series (#89).'],
    ['deposit_interest', null, null, 1865, 1874, 0.06, 'compound',
     "Freedman's Savings Bank (historical)", "Freedman's Savings & Trust Co. advertised passbook rate; Osthaus, Freedmen, Philanthropy, and Fraud (1976).", 0.40,
     "Historical passbook rate; victim opportunity-cost anchor. Pending ledger scrape (#84)."],
];

async function main() {
    console.log(`═══ Seed anchor_rate_series (benchmark proxies) ═══  ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
    console.log('NOTE: #87 appraisal-vs-sale not seedable (probate holds appraisal only, no sale value).\n');
    for (const r of ROWS) {
        console.log(`  ${r[0].padEnd(18)} ${String(r[5]).padStart(6)}  ${r[3]}-${r[4]}  conf ${r[9]}  ${r[7]}`);
    }
    if (!APPLY) { console.log('\nDRY-RUN — re-run with --apply.'); await pool.end(); return; }

    const c = await pool.connect();
    try {
        await c.query('BEGIN');
        const del = await c.query(`DELETE FROM anchor_rate_series WHERE methodology_note LIKE $1`, [MARKER + '%']);
        for (const r of ROWS) {
            await c.query(`
                INSERT INTO anchor_rate_series
                    (anchor_family, asset_class, place_state, year_start, year_end, annual_rate,
                     compounding, source_name, source_citation, confidence, methodology_note)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            `, [r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], `${MARKER} — ${r[10]}`]);
        }
        await c.query('COMMIT');
        console.log(`\n✓ cleared ${del.rowCount} prior seed rows, inserted ${ROWS.length} benchmark anchors`);
    } catch (e) { await c.query('ROLLBACK'); throw e; }
    finally { c.release(); await pool.end(); }
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
