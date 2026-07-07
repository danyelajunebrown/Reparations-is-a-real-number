// ingest-va-untold.mjs — Virginia Untold "Free Negro Registers" (#140) onto the spine as GATED leads via
// the bulk path. Library of Virginia CKAN CSV (open, LVA images re-hostable). ~41K freed persons, with
// MOTHER (kinship), DATE/PLACE of birth, Free status, and — the dual-ledger hook — WHO EMANCIPATED (the
// manumitter = the former enslaver) + a Barcode/File Name → the LVA register scan (a follow-on scan-attach).
//
// Reference-class hygiene (standard-external-source-ingest #6): a free-negro registration is a DATED
// FREED-STATUS fact, not "enslaved at place X"; person_type='free_person_of_color'. The manumitter is the
// owner-class party (captured in relationships for a later owner-lead + manumission-edge producer).
// Rule-8 dual-archive: S3 CSV + Wayback the CKAN page. id_system='va_untold_free_negro'.
//
// Usage: node scripts/ingest-va-untold.mjs <csv> --stats | --apply [--no-archive]

import 'dotenv/config';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { parse } from 'csv-parse';
import pg from 'pg';
import { bulkIngestLeads } from './lib/bulk-lead-ingest.mjs';
import { ensureSnapshot } from './lib/wayback.mjs';

const require = createRequire(import.meta.url);
const S3 = require('../src/services/storage/S3Service');
const FILE = process.argv[2];
const APPLY = process.argv.includes('--apply');
const NO_ARCHIVE = process.argv.includes('--no-archive');
if (!FILE || !fs.existsSync(FILE)) { console.error('usage: node scripts/ingest-va-untold.mjs <csv> [--stats|--apply]'); process.exit(1); }

const ID_SYSTEM = 'va_untold_free_negro';
const DATASET = 'https://data.virginia.gov/dataset/free-negro-registers';
const clean = (s) => (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
const yr = (s) => { const m = clean(s).match(/\b(1[6-9]\d\d)\b/); return m ? +m[1] : null; };

async function archiveCsv(pool) {
  const buf = fs.readFileSync(FILE);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  let s3Key = null, s3Bucket = null, waybackUrl = null;
  if (!NO_ARCHIVE && S3.isEnabled && S3.isEnabled()) {
    s3Key = 'sources/va-untold/free-negro-registers.csv';
    try { await S3.upload(s3Key, buf, 'text/csv; charset=utf-8', { sha256 }); s3Bucket = S3.bucket || null; console.log(`  S3 ✓ ${s3Key}`); }
    catch (e) { console.log(`  S3 fail: ${e.message}`); s3Key = null; }
  }
  if (!NO_ARCHIVE) { console.log('  Wayback: snapshotting CKAN page…'); waybackUrl = await ensureSnapshot(DATASET); console.log(waybackUrl ? `  Wayback ✓` : '  Wayback soft-fail'); }
  await pool.query(
    `INSERT INTO source_artifacts (artifact_key, dataset_label, source_name, source_url, s3_bucket, s3_key, wayback_url, sha256, bytes, content_type, license, rehostable)
     VALUES ('va-untold','Virginia Untold Free Negro Registers','Library of Virginia', $1,$2,$3,$4,$5,$6,'text/csv','Public/Open (LVA)', TRUE)
     ON CONFLICT (artifact_key) DO UPDATE SET s3_key=EXCLUDED.s3_key, wayback_url=EXCLUDED.wayback_url, sha256=EXCLUDED.sha256`,
    [DATASET, s3Bucket, s3Key, waybackUrl, sha256, buf.length]);
  console.log(`  source_artifacts ✓ (s3=${s3Key ? 'yes' : 'no'}, wayback=${waybackUrl ? 'yes' : 'no'}) — rule 8`);
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  if (APPLY) { console.log('Archiving source (rule 8)…'); await archiveCsv(pool); }

  const stats = { rows: 0, no_name: 0, with_birth: 0, with_mother: 0, with_manumitter: 0, with_image: 0, created: 0, linked: 0 };
  let batch = [], rown = 0;
  const flush = async () => { if (batch.length && APPLY) { const r = await bulkIngestLeads(pool, batch, { batchSize: 2000 }); stats.created += r.created; stats.linked += r.linked; } batch = []; };

  await new Promise((res, rej) => fs.createReadStream(FILE).pipe(parse({ columns: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true }))
    .on('data', async (r) => {
      rown++;
      const name = [clean(r['First Name']), clean(r['Middle Name']), clean(r['Last Name'])].filter(Boolean).join(' ') || clean(r['Alias']);
      stats.rows++;
      if (!name) { stats.no_name++; return; }
      const barcode = clean(r['Barcode']) || clean(r['File Name']) || ('vaunt-' + rown);
      const birth = yr(r['Date of birth']);
      const mother = clean(r['Name of mother']);
      const manumitter = clean(r['Who emancipated']);
      const status = clean(r['Free status']);
      const image = clean(r['File Name']);
      if (birth) stats.with_birth++;
      if (mother) stats.with_mother++;
      if (manumitter) stats.with_manumitter++;
      if (image) stats.with_image++;
      const rel = [];
      if (mother) rel.push({ type: 'mother', name: mother });
      if (manumitter) rel.push({ type: 'manumitter', name: manumitter, note: clean(r['Where emancipated']) });
      const ctx = [status && `free status: ${status}`, mother && `mother: ${mother}`, manumitter && `emancipated by: ${manumitter}`,
        clean(r['Color']) && `color: ${clean(r['Color'])}`, clean(r['Place of birth']) && `birthplace: ${clean(r['Place of birth'])}`,
        clean(r['Locality']) && `locality: ${clean(r['Locality'])}`, `VA Untold free-negro register ${barcode}`].filter(Boolean).join('; ');
      batch.push({
        name, sourceUrl: `https://www.lva.virginia.gov/public/vauntold/#reg-${rown}`, externalId: `vaunt-r${rown}`, idSystem: ID_SYSTEM,
        personType: 'free_person_of_color', sex: /^m/i.test(clean(r['Gender'])) ? 'm' : /^f/i.test(clean(r['Gender'])) ? 'f' : null,
        birthYear: birth, locations: [clean(r['Locality']) || 'Virginia', 'Virginia'].filter(Boolean),
        sourceType: 'scholarly', extractionMethod: 'bulk', confidence: 0.9, context: ctx.slice(0, 900), relationships: rel,
        dataQualityFlags: { va_untold_barcode: barcode, va_untold_image: image || null, free_status: status || null, license: 'Public/Open (LVA)' },
      });
      if (batch.length >= 5000) { /* flush handled after stream via pause not trivial; buffer */ }
    })
    .on('end', res).on('error', rej));
  // flush in chunks (buffered whole file — 41K is fine in memory)
  const all = batch; batch = [];
  for (let i = 0; i < all.length; i += 5000) { batch = all.slice(i, i + 5000); await flush(); }
  await pool.end();
  console.log('\n=== stats ===', JSON.stringify(stats));
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
