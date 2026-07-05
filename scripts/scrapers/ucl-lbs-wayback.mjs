// ucl-lbs-wayback.mjs — AUTONOMOUS Wayback-Machine path for the UCL LBS scrape.
//
// WHY NOT THE LIVE SITE: ucl.ac.uk/lbs sits behind a Cloudflare Turnstile that REFUSES the CDP-driven
// browser — it never grants a durable cf_clearance and re-challenges every navigation (verified
// 2026-07-04; FlareSolverr confirmed unable to clear Turnstile/managed challenges). The Internet
// Archive mirrors thousands of LBS record pages and is NOT Cloudflare-protected, so it is the
// zero-touch autonomous source. Same DOM → the SAME stage-2 parser (ingest-ucl-lbs.mjs) applies.
//
// No Chrome, no puppeteer — plain HTTP. Two resumable passes over the M118/M119 frontier:
//   --enumerate : Wayback CDX API → the exact archived record set + best HTTP-200 snapshot ts, UPSERT
//                 into lbs_crawl_frontier (wayback_ts). CDX IS the archived universe, so no graph-crawl.
//   --fetch     : pull each archived capture (…/web/{ts}id_/{url}) → S3 + lbs_raw_records, mark done.
//
// DB-is-truth / kill-safe (ON CONFLICT = visited-set). Politeness: IA is rate-limited — serial,
// ~1.2s jittered delay, backoff on 429/503. Only rows WHERE wayback_ts IS NOT NULL are fetched, so the
// live-site seed rows (1..N) coexist untouched for a future access route / the dataset request.
//
// Usage:
//   node scripts/scrapers/ucl-lbs-wayback.mjs --enumerate                 # all types
//   node scripts/scrapers/ucl-lbs-wayback.mjs --enumerate --type claim    # one type
//   node scripts/scrapers/ucl-lbs-wayback.mjs --fetch --limit 20          # pull 20 captures
//   node scripts/scrapers/ucl-lbs-wayback.mjs --fetch                     # drain the archived queue
//   flags: --no-s3   --delay 1200

import 'dotenv/config';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const S3 = require('../../src/services/storage/S3Service');

const A = process.argv.slice(2);
const has = (f) => A.includes(f);
const val = (f, d) => { const i = A.indexOf(f); return i > -1 ? A[i + 1] : d; };
const ENUMERATE = has('--enumerate');
const FETCH = has('--fetch');
const ONLY_TYPE = val('--type', null);
const LIMIT = parseInt(val('--limit', '0'), 10) || Infinity;
const DO_S3 = !has('--no-s3');
const DELAY_MS = parseInt(val('--delay', '1200'), 10);

const TYPES = ONLY_TYPE ? [ONLY_TYPE] : ['claim', 'estate', 'person', 'firm'];
const CDX = 'https://web.archive.org/cdx/search/cdx';
const WB = 'https://web.archive.org/web';
const ID_RE = /\/lbs\/(claim|estate|person|firm)\/view\/(-?\d+)/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => DELAY_MS + Math.floor((crypto.randomBytes(1)[0] / 255) * 800);
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function fetchText(url, { tries = 5 } = {}) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'ReparationsResearch/1.0 (+non-commercial LBS archival; db7613@bard.edu)' } });
      if (r.status === 429 || r.status === 503) { await sleep(3000 * i); continue; }
      if (r.status === 404) return { status: 404, body: '' };
      const body = await r.text();
      return { status: r.status, body };
    } catch (e) {
      if (i === tries) throw e;
      await sleep(2000 * i);
    }
  }
  return { status: 0, body: '' };
}

// ── ENUMERATE: CDX → frontier ──────────────────────────────────────────────────────────────────────
async function enumerate(pool) {
  let grandTotal = 0;
  for (const type of TYPES) {
    let resumeKey = null, seen = 0, upserted = 0;
    do {
      // No collapse=urlkey: it keeps the OLDEST capture (stale DOM risk). We pull ALL 200-captures and
      // keep the NEWEST ts per ext_id (below), so the parser sees current-era markup.
      let url = `${CDX}?url=ucl.ac.uk/lbs/${type}/view*&output=text&fl=timestamp,original`
        + `&filter=statuscode:200&limit=20000&showResumeKey=true`;
      if (resumeKey) url += `&resumeKey=${encodeURIComponent(resumeKey)}`;
      const { body } = await fetchText(url);
      const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);

      // The resumeKey (if any) is the final line and has NO space (data lines are "TS<space>URL").
      resumeKey = null;
      if (lines.length && !lines[lines.length - 1].includes(' ')) resumeKey = lines.pop();

      // Collect (type, ext_id, ts); keep the LATEST ts per ext_id within this page.
      const byId = new Map();
      for (const line of lines) {
        const sp = line.indexOf(' ');
        if (sp < 0) continue;
        const ts = line.slice(0, sp);
        const orig = line.slice(sp + 1);
        const m = orig.match(ID_RE);
        if (!m || m[1] !== type) continue;
        seen++;
        const id = m[2];
        const prev = byId.get(id);
        if (!prev || ts > prev) byId.set(id, ts);
      }
      if (byId.size) {
        const ids = [...byId.keys()];
        const tss = ids.map((id) => byId.get(id));
        const r = await pool.query(
          `INSERT INTO lbs_crawl_frontier (url_type, ext_id, status, discovered_from, wayback_ts)
             SELECT $1, u.id, 'queued', 'wayback_cdx', u.ts
               FROM unnest($2::text[], $3::text[]) AS u(id, ts)
           ON CONFLICT (url_type, ext_id) DO UPDATE
             SET wayback_ts = GREATEST(COALESCE(lbs_crawl_frontier.wayback_ts, ''), EXCLUDED.wayback_ts),
                 -- a NEWER capture than what we already fetched → re-queue to pull the current-era page
                 status = CASE
                            WHEN EXCLUDED.wayback_ts > COALESCE(lbs_crawl_frontier.wayback_ts, '') THEN 'queued'
                            WHEN lbs_crawl_frontier.status IN ('done','fetching') THEN lbs_crawl_frontier.status
                            ELSE 'queued' END
           RETURNING 1`, [type, ids, tss]);
        upserted += r.rows.length;
      }
      process.stdout.write(`\r  ${type}: CDX rows seen ${seen}, archived ids upserted ${upserted}${resumeKey ? ' …' : ''}   `);
      if (resumeKey) await sleep(jitter());
    } while (resumeKey);
    process.stdout.write('\n');
    grandTotal += upserted;
  }
  const { rows } = await pool.query(
    `SELECT url_type, count(*)::int n FROM lbs_crawl_frontier WHERE wayback_ts IS NOT NULL GROUP BY 1 ORDER BY 1`);
  console.log('Archived (wayback_ts set) per type:', rows.map((r) => `${r.url_type}=${r.n}`).join('  '));
  console.log(`Enumerate done. ${grandTotal} archived ids upserted this run.`);
}

// ── FETCH: archived captures → S3 + staging ─────────────────────────────────────────────────────────
async function ensureArtifact(pool) {
  const { rows } = await pool.query(
    `INSERT INTO source_artifacts (artifact_key, dataset_label, source_name, source_url, license, rehostable)
       VALUES ('ucl-lbs', 'UCL Legacies of British Slavery', 'UCL Centre for the Study of the Legacies of British Slavery', $1, 'CC BY-NC-SA 4.0', TRUE)
     ON CONFLICT (artifact_key) DO UPDATE SET source_url=EXCLUDED.source_url
     RETURNING id`, ['https://www.ucl.ac.uk/lbs/search/']);
  return rows[0].id;
}

function looksLikeRecord(html) {
  return /Legacies of British Slavery|\/lbs\/(claim|estate|person|firm)\/view\//.test(html);
}

async function claimNext(pool) {
  const { rows } = await pool.query(
    `UPDATE lbs_crawl_frontier f SET status='fetching', claimed_at=now(), attempts=attempts+1
       FROM (
         SELECT url_type, ext_id FROM lbs_crawl_frontier
          WHERE status='queued' AND wayback_ts IS NOT NULL
            ${ONLY_TYPE ? 'AND url_type = $1' : ''}
          ORDER BY url_type, (CASE WHEN ext_id ~ '^-?[0-9]+$' THEN ext_id::bigint ELSE 0 END)
          LIMIT 1 FOR UPDATE SKIP LOCKED
       ) s
      WHERE f.url_type=s.url_type AND f.ext_id=s.ext_id
      RETURNING f.url_type, f.ext_id, f.wayback_ts`, ONLY_TYPE ? [ONLY_TYPE] : []);
  return rows[0] || null;
}

async function doFetch(pool) {
  const artifactId = await ensureArtifact(pool);
  console.log(`Wayback fetch. S3 ${DO_S3 && S3.isEnabled && S3.isEnabled() ? 'ON' : 'OFF'}. Delay ~${DELAY_MS}-${DELAY_MS + 800}ms.`);
  let done = 0, empty = 0;
  while (done + empty < LIMIT) {
    const item = await claimNext(pool);
    if (!item) { console.log('Archived queue drained.'); break; }
    const { url_type, ext_id, wayback_ts } = item;
    const canonical = `https://www.ucl.ac.uk/lbs/${url_type}/view/${ext_id}`;
    const snap = `${WB}/${wayback_ts}id_/${canonical}`;
    process.stdout.write(`[${done + empty + 1}] ${url_type}/${ext_id} @${wayback_ts} … `);

    let res;
    try { res = await fetchText(snap); }
    catch (e) {
      await pool.query(`UPDATE lbs_crawl_frontier SET status='error', error=$3 WHERE url_type=$1 AND ext_id=$2`,
        [url_type, ext_id, e.message]);
      console.log(`error: ${e.message}`); await sleep(jitter()); continue;
    }

    if (res.status === 404 || !res.body || !looksLikeRecord(res.body)) {
      empty++;
      await pool.query(`UPDATE lbs_crawl_frontier SET status='skipped', http_status=$3, fetched_at=now() WHERE url_type=$1 AND ext_id=$2`,
        [url_type, ext_id, res.status]);
      console.log(`empty/not-a-record (${res.status}).`); await sleep(jitter()); continue;
    }

    const hash = sha256(res.body);
    let s3Key = null;
    if (DO_S3 && S3.isEnabled && S3.isEnabled()) {
      s3Key = `sources/ucl-lbs/${url_type}/${ext_id}.html`;
      try { await S3.upload(s3Key, Buffer.from(res.body, 'utf8'), 'text/html; charset=utf-8',
        { sha256: hash, source: canonical, wayback: snap }); }
      catch (e) { console.log(`(s3 fail ${e.message}) `); s3Key = null; }
    }
    await pool.query(
      `INSERT INTO lbs_raw_records (url_type, ext_id, source_url, html_s3_key, html_sha256, source_artifact_id, fetched_at)
         VALUES ($1,$2,$3,$4,$5,$6, now())
       ON CONFLICT (url_type, ext_id) DO UPDATE
         SET html_s3_key=EXCLUDED.html_s3_key, html_sha256=EXCLUDED.html_sha256, fetched_at=now()`,
      [url_type, ext_id, canonical, s3Key, hash, artifactId]);
    await pool.query(
      `UPDATE lbs_crawl_frontier SET status='done', http_status=$3, s3_key=$4, fetched_at=now(), error=NULL
         WHERE url_type=$1 AND ext_id=$2`, [url_type, ext_id, res.status, s3Key]);
    done++;
    console.log(`ok (${res.body.length}b${s3Key ? ', s3' : ''}).`);
    await sleep(jitter());
  }
  console.log(`\nFetch done: ${done} archived, ${empty} empty/skipped.`);
}

async function main() {
  if (!process.env.DATABASE_URL) { console.error('FATAL: DATABASE_URL not set (fail-loud).'); process.exit(1); }
  if (!ENUMERATE && !FETCH) { console.error('Pick a mode: --enumerate and/or --fetch'); process.exit(1); }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    if (ENUMERATE) await enumerate(pool);
    if (FETCH) await doFetch(pool);
  } finally { await pool.end(); }
}

main().catch((e) => { console.error('\nFATAL:', e); process.exit(1); });
