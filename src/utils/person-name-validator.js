'use strict';

/**
 * Shared person-name validator — the single gate every canonical_persons
 * creation should pass through.
 *
 * Background: a May 2026 audit deleted 3,271 `system`/`unknown` junk rows that
 * were never people — Wikipedia article fragments ("From Wikipedia", "United
 * States") and will-transcript OCR fragments ("to my beloved", "them by will",
 * "the premisses") that extractors turned into canonical_persons rows.
 *
 * `isValidPersonName` returns true only for strings that plausibly name a
 * single human being. Used by scripts/scrapers/georgia-probate-scraper.js and
 * src/services/NameResolver.js so the rule cannot drift between them.
 */

// Articles, prepositions, pronouns, will/deed boilerplate, and OCR-noise tokens.
// A "name" containing any of these is a parsed phrase fragment, not a person.
const NON_NAME_TOKENS = new Set([
  // function words
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'by', 'for',
  'with', 'from', 'as', 'my', 'his', 'her', 'their', 'our', 'your', 'its',
  'i', 'he', 'she', 'we', 'they', 'them', 'it', 'who', 'whom', 'which',
  'that', 'this', 'these', 'those', 'said', 'same',
  // will / deed boilerplate
  'shall', 'should', 'will', 'would', 'hereby', 'unto', 'upon', 'before',
  'during', 'after', 'until', 'whereas', 'wherein', 'therein', 'thereof',
  'herein', 'anno', 'lawful', 'issue', 'premises', 'premisses', 'tract',
  'estate', 'heirs', 'heir', 'recommend', 'dispose', 'bequeath', 'devise',
  'give', 'given', 'sell', 'submit', 'children', 'child', 'dollars', 'dollar',
  'perty', 'property',
  // OCR-noise / ledger boilerplate (from the probate scraper's stopword set)
  'viz', 'lastly', 'likewise', 'furthermore', 'moreover', 'item', 'valued',
  'purchase', 'forward', 'house', 'field', 'born', 'cold', 'had', 'ditto',
  'do', 'gross', 'pair', 'mentioned', 'state', 'march', 'day', 'god',
  // non-person fragments from the Dec-2025 Wikipedia-scrape junk batch
  'wikipedia', 'united', 'states', 'president', 'vice', 'general',
]);

/**
 * @param {string} name
 * @returns {boolean} true only if `name` plausibly names a single human being.
 */
function isValidPersonName(name) {
  if (!name) return false;
  const clean = String(name).trim();
  if (clean.length < 3) return false;
  if (/[\n\t\r]/.test(clean)) return false;          // OCR line-break artifact
  if (!/[A-Za-z]/.test(clean)) return false;
  const tokens = clean.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 5) return false; // a name is not a phrase
  let realTokens = 0;
  for (const t of tokens) {
    const lc = t.toLowerCase().replace(/[^a-z]/g, '');
    if (!lc) continue;
    if (NON_NAME_TOKENS.has(lc)) return false;
    if (lc.length === 1) continue;                   // middle initial — allowed
    if (!/[aeiou]/.test(lc)) return false;            // multi-letter name words need a vowel
    if (/^[A-Z]/.test(t)) realTokens++;
  }
  return realTokens >= 1;                            // ≥1 capitalised name word
}

module.exports = { isValidPersonName, NON_NAME_TOKENS };
