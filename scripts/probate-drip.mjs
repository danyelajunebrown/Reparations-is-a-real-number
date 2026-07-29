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
 *   node scripts/probate-drip.mjs [--dry]            # all probate collections
 *   node scripts/probate-drip.mjs --prefix new-york-probate-   # scope to NY
 *   node scripts/probate-drip.mjs --prefix georgia-probate-liberty-
 *
 * --dry: print the plan, do nothing. --prefix: restrict to collection_keys with
 * that prefix (default: every '%-probate-%' collection). Rolls are prioritized by
 * their REAL earliest document_year (antebellum/slavery-era first), so colonial
 * NY estates with enslaved valuations are processed before post-emancipation rolls.
 */
import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os'; import { fileURLToPath } from 'node:url';
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
    // Rolls in scope: a --prefix restricts to one region's collection_keys
    // (e.g. 'new-york-probate-'); default covers every probate collection.
    const PREFIX = (() => { const i = process.argv.indexOf('--prefix'); return i > -1 ? process.argv[i+1] : null; })();
    const likePattern = PREFIX ? PREFIX + '%' : '%-probate-%';
    const rolls = (await pool.query(`
      SELECT p.roll_group_id AS roll, MIN(pd.collection_name) AS name, COUNT(*) AS pages,
             MIN(pd.document_year) AS min_year,
             COUNT(*) FILTER (WHERE pd.document_year < 1828) AS slavery_era_pages
      FROM probate_scrape_progress p JOIN person_documents pd ON pd.id = p.person_document_id
      WHERE pd.collection_key LIKE $1 AND p.status='written' AND p.roll_group_id IS NOT NULL
      GROUP BY 1`, [likePattern])).rows;
    // Prefer the REAL earliest document_year (now reliable post-#67 backfill); fall
    // back to a year parsed from the roll name (widened to cover colonial 16xx/17xx).
    for (const r of rolls) {
      let start = r.min_year != null ? +r.min_year : null;
      if (start == null) { const m = (r.name||'').match(/\b(1[5-9]\d\d)\b/); start = m ? +m[1] : 9999; }
      r.startYear = start;
      r.antebellum = start < 1865; // reaches into the slavery era (enslaved valuations live here)
    }
    // Slavery-era rolls first, then earliest, then biggest (substantive books before stubs).
    rolls.sort((a,b) => (b.antebellum-a.antebellum) || (a.startYear-b.startYear) || (b.pages-a.pages));

    const segRolls = new Set((await pool.query(`SELECT DISTINCT roll_group_id FROM probate_estate_segments_v2`)).rows.map(x=>x.roll_group_id));

    // Rolls already segment-ATTEMPTED that produced ZERO segments (e.g. 1-page
    // stubs / index pages with no estate header). Without remembering these, such a
    // roll is never in segRolls, so it is re-picked every tick forever — and since
    // it sorts to the front (antebellum), it blocks the WHOLE queue behind it (the
    // 9SBF-N38 wheel-spin that kept the drip from ever reaching NY). Persisted on
    // disk like the PID lock (operational state, host-local).
    const EMPTY_FILE = path.join(os.homedir(), '.probate-drip-empty-rolls.json');
    const emptyRolls = (() => { try { return new Set(JSON.parse(fs.readFileSync(EMPTY_FILE, 'utf8'))); } catch { return new Set(); } })();
    const saveEmpty = () => { try { fs.writeFileSync(EMPTY_FILE, JSON.stringify([...emptyRolls])); } catch {} };
    const execOpts = (roll) => { const f = path.resolve('/tmp', `drip-${roll}.log`); return { stdio: ['ignore', fs.openSync(f,'a'), fs.openSync(f,'a')], env: process.env }; };

    // Walk the prioritized rolls, advancing past genuinely-empty ones within THIS
    // run (bounded) so one tick can clear a cluster of stubs and still do real work.
    let target = null, action = null, pending = 0;
    const MAX_EMPTY_SKIPS = 40; let skipped = 0;
    for (const r of rolls) {
      if (emptyRolls.has(r.roll)) continue;                       // known-empty → skip
      if (!segRolls.has(r.roll)) {
        if (DRY) { target = r; action = 'segment+extract'; break; } // dry: don't actually segment
        log(`segmenting ${r.roll} "${(r.name||'').slice(0,45)}" [${r.pages}pp]…`);
        try {
          execFileSync(NODE, [path.resolve(__dirname,'segment-probate-v2.mjs'), '--roll', r.roll, '--apply'], execOpts(r.roll));
        } catch (segErr) {
          log(`  segmentation FAILED for ${r.roll}: ${(segErr.message||'').slice(0,80)} — leaving for retry (not blacklisted)`);
          continue;                                               // transient error → don't blacklist
        }
        const segCount = +(await pool.query(`SELECT COUNT(*) c FROM probate_estate_segments_v2 WHERE roll_group_id=$1`, [r.roll])).rows[0].c;
        if (segCount === 0) {
          emptyRolls.add(r.roll); saveEmpty();
          log(`  ↪ ${r.roll} produced 0 segments — marked empty, advancing`);
          if (++skipped > MAX_EMPTY_SKIPS) { log('hit empty-skip cap this tick — exiting, will resume next tick'); break; }
          continue;
        }
        target = r; action = 'segment+extract'; break;            // now has segments → extract below
      }
      const un = (await pool.query(`SELECT COUNT(*) c FROM probate_estate_segments_v2 s
        WHERE s.roll_group_id=$1 AND s.id NOT IN (SELECT segment_id FROM probate_estate_extractions WHERE segment_id IS NOT NULL)`, [r.roll])).rows[0].c;
      if (+un > 0) { target = r; action = 'extract'; pending = +un; break; }
    }

    if (!target) { log(`✓ all rolls in scope (${PREFIX || 'all probate'}) fully extracted${skipped?` (${skipped} empty rolls skipped this tick)`:''} — nothing to do.`); await notify('corpus complete — all rolls in scope extracted'); return; }
    log(`next: roll ${target.roll} "${(target.name||'').slice(0,55)}" [${target.pages}pp, ${target.antebellum?'ANTEBELLUM':'post-1865'}, start ${target.startYear}] → ${action}${pending?` (${pending} estates pending)`:''}`);
    if (DRY) { log('(dry run — not executing)'); return; }

    await notify(`${action} roll ${target.roll} (${target.antebellum?'antebellum':'post-1865'}, ${target.pages}pp)`);
    log('extracting…');                                          // segmentation (if any) already done during selection
    execFileSync(NODE, [path.resolve(__dirname,'extract-probate-estates.mjs'), '--roll', target.roll], execOpts(target.roll));

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
