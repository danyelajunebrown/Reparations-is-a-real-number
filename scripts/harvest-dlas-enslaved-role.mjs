// harvest-dlas-enslaved-role.mjs — enumerate the DLAS petitions that NAME enslaved people, via the role
// facet, and requeue them. This replaces the enslavedCount ordering, which selected the opposite.
//
// WHY (measured 2026-08-21/22). harvest-dlas-petition-index queued 2,922 petitions ordered by the CSV field
// `enslavedCount` and I reported "29,786 named enslaved". Then I read the people tables: across 8 petitions
// whose enslavedCount totals 1,951, they name 77 people and ZERO enslaved. `enslavedCount` counts enslaved
// people MENTIONED — overwhelmingly unnamed. PAR 21383428: CSV 611, JSON 0, abstract "at least 240 slaves",
// people table = 11 white heirs. Big estate partitions have the HIGHEST counts and the FEWEST names, so
// ordering by it selected precisely the petitions with nobody nameable in them.
//
// THE CORRECT KEY IS THE ROLE FACET. `?s=<term>&t=0&l=aa&fr=3` searches PERSON NAMES filtered to the
// ENSLAVED role, and the result page reports, per petition, "Individuals mentioned by name Enslaved (4),
// Petitioner (1)". Verified end-to-end on PAR 10182603, whose people table is:
//     Anna | black | female | | slave |        Jane | black | female | | slave |
//     Martha | black | female | | slave |      Nancy | black | female | | slave |
//     Thomas Loyd | white | male | petitioner | | yes
// Four named enslaved women and the man who held them, each classed by the SOURCE.
//
// ENUMERATION: DLAS ships no names array (Marronnage does; this does not), so we sweep name fragments and
// dedupe petition ids. `s=a` alone returns 6,119 petitions. The sweep is a-z plus a few high-frequency
// fragments; every id is deduped, so overlap costs requests, never duplicates.
//
// POLITENESS: dlas.uncg.edu/robots.txt has every rule commented out. But the CSV export began returning
// HTTP 500 after heavy use on 2026-08-21 — I treat that as US being the problem, not them, so this uses the
// HTML result pages, paces at ~1.6s, and STOPS on 429/500 rather than retrying into a wall.
//
// Usage:
//   node scripts/harvest-dlas-enslaved-role.mjs --terms a,b,c
//   node scripts/harvest-dlas-enslaved-role.mjs --max-pages 40 --apply
import 'dotenv/config';
import pg from 'pg';

const A = process.argv.slice(2);
const val = (f, d) => { const i = A.indexOf(f); return i > -1 ? A[i + 1] : d; };
const APPLY = A.includes('--apply');
const MAX_PAGES = +val('--max-pages', 25);
const GAP_MS = +val('--gap-ms', 1600);
const TERMS = (val('--terms', 'abcdefghijklmnopqrstuvwxyz')).split(',').length > 1
  ? val('--terms', '').split(',')
  : val('--terms', 'abcdefghijklmnopqrstuvwxyz').split('');
// STATE SCOPING. The ~5,000 export/result cap means an all-states search returns a TRUNCATED slice: five
// operator-downloaded all-states files yielded 5,001 / 2,080 / 1,144 / 54 / 255 new ids — collapsing
// overlap, not coverage. Scoping to one state puts every result set under the cap, so each sweep is
// COMPLETE for that state. Measured gap that prompted this: Maryland showed 18 petitions naming enslaved
// people while the Maryland State Archives holds 1,098 petitions in the index — a shortfall of the
// truncation, not of the archive.
const STATES = val('--states', '') ? val('--states', '').split(',') : ['aa'];
const UA = 'reparations-research/1.0 (db7613@bard.edu; academic reparations research; contact welcome)';
const BASE = 'https://dlas.uncg.edu';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(45000) });
  if (!r.ok) throw new Error(`http ${r.status}`);
  return r.text();
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false },
    statement_timeout: 300000, query_timeout: 300000 });
  pool.on('error', (e) => console.error(`[pool] ${e.message}`));

  const found = new Map();      // petition id -> enslaved-named count reported on the result page
  let stopped = false;

  for (const st of STATES) {
  for (const term of TERMS) {
    if (stopped) break;
    let pageTotal = null;
    for (let page = 1; page <= MAX_PAGES; page++) {
      try {
        const html = await get(`${BASE}/petitions/?s=${encodeURIComponent(term)}&t=0&l=${st}&fr=3&p=${page}`);
        const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
        if (pageTotal === null) {
          const m = text.match(/([\d,]+)\s+records? found/);
          pageTotal = m ? +m[1].replace(/,/g, '') : 0;
        }
        // pair each petition id with the "Enslaved (N)" reported for it, in document order
        const ids = [...html.matchAll(/\/petitions\/petition\/(\d+)/g)].map((m) => m[1]);
        const counts = [...text.matchAll(/Enslaved\s*\((\d+)\)/g)].map((m) => +m[1]);
        const uniq = [...new Set(ids)];
        if (!uniq.length) break;
        uniq.forEach((id, i) => { if (!found.has(id)) found.set(id, counts[i] || null); });
        if (page === 1 && pageTotal) console.log(`  ${st}/"${term}": ${pageTotal} petitions with a named enslaved person`);
        if (uniq.length < 25) break;                 // last page
      } catch (e) {
        console.log(`  "${term}" p${page}: ${e.message}`);
        if (/429|500|503/.test(e.message)) { console.log('  ⛔ server pushing back — stopping the sweep.'); stopped = true; }
        break;
      }
      await sleep(GAP_MS);
    }
  }
  }

  const withNames = [...found.entries()].filter(([, n]) => (n || 0) > 0);
  console.log(`\n  distinct petitions found: ${found.size} · with a reported Enslaved(N): ${withNames.length}` +
              ` · total named enslaved reported: ${withNames.reduce((s, [, n]) => s + n, 0)}`);
  if (!APPLY) { console.log('\n(dry run — pass --apply to requeue)'); await pool.end(); return; }

  let q = 0;
  for (const [id, n] of found) {
    await pool.query(
      `INSERT INTO source_ingest_queue (ark_url, source_kind, status, result, added_by)
       SELECT $1,'dlas_petition','queued',$2::jsonb,'harvest-dlas-enslaved-role'
        WHERE NOT EXISTS (SELECT 1 FROM source_ingest_queue s
                           WHERE s.ark_url=$1 AND s.source_kind='dlas_petition' AND s.status IN ('queued','ingested'))`,
      [`${BASE}/petitions/petition/${id}`,
       JSON.stringify({ petition_id: id, named_enslaved_reported: n,
         selected_by: 'role facet fr=3 (named enslaved), NOT enslavedCount',
         counts_are_source_asserted: true })]).then(() => { q++; }).catch((e) => console.error(`  ! ${id}: ${e.message.slice(0, 70)}`));
  }
  console.log(`  queued ${q} petitions on the corrected key`);
  await pool.end();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
