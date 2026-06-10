#!/usr/bin/env node
/**
 * Probate scrape watchdog. Runs ON THE MINI alongside a long-running
 * probate scrape (the generic georgia-probate-scraper.js driving any
 * collection) and pages via notify()/ntfy on the failure modes specific
 * to these multi-week crawls:
 *
 *   - process died        — the scraper node process is gone
 *   - write stall         — process alive but no new rows in
 *                           probate_scrape_progress for STALL_THRESHOLD
 *                           (usually a FamilySearch login wall — the
 *                           scraper blocks waiting for manual re-login)
 *   - login wall          — the log tail shows a sign-in / login-timeout
 *
 * Host-level "Mini is down" is already covered by the Pi health-watchdog
 * (separate failure domain). This only watches the scrape.
 *
 * Alerts fire on STATE TRANSITIONS only (healthy->down once, down->healthy
 * once) so it never spams. Fails silent on notify errors.
 *
 * Run via PM2 so it survives restarts:
 *   pm2 start scripts/scrapers/probate-scrape-watchdog.js \
 *     --name probate-watchdog-ny -- \
 *     --collection 1920234 --label "NY probate" --log ~/probate-newyork-full.log
 *
 * Env required: DATABASE_URL, OPS_NOTIFY_WEBHOOK (both already in Mini .env)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const { Pool } = require('pg');
const { notify } = require('../../src/utils/notify');

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return (i !== -1 && argv[i + 1]) ? argv[i + 1] : d; };

const COLLECTION_ID      = opt('--collection', '1920234');
const LABEL              = opt('--label', `collection ${COLLECTION_ID}`);
const LOG_FILE           = opt('--log', '');
const CHECK_INTERVAL_MS  = parseInt(opt('--interval-min', '10'), 10) * 60 * 1000;
const STALL_THRESHOLD_MS = parseInt(opt('--stall-min', '30'), 10) * 60 * 1000;
const STATE_FILE         = `${os.homedir()}/.probate-watchdog-${COLLECTION_ID}.json`;
// Process-match pattern: the scraper invoked with this collection id.
const PROC_PATTERN       = `georgia-probate-scraper.js.*${COLLECTION_ID}`;
const LOGIN_WALL_RE      = /waiting for (manual )?login|login (timed out|timeout)|not logged in|please (sign|log) in/i;

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

function log(...a) { console.log(`[${new Date().toISOString()}]`, ...a); }

function loadState() {
    try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
    catch { return { lastCount: null, lastProgressAt: Date.now(), incident: null }; }
}
function saveState(s) { try { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); } catch (e) { log('state write failed', e.message); } }

function scraperRunning() {
    try {
        const out = execSync(`pgrep -f '${PROC_PATTERN}' || true`, { encoding: 'utf8' }).trim();
        // Exclude this watchdog's own pid just in case the pattern is loose.
        return out.split('\n').filter(p => p && Number(p) !== process.pid).length > 0;
    } catch { return false; }
}

async function dbCount() {
    const r = await pool.query(
        `SELECT count(*)::int AS n FROM probate_scrape_progress WHERE collection_id = $1 AND status = 'written'`,
        [COLLECTION_ID]
    );
    return r.rows[0].n;
}

function logShowsLoginWall() {
    if (!LOG_FILE) return false;
    try {
        const buf = fs.readFileSync(LOG_FILE, 'utf8');
        const tail = buf.slice(-4000);
        return LOGIN_WALL_RE.test(tail);
    } catch { return false; }
}

async function page(incident, message, severity) {
    log(`ALERT [${severity}] ${incident}: ${message}`);
    await notify(`${LABEL}: ${message}`, { severity, title: `probate-scrape ${incident}`, tags: ['scraper', 'probate'] });
}

async function check() {
    const s = loadState();
    const running = scraperRunning();
    let count = null;
    try { count = await dbCount(); } catch (e) { log('db query failed (transient?):', e.message); return; }

    const now = Date.now();
    const advanced = s.lastCount === null || count > s.lastCount;
    if (advanced) { s.lastProgressAt = now; }
    const stalledMs = now - (s.lastProgressAt || now);

    // Determine current incident (priority: died > login wall > stall > none)
    let incident = null, message = '', severity = 'error';
    if (!running) {
        incident = 'died'; severity = 'critical';
        message = `scraper process not found (pattern ${PROC_PATTERN}). ${count} images written so far.`;
    } else if (stalledMs > STALL_THRESHOLD_MS && logShowsLoginWall()) {
        incident = 'login-wall'; severity = 'error';
        message = `no new writes for ${Math.round(stalledMs / 60000)}m and log shows a sign-in wall — re-login via VNC (vnc://100.114.130.16). Stuck at ${count} images.`;
    } else if (stalledMs > STALL_THRESHOLD_MS) {
        incident = 'stall'; severity = 'error';
        message = `process alive but no new writes for ${Math.round(stalledMs / 60000)}m (stuck at ${count} images).`;
    }

    // Alert only on transitions.
    if (incident && s.incident !== incident) {
        await page(incident, message, severity);
    } else if (!incident && s.incident) {
        await page('recovered', `recovered — now ${count} images written and advancing.`, 'info');
    }

    s.incident = incident;
    s.lastCount = count;
    saveState(s);
    log(`check: running=${running} written=${count} stalled=${Math.round(stalledMs / 60000)}m incident=${incident || 'none'}`);
}

(async () => {
    log(`probate-scrape-watchdog up — ${LABEL} (collection ${COLLECTION_ID}), interval ${CHECK_INTERVAL_MS / 60000}m, stall ${STALL_THRESHOLD_MS / 60000}m`);
    if (!process.env.OPS_NOTIFY_WEBHOOK) log('WARNING: OPS_NOTIFY_WEBHOOK not set — alerts will be skipped.');
    await check();
    setInterval(() => { check().catch(e => log('check error', e.message)); }, CHECK_INTERVAL_MS);
})();
