import path from 'node:path'; import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv'; import pg from 'pg';
import { deriveSurnames, normalizeState, isOrgName } from './lib/name-normalize.mjs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// blocking keys for one surname
function keysFor(surname, mp, dm) {
  const k = [];
  if (mp) k.push('mp:' + mp);
  if (dm) k.push('dm:' + dm);
  k.push('s4:' + surname.slice(-4));
  k.push('p4:' + surname.slice(0, 4));
  return k;
}

const rows = (await pool.query(
  `SELECT id, canonical_name, last_name, primary_state, person_type
   FROM canonical_persons WHERE canonical_name ~* '(bi|bri)scoe' ORDER BY id`)).rows;

// derive surnames, collect distinct for one phonetic round-trip
const distinct = new Set();
for (const r of rows) { r.surnames = deriveSurnames(r.canonical_name, r.last_name); r.surnames.forEach((s) => distinct.add(s)); }
const ph = {};
if (distinct.size) {
  const codes = (await pool.query(
    `SELECT s, metaphone(s,8) mp, dmetaphone(s) dm FROM unnest($1::text[]) s`, [[...distinct]])).rows;
  for (const c of codes) ph[c.s] = c;
}
for (const r of rows) {
  r.keys = new Set();
  for (const s of r.surnames) keysFor(s, ph[s]?.mp, ph[s]?.dm).forEach((k) => r.keys.add(k));
  r.state = normalizeState(r.primary_state);
}

console.log('id      | name (trunc)                          | surnames        | state | keys');
for (const r of rows) {
  console.log(
    `${String(r.id).padEnd(7)} | ${(r.canonical_name || '').slice(0, 37).padEnd(37)} | ${(r.surnames.join(',') || '(none)').padEnd(15)} | ${(r.state || '-').padEnd(4)} | ${[...r.keys].join(' ')}`);
}

// gold co-block checks: each pair MUST share >=1 key so they can be compared+scored
const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
const shares = (a, b) => byId[a] && byId[b] && [...byId[a].keys].some((k) => byId[b].keys.has(k));
const checks = [
  [141015, 196013, 'Ann Maria Biscoe vs Ann Briscoe (biscoe~briscoe)'],
  [141015, 196010, 'Ann Maria Biscoe vs Ann Biscoe (Bennett)'],
  [196010, 196013, 'Ann Biscoe vs Ann Briscoe'],
  [141015, 141019, 'matriarch vs daughter Emma Biscoe'],
  [141015, 133017, 'DC Ann Maria Biscoe vs LA William Briscoe (cross-state, still co-blocks)'],
];
console.log('\n== gold co-block checks (want SHARED for all) ==');
let ok = true;
for (const [a, b, label] of checks) {
  const s = shares(a, b);
  if (!s) ok = false;
  console.log(`  ${s ? 'SHARED ' : 'MISSED!'} ${label}`);
}
console.log('\n== org exclusion check ==');
const org = byId[97732];
console.log(`  97732 "Lyon, Briscoe & Lyon": isOrg=${isOrgName(org?.canonical_name)} surnames=[${org?.surnames}] (want isOrg=true, surnames empty)`);
console.log(ok ? '\nALL GOLD PAIRS CO-BLOCK ✓' : '\nSOME GOLD PAIRS MISSED — fix blocking keys');
await pool.end();
