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
// Sentinel the scraper writes while it has intentionally paused itself to wait
// for a human re-login. When present, a write-stall is EXPECTED — do not SIGSTOP.
const PAUSE_SENTINEL     = `${os.homedir()}/.probate-scraper-paused-${COLLECTION_ID}.json`;
// Backstop: if the scraper stalls WITHOUT self-pausing (some failure mode its own
// session-loss detection missed), freeze it with SIGSTOP so it can't keep
// hammering FamilySearch unattended. Disable with --no-auto-pause.
const AUTO_PAUSE         = !argv.includes('--no-auto-pause');
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

function scraperSelfPaused() {
    try { return fs.existsSync(PAUSE_SENTINEL); } catch { return false; }
}

// Freeze the scraper so it stops navigating. SIGSTOP leaves the process listed
// (pgrep still finds it) so we won't then misreport it as 'died'. Resume later
// with `kill -CONT <pid>` or just restart the scraper.
function suspendScraper() {
    try { execSync(`pkill -STOP -f '${PROC_PATTERN}'`); return true; }
    catch { return false; }
}

function logShowsLoginWall() {
    if (!LOG_FILE) return false;
    try {
        const buf = fs.readFileSync(LOG_FILE, 'utf8');
        const tail = buf.slice(-4000);
        return LOGIN_WALL_RE.test(tail);
    } catch { return false; }
}

// The actual captcha-spiral signature: many consecutive "No image thumbnail
// found" skips with ZERO real-work lines — i.e. every roll's index page is
// redirecting to the login wall. This is the ONLY thing that justifies an
// auto-SIGSTOP. A bare DB-write stall is NOT enough: a resume that skips
// thousands of already-written images (advanceViewerToImage ~6s each) can run
// 60-90m with no new rows yet is perfectly healthy.
function logShowsSpiral() {
    if (!LOG_FILE) return false;
    try {
        const tail = fs.readFileSync(LOG_FILE, 'utf8').slice(-6000);
        const skips = (tail.match(/No image thumbnail found/g) || []).length;
        const healthy = /S3 upload OK|person_documents|RESUME: Skipping|Image count:/.test(tail);
        return skips >= 8 && !healthy;
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

    // Determine current incident.
    // Priority: died > self-paused (expected) > login wall > stall/auto-pause > none
    const selfPaused = scraperSelfPaused();
    let incident = null, message = '', severity = 'error';
    if (!running) {
        incident = 'died'; severity = 'critical';
        message = `scraper process not found (pattern ${PROC_PATTERN}). ${count} images written so far.`;
    } else if (selfPaused) {
        // The scraper detected a logout and parked itself (not navigating). A
        // stall here is expected — page the operator, but never SIGSTOP it.
        incident = 'awaiting-reauth'; severity = 'warn';
        message = `scraper detected a FamilySearch logout and PAUSED itself — log in on the Mini (VNC vnc://100.114.130.16) and it resumes automatically. Stuck at ${count} images.`;
    } else if (stalledMs > STALL_THRESHOLD_MS && logShowsLoginWall()) {
        incident = 'login-wall'; severity = 'error';
        message = `no new writes for ${Math.round(stalledMs / 60000)}m and log shows a sign-in wall — re-login via VNC (vnc://100.114.130.16). Stuck at ${count} images.`;
    } else if (stalledMs > STALL_THRESHOLD_MS) {
        // DB writes have stopped. ONLY freeze the scraper if the log shows the
        // real captcha-spiral signature — a stall alone is a false positive for a
        // slow resume-skip or a large roll. Otherwise just alert (non-destructive).
        const spiral = logShowsSpiral();
        if (AUTO_PAUSE && spiral && s.incident !== 'auto-paused') {
            const frozen = suspendScraper();
            incident = 'auto-paused'; severity = 'error';
            message = frozen
                ? `captcha-spiral signature + no writes for ${Math.round(stalledMs / 60000)}m and no self-pause sentinel — SIGSTOPped the scraper to stop it hammering FamilySearch. Investigate via VNC, then 'kill -CONT' or restart. Stuck at ${count} images.`
                : `captcha-spiral signature + no writes for ${Math.round(stalledMs / 60000)}m — tried to SIGSTOP but pkill failed. Investigate via VNC. Stuck at ${count} images.`;
        } else if (s.incident === 'auto-paused') {
            incident = 'auto-paused'; severity = 'error';
            message = `scraper remains SIGSTOPped at ${count} images — awaiting manual restart.`;
        } else {
            incident = 'stall'; severity = 'error';
            message = `process alive but no new writes for ${Math.round(stalledMs / 60000)}m (stuck at ${count} images)`
                + (spiral ? '.' : ' — log shows no spiral (likely a slow resume-skip or large roll); NOT freezing.');
        }
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
    log(`probate-scrape-watchdog up — ${LABEL} (collection ${COLLECTION_ID}), interval ${CHECK_INTERVAL_MS / 60000}m, stall ${STALL_THRESHOLD_MS / 60000}m, auto-pause ${AUTO_PAUSE ? 'on' : 'off'}`);
    if (!process.env.OPS_NOTIFY_WEBHOOK) log('WARNING: OPS_NOTIFY_WEBHOOK not set — alerts will be skipped.');
    // Fresh start: clear any stall timer / incident inherited from a previous run
    // or a prior scraper instance, so a restart can't instantly look like an
    // hours-long stall and trip the backstop on a healthy scraper.
    { const s0 = loadState(); s0.lastProgressAt = Date.now(); s0.incident = null; saveState(s0); }
    await check();
    setInterval(() => { check().catch(e => log('check error', e.message)); }, CHECK_INTERVAL_MS);
})();
