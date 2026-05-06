#!/usr/bin/env node
/**
 * PipelineWatchdogAgent.js
 *
 * Autonomous watchdog that manages, monitors, quality-checks, and chains the
 * full Mac Mini scraping pipeline:
 *
 *   PHASE 1: Freedmens Bank Layer 1 (run-all-freedmens.sh)
 *            → polls unconfirmed_persons for new indexed records every 90s
 *            → detects stalls (no growth for STALL_THRESHOLD minutes)
 *            → on stall: kills + restarts the current branch
 *
 *   PHASE 2: Freedmens Bank Layer 2 (enrich-freedmens-docai.js)
 *            → polls for docai_enrichment progress every 90s
 *            → quality-checks avg confidence per branch
 *            → flags branches below MIN_CONF_WARN to log
 *            → queues low-conf branches for reprocess after full pass
 *
 *   PHASE 3: S3 backfill (backfill-freedmens-to-s3.js)
 *
 *   PHASE 4: 1860 Slave Schedule (pm2 start slave-schedule-1860)
 *            → monitors PM2 status every 2 min
 *            → detects crashes → pm2 restart
 *            → reports location progress from DB
 *
 * Usage (run in background on Mac Mini):
 *   node scripts/agents/PipelineWatchdogAgent.js
 *   node scripts/agents/PipelineWatchdogAgent.js --start-phase 2   # resume at Layer 2
 *   node scripts/agents/PipelineWatchdogAgent.js --start-phase 4   # only watch 1860
 *   node scripts/agents/PipelineWatchdogAgent.js --dry-run         # log only, no spawns
 *
 * Log: debug/logs/watchdog-YYYYMMDD.log  (tail -f to watch remotely)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { neon }        = require('@neondatabase/serverless');
const { spawn, execSync } = require('child_process');
const fs              = require('fs');
const path            = require('path');

// ── Config ────────────────────────────────────────────────────────────────────
const REPO_ROOT       = path.resolve(__dirname, '../..');
const LOG_DIR         = path.join(REPO_ROOT, 'debug', 'logs');
const TODAY           = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const LOG_FILE        = path.join(LOG_DIR, `watchdog-${TODAY}.log`);

const POLL_INTERVAL_MS     = 90_000;    // check DB every 90s
const STALL_THRESHOLD_MS   = 10 * 60 * 1000;  // 10 min with no new records = stall
const MIN_CONF_WARN        = 0.45;      // avg docai confidence below this → flag branch
const MIN_CONF_REPROCESS   = 0.35;     // avg docai confidence below this → queue for reprocess
const PM2_POLL_MS          = 2 * 60 * 1000;   // poll PM2 every 2 min during phase 4
const MAX_RESTARTS_PER_PHASE = 3;

// ── CLI ───────────────────────────────────────────────────────────────────────
const argv       = process.argv.slice(2);
const flag       = (n) => argv.includes(n);
const opt        = (n, d = null) => { const i = argv.indexOf(n); return (i !== -1 && argv[i+1]) ? argv[i+1] : d; };
const START_PHASE = parseInt(opt('--start-phase', '1'));
const DRY_RUN     = flag('--dry-run');

// ── DB ────────────────────────────────────────────────────────────────────────
if (!process.env.DATABASE_URL) { console.error('FATAL: DATABASE_URL not set'); process.exit(1); }
const sql = neon(process.env.DATABASE_URL);

// ── Logging ───────────────────────────────────────────────────────────────────
fs.mkdirSync(LOG_DIR, { recursive: true });
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

function log(level, msg, data = null) {
    const ts   = new Date().toISOString();
    const line = `[${ts}] [${level.padEnd(7)}] ${msg}${data ? ' ' + JSON.stringify(data) : ''}`;
    console.log(line);
    logStream.write(line + '\n');
}
const info  = (m, d) => log('INFO',  m, d);
const warn  = (m, d) => log('WARN',  m, d);
const err   = (m, d) => log('ERROR', m, d);
const ok    = (m, d) => log('OK',    m, d);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── State ─────────────────────────────────────────────────────────────────────
let activeProc      = null;   // current child_process
let phaseRestarts   = 0;
let lastCount       = 0;
let lastCountTime   = Date.now();
let lowConfBranches = [];     // branches flagged for reprocess after full pass

// ── DB helpers ────────────────────────────────────────────────────────────────
async function countLayer1() {
    const r = await sql`
        SELECT COUNT(*) AS n
        FROM unconfirmed_persons
        WHERE extraction_method = 'freedmens_bank_index'
    `;
    return parseInt(r[0].n);
}

async function countLayer2() {
    const r = await sql`
        SELECT COUNT(*) AS n
        FROM unconfirmed_persons
        WHERE extraction_method = 'freedmens_bank_index'
          AND review_notes LIKE '%docai_enrichment%'
    `;
    return parseInt(r[0].n);
}

async function countLayer2Pending() {
    const r = await sql`
        SELECT COUNT(*) AS n
        FROM unconfirmed_persons
        WHERE extraction_method = 'freedmens_bank_index'
          AND (review_notes IS NULL OR review_notes NOT LIKE '%docai_enrichment%')
          AND source_url IS NOT NULL
          AND source_url LIKE '%familysearch.org%'
    `;
    return parseInt(r[0].n);
}

async function qualityCheckByBranch() {
    // Average confidence of docai_fields per branch location
    const rows = await sql`
        SELECT
            locations[1] AS branch,
            COUNT(*) AS total,
            AVG((relationships->'docai_fields'->'last_master_confidence')::float)     AS avg_master_conf,
            AVG((relationships->'docai_fields'->'last_mistress_confidence')::float)   AS avg_mistress_conf,
            COUNT(*) FILTER (WHERE relationships->'docai_fields' IS NOT NULL)         AS enriched
        FROM unconfirmed_persons
        WHERE extraction_method = 'freedmens_bank_index'
          AND review_notes LIKE '%docai_enrichment%'
        GROUP BY locations[1]
        ORDER BY avg_master_conf ASC NULLS FIRST
    `;
    return rows;
}

async function countParseFailures() {
    const r = await sql`
        SELECT COUNT(*) AS n
        FROM parse_failure_queue
        WHERE document_type = 'freedmens_bank_ledger_page'
    `;
    return parseInt(r[0].n);
}

async function count1860Pending() {
    // 1860 slave schedule queue status
    try {
        const r = await sql`
            SELECT status, COUNT(*) AS n
            FROM scraping_queue
            WHERE source_type = 'slave_schedule_1860'
            GROUP BY status
        `;
        const map = {};
        for (const row of r) map[row.status] = parseInt(row.n);
        return map;
    } catch {
        return {};
    }
}

// ── Process spawner ───────────────────────────────────────────────────────────
function spawnProc(cmd, args, label) {
    if (DRY_RUN) {
        info(`[DRY-RUN] Would spawn: ${cmd} ${args.join(' ')}`);
        // Return a fake proc that emits close immediately
        const fake = { pid: -1 };
        setTimeout(() => {}, 100);
        return null;
    }

    info(`[SPAWN] ${label}: ${cmd} ${args.join(' ')}`);

    const proc = spawn(cmd, args, {
        cwd: REPO_ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
    });

    // Forward stdout/stderr to our log
    proc.stdout.on('data', d => {
        const lines = d.toString().split('\n').filter(Boolean);
        lines.forEach(l => log('CHILD', `[${label}] ${l}`));
    });
    proc.stderr.on('data', d => {
        const lines = d.toString().split('\n').filter(Boolean);
        lines.forEach(l => log('CHILD', `[${label}] ⚠ ${l}`));
    });

    return proc;
}

function pm2Command(args) {
    try {
        const out = execSync(`pm2 ${args.join(' ')} --no-color`, { cwd: REPO_ROOT, encoding: 'utf8' });
        return out.trim();
    } catch (e) {
        return e.message;
    }
}

// ── Phase 1: Layer 1 indexed scrape ──────────────────────────────────────────
async function runPhase1() {
    info('═══ PHASE 1: Freedmens Bank Layer 1 (indexed scrape) ═══');

    const proc = spawnProc('bash', ['scripts/run-all-freedmens.sh'], 'layer1');
    if (!proc && !DRY_RUN) { err('Failed to spawn Layer 1 process'); return false; }

    phaseRestarts = 0;
    lastCount     = await countLayer1();
    lastCountTime = Date.now();

    return new Promise((resolve) => {
        if (DRY_RUN) { setTimeout(() => resolve(true), 2000); return; }

        activeProc = proc;
        let done = false;

        const pollTimer = setInterval(async () => {
            if (done) return;
            try {
                const n = await countLayer1();
                const staleMs = Date.now() - lastCountTime;

                if (n > lastCount) {
                    const delta = n - lastCount;
                    info(`[Phase1] Layer1 progress: +${delta} records (total ${n})`);
                    lastCount     = n;
                    lastCountTime = Date.now();
                } else if (staleMs > STALL_THRESHOLD_MS) {
                    warn(`[Phase1] STALL detected — no new records for ${Math.round(staleMs/60000)} min (total ${n})`);
                    if (phaseRestarts < MAX_RESTARTS_PER_PHASE) {
                        warn('[Phase1] Killing stalled process — run-all-freedmens.sh will auto-resume from last branch');
                        try { proc.kill('SIGTERM'); } catch {}
                        phaseRestarts++;
                        lastCountTime = Date.now();
                    } else {
                        warn('[Phase1] Max restarts reached — moving on to Phase 2 with data so far');
                        try { proc.kill('SIGTERM'); } catch {}
                        clearInterval(pollTimer);
                        done = true;
                        resolve(true);
                    }
                } else {
                    info(`[Phase1] Layer1 stable: ${n} records (stale ${Math.round(staleMs/1000)}s)`);
                }
            } catch (e) {
                err('[Phase1] DB poll error', { msg: e.message });
            }
        }, POLL_INTERVAL_MS);

        proc.on('close', (code) => {
            if (done) return;
            clearInterval(pollTimer);
            done = true;
            activeProc = null;
            if (code === 0 || code === null) {
                ok(`[Phase1] run-all-freedmens.sh finished cleanly`);
            } else {
                warn(`[Phase1] run-all-freedmens.sh exited code ${code} — continuing anyway`);
            }
            resolve(true);
        });
    });
}

// ── Phase 2: Layer 2 Document AI enrichment ───────────────────────────────────
async function runPhase2() {
    info('═══ PHASE 2: Freedmens Bank Layer 2 (Document AI enrichment) ═══');

    const pending = await countLayer2Pending();
    info(`[Phase2] ${pending} records pending DocAI enrichment`);

    if (pending === 0) {
        ok('[Phase2] All records already enriched — skipping');
        return true;
    }

    const proc = spawnProc('node', ['scripts/enrich-freedmens-docai.js'], 'docai');
    if (!proc && !DRY_RUN) { err('Failed to spawn Layer 2 process'); return false; }

    phaseRestarts = 0;
    lastCount     = await countLayer2();
    lastCountTime = Date.now();

    return new Promise((resolve) => {
        if (DRY_RUN) { setTimeout(() => resolve(true), 2000); return; }

        activeProc = proc;
        let done = false;

        const pollTimer = setInterval(async () => {
            if (done) return;
            try {
                const enriched = await countLayer2();
                const remaining = await countLayer2Pending();
                const failures  = await countParseFailures();
                const staleMs   = Date.now() - lastCountTime;

                if (enriched > lastCount) {
                    info(`[Phase2] DocAI progress: ${enriched} enriched, ${remaining} remaining, ${failures} queued`);
                    lastCount     = enriched;
                    lastCountTime = Date.now();
                } else if (staleMs > STALL_THRESHOLD_MS && remaining > 0) {
                    warn(`[Phase2] STALL — no enrichment growth for ${Math.round(staleMs/60000)} min`);
                    if (phaseRestarts < MAX_RESTARTS_PER_PHASE) {
                        warn('[Phase2] Restarting DocAI process (will resume from where it left off)');
                        try { proc.kill('SIGTERM'); } catch {}
                        phaseRestarts++;
                        lastCountTime = Date.now();

                        // Spawn a fresh process — enrich-freedmens-docai.js is resumable
                        const newProc = spawnProc('node', ['scripts/enrich-freedmens-docai.js'], 'docai-restart');
                        if (newProc) {
                            activeProc = newProc;
                            newProc.on('close', () => { activeProc = null; });
                        }
                    } else {
                        warn('[Phase2] Max restarts — moving to Phase 3 with data so far');
                        try { proc.kill('SIGTERM'); } catch {}
                        clearInterval(pollTimer);
                        done = true;
                        await qualityReport();
                        resolve(true);
                    }
                } else {
                    info(`[Phase2] DocAI: ${enriched} enriched, ${remaining} pending, ${failures} failures, stale ${Math.round(staleMs/1000)}s`);
                }

                // Quality check every 5th poll
                if (enriched > 0 && enriched % 500 < parseInt(POLL_INTERVAL_MS / 1000)) {
                    await qualityReport();
                }
            } catch (e) {
                err('[Phase2] DB poll error', { msg: e.message });
            }
        }, POLL_INTERVAL_MS);

        proc.on('close', async (code) => {
            if (done) return;
            clearInterval(pollTimer);
            done = true;
            activeProc = null;
            if (code === 0 || code === null) {
                ok('[Phase2] enrich-freedmens-docai.js finished cleanly');
            } else {
                warn(`[Phase2] enrich-freedmens-docai.js exited code ${code}`);
            }
            await qualityReport();
            resolve(true);
        });
    });
}

// ── Quality report ────────────────────────────────────────────────────────────
async function qualityReport() {
    try {
        info('── Quality check ──────────────────────────────────────');
        const branches = await qualityCheckByBranch();
        lowConfBranches = [];

        for (const b of branches) {
            const masterConf = parseFloat(b.avg_master_conf) || 0;
            if (!b.branch) continue;
            if (masterConf < MIN_CONF_REPROCESS) {
                warn(`[QA] LOW-CONF branch "${b.branch}" — avg master_conf=${masterConf.toFixed(2)} (${b.enriched}/${b.total} enriched) → queued for reprocess`);
                lowConfBranches.push(b.branch);
            } else if (masterConf < MIN_CONF_WARN) {
                warn(`[QA] WARN branch "${b.branch}" — avg master_conf=${masterConf.toFixed(2)} (${b.enriched}/${b.total} enriched)`);
            } else {
                info(`[QA] OK  branch "${b.branch}" — avg master_conf=${masterConf.toFixed(2)} (${b.enriched}/${b.total} enriched)`);
            }
        }

        if (lowConfBranches.length > 0) {
            warn(`[QA] ${lowConfBranches.length} branches below reprocess threshold: ${lowConfBranches.join(', ')}`);
        }
        info('── End quality check ──────────────────────────────────');
    } catch (e) {
        err('[QA] Quality check failed', { msg: e.message });
    }
}

// ── Phase 2b: Reprocess low-confidence branches ───────────────────────────────
async function runPhase2b() {
    if (lowConfBranches.length === 0) {
        info('[Phase2b] No branches need reprocessing — skipping');
        return true;
    }

    info(`[Phase2b] Reprocessing ${lowConfBranches.length} low-confidence branches`);

    for (const branch of lowConfBranches) {
        info(`[Phase2b] Reprocessing branch: ${branch}`);
        await new Promise((resolve) => {
            const proc = spawnProc(
                'node',
                ['scripts/enrich-freedmens-docai.js', '--branch', branch, '--reprocess'],
                `docai-reprocess-${branch.replace(/[^a-z0-9]/gi, '_')}`
            );
            if (!proc) { resolve(); return; }
            proc.on('close', (code) => {
                if (code === 0) {
                    ok(`[Phase2b] Reprocess complete for "${branch}"`);
                } else {
                    warn(`[Phase2b] Reprocess exit ${code} for "${branch}" — continuing`);
                }
                resolve();
            });
        });
        await sleep(3000); // brief gap between branches
    }

    info('[Phase2b] All reprocessing done — running final quality check');
    await qualityReport();
    return true;
}

// ── Phase 3: S3 backfill ──────────────────────────────────────────────────────
async function runPhase3() {
    info('═══ PHASE 3: S3 backfill ═══');

    return new Promise((resolve) => {
        const proc = spawnProc('node', ['scripts/backfill-freedmens-to-s3.js'], 's3-backfill');
        if (!proc) { resolve(true); return; }

        activeProc = proc;
        proc.on('close', (code) => {
            activeProc = null;
            if (code === 0 || code === null) {
                ok('[Phase3] S3 backfill complete');
            } else {
                warn(`[Phase3] backfill-freedmens-to-s3.js exited code ${code}`);
            }
            resolve(true);
        });
    });
}

// ── Phase 4: 1860 slave schedule watchdog ─────────────────────────────────────
async function runPhase4() {
    info('═══ PHASE 4: 1860 Slave Schedule ═══');
    let crashRestarts = 0;

    if (!DRY_RUN) {
        info('[Phase4] Starting slave-schedule-1860 via PM2');
        const out = pm2Command(['start', 'slave-schedule-1860']);
        info('[Phase4] PM2 start:', { out });
    } else {
        info('[DRY-RUN] Would: pm2 start slave-schedule-1860');
    }

    // Poll PM2 + DB indefinitely until queue is exhausted
    while (true) {
        await sleep(PM2_POLL_MS);

        // ── PM2 status check ──
        let pm2Status = 'unknown';
        if (!DRY_RUN) {
            try {
                const json = execSync('pm2 jlist --no-color', { encoding: 'utf8' });
                const list = JSON.parse(json);
                const app  = list.find(a => a.name === 'slave-schedule-1860');
                if (app) {
                    pm2Status = app.pm2_env?.status || 'unknown';
                }
            } catch {}
        }

        // ── DB queue status ──
        let queueStatus = {};
        try {
            queueStatus = await count1860Pending();
        } catch {}

        const pending   = queueStatus['pending']   || 0;
        const done1860  = queueStatus['completed'] || queueStatus['scraped'] || 0;
        const errCount  = queueStatus['error']     || 0;

        info(`[Phase4] PM2=${pm2Status}  pending=${pending}  done=${done1860}  errors=${errCount}`);

        // ── Done check ──
        if (pending === 0 && (done1860 > 0 || Object.keys(queueStatus).length > 0)) {
            ok('[Phase4] 1860 slave schedule queue exhausted — all locations scraped!');
            pm2Command(['stop', 'slave-schedule-1860']);
            break;
        }

        // ── Crash recovery ──
        if (!DRY_RUN && (pm2Status === 'stopped' || pm2Status === 'errored')) {
            crashRestarts++;
            warn(`[Phase4] slave-schedule-1860 is ${pm2Status} — restarting (attempt ${crashRestarts})`);
            pm2Command(['restart', 'slave-schedule-1860']);
            await sleep(10_000);
        }

        // ── Safety: stop if too many crashes ──
        if (crashRestarts > 10) {
            err('[Phase4] 10 consecutive crashes on slave-schedule-1860 — stopping watchdog for phase 4');
            err('[Phase4] Check PM2 logs: pm2 logs slave-schedule-1860 --lines 100');
            break;
        }
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    info('════════════════════════════════════════════════════');
    info('  Pipeline Watchdog Agent');
    info(`  Start phase: ${START_PHASE}`);
    info(`  Mode: ${DRY_RUN ? 'DRY-RUN' : 'LIVE'}`);
    info(`  Log: ${LOG_FILE}`);
    info(`  Stall threshold: ${STALL_THRESHOLD_MS / 60000} min`);
    info(`  Quality thresholds: warn=${MIN_CONF_WARN}  reprocess=${MIN_CONF_REPROCESS}`);
    info('════════════════════════════════════════════════════');

    // Graceful shutdown
    process.on('SIGINT',  () => { info('Watchdog: SIGINT received — shutting down'); if (activeProc) try { activeProc.kill('SIGTERM'); } catch {} process.exit(0); });
    process.on('SIGTERM', () => { info('Watchdog: SIGTERM received — shutting down'); if (activeProc) try { activeProc.kill('SIGTERM'); } catch {} process.exit(0); });

    if (START_PHASE <= 1) {
        info('[Watchdog] Starting Phase 1…');
        await runPhase1();
    }

    if (START_PHASE <= 2) {
        info('[Watchdog] Starting Phase 2…');
        await runPhase2();
        await runPhase2b();  // reprocess low-conf branches if any
    }

    if (START_PHASE <= 3) {
        info('[Watchdog] Starting Phase 3 (S3 backfill)…');
        await runPhase3();
    }

    if (START_PHASE <= 4) {
        info('[Watchdog] Starting Phase 4 (1860 slave schedule)…');
        await runPhase4();
    }

    ok('═══ All pipeline phases complete ═══');
    ok(`Full log: ${LOG_FILE}`);
    logStream.end();
    process.exit(0);
}

main().catch(e => {
    err('FATAL watchdog error', { msg: e.message, stack: e.stack });
    process.exit(1);
});
