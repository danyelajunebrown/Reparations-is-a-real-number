// archive-fs-image-arks-drip.mjs — close the rule-8 gap on FamilySearch IMAGE arks, by PRIORITY, as a drip.
//
// WHY A DRIP AND NOT A BACKFILL (measured 2026-08-21, before writing any of this).
//   235,833 person_documents carry a 3:1 IMAGE ark with s3_key NULL. The FS viewer is DeepZoom, so an
//   image is fetched as a TILE GRID, and the grid measured on a real page is:
//       level 9 = 4 tiles · level 10 = 12 · level 11 (full res) = 48
//   So "archive all of them" costs 943,000 requests at level 9 and 11.3 MILLION at full resolution.
//   At a polite 1 req/sec that is 11 days, or 131 days, of continuous hammering of a genealogy service we
//   depend on and already tripped bot-detection against once today. That is not a backfill; it is mirroring
//   FamilySearch, and no reading of rule 8 requires it.
//
//   RULE 8's intent is that a canonical we ASSERT can SHOW its document. So: archive at full resolution the
//   documents that are actually asserted or actually needed, and leave the rest as durable CITATIONS with a
//   Wayback snapshot of the ARK page (one request, not forty-eight). Volume follows evidence, not row count.
//
// WHAT IT WILL NOT DO
//   · It will not screenshot the viewport. That is issue #124's known-bad path — FS serves tiled <img>, so
//     a screenshot yields a partial image plus UI furniture, and it is what silently OCR'd the FamilySearch
//     LOGIN FORM eighteen times on 2026-08-21. Tiles are fetched and stitched instead: deterministic, full
//     resolution, no UI interaction.
//   · It will not launch a browser. It borrows the authenticated :9222 Chrome and DISCONNECTS (never
//     close() — closing a borrowed browser killed the shared FS session for the whole Mini today).
//   · It will not run while the 1860 scrape holds the browser. One logged-in Chrome, one consumer.
//   · It will not write s3_key unless real image bytes were stored. A row that claims an archive it does not
//     have is worse than a null: it manufactures the appearance of evidence. (Cf. the 57,336 rows whose
//     "source_url" is a SlaveVoyages database anchor resolving to 25 distinct pages — archiving those would
//     have written 51,017 copies of one landing page and stamped them all as documents.)
//
// PRIORITY, not row order. Evidence is worth most where there is none:
//   1. the canonical is publicly asserted (assertable_*) but this is its only document  — we assert it, so
//      we must be able to show it
//   2. person_type enslaved / freedperson — the classes measured at 0-31% evidenced
//   3. the canonical has no other s3-backed document at all
//   Everything else waits. Class is used ONLY to prioritise scarcity; it never gates whether a document is
//   archivable (operator, 2026-08-21: build it agnostic).
//
// Usage:
//   node scripts/archive-fs-image-arks-drip.mjs                      # dry run, show the queue
//   node scripts/archive-fs-image-arks-drip.mjs --batch 25 --apply
//   node scripts/archive-fs-image-arks-drip.mjs --level 10 --batch 50 --apply
import 'dotenv/config';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';
import puppeteer from 'puppeteer';
import { ensureSnapshot } from './lib/wayback.mjs';

const require = createRequire(import.meta.url);
const S3 = require('../src/services/storage/S3Service');
const sharp = require('sharp');

const A = process.argv.slice(2);
const val = (f, d) => { const i = A.indexOf(f); return i > -1 ? A[i + 1] : d; };
const APPLY = A.includes('--apply');
const BATCH = +val('--batch', 25);
const LEVEL = +val('--level', 11);          // 11 = full resolution
const GAP_MS = +val('--gap-ms', 1500);
const TILE_GAP_MS = +val('--tile-gap-ms', 120);
const PORT = val('--port', '9222');
const MAX_TILES = 120;                       // refuse pathological grids rather than hammer

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arkOf = (u) => (String(u || '').match(/ark:\/61903\/(3:1:[A-Z0-9-]+)/i) || [])[1] || null;

async function pickQueue(pool) {
  return (await pool.query(`
    SELECT d.id, d.canonical_person_id, d.source_url, d.document_type,
           cp.canonical_name, cp.person_type,
           (cp.assertable_slaveowner OR cp.assertable_enslaved) AS asserted
      FROM person_documents d
      JOIN canonical_persons cp ON cp.id = d.canonical_person_id
     WHERE d.s3_key IS NULL
       AND d.source_url ~ 'ark:/61903/3:1:'
       AND NOT EXISTS (SELECT 1 FROM person_documents o
                        WHERE o.canonical_person_id = cp.id AND o.s3_key IS NOT NULL)
     ORDER BY (cp.assertable_slaveowner OR cp.assertable_enslaved) DESC,
              (cp.person_type IN ('enslaved','freedperson')) DESC,
              d.id
     LIMIT $1`, [BATCH])).rows;
}

// Fetch one tile through the authenticated browser. page.goto + response.buffer() carries cookies and
// sidesteps CORS, which blocks a same-page fetch() to the sg*.familysearch.org tile host.
async function tile(page, url) {
  const r = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (!r || r.status() !== 200) return null;
  const b = await r.buffer();
  return b && b.length > 100 ? b : null;
}

async function captureFullImage(page, ark) {
  const base = `https://sg30p0.familysearch.org/service/records/storage/deepzoomcloud/dz/v1/${ark}/image_files/${LEVEL}`;
  const first = await tile(page, `${base}/0_0.jpg`);
  if (!first) return null;

  // Probe the grid rather than assume it — pages differ in size and orientation.
  let cols = 1, rows = 1;
  for (let c = 1; c < 16; c++) { if (!(await tile(page, `${base}/${c}_0.jpg`))) break; cols++; await sleep(TILE_GAP_MS); }
  for (let r = 1; r < 16; r++) { if (!(await tile(page, `${base}/0_${r}.jpg`))) break; rows++; await sleep(TILE_GAP_MS); }
  if (cols * rows > MAX_TILES) throw new Error(`grid ${cols}x${rows} exceeds MAX_TILES ${MAX_TILES}`);

  const meta = await sharp(first).metadata();
  const TW = meta.width, TH = meta.height;
  const parts = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const buf = (c === 0 && r === 0) ? first : await tile(page, `${base}/${c}_${r}.jpg`);
      if (!buf) continue;                       // ragged edge tiles are normal
      parts.push({ input: buf, left: c * TW, top: r * TH });
      await sleep(TILE_GAP_MS);
    }
  }
  if (!parts.length) return null;
  const width = cols * TW, height = rows * TH;
  const stitched = await sharp({ create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite(parts).jpeg({ quality: 92 }).toBuffer();
  return { buf: stitched, width, height, tiles: parts.length, cols, rows };
}

async function main() {
  // ONE LOGGED-IN CHROME, ONE CONSUMER. The 1860 scrape drives the same :9222 browser; two consumers
  // interleaving page.goto() on a shared browser corrupts each other's navigation and doubles the request
  // rate against a service that already bot-challenged us today. Yield rather than contend.
  // (The header claimed this behaviour before the code did — comment and code must agree.)
  if (!A.includes('--ignore-busy')) {
    const { execSync } = await import('node:child_process');
    try {
      const busy = execSync('pgrep -f "extract-census-ocr|finish-1860-tail" || true', { encoding: 'utf8' }).trim();
      if (busy) { console.log('1860 scrape holds the browser — yielding this tick (--ignore-busy to override).'); return; }
    } catch { /* pgrep absent: proceed */ }
  }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false },
    statement_timeout: 300000, query_timeout: 300000 });
  pool.on('error', (e) => console.error(`[pool] idle client error (continuing): ${e.message}`));

  const queue = await pickQueue(pool);
  console.log(`${APPLY ? '=== APPLY ===' : '=== DRY RUN ==='}  level ${LEVEL} · batch ${queue.length}`);
  if (!queue.length) { console.log('nothing queued'); await pool.end(); return; }
  for (const q of queue.slice(0, 6)) {
    console.log(`  ${String(q.person_type).padEnd(12)} ${q.asserted ? 'ASSERTED' : '        '}  ${String(q.canonical_name).slice(0, 28).padEnd(30)} ${arkOf(q.source_url)}`);
  }
  if (!APPLY) { console.log(`\n(dry run — ${queue.length} queued; pass --apply)`); await pool.end(); return; }

  let browser;
  try {
    browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null });
  } catch (e) {
    console.error(`❌ no authenticated Chrome on :${PORT} — refusing to launch one (it would not be signed in).`);
    console.error(`   ${e.message}`);
    await pool.end(); process.exit(1);
  }
  const page = await browser.newPage();
  const st = { ok: 0, skip: 0, err: 0, bytes: 0 };

  for (const q of queue) {
    const ark = arkOf(q.source_url);
    if (!ark) { st.skip++; continue; }
    try {
      const img = await captureFullImage(page, ark);
      if (!img) { st.skip++; console.log(`  ⏭️  ${ark}: no tiles (not an image ark, or not permitted)`); continue; }

      const sha = crypto.createHash('sha256').update(img.buf).digest('hex');
      const key = `sources/familysearch/images/${ark.replace(/:/g, '_')}/${sha.slice(0, 16)}.jpg`;
      await S3.upload(key, img.buf, 'image/jpeg', { 'source-url': String(q.source_url).slice(0, 1024), ark });

      // rule 8 — DUAL archive. S3 holds the bytes; Wayback witnesses the ARK PAGE (one request, not 48).
      // sha256/bytes live in source_artifacts because person_documents carries only s3_key in this schema —
      // checked, not assumed. Without the artifact row the hash would be lost and rule 8 half-kept.
      let wb = null;
      try { wb = await ensureSnapshot(q.source_url); } catch (e) { console.log(`     wayback: ${e.message.slice(0, 60)}`); }

      await pool.query(
        `INSERT INTO source_artifacts
           (artifact_key, dataset_label, source_name, source_url, s3_bucket, s3_key, wayback_url,
            sha256, bytes, content_type, rehostable, retrieved_at, notes)
         VALUES ($1,'familysearch_image_ark','FamilySearch',$2,$3,$4,$5,$6,$7,'image/jpeg',FALSE,now(),$8)
         ON CONFLICT (artifact_key) DO NOTHING`,
        [`fs_image:${ark}`, q.source_url, process.env.S3_BUCKET || null, key, wb || null,
         sha, img.buf.length,
         `DeepZoom level ${LEVEL}, ${img.cols}x${img.rows} tiles stitched. rehostable=FALSE: FamilySearch ` +
         `terms — we hold the archive for audit/provenance, we do not republish the image.`])
        .catch((e) => console.log(`     artifact: ${e.message.slice(0, 70)}`));

      await pool.query(`UPDATE person_documents SET s3_key=$1 WHERE id=$2`, [key, q.id]);

      st.ok++; st.bytes += img.buf.length;
      console.log(`  ✅ ${ark} ${img.cols}x${img.rows} (${img.tiles} tiles, ${Math.round(img.buf.length / 1024)}KB)${wb ? ' + wayback' : ''} → ${q.canonical_name}`);
    } catch (e) {
      st.err++;
      console.log(`  ❌ ${ark}: ${e.message.slice(0, 100)}`);
      if (/403|429|denied|blocked/i.test(e.message)) {
        console.log('  ⛔ FamilySearch is refusing requests — STOPPING this tick rather than hammering.');
        break;
      }
    }
    await sleep(GAP_MS);
  }

  console.log(`\n=== ${JSON.stringify(st)} · ${Math.round(st.bytes / 1048576)}MB archived ===`);
  await page.close().catch(() => {});
  await browser.disconnect();      // BORROWED — never close
  await pool.end();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
