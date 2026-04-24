/**
 * /api/ops — operational status endpoints.
 *
 * Protected by X-Ops-Secret header (OPS_SECRET env var). Lets us query
 * scrape state, process health, and recent logs from any network without
 * needing SSH. Paired with migration 045 (scrape_runs) + PM2.
 */

const express = require('express');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const db = require('../../database/connection');
const logger = require('../../utils/logger');

function authed(req, res, next) {
    const secret = process.env.OPS_SECRET;
    if (!secret) return res.status(503).json({ success: false, error: 'OPS_SECRET not configured' });
    if (req.headers['x-ops-secret'] !== secret) {
        return res.status(401).json({ success: false, error: 'bad or missing X-Ops-Secret' });
    }
    next();
}

// GET /api/ops/status — one-shot overview
router.get('/status', authed, async (req, res) => {
    try {
        const runs = await db.query(`
            SELECT id, runner, branch, host, pid, status, started_at, finished_at,
                   exit_code, pages_ocrd, records_parsed, matches, db_updates, errors,
                   last_heartbeat,
                   EXTRACT(EPOCH FROM (NOW() - COALESCE(last_heartbeat, started_at)))::int AS seconds_since_heartbeat
            FROM scrape_runs
            WHERE status = 'running' OR finished_at > NOW() - INTERVAL '24 hours'
            ORDER BY started_at DESC
            LIMIT 50
        `);

        let pm2 = null;
        try {
            const out = execSync('pm2 jlist 2>/dev/null', { encoding: 'utf8', timeout: 5000 });
            pm2 = JSON.parse(out).map(a => ({
                name: a.name,
                pid: a.pid,
                status: a.pm2_env?.status,
                restarts: a.pm2_env?.restart_time,
                uptime_ms: a.pm2_env?.pm_uptime ? Date.now() - a.pm2_env.pm_uptime : null,
                memory_mb: Math.round((a.monit?.memory || 0) / 1024 / 1024),
                cpu_pct: a.monit?.cpu,
            }));
        } catch (e) {
            pm2 = { error: e.message };
        }

        res.json({
            success: true,
            host: require('os').hostname(),
            time: new Date().toISOString(),
            pm2,
            active_runs: runs.rows.filter(r => r.status === 'running'),
            recent_runs: runs.rows.filter(r => r.status !== 'running'),
        });
    } catch (e) {
        logger.error('ops/status error', { e: e.message });
        res.status(500).json({ success: false, error: e.message });
    }
});

// GET /api/ops/logs?name=reparations-server&lines=200
router.get('/logs', authed, async (req, res) => {
    const name = String(req.query.name || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const lines = Math.min(parseInt(req.query.lines, 10) || 200, 5000);
    if (!name) return res.status(400).json({ success: false, error: 'name required' });
    try {
        const out = execSync(`pm2 logs ${name} --lines ${lines} --nostream 2>&1`,
            { encoding: 'utf8', timeout: 10000, maxBuffer: 10 * 1024 * 1024 });
        res.type('text/plain').send(out);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/ops/restart  { name: "reparations-server" }
router.post('/restart', authed, express.json(), async (req, res) => {
    const name = String(req.body?.name || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!name) return res.status(400).json({ success: false, error: 'name required' });
    try {
        const out = execSync(`pm2 restart ${name} 2>&1`, { encoding: 'utf8', timeout: 15000 });
        logger.info('ops/restart', { name });
        res.json({ success: true, output: out });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// GET /api/ops/run/:id — detail on one scrape run
router.get('/run/:id', authed, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'bad id' });
    const r = await db.query('SELECT * FROM scrape_runs WHERE id=$1', [id]);
    if (!r.rowCount) return res.status(404).json({ success: false, error: 'not found' });
    res.json({ success: true, run: r.rows[0] });
});

// POST /api/ops/heartbeat — called by running scrapers to update progress
router.post('/heartbeat', authed, express.json(), async (req, res) => {
    const { run_id, pages_ocrd, records_parsed, matches, db_updates, errors, log_tail } = req.body || {};
    if (!run_id) return res.status(400).json({ success: false, error: 'run_id required' });
    await db.query(`
        UPDATE scrape_runs
        SET last_heartbeat = NOW(),
            pages_ocrd     = COALESCE($2, pages_ocrd),
            records_parsed = COALESCE($3, records_parsed),
            matches        = COALESCE($4, matches),
            db_updates     = COALESCE($5, db_updates),
            errors         = COALESCE($6, errors),
            last_log_tail  = COALESCE($7, last_log_tail)
        WHERE id = $1
    `, [run_id, pages_ocrd, records_parsed, matches, db_updates, errors, log_tail?.slice(-2048) || null]);
    res.json({ success: true });
});

module.exports = router;
