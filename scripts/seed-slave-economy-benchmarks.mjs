// seed-slave-economy-benchmarks.mjs  (#116)
//
// Seed slave_economy_benchmarks (M116) with the cited aggregate figures from
// reference-benchmark-sources-register.md. AGGREGATES ONLY (no person rows). Every row cites its
// PRIMARY source; conduits named only where figures enter the reference class. Deterministic —
// hand-keyed from the register, validated for internal consistency (strata sum to totals) before write.
//
//   node scripts/seed-slave-economy-benchmarks.mjs           # dry-run + validate
//   node scripts/seed-slave-economy-benchmarks.mjs --apply   # write

import 'dotenv/config';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const rows = [];
// push(polity, jurisdiction, level, year, metric, sector, sub_group, value, unit, primary, conduit, tier, note)
const P = (polity, jurisdiction, level, year, metric, value, opts = {}) => rows.push({
  polity, jurisdiction, jurisdiction_level: level, benchmark_year: year, metric,
  sector: opts.sector || 'all', sub_group: opts.sub_group || null, value, unit: opts.unit || 'persons',
  source_primary: opts.primary, source_conduit: opts.conduit || null, evidence_tier: opts.tier ?? 0.95, note: opts.note || null,
});

// ---- CUBA (la Sagra official returns, via MacGregor Commercial Statistics Vol IV 1850) ----
const CU = { primary: 'Ramón de la Sagra, official Cuban returns / colonial census 1841', conduit: 'MacGregor, Commercial Statistics Vol IV (1850)' };
P('cuba_colonial', null, 'colony', 1841, 'enslaved_count', 436495, CU);
P('cuba_colonial', null, 'colony', 1830, 'capital_value', 507088002, { ...CU, metric: 'capital_value', unit: 'dollars', note: 'total colonial capital AS STATED by source; line-items sum to 507,087,002 ($1k source discrepancy, not corrected)' });
P('cuba_colonial', null, 'colony', 1830, 'capital_value', 41694600, { ...CU, sub_group: 'slaves', unit: 'dollars', note: '138,982 enslaved @ $300' });
P('cuba_colonial', null, 'colony', 1830, 'capital_value', 94396300, { ...CU, sub_group: 'lands', unit: 'dollars' });
P('cuba_colonial', null, 'colony', 1830, 'capital_value', 276774367, { ...CU, sub_group: 'plants', unit: 'dollars' });
P('cuba_colonial', null, 'colony', 1830, 'capital_value', 54603850, { ...CU, sub_group: 'buildings', unit: 'dollars' });
P('cuba_colonial', null, 'colony', 1830, 'capital_value', 39617885, { ...CU, sub_group: 'animals', unit: 'dollars' });
P('cuba_colonial', null, 'colony', 1841, 'production', 8091837, { ...CU, sector: 'sugar', unit: 'arrobas' });
P('cuba_colonial', null, 'colony', 1841, 'production', 2883528, { ...CU, sector: 'coffee', unit: 'arrobas' });

// ---- JAMAICA 1788 parish return (TNA CO 137/87) ----
const JA = { primary: 'TNA CO 137/87 p.173, Jamaica return Nov 1788', conduit: 'Jamaican Family Search transcription' };
const jaParishes = [['St. Catherine',5304],['St. Thomas in the Vale',7459],['St. Dorothy',3129],['St. John',5650],
  ['Clarendon',17000],['St. Ann',13700],['St. Mary',18271],['Kingston',16659],['Vere',7169],['Port Royal',2049],
  ['St. Andrew',9613],['Portland',4960],['St. George',4996],['St. Thomas in the East',19893],['St. David',2700],
  ['Westmoreland',17486],['St. Elizabeth',12800],['Hanover',17614],['St. James',18980],['Trelawny',21000]];
for (const [p, v] of jaParishes) P('jamaica_colonial', p, 'parish', 1788, 'enslaved_count', v, JA);
P('jamaica_colonial', null, 'colony', 1788, 'enslaved_count', 226432, JA);
P('jamaica_colonial', null, 'colony', 1788, 'white_count', 18347, JA);
P('jamaica_colonial', null, 'colony', 1788, 'free_colored_count', 9405, JA);
P('jamaica_colonial', null, 'colony', 1788, 'maroon_count', 1326, JA);

// ---- BRITISH WEST INDIES 1773-88 (Privy Council Slave-Trade Committee / 1790 Almanac) ----
const PC = { primary: 'Minutes of the Committee of Privy Council on the Slave Trade (1789)', conduit: '1790 Jamaica Almanac (Jamaican Family Search)' };
const bwi = [['Jamaica',1787,256000],['Antigua',1774,37808],['Montserrat',1774,10000],['Nevis',1774,10000],
  ['St. Christopher (St. Kitts)',1774,23462],['Virgin Islands',1774,9000],['Barbados',1786,62115],['Grenada',1785,23926],
  ['St. Vincent',1787,11853],['Dominica',1788,14967],['Bahamas',1773,2241],['Bermuda',1783,4919]];
for (const [i, y, v] of bwi) P('british_wi', i, 'island', y, 'enslaved_count', v, PC);

// ---- FRENCH WEST INDIES (Necker, Administration des Finances 1784) ----
const NK = { primary: 'M. Necker, De l\'administration des finances de la France (1784)', conduit: '1790 Jamaica Almanac (Jamaican Family Search)' };
const fwi = [['Saint-Domingue',1779,249098],['Martinique',1776,71286],['Guadeloupe',1779,85327],['St. Lucia',1776,10752],
  ['Cayenne (French Guiana)',1780,10539],['Île de France (Mauritius)',1776,25154],['Île de Bourbon (Réunion)',1776,26174]];
for (const [i, y, v] of fwi) P('french_wi', i, 'island', y, 'enslaved_count', v, NK);

// ---- BRAZIL 1872 provinces (DGE Recenseamento) ----
const BR = { primary: 'Recenseamento Geral do Império do Brasil de 1872 (DGE)', conduit: 'UFMG critical edition / Wikipedia' };
const brProv = [['Amazonas',979],['Pará',27458],['Maranhão',74939],['Piauí',23795],['Ceará',31913],['Rio Grande do Norte',13020],
  ['Paraíba',21526],['Pernambuco',89028],['Alagoas',35741],['Sergipe',22623],['Bahia',167824],['Espírito Santo',22659],
  ['Rio de Janeiro',292637],['São Paulo',156612],['Paraná',10560],['Santa Catarina',14984],['Rio Grande do Sul',67791],
  ['Minas Gerais',370459],['Goiás',10652],['Mato Grosso',6667],['Neutral Municipality',48939]];
for (const [p, v] of brProv) P('brazil_imperial', p, 'province', 1872, 'enslaved_count', v, BR);
P('brazil_imperial', null, 'empire', 1872, 'enslaved_count', 1510806, BR);
P('brazil_imperial', null, 'empire', 1872, 'free_count', 8419672, BR);

// ---- ATLANTIC TRADE FLOW — annual African export ~1787 (Privy Council / Liverpool delegates) ----
const carriers = [['British',38000],['French',20000],['Dutch',4000],['Danish',2000],['Portuguese',10000]];
for (const [c, v] of carriers) P('atlantic_trade', null, null, 1787, 'slave_export', v, { ...PC, sub_group: 'carrier:' + c, note: 'annual African export by carrier nation' });
const regions = [['Gambia',700],['Isles de Los & rivers',1500],['Sierra Leone-Cape Mount',2000],['Cape Mount-Cape Palmas',3000],
  ['Cape Palmas-Cape Appolonia',1000],['Gold Coast',10000],['Quitta & Papoe',1000],['Whydah',4500],['Porto Novo/Eppee/Bidagry',3500],
  ['Lagos & Benin',3500],['Bonny & New Calabar',14500],['Old Calabar & Cameroons',7000],['Gabon & Cape Lopez',500],
  ['Loango/Malimba/Cabinda',13500],['Majumba/Ambris/Missoula',1000],['Loango/St Paul/Benguela',7000]];
for (const [reg, v] of regions) P('atlantic_trade', null, null, 1787, 'slave_export', v, { ...PC, sub_group: 'region:' + reg, note: 'annual African export by embarkation region' });

// ---------- VALIDATION (internal consistency) ----------
const sum = (pred) => rows.filter(pred).reduce((s, r) => s + r.value, 0);
// tol > 0 tolerates a known SOURCE discrepancy (documented in the row note) — never used to
// paper over a transcription error of ours (those checks stay exact).
const checks = [
  ['Jamaica parishes sum == colony enslaved', sum(r => r.polity==='jamaica_colonial' && r.jurisdiction_level==='parish' && r.metric==='enslaved_count'), 226432, 0],
  ['Brazil provinces sum == empire enslaved', sum(r => r.polity==='brazil_imperial' && r.jurisdiction_level==='province' && r.metric==='enslaved_count'), 1510806, 0],
  ['Cuba capital sub-groups ~= stated total (source $1k off)', sum(r => r.polity==='cuba_colonial' && r.metric==='capital_value' && r.sub_group), 507088002, 2000],
  ['Atlantic export by carrier == 74000', sum(r => r.polity==='atlantic_trade' && r.sub_group?.startsWith('carrier:')), 74000, 0],
  ['Atlantic export by region == 74200', sum(r => r.polity==='atlantic_trade' && r.sub_group?.startsWith('region:')), 74200, 0],
];
console.log(`\n=== VALIDATION (${rows.length} benchmark rows) ===`);
let ok = true;
for (const [label, got, want, tol] of checks) {
  const pass = Math.abs(got - want) <= tol; if (!pass) ok = false;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}: ${got.toLocaleString()} vs ${want.toLocaleString()}${tol && got!==want ? ` (Δ${got-want}, within tol)` : ''}`);
}
console.log('\nrows by polity:');
const byP = {}; rows.forEach(r => { byP[r.polity] = (byP[r.polity]||0)+1; });
console.table(byP);

if (!APPLY) { console.log(`\n[DRY RUN] ${ok ? 'all checks pass — re-run with --apply' : 'FIX validation before applying'}.`); process.exit(ok ? 0 : 2); }
if (!ok) { console.error('\n[ABORT] validation failed — refusing to write.'); process.exit(2); }

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
// Idempotent scope-reload: NULL jurisdiction/sub_group defeat ON CONFLICT (NULLs are distinct in
// Postgres), so re-running would duplicate. This script is the single curated source for these
// polities → clear them, then insert. Does not touch polities seeded by other scripts.
const polities = [...new Set(rows.map(r => r.polity))];
const del = await pool.query('DELETE FROM slave_economy_benchmarks WHERE polity = ANY($1) RETURNING id', [polities]);
console.log(`cleared ${del.rows.length} prior rows for polities: ${polities.join(', ')}`);
let w = 0;
for (const r of rows) {
  await pool.query(
    `INSERT INTO slave_economy_benchmarks (polity, jurisdiction, jurisdiction_level, benchmark_year, metric, sector, sub_group, value, unit, source_primary, source_conduit, evidence_tier, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (polity, jurisdiction, benchmark_year, metric, sector, sub_group) DO UPDATE SET
       value=EXCLUDED.value, unit=EXCLUDED.unit, source_primary=EXCLUDED.source_primary,
       source_conduit=EXCLUDED.source_conduit, evidence_tier=EXCLUDED.evidence_tier, note=EXCLUDED.note`,
    [r.polity, r.jurisdiction, r.jurisdiction_level, r.benchmark_year, r.metric, r.sector, r.sub_group, r.value, r.unit, r.source_primary, r.source_conduit, r.evidence_tier, r.note]);
  w++;
}
console.log(`\n[APPLIED] ${w} slave_economy_benchmarks rows upserted.`);
await pool.end();
