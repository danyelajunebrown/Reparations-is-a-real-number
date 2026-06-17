/**
 * Calibration control totals — the cited macro-economic targets that per-unit
 * reparations estimates are BENCHMARKED to. These are TARGETS (constraints),
 * NOT observed outcomes (no reparations have been paid). See
 * calibration-harness.mjs for why that distinction is load-bearing.
 *
 * SINGLE-SOURCED: the numbers now come from ../reparations/macro-config.js (CJS),
 * the one canonical config module the whole DAA pipeline reads from. This ESM
 * file is a thin adapter that re-shapes those leaves into the {value,unit,cite}
 * form the calibration harness consumes — so $14T, $36T, $350k etc. can no longer
 * drift between the calibration layer and the obligation calculators.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const MACRO = require('../reparations/macro-config.js');

export const TARGETS = {
  // Brattle Group (2023). NOTE: us value here is Brattle's headline US obligation
  // from macro-config ($36T), reconciled with global_indicator_targets — the
  // prior $26.79T figure (TCS-period only) is a different sub-aggregate.
  brattle_us_tcs_usd:   { value: MACRO.BRATTLE.us_total_usd.value, unit: 'total US obligation', cite: MACRO.BRATTLE.us_total_usd.cite },
  brattle_global_usd:   { value: MACRO.BRATTLE.global_high_usd.value, unit: 'total global TCS harm (upper)', cite: MACRO.BRATTLE.global_high_usd.cite },
  brattle_life_years:   { value: MACRO.BRATTLE.life_years.value, unit: 'global free-labor life-years', cite: MACRO.BRATTLE.life_years.cite },

  // Darity & Mullen demographic per-capita band + totals.
  darity_percapita_low_usd:  { value: MACRO.DARITY.percapita_low.value,  unit: 'per living eligible descendant', cite: MACRO.DARITY.percapita_low.cite },
  darity_percapita_high_usd: { value: MACRO.DARITY.percapita_high.value, unit: 'per living eligible descendant', cite: MACRO.DARITY.percapita_high.cite },
  darity_percapita_point_usd:{ value: MACRO.DARITY.percapita_demographic.value, unit: 'per living eligible descendant (JEP point)', cite: MACRO.DARITY.percapita_demographic.cite },
  darity_eligible_n:         { value: MACRO.DARITY.eligible_n.value, unit: 'eligible descendants (count)', cite: MACRO.DARITY.eligible_n.cite },
  darity_total_low_usd:      { value: MACRO.DARITY.total_low_usd.value, unit: 'total', cite: MACRO.DARITY.total_low_usd.cite },
  darity_total_high_usd:     { value: MACRO.DARITY.total_usd.value, unit: 'total', cite: MACRO.DARITY.total_usd.cite },
};

export const darityMidPerCapita = () =>
  (TARGETS.darity_percapita_low_usd.value + TARGETS.darity_percapita_high_usd.value) / 2;

export { MACRO };
