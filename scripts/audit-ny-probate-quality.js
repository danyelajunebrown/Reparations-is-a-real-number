#!/usr/bin/env node
/**
 * audit-ny-probate-quality.js
 *
 * Exhaustive, read-only validity + consistency audit of the New York probate
 * scrape (FamilySearch collection 1920234), independent of scrape *progress*.
 * Sibling of scripts/audit-liberty-county-quality.js (Georgia), but scoped to
 * NY and extended with the checks the NY contamination issues demand.
 *
 * NY selectors:
 *   - probate_scrape_progress.collection_id = '1920234'   (progress side)
 *   - person_documents.collection_key LIKE 'new-york-probate-%'  (document side)
 *     County is parsed from collection_key; probate_scrape_progress.county holds
 *     FS waypoint ARK ids for NY, NOT human county names (do not filter on it).
 *
 * Dimensions:
 *   A. Acquisition & coverage        (status, record types, county/roll reach)
 *   B. Document field completeness   (year, name, transcript, S3, links)
 *   C. #67 Year validity             (NULL rate, century buckets, implausible)
 *   D. #69 Post-1827 enslaved flags  (NY abolished slavery 1827-07-04)
 *   E. #68 Index-page contamination  (20th-c surrogate index tagged enslaved)
 *   F. #70 Enslaved-name quality     (stopwords, junk, uniform confidence)
 *   G. Orphan / linkage rate         (docs & enslavers connected vs siloed)
 *   H. Identity / dedup readiness    (blocking keys, duplicate testators)
 *   I. Forensic financial extraction (segments/extractions/index coverage)
 *   J. External-assertion gate       (assertable flags vs stored documents)
 *   K. Consistency cross-checks      (count mismatches, unarchived images)
 *
 * NO WRITES. Safe while the scraper is live.
 *
 * Usage:
 *   node scripts/audit-ny-probate-quality.js
 *   node scripts/audit-ny-probate-quality.js --verbose
 *   node scripts/audit-ny-probate-quality.js --limit 40   (rows in sample lists)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pg = require('pg');

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt  = (n, d) => { const i = argv.indexOf(n); return i !== -1 && argv[i + 1] ? argv[i + 1] : d; };
const VERBOSE = flag('--verbose');
const SAMPLE  = parseInt(opt('--limit', '25'), 10);

const COLLECTION_ID = '1920234';
const DOC_LIKE      = 'new-york-probate-%';
const ABOLITION     = 1827; // NY abolished slavery 1827-07-04

// Same stopword set the scraper/Liberty audit use — should never be an enslaved name.
const NAME_STOPWORDS = new Set([
    'named','one','by','the','my','said','of','and','to','for','in','at','as',
    'is','it','he','she','his','her','their','our','its','or','but','not',
    'with','from','that','this','also','above','within','same','aforesaid',
    'following','certain','another','given','all','other','on',
    'man','woman','boy','girl','child','children','wench','fellow','servant',
    'slave','slaves','negro','negroes','old','young','little','big','aged',
    'faithful','trusty','female','male','mulatto','called','indian',
    'two','three','four','five','six','seven','eight','nine','ten','eleven',
    'twelve','fourteen','fifteen','twenty',
    'executor','executrix','executors','witness','witnesses','subscriber',
    'subscribers','rector','deacon',
    'viz','lastly','likewise','likewife','furthermore','moreover','whereas','item',
    'valued','purchase','forward','house','field','born','cold','had','ditto',
    'do','gross','pair','mentioned','state','march','day',
    'pr','sew','suc','amht','god','lemale','foltowing',
]);
// Tokens that identify a 20th-century surrogate index / administrative page.
const INDEX_TOKENS   = /(LETTERS ISSUED|FILE NUMBER|TAXABLE TRANSFER|SURROGATE'?S? COURT|INDEX TO|LETTERS OF ADMINISTRATION GRANTED|CERTIFICATE OF)/i;
// Tokens that must appear for an "enslaved" flag to be plausible.
const SLAVERY_TOKENS = /(negro|negroe|slave|coloured|colored|servant for life|mulatto|bond ?(?:wo)?man|wench|a black)/i;

const q = (s, p) => pool.query(s, p).then(r => r.rows);
function sep(c = '─', n = 74) { return c.repeat(n); }
function hdr(t) { console.log('\n' + sep('═')); console.log('  ' + t); console.log(sep('═')); }
function sub(t) { console.log('\n' + sep('─')); console.log('  ' + t); console.log(sep('─')); }
function pct(n, d) { return !d ? 'n/a' : ((n / d) * 100).toFixed(1) + '%'; }
function pad(s, w) { return String(s == null ? '' : s).padEnd(w); }
function rpad(s, w) { return String(s == null ? '' : s).padStart(w); }
function bar(n, d) { return '█'.repeat(Math.round((n / (d || 1)) * 20)).padEnd(20); }
function line(label, n, d) {
    console.log(`  ${pad(label, 34)} ${rpad(n, 7)}/${pad(d, 7)} ${pct(n, d).padStart(7)}  ${bar(n, d)}`);
}

async function main() {
    hdr(`NEW YORK PROBATE — EXHAUSTIVE VALIDITY & CONSISTENCY AUDIT (collection ${COLLECTION_ID})`);
    console.log(`  Run at: ${new Date().toISOString()}   (read-only; scrape may be live)`);

    // ══════════════════════════════════════════════════════════════════════
    // A. ACQUISITION & COVERAGE
    // ══════════════════════════════════════════════════════════════════════
    sub('A. Acquisition & coverage  —  probate_scrape_progress');
    const status = await q(`
        SELECT status, COUNT(*)::int n,
               COUNT(*) FILTER (WHERE enslaved_count > 0)::int with_enslaved
        FROM probate_scrape_progress WHERE collection_id = $1 GROUP BY status ORDER BY n DESC`, [COLLECTION_ID]);
    const totalProg = status.reduce((a, r) => a + r.n, 0);
    for (const r of status) console.log(`  ${pad(r.status, 16)} ${rpad(r.n, 8)}  (${pct(r.n, totalProg)})  enslaved-flagged: ${r.with_enslaved}`);
    console.log(`  ${pad('TOTAL', 16)} ${rpad(totalProg, 8)}`);

    const rtypes = await q(`
        SELECT COALESCE(record_type,'(null)') record_type, COUNT(*)::int n
        FROM probate_scrape_progress WHERE collection_id = $1 GROUP BY record_type ORDER BY n DESC`, [COLLECTION_ID]);
    console.log('\n  Record types:');
    for (const r of rtypes) console.log(`    ${pad(r.record_type, 22)} ${rpad(r.n, 8)} (${pct(r.n, totalProg)})`);

    const counties = await q(`
        SELECT substring(collection_key from 'new-york-probate-(.*)-[0-9A-Z]{4}-[0-9A-Z]{2,6}$') county,
               COUNT(*)::int docs, COUNT(DISTINCT collection_key)::int rolls
        FROM person_documents WHERE collection_key LIKE $1
        GROUP BY 1 ORDER BY docs DESC`, [DOC_LIKE]);
    console.log(`\n  Counties reached: ${counties.length} of 58   (docs by county, top ${SAMPLE}):`);
    for (const r of counties.slice(0, SAMPLE)) console.log(`    ${pad(r.county, 20)} ${rpad(r.docs, 8)} docs  ${rpad(r.rolls, 4)} rolls`);
    if (counties.length > SAMPLE) console.log(`    … and ${counties.length - SAMPLE} more counties`);

    // ══════════════════════════════════════════════════════════════════════
    // B. DOCUMENT FIELD COMPLETENESS
    // ══════════════════════════════════════════════════════════════════════
    sub('B. person_documents  —  field completeness (NY documents)');
    const [pd] = await q(`
        SELECT COUNT(*)::int total,
          COUNT(*) FILTER (WHERE document_type IS NOT NULL AND document_type <> 'other')::int typed,
          COUNT(*) FILTER (WHERE document_year IS NOT NULL)::int has_year,
          COUNT(*) FILTER (WHERE name_as_appears IS NOT NULL AND name_as_appears NOT LIKE 'Image %')::int has_name,
          COUNT(*) FILTER (WHERE ocr_text IS NOT NULL AND LENGTH(ocr_text) > 20)::int has_ocr,
          COUNT(*) FILTER (WHERE s3_key IS NOT NULL)::int has_s3_key,
          COUNT(*) FILTER (WHERE s3_url IS NOT NULL)::int has_s3_url,
          COUNT(*) FILTER (WHERE canonical_person_id IS NOT NULL)::int linked_canonical,
          COUNT(*) FILTER (WHERE unconfirmed_person_id IS NOT NULL)::int linked_unconfirmed,
          COUNT(*) FILTER (WHERE human_verified)::int human_verified,
          ROUND(AVG(extraction_confidence)::numeric, 3) avg_conf
        FROM person_documents WHERE collection_key LIKE $1`, [DOC_LIKE]);
    const T = pd.total;
    line('document_type (not "other")', pd.typed, T);
    line('document_year present', pd.has_year, T);
    line('testator/name_as_appears', pd.has_name, T);
    line('OCR transcript (>20 chars)', pd.has_ocr, T);
    line('S3 image key (archived)', pd.has_s3_key, T);
    line('S3 url', pd.has_s3_url, T);
    line('linked → canonical_person', pd.linked_canonical, T);
    line('linked → unconfirmed_person', pd.linked_unconfirmed, T);
    line('human_verified', pd.human_verified, T);
    console.log(`\n  Total NY documents: ${T}   avg extraction_confidence: ${pd.avg_conf}`);

    const dtypes = await q(`
        SELECT COALESCE(document_type,'(null)') document_type, COUNT(*)::int n
        FROM person_documents WHERE collection_key LIKE $1 GROUP BY 1 ORDER BY n DESC`, [DOC_LIKE]);
    console.log('  document_type distribution:');
    for (const r of dtypes) console.log(`    ${pad(r.document_type, 26)} ${rpad(r.n, 8)} (${pct(r.n, T)})`);

    // ══════════════════════════════════════════════════════════════════════
    // C. #67  YEAR VALIDITY
    // ══════════════════════════════════════════════════════════════════════
    sub('C. #67 Year validity  —  document_year distribution');
    const [yr] = await q(`
        SELECT COUNT(*)::int total,
          COUNT(*) FILTER (WHERE document_year IS NULL)::int null_year,
          COUNT(*) FILTER (WHERE document_year < 1600)::int pre1600,
          COUNT(*) FILTER (WHERE document_year BETWEEN 1600 AND 1699)::int c17,
          COUNT(*) FILTER (WHERE document_year BETWEEN 1700 AND 1799)::int c18,
          COUNT(*) FILTER (WHERE document_year BETWEEN 1800 AND ${ABOLITION})::int early19_pre_abol,
          COUNT(*) FILTER (WHERE document_year BETWEEN ${ABOLITION + 1} AND 1899)::int late19_post_abol,
          COUNT(*) FILTER (WHERE document_year BETWEEN 1900 AND 1971)::int c20,
          COUNT(*) FILTER (WHERE document_year > 1971)::int impossible_future,
          MIN(document_year) mn, MAX(document_year) mx
        FROM person_documents WHERE collection_key LIKE $1`, [DOC_LIKE]);
    console.log(`  NULL year:                 ${rpad(yr.null_year, 8)} (${pct(yr.null_year, yr.total)})   ← #67 residual`);
    console.log(`  < 1600 (implausible):      ${rpad(yr.pre1600, 8)} (${pct(yr.pre1600, yr.total)})`);
    console.log(`  1600–1699 (colonial):      ${rpad(yr.c17, 8)} (${pct(yr.c17, yr.total)})`);
    console.log(`  1700–1799 (colonial):      ${rpad(yr.c18, 8)} (${pct(yr.c18, yr.total)})`);
    console.log(`  1800–${ABOLITION} (pre-abolition): ${rpad(yr.early19_pre_abol, 8)} (${pct(yr.early19_pre_abol, yr.total)})`);
    console.log(`  ${ABOLITION + 1}–1899 (post-abol.):  ${rpad(yr.late19_post_abol, 8)} (${pct(yr.late19_post_abol, yr.total)})`);
    console.log(`  1900–1971 (20th c.):       ${rpad(yr.c20, 8)} (${pct(yr.c20, yr.total)})`);
    console.log(`  > 1971 (impossible):       ${rpad(yr.impossible_future, 8)} (${pct(yr.impossible_future, yr.total)})`);
    console.log(`  Year range observed:       ${yr.mn} … ${yr.mx}`);
    const slaveryEra = yr.c17 + yr.c18 + yr.early19_pre_abol;
    console.log(`  → Slavery-era (≤${ABOLITION}) dated pages: ${slaveryEra} (${pct(slaveryEra, yr.total)} of NY docs)`);

    // ══════════════════════════════════════════════════════════════════════
    // D. #69  POST-1827 ENSLAVED FLAGS
    // ══════════════════════════════════════════════════════════════════════
    sub(`D. #69 Enslaved-flagged documents by era  (NY abolished slavery ${ABOLITION})`);
    const ens = await q(`
        SELECT
          CASE WHEN document_year IS NULL THEN 'null-year'
               WHEN document_year <= ${ABOLITION} THEN 'pre-abolition (plausible)'
               ELSE 'post-abolition (SUSPECT)' END era,
          COUNT(*)::int docs
        FROM person_documents
        WHERE collection_key LIKE $1 AND person_type = 'enslaved'
        GROUP BY 1 ORDER BY docs DESC`, [DOC_LIKE]);
    // person_type on person_documents may not carry the flag; fall back to progress enslaved_count.
    const flaggedDocs = await q(`
        SELECT pd.id, pd.document_year, pd.collection_key, LEFT(pd.ocr_text, 0) _
        FROM person_documents pd
        JOIN probate_scrape_progress p ON p.person_document_id = pd.id
        WHERE p.collection_id = $1 AND p.enslaved_count > 0`, [COLLECTION_ID]);
    const byEra = { 'null-year': 0, 'pre-abolition (plausible)': 0, 'post-abolition (SUSPECT)': 0 };
    for (const r of flaggedDocs) {
        const e = r.document_year == null ? 'null-year' : (r.document_year <= ABOLITION ? 'pre-abolition (plausible)' : 'post-abolition (SUSPECT)');
        byEra[e]++;
    }
    console.log(`  Documents with progress.enslaved_count > 0: ${flaggedDocs.length}`);
    for (const k of Object.keys(byEra)) console.log(`    ${pad(k, 30)} ${rpad(byEra[k], 6)} (${pct(byEra[k], flaggedDocs.length)})`);
    if (VERBOSE && ens.length) { console.log('  (person_documents.person_type=enslaved by era:)'); ens.forEach(r => console.log(`    ${pad(r.era, 30)} ${r.docs}`)); }

    // ══════════════════════════════════════════════════════════════════════
    // E. #68  INDEX-PAGE CONTAMINATION
    // ══════════════════════════════════════════════════════════════════════
    sub('E. #68 Index-page contamination  —  enslaved-flag on 20th-c surrogate/admin pages');
    const flaggedOcr = await q(`
        SELECT pd.id, pd.document_year, pd.collection_key, pd.ocr_text, p.enslaved_count
        FROM person_documents pd
        JOIN probate_scrape_progress p ON p.person_document_id = pd.id
        WHERE p.collection_id = $1 AND p.enslaved_count > 0`, [COLLECTION_ID]);
    let idxLike = 0, noSlaveryTok = 0;
    const suspects = [];
    for (const r of flaggedOcr) {
        const txt = r.ocr_text || '';
        const isIdx = INDEX_TOKENS.test(txt);
        const hasTok = SLAVERY_TOKENS.test(txt);
        if (isIdx) idxLike++;
        if (!hasTok) noSlaveryTok++;
        if (isIdx || !hasTok) suspects.push({ id: r.id, y: r.document_year, ck: r.collection_key, idx: isIdx, tok: hasTok, n: r.enslaved_count });
    }
    console.log(`  Enslaved-flagged docs scanned:            ${flaggedOcr.length}`);
    console.log(`  ...matching 20th-c index/admin tokens:    ${idxLike} (${pct(idxLike, flaggedOcr.length)})   ← #68 false positives`);
    console.log(`  ...with NO slavery token in OCR at all:   ${noSlaveryTok} (${pct(noSlaveryTok, flaggedOcr.length)})   ← unsupported flag`);
    if (suspects.length) {
        console.log(`\n  Suspect enslaved-flags (top ${SAMPLE}):`);
        for (const s of suspects.slice(0, SAMPLE))
            console.log(`    doc ${rpad(s.id, 8)} y=${pad(s.y ?? '—', 6)} n=${s.n} ${s.idx ? '[INDEX]' : ''}${!s.tok ? '[no-slavery-token]' : ''} ${s.ck}`);
        if (suspects.length > SAMPLE) console.log(`    … and ${suspects.length - SAMPLE} more`);
    }

    // ══════════════════════════════════════════════════════════════════════
    // F. #70  ENSLAVED-NAME QUALITY
    // ══════════════════════════════════════════════════════════════════════
    sub('F. #70 Enslaved-name quality  —  unconfirmed_persons on NY documents');
    const names = await q(`
        SELECT up.full_name, up.confidence_score, up.data_quality_flags,
               COUNT(*)::int occ
        FROM unconfirmed_persons up
        WHERE up.person_type = 'enslaved'
          AND up.source_url IN (SELECT source_url FROM person_documents WHERE collection_key LIKE $1)
        GROUP BY up.full_name, up.confidence_score, up.data_quality_flags`, [DOC_LIKE]);
    const totalNames = names.reduce((a, r) => a + r.occ, 0);
    const isJunk = (nm) => {
        const t = (nm || '').toLowerCase().trim();
        return !t || t.length < 2 || /^[\d\W]+$/.test(t) || NAME_STOPWORDS.has(t) ||
               t.split(/\s+/).every(w => NAME_STOPWORDS.has(w));
    };
    const junk = names.filter(r => isJunk(r.full_name));
    const junkCount = junk.reduce((a, r) => a + r.occ, 0);
    const flaggedArtifact = names.filter(r => r.data_quality_flags && JSON.stringify(r.data_quality_flags).includes('name_artifact'))
                                 .reduce((a, r) => a + r.occ, 0);
    console.log(`  Total enslaved leads on NY docs:          ${totalNames}   (${names.length} distinct name/conf rows)`);
    console.log(`  Stopword/junk names:                      ${junkCount} (${pct(junkCount, totalNames)})   ← #70`);
    console.log(`  Already flagged data_quality name_artifact:${flaggedArtifact}`);
    // confidence distribution
    const confDist = {};
    for (const r of names) { const c = r.confidence_score == null ? 'null' : String(r.confidence_score); confDist[c] = (confDist[c] || 0) + r.occ; }
    console.log('  Confidence distribution (uniform ⇒ un-scored):');
    for (const [c, n] of Object.entries(confDist).sort((a, b) => b[1] - a[1])) console.log(`    conf=${pad(c, 8)} ${rpad(n, 6)} (${pct(n, totalNames)})`);
    if (junk.length) {
        console.log(`\n  Junk-name examples (top ${SAMPLE}):`);
        for (const r of junk.sort((a, b) => b.occ - a.occ).slice(0, SAMPLE)) console.log(`    "${pad(r.full_name, 22)}" × ${r.occ}`);
    }
    if (VERBOSE) {
        const top = names.filter(r => !isJunk(r.full_name)).sort((a, b) => b.occ - a.occ).slice(0, 20);
        console.log('\n  Top recurring first-names (Biscoe rule: distinct people, DO NOT auto-merge):');
        top.forEach(r => console.log(`    ${pad(r.full_name, 22)} × ${r.occ}`));
    }

    // ══════════════════════════════════════════════════════════════════════
    // G. ORPHAN / LINKAGE RATE
    // ══════════════════════════════════════════════════════════════════════
    sub('G. Orphan / linkage  —  are NY documents & enslavers connected or siloed?');
    const [orph] = await q(`
        SELECT COUNT(*)::int total,
          COUNT(*) FILTER (WHERE canonical_person_id IS NULL AND unconfirmed_person_id IS NULL)::int orphan,
          COUNT(*) FILTER (WHERE canonical_person_id IS NOT NULL)::int has_canon
        FROM person_documents WHERE collection_key LIKE $1`, [DOC_LIKE]);
    line('linked to a canonical person', orph.has_canon, orph.total);
    line('ORPHAN (no person of any kind)', orph.orphan, orph.total);
    const [enslr] = await q(`
        SELECT COUNT(DISTINCT cp.id)::int enslavers,
          COUNT(DISTINCT cp.id) FILTER (WHERE cp.death_year_estimate IS NOT NULL)::int has_death,
          COUNT(DISTINCT cp.id) FILTER (WHERE cp.primary_state IS NOT NULL)::int has_state,
          COUNT(DISTINCT cp.id) FILTER (WHERE cp.person_type = 'enslaver')::int typed_enslaver
        FROM person_documents pd
        JOIN canonical_persons cp ON cp.id = pd.canonical_person_id
        WHERE pd.collection_key LIKE $1`, [DOC_LIKE]);
    console.log(`\n  Distinct NY-linked canonical persons (testators): ${enslr.enslavers}`);
    line('  ...typed person_type=enslaver', enslr.typed_enslaver, enslr.enslavers);
    line('  ...with death_year_estimate', enslr.has_death, enslr.enslavers);
    line('  ...with primary_state', enslr.has_state, enslr.enslavers);
    const [bk] = await q(`
        WITH ny AS (
          SELECT DISTINCT cp.id FROM person_documents pd
          JOIN canonical_persons cp ON cp.id = pd.canonical_person_id
          WHERE pd.collection_key LIKE $1)
        SELECT (SELECT COUNT(*) FROM ny)::int total,
               (SELECT COUNT(*) FROM ny WHERE id IN (SELECT canonical_person_id FROM person_blocking_keys))::int keyed`, [DOC_LIKE]);
    line('  ...with ≥1 blocking key (dedup-able)', bk.keyed, bk.total);

    // ══════════════════════════════════════════════════════════════════════
    // H. IDENTITY / DEDUP READINESS
    // ══════════════════════════════════════════════════════════════════════
    sub('H. Identity / dedup readiness  —  duplicate NY testators');
    const dupes = await q(`
        SELECT cp.canonical_name, COUNT(DISTINCT cp.id)::int ids
        FROM person_documents pd JOIN canonical_persons cp ON cp.id = pd.canonical_person_id
        WHERE pd.collection_key LIKE $1 AND cp.canonical_name IS NOT NULL
        GROUP BY cp.canonical_name HAVING COUNT(DISTINCT cp.id) > 1
        ORDER BY ids DESC LIMIT $2`, [DOC_LIKE, SAMPLE]);
    const [dupAgg] = await q(`
        SELECT COUNT(*)::int name_groups, COALESCE(SUM(ids - 1),0)::int excess FROM (
          SELECT cp.canonical_name, COUNT(DISTINCT cp.id) ids
          FROM person_documents pd JOIN canonical_persons cp ON cp.id = pd.canonical_person_id
          WHERE pd.collection_key LIKE $1 AND cp.canonical_name IS NOT NULL
          GROUP BY cp.canonical_name HAVING COUNT(DISTINCT cp.id) > 1) s`, [DOC_LIKE]);
    console.log(`  Canonical-name groups with >1 id: ${dupAgg.name_groups}   (excess/likely-dupe ids: ${dupAgg.excess})`);
    console.log(`  NOTE: same name ≠ same person (Biscoe rule) — these are dedup CANDIDATES, not confirmed merges.`);
    if (dupes.length) { console.log(`  Top collisions (top ${SAMPLE}):`); dupes.forEach(r => console.log(`    ${pad(r.canonical_name, 34)} × ${r.ids} ids`)); }

    // ══════════════════════════════════════════════════════════════════════
    // I. FORENSIC FINANCIAL EXTRACTION COVERAGE
    // ══════════════════════════════════════════════════════════════════════
    sub('I. Forensic financial extraction  —  has the drip reached NY?');
    const nyRolls = `(SELECT DISTINCT roll_group_id FROM probate_scrape_progress WHERE collection_id = '${COLLECTION_ID}' AND roll_group_id IS NOT NULL)`;
    const [seg] = await q(`SELECT COUNT(*)::int n, COUNT(DISTINCT roll_group_id)::int rolls FROM probate_estate_segments_v2 WHERE roll_group_id IN ${nyRolls}`);
    const [ext] = await q(`SELECT COUNT(*)::int n, COUNT(DISTINCT roll_group_id)::int rolls,
        COALESCE(SUM(enslaved_count),0)::int enslaved, COALESCE(SUM(enslaved_valued_count),0)::int valued,
        ROUND(COALESCE(SUM(total_appraised_usd),0)::numeric,2) usd
        FROM probate_estate_extractions WHERE roll_group_id IN ${nyRolls}`);
    const idxRows = await q(`
        SELECT COUNT(*)::int total,
          COUNT(*) FILTER (WHERE slavery_era)::int slavery_era,
          COUNT(*) FILTER (WHERE name_suspect)::int name_suspect,
          COUNT(*) FILTER (WHERE year_plausible = false)::int year_implausible,
          COUNT(*) FILTER (WHERE canonical_person_id IS NOT NULL)::int linked,
          COUNT(*) FILTER (WHERE estate_extraction_id IS NOT NULL)::int extracted
        FROM probate_estate_index WHERE region = 'new-york' OR state = 'NY'`);
    const ix = idxRows[0] || {};
    console.log(`  probate_estate_segments_v2  (NY rolls): ${seg.n} segments across ${seg.rolls} rolls`);
    console.log(`  probate_estate_extractions  (NY rolls): ${ext.n} estates across ${ext.rolls} rolls`);
    console.log(`     → enslaved persons: ${ext.enslaved}   valued: ${ext.valued}   total appraised: $${ext.usd}`);
    console.log(`  probate_estate_index        (NY):       ${ix.total || 0} estate rows`);
    console.log(`     → slavery_era: ${ix.slavery_era || 0}   name_suspect(flag): ${ix.name_suspect || 0}   year_implausible: ${ix.year_implausible || 0}`);
    console.log(`     → linked to canonical: ${ix.linked || 0}   with forensic extraction: ${ix.extracted || 0}`);
    if (!ext.n) console.log('  ⚠  Zero NY forensic extractions — the financial product does NOT yet cover NY.');

    // ══════════════════════════════════════════════════════════════════════
    // J. EXTERNAL-ASSERTION GATE
    // ══════════════════════════════════════════════════════════════════════
    sub('J. External-assertion gate  —  assertable flags vs stored proposition documents');
    const [gate] = await q(`
        SELECT COUNT(DISTINCT cp.id)::int total,
          COUNT(DISTINCT cp.id) FILTER (WHERE cp.assertable_slaveowner)::int assertable_owner,
          COUNT(DISTINCT cp.id) FILTER (WHERE cp.assertable_enslaved)::int assertable_enslaved
        FROM person_documents pd JOIN canonical_persons cp ON cp.id = pd.canonical_person_id
        WHERE pd.collection_key LIKE $1`, [DOC_LIKE]);
    console.log(`  NY-linked canonicals:                     ${gate.total}`);
    console.log(`  assertable_slaveowner = TRUE:             ${gate.assertable_owner} (${pct(gate.assertable_owner, gate.total)})`);
    console.log(`  assertable_enslaved   = TRUE:             ${gate.assertable_enslaved}`);
    // assertable owners that LACK any s3-archived proposition document → gate violation
    const [viol] = await q(`
        SELECT COUNT(DISTINCT cp.id)::int bad
        FROM canonical_persons cp
        WHERE cp.assertable_slaveowner = TRUE
          AND cp.id IN (SELECT canonical_person_id FROM person_documents WHERE collection_key LIKE $1 AND canonical_person_id IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM person_documents d WHERE d.canonical_person_id = cp.id AND d.s3_key IS NOT NULL)`, [DOC_LIKE]);
    console.log(`  assertable owners with NO S3-stored doc:  ${viol.bad}   ${viol.bad ? '← GATE VIOLATION' : '(gate sound)'}`);

    // ══════════════════════════════════════════════════════════════════════
    // K. CONSISTENCY CROSS-CHECKS
    // ══════════════════════════════════════════════════════════════════════
    sub('K. Consistency cross-checks');
    const [cc1] = await q(`
        SELECT COUNT(*)::int mismatched
        FROM probate_scrape_progress p JOIN person_documents pd ON pd.id = p.person_document_id
        WHERE p.collection_id = $1 AND p.enslaved_count > 0
          AND NOT EXISTS (SELECT 1 FROM unconfirmed_persons up WHERE up.source_url = pd.source_url AND up.person_type = 'enslaved')`, [COLLECTION_ID]);
    console.log(`  enslaved_count>0 but 0 enslaved leads extracted: ${cc1.mismatched}   (count/extraction mismatch)`);
    const [cc2] = await q(`
        SELECT COUNT(*)::int unlinked FROM probate_scrape_progress p
        JOIN person_documents pd ON pd.id = p.person_document_id
        WHERE p.collection_id = $1 AND p.status='written' AND p.testator_name IS NOT NULL AND pd.canonical_person_id IS NULL`, [COLLECTION_ID]);
    console.log(`  written w/ testator_name but no canonical link: ${cc2.unlinked}`);
    const [cc3] = await q(`SELECT COUNT(*)::int no_s3 FROM person_documents WHERE collection_key LIKE $1 AND s3_key IS NULL`, [DOC_LIKE]);
    console.log(`  NY documents with no S3 image key (unarchived): ${cc3.no_s3} (${pct(cc3.no_s3, T)})`);
    const [cc4] = await q(`SELECT COUNT(*)::int dup FROM (
        SELECT source_url FROM person_documents WHERE collection_key LIKE $1 AND source_url IS NOT NULL
        GROUP BY source_url HAVING COUNT(*) > 1) s`, [DOC_LIKE]);
    console.log(`  duplicate source_url rows (double-written pages): ${cc4.dup}`);

    // ══════════════════════════════════════════════════════════════════════
    // L. PERSON-LEAD CONSTRUCTION PARITY
    //    Are we building out ONLY enslavers + enslaved, leaving every other
    //    role named in these records (heirs, executors, witnesses, spouses,
    //    non-enslaving decedents) as un-constructed text? Selection bias check.
    // ══════════════════════════════════════════════════════════════════════
    sub('L. Person-lead construction parity  —  who gets built vs who stays text');

    // L.1 — persons constructed FROM the NY probate corpus, by type
    const nyCanonTypes = await q(`
        SELECT cp.person_type, COUNT(DISTINCT cp.id)::int n
        FROM person_documents pd JOIN canonical_persons cp ON cp.id = pd.canonical_person_id
        WHERE pd.collection_key LIKE $1 GROUP BY cp.person_type ORDER BY n DESC`, [DOC_LIKE]);
    const nyLeadTypes = await q(`
        SELECT up.person_type, COUNT(*)::int n
        FROM unconfirmed_persons up
        WHERE up.source_url IN (SELECT source_url FROM person_documents WHERE collection_key LIKE $1)
        GROUP BY up.person_type ORDER BY n DESC`, [DOC_LIKE]);
    console.log('  NY-derived CANONICAL persons by type:');
    if (!nyCanonTypes.length) console.log('    (none)');
    for (const r of nyCanonTypes) console.log(`    ${pad(r.person_type || '(null)', 24)} ${r.n}`);
    console.log('  NY-derived UNCONFIRMED leads by type:');
    if (!nyLeadTypes.length) console.log('    (none)');
    for (const r of nyLeadTypes) console.log(`    ${pad(r.person_type || '(null)', 24)} ${r.n}`);

    // L.2 — heirs: named in wills, but built as persons?  inheritance_edges is
    //       the only channel a NON-enslaver/non-enslaved probate person enters.
    const [ie] = await q(`
        SELECT COUNT(*)::int edges, COUNT(DISTINCT ie.heir_id)::int heirs
        FROM inheritance_edges ie
        WHERE ie.source_document_id IN (SELECT id FROM person_documents WHERE collection_key LIKE $1)`, [DOC_LIKE]);
    console.log(`\n  Heirs constructed from NY wills (inheritance_edges): ${ie.edges} edges, ${ie.heirs} distinct heirs`);
    console.log(`  NY 'will' documents: 26,702 → heir-construction rate is the non-enslaver-role coverage.`);

    // L.3 — the ratio, stated plainly for NY
    const builtEnsl = nyCanonTypes.filter(r => r.person_type === 'enslaver').reduce((a, r) => a + r.n, 0);
    const builtEnslaved = nyLeadTypes.filter(r => r.person_type === 'enslaved').reduce((a, r) => a + r.n, 0);
    const builtOther = nyCanonTypes.filter(r => r.person_type !== 'enslaver').reduce((a, r) => a + r.n, 0)
                     + nyLeadTypes.filter(r => r.person_type !== 'enslaved').reduce((a, r) => a + r.n, 0)
                     + ie.heirs;
    console.log(`\n  NY persons built:  enslaver=${builtEnsl}  enslaved=${builtEnslaved}  every-other-role≈${builtOther}`);
    console.log(`  → ${pct(builtOther, builtEnsl + builtEnslaved + builtOther)} of constructed NY persons are non-(enslaver|enslaved).`);

    // L.4 — DB-WIDE person-type census (the user's "across various places" worry)
    const cpCensus = await q(`SELECT person_type, COUNT(*)::int n FROM canonical_persons GROUP BY person_type ORDER BY n DESC`);
    const upCensus = await q(`SELECT person_type, COUNT(*)::int n FROM unconfirmed_persons GROUP BY person_type ORDER BY n DESC`);
    const cpTot = cpCensus.reduce((a, r) => a + r.n, 0), upTot = upCensus.reduce((a, r) => a + r.n, 0);
    console.log('\n  DB-WIDE canonical_persons by type:');
    for (const r of cpCensus) console.log(`    ${pad(r.person_type || '(null)', 24)} ${rpad(r.n, 9)} (${pct(r.n, cpTot)})`);
    console.log('  DB-WIDE unconfirmed_persons by type (top 12):');
    for (const r of upCensus.slice(0, 12)) console.log(`    ${pad(r.person_type || '(null)', 24)} ${rpad(r.n, 9)} (${pct(r.n, upTot)})`);
    const descendants = cpCensus.filter(r => /descend|modern|participant|free/i.test(r.person_type || '')).reduce((a, r) => a + r.n, 0);
    console.log(`\n  Canonical persons of a NON-perpetrator/non-victim class (descendant/modern/free/participant): ${descendants} (${pct(descendants, cpTot)})`);

    hdr('AUDIT COMPLETE');
    console.log('  All checks read-only. Re-run with --verbose for name/era detail, --limit N for sample size.\n');
    await pool.end();
}

main().catch(e => { console.error('FATAL:', e.message); console.error(e.stack); process.exit(1); });
