// sample-marronnage-ads.mjs — O-of-O STEP 3 for Le marronnage dans le monde atlantique (CNRS/EHESS).
// Measure what a marronnage ad ACTUALLY carries before designing an ingest around what we assume.
//
// THIS WRITES NO PEOPLE. It samples, measures field population, and reports. Per
// standard-assertion-store-and-inference-decisions.md §5, adopted after five asserted-absences in one day.
//
// WHAT THE SOURCE IS
//   22,485 runaway/marronnage notices, 1765-1833, from 21 newspapers across 7 colonies:
//   Saint-Domingue, Louisiane, Caroline du Sud, Jamaïque, Guadeloupe, Guyane française, Bas-Canada.
//   Directed by Myriam Cottias (EHESS/CNRS) and Laurent Dubois (Duke); v2.0 launched 2019 at the
//   "Enslaved: People of the Historical Slave Trade" conference — i.e. an Enslaved.org sibling, so their
//   Q-IDs may give us a dedup path into a corpus we already hold.
//
// WHY THIS SOURCE IS UNLIKE EVERYTHING ELSE WE HOLD
//   A probate inventory records a person as property at the moment of a transfer. A runaway ad records
//   a person REFUSING that, and — because the enslaver wanted them caught — it describes them in
//   detail no inventory ever does:
//       "Un Negre nouveau, nation Congo, étampé Ch, est maron depuis trois semaines" (id=117)
//   In one sentence: African origin (Congo), recency of arrival (nouveau = bossale, not creole),
//   a BRAND burned into the skin reading "Ch" — the enslaver's own initials, i.e. the mark of ownership
//   IS the mark of harm — and the duration of self-liberation. The Quebec Gazette ad for Drummond adds
//   "walks heavily", a disability recorded only because it made him identifiable.
//   These are harm_events and person_facts, not decoration. The ad is the enslaver testifying against
//   himself, which is the strongest evidence class we have.
//
// THE MEASUREMENT THAT MATTERS MOST: the `noms` index.
//   The search form has a curated `noms` facet, and its result phrasing is "incluant une ou un esclave
//   nommé X" — a structured index OF THE ENSLAVED PERSON'S NAME, held separately from the transcription.
//   But noms=Drummond returns 0 while the Drummond ad plainly exists. So the index does NOT cover the
//   whole corpus, and its coverage is precisely the thing that decides whether we can ingest named people
//   deterministically or must parse names out of free text (which is where fabrication risk lives).
//   MEASURE IT. Do not assume it.
//
// ACCESS POSTURE (§6, checked before the first request)
//   robots.txt is the stock Mandriva Apache default from 2007 — no AI clause, no crawl-delay, and nothing
//   covering /fr/ or document.php. It DOES `Disallow: /images/`, which we honour; the scans happily live
//   under /documents/, so rule 8 (S3 + Wayback) is satisfiable on the actual newspaper page. We pace at
//   ~1.2 req/sec with a contactable UA because this is a small scholarly server run on public money.
//
// ENDPOINT NOTE (cost me two failed requests, recorded so nobody repeats it)
//   The form posts to `resultats.php` RELATIVE to /fr/recherche.php → /fr/resultats.php. Posting to the
//   site root 404s. Payload is exactly $('#frminterroger').serializeArray(), so the submit button is NOT
//   sent, and minyear/maxyear are readonly slider-populated fields — sending them EMPTY 500s the server.
//   Their bounds are MinYear=1765, MaxYear=1833.
//
// Usage:
//   node scripts/sample-marronnage-ads.mjs --n 200
//   node scripts/sample-marronnage-ads.mjs --n 200 --save

import 'dotenv/config';
import pg from 'pg';

const A = process.argv.slice(2);
const val = (f, d) => { const i = A.indexOf(f); return i > -1 ? A[i + 1] : d; };
const N = +val('--n', 200);
const SAVE = A.includes('--save');
const UA = 'reparations-research/1.0 (db7613@bard.edu; academic reparations research; contact welcome)';
const BASE = 'http://www.marronnage.info/fr';
const MIN_YEAR = 1765, MAX_YEAR = 1833;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The site's own facet vocabulary — read off the search form, not invented here.
const LOCATIONS = ['Saint-Domingue', 'Louisiane', 'Caroline du Sud', 'Jamaïque', 'Guadeloupe',
                   'Guyane française', 'Bas-Canada'];

async function post(body) {
  const r = await fetch(`${BASE}/resultats.php`, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest',
               'Referer': `${BASE}/recherche.php`,
               'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body, signal: AbortSignal.timeout(45000),
  });
  if (!r.ok) throw new Error(`http ${r.status}`);
  return r.text();
}
async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`http ${r.status}`);
  return r.text();
}
const q = (o) => new URLSearchParams({ motscles: '', noms: '', location: '-1', newspaper: '-1',
  minyear: String(MIN_YEAR), maxyear: String(MAX_YEAR), page: '1', ...o }).toString();
const strip = (h) => h.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

// ── PROBES ───────────────────────────────────────────────────────────────────────────────────────────
// Bilingual (French colonies + anglophone Jamaica/Carolina/Quebec). Each asks only: is this PRESENT?
// We are measuring population, not extracting. A probe that fires is a column we could fill; a probe that
// never fires is a finding about the archive, not a bug.
const PROBES = {
  // identity
  named_enslaved:    (t) => /\bnomm[ée]e?\s+[A-Z]|\bnamed\s+[A-Z]|\bcalled\s+[A-Z]|\bse disant\s+[A-Z]/.test(t),
  enslaver_named:    (t) => /\bappartient\s+à\b|\bappartenant\b|\bà\s+M\.|\bsubscriber\b|\bhis (master|owner)\b|\bproperty of\b|\bM[rm]s?\.\s+[A-Z]/i.test(t),
  age_given:         (t) => /\b[âa]g[ée]e?\s+d[e']\s*\d+|\baged?\s+(about\s+)?\d+|\b\d+\s*(ans|years old)\b/i.test(t),
  sex_marked:        (t) => /\bn[ée]gresse\b|\bmul[âa]tresse\b|\bfemme\b|\bwench\b|\bwoman\b|\bgirl\b|\bn[èe]gre\b|\bman\b|\bboy\b|\bfellow\b/i.test(t),
  // ORIGIN — the field almost nothing else we hold carries
  african_nation:    (t) => /\bnation\s+[A-ZÉ][\wéèêç-]+|\b(Congo|Ibo|Igbo|Arada|Nago|Bambara|Mandingue|Mandingo|Coromantee|Kromanti|Mina|Th[ié]okois|Foulah|Sénégal|Angola|Mozambique|Caplaou|Bibi|Hausa|Moco|Chamba)\b/i.test(t),
  bossale_or_creole: (t) => /\bnouveau\b|\bbossale?\b|\bcr[ée]ole\b|\bnew\s+negro\b|\bsalt.water\b|\bcountry.born\b/i.test(t),
  language_noted:    (t) => /\bparle\b|\bspeaks?\b|\bbad English\b|\bfran[çc]ais\b|\bcreole\b|\bno English\b|\bbroken\b/i.test(t),
  // HARM — the enslaver testifying against himself
  branded:           (t) => /\b[ée]tamp[ée]e?\b|\bmarqu[ée]e?\s+(au|d')|\bbranded\b|\bbrand\s+(mark|on)\b/i.test(t),
  scars_marks:       (t) => /\bcicatrice|\bbalafr|\bscars?\b|\bmarks? of\b|\bwhipp?(ed|ing)\b|\bfouett|\bcoups de fouet\b|\bmutil/i.test(t),
  irons_chains:      (t) => /\bfers?\b|\bcha[îi]ne|\bcollier\b|\birons?\b|\bchains?\b|\bshackle|\bcarcan\b|\bmanacle/i.test(t),
  injury_disability: (t) => /\bboiteu|\bestropi|\bmanchot\b|\bborgne\b|\baveugle\b|\blame\b|\bcripple|\bwalks heavily\b|\bone eye\b|\bstammer|\bb[èe]gue\b|\bulc[èe]r|\bsores?\b/i.test(t),
  jailed:            (t) => /\bg[eé][ôo]le\b|\bprison\b|\bcachot\b|\bjail\b|\bgaol\b|\bworkhouse\b|\bd[ée]p[ôo]t\b/i.test(t),
  // ECONOMICS — priced, therefore ledgerable
  reward_offered:    (t) => /\br[ée]compense\b|\breward\b|\bgourdes?\b|\bportugaises?\b|\bdollars?\b|\bpiastres?\b|\blivres?\b|£|\$/i.test(t),
  occupation_skill:  (t) => /\bcharpentier|\bma[çc]on\b|\btonnelier|\bcocher\b|\bdomestique\b|\bcuisini|\bforgeron|\bcarpenter\b|\bcooper\b|\bmason\b|\bsailor\b|\bcook\b|\bblacksmith\b|\bfisherman\b|\bdriver\b/i.test(t),
  // FLIGHT ITSELF
  flight_duration:   (t) => /\bdepuis\b.{0,20}\b(jours?|semaines?|mois|ans?)\b|\bfor\s+\w+\s+(days|weeks|months|years)\b|\bmaron depuis\b/i.test(t),
  repeat_flight:     (t) => /\bd[ée]j[àa]\s+(maron|fugitif)|\bagain\b|\bsecond time\b|\bhabitude de maronner\b|\br[ée]cidiv/i.test(t),
  group_flight:      (t) => /\bavec\s+(un|une|deux|plusieurs|sa|son)\b|\baccompagn|\btogether with\b|\balong with\b|\bin company\b|\bet sa (femme|fille|m[èe]re)\b/i.test(t),
  kin_mentioned:     (t) => /\bsa femme\b|\bson mari\b|\bsa m[èe]re\b|\bson p[èe]re\b|\bsa fille\b|\bson fils\b|\bhis wife\b|\bher husband\b|\bhis mother\b|\bchild(ren)?\b|\benfant/i.test(t),
  destination_guess: (t) => /\bcroit\b.{0,30}\b(all[ée]|retir[ée])|\bsuppos[ée]\b|\bis supposed to\b|\bharbou?red\b|\bcach[ée]\b|\bg[ée]n[ée]ralement vu\b/i.test(t),
  // CITATION
  scan_present:      (t) => /__SCAN__/.test(t),
  permalink:         (t) => /Permalien|Permalink/i.test(t),
};

async function main() {
  console.log(`Le marronnage dans le monde atlantique — O-of-O sample (writes NO people)`);
  console.log(`stratified across ${LOCATIONS.length} colonies x decades ${MIN_YEAR}-${MAX_YEAR}, ~1.2 req/sec\n`);

  // ── corpus size per colony, straight from the source ──
  const colonyTotals = {};
  const ids = new Set();
  const decades = [];
  for (let d = 1760; d <= 1830; d += 10) decades.push(d);

  for (const loc of LOCATIONS) {
    let locTotal = null;
    for (const d of decades) {
      if (ids.size >= N * 1.4) break;
      try {
        const html = await post(q({ location: loc, minyear: String(Math.max(d, MIN_YEAR)),
                                    maxyear: String(Math.min(d + 9, MAX_YEAR)) }));
        const txt = strip(html);
        const m = txt.match(/([\d\s ]+)\s*document\(s\)/);
        const n = m ? +m[1].replace(/[\s ]/g, '') : 0;
        if (locTotal === null) locTotal = 0;
        locTotal += n;
        const found = [...new Set([...html.matchAll(/document\.php\?id=(\d+)/g)].map((x) => x[1]))];
        found.slice(0, 6).forEach((i) => ids.add(i));
        if (n) console.log(`  ${loc.padEnd(18)} ${d}s: ${String(n).padStart(6)} docs · sampled ${found.length} · pool ${ids.size}`);
      } catch (e) { console.log(`  ${loc.padEnd(18)} ${d}s: ! ${e.message}`); }
      await sleep(800);
    }
    colonyTotals[loc] = locTotal || 0;
  }

  // ── the decisive measurement: does the curated `noms` index cover the corpus? ──
  // Take names we can see in sampled transcriptions and ask the index for them. If the index knows them,
  // ingest can be deterministic. If it does not, names must come out of free text, and that is where
  // fabricated people come from — so it changes the whole design.
  const list = [...ids].slice(0, N);
  console.log(`\nfetching ${list.length} documents…`);

  const census = Object.fromEntries(Object.keys(PROBES).map((k) => [k, 0]));
  const frame = { colony: {}, decade: {}, newspaper: {} };
  const nameSamples = [];
  let ok = 0, err = 0, totalChars = 0, withScan = 0;

  for (const id of list) {
    try {
      const raw = await get(`${BASE}/document.php?id=${id}`);
      const hasScan = /\.\.\/documents\/[^"']+\.(jpg|jpeg|png|tif)/i.test(raw);
      if (hasScan) withScan++;
      const t = strip(raw) + (hasScan ? ' __SCAN__' : '');
      ok++; totalChars += t.length;
      for (const [k, fn] of Object.entries(PROBES)) if (fn(t)) census[k]++;

      const head = (t.match(/([A-Za-zÀ-ÿ\- ]+),\s*([A-Za-zÀ-ÿ'\- ]+)\s*-\s*(1[78]\d{2})-(\d{2})-(\d{2})/) || []);
      if (head[1]) frame.colony[head[1].trim()] = (frame.colony[head[1].trim()] || 0) + 1;
      if (head[2]) frame.newspaper[head[2].trim()] = (frame.newspaper[head[2].trim()] || 0) + 1;
      if (head[3]) { const d = Math.floor(+head[3] / 10) * 10; frame.decade[d] = (frame.decade[d] || 0) + 1; }

      const nm = t.match(/\bnomm[ée]e?\s+([A-ZÉÈ][\wéèêàçï-]{2,})|\bnamed\s+([A-Z][\w-]{2,})/);
      if (nm && nameSamples.length < 12) nameSamples.push({ id, name: nm[1] || nm[2] });
    } catch (e) { err++; }
    if (ok % 25 === 0 && ok) process.stdout.write(`\r  ${ok} fetched, ${err} errors   `);
    await sleep(800);
  }

  // probe the noms index with names we literally just read in the transcriptions
  console.log(`\n\n════ IS THE CURATED \`noms\` INDEX USABLE? (probing names read from the ads) ════`);
  let nomsHit = 0;
  for (const s of nameSamples) {
    try {
      const txt = strip(await post(q({ noms: s.name })));
      const m = txt.match(/([\d\s ]+)\s*document\(s\)/);
      const n = m ? +m[1].replace(/[\s ]/g, '') : 0;
      if (n > 0) nomsHit++;
      console.log(`  ${n > 0 ? '✓' : '✗'} ${String(s.name).padEnd(16)} index says ${n} doc(s)   (read in id=${s.id})`);
    } catch (e) { console.log(`  ! ${s.name}: ${e.message}`); }
    await sleep(800);
  }
  const nomsPct = nameSamples.length ? Math.round((nomsHit / nameSamples.length) * 100) : 0;
  console.log(`  → curated index covered ${nomsHit}/${nameSamples.length} (${nomsPct}%) of names visible in the text`);

  console.log(`\n════ FIELD CENSUS — % of ${ok} sampled ads carrying each element ════`);
  for (const [k, v] of Object.entries(census).sort((a, b) => b[1] - a[1])) {
    const p = ok ? Math.round((v / ok) * 100) : 0;
    console.log(`  ${String(p).padStart(3)}%  ${'█'.repeat(Math.round(p / 4)).padEnd(25)} ${k}`);
  }
  console.log(`\n  mean text length: ${ok ? Math.round(totalChars / ok) : 0} chars`);
  console.log(`  scans available (rule 8 feasible): ${withScan}/${ok} = ${ok ? Math.round((withScan / ok) * 100) : 0}%`);

  console.log('\n════ CORPUS SIZE BY COLONY (from the source itself) ════');
  for (const [k, v] of Object.entries(colonyTotals).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(20)} ${String(v).padStart(7)}`);
  }
  console.log('\n════ FRAME ACHIEVED (judge the sample before trusting the census) ════');
  for (const [dim, counts] of Object.entries(frame)) {
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log(`  ${dim}: ${top.map(([k, v]) => `${k}=${v}`).join('  ')}`);
  }

  if (SAVE) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false },
      statement_timeout: 120000, query_timeout: 120000 });
    pool.on('error', (e) => console.error('[pool]', e.message));
    await pool.query(
      `INSERT INTO research_findings (question, repository, index_searched, result, hit_count, evidence_note, searched_by)
       VALUES ($1,$2,$3,'partial',$4,$5,'sample-marronnage-ads')`,
      ['What does a marronnage runaway ad actually carry, and is the curated `noms` index complete enough to ingest named people deterministically?',
       'Le marronnage dans le monde atlantique, 1760-1848 (CNRS/EHESS; Cottias & Dubois) — marronnage.info',
       `stratified: ${LOCATIONS.length} colonies x ${decades.length} decades; ${ok} ads fetched`, ok,
       `FIELD CENSUS ${JSON.stringify(census)} COLONY_TOTALS ${JSON.stringify(colonyTotals)} FRAME ${JSON.stringify(frame)} ` +
       `NOMS_INDEX_COVERAGE ${nomsHit}/${nameSamples.length} (${nomsPct}%) SCANS ${withScan}/${ok} — measured BEFORE designing an ingest, per O-of-O §5.`]);
    console.log('\n✓ field census saved to research_findings');
    await pool.end();
  }
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
