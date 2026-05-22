'use strict';

/**
 * Probate entity extractor — pulls structured data out of a probate page's
 * OCR transcript: deceased/testator name, year, heirs + bequests, enslaved
 * persons, estate value.
 *
 * Built for a RE-PARSE pass: the Georgia probate scrape already stored OCR
 * text for ~13,500 Liberty County pages, but the scraper's inline regexes
 * extracted a testator for only 37% of them and produced 44 inheritance edges
 * from 2,621 wills. This module is the corrected, independently testable
 * extractor — run it against stored `person_documents.ocr_text` (see
 * scripts/test-probate-extraction.mjs) and against the scraper itself.
 *
 * FamilySearch "full-text" transcripts are machine OCR of 19th-century
 * handwriting: inconsistent casing, dropped words, "Georged" for "Georgia".
 * Patterns are deliberately case-insensitive and tolerant of inserted words.
 */

const { isValidPersonName } = require('../../utils/person-name-validator');

function norm(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

// Trim trailing single-letter/punctuation noise and normalise spacing.
function cleanName(raw) {
  return norm(raw).replace(/[.,;]+$/, '').replace(/\s+/g, ' ').trim();
}

// Honorifics to skip when they sit immediately before a name.
const HONORIFICS = new Set(['mr', 'mrs', 'miss', 'dr', 'rev', 'capt', 'col', 'maj', 'hon']);

// Capitalised words that are NOT name parts — sentence/clause starters and
// boilerplate that OCR run-on bleeds onto the end of a name. A name run stops
// when one is hit (it is not included).
const NAME_RUN_STOP = new Set([
  'also', 'and', 'but', 'item', 'lastly', 'likewise', 'whereas', 'the', 'to',
  'he', 'she', 'it', 'they', 'that', 'this', 'his', 'her', 'my', 'their',
  'of', 'in', 'all', 'one', 'first', 'second', 'third', 'now', 'then', 'each',
  // will roles / boilerplate that OCR run-on appends to a name
  'executor', 'executrix', 'executors', 'administrator', 'administratrix',
  'testament', 'codicil', 'witness', 'deceased', 'heir', 'heirs', 'share',
]);

/**
 * From a string, take the leading run of name tokens — consecutive
 * capitalised words and single-letter initials — stopping at the first
 * lowercase / non-name word. This is how a name is bounded reliably without a
 * case-insensitive regex over-capturing trailing words ("...late of Liberty").
 * A leading honorific ("Mrs.") is skipped.
 */
function leadingName(str) {
  const tokens = norm(str).split(' ').filter(Boolean);
  const picked = [];
  for (let i = 0; i < tokens.length && picked.length < 4; i++) {
    const bare = tokens[i].replace(/^[.,;&]+/, '').replace(/[.,;&]+$/, '');
    if (bare === '') {                                  // standalone punctuation ("Mrs . Smith")
      if (picked.length) break;
      continue;                                         // ...skip it if we have no name yet
    }
    if (!/^[A-Z][a-zA-Z]*$/.test(bare)) break;          // must be a Capitalised token
    const lc = bare.toLowerCase();
    if (picked.length === 0 && HONORIFICS.has(lc)) continue; // skip "Mrs."
    if (NAME_RUN_STOP.has(lc)) break;                   // clause-starter bled onto the name
    picked.push(bare);
  }
  return picked.join(' ');
}

/** Trailing run of name tokens — leadingName() reading right-to-left. */
function trailingName(str) {
  const tokens = norm(str).split(' ').filter(Boolean);
  const picked = [];
  for (let i = tokens.length - 1; i >= 0 && picked.length < 4; i--) {
    const bare = tokens[i].replace(/^[.,;&]+/, '').replace(/[.,;&]+$/, '');
    if (bare === '') { if (picked.length) break; else continue; }
    if (!/^[A-Z][a-zA-Z]*$/.test(bare)) break;
    if (NAME_RUN_STOP.has(bare.toLowerCase())) break;
    picked.unshift(bare);
  }
  if (picked.length > 1 && HONORIFICS.has(picked[0].toLowerCase())) picked.shift();
  return picked.join(' ');
}

// Keyword anchors (case-insensitive) that a deceased/testator name follows or
// precedes. side: 'after'  — name follows the match (leadingName);
//            'group'  — name is captured group 1, then trimmed (leadingName);
//            'before' — name precedes the match (trailingName).
const TESTATOR_ANCHORS = [
  { side: 'after',  re: /(?:last\s+will\s+and\s+testament|will\s+and\s+(?:codicil|testament)|nuncupative\s+will)\s+of\s+/i },
  { side: 'after',  re: /(?:estate|goods\s+and\s+chattels|property|will)\s+of\s+(?:the\s+late\s+)?/i },
  // 'group' anchors capture loosely (the /i flag lets [A-Z] match lowercase);
  // leadingName() then trims the capture back to the real capitalised name run.
  { side: 'group',  re: /\bI[,\s]+([A-Za-z][a-zA-Z.\s]{3,40}?)[,\s]+of\s+(?:the\s+)?(?:county|state|town|city|parish|district)/i },
  { side: 'group',  re: /\b([A-Za-z][a-zA-Z.\s]{3,40}?)\s+late\s+of\s+[A-Za-z]+\s+(?:county|parish)/i },
  // 'before' — name sits immediately before the marker word.
  { side: 'before', re: /\s(?:deceased|dec[e']?d)\b/i },
];

/**
 * Deceased / testator name.
 * @returns {string|null}
 */
function extractTestator(ocr) {
  const text = norm(ocr);
  if (!text) return null;

  for (const a of TESTATOR_ANCHORS) {
    const m = text.match(a.re);
    if (!m) continue;
    let candidate;
    if (a.side === 'after') candidate = leadingName(text.slice(m.index + m[0].length));
    else if (a.side === 'before') candidate = trailingName(text.slice(0, m.index));
    else candidate = leadingName(m[1]); // 'group' — captured, still trim to name run
    candidate = cleanName(candidate);
    // A testator always has a full name in the record — reject single-token
    // captures ("WHERE", "Cason", "SERVICE") from garbled OCR. Better null than
    // a surname-only or boilerplate-fragment "name".
    if (isValidPersonName(candidate) && candidate.split(/\s+/).length >= 2) return candidate;
  }
  return null;
}

// Numeric and spelled-out year.
const ONES = { one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,
  eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,
  eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,
  eighty:80,ninety:90,hundred:100 };

/**
 * Document year. Prefers a numeric 18xx/19xx; falls back to a spelled-out
 * "one thousand eight hundred and sixty four" form common in formal wills.
 * @returns {number|null}
 */
function extractYear(ocr) {
  const text = norm(ocr);
  if (!text) return null;
  const numeric = text.match(/\b(1[789]\d{2})\b/g);
  if (numeric && numeric.length) {
    // earliest plausible year on the page
    return Math.min(...numeric.map((y) => parseInt(y, 10)));
  }
  // "one thousand eight hundred and sixty[ ]four"
  const sp = text.match(/one\s+thousand\s+([a-z\s-]{3,40}?)(?=[,.]|\s+(?:the|in|at|of|day|and\s+[A-Z]))/i);
  if (sp) {
    const words = sp[1].toLowerCase().replace(/-/g, ' ').split(/\s+/).filter((w) => ONES[w] !== undefined || w === 'and');
    let year = 1000, acc = 0;
    for (const w of words) {
      if (w === 'and') continue;
      const v = ONES[w];
      if (v === 100) acc = (acc || 1) * 100;
      else acc += v;
    }
    year += acc;
    if (year >= 1700 && year <= 1950) return year;
  }
  return null;
}

// Kinship terms (plural / "grand-" variants) and the qualifier adjectives that
// routinely sit between "my" and the relation or name.
const RELATION = 'grandson|granddaughter|grandchild|grand\\s*sons?|grand\\s*daughters?|'
  + 'grand\\s*child(?:ren)?|sons?|daughters?|wife|husband|brothers?|sisters?|'
  + 'nephews?|nieces?|mother|father|children|child|cousins?|widow';
const QUALIFIER = 'said|beloved|dear|loving|dearly|well|youngest|eldest|oldest|only|'
  + 'late|lawful|natural|own|second|third|two|three|four|five|six|seven';

/**
 * Heirs / beneficiaries and their relation to the testator.
 *
 * High-precision by design (reliability over recall): a heir is only taken
 * from an explicit "...to my <relation> <Name>" construction, and the Name is
 * bounded with leadingName() so relation/qualifier words and trailing text
 * cannot bleed into it. Bare "give to <Name>" with no stated relation is
 * intentionally NOT matched — it was the source of garbage names ("Fence",
 * "Thos", "DOROTHY LOUISE BAILEfifty").
 *
 * @returns {Array<{name:string, relation:string}>}
 */
/**
 * From the text after a "<relation>" anchor, pull the run of heir names —
 * one name, or a comma/"and"/"&"-separated list ("A, B, C and D"). Stops at
 * the first non-name segment (a clause boundary), so trailing will text
 * cannot leak in.
 */
function parseHeirList(after) {
  // window the search, and normalise list separators to commas.
  const seg = after.slice(0, 200).replace(/&/g, ' , ').replace(/\band\b/gi, ' , ');
  const names = [];
  for (const part of seg.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;                       // empty (leading/double comma)
    const nm = cleanName(leadingName(trimmed));
    if (isValidPersonName(nm)) names.push(nm);
    else break;                                   // first non-name segment ends the list
  }
  return names;
}

function extractHeirs(ocr) {
  const text = norm(ocr);
  const out = [];
  const seen = new Set();
  const QUALS = `(?:(?:${QUALIFIER})\\s+){0,3}`;
  // "[give/bequeath ...] [to|unto] my <qual> <relation> <qual> NAME[, NAME, ...]"
  // "to|unto" is optional so a continuation clause ("& my children A, B") still
  // anchors; <relation> is a closed kinship set, which keeps "my <X>" precise.
  const re = new RegExp(`(?:my|his|her|their|our)\\s+${QUALS}(${RELATION})\\s+${QUALS}`, 'gi');

  let m;
  while ((m = re.exec(text)) !== null) {
    const relation = m[1].toLowerCase().replace(/\s+/g, ' ').trim();
    for (const name of parseHeirList(text.slice(m.index + m[0].length))) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, relation });
    }
  }
  return out;
}

const ENSLAVED_LEAD = 'negro|negroe|negroes|negros|slave|slaves|servant|servants|'
  + 'coloured|colored|freedman|freedwoman|mulatto|boy|girl|man|woman|child|'
  + 'wench|fellow|infant';

/**
 * Enslaved persons named in a will or inventory.
 * Handles will phrasing ("my negro man Tom") and inventory-line phrasing
 * ("1 Negro woman Hannah  $650").
 * @returns {Array<{name:string, descriptor:string|null, value:number|null}>}
 */
function extractEnslaved(ocr) {
  const text = norm(ocr);
  const out = [];
  const seen = new Set();
  const add = (name, descriptor, value) => {
    const n = cleanName(name);
    if (!isValidPersonName(n)) return;          // a single given name ("Tom") still validates
    const key = n.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name: n, descriptor: descriptor || null, value: value || null });
  };

  // \b around every lead word so "man" cannot match inside "Sloman"/"Norman".
  const LEAD = `\\b(?:${ENSLAVED_LEAD})\\b`;
  // "negro man named Tom" / "negro woman Hannah" / "my slave girl Sally"
  const willStyle = new RegExp(`(?:my\\s+|one\\s+|a\\s+)?${LEAD}\\s+(?:${LEAD}\\s+)?(?:named?\\s+|called\\s+)?([A-Z][a-z]+)(?:\\s+(?:aged|valued|appraised|at|a\\s+${LEAD}))?`, 'gi');
  // inventory line: "1 Negro man Tom 800 00" / "Negro Hannah & child  $650"
  const invStyle = new RegExp(`(?:\\d+\\s+)?${LEAD}\\s+(?:${LEAD}\\s+)?([A-Z][a-z]+)\\s*(?:&[^$\\d]{0,20})?\\$?\\s*([\\d,]+)(?:[.\\s]\\d{2})?`, 'gi');

  let m;
  while ((m = invStyle.exec(text)) !== null) {
    const v = parseFloat((m[2] || '').replace(/,/g, ''));
    add(m[1], 'inventory_line', Number.isFinite(v) && v > 0 ? v : null);
  }
  while ((m = willStyle.exec(text)) !== null) add(m[1], 'will_bequest', null);
  return out;
}

/**
 * Total estate value, if stated.
 * @returns {number|null}
 */
function extractEstateValue(ocr) {
  const text = norm(ocr);
  const m = text.match(/(?:total|whole\s+amount|amounting\s+to|aggregate|sum\s+total|inventory\s+amounts?\s+to)[^\d$]{0,20}\$?\s*([\d,]+(?:\.\d{2})?)/i);
  if (m) {
    const v = parseFloat(m[1].replace(/,/g, ''));
    if (Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

/**
 * Full extraction for one OCR page.
 */
function extractEntities(ocr) {
  return {
    testatorName: extractTestator(ocr),
    year: extractYear(ocr),
    heirs: extractHeirs(ocr),
    enslavedPersons: extractEnslaved(ocr),
    estateValue: extractEstateValue(ocr),
  };
}

module.exports = {
  extractEntities, extractTestator, extractYear,
  extractHeirs, extractEnslaved, extractEstateValue,
};
