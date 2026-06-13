/**
 * Name + state normalization for entity-resolution blocking.
 *
 * WHY THIS EXISTS: canonical_persons.last_name is dirty — it holds multi-token
 * strings ("Washington Biscoe"), initials ("B. Biscoe"), inverted "Surname,
 * First" forms ("Biscoe, James"), org/partnership names ("Lyon, Briscoe &
 * Lyon"), and ~123K NULLs. primary_state is dirty too ("DC" / "District" /
 * "District of Columbia" all denote one place). Computing metaphone(last_name)
 * directly would be wrong, and the resolver's same/diff-state rule would split
 * real families. This module derives a CLEAN surname (or set of surnames, incl.
 * maiden names) and a canonical state code, in testable JS, so the SQL layer
 * only has to run fuzzystrmatch over already-clean tokens.
 */

const HONORIFICS = new Set([
  'mr','mrs','miss','ms','dr','rev','reverend','gen','general','col','colonel',
  'capt','captain','maj','major','sgt','hon','honorable','sir','lady','mme',
  'madam','madame','master','prof','professor','judge','gov','governor','pres',
]);
const SUFFIXES = new Set([
  'jr','sr','ii','iii','iv','vi','vii','viii','esq','esquire','phd','md','do',
  'deceased','dec','dcd','decd','widow','wid',
]);
// Dangling non-name tokens that show up at the end of OCR'd/truncated names
// ("Ann Biscoe To...") — drop them so the real surname surfaces. Deliberately
// excludes name particles (van/von/de/la) which can legitimately end a surname.
const TRAILING_NOISE = new Set([
  'to','of','the','and','for','by','in','on','at','a','an','or','his','her','my',
]);
// Org / partnership / estate markers — these names are NOT individuals and must
// be excluded from person-vs-person dedup.
const ORG_RE = /(\s&\s|&amp;|\band\b|\bestate of\b|\bestate\b|\bco\.?\b|\bcompany\b|\bfirm\b|\bbank\b|\btrust\b|\bheirs?\b|\bbros\b|\bbrothers\b|\bsons\b|\b& ?co\b|\bassociation\b|\brailroad\b|\brail road\b|\bplantation\b|\bchurch\b|\bparish\b|\bcounty\b|\bdistrict of columbia\b)/i;

// Placeholder / non-surname tokens — first-name-only enslaved records, OCR
// junk, and generic descriptors that must NOT form surname blocks.
const PLACEHOLDER_SURNAME = new Set([
  'unnamed','unknown','name','noname','none','null','na','nn',
  'infant','child','children','baby','boy','girl','son','daughter','wife','widow',
  'man','woman','men','women','male','female','negro','negroe','slave','servant',
  'mulatto','colored','freedman','freedwoman','person','people','family','estate',
  'deceased','sundry','others','etc','ditto','do',
  'given','unknown','unk','illegible','blank','notnamed','notgiven','nogiven',
  'self','same','aforesaid','said','above','unborn','stillborn',
]);

const clean = (tok) => (tok || '').toLowerCase().replace(/[^a-z]/g, '');

export function isOrgName(name) {
  const n = (name || '').trim();
  if (!n) return false;
  // "Lyon, Briscoe & Lyon", "Smith & Sons", "Estate of John Doe", etc.
  return ORG_RE.test(n);
}

// Pull the surname from a free-text personal-name fragment: drop honorifics,
// trailing generational suffixes, and trailing single-letter initials; the
// surname is the last surviving alphabetic token.
function lastAlphaToken(str) {
  if (!str) return null;
  let toks = str.replace(/\([^)]*\)/g, ' ')
    .split(/[\s.]+/).map((t) => t.trim()).filter((t) => /[A-Za-z]/.test(t));
  while (toks.length && HONORIFICS.has(clean(toks[0]))) toks.shift();
  while (toks.length && (SUFFIXES.has(clean(toks[toks.length - 1])) || TRAILING_NOISE.has(clean(toks[toks.length - 1])))) toks.pop();
  while (toks.length > 1 && clean(toks[toks.length - 1]).length === 1) toks.pop();
  if (!toks.length) return null;
  const s = clean(toks[toks.length - 1]);
  return s.length >= 2 ? s : null;
}

/**
 * Derive 1-2 surnames for blocking from (canonical_name, last_name).
 * Returns [] for org names / unparseable. Includes a maiden/aka surname when
 * the name carries one ("Angelica Chew (born Maria Angelica Biscoe)" -> chew + biscoe).
 */
export function deriveSurnames(canonicalName, lastName) {
  const name = (canonicalName || '').trim();
  const out = new Set();
  if (name && isOrgName(name)) return [];

  // maiden / aka surname inside parentheses
  const paren = name.match(/\(([^)]*)\)/);
  if (paren && /\b(born|nee|née|formerly|aka|maiden)\b/i.test(paren[1])) {
    const s = lastAlphaToken(paren[1].replace(/\b(born|nee|née|formerly|aka|maiden)\b/ig, ' '));
    if (s) out.add(s);
  }

  // primary surname. Only emit a surname when the record STRUCTURALLY has one:
  // an inverted "Surname, First", a multi-token "First [Middle] Last", or a
  // populated last_name field. A bare single-token canonical_name with no
  // last_name is a first-name-only record (enslaved-by-first-name) — surname
  // blocking is meaningless for it, so it is DEFERRED to the kinship/cross-source
  // pass and we return no surname here.
  let primary = null;
  const base = name.replace(/\([^)]*\)/g, ' ').trim();
  const baseToks = base.replace(/,/g, ' ').split(/\s+/)
    .filter((t) => /[A-Za-z]/.test(t) && !HONORIFICS.has(clean(t)));
  if (base.includes(',')) {
    const before = base.split(',')[0].trim();
    const beforeToks = before.split(/\s+/).filter(Boolean);
    if (beforeToks.length >= 1 && beforeToks.length <= 2 && !isOrgName(before)) {
      primary = lastAlphaToken(before);
    }
  }
  if (!primary && baseToks.length >= 2) primary = lastAlphaToken(base);
  if (!primary && lastName && !isOrgName(lastName)) primary = lastAlphaToken(lastName);
  // (single-token canonical_name + no last_name -> primary stays null -> deferred)

  if (primary && !PLACEHOLDER_SURNAME.has(primary)) out.add(primary);
  // drop any maiden-name surnames that are placeholders too
  for (const s of [...out]) if (PLACEHOLDER_SURNAME.has(s)) out.delete(s);

  return [...out];
}

// ---- state normalization ----
const STATE_CANON = {
  'al': 'AL', 'alabama': 'AL',
  'ak': 'AK', 'alaska': 'AK',
  'az': 'AZ', 'arizona': 'AZ',
  'ar': 'AR', 'arkansas': 'AR',
  'ca': 'CA', 'california': 'CA',
  'co': 'CO', 'colorado': 'CO',
  'ct': 'CT', 'connecticut': 'CT',
  'de': 'DE', 'delaware': 'DE',
  'dc': 'DC', 'district': 'DC', 'district of columbia': 'DC', 'washington dc': 'DC',
  'washington d c': 'DC', 'washington county': 'DC', 'georgetown': 'DC',
  'fl': 'FL', 'florida': 'FL',
  'ga': 'GA', 'georgia': 'GA',
  'ky': 'KY', 'kentucky': 'KY',
  'la': 'LA', 'louisiana': 'LA',
  'me': 'ME', 'maine': 'ME',
  'md': 'MD', 'maryland': 'MD',
  'ma': 'MA', 'massachusetts': 'MA',
  'mi': 'MI', 'michigan': 'MI',
  'ms': 'MS', 'mississippi': 'MS',
  'mo': 'MO', 'missouri': 'MO',
  'nc': 'NC', 'north carolina': 'NC',
  'nj': 'NJ', 'new jersey': 'NJ',
  'ny': 'NY', 'new york': 'NY',
  'sc': 'SC', 'south carolina': 'SC',
  'tn': 'TN', 'tennessee': 'TN',
  'tx': 'TX', 'texas': 'TX',
  'va': 'VA', 'virginia': 'VA',
  'wv': 'WV', 'west virginia': 'WV',
};

/** Canonical 2-letter-ish state code, or null if unknown/empty. */
export function normalizeState(s) {
  if (!s) return null;
  const k = String(s).toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!k) return null;
  if (STATE_CANON[k]) return STATE_CANON[k];
  // "Georgetown, DC" / "Charles Co MD" style — try the trailing token(s)
  const toks = k.split(' ');
  for (let n = Math.min(3, toks.length); n >= 1; n--) {
    const tail = toks.slice(toks.length - n).join(' ');
    if (STATE_CANON[tail]) return STATE_CANON[tail];
  }
  return null;
}
