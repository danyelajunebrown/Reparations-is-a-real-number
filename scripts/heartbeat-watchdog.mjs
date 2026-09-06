// heartbeat-watchdog.mjs — the dead-man's switch. Alerts when the Mini STOPS writing.
//
// WHY THIS EXISTS (2026-09-06). The Mac Mini stopped between 03:31 and 04:00 EDT on 2026-09-04 and
// nobody was told for 39 hours. Not because a check failed — because every check runs ON the Mini.
// `project-health-monitor` and `auto-issue-monitor` can only report while the host they monitor is
// alive, so the one condition they can never report is that host's death. That is the same defect
// family as the 1860 coverage metric that measured itself: a check that only runs when things are
// fine cannot tell you things are not fine.
//
// [[standard-project-monitoring-and-free-agents]] already names the gap and its fix — "the agents run
// ON it, so a Tailscale/Mini drop = no recovery. A Pi-side watchdog that pings the Mini would close
// this." The Pi has been offline since ~May, so the intended watchdog was never built.
//
// THE ONE RULE: **this script must run somewhere the monitored host is NOT.** On the Mini it is
// worthless — it would die with the thing it watches. Run it from the MacBook, from CI, from
// anywhere with DATABASE_URL. It needs no Mini, no Chrome, no ollama, no scraping.
//
// It writes no heartbeat of its own. A watchdog that records its own liveness has recreated the
// problem one layer up.
//
// Usage:
//   node scripts/heartbeat-watchdog.mjs            # check, print, exit non-zero if stale
//   node scripts/heartbeat-watchdog.mjs --json     # machine-readable
//   node scripts/heartbeat-watchdog.mjs --all      # include informational heartbeats
import 'dotenv/config';
import pg from 'pg';

const AS_JSON = process.argv.includes('--json');
const SHOW_ALL = process.argv.includes('--all');

// Cadences are the Mini's real crontab per [[standard-project-monitoring-and-free-agents]].
// `graceMult` is how many cadences may elapse before we call it dead — NOT a magic constant.
// A missed tick is noise; several in a row is a fact.
const HEARTBEATS = [
  {
    name: 'project-health-monitor',
    role: 'primary',              // primary = its silence means the HOST is gone
    cadenceMin: 240,              // cron 0 */4 * * *
    graceMult: 1.25,             // 5h — one missed run plus slack
    sql: `SELECT max(ran_at) t FROM monitor_health_runs`,
    why: 'the RULE 0.7 invariant battery. If this is silent the Mini is not running anything.',
  },
  {
    name: 'reocr-holdings-monitor',
    role: 'primary',
    cadenceMin: 30,               // cron :00 / :30
    graceMult: 4,                 // 2h
    sql: `SELECT max(ran_at) t FROM document_ocr_runs`,
    // NB it writes a row even when the Gemini free-tier daily quota is spent (action='ocr_empty'),
    // so the ROW is the heartbeat, not the OCR succeeding. Caveat: if the 236K backlog ever fully
    // drains this goes quiet legitimately — revisit the day that happens, it is not close.
    why: 'fires every 30 min, so it detects a stop ~8x faster than the 4-hourly monitor.',
  },
  {
    name: 'probate scrape (informational)',
    role: 'info',                 // info = report, never gate — this one is known-paused
    cadenceMin: 180,
    graceMult: 8,
    sql: `SELECT max(processed_at) t FROM probate_scrape_progress`,
    why: 'no page processed since 2026-08-07; surfaced so the silence stays visible, not gating.',
  },
];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false },
  statement_timeout: 30000, query_timeout: 30000 });
// #155: an unhandled pool error killed the whole RULE 0.7 suite once. Never again in a watchdog.
pool.on('error', (e) => console.error(`[pool] ${e.message}`));

const mins = (a, b) => Math.round((a - b) / 60000);
const fmt  = (n) => n >= 1440 ? `${(n/1440).toFixed(1)}d` : n >= 60 ? `${(n/60).toFixed(1)}h` : `${n}m`;

let results = [];
let reachable = true;
try {
  const now = (await pool.query('SELECT now() n')).rows[0].n;
  for (const h of HEARTBEATS.filter((h) => SHOW_ALL || h.role !== 'info' || true)) {
    let last = null, err = null;
    try { last = (await pool.query(h.sql)).rows[0].t; }
    catch (e) { err = e.message.slice(0, 80); }
    const age = last ? mins(now, last) : null;
    const limit = Math.round(h.cadenceMin * h.graceMult);
    const stale = err ? null : (age === null || age > limit);
    results.push({ ...h, last, ageMin: age, limitMin: limit, stale, err });
  }
} catch (e) {
  // FAIL LOUD. An unreachable database is its own alarm, never a silent pass. The project's
  // signature bug is infrastructure state disguised as a finding (`catch { count as miss }`).
  reachable = false;
  results = [{ name: 'DATABASE', role: 'primary', stale: true, err: e.message.slice(0, 120) }];
}
await pool.end().catch(() => {});

const dead = results.filter((r) => r.role === 'primary' && r.stale);
const ok   = results.filter((r) => r.role === 'primary' && r.stale === false);

if (AS_JSON) {
  console.log(JSON.stringify({ reachable, dead: dead.map((d) => d.name), results }, null, 1));
} else {
  console.log(`\n════ HEARTBEAT WATCHDOG — does the Mini still write? ════\n`);
  for (const r of results) {
    const tag = r.err ? 'ERROR   ' : r.stale ? '** DEAD **' : 'alive   ';
    const age = r.err ? r.err : r.ageMin === null ? 'never written' : `last write ${fmt(r.ageMin)} ago (limit ${fmt(r.limitMin)})`;
    console.log(`  ${tag} ${r.name.padEnd(30)} ${age}${r.role === 'info' ? '   [informational]' : ''}`);
  }
  console.log();
  if (!reachable)      console.log('  ⚠️  Could not reach the database — this is an alarm, not a pass.\n');
  else if (dead.length) console.log(`  ⚠️  ${dead.length} primary heartbeat(s) silent. The Mini is very likely down.\n`);
  else                  console.log(`  ✅ ${ok.length}/${ok.length} primary heartbeats alive.\n`);
}

// ── Alerting: try every channel we actually have. Never depend on only one. ──────────────────────
if (dead.length) {
  const title = `Mini heartbeat lost: ${dead.map((d) => d.name).join(', ')}`;
  const body  = results.map((r) => `${r.name}: ${r.err || (r.ageMin === null ? 'never' : fmt(r.ageMin) + ' ago')}`).join('\n');

  const hook = process.env.OPS_NOTIFY_WEBHOOK;
  if (hook) {
    try {
      await fetch(hook, { method: 'POST', headers: { Title: 'Mini heartbeat lost', Priority: 'high' }, body });
      console.log('  → ntfy sent');
    } catch (e) { console.log(`  → ntfy FAILED: ${e.message.slice(0, 60)}`); }
  } else {
    console.log('  → ntfy skipped (OPS_NOTIFY_WEBHOOK not set in this .env — it lives on the Mini)');
  }

  // Local desktop notification — free, needs no config, works when this runs on the MacBook.
  if (process.platform === 'darwin') {
    const { execFile } = await import('child_process');
    execFile('osascript', ['-e',
      `display notification ${JSON.stringify(body.slice(0, 200))} with title "Reparations: Mini heartbeat lost"`],
      () => {});
  }
  console.log();
}

process.exit(dead.length || !reachable ? 1 : 0);
