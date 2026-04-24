#!/usr/bin/env node
/**
 * Pi health watchdog. Runs on the Pi, polls Mini + Render + scraper status
 * every 2 minutes. Alerts via notify() on failure or degradation.
 *
 * Deployed as a systemd unit (scripts/pi/reparations-watchdog.service) so it
 * survives reboots and restarts on failure. Independent failure domain from
 * Mini — if Mini crashes, this keeps running and pages you.
 *
 * Check cadence:
 *   - Mini ops endpoint over Tailscale (every 2 min)
 *   - Render public health (every 2 min)
 *   - Chrome CDP on Mini (every 2 min, indirect via ops endpoint)
 *   - Scraper progress (every 5 min, drift detection)
 *
 * Alert policy:
 *   - 3 consecutive failures = page (not 1, to absorb transient jitter)
 *   - Recovery = single good check = "recovered" message
 *   - Progress stall = no heartbeat in 30 min on an "online" scraper
 *
 * Env required:
 *   OPS_NOTIFY_WEBHOOK   ntfy.sh topic URL
 *   MINI_OPS_URL         http://100.114.130.16:3000/api/ops/status
 *   OPS_SECRET           X-Ops-Secret header
 *   RENDER_HEALTH_URL    https://reparations-platform.onrender.com/api/health
 */

require('dotenv').config();
const { notify } = require('../../src/utils/notify');

const MINI_OPS_URL = process.env.MINI_OPS_URL || 'http://100.114.130.16:3000/api/ops/status';
const OPS_SECRET = process.env.OPS_SECRET;
const RENDER_HEALTH_URL = process.env.RENDER_HEALTH_URL || 'https://reparations-platform.onrender.com/api/health';

const CHECK_INTERVAL_MS = 2 * 60 * 1000;      // 2 min
const FAILURE_THRESHOLD = 3;                   // 3 consecutive fails before paging
const STALL_THRESHOLD_MS = 30 * 60 * 1000;     // 30 min without heartbeat = stalled

// Per-target state: { failStreak, lastState, lastAlertedAt }
const state = {
    mini_ops:    { failStreak: 0, lastState: 'unknown', lastAlertedAt: 0 },
    render:      { failStreak: 0, lastState: 'unknown', lastAlertedAt: 0 },
};

// Per-PM2-app stall state
const scraperStall = {};

// Zero-yield detection: if a scraper is online but DB growth has been zero
// for this many consecutive checks, alert. (30 checks × 2 min = 60 min.)
const ZERO_YIELD_THRESHOLD = 30;
let zeroYieldStreak = 0;
let zeroYieldAlertedAt = 0;

async function fetchJson(url, opts = {}, timeoutMs = 10000) {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function checkMini() {
    try {
        const data = await fetchJson(MINI_OPS_URL, {
            headers: { 'X-Ops-Secret': OPS_SECRET || '' },
        });
        return { ok: true, data };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

async function checkRender() {
    try {
        const data = await fetchJson(RENDER_HEALTH_URL);
        return { ok: true, data };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

async function recordCheck(target, ok, errorMsg) {
    const s = state[target];
    if (ok) {
        const wasDown = s.lastState === 'down';
        s.failStreak = 0;
        s.lastState = 'up';
        if (wasDown) {
            await notify(`${target} recovered`, { severity: 'info', tags: ['recovery', target] });
        }
    } else {
        s.failStreak += 1;
        if (s.failStreak === FAILURE_THRESHOLD) {
            s.lastState = 'down';
            s.lastAlertedAt = Date.now();
            await notify(
                `${target} is DOWN (${s.failStreak} consecutive failures): ${errorMsg}`,
                { severity: 'error', tags: ['down', target] }
            );
        } else if (s.failStreak > FAILURE_THRESHOLD && Date.now() - s.lastAlertedAt > 30 * 60 * 1000) {
            // Still down, re-page every 30 min
            s.lastAlertedAt = Date.now();
            await notify(
                `${target} still down after ${s.failStreak} checks: ${errorMsg}`,
                { severity: 'error', tags: ['stillDown', target] }
            );
        }
    }
}

async function checkScraperStalls(miniData) {
    if (!miniData?.pm2) return;
    for (const app of miniData.pm2) {
        if (app.status !== 'online') continue;
        // Skip the always-running server — only scrapers matter
        if (app.name === 'reparations-server' || app.name.startsWith('queue-')) continue;

        const stall = scraperStall[app.name] || { lastUptimeMs: 0, alertedAt: 0 };
        // Simple drift detection: pm2 uptime_ms increases monotonically. If
        // uptime goes backwards, app restarted. If uptime doesn't increase
        // between checks... that shouldn't happen (pm2 clock always advances).
        // Real stall detection requires scrape_runs heartbeat, which we'll
        // wire in v2. For now just track restarts.
        if (stall.lastUptimeMs > app.uptime_ms + 60_000) {
            await notify(
                `${app.name} restarted (PM2) — previous uptime ${Math.floor(stall.lastUptimeMs/1000)}s, now ${Math.floor(app.uptime_ms/1000)}s`,
                { severity: 'warn', tags: ['restart', app.name] }
            );
        }
        stall.lastUptimeMs = app.uptime_ms;
        scraperStall[app.name] = stall;
    }
}

async function checkZeroYield(miniData) {
    if (!miniData?.pm2 || !miniData?.data_health) return;

    // Are any scrapers online?
    const onlineScrapers = miniData.pm2.filter(a =>
        a.status === 'online' &&
        a.name !== 'reparations-server' &&
        !a.name.startsWith('queue-')
    );
    if (onlineScrapers.length === 0) {
        zeroYieldStreak = 0;
        return;
    }

    const dh = miniData.data_health;
    const totalWrites =
        (dh.unconfirmed_persons_updates_1h || 0) +
        (dh.unconfirmed_persons_inserts_1h || 0) +
        (dh.canonical_persons_inserts_1h || 0) +
        (dh.climb_matches_inserts_1h || 0);

    if (totalWrites === 0) {
        zeroYieldStreak += 1;
        if (zeroYieldStreak === ZERO_YIELD_THRESHOLD) {
            zeroYieldAlertedAt = Date.now();
            const scraperNames = onlineScrapers.map(a => a.name).join(', ');
            await notify(
                `Zero-yield scraper: ${scraperNames} online for 60+ min, 0 DB writes. Branch may be low-signal or parser broken. Check logs.`,
                { severity: 'warn', tags: ['zero-yield', 'data-quality'] }
            );
        } else if (zeroYieldStreak > ZERO_YIELD_THRESHOLD && Date.now() - zeroYieldAlertedAt > 2 * 60 * 60 * 1000) {
            // Still zero-yield after 2h, re-page
            zeroYieldAlertedAt = Date.now();
            const scraperNames = onlineScrapers.map(a => a.name).join(', ');
            await notify(
                `Still zero-yield: ${scraperNames} has produced 0 writes for ${Math.floor(zeroYieldStreak * 2 / 60)} hours.`,
                { severity: 'warn', tags: ['zero-yield', 'stillZeroYield'] }
            );
        }
    } else {
        if (zeroYieldStreak >= ZERO_YIELD_THRESHOLD) {
            await notify(
                `Scraper yield recovered: ${totalWrites} writes in last hour.`,
                { severity: 'info', tags: ['recovery', 'data-quality'] }
            );
        }
        zeroYieldStreak = 0;
    }
}

async function cycle() {
    const [mini, render] = await Promise.all([checkMini(), checkRender()]);

    await recordCheck('mini_ops', mini.ok, mini.error);
    await recordCheck('render', render.ok, render.error);

    if (mini.ok) {
        await checkScraperStalls(mini.data);
        await checkZeroYield(mini.data);
    }
}

async function main() {
    console.log(`[watchdog] starting — interval ${CHECK_INTERVAL_MS/1000}s, fail-threshold ${FAILURE_THRESHOLD}`);
    console.log(`[watchdog] mini: ${MINI_OPS_URL}`);
    console.log(`[watchdog] render: ${RENDER_HEALTH_URL}`);
    console.log(`[watchdog] notify: ${process.env.OPS_NOTIFY_WEBHOOK ? 'configured' : 'NOT CONFIGURED — alerts will be dropped'}`);

    await notify('Pi health watchdog started', { severity: 'info', tags: ['watchdog', 'start'] });

    // First check immediately, then on interval.
    while (true) {
        try {
            await cycle();
        } catch (e) {
            console.error('[watchdog] cycle error:', e.message);
        }
        await new Promise(r => setTimeout(r, CHECK_INTERVAL_MS));
    }
}

main().catch(e => {
    console.error('[watchdog] fatal:', e);
    process.exit(1);
});
