'use strict';

/**
 * GarbageDetector - Validates discovered parent results against branch context.
 *
 * Catches impossible genealogical results by running a series of checks
 * (ethnic consistency, geographic plausibility, temporal plausibility,
 * name consistency, source credibility) and producing an accept / flag / reject
 * recommendation that the ancestor climber uses to decide whether to queue
 * a discovered parent for further climbing.
 *
 * Pure JavaScript, no external dependencies.
 */

// ---------------------------------------------------------------------------
// Surname-origin pattern lists
// ---------------------------------------------------------------------------

/** @type {Record<string, RegExp[]>} */
const SURNAME_PATTERNS = {
  italian: [
    /(?:ino|ini|elli|etti|ucci|olli|acci|one|oni|aro|ari|ese|isi|otti|uzzi|ola|ano)$/i,
    /^(?:di|de|del|della|dello|dei|degli|dalle?)[\s]/i,
  ],
  spanish: [
    /(?:ez|az|iz|oz|uz)$/i,            // Gonzalez, Diaz, Ruiz ...
    /(?:ero|era|illo|illa|ito|ita)$/i,  // Romero, Castillo ...
    /^(?:de\sla|del|de)[\s]/i,
  ],
  eastern_european: [
    /(?:sky|ski|ska|ski|wicz|owicz|enko|chuk|ovich|evich|ovic|escu|ova|enko|uk|ak|ek|ik)$/i,
    /^(?:van\s|von\s)/i,
  ],
  jewish_ashkenazi: [
    /(?:berg|stein|feld|man|baum|blum|gold|silver|witz|thal|heim|blatt|stern)$/i,
    /(?:owitz|owicz|inski|insky)$/i,
  ],
  chinese: [
    /^(?:wang|li|zhang|liu|chen|yang|huang|zhao|wu|zhou|xu|sun|ma|zhu|hu|guo|he|lin|luo|gao|liang|zheng|xie|tang|han|cao|deng|xiao|feng|cheng|cai|peng|pan|yuan|yu|dong|lu|wei|su|jiang|ye|du|shi|lv|dai|qin|xu|fan|wen|fang|yin|qin|lu|ren|shen|xiong|jin|bai|tao|xie|zou|tan|lei|cui|qiao|wan|kang|jia|duan|zhong|hou|meng|long|shi|liao|qi|shao|mao|zeng|he|gong|cheng|niu|mo)$/i,
  ],
  irish: [
    /^(?:O'|Mc|Mac)/i,
    /(?:agh|ough|eigh)$/i,
  ],
  african_american: [
    // Commonly-imposed slaveholder surnames — not a reliable ethnic marker on their
    // own, but useful when combined with geographic/temporal context.
    /^(?:washington|jefferson|freeman|brown|johnson|williams|jackson|davis|smith|jones|wilson|harris|robinson|taylor|thomas|moore|martin|white|thompson|anderson|walker|green|lewis|hall|young|king|wright|scott|adams|hill|baker|carter|mitchell|perez|roberts|turner|phillips|campbell|parker|evans|edwards|collins|stewart|morris|reed|cook|morgan|bell|murphy|bailey|rivera|cooper|richardson|cox|howard|ward|torres|peterson|gray|ramirez|james|watson|brooks|kelly|sanders|price|bennett|wood|barnes|ross|henderson|coleman|jenkins|perry|powell|long|patterson|hughes|flores|butler|simmons|foster|gonzales|bryant|alexander|russell|griffin|diaz|hayes)$/i,
  ],
  english: [
    /(?:son|ton|ham|ford|ley|bury|worth|field|wood|well|land|shire|bridge|croft|stead|wick|gate|dale|stone|church|mill)$/i,
  ],
  german: [
    /(?:mann|burg|haus|hoff|stein|wald|bach|bauer|berg|brunner|feld|rich|hart)$/i,
    /^(?:von|van)[\s]/i,
  ],
  french: [
    /(?:eau|eux|ault|ard|ier|iere|ois|oise|ain|aine|eur|eux|oux)$/i,
    /^(?:le|la|du|des|de)[\s]/i,
  ],
  scandinavian: [
    /(?:sson|ssen|sen|son|strom|lund|gren|quist|qvist|berg|dahl|holm)$/i,
  ],
};

/**
 * Groups of ethnic origins that are considered compatible / overlapping.
 * If a child and parent both fall within the same group, they pass the
 * ethnic consistency check even when the specific labels differ.
 */
const COMPATIBLE_GROUPS = [
  new Set(['english', 'irish', 'scottish', 'french', 'german', 'scandinavian']),
  new Set(['eastern_european', 'jewish_ashkenazi', 'german']),
  new Set(['italian', 'spanish', 'french']),
  new Set(['african_american', 'english', 'irish', 'french']),  // post-slavery naming
];

/**
 * Maps branch context types (from BranchClassifier) to expected surname origins.
 */
const BRANCH_TO_ORIGINS = {
  eastern_european_jewish: new Set(['eastern_european', 'jewish_ashkenazi', 'german']),
  eastern_european: new Set(['eastern_european', 'jewish_ashkenazi', 'german']),
  african_american_pre1870: new Set(['african_american', 'english', 'irish', 'french']),
  african_american_post1870: new Set(['african_american', 'english', 'irish', 'french']),
  african_american: new Set(['african_american', 'english', 'irish', 'french']),
  irish_immigrant: new Set(['irish', 'english']),
  french_louisiana: new Set(['french', 'spanish']),
  colonial_american: new Set(['english', 'irish', 'french', 'german', 'scandinavian']),
  generic_american: new Set(['english', 'irish', 'french', 'german', 'scandinavian', 'italian', 'eastern_european', 'jewish_ashkenazi']),
  western_european: new Set(['english', 'irish', 'french', 'german', 'scandinavian']),
  southern_european: new Set(['italian', 'spanish', 'french']),
  east_asian: new Set(['chinese']),
};

// ---------------------------------------------------------------------------
// Geographic helpers
// ---------------------------------------------------------------------------

/**
 * Coarse continent / region for a place string.
 * @param {string|null} place
 * @returns {string|null}
 */
function regionOf(place) {
  if (!place) return null;
  const p = place.toLowerCase();

  // US states / territories
  if (/\b(?:united states|u\.?s\.?a?|alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)\b/.test(p)) {
    return 'north_america';
  }
  if (/\b(?:canada|ontario|quebec|british columbia|alberta|manitoba|saskatchewan|nova scotia|newfoundland|mexico)\b/.test(p)) return 'north_america';
  if (/\b(?:haiti|jamaica|cuba|puerto rico|barbados|trinidad|bahamas|dominican|caribbean|martinique|guadeloupe|antigua|st\.?\s?lucia|grenada)\b/.test(p)) return 'caribbean';
  if (/\b(?:brazil|argentina|colombia|peru|chile|venezuela|ecuador|bolivia|paraguay|uruguay|guyana|suriname)\b/.test(p)) return 'south_america';

  // Africa
  if (/\b(?:nigeria|ghana|senegal|sierra leone|liberia|ivory coast|cameroon|congo|angola|mozambique|kenya|tanzania|south africa|ethiopia|somalia|madagascar|benin|togo|mali|guinea|gambia|africa)\b/.test(p)) return 'africa';

  // Eastern Europe / Russia
  if (/\b(?:russia|ukraine|poland|belarus|romania|hungary|czech|slovakia|serbia|croatia|bosnia|bulgaria|moldova|latvia|lithuania|estonia|kiev|kyiv|moscow|st\.?\s?petersburg|warsaw|minsk|bucharest|odessa|lviv|krakow)\b/.test(p)) return 'eastern_europe';

  // Western / Southern Europe
  if (/\b(?:england|wales|scotland|ireland|france|germany|netherlands|belgium|switzerland|austria|spain|portugal|italy|greece|denmark|sweden|norway|finland|london|paris|berlin|rome|dublin|amsterdam|vienna|lisbon|madrid|milan)\b/.test(p)) return 'western_europe';

  // Middle East
  if (/\b(?:ottoman|turkey|syria|lebanon|palestine|israel|iraq|iran|persia|jordan|egypt|yemen|saudi|arabia)\b/.test(p)) return 'middle_east';

  // East Asia
  if (/\b(?:china|japan|korea|taiwan|hong kong|beijing|shanghai|tokyo|seoul)\b/.test(p)) return 'east_asia';

  // South / SE Asia
  if (/\b(?:india|pakistan|bangladesh|sri lanka|nepal|vietnam|thailand|philippines|indonesia|myanmar|cambodia|malaysia|singapore)\b/.test(p)) return 'south_asia';

  return null;
}

/**
 * Known plausible migration corridors (directional: from → to).
 * @type {Set<string>}
 */
const MIGRATION_CORRIDORS = new Set([
  'western_europe→north_america',
  'eastern_europe→north_america',
  'eastern_europe→western_europe',
  'africa→north_america',        // forced migration
  'africa→caribbean',            // forced migration
  'caribbean→north_america',
  'south_america→north_america',
  'middle_east→north_america',
  'east_asia→north_america',
  'south_asia→north_america',
  'western_europe→caribbean',
  'western_europe→south_america',
  'eastern_europe→south_america',
  'middle_east→western_europe',
  'south_asia→western_europe',
  'caribbean→western_europe',
]);

/**
 * Checks whether moving from parentRegion to childRegion is a plausible
 * migration corridor.
 * @param {string} parentRegion
 * @param {string} childRegion
 * @returns {boolean}
 */
function isPlausibleMigration(parentRegion, childRegion) {
  if (parentRegion === childRegion) return true;
  return MIGRATION_CORRIDORS.has(`${parentRegion}→${childRegion}`);
}

// ---------------------------------------------------------------------------
// Name helpers
// ---------------------------------------------------------------------------

/**
 * Detect likely ethnic origin(s) from a surname.
 * Returns an array of matched origin labels sorted by specificity.
 * @param {string} surname
 * @returns {string[]}
 */
function detectSurnameOrigins(surname) {
  if (!surname) return [];
  const results = [];
  for (const [origin, patterns] of Object.entries(SURNAME_PATTERNS)) {
    for (const rx of patterns) {
      if (rx.test(surname)) {
        results.push(origin);
        break; // one match per origin is enough
      }
    }
  }
  return results;
}

/**
 * Extract the surname (last token) from a full name string.
 * @param {string} fullName
 * @returns {string}
 */
function extractSurname(fullName) {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1];
}

/**
 * Checks whether a name looks garbled — contains '?', very short, etc.
 * @param {string} name
 * @returns {boolean}
 */
function isGarbledName(name) {
  if (!name) return true;
  const trimmed = name.trim();
  if (trimmed.includes('?')) return true;
  if (trimmed.length <= 2) return true;
  // Single character followed by a period (e.g. "J.")
  if (/^[A-Za-z]\.?$/.test(trimmed)) return true;
  return false;
}

/**
 * Check whether two origin sets are completely disjoint, accounting for
 * COMPATIBLE_GROUPS overlap.
 * @param {string[]} originsA
 * @param {string[]} originsB
 * @returns {boolean} true if they share no plausible overlap
 */
function areOriginsDisjoint(originsA, originsB) {
  if (originsA.length === 0 || originsB.length === 0) return false; // can't tell
  // Direct overlap
  for (const a of originsA) {
    if (originsB.includes(a)) return false;
  }
  // Overlap through compatible groups
  for (const group of COMPATIBLE_GROUPS) {
    const aInGroup = originsA.some(o => group.has(o));
    const bInGroup = originsB.some(o => group.has(o));
    if (aInGroup && bInGroup) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// GarbageDetector
// ---------------------------------------------------------------------------

class GarbageDetector {
  /**
   * Validate a discovered parent against the child and branch context.
   *
   * Runs five ordered checks (ethnic consistency, geographic plausibility,
   * temporal plausibility, name consistency, source credibility) and returns
   * a recommendation for the ancestor climber.
   *
   * @param {object} child
   *   @param {string}  child.name        - Full name of the child person.
   *   @param {number}  [child.birth_year] - Four-digit birth year (may be null).
   *   @param {string}  [child.birth_place] - Free-text birth location.
   *   @param {string[]} [child.locations]  - Additional known locations.
   *
   * @param {object} discoveredParent
   *   @param {string}  discoveredParent.parentName      - Full name as found.
   *   @param {number}  [discoveredParent.parentBirthYear] - Four-digit year.
   *   @param {string}  [discoveredParent.parentBirthPlace] - Free-text birth location.
   *   @param {string}  discoveredParent.relationship    - 'father' | 'mother'.
   *   @param {number}  discoveredParent.confidence      - 0-1 confidence from source.
   *   @param {string}  [discoveredParent.discoveryMethod] - How the parent was found.
   *   @param {string}  [discoveredParent.sourceUrl]     - Provenance URL.
   *
   * @param {object} branchContext
   *   @param {string} branchContext.type       - e.g. 'eastern_european_jewish'.
   *   @param {number} [branchContext.confidence] - 0-1 confidence of classification.
   *
   * @returns {{
   *   passed: boolean,
   *   checks: Array<{check: string, passed: boolean, severity: string, detail: string}>,
   *   recommendation: 'accept'|'flag_for_review'|'reject',
   *   adjustedConfidence: number,
   *   reason: string
   * }}
   */
  validate(child, discoveredParent, branchContext) {
    const checks = [];
    let confidencePenalty = 0;
    let dominated = false;     // a CRITICAL check failed → reject
    let flagged = false;       // a WARNING-level check failed → flag

    // -----------------------------------------------------------------------
    // 1. Ethnic Consistency (CRITICAL)
    // -----------------------------------------------------------------------
    const ethnicResult = this._checkEthnicConsistency(child, discoveredParent, branchContext);
    checks.push(ethnicResult);
    if (!ethnicResult.passed) {
      if (ethnicResult.severity === 'critical') dominated = true;
      else flagged = true;
    }

    // -----------------------------------------------------------------------
    // 2. Geographic Plausibility
    // -----------------------------------------------------------------------
    const geoResult = this._checkGeographicPlausibility(child, discoveredParent);
    checks.push(geoResult);
    if (!geoResult.passed) {
      if (geoResult.severity === 'critical') dominated = true;
      else flagged = true;
    }

    // -----------------------------------------------------------------------
    // 3. Temporal Plausibility
    // -----------------------------------------------------------------------
    const tempResult = this._checkTemporalPlausibility(child, discoveredParent);
    checks.push(tempResult);
    if (!tempResult.passed) {
      if (tempResult.severity === 'critical') dominated = true;
      else flagged = true;
    }

    // -----------------------------------------------------------------------
    // 4. Name Consistency
    // -----------------------------------------------------------------------
    const nameResult = this._checkNameConsistency(child, discoveredParent);
    checks.push(nameResult);
    if (!nameResult.passed) {
      if (nameResult.severity === 'critical') dominated = true;
      else flagged = true;
      if (nameResult.penalty) confidencePenalty += nameResult.penalty;
    }

    // -----------------------------------------------------------------------
    // 5. Source Credibility Discount
    // -----------------------------------------------------------------------
    const sourceResult = this._checkSourceCredibility(child, discoveredParent);
    checks.push(sourceResult);
    if (!sourceResult.passed) {
      flagged = true;
      if (sourceResult.penalty) confidencePenalty += sourceResult.penalty;
    }

    // -----------------------------------------------------------------------
    // Compute final recommendation
    // -----------------------------------------------------------------------
    const baseConfidence = discoveredParent.confidence ?? 0.5;
    const adjustedConfidence = Math.max(0, Math.min(1, baseConfidence - confidencePenalty));

    let recommendation;
    let reason;

    if (dominated) {
      recommendation = 'reject';
      const criticals = checks.filter(c => !c.passed && c.severity === 'critical');
      reason = criticals.map(c => c.detail).join('; ');
    } else if (flagged || adjustedConfidence < 0.40) {
      recommendation = 'flag_for_review';
      const warnings = checks.filter(c => !c.passed);
      reason = warnings.map(c => c.detail).join('; ');
    } else {
      recommendation = 'accept';
      reason = 'All checks passed';
    }

    const passed = recommendation !== 'reject';

    return {
      passed,
      checks,
      recommendation,
      adjustedConfidence: Math.round(adjustedConfidence * 1000) / 1000,
      reason,
    };
  }

  // -------------------------------------------------------------------------
  // Internal check methods
  // -------------------------------------------------------------------------

  /**
   * Check 1 - Ethnic consistency between child branch context and discovered
   * parent's surname origin.
   *
   * Participant-provided parents are NEVER rejected by this check.
   *
   * @private
   * @param {object} child
   * @param {object} discoveredParent
   * @param {object} branchContext
   * @returns {{check: string, passed: boolean, severity: string, detail: string}}
   */
  _checkEthnicConsistency(child, discoveredParent, branchContext) {
    const check = 'ethnic_consistency';

    // Participant-provided parents are always exempt
    const method = (discoveredParent.discoveryMethod || '').toLowerCase();
    if (method === 'participant_family_tree' || method === 'participant_provided') {
      return { check, passed: true, severity: 'info', detail: 'Participant-provided parent; ethnic check skipped' };
    }

    const parentSurname = extractSurname(discoveredParent.parentName);
    const parentOrigins = detectSurnameOrigins(parentSurname);
    if (parentOrigins.length === 0) {
      return { check, passed: true, severity: 'info', detail: `Could not determine ethnic origin for surname "${parentSurname}"` };
    }

    // Determine expected origins from branch context
    const branchType = (branchContext.type || '').toLowerCase().replace(/[\s-]+/g, '_');
    const expectedOrigins = BRANCH_TO_ORIGINS[branchType];

    if (!expectedOrigins) {
      // Also try child surname as fallback
      const childSurname = extractSurname(child.name);
      const childOrigins = detectSurnameOrigins(childSurname);
      if (childOrigins.length === 0) {
        return { check, passed: true, severity: 'info', detail: 'Insufficient data for ethnic consistency check' };
      }
      // Compare child origins vs parent origins
      if (areOriginsDisjoint(childOrigins, parentOrigins)) {
        return {
          check,
          passed: false,
          severity: 'critical',
          detail: `Parent surname "${parentSurname}" (${parentOrigins.join('/')}) is ethnically inconsistent with child surname "${childSurname}" (${childOrigins.join('/')})`,
        };
      }
      return { check, passed: true, severity: 'info', detail: `Surname origins are compatible: parent=${parentOrigins.join('/')}, child=${childOrigins.join('/')}` };
    }

    // Check whether any parent origin overlaps with expected branch origins
    const expectedArr = [...expectedOrigins];
    if (areOriginsDisjoint(expectedArr, parentOrigins)) {
      return {
        check,
        passed: false,
        severity: 'critical',
        detail: `Parent surname "${parentSurname}" (${parentOrigins.join('/')}) is ethnically inconsistent with branch "${branchContext.type}" (expects ${expectedArr.join('/')})`,
      };
    }

    return {
      check,
      passed: true,
      severity: 'info',
      detail: `Parent surname "${parentSurname}" (${parentOrigins.join('/')}) is compatible with branch "${branchContext.type}"`,
    };
  }

  /**
   * Check 2 - Geographic plausibility: does the parent's birth place make
   * sense given the child's birth place?
   *
   * @private
   * @param {object} child
   * @param {object} discoveredParent
   * @returns {{check: string, passed: boolean, severity: string, detail: string}}
   */
  _checkGeographicPlausibility(child, discoveredParent) {
    const check = 'geographic_plausibility';

    const childRegion = regionOf(child.birth_place);
    const parentRegion = regionOf(discoveredParent.parentBirthPlace);

    if (!childRegion || !parentRegion) {
      return { check, passed: true, severity: 'info', detail: 'Insufficient location data for geographic check' };
    }

    if (childRegion === parentRegion) {
      return { check, passed: true, severity: 'info', detail: `Same region: ${childRegion}` };
    }

    if (isPlausibleMigration(parentRegion, childRegion)) {
      return { check, passed: true, severity: 'info', detail: `Plausible migration corridor: ${parentRegion} → ${childRegion}` };
    }

    return {
      check,
      passed: false,
      severity: 'critical',
      detail: `No plausible migration corridor from ${parentRegion} to ${childRegion} (parent born "${discoveredParent.parentBirthPlace}", child born "${child.birth_place}")`,
    };
  }

  /**
   * Check 3 - Temporal plausibility of parent-child birth year gap.
   *
   * Hard rejects:
   *   - Parent born after child
   *   - Parent born less than 12 years before child
   * Soft flags:
   *   - Parent born more than 60 years before child
   *
   * @private
   * @param {object} child
   * @param {object} discoveredParent
   * @returns {{check: string, passed: boolean, severity: string, detail: string}}
   */
  _checkTemporalPlausibility(child, discoveredParent) {
    const check = 'temporal_plausibility';

    const childYear = child.birth_year;
    const parentYear = discoveredParent.parentBirthYear;

    if (!childYear || !parentYear) {
      return { check, passed: true, severity: 'info', detail: 'Missing birth year(s); temporal check skipped' };
    }

    const gap = childYear - parentYear;

    if (gap < 0) {
      return {
        check,
        passed: false,
        severity: 'critical',
        detail: `Parent born ${parentYear} AFTER child born ${childYear} — impossible`,
      };
    }

    if (gap < 12) {
      return {
        check,
        passed: false,
        severity: 'critical',
        detail: `Parent born only ${gap} years before child (${parentYear} → ${childYear}) — biologically implausible`,
      };
    }

    if (gap > 60) {
      return {
        check,
        passed: false,
        severity: 'warning',
        detail: `Parent born ${gap} years before child (${parentYear} → ${childYear}) — unusually large gap`,
      };
    }

    return { check, passed: true, severity: 'info', detail: `Birth year gap of ${gap} years is plausible` };
  }

  /**
   * Check 4 - Name consistency between child and discovered parent.
   *
   * For fathers: surname should match or share cultural origin.
   * For mothers: maiden name may differ, but cultural origin should be plausible.
   * Single-word / partial names are flagged.
   *
   * @private
   * @param {object} child
   * @param {object} discoveredParent
   * @returns {{check: string, passed: boolean, severity: string, detail: string, penalty?: number}}
   */
  _checkNameConsistency(child, discoveredParent) {
    const check = 'name_consistency';
    const parentName = (discoveredParent.parentName || '').trim();
    const parentParts = parentName.split(/\s+/);

    // Flag single-word / very short names
    if (parentParts.length < 2) {
      return {
        check,
        passed: false,
        severity: 'warning',
        detail: `Parent name "${parentName}" appears incomplete (single word / no surname)`,
        penalty: 0.15,
      };
    }

    // Garbled name check
    if (isGarbledName(parentName)) {
      return {
        check,
        passed: false,
        severity: 'warning',
        detail: `Parent name "${parentName}" looks garbled or truncated`,
        penalty: 0.20,
      };
    }

    const childSurname = extractSurname(child.name);
    const parentSurname = extractSurname(discoveredParent.parentName);
    const relationship = (discoveredParent.relationship || '').toLowerCase();

    if (relationship === 'father') {
      // Father's surname should match child's, or at least share cultural origin
      if (childSurname.toLowerCase() === parentSurname.toLowerCase()) {
        return { check, passed: true, severity: 'info', detail: 'Father surname matches child' };
      }
      // Check cultural compatibility
      const childOrigins = detectSurnameOrigins(childSurname);
      const parentOrigins = detectSurnameOrigins(parentSurname);
      if (childOrigins.length > 0 && parentOrigins.length > 0 && areOriginsDisjoint(childOrigins, parentOrigins)) {
        return {
          check,
          passed: false,
          severity: 'warning',
          detail: `Father surname "${parentSurname}" differs from child's "${childSurname}" and origins are disjoint (${parentOrigins.join('/')} vs ${childOrigins.join('/')})`,
          penalty: 0.10,
        };
      }
      // Surname differs but origins compatible or unknown
      return { check, passed: true, severity: 'info', detail: `Father surname "${parentSurname}" differs from child's "${childSurname}" but origins are compatible or undetermined` };
    }

    // Mother — maiden name typically differs, just check cultural origin plausibility
    const childOrigins = detectSurnameOrigins(childSurname);
    const parentOrigins = detectSurnameOrigins(parentSurname);
    if (childOrigins.length > 0 && parentOrigins.length > 0 && areOriginsDisjoint(childOrigins, parentOrigins)) {
      return {
        check,
        passed: false,
        severity: 'warning',
        detail: `Mother surname "${parentSurname}" origin (${parentOrigins.join('/')}) seems inconsistent with child's "${childSurname}" origin (${childOrigins.join('/')})`,
        penalty: 0.10,
      };
    }

    return { check, passed: true, severity: 'info', detail: `Name consistency check passed for ${relationship || 'parent'}` };
  }

  /**
   * Check 5 - Source credibility discount.
   *
   * Applies confidence penalties for:
   *   - FamilySearch record-search results for non-US ancestors (-0.30)
   *   - Garbled parent names (-0.20)
   *
   * @private
   * @param {object} child
   * @param {object} discoveredParent
   * @returns {{check: string, passed: boolean, severity: string, detail: string, penalty?: number}}
   */
  _checkSourceCredibility(child, discoveredParent) {
    const check = 'source_credibility';
    let penalty = 0;
    const details = [];

    // FamilySearch record search for non-US ancestors
    const sourceUrl = (discoveredParent.sourceUrl || '').toLowerCase();
    const isFamilySearchRecord = sourceUrl.includes('familysearch.org') &&
      (sourceUrl.includes('/search/') || sourceUrl.includes('/record/'));

    if (isFamilySearchRecord) {
      const childRegion = regionOf(child.birth_place);
      if (childRegion && childRegion !== 'north_america') {
        penalty += 0.30;
        details.push(`FamilySearch record search for non-US ancestor (${child.birth_place}) — confidence penalty -0.30`);
      }
    }

    // Garbled parent name
    if (isGarbledName(discoveredParent.parentName)) {
      penalty += 0.20;
      details.push(`Garbled parent name "${discoveredParent.parentName}" — confidence penalty -0.20`);
    }

    if (penalty > 0) {
      return {
        check,
        passed: false,
        severity: 'warning',
        detail: details.join('; '),
        penalty,
      };
    }

    return { check, passed: true, severity: 'info', detail: 'Source credibility OK' };
  }
}

module.exports = GarbageDetector;
