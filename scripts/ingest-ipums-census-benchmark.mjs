// ingest-ipums-census-benchmark.mjs
//
// Load the IPUMS USA COUNTY-level complete-count file (C_*.csv, 1790-1840) into
// census_holding_benchmarks (M114): county-year enslaved/free/pop denominators for the
// #90 reference-class calibration frame. See plan-ipums-census-benchmark.md.
//
// SOURCE = the COUNTY file (C_), NOT the household file (H_). The C file is already
// county-aggregated AND carries `statefip` (validated FIPS geography). The H files only had
// `stateicp`, which is IPUMS-uncertified and CORRUPT (VA<->TN transposed 1810-1840) — do not
// use them for this. Each C row is one county-year, so no aggregation: transform row -> row.
//
// Produces NO person rows. Values are government census counts (deterministic; audit rule 1
// n/a). Gates: (1) national control total vs published (strict >=1830, informational for the
// known-partial pre-1830 years); (2) PER-STATE control totals (VA/TN/SC/MD/GA) — the tripwire
// that catches the stateicp-class geography corruption a national total alone hides.
//
// Usage:
//   node scripts/ingest-ipums-census-benchmark.mjs /path/to/C_1790_1840.csv           # dry-run
//   node scripts/ingest-ipums-census-benchmark.mjs /path/to/C_1790_1840.csv --apply   # write
//   (optional) --year 1840   restrict to one census year
//
// Idempotent: UPSERT on (census_year, statefip, countyicp).

import 'dotenv/config';
import fs from 'fs';
import { parse } from 'csv-parse';
import pg from 'pg';

const FILE = process.argv[2];
const APPLY = process.argv.includes('--apply');
const yi = process.argv.indexOf('--year');
const ONLY_YEAR = yi > -1 ? +process.argv[yi + 1] : null;
if (!FILE || !fs.existsSync(FILE)) {
  console.error('usage: node scripts/ingest-ipums-census-benchmark.mjs <C_county.csv> [--apply] [--year YYYY]');
  process.exit(1);
}

// Non-demographic / key / total columns — everything else (the _c age/sex/race buckets) goes
// verbatim into bucket_sums.
const EXCLUDE = new Set([
  'rectype', 'year', 'region', 'statefip', 'stateicp', 'county', 'cntypopf', 'cntypops',
  'qcounty', 'numperhh_c', 'nslave_c', 'ntotal_c',
]);

// Published census enslaved counts (control totals) — national + a per-state tripwire panel.
const KNOWN_ENSLAVED = { 1790: 697681, 1800: 893602, 1810: 1191362, 1820: 1538022, 1830: 2009043, 1840: 2487355 };
const KNOWN_POP =      { 1790: 3929214, 1800: 5308483, 1810: 7239881, 1820: 9638453, 1830: 12866020, 1840: 17069453 };
// FIPS: VA=51 TN=47 SC=45 MD=24 GA=13. Enslaved by state-year (Census published aggregates).
const STATE_ENSLAVED = {
  51: { 1790: 292627, 1800: 346968, 1810: 392518, 1820: 425153, 1830: 469757, 1840: 449087 }, // Virginia
  47: { 1790: 3417,   1800: 13584,  1810: 44535,  1820: 80107,  1830: 141603, 1840: 183059 }, // Tennessee
  45: { 1790: 107094, 1800: 146151, 1810: 196365, 1820: 258475, 1830: 315401, 1840: 327038 }, // South Carolina
  24: { 1790: 103036, 1800: 105635, 1810: 111502, 1820: 107397, 1830: 102994, 1840: 89737  }, // Maryland
  13: { 1790: 29264,  1800: 59404,  1810: 105218, 1820: 149656, 1830: 217531, 1840: 280944 }, // Georgia
};
const FIPS_NAME = { 51: 'VA', 47: 'TN', 45: 'SC', 24: 'MD', 13: 'GA' };

const rows = [];
console.log(`Reading county file ${FILE}${ONLY_YEAR ? ` (year ${ONLY_YEAR})` : ''} …`);
const parser = fs.createReadStream(FILE).pipe(parse({ columns: true, skip_empty_lines: true }));
for await (const r of parser) {
  const year = +r.year;
  if (ONLY_YEAR && year !== ONLY_YEAR) continue;
  const statefip = +r.statefip, countyicp = +r.county;
  if (!Number.isFinite(year) || !Number.isFinite(statefip) || !Number.isFinite(countyicp)) continue;
  const buckets = {};
  for (const col in r) { if (EXCLUDE.has(col)) continue; const v = +r[col]; if (v) buckets[col] = v; }
  rows.push({
    year, statefip, countyicp, stateicp: +r.stateicp || null, region: +r.region || null,
    enslaved: (+r.nslave_c) || 0, free: (+r.numperhh_c) || 0, pop: (+r.ntotal_c) || 0,
    cpf: (+r.cntypopf) || null, cps: (+r.cntypops) || null, buckets,
  });
}

// Partition out BREAKDOWN-ABSENT rows: a county total (pop>0) with no free/enslaved split
// (both 0). These are e.g. the 1790 Tennessee (Southwest Territory) counties — the aggregate
// file has ntotal but not the components. Storing enslaved=0 would be a FALSE ZERO ("real or
// absent"), so we SKIP + LOG them rather than fabricate. They contribute 0 enslaved anyway.
const absent = rows.filter(r => r.pop > 0 && r.free === 0 && r.enslaved === 0);
const usable = rows.filter(r => !(r.pop > 0 && r.free === 0 && r.enslaved === 0));
const years = [...new Set(usable.map(r => r.year))].sort();
console.log(`\ncounty-year rows: ${rows.length.toLocaleString()} total | ${usable.length.toLocaleString()} usable | ${absent.length} breakdown-absent (skipped) | years: ${years.join(', ')}`);
if (absent.length) {
  const byY = {}; absent.forEach(r => { byY[r.year] = (byY[r.year] || 0) + 1; });
  console.log(`  breakdown-absent by year: ${Object.entries(byY).map(([y, c]) => `${y}:${c}`).join(' ')} — county totals present, free/enslaved split not in the aggregate; logged as a gap, NOT stored as enslaved=0.`);
}

// (1) ETL integrity — the census identity ntotal == numperhh + nslave, on rows that HAVE a
// breakdown (a true arithmetic mismatch here would be a real column-mapping bug).
const bad = usable.filter(r => r.pop !== r.free + r.enslaved);
const integrityOK = bad.length === 0;
console.log(`\n=== ETL INTEGRITY (pop == free + enslaved, on breakdown-present rows) ===`);
console.log(`  ${integrityOK ? 'PASS' : 'FAIL'} — ${bad.length}/${usable.length} rows violate the identity`);
if (!integrityOK) bad.slice(0, 5).forEach(r => console.log(`    ${r.year} fips${r.statefip} co${r.countyicp}: ${r.pop} != ${r.free}+${r.enslaved}`));

// (2) National + PER-STATE control totals. Per-state is the tripwire the stateicp bug taught
// us: it BLOCKS if a control state is implausibly inflated (the corruption signature).
let coverageOK = true, stateOK = true;
console.log(`\n=== CONTROL TOTALS (national informational pre-1830 / strict >=1830; per-state tripwire) ===`);
for (const y of years) {
  const yr = usable.filter(r => r.year === y);
  const e = yr.reduce((s, r) => s + r.enslaved, 0), p = yr.reduce((s, r) => s + r.pop, 0);
  const ke = KNOWN_ENSLAVED[y], eD = ke ? 100 * (e - ke) / ke : null;
  const strict = y >= 1830;
  const natOff = eD !== null && Math.abs(eD) > 5;
  if (natOff && strict) coverageOK = false;
  console.log(`  ${y}: enslaved ${e.toLocaleString()} vs ${ke?.toLocaleString() ?? '?'} (${eD?.toFixed(1) ?? '?'}%)` +
              `${natOff ? (strict ? '  <-- national >5% (strict)' : '  (pre-1830 partial: allowed)') : '  ok'}`);
  for (const [fips, series] of Object.entries(STATE_ENSLAVED)) {
    const pub = series[y]; if (!pub) continue;
    const ours = yr.filter(r => r.statefip === +fips).reduce((s, r) => s + r.enslaved, 0);
    const d = 100 * (ours - pub) / pub;
    // corruption tripwire: a control state inflated >20%, or (for intact years) gutted <-20%,
    // is the stateicp-swap signature. Undercount from real coverage loss (pre-1830) is allowed.
    const infl = d > 20;
    const gut = strict && d < -20;
    if (infl || gut) stateOK = false;
    if (Math.abs(d) > 10 || infl || gut)
      console.log(`      ${FIPS_NAME[fips]}(fips${fips}): ${ours.toLocaleString()} vs ${pub.toLocaleString()} (${d.toFixed(0)}%)${infl ? '  <-- INFLATED (corruption?)' : gut ? '  <-- GUTTED (corruption?)' : ''}`);
  }
}

const sane = integrityOK && coverageOK && stateOK;
if (!APPLY) {
  console.log(`\n[DRY RUN] ${usable.length} rows would be written.`);
  console.log(integrityOK ? (coverageOK && stateOK ? '[OK] integrity + coverage + per-state all pass.'
    : `[BLOCK] ${!coverageOK ? 'national coverage (>=1830)' : ''}${!stateOK ? ' per-state tripwire' : ''} failed — investigate.`)
    : '[BLOCK] ETL integrity failed.');
  process.exit(0);
}
if (!sane) { console.error(`\n[ABORT] a gate failed (integrity=${integrityOK} coverage=${coverageOK} perState=${stateOK}) — refusing to write.`); process.exit(2); }

// ---- APPLY ----
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const src = await pool.query(`SELECT id FROM secondary_source_compilations WHERE source_title = 'IPUMS USA Complete Count Household Data, 1790–1840' LIMIT 1`);
const srcId = src.rows[0]?.id ?? null;
let written = 0;
for (const r of usable) {
  await pool.query(
    `INSERT INTO census_holding_benchmarks
       (census_year, statefip, countyicp, stateicp, region, enslaved_total, free_total, pop_total,
        county_pop_free, county_pop_slave, bucket_sums, secondary_source_compilation_id, ipums_note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (census_year, statefip, countyicp) DO UPDATE SET
       stateicp=EXCLUDED.stateicp, region=EXCLUDED.region, enslaved_total=EXCLUDED.enslaved_total,
       free_total=EXCLUDED.free_total, pop_total=EXCLUDED.pop_total, county_pop_free=EXCLUDED.county_pop_free,
       county_pop_slave=EXCLUDED.county_pop_slave, bucket_sums=EXCLUDED.bucket_sums,
       secondary_source_compilation_id=EXCLUDED.secondary_source_compilation_id`,
    [r.year, r.statefip, r.countyicp, r.stateicp, r.region, r.enslaved, r.free, r.pop,
     r.cpf, r.cps, JSON.stringify(r.buckets), srcId, `IPUMS county-file complete-count ${r.year}`]
  );
  written++;
  if (written % 500 === 0) process.stdout.write(`  wrote ${written}/${rows.length}\r`);
}
console.log(`\n[APPLIED] ${written} county-year benchmark rows upserted (statefip-keyed).`);
await pool.end();
