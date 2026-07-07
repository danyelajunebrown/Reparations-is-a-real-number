// ingest-enslaved-org.mjs — ingest the Enslaved.org "Peoples of the Historical Slave Trade" Wikibase
// dump (#136) onto the spine as GATED SECONDARY leads, via the fast set-based bulk path.
//
// Dump = standard Wikibase JSON (one Q-entity/line; latest.wikibase.dump.json.gz, no auth). Event-centric
// ontology → role/status derived from statements, not a person_type column. Property map (from the dump):
//   P20 hasName · P31 hasSex · P32 hasRaceorColor · P22 hasOccupation · P33 hasPersonStatus ·
//   P17 hasParticipantRole · P37 hasSpouse · P38 hasChild · P13 hasContributor · P21 hasExternalReference.
//
// TWO PASSES over the gz stream: (1) build Q-id→label + property map (resolve the vocab Q-refs);
// (2) for each PERSON entity (has P20 hasName), extract fields, SKIP federated slices we already hold
// (SlaveVoyages/Hall via P13), and feed scripts/lib/bulk-lead-ingest.mjs (~1,600 leads/sec).
//
// DISCIPLINE: id_system='enslaved_org_qid' (Q-id = globally unique, clean namespace); gated secondary
// (LOD, no images → no gate lift); Biscoe-safe (bulk mints 'pending' leads; cross-source dedup runs
// after); reference-class hygiene (status = dated fact, not "enslaved at place X"). RULE 0.5: embed after.
//
// Usage:
//   node scripts/ingest-enslaved-org.mjs <dump.json.gz> --stats            # pass-1 scan only (no writes)
//   node scripts/ingest-enslaved-org.mjs <dump.json.gz> --apply [--limit N]

import 'dotenv/config';
import fs from 'node:fs';
import zlib from 'node:zlib';
import readline from 'node:readline';
import pg from 'pg';
import { bulkIngestLeads } from './lib/bulk-lead-ingest.mjs';

const FILE = process.argv[2];
const APPLY = process.argv.includes('--apply');
const STATS = process.argv.includes('--stats');
const li = process.argv.indexOf('--limit'); const LIMIT = li > -1 ? +process.argv[li + 1] : Infinity;
if (!FILE || !fs.existsSync(FILE)) { console.error('usage: node scripts/ingest-enslaved-org.mjs <dump.json.gz> [--stats|--apply] [--limit N]'); process.exit(1); }

const ID_SYSTEM = 'enslaved_org_qid';
const BASE = 'https://lod.enslaved.org/wiki/';
const Q_PERSON = 'Q410';          // P1 instance of → Person
const Q_SOURCE = 'Q67';           // P1 instance of → Entity with Provenance (a Source)
// Federated datasets we ALREADY hold on the spine — never re-ingest. Matched on the SOURCE name/project
// (SlaveVoyages products: Trans-Atlantic/Intra-American voyages + African Origins + Oceans of Kinfolk +
// Texas Bound = our slavevoyages_* ; Hall = Louisiana Slave Database).
const SKIP_SOURCE = /slave\s*voyages|trans-?atlantic slave|intra-?american slave|african origins|oceans of kinfolk|texas bound|louisiana slave database|midlo hall/i;

function stream(path) {
  return readline.createInterface({ input: fs.createReadStream(path).pipe(zlib.createGunzip()), crlfDelay: Infinity });
}
function parseLine(line) {
  line = line.trim(); if (!line || line === '[' || line === ']') return null;
  if (line.endsWith(',')) line = line.slice(0, -1);
  try { return JSON.parse(line); } catch { return null; }
}
const enLabel = (e) => e?.labels?.en?.value || null;
const claims = (e, p) => (e.claims && e.claims[p]) || [];
const strVals = (e, p) => claims(e, p).map(s => s?.mainsnak?.datavalue?.value).filter(v => typeof v === 'string');
const itemIds = (e, p) => claims(e, p).map(s => s?.mainsnak?.datavalue?.value?.id).filter(Boolean);
const qtyVal = (e, p) => { const v = claims(e, p)[0]?.mainsnak?.datavalue?.value?.amount; return v != null ? parseInt(v, 10) : null; };

// dominant source of a person = first reference P6 (isDirectlyBasedOn) → Source entity.
function personSourceQ(e) {
  for (const P of Object.keys(e.claims || {})) {
    for (const st of e.claims[P]) {
      for (const ref of (st.references || [])) {
        const q = ref.snaks?.P6?.[0]?.datavalue?.value?.id;
        if (q) return q;
      }
    }
  }
  return null;
}

async function main() {
  console.log(`Pass 1: building label + SOURCE map from ${FILE} …`);
  const label = new Map();          // Qid/Pid -> en label
  const sources = new Map();        // Source Qid -> { name, project, license }
  let n = 0;
  for await (const line of stream(FILE)) {
    const e = parseLine(line); if (!e) continue;
    const l = enLabel(e); if (l) label.set(e.id, l);
    if (e.type === 'item' && itemIds(e, 'P1').includes(Q_SOURCE)) {
      sources.set(e.id, { name: strVals(e, 'P20')[0] || l, project: e.claims?.P16 ? label.get(itemIds(e, 'P16')[0]) : null, license: e.claims?.P15 ? label.get(itemIds(e, 'P15')[0]) : null });
    }
    if (++n % 100000 === 0) process.stdout.write(`\r  scanned ${n}, ${label.size} labels, ${sources.size} sources  `);
  }
  // resolve source project/license labels now that all labels are known
  for (const [q, s] of sources) { if (s.project && !/^Q/.test(s.project)) {} }
  console.log(`\n  ${n} entities, ${label.size} labels, ${sources.size} sources.`);
  const lbl = (id) => (id ? (label.get(id) || null) : null);
  const srcName = (q) => { const s = sources.get(q); return s ? (s.name || '') + ' | ' + (s.project || '') : ''; };

  console.log(`Pass 2: extracting persons (P1→Person, status via P33 only) …`);
  const pool = APPLY ? new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }) : null;
  const stats = { persons: 0, skipped_federated: 0, no_source: 0, enslaver: 0, enslaved: 0, unknown: 0, no_name: 0, created: 0, linked: 0 };
  const srcHist = new Map();
  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    if (APPLY) { const r = await bulkIngestLeads(pool, batch, { batchSize: 2000 }); stats.created += r.created; stats.linked += r.linked; }
    batch = [];
  };

  for await (const line of stream(FILE)) {
    if (stats.persons >= LIMIT) break;
    const e = parseLine(line); if (!e || e.type !== 'item') continue;
    if (!itemIds(e, 'P1').includes(Q_PERSON)) continue;    // person = instance of Q410
    stats.persons++;
    const name = strVals(e, 'P20')[0] || enLabel(e);
    if (!name) { stats.no_name++; continue; }

    const srcQ = personSourceQ(e);
    const srcLabel = srcQ ? srcName(srcQ) : '';
    if (srcLabel) srcHist.set(srcLabel, (srcHist.get(srcLabel) || 0) + 1);
    if (!srcQ) stats.no_source++;
    if (srcLabel && SKIP_SOURCE.test(srcLabel)) { stats.skipped_federated++; continue; }   // already hold SV/Hall

    // status: P33 ONLY (Q109 Enslaved Person / Q112 Enslaver or Owner) — NOT P17 role / P39 rel-type.
    const statusLabels = itemIds(e, 'P33').map(lbl).filter(Boolean);
    let personType = 'unknown';
    if (statusLabels.some(s => /enslaver|owner/i.test(s))) personType = 'enslaver';
    else if (statusLabels.some(s => /enslaved/i.test(s))) personType = 'enslaved';
    personType === 'enslaver' ? stats.enslaver++ : personType === 'enslaved' ? stats.enslaved++ : stats.unknown++;

    const sex = lbl(itemIds(e, 'P31')[0]);
    const sexN = sex ? (/^m/i.test(sex) ? 'm' : /^f/i.test(sex) ? 'f' : null) : null;
    const race = lbl(itemIds(e, 'P32')[0]);
    const occupation = lbl(itemIds(e, 'P22')[0]) || strVals(e, 'P22')[0];
    const ethno = lbl(itemIds(e, 'P46')[0]);
    const age = lbl(itemIds(e, 'P42')[0]);                 // "Age NN" category
    const src = sources.get(srcQ);
    const ctx = [statusLabels.length && `status: ${statusLabels.join(', ')}`, occupation && `occupation: ${occupation}`,
      race && `race: ${race}`, ethno && `origin: ${ethno}`, age && age, src?.name && `source: ${src.name}`, `enslaved.org ${e.id}`]
      .filter(Boolean).join('; ');

    batch.push({
      name, sourceUrl: BASE + e.id, externalId: e.id, idSystem: ID_SYSTEM,
      personType, sex: sexN, sourceType: 'scholarly', extractionMethod: 'bulk', confidence: 0.85,
      context: ctx.slice(0, 900),
      dataQualityFlags: { enslaved_org_source: src?.name || null, enslaved_org_project: src?.project || null, license: src?.license || null },
    });
    if (batch.length >= 5000) await flush();
  }
  await flush();
  if (pool) await pool.end();

  console.log('\n=== stats ===', JSON.stringify(stats));
  console.log('top sources (name | project):');
  [...srcHist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([s, k]) => console.log(`  ${k}\t${s}`));
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
