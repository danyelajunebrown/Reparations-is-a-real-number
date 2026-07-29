// monitor-past-scaleup-ntfy.mjs
//
// Observability sidecar for the SlaveVoyages PAST scale-up (#117). Polls DB progress and pings
// ntfy periodically + on completion/stall. Does NOT touch the scale-up — read-only observer.
//
//   OPS_NOTIFY_WEBHOOK=https://ntfy.sh/<topic> node scripts/monitor-past-scaleup-ntfy.mjs
//   (optional) --interval 900   seconds between pings (default 900 = 15 min)
//
// Sends: periodic progress (on_spine/total, %, +delta, rate, ETA); a ✅ COMPLETE ping when
// remaining hits 0; a ⚠️ STALLED ping (with the resume one-liner) if progress flatlines.

import 'dotenv/config';
import os from 'os';
import pg from 'pg';

const WEBHOOK = process.env.OPS_NOTIFY_WEBHOOK || '';
const ii = process.argv.indexOf('--interval');
const INTERVAL = (ii > -1 ? +process.argv[ii + 1] : 900) * 1000;
if (!WEBHOOK) { console.error('OPS_NOTIFY_WEBHOOK not set — nothing to notify. Set it and relaunch.'); process.exit(1); }

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const RESUME = 'node scripts/promote-slavevoyages-past-to-leads.mjs --apply --concurrency 16';

async function ntfy(message, { severity = 'info', title = 'PAST scale-up' } = {}) {
  const priority = severity === 'error' ? 5 : severity === 'warn' ? 4 : 3;
  try {
    await fetch(WEBHOOK, { method: 'POST',
      headers: { Title: `[${os.hostname()}] ${title}`, Priority: String(priority), Tags: 'desilo,slavevoyages' },
      body: String(message), signal: AbortSignal.timeout(5000) });
  } catch (e) { console.error('ntfy failed:', e.message); }
}

const snap = async () => (await pool.query(
  `SELECT count(*)::int total, count(*) FILTER (WHERE linked_subject_id IS NOT NULL)::int on_spine,
          count(*) FILTER (WHERE linked_subject_id IS NULL AND name IS NOT NULL AND name<>'')::int remaining
   FROM slavevoyages_past_people`)).rows[0];

let last = null, flat = 0;
await ntfy(`monitor started (interval ${INTERVAL/1000}s)`);
for (;;) {
  let s;
  try { s = await snap(); } catch (e) { await ntfy(`monitor DB error: ${e.message}`, { severity: 'warn' }); await new Promise(r => setTimeout(r, INTERVAL)); continue; }
  const pct = (100 * s.on_spine / s.total).toFixed(1);
  const delta = last ? s.on_spine - last : 0;
  const rate = last ? delta / (INTERVAL / 1000) : 0; // rows/sec
  const etaH = rate > 0 ? (s.remaining / rate / 3600).toFixed(1) : '?';

  if (s.remaining === 0) { await ntfy(`✅ COMPLETE — ${s.on_spine.toLocaleString()}/${s.total.toLocaleString()} PAST people on the spine.`); break; }

  if (last !== null && delta === 0) {
    flat++;
    if (flat >= 1) { await ntfy(`⚠️ STALLED at ${s.on_spine.toLocaleString()}/${s.total.toLocaleString()} (${pct}%), ${s.remaining.toLocaleString()} left — scale-up appears stopped. Resume:\n${RESUME}`, { severity: 'warn' }); }
  } else {
    flat = 0;
    await ntfy(`${s.on_spine.toLocaleString()}/${s.total.toLocaleString()} on spine (${pct}%), +${delta.toLocaleString()} since last, ~${rate.toFixed(1)}/s, ETA ~${etaH}h, ${s.remaining.toLocaleString()} left`);
  }
  last = s.on_spine;
  await new Promise(r => setTimeout(r, INTERVAL));
}
await pool.end();
