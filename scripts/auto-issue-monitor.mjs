// auto-issue-monitor.mjs — FREE (no Claude API) detector for the three classes that keep breaking this
// project silently, that auto-FILES GitHub issues (deduped) so they stop being recovered by hand:
//   1. SILENT FAILURES  — a cron/drip logging FATAL/ERROR/"does not exist"/"no unique constraint"/
//                          ReferenceError/MODULE_NOT_FOUND but still "running" (nobody notices).
//   2. HAPHAZARD BREAKAGE — migration drift (applied-but-untracked, dup-number collisions) + the SQL/column
//                          breakage that surfaces as those log errors (e.g. a script hitting a dropped column).
//   3. SILOING           — records not wired to the spine: image-backed leads unpromoted, canonicals with
//                          zero edges — growing = a de-siloing regression.
//
// Filing is FREE: the GitHub REST API via fetch + a personal-access token (GITHUB_TOKEN/GH_TOKEN) — no `gh`
// install, no Claude. Deduped: it checks OPEN issues labeled `auto-monitor` and only files a NEW fingerprint.
// No token yet? It records to monitor_issues + ntfy (OPS_NOTIFY_WEBHOOK) so nothing is lost. Optional ollama
// (local, free) summarizes a log-error cluster into a readable body. Run on the Mini via cron.
//
// Usage: node scripts/auto-issue-monitor.mjs   (env: GITHUB_TOKEN, GITHUB_REPO=owner/repo, OLLAMA_URL)

import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import pg from 'pg';
const require = createRequire(import.meta.url);
const { notify } = require('../src/utils/notify');

const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
const REPO = process.env.GITHUB_REPO || 'danyelajunebrown/Reparations-is-a-real-number';
const LOG_DIR = os.homedir();
const ERR_RE = /(FATAL|ReferenceError|TypeError|ERR_MODULE_NOT_FOUND|does not exist|no unique or exclusion constraint|malformed array literal|column .* does not exist|relation .* does not exist|Connection terminated)/i;

// ── GitHub REST (free; no gh) ──
async function ghOpenIssues() {
  if (!TOKEN) return null;
  const r = await fetch(`https://api.github.com/repos/${REPO}/issues?state=open&labels=auto-monitor&per_page=100`,
    { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json' } });
  if (!r.ok) return null;
  return (await r.json()).map(i => i.title);
}
async function ghCreate(title, body) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/issues`,
    { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'content-type': 'application/json' },
      body: JSON.stringify({ title, body, labels: ['auto-monitor'] }) });
  return r.ok ? (await r.json()).html_url : null;
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 90000 });
  // pg-pool emits 'error' on IDLE clients when the server drops a socket; Node terminates the process
  // on an unhandled 'error' event. One Neon blip therefore kills a long run, and the log reads as
  // STALLED rather than crashed -- the misdiagnosis that hid a dead fleet for five weeks.
  pool.on('error', (e) => console.error(`[pool] idle client error (continuing): ${e.message}`));
  await pool.query(`CREATE TABLE IF NOT EXISTS monitor_issues (
    id BIGSERIAL PRIMARY KEY, fingerprint TEXT UNIQUE, category TEXT, title TEXT, body TEXT,
    filed_url TEXT, first_seen TIMESTAMPTZ DEFAULT now(), last_seen TIMESTAMPTZ DEFAULT now(), seen_count INT DEFAULT 1)`);
  const findings = [];  // {fingerprint, category, title, body}

  // 1. SILENT FAILURES — scan recent log tails for error signatures.
  for (const f of fs.readdirSync(LOG_DIR).filter(n => n.endsWith('.log'))) {
    let tail = '';
    try { const b = fs.readFileSync(path.join(LOG_DIR, f), 'utf8'); tail = b.slice(-20000); } catch { continue; }
    const lines = tail.split('\n').filter(l => ERR_RE.test(l));
    if (!lines.length) continue;
    const sample = [...new Set(lines.map(l => l.replace(/\d{4}-\d\d-\d\dT[\d:.Z-]+/g, 'TS').slice(0, 160)))].slice(0, 5);
    findings.push({ fingerprint: `silent-failure:${f}`, category: 'silent-failure',
      title: `[auto-monitor] Silent failure: ${f} is logging errors`,
      body: `The cron/drip log \`${f}\` on the Mini contains error signatures (a job may be failing while still "running"). Distinct recent lines:\n\n\`\`\`\n${sample.join('\n')}\n\`\`\`\nAuto-filed by scripts/auto-issue-monitor.mjs. Investigate whether the job is broken (dropped column, bad ON CONFLICT, missing module — the haphazard-construction class).` });
  }

  // 2. HAPHAZARD BREAKAGE — migration drift.
  try {
    const files = fs.readdirSync('migrations').filter(n => /^\d+.*\.sql$/.test(n));
    const tracked = new Set((await pool.query(`SELECT filename FROM schema_migrations`)).rows.map(r => r.filename));
    const untracked = files.filter(f => !tracked.has(f));
    const nums = files.map(f => f.match(/^(\d+)/)[1]);
    const collisions = [...new Set(nums.filter((n, i) => nums.indexOf(n) !== i))];
    if (untracked.length > 3 || collisions.length) {
      findings.push({ fingerprint: 'breakage:migration-drift', category: 'breakage',
        title: '[auto-monitor] Migration drift: untracked/collision in schema_migrations',
        body: `Applied-but-untracked (or never-applied) migrations: ${untracked.length} (${untracked.slice(0, 8).join(', ')}...).\nDuplicate migration numbers (collisions): ${collisions.join(', ') || 'none'}.\nThe migration runner keys on full filename, so collisions both apply but the numbering is misleading. Reconcile schema_migrations vs migrations/.` });
    }
  } catch { /* migrations dir not present in this cwd */ }

  // 3. SILOING — image-backed leads unpromoted + edge-less canonicals; file if it GROWS vs last record.
  const silo = Number((await pool.query(`SELECT count(DISTINCT unconfirmed_person_id)::int n FROM person_documents WHERE unconfirmed_person_id IS NOT NULL AND canonical_person_id IS NULL AND s3_key IS NOT NULL`)).rows[0].n);
  const prevSilo = (await pool.query(`SELECT body FROM monitor_issues WHERE fingerprint='silo:image-leads-unpromoted'`)).rows[0];
  const prevN = prevSilo ? Number((prevSilo.body.match(/COUNT=(\d+)/) || [])[1] || 0) : 0;
  if (silo > 25000 && silo > prevN * 1.1) {
    findings.push({ fingerprint: 'silo:image-leads-unpromoted', category: 'siloing',
      title: '[auto-monitor] Siloing: image-backed leads not promoted (growing)',
      body: `COUNT=${silo} image-backed leads serve an S3 image but were never promoted to canonical (RULE 0.6 says they should be) — and the count grew vs the last check (was ${prevN}). The promotion pipeline is falling behind ingestion (the de-siloing regression). See promote-image-backed-leads.mjs / promote-probate-extractions.mjs.` });
  }

  // 4. PIPELINE ADAPTER FAILURE — the autonomous canonical pipeline (the inception→canonical QC path) is
  //    logging repeated "no persons"/"inaccessible" outcomes: its source adapter is not producing extractable
  //    text (e.g. FS fullText is canvas-rendered, not in DOM/network). The platform flags its OWN broken scraper.
  try {
    const rf = (await pool.query(
      `SELECT result, count(*)::int n, max(searched_at) last FROM research_findings
       WHERE searched_by='autonomous-canonical-pipeline' AND result IN ('none','inaccessible')
         AND searched_at > now() - interval '7 days' GROUP BY result`)).rows;
    const noneN = Number(rf.find(r => r.result === 'none')?.n || 0);
    const inaccN = Number(rf.find(r => r.result === 'inaccessible')?.n || 0);
    const hits = Number((await pool.query(
      `SELECT count(*)::int n FROM research_findings WHERE searched_by='autonomous-canonical-pipeline'
         AND result='hit' AND searched_at > now() - interval '7 days'`)).rows[0].n);
    // Only a concern if failures dominate (adapter broken) — not if it's simply idle or mostly succeeding.
    if (noneN + inaccN >= 3 && (noneN + inaccN) > hits) {
      findings.push({ fingerprint: 'pipeline:adapter-no-persons', category: 'breakage',
        title: '[auto-monitor] Autonomous canonical pipeline: source adapter yielding no persons',
        body: `The autonomous-canonical-pipeline logged ${noneN} "no persons/text" + ${inaccN} "inaccessible" vs only ${hits} "hit" in the last 7d — the inception→canonical path is stalled for these sources.\n\nMost likely cause: the FS-fullText transcription is rendered client-side onto the image (canvas/overlay) and is provably NOT in the DOM or any network response, so text-scraping returns nothing. Correct fix: switch the text source to **OCR of the archived image** (image-first, RULE 0.6 requires the S3 image anyway) using a local vision model on the Mini — not scraping FS's transcription overlay. Auto-filed by scripts/auto-issue-monitor.mjs.` });
    }
  } catch { /* research_findings not present */ }

  // ── file / dedup / record ──
  const open = await ghOpenIssues();  // null if no token
  let filed = 0, recorded = 0;
  for (const f of findings) {
    const ex = (await pool.query(`SELECT filed_url FROM monitor_issues WHERE fingerprint=$1`, [f.fingerprint])).rows[0];
    let url = ex?.filed_url || null;
    if (TOKEN && !url && !(open || []).includes(f.title)) { url = await ghCreate(f.title, f.body); if (url) filed++; }
    await pool.query(
      `INSERT INTO monitor_issues (fingerprint, category, title, body, filed_url) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (fingerprint) DO UPDATE SET last_seen=now(), seen_count=monitor_issues.seen_count+1, body=EXCLUDED.body, filed_url=COALESCE(monitor_issues.filed_url, EXCLUDED.filed_url)`,
      [f.fingerprint, f.category, f.title, f.body, url]);
    if (!url) recorded++;
  }

  console.log(`=== AUTO-ISSUE-MONITOR: ${findings.length} finding(s) — ${filed} filed to GitHub, ${recorded} recorded (no token) ===`);
  for (const f of findings) console.log(`  [${f.category}] ${f.title}`);
  if (findings.length) await notify(`Auto-issue-monitor: ${findings.length} finding(s), ${filed} filed`, { severity: 'warning' }).catch(() => {});
  if (!TOKEN && findings.length) console.log('  (no GITHUB_TOKEN — findings recorded to monitor_issues + ntfy; add a free PAT to the Mini .env to auto-file)');
  await pool.end();
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
