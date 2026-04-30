#!/usr/bin/env node
/**
 * Freedmen's Bank systematic 27-branch field-extraction runner.
 *
 * Replaces the ad-hoc "resume the failures" pattern with a queue-driven
 * runner that:
 *   - Iterates the canonical 27-branch list (per run-all-freedmens.sh)
 *   - Tracks each branch in scrape_runs (M045) — start, finish, exit code,
 *     pages OCR'd, records parsed, matches, DB updates, errors
 *   - Skips branches that already completed successfully (status='ok')
 *     unless --force-rerun
 *   - Retries failed branches up to MAX_RETRIES per run
 *   - Spawns extract-freedmens-fields.js as a child per branch with
 *     USE_DOCUMENT_AI=true (Doc AI is now wired and verified)
 *   - Sends ntfy notifications: per-branch failure + final completion
 *   - Survives PM2 restart by re-reading scrape_runs state
 *
 * Per memory-bank/plan-apr29 §7 + 2026-04-30 freedmens-coverage audit.
 *
 * Usage (typical):
 *   node scripts/run-freedmens-systematic.js
 *
 * Usage (filtered):
 *   node scripts/run-freedmens-systematic.js --branch "Memphis, Tennessee"
 *   node scripts/run-freedmens-systematic.js --only-pending
 *   node scripts/run-freedmens-systematic.js --force-rerun
 *
 * Env:
 *   USE_DOCUMENT_AI=true            (default in ecosystem.config.js)
 *   MAX_RETRIES=2                   (per branch)
 *   CHROME_DEBUG_PORT=9222          (passed through)
 *   FREEDMENS_NODE_HEAP_MB=2048     (--max-old-space-size for child)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { neon } = require('@neondatabase/serverless');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const sql = neon(process.env.DATABASE_URL);

const args = process.argv.slice(2);
const SINGLE_BRANCH = args.includes('--branch') ? args[args.indexOf('--branch') + 1] : null;
const ONLY_PENDING = args.includes('--only-pending');
const FORCE_RERUN = args.includes('--force-rerun');
const DRY_RUN = args.includes('--dry-run');

const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '2', 10);
const NODE_HEAP_MB = parseInt(process.env.FREEDMENS_NODE_HEAP_MB || '2048', 10);

// Canonical 27-branch list (extracted from scripts/run-all-freedmens.sh).
// Order matters for resumption: branches at top processed first.
const BRANCHES = [
    'Atlanta, Georgia',
    'Augusta, Georgia',
    'Baltimore, Maryland',
    'Charleston, South Carolina',
    'Columbus, Mississippi',
    'Huntsville, Alabama',
    'Lexington, Kentucky',
    'Little Rock, Arkansas',
    'Louisville, Kentucky',
    'Lynchburg, Virginia',
    'Memphis, Tennessee',
    'Mobile, Alabama',
    'Nashville, Tennessee',
    'Natchez, Mississippi',
    'New Bern, North Carolina',
    'New Orleans, Louisiana',
    'New York, New York',
    'Norfolk, Virginia',
    'Philadelphia, Pennsylvania',
    'Raleigh, North Carolina',
    'Richmond, Virginia',
    'Savannah, Georgia',
    'Shreveport, Louisiana',
    'St. Louis, Missouri',
    'Tallahassee, Florida',
    'Vicksburg, Mississippi',
    'Washington, D. C.',
    'Wilmington, North Carolina',
];

// notify() helper — reuse the project's webhook
async function notify(message, severity = 'info') {
    const url = process.env.OPS_NOTIFY_WEBHOOK || '';
    if (!url) return;
    try {
        await fetch(url, {
            method: 'POST',
            headers: {
                'Title': `[freedmens-runner] ${severity.toUpperCase()}`,
                'Priority': severity === 'error' ? '5' : '3',
                'Tags': 'freedmens-runner',
            },
            body: message,
        });
    } catch (e) { /* fail silent — notifications are observability */ }
}

async function getBranchStatus(branch) {
    const rows = await sql`
        SELECT status, exit_code, pages_ocrd, records_parsed, matches,
               db_updates, errors, started_at, finished_at, id
        FROM scrape_runs
        WHERE runner = 'freedmens-systematic' AND branch = ${branch}
        ORDER BY started_at DESC NULLS LAST LIMIT 1
    `;
    return rows[0] || null;
}

async function recordRunStart(branch, attempt) {
    const rows = await sql`
        INSERT INTO scrape_runs (
            runner, branch, host, pid, status, started_at, last_heartbeat, metadata
        ) VALUES (
            'freedmens-systematic', ${branch}, ${os.hostname()}, ${process.pid},
            'running', NOW(), NOW(),
            ${JSON.stringify({ attempt, use_document_ai: process.env.USE_DOCUMENT_AI === 'true' })}::jsonb
        )
        RETURNING id
    `;
    return rows[0].id;
}

async function recordRunFinish(runId, status, stats) {
    await sql`
        UPDATE scrape_runs
        SET status = ${status},
            exit_code = ${stats.exitCode ?? null},
            finished_at = NOW(),
            last_heartbeat = NOW(),
            pages_ocrd = ${stats.pagesOcrd ?? null},
            records_parsed = ${stats.recordsParsed ?? null},
            matches = ${stats.matches ?? null},
            db_updates = ${stats.dbUpdates ?? null},
            errors = ${stats.errors ?? null},
            last_log_tail = ${(stats.logTail || '').slice(-2000)}
        WHERE id = ${runId}
    `;
}

function parseStatsFromLog(logText) {
    const stats = {};
    const pat = (re, key, parser = parseInt) => {
        const m = logText.match(re);
        if (m) stats[key] = parser(m[1]);
    };
    pat(/Pages OCRd:\s+(\d+)/, 'pagesOcrd');
    pat(/Records parsed:\s+(\d+)/, 'recordsParsed');
    pat(/Depositors matched:\s+(\d+)/, 'matches');
    pat(/DB updates:\s+(\d+)/, 'dbUpdates');
    pat(/person_documents:\s+(\d+)/, 'documentsCreated');
    pat(/Errors:\s+(\d+)/, 'errors');
    return stats;
}

async function runBranchOnce(branch, attempt) {
    if (DRY_RUN) {
        console.log(`  [DRY] would run extractor for "${branch}" (attempt ${attempt})`);
        return { exitCode: 0, stats: {}, logTail: '(dry run)' };
    }

    const runId = await recordRunStart(branch, attempt);
    const startTime = Date.now();
    const logChunks = [];

    return new Promise(resolve => {
        const child = spawn('/usr/local/bin/node', [
            `--max-old-space-size=${NODE_HEAP_MB}`,
            'scripts/extract-freedmens-fields.js',
            '--branch', branch,
        ], {
            cwd: path.resolve(__dirname, '..'),
            // Inherit the runner's env (USE_DOCUMENT_AI propagates via PM2
            // ecosystem.config.js). NEVER hardcode 'true' here — that
            // overrides operator intent. The Custom Extractor is currently
            // broken (2026-04-30); operators set USE_DOCUMENT_AI=false to
            // skip the per-call failure + retry overhead until it's fixed.
            env: { ...process.env },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        const collect = stream => {
            stream.on('data', chunk => {
                const text = chunk.toString();
                logChunks.push(text);
                process.stdout.write(`    [${branch.split(',')[0]}] ${text}`);
                // Heartbeat every minute via timer
            });
        };
        collect(child.stdout);
        collect(child.stderr);

        // Heartbeat updater
        const heartbeat = setInterval(async () => {
            try {
                await sql`UPDATE scrape_runs SET last_heartbeat = NOW() WHERE id = ${runId}`;
            } catch { /* ignore */ }
        }, 60_000);

        child.on('exit', async (code, signal) => {
            clearInterval(heartbeat);
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            const fullLog = logChunks.join('');
            const stats = parseStatsFromLog(fullLog);
            stats.exitCode = code;
            stats.logTail = fullLog.slice(-2000);

            const status = code === 0 ? 'ok' : 'failed';
            await recordRunFinish(runId, status, stats);

            console.log(`    [${branch}] exit=${code}${signal ? ` signal=${signal}` : ''} elapsed=${elapsed}s`);
            console.log(`    pages=${stats.pagesOcrd || 0} records=${stats.recordsParsed || 0} matches=${stats.matches || 0} db=${stats.dbUpdates || 0} pdocs=${stats.documentsCreated || 0} errors=${stats.errors || 0}`);

            resolve({ exitCode: code, stats, logTail: fullLog.slice(-500) });
        });
    });
}

// Hard-stop exit codes from extract-freedmens-fields.js — these indicate
// system-level problems (auth, rate limit, markup change) where retrying
// would only burn credits. Surface immediately and halt the whole run.
const HARD_STOP_EXIT_CODES = {
    2: { kind: 'SESSION_EXPIRED', message: 'FS Chrome session is logged out. VNC into Mac Mini and re-login, then restart the runner.' },
    3: { kind: 'RATE_LIMITED', message: 'FamilySearch rate-limited us. Wait at least 30 minutes before any restart.' },
    4: { kind: 'SYSTEMIC_LINK_MISSING', message: '25 consecutive depositors had no original-document link. Likely FS HTML change or silent session issue — investigate before re-running.' },
    5: { kind: 'DOCAI_BROKEN', message: 'Doc AI Custom Extractor failed 5 consecutive times. Investigate via GCP Doc AI Workbench → freedmens-bank-ledger-v1 → Evaluate & test before re-running. Vision fallback contaminates enslaver attribution and is not acceptable.' },
};

async function runBranchWithRetry(branch) {
    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
        const r = await runBranchOnce(branch, attempt);
        if (r.exitCode === 0) return r;

        // Hard stops — don't retry, propagate up to halt the run.
        if (HARD_STOP_EXIT_CODES[r.exitCode]) {
            const info = HARD_STOP_EXIT_CODES[r.exitCode];
            r.hardStop = info;
            r.hardStopBranch = branch;
            await notify(`HARD STOP on branch "${branch}": ${info.kind}\n${info.message}`, 'error');
            return r;
        }

        if (attempt > MAX_RETRIES) {
            await notify(`Branch "${branch}" failed after ${MAX_RETRIES + 1} attempts. Last log tail:\n${r.logTail}`, 'error');
            return r;
        }
        const backoffSec = 30 * attempt;
        console.log(`    retry in ${backoffSec}s...`);
        await new Promise(res => setTimeout(res, backoffSec * 1000));
    }
}

(async () => {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  Freedmens Systematic 27-Branch Runner');
    console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : 'APPLY'}`);
    console.log(`  Doc AI: ${process.env.USE_DOCUMENT_AI === 'true' ? 'ON' : 'OFF'}`);
    console.log(`  Max retries per branch: ${MAX_RETRIES}`);
    if (SINGLE_BRANCH) console.log(`  Single branch: ${SINGLE_BRANCH}`);
    if (FORCE_RERUN) console.log(`  Force rerun: ON (will re-process completed branches)`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    const targets = SINGLE_BRANCH ? [SINGLE_BRANCH] : BRANCHES;
    const summary = { ok: [], failed: [], skipped: [] };
    const startTime = Date.now();

    await notify(`Freedmens systematic runner starting on ${targets.length} branch(es). Doc AI=${process.env.USE_DOCUMENT_AI === 'true' ? 'ON' : 'OFF'}.`);

    for (let i = 0; i < targets.length; i++) {
        const branch = targets[i];
        console.log(`\n  [${i + 1}/${targets.length}] ${branch}`);

        const prior = await getBranchStatus(branch);
        if (prior?.status === 'ok' && !FORCE_RERUN) {
            console.log(`    ✓ already completed (run id ${prior.id}), skipping. Use --force-rerun to override.`);
            summary.skipped.push(branch);
            continue;
        }

        if (ONLY_PENDING && prior && prior.status === 'failed') {
            // ONLY_PENDING means: skip even failed ones. Use this when you only
            // want to attempt branches that have never been tried.
            console.log(`    ⏭ prior status=failed, skipping per --only-pending`);
            summary.skipped.push(branch);
            continue;
        }

        const r = await runBranchWithRetry(branch);
        if (r.exitCode === 0) summary.ok.push(branch);
        else summary.failed.push(branch);

        // Hard stop — halt the whole run, don't iterate to next branch.
        if (r.hardStop) {
            console.log(`\n  ⛔ HARD STOP at branch "${r.hardStopBranch}": ${r.hardStop.kind}`);
            console.log(`  ${r.hardStop.message}`);
            summary.hardStopped = { branch: r.hardStopBranch, ...r.hardStop };
            break;
        }
    }

    const elapsed = Math.round((Date.now() - startTime) / 60_000);
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(`  Complete. Elapsed: ${elapsed}m`);
    console.log(`  ok:      ${summary.ok.length}`);
    console.log(`  failed:  ${summary.failed.length}`);
    console.log(`  skipped: ${summary.skipped.length}`);
    if (summary.failed.length > 0) console.log(`  failed branches: ${summary.failed.join(', ')}`);
    if (summary.hardStopped) {
        console.log(`  HARD STOP: ${summary.hardStopped.kind} on branch "${summary.hardStopped.branch}"`);
        console.log(`             ${summary.hardStopped.message}`);
    }
    console.log('═══════════════════════════════════════════════════════════════');

    await notify(
        `Freedmens systematic runner done. ok=${summary.ok.length} failed=${summary.failed.length} skipped=${summary.skipped.length} elapsed=${elapsed}m`
            + (summary.failed.length > 0 ? `\nFailed: ${summary.failed.join(', ')}` : '')
            + (summary.hardStopped ? `\nHARD STOP: ${summary.hardStopped.kind} on "${summary.hardStopped.branch}"` : ''),
        (summary.hardStopped || summary.failed.length > 0) ? 'warn' : 'info'
    );
})().catch(async e => {
    console.error('FATAL:', e.message);
    console.error(e.stack);
    await notify(`Freedmens runner crashed: ${e.message}`, 'error');
    process.exit(1);
});
