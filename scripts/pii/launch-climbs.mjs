#!/usr/bin/env node
/**
 * launch-climbs.mjs — queue ancestor climbs for a participant's DECEASED anchors.
 *
 * Sits in scripts/pii/ because it reads participant_family (names, FS IDs) and
 * must therefore keep those out of model context: it prints participant UUIDs,
 * seed counts and session IDs, never a name. See .claude/hooks/block-pii-access.mjs.
 *
 * WHY DECEASED-ONLY.
 * FamilySearch hides the tree profile of a living person, so a climb seeded on
 * one dead-ends immediately. Measured on this database:
 *     LTVZ-D9S (living participant)          →     1 ancestor,   0 matches
 *     LTVZ-D8M (deceased great-grandparent)  →   906 ancestors, 138 matches
 *     LX39-1MY (deceased grandparent)        → 5,260 ancestors, 548 matches
 * So the seed set is `participant_family WHERE is_living IS FALSE AND fs_id IS NOT NULL`.
 * A participant's own FS ID is never used.
 *
 * WHY A SEQUENTIAL QUEUE ON THE MINI.
 * Only one FamilySearch scraper may run at a time against the shared logged-in
 * Chrome (:9222) — concurrent scrapers trip FS's bot detection and can wipe an
 * operator's in-progress login. This writes one shell script containing the whole
 * queue, launches it detached, and lets it run climbs strictly one after another.
 *
 * Usage:
 *   node scripts/pii/launch-climbs.mjs --participant <uuid> [--participant <uuid>...] [--dry-run]
 */

import { execFileSync } from 'node:child_process';
import pg from 'pg';
import 'dotenv/config';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const participants = argv.reduce((acc, a, i) => (a === '--participant' ? [...acc, argv[i + 1]] : acc), []);
if (!participants.length) { console.error('usage: --participant <uuid> [--participant <uuid>...] [--dry-run]'); process.exit(1); }

const HOST = process.env.MINI_SSH_HOST || 'mac-mini-ts';
const REPO = process.env.MINI_REPO || '/Users/danyelica/Desktop/Reparations-is-a-real-number';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const shq = s => `'${String(s).replace(/'/g, `'\\''`)}'`;   // single-quote for sh

const queue = [];
const report = [];

for (const pid of participants) {
  const { rows } = await pool.query(`
    SELECT relationship, full_name, fs_id, birth_year, source_block_index
      FROM participant_family
     WHERE participant_id = $1
       AND is_living IS FALSE
       AND fs_id IS NOT NULL
     ORDER BY birth_year NULLS LAST, source_block_index`, [pid]);

  // Skip seeds already climbed to completion — reruns are wasted FS traffic
  // and extra bot-detection exposure.
  const fresh = [];
  for (const s of rows) {
    const done = await pool.query(
      `SELECT id, status, ancestors_visited FROM ancestor_climb_sessions
        WHERE modern_person_fs_id = $1 AND status = 'completed'
        ORDER BY started_at DESC LIMIT 1`, [s.fs_id]);
    if (done.rowCount) {
      report.push({ participant: pid, seed_block: s.source_block_index, status: 'ALREADY_CLIMBED',
                    session_id: done.rows[0].id, ancestors: done.rows[0].ancestors_visited });
      continue;
    }
    fresh.push(s);
  }

  for (const s of fresh) queue.push({ pid, ...s });
  report.push({ participant: pid, deceased_seeds: rows.length, queued: fresh.length });
}

if (!queue.length) {
  console.log(JSON.stringify({ queued: 0, note: 'nothing to launch' }));
  for (const x of report) console.log(JSON.stringify(x));
  await pool.end();
  process.exit(0);
}

// Build the sequential runner. Each climb logs to its own file on the Mini.
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const lines = [
  '#!/bin/bash',
  // A non-interactive `ssh host cmd` does NOT source the login profile, so PATH
  // lacks the Homebrew/usr-local bins and every `node` call exits 127. Set it
  // explicitly rather than relying on the remote shell's environment.
  'export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',
  `cd ${REPO} || exit 1`,
  'mkdir -p logs',
  `command -v node >/dev/null || { echo "FATAL: node not on PATH" >> logs/climb-queue-${stamp}.log; exit 127; }`,
  `echo "queue start $(date) node=$(node --version)" >> logs/climb-queue-${stamp}.log`,
];
for (const q of queue) {
  lines.push(
    `echo "=== ${q.fs_id} (participant ${q.pid}) $(date) ===" >> logs/climb-queue-${stamp}.log`,
    `node scripts/scrapers/familysearch-ancestor-climber.js ${shq(q.fs_id)} --name ${shq(q.full_name || q.fs_id)} ` +
      `>> logs/ancestor-climb-${q.fs_id}-${stamp}.log 2>&1`,
    `echo "exit=$? ${q.fs_id}" >> logs/climb-queue-${stamp}.log`,
    'sleep 45',   // politeness gap between climbs
  );
}
lines.push(`echo "queue done $(date)" >> logs/climb-queue-${stamp}.log`);

const script = lines.join('\n') + '\n';
const remotePath = `${REPO}/logs/climb-queue-${stamp}.sh`;

if (DRY) {
  console.log(JSON.stringify({ dry_run: true, queued: queue.length, remote_script: remotePath }));
  for (const x of report) console.log(JSON.stringify(x));
  await pool.end();
  process.exit(0);
}

// Write + launch detached on the Mini.
execFileSync('ssh', [HOST, `mkdir -p ${REPO}/logs && cat > ${remotePath} && chmod +x ${remotePath}`],
  { input: script });
const out = execFileSync('ssh', [HOST,
  `cd ${REPO} && nohup ${remotePath} > /dev/null 2>&1 & echo "pid=$!"`], { encoding: 'utf8' });

// Link each participant to the sessions the climber will create (by FS ID) —
// done after the fact by reconcile, but record intent now.
console.log(JSON.stringify({ launched: true, queued: queue.length, runner: out.trim(), log_prefix: `logs/climb-queue-${stamp}` }));
for (const x of report) console.log(JSON.stringify(x));
await pool.end();
