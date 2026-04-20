/**
 * Enslaver-name string validator.
 *
 * Scores a candidate enslaver / mistress / employer / old-title string
 * extracted from a Freedmen's Bank ledger via Google Vision OCR + spatial
 * catchment. Returns { plausible: bool, reasons: string[] }.
 *
 * Important design note: validator does NOT delete or modify the extracted
 * string. Its job is purely to classify. Callers that want to flag for human
 * review read `plausible` and `reasons`, then set requires_human_review +
 * review_reason on the row. The original string stays intact so a human
 * reviewer can still see what OCR captured.
 *
 * Usage:
 *   const { plausible, reasons } = validateEnslaverName("Mrs Cyons Howe");
 *   // → { plausible: true, reasons: [] }
 *   validateEnslaverName("17, 22 rifes name Dance Navie");
 *   // → { plausible: false, reasons: ['contains label word "name"', 'leading token is not a word'] }
 */

'use strict';

// Words that appear as printed form labels on the Freedmen's Bank ledger.
// If any of these survive into the extracted "enslaver name", the catchment
// bled across a label boundary — the string is an extraction artifact, not
// a name. Case-insensitive whole-word match.
const LABEL_WORDS = new Set([
    'application', 'applicant',
    'name', 'names',
    'signature', 'signed',
    'date', 'dated',
    'age', 'aged',
    'complexion', 'complexion,',
    'height',
    'residence', 'residences',
    'occupation',
    'birthplace', 'birth',
    'father', 'mother', 'parents',
    'wife', 'husband', 'spouse',
    'children', 'child',
    'brothers', 'sisters', 'siblings',
    'regiment', 'company',
    'employer', 'master', 'mistress', 'plantation',
    'depositor', 'depositors',
    'remarks', 'remark',
    'place',
    'works',
    'record', 'records',
    'no', 'nos',
    'married', 'single',
    'time', 'where', 'brought', 'last',
    'title', 'old',
    // Filler and OCR-fragment words
    'the', 'and', 'for', 'from', 'with', 'with.',
    'of', 'to', 'in', 'on', 'at', 'by',
    // Numeric + date noises commonly misread as names
    'jan', 'feb', 'mar', 'apr', 'may', 'jun',
    'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
]);

// Tokens that are likely OCR fragments: very short non-name-like strings.
function isLikelyOcrFragment(token) {
    // All-lowercase very short strings that aren't common name particles
    if (token.length <= 2) return true;
    // Starts with a digit or only digits
    if (/^\d/.test(token)) return true;
    // Contains digits + punctuation mix
    if (/[\d].*[\/\-].*[\d]/.test(token)) return true;
    // All punctuation / symbols
    if (!/[A-Za-z]/.test(token)) return true;
    return false;
}

// Strip trivial trailing punctuation but keep the token recognizable
function stripPunct(s) {
    return s.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9.]+$/g, '');
}

function validateEnslaverName(raw) {
    const reasons = [];
    if (raw == null || typeof raw !== 'string') {
        return { plausible: false, reasons: ['value is null or non-string'] };
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
        return { plausible: false, reasons: ['empty string'] };
    }

    // Short length heuristic — a plausible name is usually ≥3 chars
    if (trimmed.length < 3) {
        reasons.push(`too short (${trimmed.length} chars)`);
    }

    // Tokenize on whitespace
    const rawTokens = trimmed.split(/\s+/);
    const tokens = rawTokens.map(stripPunct).filter(t => t.length > 0);
    if (tokens.length === 0) {
        return { plausible: false, reasons: ['no alphanumeric tokens'] };
    }

    // Minimum token count: honorifics (Mr./Mrs./Dr.) plus a single name
    // are real, so ≥2 tokens is the floor. A single-token "Brown" could be
    // real but we can't disambiguate from an OCR fragment — flag for review.
    if (tokens.length < 2) {
        reasons.push(`only ${tokens.length} token — could be valid single-name but ambiguous`);
    }

    // Any label word present → bled from a neighbor field
    const lowerTokens = tokens.map(t => t.toLowerCase().replace(/\.$/, ''));
    const hitLabels = lowerTokens.filter(t => LABEL_WORDS.has(t));
    if (hitLabels.length > 0) {
        reasons.push(`contains label word(s): ${hitLabels.join(', ')}`);
    }

    // Leading token: should start with a letter, should not be a number,
    // should not be an obvious OCR fragment.
    const leading = tokens[0];
    if (!/^[A-Za-z]/.test(leading)) {
        reasons.push('leading token is not alphabetic');
    }

    // How many of the tokens look like real name-words?
    // Real name-word = starts with capital, contains only letters + hyphens
    // + apostrophes + period (for initials). Allow at least one token to be
    // capitalized; an all-lowercase name string is usually OCR noise.
    const nameLikeTokens = tokens.filter(t =>
        /^[A-Z][A-Za-z'\-.]{0,40}$/.test(t) && !isLikelyOcrFragment(t)
    );
    if (nameLikeTokens.length === 0) {
        reasons.push('no capitalized name-like tokens');
    }

    // OCR-fragment tokens ratio — if more than half are fragments, garbage
    const fragmentRatio = tokens.filter(isLikelyOcrFragment).length / tokens.length;
    if (fragmentRatio > 0.5) {
        reasons.push(`${Math.round(fragmentRatio * 100)}% of tokens look like OCR fragments`);
    }

    // 4-digit year or date-like patterns anywhere → leaked from date field
    if (/\b(18|19|20)\d{2}\b/.test(trimmed)) {
        reasons.push('contains a 4-digit year (likely leaked from date field)');
    }
    if (/\b\d{1,2}[\/\-]\d{1,2}/.test(trimmed)) {
        reasons.push('contains a date-like pattern');
    }

    // Excessive length — real names rarely exceed ~50 chars
    if (trimmed.length > 60) {
        reasons.push(`excessive length (${trimmed.length} chars) — likely multi-field bleed`);
    }

    // Decision: plausible if we collected zero disqualifying reasons AND
    // at least one name-like token exists.
    const plausible = reasons.length === 0;

    return { plausible, reasons };
}

module.exports = { validateEnslaverName };
