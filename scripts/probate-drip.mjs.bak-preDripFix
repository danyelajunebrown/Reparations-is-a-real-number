#!/usr/bin/env node
/**
 * Probate extraction "drip" — one unit of work per invocation, cron-driven on the
 * Mac Mini. Advances the corpus through the free-tier daily budget automatically:
 *   pick the highest-priority roll with outstanding work (antebellum first) →
 *   v2-segment it if needed → extract its estates (resumable, self-limits on
 *   budget exhaustion) → notify. A lock prevents overlapping runs.
 *
 * Idempotent + safe to run on any schedule; each tick resumes where the last
 * stopped (segmentation writes probate_estate_segments_v2, extraction writes
 * probate_estate_extractions, both keyed so re-runs skip finished work).
 *
 *   node scripts/probate-drip.mjs [--dry]   # --dry: print the plan, do nothing
 */
import path from 'node:path'; import fs from 'node:fs'; import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import dotenv from 'dotenv'; import pg from 'pg';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const require = createRequire(import.meta.url);
const { execFileSync } = require('node:child_process');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const DRY = process.argv.includes('--dry');
const LOCK = '/tmp/probate-drip.lock';
const NODE = process.execPath;
const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);

async function notify(msg) {
  const url = process.env.OPS_NOTIFY_WEBHOOK;
  if (!url) return;
  try { await fetch(url, { method: 'POST', body: `[probate-drip] ${msg}`, signal: AbortSignal.timeout(8000) }); } catch {}
}

function locked() {
  if (!fs.existsSync(LOCK)) return false;
  const pid = parseInt(fs.readFileSync(LOCK, 'utf8'), 10);
  try { process.kill(pid, 0); return true; } catch { return false; } // stale lock if pid dead
}

(async () => {
  if (locked()) { log('another drip run is active — exiting.'); process.exit(0); }
  if (!DRY) fs.writeFileSync(LOCK, String(process.pid));
  try {
    // All Liberty rolls with a roll_group_id + name + page count.
    const rolls = (await pool.query(`
      SELECT p.roll_group_id AS roll, MIN(pd.collection_name) AS name, COUNT(*) AS pages
      FROM probate_scrape_progress p JOIN person_documents pd ON pd.id = p.person_document_id
      WHERE pd.collection_key LIKE 'georgia-probate-liberty-%' AND p.status='written' AND p.roll_group_id IS NOT NULL
      GROUP BY 1`)).rows;
    // antebellum = first year in the roll name < 1865 (where the enslaved valuations live)
    for (const r of rolls) { const m = (r.name||'').match(/\b(1[678]\d\d)\b/); r.startYear = m ? +m[1] : 9999; r.antebellum = r.startYear < 1865; }
    // antebellum first, then biggest rolls first (substantive books before 1-page stubs), then earliest.
    rolls.sort((a,b) => (b.antebellum-a.antebellum) || (b.pages-a.pages) || (a.startYear-b.startYear));

    const segRolls = new Set((await pool.query(`SELECT DISTINCT roll_group_id FROM probate_estate_segments_v2`)).rows.map(x=>x.roll_group_id));

    // find the first roll with outstanding work
    let target = null, action = null, pending = 0;
    for (const r of rolls) {
      if (!segRolls.has(r.roll)) { target = r; action = 'segment+extract'; break; }
      const un = (await pool.query(`SELECT COUNT(*) c FROM probate_estate_segments_v2 s
        WHERE s.roll_group_id=$1 AND s.id NOT IN (SELECT segment_id FROM probate_estate_extractions WHERE segment_id IS NOT NULL)`, [r.roll])).rows[0].c;
      if (+un > 0) { target = r; action = 'extract'; pending = +un; break; }
    }

    if (!target) { log('✓ all Liberty rolls fully extracted — nothing to do.'); await notify('corpus complete — all rolls extracted'); return; }
    log(`next: roll ${target.roll} "${(target.name||'').slice(0,55)}" [${target.pages}pp, ${target.antebellum?'ANTEBELLUM':'post-1865'}, start ${target.startYear}] → ${action}${pending?` (${pending} estates pending)`:''}`);
    if (DRY) { log('(dry run — not executing)'); return; }

    await notify(`${action} roll ${target.roll} (${target.antebellum?'antebellum':'post-1865'}, ${target.pages}pp)`);
    const runLog = path.resolve('/tmp', `drip-${target.roll}.log`);
    const opts = { stdio: ['ignore', fs.openSync(runLog,'a'), fs.openSync(runLog,'a')], env: process.env };
    if (action === 'segment+extract') {
      log('segmenting…');
      execFileSync(NODE, [path.resolve(__dirname,'segment-probate-v2.mjs'), '--roll', target.roll, '--apply'], opts);
    }
    log('extracting…');
    execFileSync(NODE, [path.resolve(__dirname,'extract-probate-estates.mjs'), '--roll', target.roll], opts);

    const agg = (await pool.query(`SELECT COUNT(*) estates, SUM(enslaved_count) enslaved, SUM(enslaved_valued_count) valued, SUM(total_appraised_usd) usd FROM probate_estate_extractions WHERE roll_group_id=$1`, [target.roll])).rows[0];
    const summary = `roll ${target.roll} now: ${agg.estates} estates, ${agg.enslaved||0} enslaved, ${agg.valued||0} valued, $${Math.round(agg.usd||0).toLocaleString()}`;
    log('✓ ' + summary); await notify('✓ ' + summary);
  } catch (e) {
    log('ERROR:', e.message); await notify('ERROR: ' + e.message.slice(0,120));
  } finally {
    if (!DRY && fs.existsSync(LOCK)) fs.unlinkSync(LOCK);
    await pool.end();
  }
})();
