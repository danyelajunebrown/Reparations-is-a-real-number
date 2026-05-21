'use strict';

/**
 * Probate document classifier — the single source of truth for deciding what
 * kind of record a transcript page is (will / inventory / estate account / …).
 *
 * Why this module exists
 * ----------------------
 * Two consumers used to classify independently and disagree:
 *
 *   - scripts/scrapers/georgia-probate-scraper.js  (per-image, on ingest)
 *   - src/services/probate/document-segmenter.js   (per-roll, start detection)
 *
 * The scraper's old rule classified a page as a `will` if the transcript merely
 * contained the substrings "executor" AND "will" anywhere. Virtually every
 * probate page satisfies that — estate accounts name an executor, inventories
 * name an executor, and a "Will Book" index page is wall-to-wall "Will". The
 * result: 1,791 pages tagged `will` of which only ~8% held an actual will.
 *
 * Both consumers now import `detectStart` from here so the rules can never
 * drift apart again.
 *
 * Signals are deliberately tolerant of OCR noise — FamilySearch "full-text"
 * transcripts are frequently machine OCR, not clean volunteer transcription.
 * Each START signal is a genuine *start-of-document* anchor; a mid-document
 * phrase (e.g. "give and bequeath") is intentionally NOT a start signal,
 * because using it would split a will at its bequest clause.
 */

// Each entry: { type, weight, re }. Highest-weight match wins for a page.
const START_SIGNALS = [
  { type: 'will',             weight: 1.00, re: /last\s+will\s+(?:and|&|\W){0,3}testament/i },
  { type: 'will',             weight: 0.95, re: /in\s+the\s+name\s+of\s+god[\s,.]+amen/i },
  // Case-sensitive on purpose: requires a capitalised testator name after "I".
  { type: 'will',             weight: 0.70, re: /\bI[\s,]+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z.]+){0,3}[\s,]+(?:of\s+the\s+county|being\s+of\s+sound|do\s+(?:hereby\s+)?make)/ },
  { type: 'inventory',        weight: 1.00, re: /inventory\s+(?:and|&)?\s*appraise?ment/i },
  { type: 'inventory',        weight: 0.90, re: /appraise?ment\s+of\s+the\s+(?:estate|property|goods|effects)/i },
  { type: 'inventory',        weight: 0.80, re: /a\s+true\s+(?:and\s+perfect\s+)?inventory/i },
  { type: 'estate_account',   weight: 0.95, re: /in\s+account\s+(?:current\s+)?with\s+the\s+estate/i },
  { type: 'estate_account',   weight: 0.80, re: /annual\s+return\s+of/i },
  { type: 'guardian_account', weight: 0.95, re: /guardian(?:'?s)?\s+(?:account|return)/i },
  { type: 'letters',          weight: 1.00, re: /letters\s+testamentary/i },
  { type: 'letters',          weight: 1.00, re: /letters\s+of\s+administration/i },
  { type: 'letters',          weight: 0.90, re: /letters\s+of\s+guardianship/i },
];

const MIN_TEXT_LEN = 6; // transcripts <= this are treated as effectively empty

function normalize(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

/**
 * Classify a single page's transcript.
 * @param {string} text transcript text (normalized or not)
 * @returns {{isStart:boolean, type:string|null, confidence:number}}
 */
function detectStart(text) {
  const t = normalize(text);
  if (!t || t.length <= MIN_TEXT_LEN) {
    return { isStart: false, type: null, confidence: 0 };
  }
  let best = null;
  for (const sig of START_SIGNALS) {
    if (sig.re.test(t)) {
      if (!best || sig.weight > best.weight) best = sig;
    }
  }
  if (best) return { isStart: true, type: best.type, confidence: best.weight };
  return { isStart: false, type: null, confidence: 0 };
}

/**
 * Per-page record classification for the scraper.
 * A page with no recognised start anchor is `other` with confidence 0 — it may
 * be a continuation page, an index/cover page, or a transcript too garbled to
 * classify. The roll-level segmenter is responsible for stitching continuation
 * pages back onto their parent document.
 *
 * @param {string} text transcript text
 * @returns {{recordType:string, confidence:number}}
 */
function classifyTranscript(text) {
  const d = detectStart(text);
  return { recordType: d.type || 'other', confidence: d.confidence };
}

module.exports = { START_SIGNALS, MIN_TEXT_LEN, normalize, detectStart, classifyTranscript };
