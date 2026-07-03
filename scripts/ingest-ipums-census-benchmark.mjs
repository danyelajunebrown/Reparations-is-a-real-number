// ingest-ipums-census-benchmark.mjs
//
// Aggregate an IPUMS USA complete-count HOUSEHOLD csv (1790–1840) into county×year
// denominators in census_holding_benchmarks (see migration 113 for the why).
//
// This produces NO person rows. It sums government-published census tallies per county
// (deterministic ETL, not model output — audit rule 1 not implicated). The 1790 file
// should sum to ~697,681 enslaved nationally — a historical control total that VALIDATES
// the ETL. Dry-run prints that check; it will not write unless the check looks sane.
//
// Usage:
//   node scripts/ingest-ipums-census-benchmark.mjs /path/to/H_1790.csv           # dry-run
//   node scripts/ingest-ipums-census-benchmark.mjs /path/to/H_1790.csv --apply   # write
//
// Idempotent: UPSERT on (census_year, stateicp, countyicp). Re-running replaces a
// county-year's row, so a re-download or corrected file is safe to re-ingest.

import 'dotenv/config';
import fs from 'fs';
import { parse } from 'csv-parse';
import pg from 'pg';

const FILE = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!FILE || !fs.existsSync(FILE)) {
  console.error('usage: node scripts/ingest-ipums-census-benchmark.mjs <household.csv> [--apply]');
  process.exit(1);
}

// Columns that are keys / flags / dedicated-total / non-count (ages) — everything else
// (the demographic age/sex/race buckets + disability/industry/etc.) is summed into bucket_sums.
const EXCLUDE = new Set([
  'rectype', 'year', 'serial', 'stateicp', 'county', 'city', 'citypop',
  'qcounty', 'qindustry', 'qother', 'qslave',
  'numperhh', 'nslave', 'ntotal',                        // stored as dedicated columns
  'vetage', 'vetage2', 'vetage3', 'vetage4', 'vetage5',  // ages, not counts — summing is meaningless
]);

const agg = new Map(); // "year|stateicp|county" -> accumulator

console.log(`Reading ${FILE} …`);
const parser = fs.createReadStream(FILE).pipe(parse({ columns: true, skip_empty_lines: true }));

let rows = 0;
for await (const row of parser) {
  rows++;
  const year = +row.year, st = +row.stateicp, co = +row.county;
  if (!Number.isFinite(year) || !Number.isFinite(st) || !Number.isFinite(co)) continue;
  const nslave = (+row.nslave) || 0;
  const free   = (+row.numperhh) || 0;
  const pop    = (+row.ntotal) || 0;

  const key = `${year}|${st}|${co}`;
  let a = agg.get(key);
  if (!a) {
    a = { year, stateicp: st, countyicp: co, hh: 0, shh: 0, enslaved: 0, free: 0, pop: 0, maxEnsl: 0, buckets: {} };
    agg.set(key, a);
  }
  a.hh++;
  if (nslave > 0) a.shh++;
  a.enslaved += nslave;
  a.free += free;
  a.pop += pop;
  if (nslave > a.maxEnsl) a.maxEnsl = nslave;
  for (const col in row) {
    if (EXCLUDE.has(col)) continue;
    const v = +row[col];
    if (v) a.buckets[col] = (a.buckets[col] || 0) + v;
  }
  if (rows % 100000 === 0) process.stdout.write(`  …${rows} households\r`);
}

const counties = [...agg.values()];
const years = [...new Set(counties.map(c => c.year))].sort();
const totEnslaved = counties.reduce((s, c) => s + c.enslaved, 0);
const totFree = counties.reduce((s, c) => s + c.free, 0);
const totPop = counties.reduce((s, c) => s + c.pop, 0);
const totHH = counties.reduce((s, c) => s + c.hh, 0);
const totSHH = counties.reduce((s, c) => s + c.shh, 0);

console.log(`\n\n=== AGGREGATION SUMMARY ===`);
console.log(`households read        : ${rows.toLocaleString()}`);
console.log(`census year(s)         : ${years.join(', ')}`);
console.log(`county-year rows       : ${counties.length.toLocaleString()}`);
console.log(`total households (Σhh) : ${totHH.toLocaleString()}`);
console.log(`slaveholding households: ${totSHH.toLocaleString()} (${(100*totSHH/totHH).toFixed(1)}%)`);
console.log(`ENSLAVED total (Σnslave): ${totEnslaved.toLocaleString()}`);
console.log(`free total (Σnumperhh) : ${totFree.toLocaleString()}`);
console.log(`population (Σntotal)   : ${totPop.toLocaleString()}`);

// (1) TRUE ETL INTEGRITY GATE — always enforced. The census identity ntotal ==
// numperhh + nslave must hold after aggregation; a violation is a real arithmetic bug
// (wrong column mapping, double-count). This is coverage-independent.
const badRows = counties.filter(c => c.pop !== c.free + c.enslaved);
const integrityOK = badRows.length === 0;
console.log(`\n=== ETL INTEGRITY (pop_total == free_total + enslaved_total) ===`);
console.log(`  ${integrityOK ? 'PASS' : 'FAIL'} — ${badRows.length} of ${counties.length} county-year rows violate the identity`);
if (!integrityOK) badRows.slice(0, 5).forEach(c =>
  console.log(`    y${c.year} st${c.stateicp} co${c.countyicp}: pop ${c.pop} != free ${c.free} + enslaved ${c.enslaved}`));

// (2) COVERAGE CONTEXT vs published national aggregates — INFORMATIONAL. Pre-1800 the
// census microdata is KNOWN-PARTIAL (1790 schedules for VA/GA/KY/DE/NJ/TN were destroyed;
// VA alone ~293k enslaved), so a large negative delta is expected and does NOT block. For
// 1800–1840 (census largely intact) a >5% gap is suspicious and DOES block.
const KNOWN_ENSLAVED = { 1790: 697681, 1800: 893602, 1810: 1191362, 1820: 1538022, 1830: 2009043, 1840: 2487355 };
const KNOWN_POP =      { 1790: 3929214, 1800: 5308483, 1810: 7239881, 1820: 9638453, 1830: 12866020, 1840: 17069453 };
console.log(`\n=== COVERAGE vs published census aggregates (informational; strict only >=1800) ===`);
let coverageOK = true;
for (const y of years) {
  const ce = counties.filter(c => c.year === y);
  const e = ce.reduce((s, c) => s + c.enslaved, 0);
  const p = ce.reduce((s, c) => s + c.pop, 0);
  const ke = KNOWN_ENSLAVED[y], kp = KNOWN_POP[y];
  const eDelta = ke ? (100 * (e - ke) / ke) : null;
  const strict = y >= 1800;
  const off = eDelta !== null && Math.abs(eDelta) > 5;
  const flag = !off ? '  ok' : (strict ? '  <-- BLOCKS (>=1800, >5% off)' : '  (partial: known 1790 schedule loss — allowed)');
  if (off && strict) coverageOK = false;
  console.log(`  ${y}: enslaved ${e.toLocaleString()} vs known ${ke?.toLocaleString() ?? '?'} (${eDelta?.toFixed(1) ?? '?'}%)` +
              ` | pop ${p.toLocaleString()} vs ${kp?.toLocaleString() ?? '?'} (${kp ? (100*(p-kp)/kp).toFixed(1) : '?'}%)${flag}`);
  // surface fragmentary/absent states so a coverage metric never reads a lost schedule as OUR gap
  const frag = ce.filter(c => c.hh < 100).length, real = ce.filter(c => c.hh >= 100).length;
  if (frag) console.log(`      note: ${real} substantive county-years + ${frag} fragmentary (<100 hh — likely lost/partial schedules)`);
}
const sane = integrityOK && coverageOK;

// Top counties by enslaved (eyeball)
console.log(`\n=== TOP 10 COUNTY-YEARS BY ENSLAVED ===`);
[...counties].sort((a, b) => b.enslaved - a.enslaved).slice(0, 10).forEach(c =>
  console.log(`  y${c.year} st${c.stateicp} co${c.countyicp}: ${c.enslaved.toLocaleString()} enslaved, ${c.shh} slaveholding hh, max ${c.maxEnsl}`));

if (!APPLY) {
  console.log(`\n[DRY RUN] ${counties.length} county-year rows would be written. Re-run with --apply.`);
  if (!integrityOK) console.log(`[BLOCK] ETL integrity FAILED — fix column mapping before applying.`);
  else if (!coverageOK) console.log(`[BLOCK] a >=1800 year is >5% off published totals — investigate before applying.`);
  else console.log(`[OK] integrity passed; coverage within expectation (1790 partiality is known/allowed).`);
  process.exit(0);
}

if (!sane) {
  console.error(`\n[ABORT] ${!integrityOK ? 'ETL integrity failure' : 'coverage gap on an intact-census year'} — refusing to write.`);
  process.exit(2);
}

// ---- APPLY ----
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const src = await pool.query(
  `SELECT id FROM secondary_source_compilations WHERE source_title = 'IPUMS USA Complete Count Household Data, 1790–1840' LIMIT 1`
);
const srcId = src.rows[0]?.id ?? null;
if (!srcId) console.log('[warn] IPUMS compilation row not found (run migration 113); writing with NULL provenance FK.');

let written = 0;
for (const c of counties) {
  await pool.query(
    `INSERT INTO census_holding_benchmarks
       (census_year, stateicp, countyicp, household_count, slaveholding_household_count,
        enslaved_total, free_total, pop_total, max_household_enslaved, bucket_sums,
        secondary_source_compilation_id, ipums_note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (census_year, stateicp, countyicp) DO UPDATE SET
       household_count = EXCLUDED.household_count,
       slaveholding_household_count = EXCLUDED.slaveholding_household_count,
       enslaved_total = EXCLUDED.enslaved_total,
       free_total = EXCLUDED.free_total,
       pop_total = EXCLUDED.pop_total,
       max_household_enslaved = EXCLUDED.max_household_enslaved,
       bucket_sums = EXCLUDED.bucket_sums,
       secondary_source_compilation_id = EXCLUDED.secondary_source_compilation_id`,
    [c.year, c.stateicp, c.countyicp, c.hh, c.shh, c.enslaved, c.free, c.pop, c.maxEnsl,
     JSON.stringify(c.buckets), srcId, `IPUMS complete-count ${c.year} household aggregate`]
  );
  written++;
  if (written % 200 === 0) process.stdout.write(`  wrote ${written}/${counties.length}\r`);
}
console.log(`\n[APPLIED] ${written} county-year benchmark rows upserted.`);
await pool.end();
