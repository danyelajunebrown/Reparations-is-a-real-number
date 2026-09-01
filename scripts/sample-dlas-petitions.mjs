// sample-dlas-petitions.mjs — STEP 3 of the O-of-O: measure what a DLAS petition ACTUALLY contains before
// designing an ingest around what we assume it contains.
//
// WHY THIS EXISTS (operator, 2026-08-20): "we don't even know the extent of what this information can mean
// in this dataset for our schemas — how are you going to read and analyze before pigeonholing expectations
// for the holdings?"
//
// That warning was earned. Five times in one session I asserted the shape of something without looking:
// Albany NY "structurally cannot yield" (it is the 2nd-richest county we hold), the colonial-settlers site
// as "unsourced kinship" (it is densely cited), "135 evidenced decedents unlinked" (an exact-string match
// failing on a period; 239 of 243 were on the spine), "harm_events blocks the Shepherd chain" (the real
// blocker was that Virginia probate was never scraped), and "68% of DLAS has no home in our schema"
// (person_facts already carried manumission/escape/free_status/occupation). Designing an ingest for 17,487
// petitions and ~150,000 people around a sixth such guess would bake it in permanently.
//
// SO THIS WRITES NO PEOPLE. It samples, it measures field population, and it reports. Nothing else.
//
// SAMPLING FRAME — deliberately spread, not convenience. A convenience sample of one county in one decade
// would tell us about that county. The corpus spans 15 states + DC, legislative AND county courts,
// 1775-1867. So the frame draws across state, court type and decade, and REPORTS the frame it achieved so
// the next reader can judge it.
//
// POLITENESS: dlas.uncg.edu/robots.txt has every rule commented out — no AI restriction, no disallowed
// paths, no crawl-delay for us (the 30s delay applies to gsa-crawler variants). We still pace at ~1 req/sec
// with a contactable UA, because a scholarly project run by a university library deserves that.
//
// Usage:
//   node scripts/sample-dlas-petitions.mjs --n 200            # sample and report
//   node scripts/sample-dlas-petitions.mjs --n 200 --save     # also persist the field census

import 'dotenv/config';
import pg from 'pg';

const A = process.argv.slice(2);
const val = (f, d) => { const i = A.indexOf(f); return i > -1 ? A[i + 1] : d; };
const N = +val('--n', 200);
const SAVE = A.includes('--save');
const UA = 'reparations-research/1.0 (db7613@bard.edu; academic reparations research; contact welcome)';
const BASE = 'https://dlas.uncg.edu';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// STRATIFIED FRAME, not seed-word luck.
// The first 200-petition run came back 84% LEGISLATIVE against a corpus that is 83% COUNTY COURT, and
// Delaware drew 56/200. Seed words sample whatever the relevance ranker likes, which is not the corpus.
// The search form exposes real facets, discovered 2026-08-20:
//     l / st = state (16 + DC)   ·   y = decade (177=1770s .. 186=1860s)   ·   r = PERSON ROLE
//     r: 1 petitioner · 2 defendant · 3 ENSLAVED · 4 FPOC · 5 ENSLAVED OWNER · 10001 unknown
// So we walk state x decade and pull with r=3 (enslaved). A role facet for enslaved people is a better
// axis than court type anyway: it selects the petitions that NAME the people this project exists to name.
// Results cap at 25 per query, which is fine — we want spread, not depth.
const STATES = ['al','ar','de','dc','fl','ga','ky','la','md','ms','mo','nc','sc','tn','tx','va'];
const DECADES = ['177','178','179','180','181','182','183','184','185','186'];
const ROLE_ENSLAVED = '3';

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`http ${r.status}`);
  return r.text();
}

const strip = (h) => h.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

// Field probes. Each asks: does THIS petition carry this? We are measuring POPULATION, not extracting.
const PROBES = {
  petition_id:        (t) => /Petition\s*(Analysis\s*)?(Number|#)?\s*:?\s*\d{6,}/i.test(t),
  state_county:       (t) => /\b(District|County|Parish)\b/i.test(t),
  filing_date:        (t) => /\b(1[78]\d{2})\b/.test(t),
  court:              (t) => /\b(Equity|Chancery|Superior|County Court|Legislature|General Assembly|Circuit)\b/i.test(t),
  result:             (t) => /\b(granted|denied|dismissed|no reply|partially granted|rejected)\b/i.test(t),
  salutation:         (t) => /To the Honorable|humbly (shew|show)|Your (orators|petitioners)/i.test(t),
  abstract_narrative: (t) => t.length > 1200,
  enslaved_count:     (t) => /enslaved\s*(persons?|people)?\s*[:\-]?\s*\d+|\d+\s+enslaved/i.test(t),
  fpoc_mentioned:     (t) => /free (person|people|man|woman|negro|black)|FPOC|free people of color/i.test(t),
  named_parties:      (t) => /(petitioner|defendant|plaintiff|orator|executor|administrator)s?\b/i.test(t),
  named_enslaved:     (t) => /\b(a )?(negro|slave|enslaved) (man|woman|girl|boy|named)\b|named\s+[A-Z][a-z]+/i.test(t),
  money_values:       (t) => /\$\s?\d|£\s?\d|\d+\s*dollars/i.test(t),
  hiring_value:       (t) => /hire|hiring/i.test(t),
  sale_price:         (t) => /sold|sale|purchase|auction/i.test(t),
  subjects_tagged:    (t) => /(Subjects?|Topics?)\s*:/i.test(t) || /\(enslaved\)|\(FPOC\)/.test(t),
  repository_cite:    (t) => /Archives|Historical Society|Library|Reel|Microfilm|Box|Folder/i.test(t),
  related_documents:  (t) => /Deposition|Order|Oath|Bond|Will|Inventory|Bill of Sale|Affidavit|Decree/i.test(t),
  depositions:        (t) => /Deposition/i.test(t),
  crops_commodity:    (t) => /cotton|rice|tobacco|sugar|timber/i.test(t),
  freedom_seeking:    (t) => /sue[sd]? for freedom|freedom suit|manumit|manumission|emancipat|purchase[d]? (his|her|their) (own )?freedom/i.test(t),
  violence_harm:      (t) => /whip|beat|assault|murder|cruel|abuse|kidnap|jail|imprison/i.test(t),
};

async function main() {
  console.log(`sampling up to ${N} DLAS petitions, stratified across ${STATES.length} states x ${DECADES.length} decades, role=enslaved (~1 req/sec)\n`);

  // ── walk state x decade, filtered to petitions with an ENSLAVED party ──
  const ids = new Set();
  const cells = [];
  for (const st of STATES) for (const y of DECADES) cells.push([st, y]);
  // interleave so an early stop still spans states rather than finishing Alabama
  cells.sort((a, b) => (a[1] === b[1] ? 0 : a[1] < b[1] ? -1 : 1));
  const perCell = Math.max(2, Math.ceil((N * 1.3) / cells.length));
  let cellsHit = 0;
  for (const [st, y] of cells) {
    if (ids.size >= N * 1.3) break;
    try {
      const html = await get(`${BASE}/petitions/?s=&t=1&st=${st}&l=${st}&y=${y}&r=${ROLE_ENSLAVED}`);
      const found = [...new Set([...html.matchAll(/\/petitions\/petition\/(\d+)/g)].map((m) => m[1]))];
      found.slice(0, perCell).forEach((i) => ids.add(i));
      if (found.length) { cellsHit++; console.log(`  ${st.toUpperCase()} ${y}0s: ${found.length} hits, total ${ids.size}`); }
    } catch (e) { /* empty cell is a valid answer */ }
    await sleep(900);
  }
  console.log(`\nframe: ${cellsHit} of ${cells.length} state x decade cells returned petitions`);

  const list = [...ids].slice(0, N);
  console.log(`\nfetching ${list.length} petitions…`);

  const census = Object.fromEntries(Object.keys(PROBES).map((k) => [k, 0]));
  const frame = { state: {}, decade: {}, court: {} };
  let ok = 0, err = 0, totalChars = 0;

  for (const id of list) {
    try {
      const t = strip(await get(`${BASE}/petitions/petition/${id}/`));
      ok++; totalChars += t.length;
      for (const [k, fn] of Object.entries(PROBES)) if (fn(t)) census[k]++;
      const st = (t.match(/\b(Alabama|Arkansas|Delaware|Florida|Georgia|Kentucky|Louisiana|Maryland|Mississippi|Missouri|North Carolina|South Carolina|Tennessee|Texas|Virginia|District of Columbia)\b/) || [])[1];
      if (st) frame.state[st] = (frame.state[st] || 0) + 1;
      const yr = (t.match(/\b(1[78]\d{2})\b/) || [])[1];
      if (yr) { const d = Math.floor(+yr / 10) * 10; frame.decade[d] = (frame.decade[d] || 0) + 1; }
      const ct = (t.match(/\b(Equity|Chancery|Superior|County Court|Legislature|General Assembly|Circuit)\b/i) || [])[1];
      if (ct) frame.court[ct] = (frame.court[ct] || 0) + 1;
    } catch (e) { err++; }
    if (ok % 25 === 0 && ok) process.stdout.write(`\r  ${ok} fetched, ${err} errors   `);
    await sleep(1000);
  }

  console.log(`\n\n════ FIELD CENSUS — % of ${ok} sampled petitions carrying each element ════`);
  for (const [k, v] of Object.entries(census).sort((a, b) => b[1] - a[1])) {
    const p = ok ? Math.round((v / ok) * 100) : 0;
    console.log(`  ${String(p).padStart(3)}%  ${'█'.repeat(Math.round(p / 4)).padEnd(25)} ${k}`);
  }
  console.log(`\n  mean text length: ${ok ? Math.round(totalChars / ok) : 0} chars`);

  console.log('\n════ FRAME ACHIEVED (judge the sample before trusting the census) ════');
  for (const [dim, counts] of Object.entries(frame)) {
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log(`  ${dim}: ${top.map(([k, v]) => `${k}=${v}`).join('  ')}`);
  }

  if (SAVE) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    pool.on('error', (e) => console.error('[pool]', e.message));
    await pool.query(
      `INSERT INTO research_findings (question, repository, index_searched, result, hit_count, evidence_note, searched_by)
       VALUES ($1,$2,$3,'partial',$4,$5,'sample-dlas-petitions')`,
      ['What does a DLAS petition actually contain, and which fields populate often enough to build an ingest on?',
       'Digital Library on American Slavery (UNCG) — Race and Slavery Petitions Project',
       `stratified sample: ${STATES.length} states x ${DECADES.length} decades, role=enslaved; ${ok} petitions fetched`, ok,
       `FIELD CENSUS ${JSON.stringify(census)} FRAME ${JSON.stringify(frame)} — measured BEFORE designing an ingest, per the O-of-O in standard-assertion-store-and-inference-decisions.md §5.`]);
    console.log('\n✓ field census saved to research_findings');
    await pool.end();
  }
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
