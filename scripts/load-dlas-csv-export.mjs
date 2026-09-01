// load-dlas-csv-export.mjs — queue DLAS petitions from an operator-downloaded CSV export.
//
// FILE-FIRST, because the machine could not fetch it. dlas.uncg.edu/petitions/tocsv/ began returning HTTP
// 500 to our requests on 2026-08-21 — including for Delaware, the smallest state, which rules out size or
// timeout. The HTML side of the site stayed healthy throughout, so this is the tocsv endpoint specifically,
// and I could not tell from outside whether it was rate-limiting aimed at us or a server fault. Rather than
// probe to find out, the operator opened the same URL in a browser and downloaded the file. Same posture as
// the Amelia scans and Ancestry: the human actuates, the machine organises.
//
// WHAT THIS FILE IS: the role-filtered search (?s=<term>&t=0&l=aa&fr=3) exported as CSV — i.e. petitions
// that NAME at least one enslaved person. That is the corrected targeting key. The old key, enslavedCount,
// counted enslaved people MENTIONED (mostly unnamed) and is EMPTY on the very first row here:
//     10182603, Alabama, Conecuh — enslavedCount blank, enslaverCount 5
// and that petition's people table is Anna, Jane, Martha, Nancy (status "slave") plus Thomas Loyd
// (Enslaver? "yes"). A petition naming four enslaved women scores zero on the field I was sorting by.
//
// NOTE THE EXPORT CAP: the search reported 6,119 records and the file holds 5,001 rows. DLAS caps its
// export near 5,000, so ONE download is not the corpus. Coverage needs several terms (a, b, c, ...) and
// dedupe on petitonIdentifier — which this does, so re-running over more files is safe and additive.
//
// Usage:
//   node scripts/load-dlas-csv-export.mjs ~/Downloads/SearchResults.csv
//   node scripts/load-dlas-csv-export.mjs ~/Downloads/*.csv --apply
import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';

const A = process.argv.slice(2);
const APPLY = A.includes('--apply');
const FILES = A.filter((a) => !a.startsWith('--'));
if (!FILES.length) { console.error('usage: node scripts/load-dlas-csv-export.mjs <file.csv> [...] [--apply]'); process.exit(1); }

function parseCsv(text) {
  const rows = []; let cur = ['']; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur[cur.length - 1] += '"'; i++; }
      else if (c === '"') q = false; else cur[cur.length - 1] += c;
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

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false },
  statement_timeout: 300000, query_timeout: 300000 });
pool.on('error', (e) => console.error(`[pool] ${e.message}`));

const seen = new Set();
let total = 0, queued = 0, dup = 0, bad = 0;
for (const f of FILES) {
  const rows = parseCsv(fs.readFileSync(f, 'utf8'));
  // VERIFY THE SHAPE before trusting it — a header name is not a contract, as enslavedCount proved twice.
  if (!rows.length || !('petitonIdentifier' in rows[0])) { console.error(`  SKIP ${f}: not a DLAS petition export`); continue; }
  console.log(`  ${f.split('/').pop()}: ${rows.length} rows${rows.length >= 5000 ? '  ⚠️  at/near the ~5,000 export CAP — this file is NOT the whole result set' : ''}`);
  total += rows.length;
  for (const r of rows) {
    const id = r.petitonIdentifier;
    if (!/^\d+$/.test(id || '')) { bad++; continue; }
    if (seen.has(id)) { dup++; continue; }
    seen.add(id);
    if (!APPLY) continue;
    await pool.query(
      `INSERT INTO source_ingest_queue (ark_url, source_kind, status, result, added_by)
       SELECT $1,'dlas_petition','queued',$2::jsonb,'load-dlas-csv-export'
        WHERE NOT EXISTS (SELECT 1 FROM source_ingest_queue s
          WHERE s.ark_url=$1 AND s.source_kind='dlas_petition' AND s.status IN ('queued','ingested'))`,
      [r.petitionUrl || `https://dlas.uncg.edu/petitions/petition/${id}`,
       JSON.stringify({ petition_id: id, state: r.state, county: r.county, county_type: r.countyType,
         file_court: r.fileCourt, file_year: r.fileYear, repository: r.repository,
         enslaver_count: r.enslaverCount || null,
         // deliberately NOT carrying enslavedCount as a targeting signal — it is blank on petitions that
         // name enslaved people. Kept only as a ledger quantity, clearly labelled.
         enslaved_mentioned_ledger_only: r.enslavedCount || null,
         selected_by: 'operator-downloaded role-filtered export (fr=3): petitions NAMING enslaved people',
         counts_are_source_asserted: true })]).then(() => { queued++; }).catch((e) => console.error(`  ! ${id}: ${e.message.slice(0, 70)}`));
  }
}
console.log(`\n  ${total} rows · ${seen.size} distinct petitions · ${queued} newly queued · ${dup} dupes · ${bad} unparsable`);
if (!APPLY) console.log('  (dry run — pass --apply)');
await pool.end();
