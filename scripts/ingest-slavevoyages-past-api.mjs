#!/usr/bin/env node
/**
 * Ingest SlaveVoyages "People of the Atlantic Slave Trade" (PAST) from the public
 * read API into staging (migration 100), archiving the pulled records as an NDJSON
 * source file to our S3 + a Wayback snapshot of the database page (source_artifacts).
 *
 * PAST is served by a paged, token-authed JSON API (no static file); the site's
 * "Download CSV" only dumps loaded grid rows. This pages the full set
 * (~169K: African Origins/Trans-Atlantic + Oceans of Kinfolk + Texas Bound), so
 * `--dataset` is derived per-record from the API's integer `dataset` code.
 *
 * The token below is the PUBLIC read token shipped in the slavevoyages.org frontend
 * JS — it gates the same open, CC BY-NC research data every visitor's browser reads;
 * use here is the intended non-commercial research use. Override via env if desired.
 *
 *   # dry (page a couple pages, no DB/S3/Wayback writes):
 *   node scripts/ingest-slavevoyages-past-api.mjs --max-pages 1
 *   # full pull + archive + stage:
 *   node scripts/ingest-slavevoyages-past-api.mjs --apply
 *
 * Flags: --apply · --page-size 500 · --max-pages 0(all) · --delay-ms 200
 *        --out <ndjson> · --no-s3 · --no-wayback · --source-url <page>
 */
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import dotenv from 'dotenv';
import pg from 'pg';
import { ensureSnapshot } from './lib/wayback.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const require = createRequire(import.meta.url);
const S3 = require('../src/services/storage/S3Service');

const arg = (f, d = null) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const has = (f) => process.argv.includes(f);

const API = 'https://api.slavevoyages.org/past/enslaved/';
const TOKEN = process.env.SLAVEVOYAGES_API_TOKEN || 'd3eb897a50604f6b995872caa6e8b23baabe2ddb'; // public frontend read token
const APPLY = has('--apply');
const PAGE_SIZE = parseInt(arg('--page-size', '500'), 10);
const MAX_PAGES = parseInt(arg('--max-pages', '0'), 10); // 0 = all
const DELAY = parseInt(arg('--delay-ms', '200'), 10);
const DO_S3 = !has('--no-s3');
const DO_WB = !has('--no-wayback');
const SOURCE_URL = arg('--source-url', 'https://www.slavevoyages.org/past/database');
const OUT = arg('--out', path.resolve(__dirname, '../tmp/slavevoyages_past_all.ndjson'));
const ARTIFACT_KEY = 'slavevoyages-past-all-api';
const BATCH = 500;

const DATASET_LABEL = { 0: 'african_origins', 1: 'oceans_of_kinfolk', 2: 'texas_bound' };
const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strOrNull = (v) => { const s = (v == null ? '' : String(v)).trim(); return s === '' ? null : s; };
const numOrNull = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

async function fetchPage(page) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Authorization': `Token ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ page, page_size: PAGE_SIZE }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`API ${res.status} on page ${page}: ${(await res.text()).slice(0, 120)}`);
  return res.json();
}

// map one API record → staging row tuple (col order below)
function mapRecord(r) {
  const code = typeof r.dataset === 'number' ? r.dataset : null;
  const dataset = DATASET_LABEL[code] || (code != null ? `dataset_${code}` : 'unknown');
  const v = r.voyages || {};
  const name = strOrNull(r.documented_name) ||
    strOrNull([r.name_first, r.name_second, r.name_third].filter(Boolean).join(' '));
  const ownerFirst = Array.isArray(r.enslavers) && r.enslavers[0] ? r.enslavers[0].name_and_role : null;
  return {
    dataset, dataset_code: code, record_index: numOrNull(r.enslaved_id ?? r.id),
    sv_id: strOrNull(r.enslaved_id ?? r.id), name, name_modern: strOrNull(r.modern_name),
    sex: strOrNull(r.gender), age: numOrNull(r.age), age_category: null,
    height_inches: numOrNull(r.height), racial_descriptor: strOrNull(r.skin_color),
    origin: strOrNull(v.embarkation) || strOrNull(r.register_country),
    language_group: strOrNull(r.language_group && r.language_group.name),
    voyage_id: strOrNull(v.id), ship_name: strOrNull(v.ship_name), year: numOrNull(v.year),
    embark_port: strOrNull(v.embarkation),
    disembark_port: strOrNull(v.disembarkation) || strOrNull(r.post_disembark_location && r.post_disembark_location.name),
    owner_name: strOrNull(ownerFirst), shipper_name: null, consignor_name: null,
    raw: r,
  };
}

const COLS = ['dataset','dataset_code','record_index','sv_id','name','name_modern','sex','age','age_category',
  'height_inches','racial_descriptor','origin','language_group','voyage_id','ship_name','year',
  'embark_port','disembark_port','owner_name','shipper_name','consignor_name','raw','source_artifact_id'];

async function insertBatch(rows, artifactId) {
  if (!rows.length) return 0;
  const values = []; const params = [];
  rows.forEach((m) => {
    const tuple = [m.dataset, m.dataset_code, m.record_index, m.sv_id, m.name, m.name_modern, m.sex, m.age,
      m.age_category, m.height_inches, m.racial_descriptor, m.origin, m.language_group, m.voyage_id, m.ship_name,
      m.year, m.embark_port, m.disembark_port, m.owner_name, m.shipper_name, m.consignor_name,
      JSON.stringify(m.raw), artifactId];
    const base = params.length;
    values.push(`(${tuple.map((_, k) => `$${base + k + 1}`).join(',')})`);
    params.push(...tuple);
  });
  const res = await pool.query(
    `INSERT INTO slavevoyages_past_people (${COLS.join(',')}) VALUES ${values.join(',')}
     ON CONFLICT (dataset, record_index) DO NOTHING`, params);
  return res.rowCount;
}

(async () => {
  // peek count
  const first = await fetchPage(1);
  const total = first.count;
  log(`PAST enslaved: ${total.toLocaleString()} records, page_size ${PAGE_SIZE}` + (MAX_PAGES ? `, max ${MAX_PAGES} pages` : ''));

  let artifactId = null;
  if (APPLY) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    const sa = await pool.query(`
      INSERT INTO source_artifacts (artifact_key, dataset_label, source_name, source_url, license, rehostable, record_count, retrieved_at)
      VALUES ($1,'SlaveVoyages PAST (African Origins + Oceans of Kinfolk + Texas Bound), via public read API','SlaveVoyages',$2,'CC BY-NC 3.0',true,$3,NOW())
      ON CONFLICT (artifact_key) DO UPDATE SET record_count=EXCLUDED.record_count, retrieved_at=NOW()
      RETURNING id`, [ARTIFACT_KEY, SOURCE_URL, total]);
    artifactId = sa.rows[0].id;
    log(`source_artifacts ✓ id=${artifactId}`);
  }

  const ws = APPLY ? fs.createWriteStream(OUT) : null;
  const hash = crypto.createHash('sha256');
  let bytes = 0, fetched = 0, inserted = 0;
  const tally = {};
  let buf = [];
  const flush = async () => { if (APPLY && buf.length) { inserted += await insertBatch(buf, artifactId); } buf = []; };

  let page = 1;
  while (true) {
    const data = page === 1 ? first : await fetchPage(page);
    const results = data.results || [];
    if (!results.length) break;
    for (const r of results) {
      const m = mapRecord(r);
      tally[m.dataset] = (tally[m.dataset] || 0) + 1;
      if (APPLY) { const line = JSON.stringify(r) + '\n'; ws.write(line); hash.update(line); bytes += Buffer.byteLength(line); buf.push(m); if (buf.length >= BATCH) await flush(); }
      fetched++;
    }
    log(`  page ${page}: +${results.length} (fetched ${fetched.toLocaleString()}/${total.toLocaleString()})`);
    if (MAX_PAGES && page >= MAX_PAGES) break;
    if (fetched >= total) break;
    page++;
    if (DELAY) await sleep(DELAY);
  }
  await flush();

  if (!APPLY) {
    log(`DRY: fetched ${fetched.toLocaleString()}. dataset tally: ${JSON.stringify(tally)}`);
    await pool.end(); return;
  }

  await new Promise((res) => ws.end(res));
  const sha256 = hash.digest('hex');
  log(`NDJSON written: ${OUT} (${bytes.toLocaleString()} bytes, sha256 ${sha256.slice(0, 16)}…)`);

  // finalize archive: S3 + Wayback
  let s3Key = null, s3Bucket = null, waybackUrl = null;
  if (DO_S3 && S3.isEnabled && S3.isEnabled()) {
    s3Key = `sources/slavevoyages/past-api/${path.basename(OUT)}`;
    try { await S3.upload(s3Key, fs.readFileSync(OUT), 'application/x-ndjson', { sha256, records: String(fetched) }); s3Bucket = S3.bucket || null; log(`S3 ✓ ${s3Key}`); }
    catch (e) { log(`S3 upload failed (continuing): ${e.message}`); s3Key = null; }
  }
  if (DO_WB) { log('Wayback: snapshotting database page…'); waybackUrl = await ensureSnapshot(SOURCE_URL); log(waybackUrl ? `Wayback ✓ ${waybackUrl}` : 'Wayback: no snapshot (soft-fail)'); }

  await pool.query(`UPDATE source_artifacts SET s3_bucket=$2,s3_key=$3,wayback_url=$4,sha256=$5,bytes=$6,content_type='application/x-ndjson',record_count=$7,download_url=$8 WHERE id=$1`,
    [artifactId, s3Bucket, s3Key, waybackUrl, sha256, bytes, fetched, API]);

  log(`✓ DONE: fetched ${fetched.toLocaleString()}, staged ${inserted.toLocaleString()} new. dataset tally: ${JSON.stringify(tally)}`);
  log(`  archive: S3=${s3Key || 'none'}  Wayback=${waybackUrl || 'none'}  sha256=${sha256.slice(0, 16)}…`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
