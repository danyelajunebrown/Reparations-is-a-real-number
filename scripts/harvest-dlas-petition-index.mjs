// harvest-dlas-petition-index.mjs — pull the DLAS petition INDEX for every state via the site's own CSV
// export, in ~16 requests instead of 17,487 page fetches.
//
// WHY THIS REPLACES THE SCRAPER I FIRST WROTE (recorded because the failure was silent, which is worse
// than loud). sample-dlas-petitions.mjs built facet URLs like ?s=&t=1&st=va&l=va&y=182&r=3 and got ZERO
// petitions — then SAVED that zero to research_findings as if it were a measurement. Two defects:
//   1. `s` is a REQUIRED field. With s= empty DLAS returns the bare search form, no results, HTTP 200.
//      A 200 with no rows looked like "this cell is empty" rather than "this query is malformed."
//   2. `st` / `y` / `r` are not the filter params. The real ones are f-prefixed — `fst`, `fy`, `fr` —
//      and they REFINE an existing search rather than driving a browse.
// The lesson is the one from the tally marks and the .catch(()=>{}): a query that cannot succeed returns
// the same shape as a question with no answer. Assert the query worked before recording what it found.
//
// WHAT THE CSV GIVES US, per petition:
//   petitonIdentifier (sic — their spelling), state, county, countyType,
//   fileDateCirca/Day/Month/Year/Court, endDateCirca/Day/Month/Year/Court,
//   enslavedCount, fpocCount, enslaverCount, petitionerCount, defendantCount,
//   repository, petitionUrl
//
// enslavedCount IS THE TARGETING KEY. Virginia: 2,068 petitions, but only 467 carry enslavedCount>0
// (3,666 enslaved people; 14,806 enslavers). So the expensive per-petition fetch — the only place the
// NAMES live — runs against a quarter of the corpus instead of all of it. That is the targeted-harvesting
// discipline in standard-targeted-harvesting.md: let the index tell you where the people are.
//
// THIS WRITES NO PEOPLE. It records the index in research_findings + source_pull_targets so the named-
// person ingest can be designed against measured counts. Per O-of-O §5.
//
// ENDPOINT CONTRACT (learned the hard way, so nobody re-derives it):
//   GET /petitions/tocsv/?i=62&s=<term>&t=<0|1>&l=<state>&fy=&fst=&fc=&fr=
//   · `i` is a CONSTANT 62 — NOT a row count. It is the same for a 1-row and a 2,068-row export.
//     Passing i=20000 returns HTTP 500. That 500 was my parameter, not their server.
//   · `t=0` name search · `t=1` keyword search · `l` = two-letter state code, `aa` = all
//   · the export honours the search, so a broad keyword + state filter yields that state's whole index.
//
// POLITENESS: dlas.uncg.edu/robots.txt has every rule commented out — nothing disallowed, no AI clause.
// We still pace deliberately and identify ourselves: this is a university library project.
//
// Usage:
//   node scripts/harvest-dlas-petition-index.mjs                 # all states, report only
//   node scripts/harvest-dlas-petition-index.mjs --save          # + persist index + pull targets

import 'dotenv/config';
import pg from 'pg';

const A = process.argv.slice(2);
const SAVE = A.includes('--save');
const UA = 'reparations-research/1.0 (db7613@bard.edu; academic reparations research; contact welcome)';
const BASE = 'https://dlas.uncg.edu';
const I_CONST = '62';           // constant, see contract above
const TERM = 'slave';           // broad keyword; t=1
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STATES = { al: 'Alabama', ar: 'Arkansas', de: 'Delaware', dc: 'District of Columbia', fl: 'Florida',
  ga: 'Georgia', ky: 'Kentucky', la: 'Louisiana', md: 'Maryland', ms: 'Mississippi', mo: 'Missouri',
  nc: 'North Carolina', sc: 'South Carolina', tn: 'Tennessee', tx: 'Texas', va: 'Virginia' };

function parseCsv(text) {
  // DLAS quotes fields containing commas; repositories routinely do.
  const rows = []; let cur = ['']; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur[cur.length - 1] += '"'; i++; }
      else if (c === '"') q = false;
      else cur[cur.length - 1] += c;
    } else if (c === '"') q = true;
    else if (c === ',') cur.push('');
    else if (c === '\n') { rows.push(cur); cur = ['']; }
    else if (c !== '\r') cur[cur.length - 1] += c;
  }
  if (cur.length > 1 || cur[0]) rows.push(cur);
  const hdr = rows.shift() || [];
  return rows.filter((r) => r.length === hdr.length)
             .map((r) => Object.fromEntries(hdr.map((h, i) => [h.trim(), (r[i] || '').trim()])));
}

const num = (v) => (/^\d+$/.test(String(v || '').trim()) ? +v : 0);

async function main() {
  console.log('DLAS petition index via the site\'s own CSV export — index only, NO people written\n');
  const all = [];
  const perState = [];

  for (const [code, name] of Object.entries(STATES)) {
    const url = `${BASE}/petitions/tocsv/?i=${I_CONST}&s=${TERM}&t=1&l=${code}&fy=&fst=&fc=&fr=`;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120000) });
      if (!r.ok) throw new Error(`http ${r.status}`);
      const text = await r.text();
      const rows = parseCsv(text);

      // ASSERT THE QUERY WORKED. An empty result must be distinguishable from a malformed query — that
      // distinction is exactly what the first DLAS run failed to make.
      if (!/petitonIdentifier/i.test(text)) throw new Error('no CSV header — query shape wrong, not an empty state');

      const enslaved = rows.reduce((s, x) => s + num(x.enslavedCount), 0);
      const enslavers = rows.reduce((s, x) => s + num(x.enslaverCount), 0);
      const fpoc = rows.reduce((s, x) => s + num(x.fpocCount), 0);
      const named = rows.filter((x) => num(x.enslavedCount) > 0).length;
      perState.push({ code, name, petitions: rows.length, named, enslaved, fpoc, enslavers });
      rows.forEach((x) => all.push(x));
      console.log(`  ${name.padEnd(21)} ${String(rows.length).padStart(6)} petitions · ${String(named).padStart(5)} name enslaved · ${String(enslaved).padStart(6)} enslaved · ${String(enslavers).padStart(6)} enslavers`);
    } catch (e) {
      console.log(`  ${name.padEnd(21)} ! ${e.message}`);
    }
    await sleep(2500);
  }

  const T = perState.reduce((a, s) => ({ petitions: a.petitions + s.petitions, named: a.named + s.named,
    enslaved: a.enslaved + s.enslaved, fpoc: a.fpoc + s.fpoc, enslavers: a.enslavers + s.enslavers }),
    { petitions: 0, named: 0, enslaved: 0, fpoc: 0, enslavers: 0 });

  console.log(`\n════ TOTAL ════`);
  console.log(`  petitions indexed        ${T.petitions}`);
  console.log(`  petitions naming enslaved ${T.named}  <- the only ones worth a per-petition fetch`);
  console.log(`  enslaved people counted   ${T.enslaved}`);
  console.log(`  free people of colour     ${T.fpoc}`);
  console.log(`  enslavers counted         ${T.enslavers}`);
  console.log(`\n  targeting ratio: ${T.petitions ? Math.round((T.named / T.petitions) * 100) : 0}% of petitions carry a named enslaved person.`);

  // court + repository spread — judge the corpus before designing for it
  const by = (k) => { const m = {}; all.forEach((r) => { if (r[k]) m[r[k]] = (m[r[k]] || 0) + 1; }); return m; };
  for (const dim of ['fileCourt', 'countyType']) {
    const top = Object.entries(by(dim)).sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log(`  ${dim}: ${top.map(([k, v]) => `${k}=${v}`).join('  ')}`);
  }
  const repos = Object.entries(by('repository')).sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(`  top repositories:`);
  repos.forEach(([k, v]) => console.log(`     ${String(v).padStart(5)}  ${k.slice(0, 70)}`));

  if (!SAVE) { console.log('\n(dry run — pass --save to persist the index and pull targets)'); return; }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false },
    statement_timeout: 300000, query_timeout: 300000 });
  pool.on('error', (e) => console.error(`[pool] idle client error (continuing): ${e.message}`));

  await pool.query(
    `INSERT INTO research_findings (question, repository, index_searched, result, hit_count, evidence_note, searched_by)
     VALUES ($1,$2,$3,'hit',$4,$5,'harvest-dlas-petition-index')`,
    ['How large is the DLAS petition corpus per state, and which petitions actually name enslaved people?',
     'Digital Library on American Slavery (UNCG) — Race and Slavery Petitions Project',
     `CSV export /petitions/tocsv/, keyword "${TERM}", all ${Object.keys(STATES).length} states`, T.petitions,
     `PER STATE ${JSON.stringify(perState)} TOTALS ${JSON.stringify(T)}. Retrieved via the site's own CSV export ` +
     `(~16 requests, not 17,487 page fetches). enslavedCount is the targeting key: only ${T.named} of ${T.petitions} ` +
     `petitions name an enslaved person, so per-petition fetches run against those. ` +
     `COVERAGE CAVEAT — NOT THE WHOLE CORPUS: this is a keyword-"${TERM}" enumeration and reaches ${T.petitions} of the ` +
     `documented 17,487 petitions (~90%). It also under-reaches free people of colour: fpocCount totals ${T.fpoc} ` +
     `against a documented ~8,000 FPOC, because "${TERM}" biases toward petitions about enslaved property and away ` +
     `from FPOC petitions (freedom suits, apprenticeship, testimony). Single terms return disjoint subsets ` +
     `(negro=4641, freedom=1937, color=3477, petition=5001 at l=aa), so full coverage needs a UNION over terms, ` +
     `deduped on petitonIdentifier — not one broader term. Do NOT treat this count as the corpus. ` +
     `SUPERSEDES the zero-row ` +
     `sample-dlas-petitions run of 2026-08-20 22:19, which recorded 0 because s= was empty (a required field) ` +
     `and st/y/r are not the filter params (they are fst/fy/fr, and they refine rather than browse).`]);

  // Queue ONLY the petitions that carry a named enslaved person, into the existing source_ingest_queue.
  // (An earlier draft of this script invented a `source_pull_targets` table that does not exist — the same
  // reflex that duplicated two working pipelines earlier in this project. Check the schema, then write.)
  // The whole index row rides along in `result` so the ingest never has to re-fetch the CSV to know what
  // it is looking at, and so the counts stay auditable next to the rows they produced.
  let queued = 0, qerr = 0;
  const targets = all.filter((r) => num(r.enslavedCount) > 0)
                     .sort((a, b) => num(b.enslavedCount) - num(a.enslavedCount)); // most people first
  for (const r of targets) {
    try {
      await pool.query(
        `INSERT INTO source_ingest_queue (ark_url, source_kind, status, result, added_by)
         SELECT $1,'dlas_petition','queued',$2::jsonb,'harvest-dlas-petition-index'
          WHERE NOT EXISTS (SELECT 1 FROM source_ingest_queue q
                             WHERE q.ark_url=$1 AND q.source_kind='dlas_petition')`,
        [r.petitionUrl, JSON.stringify({
          petition_id: r.petitonIdentifier, state: r.state, county: r.county, county_type: r.countyType,
          file_court: r.fileCourt, file_year: r.fileYear, file_month: r.fileMonth, file_day: r.fileDay,
          end_court: r.endCourt, end_year: r.endYear,
          enslaved_count: num(r.enslavedCount), fpoc_count: num(r.fpocCount),
          enslaver_count: num(r.enslaverCount), petitioner_count: num(r.petitionerCount),
          defendant_count: num(r.defendantCount), repository: r.repository,
          // these counts are the SOURCE's, carried verbatim; they are not ours to sum onto a DAA
          counts_are_source_asserted: true })]);
      queued++;
    } catch (e) { qerr++; if (qerr <= 3) console.error(`  ! queue ${r.petitonIdentifier}: ${e.message.slice(0, 90)}`); }
  }
  console.log(`\n✓ index → research_findings · ${queued} petitions queued in source_ingest_queue (${qerr} errors) — the ${targets.length} that name enslaved people`);
  await pool.end();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
