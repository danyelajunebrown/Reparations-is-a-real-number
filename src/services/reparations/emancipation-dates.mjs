/**
 * Location-aware effective emancipation — freedom came at different times in
 * different places, and a flat "1865" erases that. Years-enslaved (and therefore
 * the wage-theft harm) must end at the LOCAL effective emancipation date.
 *
 * These are EFFECTIVE / lived dates, not just legal abstractions: most enslaved
 * people in the Confederacy were not freed by the 1863 Emancipation Proclamation
 * (which the Confederacy ignored and which exempted Union-held areas) but only as
 * Union forces arrived through 1865 — culminating in Juneteenth (Texas, the last
 * to learn). The border/Union states each have their own statutory date, and
 * Kentucky and Delaware held people in slavery until the 13th Amendment itself.
 *
 * Each entry is cited. Confederate Deep-South states use 1865 effective (the year
 * slavery actually collapsed locally); Sherman's Special Field Order No. 15
 * (Jan 16 1865) freed the SC/GA/FL low country specifically. Nuances flagged
 * inline are a known refinement target (e.g. Union-occupied Louisiana parishes).
 */
export const EMANCIPATION = {
  DC: { year: 1862, date: '1862-04-16', event: 'DC Compensated Emancipation Act', cite: 'Act of Apr 16, 1862, 12 Stat. 376' },
  MD: { year: 1864, date: '1864-11-01', event: 'Maryland Constitution of 1864 (Art. 24)', cite: 'Md. Const. of 1864' },
  MO: { year: 1865, date: '1865-01-11', event: 'Missouri Ordinance of Emancipation', cite: 'Mo. Ordinance, Jan 11 1865' },
  TN: { year: 1865, date: '1865-02-22', event: 'Tennessee constitutional amendment abolishing slavery', cite: 'Tenn. Const. amend., Feb 22 1865' },
  WV: { year: 1865, date: '1865-02-03', event: 'West Virginia legislative abolition', cite: 'W.Va. abolition act, Feb 3 1865' },
  // Confederate states — effective collapse of slavery as Union forces arrived, 1865.
  TX: { year: 1865, date: '1865-06-19', event: 'Juneteenth — Granger General Order No. 3, Galveston', cite: 'Gen. Order No. 3, Jun 19 1865' },
  SC: { year: 1865, date: '1865-01-16', event: "Sherman's Special Field Order No. 15 (low country); 13th Amendment", cite: 'SFO No. 15, Jan 16 1865' },
  GA: { year: 1865, date: '1865-01-16', event: "Sherman's Special Field Order No. 15 (coast); effective 1865", cite: 'SFO No. 15, Jan 16 1865' },
  FL: { year: 1865, date: '1865-05-20', event: 'Emancipation Day, Tallahassee; effective 1865', cite: 'Fla. Emancipation Day, May 20 1865' },
  AL: { year: 1865, date: '1865-05-04', event: 'Effective emancipation 1865 (war end)', cite: 'effective 1865' },
  MS: { year: 1865, date: '1865-05-08', event: 'Effective emancipation 1865 (war end)', cite: 'effective 1865' },
  LA: { year: 1865, date: '1865-06-13', event: 'Effective 1865 (Union-occupied parishes earlier — refinement target)', cite: 'effective 1865; cf. EP 1863 exemptions' },
  AR: { year: 1865, date: '1865-04-14', event: 'Arkansas abolition (1864 free-state constitution; effective 1865)', cite: 'Ark. Const. 1864 / effective 1865' },
  VA: { year: 1865, date: '1865-04-09', event: 'Effective 1865 (Appomattox); WV split earlier', cite: 'effective 1865' },
  NC: { year: 1865, date: '1865-05-29', event: 'Effective emancipation 1865 (war end)', cite: 'effective 1865' },
  // Kept slavery until the 13th Amendment.
  KY: { year: 1865, date: '1865-12-18', event: '13th Amendment (Kentucky did not abolish earlier)', cite: 'U.S. Const. amend. XIII' },
  DE: { year: 1865, date: '1865-12-18', event: '13th Amendment (Delaware did not abolish earlier)', cite: 'U.S. Const. amend. XIII' },
};

// Default for unknown/other locations: 13th Amendment ratification.
export const DEFAULT_EMANCIPATION = { year: 1865, date: '1865-12-06', event: '13th Amendment ratification', cite: 'U.S. Const. amend. XIII (Dec 6, 1865)' };

import { normalizeState } from '../../../scripts/lib/name-normalize.mjs';

/** Effective emancipation record for a state string (dirty input ok). */
export function emancipationFor(state) {
  const code = normalizeState(state);
  return (code && EMANCIPATION[code]) || DEFAULT_EMANCIPATION;
}

/**
 * Years a person was enslaved, ending at LOCAL emancipation.
 * @param {number} birthYear  - typically (record year - age)
 * @param {string} state
 * @param {number} [deathYear] - cap if known (most enslaved records lack it)
 * ASSUMPTION (labeled): enslaved from birth until local emancipation unless a
 * death year caps it. Overcounts those who died young before emancipation; a
 * survival/lifespan proxy is a documented refinement (cf. proxy-explicitness rule).
 */
export const MIN_PLAUSIBLE_BIRTH = 1700;     // slave-schedule era floor
export const MAX_ENSLAVED_YEARS = 90;        // no one was enslaved >90 years
export function yearsEnslaved(birthYear, state, deathYear) {
  if (birthYear == null || Number.isNaN(birthYear)) return null;
  if (birthYear < MIN_PLAUSIBLE_BIRTH) return null;             // corrupt year/age
  const emancYear = emancipationFor(state).year;
  if (birthYear > emancYear) return null;                       // "born after local emancipation" = corrupt for enslaved-at-record data
  const end = deathYear != null ? Math.min(emancYear, deathYear) : emancYear;
  const y = end - birthYear;
  // NOTE: assuming enslaved until emancipation overcounts those observed long
  // before 1865 who died first; >90yr spans are implausible and quarantined.
  // A survival/lifespan model (life-expectancy-capped death) is a documented
  // refinement (see the proxy-explicitness rule + discount-rate issue).
  if (y < 0 || y > MAX_ENSLAVED_YEARS) return null;
  return y;
}

/** Plausibility of the raw (age, observationYear) inputs before deriving birthYear. */
export function plausibleAgeYear(age, year) {
  return Number.isFinite(age) && age >= 0 && age <= 100
    && Number.isFinite(year) && year >= 1700 && year <= 1870;
}
