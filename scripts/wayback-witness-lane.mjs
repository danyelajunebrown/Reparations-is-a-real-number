// wayback-witness-lane.mjs — the slow lane that attaches independent Wayback witnesses to archived sources.
//
// WHY A SEPARATE LANE. Rule 8 wants DUAL archive: our S3 copy plus an independent witness. The ARK drip
// tried to do both in one pass and Wayback answered 429 (x-rl=0) — Save Page Now rate-limits anonymous
// callers to roughly one capture per MINUTE. Archiving runs at ~20 documents per batch; witnessing cannot.
// Bolting them together meant the witness silently failed on nearly every scan while the archive succeeded,
// which is how 131,424 artifact rows ended up with no wayback_url.
//
// AND MOST OF THAT BACKLOG IS NOT WITNESSABLE AT ALL — measured, not assumed:
//     115,570 of 121,225 distinct URLs are www.familysearch.org
//     archive.org/wayback/available returns {"archived_snapshots": {}} for FS image AND record arks alike
// The Wayback Machine holds NOTHING for FamilySearch. Queueing those 115,570 would spend ~80 days
// producing either nothing or, worse, a "witness" that captured a login wall — a citation that looks like
// corroboration and shows a sign-in page. Recording that impossibility is the honest move; faking coverage
// is the failure this project keeps having to undo.
// So this lane serves the ~5,655 PUBLIC urls (marronnage.info, civilwardc.org, msa.maryland.gov,
// tile.loc.gov). At 1/min that is ~4 days — a real completion, not a decade of theatre.
//
// Cheap first: the CDX availability API is unthrottled, so an already-archived URL costs no SPN quota.
//
// Usage: node scripts/wayback-witness-lane.mjs [--limit 60] [--apply]
import 'dotenv/config';
import pg from 'pg';
import { getClosestSnapshot, saveToWayback } from './lib/wayback.mjs';

const A = process.argv.slice(2);
const val = (f, d) => { const i = A.indexOf(f); return i > -1 ? A[i + 1] : d; };
const APPLY = A.includes('--apply');
const LIMIT = +val('--limit', 60);
const GAP_MS = +val('--gap-ms', 70000);        // ~1/min, the documented anonymous SPN ceiling
const EXCLUDE = /familysearch\.org/i;          // cannot be witnessed — see header

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false },
  statement_timeout: 600000, query_timeout: 600000 });
pool.on('error', (e) => console.error(`[pool] ${e.message}`));

const rows = (await pool.query(`
  SELECT DISTINCT source_url FROM source_artifacts
   WHERE wayback_url IS NULL AND source_url IS NOT NULL AND source_url <> 'unrecorded'
     AND source_url !~* 'familysearch\\.org'
   LIMIT $1`, [LIMIT])).rows;
console.log(`${APPLY ? '=== APPLY ===' : '=== DRY RUN ==='} ${rows.length} witnessable URLs (familysearch excluded — Wayback holds none)`);

let existing = 0, fresh = 0, throttled = 0, none = 0;
for (const r of rows) {
  let snap = null;
  try { snap = await getClosestSnapshot(r.source_url); } catch { /* CDX miss is normal */ }
  if (snap) { existing++; }
  else if (APPLY) {
    try { snap = await saveToWayback(r.source_url); if (snap) fresh++; else none++; }
    catch (e) {
      if (e && e.throttled) {
        throttled++;
        console.log('  ⛔ Wayback throttled — stopping this tick rather than burning the backlog against a closed door.');
        break;
      }
      none++;
    }
    await sleep(GAP_MS);                        // only a CAPTURE costs quota; a CDX hit does not
  }
  if (snap && APPLY) {
    await pool.query(`UPDATE source_artifacts SET wayback_url=$1 WHERE source_url=$2 AND wayback_url IS NULL`,
      [snap, r.source_url]).catch((e) => console.error(`  ! ${e.message.slice(0, 70)}`));
  }
}
console.log(`=== existing ${existing} · newly captured ${fresh} · unavailable ${none} · throttled ${throttled} ===`);
await pool.end();
