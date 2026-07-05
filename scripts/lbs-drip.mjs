// lbs-drip.mjs — the autonomous heartbeat for the UCL LBS Wayback pipeline (step 6).
//
// One idempotent, resumable tick (run by cron on the Mini). Each tick:
//   1) SELF-HEAL the crawl: if archived rows are still queued and no fetch process is running, relaunch
//      a detached `ucl-lbs-wayback.mjs --fetch` (survives cron exit). Reclaim stale 'fetching' rows.
//   2) PARSE a bounded batch: S3 HTML → lbs_raw_records.parsed (ingest-ucl-lbs.mjs --parse).
//   3) PROMOTE: parsed JSONB → spine + typed tables (ingest-ucl-lbs.mjs --promote).
//   4) Status line + ntfy (on error, or once when everything has drained).
//
// DB-is-truth: all progress is queried, never assumed. A lock file prevents overlapping ticks. Mirrors
// probate-drip / retrieval-health-audit cron discipline. See memory-bank/plan-ucl-lbs-scraper.md.
//
// Cron (Mini):  0 */2 * * *  cd ~/Desktop/Reparations-is-a-real-number && \
//                             /path/to/node scripts/lbs-drip.mjs >> /tmp/lbs-drip.log 2>&1
//
// Usage:  node scripts/lbs-drip.mjs            # one tick (fetch self-heal + parse batch + promote)
//         node scripts/lbs-drip.mjs --no-fetch # skip the fetch self-heal (parse+promote only)
//         flags: --parse-batch N (default 3000)

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn, execSync } from 'node:child_process';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const A = process.argv.slice(2);
const val = (f, d) => { const i = A.indexOf(f); return i > -1 ? A[i + 1] : d; };
const NO_FETCH = A.includes('--no-fetch');
const PARSE_BATCH = parseInt(val('--parse-batch', '3000'), 10);
const LOCK = '/tmp/lbs-drip.lock';
const NODE = process.execPath;

async function ntfy(msg) {
  const url = process.env.OPS_NOTIFY_WEBHOOK;
  if (!url) return;
  try { await fetch(url, { method: 'POST', body: `[lbs-drip] ${msg}` }); } catch { /* soft */ }
}
const runNode = (args) => execFileSync(NODE, args, { cwd: ROOT, stdio: 'inherit' });
const fetchRunning = () => {
  try { execSync('pgrep -f ucl-lbs-wayback', { stdio: 'ignore' }); return true; } catch { return false; }
};

async function main() {
  if (!process.env.DATABASE_URL) { console.error('FATAL: DATABASE_URL not set (fail-loud).'); process.exit(1); }

  // single-tick lock (stale lock >2h is ignored)
  if (fs.existsSync(LOCK)) {
    const age = (Date.now() - fs.statSync(LOCK).mtimeMs) / 60000;
    if (age < 120) { console.log(`another tick is running (lock ${age.toFixed(0)}m old) — exit.`); return; }
    console.log('stale lock — overriding.');
  }
  fs.writeFileSync(LOCK, String(process.pid));

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const stamp = new Date(fs.statSync(LOCK).mtimeMs).toISOString();
  try {
    const count = async (w) => (await pool.query(`SELECT count(*)::int n FROM ${w}`)).rows[0].n;
    const qz = 'lbs_crawl_frontier WHERE wayback_ts IS NOT NULL';
    let queued = await count(`${qz} AND status='queued'`);
    const done = await count(`${qz} AND status='done'`);
    const unparsed = await count(`lbs_raw_records WHERE parsed IS NULL AND html_s3_key IS NOT NULL`);
    console.log(`[${stamp}] start — fetched ${done}, queued ${queued}, unparsed ${unparsed}`);

    // 1) SELF-HEAL fetch
    if (!NO_FETCH && queued > 0) {
      // reclaim stale 'fetching' first (a killed fetch leaves rows mid-flight)
      const rec = await pool.query(
        `UPDATE lbs_crawl_frontier SET status='queued' WHERE status='fetching' AND wayback_ts IS NOT NULL
           AND claimed_at < now() - interval '30 minutes' RETURNING 1`);
      if (rec.rows.length) console.log(`  reclaimed ${rec.rows.length} stale fetching rows`);
      if (!fetchRunning()) {
        console.log('  fetch not running + queue non-empty → relaunching detached fetch');
        const out = fs.openSync('/tmp/lbs-wayback-fetch.log', 'a');
        const child = spawn(NODE, ['scripts/scrapers/ucl-lbs-wayback.mjs', '--fetch'],
          { cwd: ROOT, detached: true, stdio: ['ignore', out, out] });
        child.unref();
        await ntfy(`relaunched fetch (queue ${queued})`);
      } else console.log('  fetch already running');
    }

    // 2) PARSE a bounded batch (S3 → parsed JSONB)
    if (unparsed > 0) {
      console.log(`  parsing up to ${PARSE_BATCH}…`);
      try { runNode(['scripts/ingest-ucl-lbs.mjs', '--parse', '--apply', '--limit', String(PARSE_BATCH)]); }
      catch (e) { await ntfy(`parse failed: ${e.message}`); throw e; }
    }

    // 3) PROMOTE all newly-parsed (person→estate→claim→firm order handled inside)
    console.log('  promoting…');
    try { runNode(['scripts/ingest-ucl-lbs.mjs', '--promote', '--apply']); }
    catch (e) { await ntfy(`promote failed: ${e.message}`); throw e; }

    // 4) status
    queued = await count(`${qz} AND status='queued'`);
    const stillUnparsed = await count(`lbs_raw_records WHERE parsed IS NULL AND html_s3_key IS NOT NULL`);
    const persons = (await pool.query(`SELECT count(*)::int n FROM person_external_ids WHERE id_system='ucl_lbs_person'`)).rows[0].n;
    const claims = await count('lbs_claims');
    const poundsRow = await pool.query('SELECT COALESCE(SUM(comp_decimal),0)::numeric total FROM lbs_claims');
    console.log(`[done] queued ${queued}, unparsed ${stillUnparsed}, lbs_claims ${claims}, ` +
      `ucl_lbs_person ${persons}, Σ£ to owners ${Number(poundsRow.rows[0].total).toLocaleString()}`);
    if (queued === 0 && stillUnparsed === 0) await ntfy(`DRAINED ✓ claims=${claims} persons=${persons} Σ£=${Number(poundsRow.rows[0].total).toLocaleString()}`);
  } finally {
    fs.existsSync(LOCK) && fs.unlinkSync(LOCK);
    await pool.end();
  }
}

main().catch((e) => { try { fs.existsSync(LOCK) && fs.unlinkSync(LOCK); } catch {} console.error('FATAL:', e); process.exit(1); });
