/**
 * BranchClassifier Service
 *
 * Classifies an ancestor into an ethnic/geographic context type to drive
 * source selection and garbage detection in the ancestor climbing system.
 *
 * Context types determine which sources are queried next (e.g. an
 * eastern_european_jewish ancestor should hit JRI-Poland, not Ancestry),
 * and which "impossible" patterns to flag (e.g. a pre-1870 Black ancestor
 * appearing in a Swedish parish register).
 *
 * Pure JavaScript — no external dependencies.
 */

'use strict';

// ---------------------------------------------------------------------------
//  Context type constants
// ---------------------------------------------------------------------------

const CONTEXT_TYPES = Object.freeze({
    EASTERN_EUROPEAN_JEWISH:   'eastern_european_jewish',
    AFRICAN_AMERICAN_PRE1870:  'african_american_pre1870',
    AFRICAN_AMERICAN_POST1870: 'african_american_post1870',
    IRISH_IMMIGRANT:           'irish_immigrant',
    FRENCH_LOUISIANA:          'french_louisiana',
    COLONIAL_AMERICAN:         'colonial_american',
    GENERIC_AMERICAN:          'generic_american',
    EASTERN_EUROPEAN:          'eastern_european',
    WESTERN_EUROPEAN:          'western_european',
    UNKNOWN:                   'unknown',
});

// ---------------------------------------------------------------------------
//  Surname pattern dictionaries
//  Each entry: { pattern: RegExp, weight: Number }
//  Patterns are tested against the LAST name (case-insensitive).
// ---------------------------------------------------------------------------

const SURNAME_PATTERNS = {
    // ---- Jewish / Ashkenazi ------------------------------------------------
    [CONTEXT_TYPES.EASTERN_EUROPEAN_JEWISH]: [
        // Suffixes
        { pattern: /stein$/i,   weight: 0.35 },
        { pattern: /berg$/i,    weight: 0.30 },
        { pattern: /witz$/i,    weight: 0.40 },
        { pattern: /vich$/i,    weight: 0.20 },
        { pattern: /sky$/i,     weight: 0.15 },
        { pattern: /ski$/i,     weight: 0.10 },
        { pattern: /baum$/i,    weight: 0.40 },
        { pattern: /blum$/i,    weight: 0.35 },
        { pattern: /feld$/i,    weight: 0.30 },
        { pattern: /thal$/i,    weight: 0.30 },
        { pattern: /zweig$/i,   weight: 0.40 },
        { pattern: /stamm$/i,   weight: 0.25 },
        // Prefixes
        { pattern: /^gold/i,    weight: 0.30 },
        { pattern: /^silver/i,  weight: 0.30 },
        { pattern: /^rosen/i,   weight: 0.35 },
        { pattern: /^green/i,   weight: 0.10 },
        { pattern: /^gruen/i,   weight: 0.30 },
        { pattern: /^gr[uü]n/i, weight: 0.30 },
        { pattern: /^eisen/i,   weight: 0.35 },
        { pattern: /^ayzen/i,   weight: 0.40 },
        { pattern: /^lieb/i,    weight: 0.25 },
        { pattern: /^wein/i,    weight: 0.25 },
        { pattern: /^schoen/i,  weight: 0.25 },
        { pattern: /^sch[oö]n/i,weight: 0.25 },
        // Compound patterns
        { pattern: /mann$/i,    weight: 0.15 },
        { pattern: /man$/i,     weight: 0.10 },
        { pattern: /heimer$/i,  weight: 0.25 },
        { pattern: /berger$/i,  weight: 0.25 },
        { pattern: /owitz$/i,   weight: 0.40 },
        { pattern: /owicz$/i,   weight: 0.35 },
        { pattern: /ovich$/i,   weight: 0.25 },
        // Known Jewish names
        { pattern: /^cohen$/i,       weight: 0.50 },
        { pattern: /^kohn$/i,        weight: 0.45 },
        { pattern: /^cohn$/i,        weight: 0.45 },
        { pattern: /^kaplan$/i,      weight: 0.45 },
        { pattern: /^levy$/i,        weight: 0.40 },
        { pattern: /^levi$/i,        weight: 0.45 },
        { pattern: /^levin$/i,       weight: 0.40 },
        { pattern: /^levine$/i,      weight: 0.40 },
        { pattern: /^levinson$/i,    weight: 0.45 },
        { pattern: /^rabinowitz$/i,  weight: 0.55 },
        { pattern: /^horowitz$/i,    weight: 0.50 },
        { pattern: /^abramowitz$/i,  weight: 0.50 },
        { pattern: /^moskowitz$/i,   weight: 0.50 },
        { pattern: /^shapiro$/i,     weight: 0.45 },
        { pattern: /^schwartz$/i,    weight: 0.30 },
    ],

    // ---- Irish -------------------------------------------------------------
    [CONTEXT_TYPES.IRISH_IMMIGRANT]: [
        { pattern: /^o'/i,      weight: 0.40 },
        { pattern: /^mc/i,      weight: 0.25 },
        { pattern: /^mac/i,     weight: 0.20 },
        { pattern: /agh$/i,     weight: 0.25 },
        { pattern: /ane$/i,     weight: 0.10 },
        { pattern: /igan$/i,    weight: 0.30 },
        { pattern: /ahan$/i,    weight: 0.30 },
        { pattern: /elly$/i,    weight: 0.15 },
        { pattern: /arty$/i,    weight: 0.15 },
        { pattern: /^fitz/i,    weight: 0.30 },
        { pattern: /^kil/i,     weight: 0.15 },
        { pattern: /^mul/i,     weight: 0.10 },
        { pattern: /ogue$/i,    weight: 0.25 },
        { pattern: /^don[ao]/i, weight: 0.10 },
        // Common Irish surnames
        { pattern: /^murphy$/i,     weight: 0.30 },
        { pattern: /^kelly$/i,      weight: 0.20 },
        { pattern: /^sullivan$/i,   weight: 0.35 },
        { pattern: /^walsh$/i,      weight: 0.25 },
        { pattern: /^byrne$/i,      weight: 0.35 },
        { pattern: /^ryan$/i,       weight: 0.20 },
        { pattern: /^gallagher$/i,  weight: 0.35 },
        { pattern: /^doherty$/i,    weight: 0.35 },
        { pattern: /^brennan$/i,    weight: 0.30 },
        { pattern: /^burke$/i,      weight: 0.25 },
        { pattern: /^casey$/i,      weight: 0.20 },
        { pattern: /^connolly$/i,   weight: 0.30 },
        { pattern: /^doyle$/i,      weight: 0.30 },
        { pattern: /^duffy$/i,      weight: 0.30 },
        { pattern: /^fitzgerald$/i, weight: 0.35 },
        { pattern: /^flanagan$/i,   weight: 0.35 },
        { pattern: /^flynn$/i,      weight: 0.30 },
        { pattern: /^kavanagh$/i,   weight: 0.35 },
        { pattern: /^kennedy$/i,    weight: 0.15 },
        { pattern: /^lynch$/i,      weight: 0.20 },
        { pattern: /^mccarthy$/i,   weight: 0.35 },
        { pattern: /^mcnamara$/i,   weight: 0.35 },
        { pattern: /^moran$/i,      weight: 0.25 },
        { pattern: /^nolan$/i,      weight: 0.30 },
        { pattern: /^quinn$/i,      weight: 0.25 },
        { pattern: /^regan$/i,      weight: 0.25 },
        { pattern: /^shea$/i,       weight: 0.30 },
        { pattern: /^sheridan$/i,   weight: 0.30 },
        { pattern: /^sweeney$/i,    weight: 0.30 },
    ],

    // ---- Eastern European (non-Jewish) ------------------------------------
    [CONTEXT_TYPES.EASTERN_EUROPEAN]: [
        { pattern: /enko$/i,    weight: 0.40 },
        { pattern: /chuk$/i,    weight: 0.40 },
        { pattern: /czuk$/i,    weight: 0.40 },
        { pattern: /ova$/i,     weight: 0.25 },
        { pattern: /ovich$/i,   weight: 0.30 },
        { pattern: /evich$/i,   weight: 0.35 },
        { pattern: /wski$/i,    weight: 0.30 },
        { pattern: /owski$/i,   weight: 0.35 },
        { pattern: /ewski$/i,   weight: 0.35 },
        { pattern: /czyk$/i,    weight: 0.40 },
        { pattern: /czak$/i,    weight: 0.35 },
        { pattern: /iak$/i,     weight: 0.20 },
        { pattern: /yak$/i,     weight: 0.20 },
        { pattern: /uk$/i,      weight: 0.15 },
        { pattern: /yk$/i,      weight: 0.15 },
        { pattern: /ak$/i,      weight: 0.10 },
        { pattern: /ek$/i,      weight: 0.10 },
        { pattern: /ik$/i,      weight: 0.10 },
        { pattern: /ovic$/i,    weight: 0.30 },
        { pattern: /evic$/i,    weight: 0.30 },
        { pattern: /ic$/i,      weight: 0.10 },
        { pattern: /sky$/i,     weight: 0.15 },
        { pattern: /ski$/i,     weight: 0.15 },
        { pattern: /ska$/i,     weight: 0.20 },
        { pattern: /ova$/i,     weight: 0.20 },
        { pattern: /ovna$/i,    weight: 0.30 },
        { pattern: /escu$/i,    weight: 0.40 },
        { pattern: /eanu$/i,    weight: 0.35 },
        { pattern: /enko$/i,    weight: 0.40 },
        { pattern: /iuk$/i,     weight: 0.35 },
        { pattern: /ko$/i,      weight: 0.10 },
        // Specific surnames
        { pattern: /^petrov/i,      weight: 0.30 },
        { pattern: /^ivanov/i,      weight: 0.30 },
        { pattern: /^kovalenko$/i,  weight: 0.40 },
        { pattern: /^shevchenko$/i, weight: 0.45 },
        { pattern: /^bondarenko$/i, weight: 0.40 },
        { pattern: /^kowalski$/i,   weight: 0.35 },
        { pattern: /^nowak$/i,      weight: 0.30 },
        { pattern: /^wojciechowski$/i, weight: 0.40 },
        { pattern: /^popov$/i,      weight: 0.30 },
        { pattern: /^novak$/i,      weight: 0.25 },
    ],

    // ---- French / Louisiana -----------------------------------------------
    [CONTEXT_TYPES.FRENCH_LOUISIANA]: [
        { pattern: /^le /i,     weight: 0.25 },
        { pattern: /^le[a-z]/i, weight: 0.15 },
        { pattern: /^la /i,     weight: 0.25 },
        { pattern: /^la[a-z]/i, weight: 0.10 },
        { pattern: /^de /i,     weight: 0.20 },
        { pattern: /^de[a-z]/i, weight: 0.08 },
        { pattern: /^du /i,     weight: 0.25 },
        { pattern: /^du[a-z]/i, weight: 0.10 },
        { pattern: /^des /i,    weight: 0.30 },
        { pattern: /^saint-/i,  weight: 0.30 },
        { pattern: /^st\.-/i,   weight: 0.20 },
        { pattern: /eau$/i,     weight: 0.35 },
        { pattern: /aux$/i,     weight: 0.30 },
        { pattern: /oux$/i,     weight: 0.35 },
        { pattern: /eux$/i,     weight: 0.30 },
        { pattern: /ier$/i,     weight: 0.15 },
        { pattern: /ard$/i,     weight: 0.10 },
        { pattern: /ault$/i,    weight: 0.30 },
        { pattern: /eault$/i,   weight: 0.35 },
        { pattern: /elle$/i,    weight: 0.10 },
        { pattern: /ette$/i,    weight: 0.15 },
        { pattern: /ois$/i,     weight: 0.20 },
        { pattern: /ais$/i,     weight: 0.15 },
        { pattern: /igne$/i,    weight: 0.25 },
        { pattern: /agne$/i,    weight: 0.20 },
        // "dit" names are strongly French-Canadian/Louisiana Creole
        { pattern: / dit /i,    weight: 0.50 },
        // Common French/Creole Louisiana surnames
        { pattern: /^boudreau/i,    weight: 0.40 },
        { pattern: /^thibodeau/i,   weight: 0.40 },
        { pattern: /^landry$/i,     weight: 0.30 },
        { pattern: /^hebert$/i,     weight: 0.30 },
        { pattern: /^broussard$/i,  weight: 0.35 },
        { pattern: /^guidry$/i,     weight: 0.35 },
        { pattern: /^arceneaux$/i,  weight: 0.40 },
        { pattern: /^fontenot$/i,   weight: 0.35 },
        { pattern: /^mouton$/i,     weight: 0.30 },
        { pattern: /^larche$/i,     weight: 0.30 },
        { pattern: /^lemoine$/i,    weight: 0.30 },
        { pattern: /^metoyer$/i,    weight: 0.45 },
        { pattern: /^rachal$/i,     weight: 0.40 },
        { pattern: /^bossier$/i,    weight: 0.35 },
        { pattern: /^creole$/i,     weight: 0.50 },
    ],

    // ---- Western European (German, Scandinavian, Dutch, Italian) ----------
    [CONTEXT_TYPES.WESTERN_EUROPEAN]: [
        // German
        { pattern: /m[uü]ller$/i,   weight: 0.30 },
        { pattern: /miller$/i,      weight: 0.05 },
        { pattern: /schmidt$/i,     weight: 0.30 },
        { pattern: /schneider$/i,   weight: 0.30 },
        { pattern: /snyder$/i,      weight: 0.15 },
        { pattern: /burg$/i,        weight: 0.15 },
        { pattern: /heimer$/i,      weight: 0.25 },
        { pattern: /bauer$/i,       weight: 0.30 },
        { pattern: /^von /i,        weight: 0.35 },
        { pattern: /^von[a-z]/i,    weight: 0.20 },
        { pattern: /meier$/i,       weight: 0.25 },
        { pattern: /meyer$/i,       weight: 0.20 },
        { pattern: /mayer$/i,       weight: 0.20 },
        { pattern: /maier$/i,       weight: 0.25 },
        { pattern: /hofer$/i,       weight: 0.25 },
        { pattern: /huber$/i,       weight: 0.25 },
        { pattern: /^schwarz/i,     weight: 0.20 },
        { pattern: /^klein/i,       weight: 0.15 },
        { pattern: /^gross/i,       weight: 0.10 },
        { pattern: /^lang/i,        weight: 0.10 },
        // Scandinavian
        { pattern: /ssen$/i,        weight: 0.25 },
        { pattern: /sson$/i,        weight: 0.30 },
        { pattern: /sen$/i,         weight: 0.15 },
        { pattern: /son$/i,         weight: 0.05 },
        { pattern: /str[oö]m$/i,    weight: 0.35 },
        { pattern: /lund$/i,        weight: 0.25 },
        { pattern: /gren$/i,        weight: 0.30 },
        { pattern: /qvist$/i,       weight: 0.40 },
        { pattern: /quist$/i,       weight: 0.35 },
        { pattern: /blad$/i,        weight: 0.25 },
        { pattern: /dahl$/i,        weight: 0.25 },
        { pattern: /gaard$/i,       weight: 0.30 },
        // Dutch
        { pattern: /^van /i,        weight: 0.25 },
        { pattern: /^van[a-z]/i,    weight: 0.15 },
        { pattern: /^vander/i,      weight: 0.30 },
        { pattern: /^vande[rn]/i,   weight: 0.30 },
        { pattern: /^ter /i,        weight: 0.25 },
        { pattern: /^de /i,         weight: 0.10 },
        // Italian
        { pattern: /ini$/i,         weight: 0.20 },
        { pattern: /ino$/i,         weight: 0.15 },
        { pattern: /etti$/i,        weight: 0.30 },
        { pattern: /ello$/i,        weight: 0.20 },
        { pattern: /ucci$/i,        weight: 0.35 },
        { pattern: /acci$/i,        weight: 0.30 },
        { pattern: /one$/i,         weight: 0.05 },
        { pattern: /are$/i,         weight: 0.05 },
        { pattern: /ese$/i,         weight: 0.10 },
        { pattern: /etti$/i,        weight: 0.30 },
        { pattern: /oli$/i,         weight: 0.15 },
        { pattern: /otti$/i,        weight: 0.25 },
        { pattern: /iani$/i,        weight: 0.25 },
        { pattern: /elli$/i,        weight: 0.20 },
    ],
};

// ---------------------------------------------------------------------------
//  Location → context type mappings
//  Each entry: { pattern: RegExp, type: string, weight: Number }
//  Tested against concatenated location strings (birth_place + locations).
// ---------------------------------------------------------------------------

const LOCATION_PATTERNS = [
    // ---- Eastern European / Jewish strongholds ----------------------------
    { pattern: /\bkiev\b/i,           type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.35 },
    { pattern: /\bkyiv\b/i,           type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.35 },
    { pattern: /\bodessa\b/i,         type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.35 },
    { pattern: /\bvilna\b/i,          type: CONTEXT_TYPES.EASTERN_EUROPEAN_JEWISH,   weight: 0.45 },
    { pattern: /\bvilnius\b/i,        type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.30 },
    { pattern: /\bminsk\b/i,          type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.35 },
    { pattern: /\bwarsaw\b/i,         type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.30 },
    { pattern: /\bwarszawa\b/i,       type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.35 },
    { pattern: /\blodz\b/i,           type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.30 },
    { pattern: /\b[łl][oó]d[zź]\b/i,  type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.35 },
    { pattern: /\bbialystok\b/i,      type: CONTEXT_TYPES.EASTERN_EUROPEAN_JEWISH,   weight: 0.40 },
    { pattern: /\bia[sș]i\b/i,        type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.30 },
    { pattern: /\bleningrad\b/i,      type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.30 },
    { pattern: /\bst\.?\s*petersburg\b/i, type: CONTEXT_TYPES.EASTERN_EUROPEAN,      weight: 0.25 },
    { pattern: /\bmoscow\b/i,         type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.30 },
    { pattern: /\bmosk[ov]a\b/i,      type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.30 },
    { pattern: /\belisamvetgrad\b/i,   type: CONTEXT_TYPES.EASTERN_EUROPEAN_JEWISH,   weight: 0.45 },
    { pattern: /\bkishinev\b/i,       type: CONTEXT_TYPES.EASTERN_EUROPEAN_JEWISH,   weight: 0.40 },
    { pattern: /\bchisinau\b/i,       type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.30 },
    { pattern: /\bkrakow\b/i,         type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.30 },
    { pattern: /\bkrak[oó]w\b/i,      type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.30 },
    { pattern: /\blviv\b/i,           type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.30 },
    { pattern: /\blemberg\b/i,        type: CONTEXT_TYPES.EASTERN_EUROPEAN_JEWISH,   weight: 0.40 },
    { pattern: /\blvov\b/i,           type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.30 },
    { pattern: /\bprague\b/i,         type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.25 },
    { pattern: /\bbudapest\b/i,       type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.25 },
    { pattern: /\bbucharest\b/i,      type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.25 },
    { pattern: /\bpoznan\b/i,         type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.30 },
    { pattern: /\bgdansk\b/i,         type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.25 },
    { pattern: /\bbreslau\b/i,        type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.30 },
    { pattern: /\bwroclaw\b/i,        type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.30 },
    { pattern: /\bpinsk\b/i,          type: CONTEXT_TYPES.EASTERN_EUROPEAN_JEWISH,   weight: 0.40 },
    { pattern: /\bgrodno\b/i,         type: CONTEXT_TYPES.EASTERN_EUROPEAN_JEWISH,   weight: 0.40 },
    { pattern: /\bberdichev\b/i,      type: CONTEXT_TYPES.EASTERN_EUROPEAN_JEWISH,   weight: 0.45 },
    { pattern: /\bzhitomir\b/i,       type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.30 },
    // Country-level
    { pattern: /\brussian empire\b/i, type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.35 },
    { pattern: /\brussia\b/i,         type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.30 },
    { pattern: /\bussr\b/i,           type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.30 },
    { pattern: /\bukraine\b/i,        type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.35 },
    { pattern: /\bpoland\b/i,         type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.30 },
    { pattern: /\blithuania\b/i,      type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.30 },
    { pattern: /\blatvia\b/i,         type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.30 },
    { pattern: /\bestonia\b/i,        type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.25 },
    { pattern: /\bbelarus\b/i,        type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.30 },
    { pattern: /\bmoldova\b/i,        type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.25 },
    { pattern: /\bromania\b/i,        type: CONTEXT_TYPES.EASTERN_EUROPEAN,          weight: 0.25 },
    { pattern: /\bbessarabia\b/i,     type: CONTEXT_TYPES.EASTERN_EUROPEAN_JEWISH,   weight: 0.40 },
    { pattern: /\bgalicia\b/i,        type: CONTEXT_TYPES.EASTERN_EUROPEAN_JEWISH,   weight: 0.40 },
    { pattern: /\bpale of settlement\b/i, type: CONTEXT_TYPES.EASTERN_EUROPEAN_JEWISH, weight: 0.55 },
    { pattern: /\bshtetl\b/i,         type: CONTEXT_TYPES.EASTERN_EUROPEAN_JEWISH,   weight: 0.55 },
    { pattern: /\bpodolia\b/i,        type: CONTEXT_TYPES.EASTERN_EUROPEAN_JEWISH,   weight: 0.40 },
    { pattern: /\bvolhynia\b/i,       type: CONTEXT_TYPES.EASTERN_EUROPEAN_JEWISH,   weight: 0.40 },

    // ---- Ireland ----------------------------------------------------------
    { pattern: /\bireland\b/i,        type: CONTEXT_TYPES.IRISH_IMMIGRANT,           weight: 0.40 },
    { pattern: /\bcork\b/i,           type: CONTEXT_TYPES.IRISH_IMMIGRANT,           weight: 0.30 },
    { pattern: /\bdublin\b/i,         type: CONTEXT_TYPES.IRISH_IMMIGRANT,           weight: 0.30 },
    { pattern: /\blimerick\b/i,       type: CONTEXT_TYPES.IRISH_IMMIGRANT,           weight: 0.35 },
    { pattern: /\bgalway\b/i,         type: CONTEXT_TYPES.IRISH_IMMIGRANT,           weight: 0.35 },
    { pattern: /\bkerry\b/i,          type: CONTEXT_TYPES.IRISH_IMMIGRANT,           weight: 0.35 },
    { pattern: /\bwaterford\b/i,      type: CONTEXT_TYPES.IRISH_IMMIGRANT,           weight: 0.35 },
    { pattern: /\btipperary\b/i,      type: CONTEXT_TYPES.IRISH_IMMIGRANT,           weight: 0.40 },
    { pattern: /\bdonegal\b/i,        type: CONTEXT_TYPES.IRISH_IMMIGRANT,           weight: 0.40 },
    { pattern: /\bkilkenny\b/i,       type: CONTEXT_TYPES.IRISH_IMMIGRANT,           weight: 0.35 },
    { pattern: /\bwexford\b/i,        type: CONTEXT_TYPES.IRISH_IMMIGRANT,           weight: 0.35 },
    { pattern: /\bsligo\b/i,          type: CONTEXT_TYPES.IRISH_IMMIGRANT,           weight: 0.35 },
    { pattern: /\bmayo\b/i,           type: CONTEXT_TYPES.IRISH_IMMIGRANT,           weight: 0.30 },
    { pattern: /\bcounty\s+\w+.*ireland\b/i, type: CONTEXT_TYPES.IRISH_IMMIGRANT,   weight: 0.45 },
    { pattern: /\bbelfast\b/i,        type: CONTEXT_TYPES.IRISH_IMMIGRANT,           weight: 0.25 },

    // ---- French / Louisiana -----------------------------------------------
    { pattern: /\blouisiana\b/i,      type: CONTEXT_TYPES.FRENCH_LOUISIANA,          weight: 0.25 },
    { pattern: /\bnew orleans\b/i,    type: CONTEXT_TYPES.FRENCH_LOUISIANA,          weight: 0.35 },
    { pattern: /\bnatchitoches\b/i,   type: CONTEXT_TYPES.FRENCH_LOUISIANA,          weight: 0.45 },
    { pattern: /\bopelousas\b/i,      type: CONTEXT_TYPES.FRENCH_LOUISIANA,          weight: 0.40 },
    { pattern: /\bplaquemine\b/i,     type: CONTEXT_TYPES.FRENCH_LOUISIANA,          weight: 0.40 },
    { pattern: /\bpointe coupee\b/i,  type: CONTEXT_TYPES.FRENCH_LOUISIANA,          weight: 0.45 },
    { pattern: /\bst\.\s*landry\b/i,  type: CONTEXT_TYPES.FRENCH_LOUISIANA,          weight: 0.45 },
    { pattern: /\blafayette\b.*\b(la|louisiana)\b/i, type: CONTEXT_TYPES.FRENCH_LOUISIANA, weight: 0.40 },
    { pattern: /\bst\.\s*martin\b.*\b(la|louisiana)\b/i, type: CONTEXT_TYPES.FRENCH_LOUISIANA, weight: 0.45 },
    { pattern: /\bavoyelles\b/i,      type: CONTEXT_TYPES.FRENCH_LOUISIANA,          weight: 0.45 },
    { pattern: /\brapides\b/i,        type: CONTEXT_TYPES.FRENCH_LOUISIANA,          weight: 0.35 },
    { pattern: /\bisle of cane\b/i,   type: CONTEXT_TYPES.FRENCH_LOUISIANA,          weight: 0.50 },
    { pattern: /\bcane river\b/i,     type: CONTEXT_TYPES.FRENCH_LOUISIANA,          weight: 0.50 },
    { pattern: /\bacadia\b/i,         type: CONTEXT_TYPES.FRENCH_LOUISIANA,          weight: 0.40 },
    { pattern: /\bcaddo\b.*\b(la|louisiana)\b/i, type: CONTEXT_TYPES.FRENCH_LOUISIANA, weight: 0.35 },
    { pattern: /\bbossier\b/i,        type: CONTEXT_TYPES.FRENCH_LOUISIANA,          weight: 0.35 },
    { pattern: /\bterre\s*bonne\b/i,  type: CONTEXT_TYPES.FRENCH_LOUISIANA,          weight: 0.40 },
    { pattern: /\bfrance\b/i,         type: CONTEXT_TYPES.WESTERN_EUROPEAN,          weight: 0.30 },
    { pattern: /\bparis\b/i,          type: CONTEXT_TYPES.WESTERN_EUROPEAN,          weight: 0.20 },

    // ---- Western Europe ---------------------------------------------------
    { pattern: /\bgermany\b/i,        type: CONTEXT_TYPES.WESTERN_EUROPEAN,          weight: 0.35 },
    { pattern: /\bbavaria\b/i,        type: CONTEXT_TYPES.WESTERN_EUROPEAN,          weight: 0.35 },
    { pattern: /\bprussia\b/i,        type: CONTEXT_TYPES.WESTERN_EUROPEAN,          weight: 0.30 },
    { pattern: /\bsaxony\b/i,         type: CONTEXT_TYPES.WESTERN_EUROPEAN,          weight: 0.35 },
    { pattern: /\bhesse\b/i,          type: CONTEXT_TYPES.WESTERN_EUROPEAN,          weight: 0.35 },
    { pattern: /\bwurttemberg\b/i,    type: CONTEXT_TYPES.WESTERN_EUROPEAN,          weight: 0.35 },
    { pattern: /\bhanover\b/i,        type: CONTEXT_TYPES.WESTERN_EUROPEAN,          weight: 0.30 },
    { pattern: /\bsweden\b/i,         type: CONTEXT_TYPES.WESTERN_EUROPEAN,          weight: 0.35 },
    { pattern: /\bnorway\b/i,         type: CONTEXT_TYPES.WESTERN_EUROPEAN,          weight: 0.35 },
    { pattern: /\bdenmark\b/i,        type: CONTEXT_TYPES.WESTERN_EUROPEAN,          weight: 0.35 },
    { pattern: /\bnetherlands\b/i,    type: CONTEXT_TYPES.WESTERN_EUROPEAN,          weight: 0.35 },
    { pattern: /\bholland\b/i,        type: CONTEXT_TYPES.WESTERN_EUROPEAN,          weight: 0.30 },
    { pattern: /\bbelgium\b/i,        type: CONTEXT_TYPES.WESTERN_EUROPEAN,          weight: 0.30 },
    { pattern: /\bswitzerland\b/i,    type: CONTEXT_TYPES.WESTERN_EUROPEAN,          weight: 0.30 },
    { pattern: /\bitaly\b/i,          type: CONTEXT_TYPES.WESTERN_EUROPEAN,          weight: 0.35 },
    { pattern: /\bsicily\b/i,         type: CONTEXT_TYPES.WESTERN_EUROPEAN,          weight: 0.35 },
    { pattern: /\bnaples\b/i,         type: CONTEXT_TYPES.WESTERN_EUROPEAN,          weight: 0.30 },
    { pattern: /\bcalabria\b/i,       type: CONTEXT_TYPES.WESTERN_EUROPEAN,          weight: 0.35 },

    // ---- England / Scotland / Wales (colonial) ----------------------------
    { pattern: /\bengland\b/i,        type: CONTEXT_TYPES.COLONIAL_AMERICAN,         weight: 0.20 },
    { pattern: /\bscotland\b/i,       type: CONTEXT_TYPES.COLONIAL_AMERICAN,         weight: 0.20 },
    { pattern: /\bwales\b/i,          type: CONTEXT_TYPES.COLONIAL_AMERICAN,         weight: 0.20 },
    { pattern: /\blondon\b/i,         type: CONTEXT_TYPES.COLONIAL_AMERICAN,         weight: 0.15 },
    { pattern: /\bdevon\b/i,          type: CONTEXT_TYPES.COLONIAL_AMERICAN,         weight: 0.20 },
    { pattern: /\bkent\b/i,           type: CONTEXT_TYPES.COLONIAL_AMERICAN,         weight: 0.15 },
    { pattern: /\bnorfolk\b.*\bengland\b/i, type: CONTEXT_TYPES.COLONIAL_AMERICAN,   weight: 0.25 },
    { pattern: /\bsuffolk\b.*\bengland\b/i, type: CONTEXT_TYPES.COLONIAL_AMERICAN,   weight: 0.25 },
    { pattern: /\byorkshire\b/i,      type: CONTEXT_TYPES.COLONIAL_AMERICAN,         weight: 0.20 },
    { pattern: /\blancashire\b/i,     type: CONTEXT_TYPES.COLONIAL_AMERICAN,         weight: 0.20 },

    // ---- US generic -------------------------------------------------------
    { pattern: /\bnew york\b/i,       type: CONTEXT_TYPES.GENERIC_AMERICAN,          weight: 0.15 },
    { pattern: /\bbrooklyn\b/i,       type: CONTEXT_TYPES.GENERIC_AMERICAN,          weight: 0.15 },
    { pattern: /\bmanhattan\b/i,      type: CONTEXT_TYPES.GENERIC_AMERICAN,          weight: 0.15 },
    { pattern: /\bphiladelphia\b/i,   type: CONTEXT_TYPES.GENERIC_AMERICAN,          weight: 0.15 },
    { pattern: /\bchicago\b/i,        type: CONTEXT_TYPES.GENERIC_AMERICAN,          weight: 0.15 },
    { pattern: /\bdetroit\b/i,        type: CONTEXT_TYPES.GENERIC_AMERICAN,          weight: 0.15 },
    { pattern: /\bboston\b/i,         type: CONTEXT_TYPES.GENERIC_AMERICAN,          weight: 0.15 },
    { pattern: /\bscranton\b/i,       type: CONTEXT_TYPES.GENERIC_AMERICAN,          weight: 0.15 },
    { pattern: /\bpittsburgh\b/i,     type: CONTEXT_TYPES.GENERIC_AMERICAN,          weight: 0.15 },
    { pattern: /\bcleveland\b/i,      type: CONTEXT_TYPES.GENERIC_AMERICAN,          weight: 0.15 },
    { pattern: /\bbaltimore\b/i,      type: CONTEXT_TYPES.GENERIC_AMERICAN,          weight: 0.15 },
    { pattern: /\bcincinnati\b/i,     type: CONTEXT_TYPES.GENERIC_AMERICAN,          weight: 0.15 },
    { pattern: /\bsan francisco\b/i,  type: CONTEXT_TYPES.GENERIC_AMERICAN,          weight: 0.15 },
    { pattern: /\blos angeles\b/i,    type: CONTEXT_TYPES.GENERIC_AMERICAN,          weight: 0.15 },

    // ---- US state-level (for colonial / slave state detection) -------------
    { pattern: /\bvirginia\b/i,       type: CONTEXT_TYPES.GENERIC_AMERICAN,          weight: 0.10 },
    { pattern: /\bmaryland\b/i,       type: CONTEXT_TYPES.GENERIC_AMERICAN,          weight: 0.10 },
    { pattern: /\bnorth carolina\b/i, type: CONTEXT_TYPES.GENERIC_AMERICAN,          weight: 0.10 },
    { pattern: /\bsouth carolina\b/i, type: CONTEXT_TYPES.GENERIC_AMERICAN,          weight: 0.10 },
    { pattern: /\bgeorgia\b/i,        type: CONTEXT_TYPES.GENERIC_AMERICAN,          weight: 0.10 },
    { pattern: /\balabama\b/i,        type: CONTEXT_TYPES.GENERIC_AMERICAN,          weight: 0.10 },
    { pattern: /\bmississippi\b/i,    type: CONTEXT_TYPES.GENERIC_AMERICAN,          weight: 0.10 },
    { pattern: /\btennessee\b/i,      type: CONTEXT_TYPES.GENERIC_AMERICAN,          weight: 0.10 },
    { pattern: /\bkentucky\b/i,       type: CONTEXT_TYPES.GENERIC_AMERICAN,          weight: 0.10 },
    { pattern: /\btexas\b/i,          type: CONTEXT_TYPES.GENERIC_AMERICAN,          weight: 0.10 },
    { pattern: /\barkansas\b/i,       type: CONTEXT_TYPES.GENERIC_AMERICAN,          weight: 0.10 },
    { pattern: /\bmissouri\b/i,       type: CONTEXT_TYPES.GENERIC_AMERICAN,          weight: 0.10 },
    { pattern: /\bflorida\b/i,        type: CONTEXT_TYPES.GENERIC_AMERICAN,          weight: 0.10 },
    { pattern: /\bconnecticut\b/i,    type: CONTEXT_TYPES.GENERIC_AMERICAN,          weight: 0.10 },
    { pattern: /\bmassachusetts\b/i,   type: CONTEXT_TYPES.GENERIC_AMERICAN,          weight: 0.10 },
    { pattern: /\bpennsylvania\b/i,   type: CONTEXT_TYPES.GENERIC_AMERICAN,          weight: 0.10 },
];

// ---------------------------------------------------------------------------
//  Slave states list (for african_american detection)
// ---------------------------------------------------------------------------

const SLAVE_STATES = new Set([
    'virginia', 'maryland', 'north carolina', 'south carolina', 'georgia',
    'alabama', 'mississippi', 'louisiana', 'tennessee', 'kentucky', 'texas',
    'arkansas', 'missouri', 'florida', 'delaware', 'district of columbia',
]);

// ---------------------------------------------------------------------------
//  Race indicator keywords (lowercased)
// ---------------------------------------------------------------------------

const BLACK_RACE_INDICATORS = new Set([
    'black', 'negro', 'mulatto', 'colored', 'coloured', 'african',
    'freedman', 'freedwoman', 'freed', 'slave', 'enslaved',
    'free person of color', 'free negro', 'fpc', 'f.p.c.',
    'gens de couleur', 'afro-american', 'african american',
]);

// ---------------------------------------------------------------------------
//  BranchClassifier
// ---------------------------------------------------------------------------

class BranchClassifier {
    /**
     * Classify a single person into ethnic/geographic context types.
     *
     * @param {object} person
     *   - name          {string}  Full name ("John Goldstein")
     *   - birth_year    {number}  Approximate birth year (optional)
     *   - birth_place   {string}  Birth location string (optional)
     *   - locations      {string[]} Additional location strings (optional)
     *   - race_indicators {string[]} Race/ethnicity hints from records (optional)
     * @param {object|null} parentContext
     *   - type       {string}  Parent's primary context type
     *   - confidence {number}  Parent's confidence (0-1)
     * @returns {Array<{type: string, confidence: number, signals: string[]}>}
     *   Ranked list of context types, highest confidence first.
     */
    classify(person, parentContext = null) {
        const scores = {};      // type → running score
        const signals = {};     // type → string[] of explanation labels

        const initType = (type) => {
            if (scores[type] === undefined) {
                scores[type] = 0;
                signals[type] = [];
            }
        };

        // -- Extract surname --------------------------------------------------
        const surname = this._extractSurname(person.name);

        // -- 1. Surname analysis (highest weight) -----------------------------
        if (surname) {
            for (const [contextType, patterns] of Object.entries(SURNAME_PATTERNS)) {
                for (const { pattern, weight } of patterns) {
                    if (pattern.test(surname)) {
                        initType(contextType);
                        scores[contextType] += weight;
                        signals[contextType].push(`surname "${surname}" matches ${pattern}`);
                    }
                }
            }

            // Special: surnames that match BOTH eastern_european and
            // eastern_european_jewish get a small jewish boost (many -sky/-ski
            // names are ambiguous).
            if (scores[CONTEXT_TYPES.EASTERN_EUROPEAN] > 0 &&
                scores[CONTEXT_TYPES.EASTERN_EUROPEAN_JEWISH] > 0) {
                scores[CONTEXT_TYPES.EASTERN_EUROPEAN_JEWISH] += 0.05;
                signals[CONTEXT_TYPES.EASTERN_EUROPEAN_JEWISH].push('surname has both EE and EEJ signals (ambiguity boost)');
            }
        }

        // -- 2. Location analysis ---------------------------------------------
        const locationText = this._buildLocationText(person);
        if (locationText) {
            for (const { pattern, type, weight } of LOCATION_PATTERNS) {
                if (pattern.test(locationText)) {
                    initType(type);
                    scores[type] += weight;
                    signals[type].push(`location matches ${pattern}`);
                }
            }
        }

        // -- 3. Race indicator analysis ---------------------------------------
        const raceIndicators = (person.race_indicators || []).map(r => r.toLowerCase().trim());
        const hasBlackIndicator = raceIndicators.some(r => BLACK_RACE_INDICATORS.has(r));

        if (hasBlackIndicator) {
            const isSlaveState = this._inSlaveState(locationText);
            const birthYear = person.birth_year;

            if (birthYear && birthYear < 1870 && isSlaveState) {
                initType(CONTEXT_TYPES.AFRICAN_AMERICAN_PRE1870);
                scores[CONTEXT_TYPES.AFRICAN_AMERICAN_PRE1870] += 0.55;
                signals[CONTEXT_TYPES.AFRICAN_AMERICAN_PRE1870].push(
                    `race indicator + slave state + born before 1870 (${birthYear})`
                );
            } else if (birthYear && birthYear < 1870) {
                initType(CONTEXT_TYPES.AFRICAN_AMERICAN_PRE1870);
                scores[CONTEXT_TYPES.AFRICAN_AMERICAN_PRE1870] += 0.40;
                signals[CONTEXT_TYPES.AFRICAN_AMERICAN_PRE1870].push(
                    `race indicator + born before 1870 (${birthYear})`
                );
            } else {
                initType(CONTEXT_TYPES.AFRICAN_AMERICAN_POST1870);
                scores[CONTEXT_TYPES.AFRICAN_AMERICAN_POST1870] += 0.45;
                signals[CONTEXT_TYPES.AFRICAN_AMERICAN_POST1870].push(
                    `race indicator (post-1870 or unknown year)`
                );
            }

            // Louisiana + Black → french_louisiana boost (Creole)
            if (locationText && /\b(louisiana|new orleans|natchitoches|opelousas)\b/i.test(locationText)) {
                initType(CONTEXT_TYPES.FRENCH_LOUISIANA);
                scores[CONTEXT_TYPES.FRENCH_LOUISIANA] += 0.20;
                signals[CONTEXT_TYPES.FRENCH_LOUISIANA].push('Black + Louisiana (Creole boost)');
            }
        }

        // -- 4. Temporal analysis ---------------------------------------------
        const birthYear = person.birth_year;
        if (birthYear) {
            if (birthYear < 1800 && locationText) {
                // Colonial-era US
                const usMatch = /\b(virginia|maryland|massachusetts|connecticut|pennsylvania|new york|new jersey|delaware|carolina|georgia|new hampshire|rhode island|united states|america)\b/i.test(locationText);
                if (usMatch) {
                    initType(CONTEXT_TYPES.COLONIAL_AMERICAN);
                    scores[CONTEXT_TYPES.COLONIAL_AMERICAN] += 0.30;
                    signals[CONTEXT_TYPES.COLONIAL_AMERICAN].push(`born ${birthYear} in colonial-era US location`);
                }

                // Pre-1800 England/Scotland → stronger colonial signal
                const britishMatch = /\b(england|scotland|wales|london|devon|kent|yorkshire)\b/i.test(locationText);
                if (britishMatch) {
                    initType(CONTEXT_TYPES.COLONIAL_AMERICAN);
                    scores[CONTEXT_TYPES.COLONIAL_AMERICAN] += 0.15;
                    signals[CONTEXT_TYPES.COLONIAL_AMERICAN].push(`born ${birthYear} in British Isles (possible colonial emigrant)`);
                }
            }

            // Irish famine-era boost (1820-1860 immigration wave)
            if (birthYear >= 1790 && birthYear <= 1850 && scores[CONTEXT_TYPES.IRISH_IMMIGRANT] > 0) {
                scores[CONTEXT_TYPES.IRISH_IMMIGRANT] += 0.15;
                signals[CONTEXT_TYPES.IRISH_IMMIGRANT].push(`born ${birthYear} — famine-era immigration window`);
            }

            // Jewish Pale of Settlement era boost (pre-1917)
            if (birthYear < 1917 && scores[CONTEXT_TYPES.EASTERN_EUROPEAN_JEWISH] > 0) {
                scores[CONTEXT_TYPES.EASTERN_EUROPEAN_JEWISH] += 0.10;
                signals[CONTEXT_TYPES.EASTERN_EUROPEAN_JEWISH].push(`born ${birthYear} — Pale of Settlement era`);
            }
        }

        // -- 5. Context inheritance from parent -------------------------------
        if (parentContext && parentContext.type && parentContext.confidence > 0) {
            const inheritedType = parentContext.type;
            // Inherit at 40% of parent's confidence, capped at 0.30
            const inheritWeight = Math.min(parentContext.confidence * 0.40, 0.30);

            initType(inheritedType);

            // Only apply inheritance if own signals don't strongly contradict
            const ownTopScore = Math.max(0, ...Object.values(scores));
            const currentScoreForInherited = scores[inheritedType];

            // Don't inherit if another type already scores much higher
            if (currentScoreForInherited + inheritWeight >= ownTopScore * 0.40 || ownTopScore === 0) {
                scores[inheritedType] += inheritWeight;
                signals[inheritedType].push(
                    `inherited from parent (${inheritedType} @ ${(parentContext.confidence * 100).toFixed(0)}%)`
                );
            }
        }

        // -- Build ranked result list -----------------------------------------
        const results = [];
        for (const type of Object.values(CONTEXT_TYPES)) {
            if (scores[type] !== undefined && scores[type] > 0) {
                // Normalize confidence to 0.0 - 1.0 range
                // Scores above 1.0 are clamped; a score of ~0.6 is "strong"
                const confidence = Math.min(1.0, Math.round(scores[type] * 1000) / 1000);
                results.push({
                    type,
                    confidence,
                    signals: signals[type],
                });
            }
        }

        results.sort((a, b) => b.confidence - a.confidence);

        // If nothing scored, return unknown
        if (results.length === 0) {
            results.push({
                type: CONTEXT_TYPES.UNKNOWN,
                confidence: 0,
                signals: ['no classification signals detected'],
            });
        }

        return results;
    }

    /**
     * Get the primary (highest-confidence) context type.
     *
     * @param {object} person - Same shape as classify()
     * @param {object|null} parentContext - Same shape as classify()
     * @returns {{ type: string, confidence: number, signals: string[] }}
     */
    primaryContext(person, parentContext = null) {
        return this.classify(person, parentContext)[0];
    }

    // -----------------------------------------------------------------------
    //  Internal helpers
    // -----------------------------------------------------------------------

    /**
     * Extract the surname from a full name string.
     * Handles "First Last", "Last, First", and multi-word surnames.
     */
    _extractSurname(name) {
        if (!name || typeof name !== 'string') return null;
        const trimmed = name.trim();
        if (!trimmed) return null;

        // "Last, First" format
        if (trimmed.includes(',')) {
            return trimmed.split(',')[0].trim();
        }

        // "First Middle Last" — take the last token
        const parts = trimmed.split(/\s+/);
        if (parts.length === 1) return parts[0];
        return parts[parts.length - 1];
    }

    /**
     * Concatenate all location fields into one searchable string.
     */
    _buildLocationText(person) {
        const parts = [];
        if (person.birth_place) parts.push(person.birth_place);
        if (Array.isArray(person.locations)) {
            parts.push(...person.locations);
        }
        return parts.join(' | ').toLowerCase();
    }

    /**
     * Check whether a location string references a US slave state.
     */
    _inSlaveState(locationText) {
        if (!locationText) return false;
        const lower = locationText.toLowerCase();
        for (const state of SLAVE_STATES) {
            if (lower.includes(state)) return true;
        }
        return false;
    }
}

// ---------------------------------------------------------------------------
//  Exports
// ---------------------------------------------------------------------------

module.exports = BranchClassifier;
module.exports.CONTEXT_TYPES = CONTEXT_TYPES;
