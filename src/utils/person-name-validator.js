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
  // probate-ledger abbreviations mistaken for single given names
  'est', 'capt', 'no', 'amt', 'acct',
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

// Place-words and status/role/boilerplate words that recur as FAKE decedents/enslavers in the probate
// corpus. Unlike NON_NAME_TOKENS (fragment detection), these are whole "names" that pass isValidPersonName
// (they have a vowel and a capital) but are not people: the county they were filed in ("Albany"), the
// province ("New York"), or their legal role ("Deceased", "Sole", "Widow"). The Jul-2026 NY-probate audit
// found "Albany"×5, "New York"×3, "Sole"×4, "Deceased"×5 minted as ASSERTABLE enslavers. Promoted here from
// scripts/build-probate-estate-index.mjs so the mint gate (PersonService.findOrCreateLead) can decline them.
const SUSPECT_WORDS = new Set([
  // place-words (NY corpus + general jurisdiction terms)
  'schenectady', 'albany', 'newyork', 'york', 'county', 'state', 'city', 'town', 'manor',
  'colony', 'province', 'court', 'surrogate', 'register', 'dutchess', 'ulster', 'kings',
  'queens', 'richmond', 'westchester', 'rensselaer', 'fishkill', 'poughkeepsie', 'rhinebeck',
  'england', 'america', 'district', 'ward', 'precinct', 'township', 'parish', 'borough',
  // status / role / legal-boilerplate words that recur as fake decedents
  'deceased', 'sole', 'late', 'widow', 'widower', 'estate', 'administrator', 'administratrix',
  'executor', 'executrix', 'guardian', 'heir', 'heirs', 'infant', 'minor', 'unknown', 'ditto',
  'same', 'aforesaid', 'decedent', 'testator', 'esquire',
]);

/**
 * True when `name` is a place-word / status-word / digit-bearing string that passes isValidPersonName but
 * is NOT a person (a jurisdiction or a legal role, not a human). Role-agnostic and deliberately NARROW: it
 * does NOT reject single given names ("Jack", "Bardecu") — legitimate enslaved single-names must still mint.
 * Biscoe rule: a suspect name is DECLINED at mint, never deleted.
 * @param {string} name
 * @returns {boolean}
 */
function isNameSuspect(name) {
  if (!name) return true;
  const clean = String(name).trim();
  if (/\d/.test(clean)) return true;                                   // residual digits (dates / liber-folio refs)
  const toks = clean.toLowerCase().split(/[\s,]+/).map((t) => t.replace(/[^a-z]/g, '')).filter(Boolean);
  if (!toks.length) return true;
  if (toks.every((t) => SUSPECT_WORDS.has(t))) return true;            // all place/status words ("Albany", "Sole", "Albany County")
  if (toks.length === 2 && SUSPECT_WORDS.has(toks.join(''))) return true; // "New York"
  return false;
}

module.exports = { isValidPersonName, isNameSuspect, NON_NAME_TOKENS, SUSPECT_WORDS };
