#!/usr/bin/env node
/**
 * Audit CivilWarDC petition role classification against the authoritative TEI.
 *
 * The bulk ingestion (ingest-civilwardc-tei-bulk.mjs) treated whoever the TEI
 * marked as the filing "claimant" as the enslaver. That is correct for the
 * common April-16-1862 owner-filed petitions, but WRONG for the July-12-1862
 * supplementary-act petitions filed BY the enslaved when their owner refused or
 * neglected to file: there the enslaved petitioners got tagged enslaver and the
 * actual owner got swept into enslaved_persons_claimed / tagged enslaved.
 *
 * The TEI itself carries the ground truth in <particDesc>:
 *     <person role="owner">           → the enslaver
 *     <person role="petitioner-slave">→ the enslaved who filed (supplementary act)
 *     <person role="petitioner">      → owner-filer (normal; enslaver)
 *     <person role="jp|witness|...">  → neither
 *
 * This script (READ-ONLY) fetches every petition's XML, parses the authoritative
 * roles, and reports which petitions are inverted in the DB and which
 * canonical_persons have the wrong person_type. No writes. Pair with a
 * --apply fixer once the scope is reviewed.
 *
 *   node scripts/audit-civilwardc-roles.mjs            # full audit
 *   node scripts/audit-civilwardc-roles.mjs --limit 40 # quick sample
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i > -1 ? parseInt(process.argv[i + 1], 10) : null; })();
const CONCURRENCY = 6;

// Extract the <particDesc> person/role/persName triples (authoritative roles).
function parseRoles(xml) {
  const pd = xml.match(/<particDesc>([\s\S]*?)<\/particDesc>/);
  if (!pd) return [];
  const out = [];
  const re = /<person\b[^>]*\brole="([^"]+)"[^>]*>([\s\S]*?)<\/person>/g;
  let m;
  while ((m = re.exec(pd[1])) !== null) {
    const role = m[1];
    const names = [...m[2].matchAll(/<persName>([^<]+)<\/persName>/g)].map(x => x[1].trim());
    for (const n of names) out.push({ role, name: n });
  }
  return out;
}

async function fetchXml(pid) {
  const url = `https://civilwardc.org/texts/petitions/${pid}.xml`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.text();
}

async function mapLimit(items, limit, fn) {
  const out = []; let i = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx).catch(e => ({ error: e.message })); }
  });
  await Promise.all(workers);
  return out;
}

(async () => {
  let pets = (await pool.query(`SELECT docket_number, claimant_canonical_id, claimant_name FROM historical_reparations_petitions WHERE docket_number ~ '^cww\\.' ORDER BY docket_number`)).rows;
  if (LIMIT) pets = pets.slice(0, LIMIT);
  console.log(`Auditing ${pets.length} petitions (concurrency ${CONCURRENCY})…\n`);

  let done = 0;
  const results = await mapLimit(pets, CONCURRENCY, async (p) => {
    const r = { docket: p.docket_number, claimant_cp: p.claimant_canonical_id };
    try {
      const xml = await fetchXml(p.docket_number);
      const roles = parseRoles(xml);
      r.owners = roles.filter(x => x.role === 'owner').map(x => x.name);
      r.petitionerSlaves = roles.filter(x => x.role === 'petitioner-slave').map(x => x.name);
      r.petitioners = roles.filter(x => x.role === 'petitioner').map(x => x.name);
      r.inverted = r.petitionerSlaves.length > 0; // enslaved-filed supplementary petition
    } catch (e) { r.error = e.message; }
    if (++done % 100 === 0) console.log(`  …${done}/${pets.length}`);
    return r;
  });

  const ok = results.filter(r => !r.error);
  const errored = results.filter(r => r.error);
  const inverted = ok.filter(r => r.inverted);

  // For inverted petitions, check current DB person_type of owner + petitioner-slaves.
  const names = [...new Set(inverted.flatMap(r => [...r.owners, ...r.petitionerSlaves]))];
  const dbTypes = {};
  if (names.length) {
    const rows = (await pool.query(
      `SELECT canonical_name, person_type FROM canonical_persons WHERE canonical_name = ANY($1)`, [names])).rows;
    for (const row of rows) (dbTypes[row.canonical_name] ||= new Set()).add(row.person_type);
  }
  const ownersWrong = new Set(), enslavedWrong = new Set();
  for (const r of inverted) {
    for (const o of r.owners) if (dbTypes[o] && dbTypes[o].has('enslaved')) ownersWrong.add(o);          // owner tagged enslaved
    for (const s of r.petitionerSlaves) if (dbTypes[s] && [...dbTypes[s]].some(t => /enslaver|owner|slaveholder/.test(t))) enslavedWrong.add(s); // enslaved tagged enslaver
  }

  console.log(`\n════════ AUDIT SUMMARY ════════`);
  console.log(`Petitions fetched OK:            ${ok.length}`);
  console.log(`Fetch errors:                    ${errored.length}`);
  console.log(`Owner-filed (no petitioner-slave): ${ok.length - inverted.length}`);
  console.log(`Enslaved-filed (INVERTED) petitions: ${inverted.length}`);
  console.log(`  → distinct owners tagged 'enslaved' (should be enslaver): ${ownersWrong.size}`);
  console.log(`  → distinct petitioner-slaves tagged enslaver (should be enslaved): ${enslavedWrong.size}`);
  console.log(`\nSample inverted petitions:`);
  for (const r of inverted.slice(0, 12)) {
    console.log(`  ${r.docket}: owner=[${r.owners.join(', ')}] enslaved=[${r.petitionerSlaves.join(', ')}]`);
  }
  if (errored.length) console.log(`\nErrors (first 5):`, errored.slice(0, 5).map(r => `${r.docket}:${r.error}`).join(' | '));

  const reportPath = path.resolve(__dirname, '../test-results/civilwardc-role-audit.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({ summary: { ok: ok.length, inverted: inverted.length, ownersWrong: [...ownersWrong], enslavedWrong: [...enslavedWrong] }, inverted }, null, 2));
  console.log(`\nFull report → ${reportPath}`);
  await pool.end();
})();
