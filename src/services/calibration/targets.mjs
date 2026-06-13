/**
 * Calibration control totals — the cited macro-economic targets that per-unit
 * reparations estimates are BENCHMARKED to. These are TARGETS (constraints),
 * NOT observed outcomes (no reparations have been paid). See
 * calibration-harness.mjs for why that distinction is load-bearing.
 *
 * Every value carries a citation (project rule: no unsourced constants). These
 * should eventually migrate into the methodology DB table (M060-style) with
 * versioning; kept here as a cited module for the Phase-0 spike.
 */
export const TARGETS = {
  // Brattle Group (June 2023), "Quantification of Reparations for Transatlantic
  // Chattel Slavery" — global $100–131T; US assessed ~$26.79T for its own TCS;
  // 801.58M life-years of free labor across 31 enslaving countries.
  brattle_us_tcs_usd:   { value: 26.79e12, unit: 'total US TCS harm',  cite: 'Brattle Group (2023)' },
  brattle_global_usd:   { value: 131e12,   unit: 'total global TCS harm (upper)', cite: 'Brattle Group (2023)' },
  brattle_life_years:   { value: 801.58e6, unit: 'global free-labor life-years',  cite: 'Brattle Group (2023)' },

  // Darity & Mullen, "From Here to Equality" (2020) + JEP (2022): racial wealth
  // gap as the per-capita standard. ~$267k–$800k per eligible descendant,
  // ~40M eligible Black descendants of US slavery, $10.7–14T total.
  darity_percapita_low_usd:  { value: 267000, unit: 'per living eligible descendant', cite: 'Darity & Mullen (2020); JEP (2022)' },
  darity_percapita_high_usd: { value: 800000, unit: 'per living eligible descendant', cite: 'Darity & Mullen (2020); JEP (2022)' },
  darity_eligible_n:         { value: 40e6,   unit: 'eligible descendants (count)',   cite: 'Darity & Mullen (2020)' },
  darity_total_low_usd:      { value: 10.7e12, unit: 'total',  cite: 'Darity & Mullen (2020)' },
  darity_total_high_usd:     { value: 14e12,   unit: 'total',  cite: 'Darity & Mullen (2020)' },
};

export const darityMidPerCapita = () =>
  (TARGETS.darity_percapita_low_usd.value + TARGETS.darity_percapita_high_usd.value) / 2;
