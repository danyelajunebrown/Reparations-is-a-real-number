#!/usr/bin/env node
/**
 * record-walk.mjs — find a CLIMBABLE seed for a participant whose intake FS IDs dead-ended.
 *
 * Generalises scripts/climb/public-record-bridge.mjs from a hardcoded family to
 * any participant, and adds the piece that made the hardcoded version work:
 * disambiguators.
 *
 * THE DERIVATION (why this needs nothing new from the participant).
 * The bridge scores a candidate public record by whether it names a known
 * SPOUSE (+3) or known CHILD (+3) of the target; >=3 is CONFIRMED, below that is
 * CANDIDATE-needs-review. Those were hand-typed constants. But for a grandparent
 * they are already implied by the family structure we hold:
 *     known CHILD  = the participant's parent on that line
 *     known SPOUSE = the other grandparent in the same pair
 * So a form that only asks "name your parents and grandparents" already contains
 * the disambiguators — they just have to be inferred rather than requested.
 *
 * Pairing comes from `lineage_hint` (the participant's own "whom is their child
 * or inheritor?" answer) when present. It is NEVER guessed from column position:
 * checked against the 2026-08-03 export, positional labels put a woman in the
 * 'father' slot in 4 of 6 submissions. Where the hint is absent we fall back to
 * ALL parents as candidate children, which costs precision, not correctness.
 *
 * Output is a great-grandparent name + FS ID = a climb seed one generation above
 * the living wall. The matched record doubles as the kinship document for that
 * edge (standard-genealogical-edge-evidence tier 1).
 *
 * PII: reads participant_family. Prints only counts, tiers and FS IDs.
 * Runs ON THE MINI (needs the logged-in Chrome :9222). One FS scraper at a time.
 *
 * Usage (on the Mini, from the repo root):
 *   node scripts/pii/record-walk.mjs --participant <uuid> [--apply]
 */

import pptr from 'puppeteer';
import pg from 'pg';
import 'dotenv/config';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const PARTICIPANT = arg('--participant');
const APPLY = argv.includes('--apply');
if (!PARTICIPANT) { console.error('usage: --participant <uuid> [--apply]'); process.exit(1); }

const norm = s => (s || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const fam = (await pool.query(
  `SELECT relationship, full_name, birth_year, birthplace, fs_id, is_living, lineage_hint, source_block_index
     FROM participant_family WHERE participant_id = $1 ORDER BY source_block_index`, [PARTICIPANT])).rows;

const parents = fam.filter(f => f.relationship.startsWith('parent'));
const grands  = fam.filter(f => f.relationship.startsWith('grandparent'));

// Targets: grandparents with no usable climb seed — living, or no FS ID, or an
// FS ID that duplicates another block (the copy-paste failure mode).
const seen = new Map();
for (const f of fam) if (f.fs_id) seen.set(f.fs_id, (seen.get(f.fs_id) || 0) + 1);
const targets = grands.filter(g => g.is_living !== false || !g.fs_id || seen.get(g.fs_id) > 1);

const report = [];
if (!targets.length) {
  console.log(JSON.stringify({ participant: PARTICIPANT, targets: 0, note: 'every grandparent already has a usable seed' }));
  await pool.end(); process.exit(0);
}

/**
 * Country is DERIVED from the person's stated birthplace, never assumed.
 *
 * The first run hardcoded `f.recordCountry=United States` and returned 23 records
 * with 0 confirmed — for a participant whose grandparents were Italian-born. US
 * collections do not hold their vital records, so the filter guaranteed a null
 * result and would have been logged as "not found" rather than "wrong index".
 *
 * When the birthplace does not name a country we emit NO country filter and let
 * FamilySearch search globally. A wider search is noisier, but noise is
 * recoverable and a wrongly-scoped null is not.
 */
const COUNTRY_HINTS = [
  [/\b(italy|italia|sicil|calabria|napoli|roma|milano)\b/i, 'Italy'],
  [/\b(mexico|méxico|jalisco|oaxaca|chihuahua|michoac)\b/i, 'Mexico'],
  [/\b(puerto rico|ponce|mayag)\b/i, 'Puerto Rico'],
  [/\b(india|punjab|delhi|chandigarh|kerala)\b/i, 'India'],
  [/\b(ireland|eire)\b/i, 'Ireland'],
  [/\b(england|scotland|wales|united kingdom|uk)\b/i, 'England'],
  [/\b(germany|deutschland|bayern|prussia)\b/i, 'Germany'],
  [/\b(u\.?s\.?a?|united states|america)\b/i, 'United States'],
];
const US_STATE = /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b|\b(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)\b/;

function inferCountry(place) {
  const s = String(place || '');
  if (!s.trim()) return null;
  for (const [re, country] of COUNTRY_HINTS) if (re.test(s)) return country;
  if (US_STATE.test(s)) return 'United States';
  return null;                                   // unknown → search globally
}

const searchUrl = (given, surname, place, birth) => {
  const p = new URLSearchParams({ 'q.givenName': given, 'q.surname': surname });
  const country = inferCountry(place);
  if (country) p.set('f.recordCountry', country);
  if (place) p.set('q.birthLikePlace', place);
  if (birth) { p.set('q.birthLikeDate.from', String(birth - 3)); p.set('q.birthLikeDate.to', String(birth + 3)); }
  return 'https://www.familysearch.org/search/record/results?' + p.toString();
};

const browser = await pptr.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
const page = await browser.newPage();
let searches = 0;

try {
  for (const g of targets) {
    const nameParts = String(g.full_name || '').trim().split(/\s+/);
    if (nameParts.length < 2) { report.push({ block: g.source_block_index, status: 'SKIPPED_UNUSABLE_NAME' }); continue; }
    const given = nameParts[0], surname = nameParts[nameParts.length - 1];

    // Derive the disambiguators from structure (see header).
    const hint = g.lineage_hint;                                   // e.g. "Parent 1"
    const childCandidates = hint
      ? parents.filter(p => (hint.match(/\d/) || [])[0] === String(p.source_block_index + 1))
      : parents;
    const knownChildren = childCandidates.map(p => p.full_name).filter(Boolean);
    const knownSpouses  = grands.filter(o => o.source_block_index !== g.source_block_index &&
                                             o.lineage_hint && o.lineage_hint === hint)
                                .map(o => o.full_name).filter(Boolean);

    if (searches > 0) { const w = 20000 + (searches % 3) * 7000; await sleep(w); }
    searches++;

    await page.goto(searchUrl(given, surname, g.birthplace, g.birth_year),
                    { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await sleep(7000);

    // STOP on CAPTCHA/logout rather than hammer — a tight loop previously tripped
    // FamilySearch's bot detection AND wiped an operator's in-progress login.
    const blocked = await page.evaluate(() =>
      /login|ident|signin/i.test(location.href) ||
      /verify you are human|captcha|unusual traffic/i.test(document.body.innerText)).catch(() => false);
    if (blocked) { report.push({ block: g.source_block_index, status: 'ABORTED_FS_CHALLENGE' }); break; }

    const rows = await page.evaluate(() => {
      const out = [], seen = new Set();
      document.querySelectorAll('a[href*="/ark:/61903/"]').forEach(a => {
        const row = a.closest('tr, li, [class*="result"], [class*="Row"]') || a.parentElement;
        const txt = (row?.textContent || '').replace(/\s+/g, ' ').trim();
        if (!txt || seen.has(txt.slice(0, 50))) return;
        seen.add(txt.slice(0, 50));
        const grab = l => { const m = txt.match(new RegExp(l + '\\s+([^]*?)(?:Spouses|Children|Siblings|Parents|Birth|Marriage|Residence|Death|More|$)', 'i')); return m ? m[1].trim().slice(0, 120) : null; };
        out.push({ text: txt.slice(0, 240), ark: (a.href.match(/\/ark:\/61903\/[^?#"]+/) || [])[0] || null,
                   collection: (txt.match(/"([^"]+)"/) || [])[1] || null,
                   parents: grab('Parents'),
                   birthYear: (txt.match(/Birth\s+((?:18|19|20)\d{2})/i) || [])[1] || null });
      });
      return out;
    }).catch(() => []);

    // Score exactly as the proven bridge does.
    const scored = rows.map(r => {
      const hay = norm(r.text); let score = 0; const why = [];
      for (const s of knownSpouses)  if (norm(s).length > 4 && hay.includes(norm(s))) { score += 3; why.push('spouse'); break; }
      for (const c of knownChildren) if (norm(c).length > 4 && hay.includes(norm(c))) { score += 3; why.push('child');  break; }
      if (g.birth_year && r.birthYear && Math.abs(+r.birthYear - g.birth_year) <= 3) { score += 1; why.push('birthyr'); }
      return { ...r, score, why };
    }).sort((a, b) => b.score - a.score);

    const confirmed = scored.filter(r => r.score >= 3 && r.parents);
    const candidate = scored.filter(r => r.score < 3 && r.parents && r.birthYear &&
                                    g.birth_year && Math.abs(+r.birthYear - g.birth_year) <= 2);

    report.push({
      block: g.source_block_index,
      disambiguators: { spouses: knownSpouses.length, children: knownChildren.length },
      records: rows.length,
      CONFIRMED: confirmed.length,
      CANDIDATE: candidate.length,
      // Names of the recovered generation stay OUT of stdout; only the count and
      // the archival ARK (a public record identifier) are emitted.
      seeds: confirmed.slice(0, 3).map(r => ({ ark: r.ark, collection: (r.collection || '').slice(0, 40) })),
    });

    if (APPLY && confirmed.length) {
      for (const r of confirmed.slice(0, 3)) {
        await pool.query(
          `INSERT INTO research_findings (question, repository, index_searched, result, hit_count, evidence_note, searched_by)
           VALUES ($1,$2,$3,'found',$4,$5,'record-walk')`,
          [`Who are the parents of grandparent block ${g.source_block_index}?`,
           'FamilySearch indexed public records', r.collection || 'record search', 1,
           `participant ${PARTICIPANT} block ${g.source_block_index}; ark ${r.ark}; parents named in record; score ${r.score} (${r.why.join(',')})`]);
      }
    }
  }
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}

console.log(JSON.stringify({ participant: PARTICIPANT, targets: targets.length, searches, applied: APPLY }));
for (const x of report) console.log(JSON.stringify(x));
await pool.end();
