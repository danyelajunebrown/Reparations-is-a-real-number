'use strict';

/**
 * macro-config.js — SINGLE SOURCE OF TRUTH for the discount/compound rates and
 * the macro-economic control totals used across the DAA / obligation pipeline.
 *
 * WHY THIS EXISTS
 * ---------------
 * Before this module the same numbers were re-declared (and operationalized
 * differently) in at least four places:
 *
 *   • DAAGenerator.js                 — COMPOUND_INTEREST_RATE = 0.03 (Craemer floor)
 *   • reparations_line_items table    — compound_rate = 0.05 on every row, plus the
 *                                       seed registry (seed-reparations-framework.mjs)
 *                                       hardcoding `(1+0.05)^…` in 4 method rows
 *   • DAAOrchestrator.computeDAAFromLineItems — 14e12 / 40e6 = $350,000 per capita,
 *                                       inline
 *   • WealthGapCalculator.js          — an ENTIRELY DIFFERENT Darity operationalization:
 *                                       $8.41T mean-gap × households, $210,250 base share
 *   • global_indicator_targets (DB)   — the same Darity/Brattle/Craemer figures again
 *   • src/services/calibration/targets.mjs — and again
 *
 * RATES ARE NOT ONE PARAMETER. There are two distinct, separately-cited rates:
 *   - Craemer's 0.03 conservative labor-value floor (DAAGenerator), and
 *   - the 0.05 Neal/D&M itemization compounding rate (line items / registry).
 * They are different theoretical objects; this module names both rather than
 * collapsing them. They are PARAMETERS of an explicit damages theory and discount
 * choice — NOT learned values.
 *
 * DARITY IS NOT ONE NUMBER EITHER. Darity & Mullen have two operationalizations
 * that produce genuinely different magnitudes, and the codebase had been letting
 * both float unreconciled ($14T demographic per-capita vs $8.41T SCF wealth-gap).
 * Per the build directive we carry BOTH, explicitly labelled as distinct targets,
 * rather than silently picking one. See DARITY.percapita_demographic vs
 * WEALTH_GAP below, and the `note` fields.
 *
 * Every value carries a citation (project rule: no unsourced constants). These
 * MIRROR the rows in the `global_indicator_targets` DB table; that table remains
 * the auditable system-of-record for benchmarking, and `assertConsistentWithDb()`
 * can be used in a test/cron to detect drift between this module and the DB.
 */

// ── DISCOUNT / COMPOUND RATES ───────────────────────────────────────────────
const RATES = {
  // Craemer (2015) p.645 — "very conservative", below historical inflation.
  // The labor-value (cost-to-enslaved) compounding floor. Used by DAAGenerator.
  craemerCompound: {
    value: 0.03,
    cite: 'Craemer (2015), Soc. Sci. Quarterly 96(2):639–655, p.645 — conservative floor',
  },
  // Neal (1983) wage-theft base compounded at 4–6%; D&M/Slaughter JEP (2022)
  // itemization midpoint. This is the rate stamped on every reparations_line_items
  // row (compound_rate = 0.05) and used in 4 calculation_method_registry formulas.
  lineItemCompound: {
    value: 0.05,
    cite: 'Neal (1983); Darity, Mullen & Slaughter, JEP 36(2) (2022) — 4–6% band midpoint',
  },
};

// ── DARITY & MULLEN — demographic per-capita operationalization ─────────────
// "From Here to Equality" (2020) + JEP (2022). The racial-wealth-gap closure
// total divided across eligible living descendants. This is the operationalization
// stored in global_indicator_targets (racial_wealth_gap row) and used by
// DAAOrchestrator.computeDAAFromLineItems.
const DARITY = {
  total_usd:        { value: 14e12,   cite: 'Darity, Mullen & Slaughter, JEP 36(2) (2022) — close the racial wealth gap' },
  eligible_n:       { value: 40e6,    cite: 'Darity & Mullen (2020) — eligible Black descendants of US slavery' },
  percapita_demographic: { value: 350000, cite: 'D&M&S JEP (2022): $14T / 40M ≈ $350,000 per eligible descendant' },
  // Lower/upper per-capita band carried for benchmarking ranges.
  percapita_low:    { value: 267000,  cite: 'Darity & Mullen (2020); JEP (2022) lower band' },
  percapita_high:   { value: 800000,  cite: 'Darity & Mullen (2020); JEP (2022) upper band' },
  total_low_usd:    { value: 10.7e12, cite: 'Darity & Mullen (2020) lower total' },
  note: 'Demographic per-capita. DISTINCT from the WEALTH_GAP (SCF mean-gap) operationalization below — both are kept, neither is silently preferred.',
};

// ── DARITY & MULLEN — SCF mean-gap operationalization (the wealth-gap allocator) ─
// Federal Reserve Survey of Consumer Finances. This is the SECOND Darity
// operationalization that WealthGapCalculator uses; it produces ~$8.41T, NOT $14T.
const WEALTH_GAP = {
  mean_white_household_usd: { value: 983400, cite: 'Fed SCF 2019 — mean white household wealth' },
  mean_black_household_usd: { value: 142500, cite: 'Fed SCF 2019 — mean Black household wealth' },
  black_households:         { value: 10e6,   cite: 'US Census Bureau — ~10M Black households' },
  // estimated living Americans with >=1 slaveholder ancestor (share-of-gap denominator)
  estimated_slaveholder_descendants: {
    value: 40e6,
    cite: 'Rough estimate: ~400K 1860 slaveholders × ~100 descendants over 6–7 generations (needs refinement)',
  },
  note: 'SCF mean-gap operationalization. gap_per_household and total_gap are DERIVED (see deriveWealthGap).',
};

// ── BRATTLE GROUP (2023) — international-law operationalization ──────────────
const BRATTLE = {
  us_total_usd:      { value: 36e12,     cite: 'Brattle Group (2023) ASIL/UWI — US obligation' },
  us_percapita_usd:  { value: 450000,    cite: 'Brattle Group (2023) — US per-capita (global_indicator_targets)' },
  global_low_usd:    { value: 100e12,    cite: 'Brattle Group (2023) — global lower' },
  global_high_usd:   { value: 131e12,    cite: 'Brattle Group (2023) — global upper' },
  life_years:        { value: 801.58e6,  cite: 'Brattle Group (2023) — global free-labor life-years' },
  per_person_year_low_usd: { value: 96000, cite: 'Brattle (2023): $77T / 802M ≈ $96K per person-year (low end)' },
};

// ── CRAEMER (2015) — cost-to-enslaved total (macro ceiling cross-check) ──────
const CRAEMER = {
  total_low_usd:  { value: 14.5e12, cite: 'Craemer (2015) — cost-to-enslaved lower' },
  total_high_usd: { value: 20e12,   cite: 'Craemer (2015) — cost-to-enslaved upper' },
};

// ── Derived helpers (compute, never re-hardcode) ────────────────────────────
function deriveWealthGap() {
  const gapPerHousehold = WEALTH_GAP.mean_white_household_usd.value - WEALTH_GAP.mean_black_household_usd.value;
  const totalGap = gapPerHousehold * WEALTH_GAP.black_households.value;
  const baseSharePerDescendant = totalGap / WEALTH_GAP.estimated_slaveholder_descendants.value;
  return { gapPerHousehold, totalGap, baseSharePerDescendant };
}

// Plain-number accessors for hot paths that just want the scalar.
const value = (leaf) => leaf.value;

/**
 * Optional drift guard: confirm this module agrees with the global_indicator_targets
 * DB rows. Call from a test or nightly cron. Returns an array of mismatches (empty = OK).
 * @param {object} db - a node-postgres pool/client with .query
 */
async function assertConsistentWithDb(db) {
  const mismatches = [];
  const { rows } = await db.query(`
    SELECT source_author, scope, methodology, total_usd_high, per_capita_usd
    FROM global_indicator_targets
  `);
  const find = (author, methodology) =>
    rows.find((r) => (r.source_author || '').startsWith(author) && r.methodology === methodology);

  const dm = find('Darity', 'racial_wealth_gap');
  if (dm && Number(dm.per_capita_usd) !== DARITY.percapita_demographic.value) {
    mismatches.push(`Darity per_capita: DB=${dm.per_capita_usd} module=${DARITY.percapita_demographic.value}`);
  }
  const br = find('Brattle', 'international_law_violations');
  if (br && Number(br.per_capita_usd) !== BRATTLE.us_percapita_usd.value) {
    mismatches.push(`Brattle per_capita: DB=${br.per_capita_usd} module=${BRATTLE.us_percapita_usd.value}`);
  }
  return mismatches;
}

module.exports = {
  RATES,
  DARITY,
  WEALTH_GAP,
  BRATTLE,
  CRAEMER,
  deriveWealthGap,
  value,
  assertConsistentWithDb,
};
