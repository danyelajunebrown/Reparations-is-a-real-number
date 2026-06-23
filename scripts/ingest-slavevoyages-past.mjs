#!/usr/bin/env node
/**
 * Ingest a SlaveVoyages PAST dataset file (African Origins or Oceans of Kinfolk)
 * into staging (migration 100), archiving the SOURCE FILE to our S3 + a Wayback
 * snapshot of its canonical page (recorded in source_artifacts).
 *
 * Mirrors the Hall ingest pattern (lossless `raw` + lean typed columns); the
 * resolve-to-canonical pass (person_facts / external_ids / chattel_transfer_events)
 * is a SEPARATE later script — this is "ingest + archive first".
 *
 * The CSV headers vary between the two PAST datasets and across releases, so column
 * mapping is best-effort header-aliasing (normalize → match); every row is kept in
 * full under `raw`, so nothing is lost even if a header alias is missed.
 *
 *   # dry run (parses + reports, no DB / S3 / Wayback writes):
 *   node scripts/ingest-slavevoyages-past.mjs --file ./tmp/african_origins.csv \
 *     --dataset african_origins \
 *     --source-url https://www.slavevoyages.org/past/database/african-origins
 *
 *   # apply (archive file to S3 + Wayback, write source_artifacts + staging):
 *   node scripts/ingest-slavevoyages-past.mjs --file ./tmp/oceans_of_kinfolk.csv \
 *     --dataset oceans_of_kinfolk \
 *     --source-url https://www.slavevoyages.org/past/database/oceans-of-kinfolk \
 *     --apply
 *
 * Flags: --apply (default dry) · --no-s3 · --no-wayback · --license "CC BY-NC 3.0"
 *        --download-url <url> · --artifact-key <slug> · --not-rehostable
 */
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import dotenv from 'dotenv';
import pg from 'pg';
import { parse } from 'csv-parse/sync';
import { ensureSnapshot } from './lib/wayback.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const require = createRequire(import.meta.url);
const S3 = require('../src/services/storage/S3Service');

const arg = (f, d = null) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const has = (f) => process.argv.includes(f);

const FILE = arg('--file');
const DATASET = arg('--dataset');                 // african_origins | oceans_of_kinfolk
const SOURCE_URL = arg('--source-url');
const DOWNLOAD_URL = arg('--download-url');
const LICENSE = arg('--license', 'CC BY-NC 3.0');
const REHOSTABLE = !has('--not-rehostable');
const APPLY = has('--apply');
const DO_S3 = !has('--no-s3');
const DO_WB = !has('--no-wayback');
const BATCH = parseInt(arg('--batch', '500'), 10);

const VALID = ['african_origins', 'oceans_of_kinfolk'];
function die(m) { console.error('ERROR:', m); process.exit(1); }
if (!FILE || !fs.existsSync(FILE)) die('--file <path> required (existing CSV)');
if (!VALID.includes(DATASET)) die(`--dataset must be one of ${VALID.join(' | ')}`);
if (!SOURCE_URL) die('--source-url <canonical dataset page> required (for the Wayback snapshot + provenance)');

const ARTIFACT_KEY = arg('--artifact-key', `slavevoyages-${DATASET.replace(/_/g, '-')}`);
const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ── header-aliasing: normalize a header to [a-z0-9] and match against alias sets ──
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIASES = {
  sv_id:            ['id', 'enslavedid', 'personid', 'recordid', 'svid'],
  name:             ['name', 'recordedname', 'africanname', 'enslavedname', 'originalname'],
  name_modern:      ['modernname', 'namemodern', 'standardname', 'normalizedname'],
  sex:              ['sex', 'gender'],
  age:              ['age', 'ageatarrival', 'agenum'],
  age_category:     ['agecategory', 'sexage', 'sexagecat', 'category', 'agegroup'],
  height_inches:    ['height', 'heightin', 'heightinches', 'stature', 'heightininches'],
  racial_descriptor:['color', 'colour', 'race', 'racialdescriptor', 'complexion', 'racialdescription'],
  origin:           ['origin', 'countryoforigin', 'country', 'majorregion', 'region', 'africanorigin', 'moderncountry'],
  language_group:   ['language', 'languagegroup', 'languageorigin', 'majorlanguage', 'languagename'],
  voyage_id:        ['voyageid', 'voyage', 'svvoyageid', 'voyageidentifier', 'voyageidnum'],
  ship_name:        ['shipname', 'vessel', 'vesselname', 'ship'],
  year:             ['year', 'yearam', 'arrivalyear', 'yeararr', 'yearofarrival'],
  embark_port:      ['embarkationport', 'portofembarkation', 'embarkport', 'embark', 'majorportembark'],
  disembark_port:   ['disembarkationport', 'portofdisembarkation', 'arrivalport', 'disembarkport', 'majorportdisembark'],
  owner_name:       ['owner', 'ownername', 'slaveowner'],
  shipper_name:     ['shipper', 'shippername'],
  consignor_name:   ['consignor', 'consignorname', 'consignee', 'consigneename'],
};
function buildHeaderMap(headers) {
  const normToOrig = {}; for (const h of headers) normToOrig[norm(h)] = h;
  const map = {};
  for (const [col, al] of Object.entries(ALIASES)) {
    const hit = al.find((a) => normToOrig[a] !== undefined);
    if (hit) map[col] = normToOrig[hit];
  }
  return map;
}
const numOrNull = (v) => { if (v == null || v === '') return null; const n = Number(String(v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : null; };
const intOrNull = (v) => { const n = numOrNull(v); return n == null ? null : Math.trunc(n); };
const strOrNull = (v) => { const s = (v == null ? '' : String(v)).trim(); return s === '' ? null : s; };

(async () => {
  // 1. file fingerprint
  const buf = fs.readFileSync(FILE);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const bytes = buf.length;
  log(`file: ${FILE} (${bytes.toLocaleString()} bytes, sha256 ${sha256.slice(0, 16)}…)`);

  // 2. parse CSV (headers, lossless)
  let rows;
  try {
    rows = parse(buf, { columns: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true, bom: true });
  } catch (e) { die(`CSV parse failed: ${e.message}`); }
  if (!rows.length) die('no rows parsed');
  const headers = Object.keys(rows[0]);
  const hmap = buildHeaderMap(headers);
  log(`parsed ${rows.length.toLocaleString()} rows, ${headers.length} columns`);
  log(`mapped typed columns: ${Object.keys(hmap).join(', ') || '(none — all data preserved in raw)'}`);
  const unmappedTyped = Object.keys(ALIASES).filter((c) => !hmap[c]);
  if (unmappedTyped.length) log(`(no header matched for: ${unmappedTyped.join(', ')} — fine, kept in raw)`);

  if (!APPLY) {
    log('DRY RUN — no S3 / Wayback / DB writes. Sample mapped row:');
    const r = rows[0]; const pick = (c) => (hmap[c] ? r[hmap[c]] : undefined);
    console.log(JSON.stringify({ name: pick('name'), sex: pick('sex'), age: pick('age'), origin: pick('origin'),
      voyage_id: pick('voyage_id'), year: pick('year'), owner_name: pick('owner_name') }, null, 2));
    await pool.end(); return;
  }

  // 3. archive the source FILE → our S3 (if rehostable) + Wayback snapshot of the page
  let s3Bucket = null, s3Key = null, waybackUrl = null;
  if (REHOSTABLE && DO_S3 && S3.isEnabled && S3.isEnabled()) {
    s3Key = `sources/slavevoyages/${ARTIFACT_KEY}/${path.basename(FILE)}`;
    try { const up = await S3.upload(s3Key, buf, 'text/csv', { dataset: DATASET, sha256, license: LICENSE });
      s3Bucket = S3.bucket || null; log(`S3 ✓ ${up.key}`); }
    catch (e) { log(`S3 upload failed (continuing): ${e.message}`); s3Key = null; }
  } else { log(REHOSTABLE ? 'S3 skipped (disabled/--no-s3)' : 'NOT rehostable — skipping S3 (link/Wayback-only)'); }

  if (DO_WB) {
    log('Wayback: snapshotting source page (may take ~30s)…');
    waybackUrl = await ensureSnapshot(SOURCE_URL);
    log(waybackUrl ? `Wayback ✓ ${waybackUrl}` : 'Wayback: no snapshot (soft-fail) — re-run later');
  }

  // 4. upsert source_artifacts, get id
  const sa = await pool.query(`
    INSERT INTO source_artifacts
      (artifact_key, dataset_label, source_name, source_url, download_url, s3_bucket, s3_key,
       wayback_url, sha256, bytes, content_type, license, rehostable, record_count, retrieved_at)
    VALUES ($1,$2,'SlaveVoyages',$3,$4,$5,$6,$7,$8,$9,'text/csv',$10,$11,$12,NOW())
    ON CONFLICT (artifact_key) DO UPDATE SET
      source_url=EXCLUDED.source_url, download_url=COALESCE(EXCLUDED.download_url, source_artifacts.download_url),
      s3_bucket=COALESCE(EXCLUDED.s3_bucket, source_artifacts.s3_bucket),
      s3_key=COALESCE(EXCLUDED.s3_key, source_artifacts.s3_key),
      wayback_url=COALESCE(EXCLUDED.wayback_url, source_artifacts.wayback_url),
      sha256=EXCLUDED.sha256, bytes=EXCLUDED.bytes, license=EXCLUDED.license,
      rehostable=EXCLUDED.rehostable, record_count=EXCLUDED.record_count, retrieved_at=NOW()
    RETURNING id`,
    [ARTIFACT_KEY, `SlaveVoyages PAST — ${DATASET}`, SOURCE_URL, DOWNLOAD_URL, s3Bucket, s3Key,
      waybackUrl, sha256, bytes, LICENSE, REHOSTABLE, rows.length]);
  const artifactId = sa.rows[0].id;
  log(`source_artifacts ✓ id=${artifactId}`);

  // 5. insert staging rows (idempotent on (dataset, record_index))
  const cols = ['dataset','record_index','sv_id','name','name_modern','sex','age','age_category',
    'height_inches','racial_descriptor','origin','language_group','voyage_id','ship_name','year',
    'embark_port','disembark_port','owner_name','shipper_name','consignor_name','raw','source_artifact_id'];
  const pick = (r, c) => (hmap[c] ? r[hmap[c]] : undefined);
  let inserted = 0, skipped = 0;
  for (let off = 0; off < rows.length; off += BATCH) {
    const chunk = rows.slice(off, off + BATCH);
    const values = []; const params = [];
    chunk.forEach((r, j) => {
      const idx = off + j;
      const row = [
        DATASET, idx, strOrNull(pick(r, 'sv_id')), strOrNull(pick(r, 'name')), strOrNull(pick(r, 'name_modern')),
        strOrNull(pick(r, 'sex')), numOrNull(pick(r, 'age')), strOrNull(pick(r, 'age_category')),
        numOrNull(pick(r, 'height_inches')), strOrNull(pick(r, 'racial_descriptor')), strOrNull(pick(r, 'origin')),
        strOrNull(pick(r, 'language_group')), strOrNull(pick(r, 'voyage_id')), strOrNull(pick(r, 'ship_name')),
        intOrNull(pick(r, 'year')), strOrNull(pick(r, 'embark_port')), strOrNull(pick(r, 'disembark_port')),
        strOrNull(pick(r, 'owner_name')), strOrNull(pick(r, 'shipper_name')), strOrNull(pick(r, 'consignor_name')),
        JSON.stringify(r), artifactId,
      ];
      const base = params.length;
      values.push(`(${row.map((_, k) => `$${base + k + 1}`).join(',')})`);
      params.push(...row);
    });
    const res = await pool.query(
      `INSERT INTO slavevoyages_past_people (${cols.join(',')}) VALUES ${values.join(',')}
       ON CONFLICT (dataset, record_index) DO NOTHING`, params);
    inserted += res.rowCount; skipped += chunk.length - res.rowCount;
    if (off % (BATCH * 20) === 0) log(`  …${(off + chunk.length).toLocaleString()}/${rows.length.toLocaleString()}`);
  }

  log(`✓ ${DATASET}: ${inserted.toLocaleString()} inserted, ${skipped.toLocaleString()} already present`);
  log(`  archive: S3=${s3Key || 'none'}  Wayback=${waybackUrl || 'none'}  license=${LICENSE}`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
