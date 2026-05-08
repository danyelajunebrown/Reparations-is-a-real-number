// Formatting helpers. Terminal aesthetic — no fancy locale rounding.

export function formatNumber(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const num = Number(n);
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return num.toLocaleString();
}

export function formatInt(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString();
}

export function formatUSD(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const num = Number(n);
  if (num >= 1e9) return '$' + (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return '$' + (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return '$' + (num / 1e3).toFixed(1) + 'K';
  return '$' + num.toFixed(2);
}

export function formatPct(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return (Number(n) * 100).toFixed(1) + '%';
}

export function formatYear(y) {
  if (!y) return '—';
  return String(y);
}

/**
 * Returns either a plain string (primary source) or an object with
 * { yearStr, isEstimate, tooltip } for rendering an estimation badge.
 *
 * Usage in JSX:
 *   const y = formatYearWithEstimation(p.birth_year, p.birth_year_source, p.birth_year_confidence, p.birth_year_formula);
 *   typeof y === 'string' ? y : <EstimatedYear {...y} />
 */
export function formatYearWithEstimation(year, source, confidence, formula) {
  if (!year) return '—';
  const yearStr = String(year);
  if (!source || source === 'primary_source' || source === 'exact') return yearStr;
  const pct = confidence != null ? Math.round(Number(confidence) * 100) : 65;
  const tooltip = formula || `estimated · ${pct}% confidence`;
  return { yearStr, isEstimate: true, tooltip };
}

export function formatClass(cls) {
  if (!cls) return 'unverified';
  return cls.replace(/_/g, ' ');
}

// Classification labels for the 7-class match verification taxonomy
export const CLASS_LABELS = {
  confirmed_slaveholder: 'Confirmed slaveholder',
  enslaved_ancestor: 'Enslaved ancestor',
  free_poc: 'Free person of color',
  free_poc_slaveholder: 'Free POC slaveholder',
  temporal_impossible: 'Temporal impossible',
  common_name_suspect: 'Common name suspect',
  ambiguous_needs_review: 'Ambiguous — needs review',
  unverified: 'Unverified',
};

export const CLASS_DESCRIPTIONS = {
  confirmed_slaveholder: 'Verified as a slaveholder through primary source cross-reference.',
  enslaved_ancestor: 'Verified as an enslaved ancestor through database cross-reference.',
  free_poc: 'Free person of color — not a slaveholder.',
  free_poc_slaveholder: 'Free person of color who was also a slaveholder (documented).',
  temporal_impossible: 'Birth/death dates place this person outside the slavery era.',
  common_name_suspect: 'Common surname at high generation depth — likely false positive.',
  ambiguous_needs_review: 'Insufficient evidence for automatic classification.',
  unverified: 'Not yet verified against primary sources.',
};
