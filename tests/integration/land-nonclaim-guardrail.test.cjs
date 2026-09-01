/**
 * land-nonclaim-guardrail.test.cjs — the LAND NON-CLAIM guardrail (user directive 2026-07-17).
 *
 * DAAs must be "cognizant of wealth over time" but "make NO claim to the land of the Native peoples —
 * that ought to be restituted SEPARATELY." Land is a VALUATION INSTRUMENT (measures enslaver wealth),
 * never a descendant-claimed asset. This test proves DisgorgementCalculator.forEnslaver routes land
 * value to native_land_restitution_usd (owed to the Native nation) and EXCLUDES it from
 * descendant_claimable_usd — the figure any DAA descendant-claim must use.
 *
 * Runs entirely inside a rolled-back transaction (no persisted test data). Requires DATABASE_URL and
 * the migration-125 indigenous_land_provenance seed for Dutchess (Stockbridge-Munsee).
 *
 *   node tests/integration/land-nonclaim-guardrail.test.cjs
 */
require('dotenv').config();
const pg = require('pg');
const DisgorgementCalculator = require('../../src/services/reparations/DisgorgementCalculator');

(async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  let pass = true;
  const check = (name, cond) => { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) pass = false; };
  try {
    await client.query('BEGIN');
    const eid = (await client.query(
      `INSERT INTO canonical_persons (canonical_name, person_type, primary_state, primary_county)
       VALUES ('TEST Guardrail Enslaver','enslaver','New York','Dutchess') RETURNING id`)).rows[0].id;
    await client.query(
      `INSERT INTO land_transfer_events (transfer_year, transfer_type, consideration_usd, implicates_enslaver, enslaver_person_id, property_description)
       VALUES (1800,'sale',1000,TRUE,$1,'450 acres, Dutchess Co')`, [eid]);
    await client.query(
      `INSERT INTO flagrant_heirloom_assets (appraised_value_usd, appraised_year, asset_category, implicates_enslaver, enslaver_person_id)
       VALUES (500,1800,'silver',TRUE,$1)`, [eid]);

    const r = await new DisgorgementCalculator(client).forEnslaver(eid);

    check('contains_native_land_value = true', r.contains_native_land_value === true);
    check('land routed to native restitution (>0)', r.native_land_restitution_usd > 0);
    check('native_land_restitution == land component', Math.abs(r.native_land_restitution_usd - r.components.land_transfer.usd) < 0.01);
    check('descendant_claimable EXCLUDES land (== heirloom)', Math.abs(r.descendant_claimable_usd - r.components.flagrant_heirloom.usd) < 0.01);
    check('descendant_claimable < total (land removed)', r.descendant_claimable_usd < r.total_usd);
    check('land NEVER claimable by descendant', r.land_claim.claimable_by_descendant === false);
    check('owed to the Native successor nation', r.land_claim.owed_to === 'Stockbridge-Munsee Community');
    check('routing flag set', r.flags.includes('land_value_routed_to_native_restitution'));
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
  console.log('\n' + (pass ? '=== ALL GUARDRAIL ASSERTIONS PASS ===' : '=== GUARDRAIL FAILED ==='));
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('TEST_ERROR', e); process.exit(1); });
