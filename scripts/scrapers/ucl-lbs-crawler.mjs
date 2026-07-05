// ucl-lbs-crawler.mjs — Stage 1 (crawl + archive) of the UCL LBS scrape.
//
// Reaches the UCL Legacies of British Slavery site (https://www.ucl.ac.uk/lbs), which is behind a
// CLOUDFLARE MANAGED CHALLENGE — plain curl/fetch/WebFetch get 403 "Just a moment…". So we drive the
// Mini's REAL Chrome via puppeteer.connect() to 127.0.0.1:9222 (the SAME lifecycle as the FS climber;
// CLAUDE.md FamilySearch rules), which executes the challenge JS and holds the cf_clearance cookie.
//
// RAW-FIRST: this stage ONLY fetches + archives HTML into lbs_raw_records and expands the graph into
// lbs_crawl_frontier (M118). It does NOT parse fields or touch the person spine — that is stage 2
// (scripts/ingest-ucl-lbs.mjs), a separate re-runnable pass. See memory-bank/plan-ucl-lbs-scraper.md.
//
// GRAPH CRAWL: pops a 'queued' frontier row, fetches, extracts every /lbs/{type}/view/{id} link, and
// enqueues unseen ones (ON CONFLICT DO NOTHING = the visited-set). This is how the mixed small-int AND
// large/negative-hash PERSON ids get discovered (they are only reachable by reference).
//
// AUTONOMY / RESUMABILITY: state lives in Postgres (DB-is-truth). Kill/restart-safe: a stale 'fetching'
// row (claimed_at older than STALE_MIN) is reclaimable. Politeness is mandatory (CC-licensed charity
// site): serial, jittered delay, exponential backoff on challenge/429/503, ntfy on a hard block.
//
// PREREQ on the Mini (per CLAUDE.md): a real Chrome with the debug port up —
//   open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir=/tmp/ucl-lbs
// (own profile/port so it never contends with the FS climber's Chrome). If Cloudflare ever shows an
// INTERACTIVE turnstile, solve it once via VNC in that Chrome; cf_clearance then persists.
//
// Usage:
//   node scripts/scrapers/ucl-lbs-crawler.mjs --once claim 10894      # fetch ONE record, print+archive (proof)
//   node scripts/scrapers/ucl-lbs-crawler.mjs --limit 50              # crawl 50 frontier items
//   node scripts/scrapers/ucl-lbs-crawler.mjs                         # drain the frontier (unattended)
//   flags: --no-s3  --no-expand (don't enqueue discovered links)  --delay 2500  --stale-min 30

import 'dotenv/config';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const S3 = require('../../src/services/storage/S3Service');

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
const A = process.argv.slice(2);
const has = (f) => A.includes(f);
const val = (f, d) => { const i = A.indexOf(f); return i > -1 ? A[i + 1] : d; };
const onceIdx = A.indexOf('--once');
const ONCE = onceIdx > -1 ? { type: A[onceIdx + 1], id: A[onceIdx + 2] } : null;
const LIMIT = ONCE ? 1 : parseInt(val('--limit', '0'), 10) || Infinity;
const DO_S3 = !has('--no-s3');
const DO_EXPAND = !has('--no-expand');
const DELAY_MS = parseInt(val('--delay', '2200'), 10);   // base politeness delay
const STALE_MIN = parseInt(val('--stale-min', '30'), 10);
const MAX_ATTEMPTS = 4;

const BASE = 'https://www.ucl.ac.uk/lbs';
const CHROME = 'http://127.0.0.1:9222';
const LINK_RE = /\/lbs\/(claim|estate|person|firm)\/view\/(-?\d+)/g;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => DELAY_MS + Math.floor((crypto.randomBytes(1)[0] / 255) * 1200); // +0..1200ms
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function ntfy(msg) {
  const url = process.env.OPS_NOTIFY_WEBHOOK;
  if (!url) return;
  try { await fetch(url, { method: 'POST', body: `[lbs-crawler] ${msg}` }); } catch { /* soft */ }
}

// ── Cloudflare detection ─────────────────────────────────────────────────────────────────────────
function isChallengePage(html, title) {
  if (!html) return true;
  const t = (title || '').toLowerCase();
  if (t.includes('just a moment') || t.includes('attention required')) return true;
  return /_cf_chl_opt|challenges\.cloudflare\.com|cf-browser-verification/.test(html);
}
// A real LBS record page carries the site chrome + a "view" link back to itself.
function looksLikeRecord(html) {
  return /Legacies of British Slavery|\/lbs\/(claim|estate|person|firm)\/view\//.test(html);
}

// ── Browser ──────────────────────────────────────────────────────────────────────────────────────
async function connectBrowser() {
  let browser;
  try {
    browser = await puppeteer.connect({ browserURL: CHROME, defaultViewport: null });
  } catch (e) {
    console.error(`FATAL: cannot connect to Chrome at ${CHROME} (fail-loud). Is it up?\n` +
      `  open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir=/tmp/ucl-lbs\n` +
      `  (${e.message})`);
    process.exit(1);
  }
  const page = await browser.newPage();
  // CRITICAL: do NOT override the User-Agent. Cloudflare binds cf_clearance to the EXACT UA that
  // solved the Turnstile (the profile's real Chrome UA). Any override (even a suffix) invalidates the
  // clearance and re-triggers the challenge. New pages inherit the real profile UA + share cf_clearance.
  return { browser, page };
}

// Fetch one URL; returns { html, status, blocked, notFound }. Retries the Cloudflare interstitial.
async function fetchRecord(page, urlType, extId) {
  const url = `${BASE}/${urlType}/view/${extId}`;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let status = null;
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      status = resp ? resp.status() : null;
    } catch (e) {
      if (attempt === MAX_ATTEMPTS) return { html: null, status, blocked: false, notFound: false, error: e.message };
      await sleep(1500 * attempt); continue;
    }
    if (status === 404) return { html: null, status, blocked: false, notFound: true };
    if (status === 429 || status === 503) { await sleep(4000 * attempt); continue; }

    let html = await page.content().catch(() => '');
    let title = await page.title().catch(() => '');

    if (isChallengePage(html, title)) {
      // Managed challenges usually auto-solve in a real browser within a few seconds.
      await sleep(6000);
      html = await page.content().catch(() => '');
      title = await page.title().catch(() => '');
      if (isChallengePage(html, title)) {
        if (attempt === MAX_ATTEMPTS) return { html, status, blocked: true, notFound: false };
        await sleep(3000 * attempt); continue;   // back off and retry
      }
    }
    // Some LBS "not found" ids return 200 with an error body, not 404.
    if (status === 200 && !looksLikeRecord(html)) return { html, status, blocked: false, notFound: true };
    return { html, status, blocked: false, notFound: false };
  }
  return { html: null, status: null, blocked: true, notFound: false };
}

// ── DB frontier ops ──────────────────────────────────────────────────────────────────────────────
async function reclaimStale(pool) {
  const r = await pool.query(
    `UPDATE lbs_crawl_frontier SET status='queued'
       WHERE status='fetching' AND claimed_at < now() - ($1 || ' minutes')::interval
       RETURNING 1`, [String(STALE_MIN)]);
  if (r.rows.length) console.log(`Reclaimed ${r.rows.length} stale 'fetching' rows.`);
}

// Atomically claim the next queued item (SKIP LOCKED = concurrency-safe even if we ever parallelize).
async function claimNext(pool) {
  const { rows } = await pool.query(
    `UPDATE lbs_crawl_frontier f SET status='fetching', claimed_at=now(), attempts=attempts+1
       FROM (
         SELECT url_type, ext_id FROM lbs_crawl_frontier
          WHERE status='queued'
          ORDER BY url_type,
                   (CASE WHEN ext_id ~ '^-?[0-9]+$' THEN ext_id::bigint ELSE 0 END)
          LIMIT 1 FOR UPDATE SKIP LOCKED
       ) s
      WHERE f.url_type=s.url_type AND f.ext_id=s.ext_id
      RETURNING f.url_type, f.ext_id, f.depth`);
  return rows[0] || null;
}

// Ensure ONE source_artifacts row for the whole LBS dataset (license/provenance), reused by all pages.
async function ensureArtifact(pool) {
  const { rows } = await pool.query(
    `INSERT INTO source_artifacts (artifact_key, dataset_label, source_name, source_url, license, rehostable)
       VALUES ('ucl-lbs', 'UCL Legacies of British Slavery', 'UCL Centre for the Study of the Legacies of British Slavery', $1, 'CC BY-NC-SA 4.0', TRUE)
     ON CONFLICT (artifact_key) DO UPDATE SET source_url=EXCLUDED.source_url
     RETURNING id`, [`${BASE}/search/`]);
  return rows[0].id;
}

async function archive(pool, urlType, extId, html, status, artifactId) {
  const hash = sha256(html);
  let s3Key = null;
  if (DO_S3 && S3.isEnabled && S3.isEnabled()) {
    s3Key = `sources/ucl-lbs/${urlType}/${extId}.html`;
    try {
      await S3.upload(s3Key, Buffer.from(html, 'utf8'), 'text/html; charset=utf-8',
        { sha256: hash, source: `${BASE}/${urlType}/view/${extId}` });
    } catch (e) { console.log(`  S3 upload failed (continuing): ${e.message}`); s3Key = null; }
  }
  await pool.query(
    `INSERT INTO lbs_raw_records (url_type, ext_id, source_url, html_s3_key, html_sha256, source_artifact_id, fetched_at)
       VALUES ($1,$2,$3,$4,$5,$6, now())
     ON CONFLICT (url_type, ext_id) DO UPDATE
       SET html_s3_key=EXCLUDED.html_s3_key, html_sha256=EXCLUDED.html_sha256, fetched_at=now()`,
    [urlType, extId, `${BASE}/${urlType}/view/${extId}`, s3Key, hash, artifactId]);
  return s3Key;
}

// Enqueue every /lbs/{type}/view/{id} discovered in the page (dedup via ON CONFLICT).
async function expandLinks(pool, html, from, depth) {
  const seen = new Set();
  let m; while ((m = LINK_RE.exec(html)) !== null) seen.add(`${m[1]}|${m[2]}`);
  if (!seen.size) return 0;
  const types = [], ids = [];
  for (const s of seen) { const [t, i] = s.split('|'); types.push(t); ids.push(i); }
  const r = await pool.query(
    `INSERT INTO lbs_crawl_frontier (url_type, ext_id, status, discovered_from, depth)
       SELECT t, i, 'queued', $3, $4
         FROM unnest($1::text[], $2::text[]) AS u(t, i)
     ON CONFLICT (url_type, ext_id) DO NOTHING
     RETURNING 1`, [types, ids, from, depth + 1]);
  return r.rows.length;
}

// ── Main ─────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.DATABASE_URL) { console.error('FATAL: DATABASE_URL not set (fail-loud).'); process.exit(1); }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const { browser, page } = await connectBrowser();
  const artifactId = await ensureArtifact(pool);
  console.log(`Connected to Chrome. S3 ${DO_S3 && S3.isEnabled && S3.isEnabled() ? 'ON' : 'OFF'}. ` +
    `Expand ${DO_EXPAND ? 'ON' : 'OFF'}. Delay ~${DELAY_MS}-${DELAY_MS + 1200}ms.`);

  let done = 0, blocked = 0, notFound = 0, discovered = 0;
  try {
    if (!ONCE) await reclaimStale(pool);

    while (done + blocked + notFound < LIMIT) {
      let item;
      if (ONCE) item = { url_type: ONCE.type, ext_id: ONCE.id, depth: 0 };
      else { item = await claimNext(pool); if (!item) { console.log('Frontier drained.'); break; } }

      const { url_type, ext_id, depth } = item;
      process.stdout.write(`[${done + blocked + notFound + 1}] ${url_type}/${ext_id} … `);
      const res = await fetchRecord(page, url_type, ext_id);

      if (res.blocked) {
        blocked++;
        if (!ONCE) await pool.query(
          `UPDATE lbs_crawl_frontier SET status='blocked', http_status=$3, error='cloudflare_challenge'
             WHERE url_type=$1 AND ext_id=$2`, [url_type, ext_id, res.status]);
        console.log('BLOCKED (cloudflare).');
        await ntfy(`BLOCKED on ${url_type}/${ext_id} — may need a one-time VNC turnstile solve.`);
        if (blocked >= 3) { console.error('3 consecutive blocks — pausing so Cloudflare is not hardened.'); break; }
        await sleep(15000); continue;
      }
      blocked = 0;

      if (res.notFound) {
        notFound++;
        if (!ONCE) await pool.query(
          `UPDATE lbs_crawl_frontier SET status='skipped', http_status=$3, fetched_at=now()
             WHERE url_type=$1 AND ext_id=$2`, [url_type, ext_id, res.status]);
        console.log(`not found (${res.status}).`);
        await sleep(jitter()); continue;
      }
      if (!res.html) {
        if (!ONCE) await pool.query(
          `UPDATE lbs_crawl_frontier SET status='error', error=$3 WHERE url_type=$1 AND ext_id=$2`,
          [url_type, ext_id, res.error || 'empty']);
        console.log(`error: ${res.error || 'empty body'}`);
        await sleep(jitter()); continue;
      }

      const s3Key = ONCE ? null : await archive(pool, url_type, ext_id, res.html, res.status, artifactId);
      let newLinks = 0;
      if (DO_EXPAND && !ONCE) newLinks = await expandLinks(pool, res.html, `${url_type}:${ext_id}`, depth);
      discovered += newLinks;
      if (!ONCE) await pool.query(
        `UPDATE lbs_crawl_frontier SET status='done', http_status=$3, s3_key=$4, fetched_at=now(), error=NULL
           WHERE url_type=$1 AND ext_id=$2`, [url_type, ext_id, res.status, s3Key]);
      done++;
      console.log(`ok (${res.html.length}b, +${newLinks} links${s3Key ? ', s3' : ''}).`);

      if (ONCE) {
        console.log('\n── ONCE proof ──');
        console.log('title:', (res.html.match(/<title>([^<]*)<\/title>/) || [])[1] || '(none)');
        const links = [...new Set([...res.html.matchAll(LINK_RE)].map((m) => `${m[1]}/${m[2]}`))];
        console.log(`internal /view links found: ${links.length}`);
        console.log(links.slice(0, 20).join('  '));
        break;
      }
      await sleep(jitter());
    }
  } finally {
    await page.close().catch(() => {});
    await browser.disconnect();   // disconnect, NOT close — leave the Mini's Chrome running
    await pool.end();
  }
  console.log(`\nDone: ${done} fetched, ${notFound} not-found, ${blocked} blocked, ${discovered} new links enqueued.`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
