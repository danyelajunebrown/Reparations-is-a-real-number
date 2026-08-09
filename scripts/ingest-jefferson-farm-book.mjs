// ingest-jefferson-farm-book.mjs — archive + OCR the Jefferson Farm Book pages (MHS Coolidge Collection).
//
// The Farm Book is the CHATTEL-side gold for Phase B2 (multi-year rolls of the SAME enslaved community with
// parentage brackets + the Wayles inheritance) AND a primary-source estate ledger that upgrades Thomas
// Jefferson's DAA from name-counts to detailed accounting (labor valuation £18-8/yr, per-person provisioning,
// rations, land roll, losses/deaths). Jefferson's OWN accounting ⇒ tier 0.95+ primary.
//
// This pass ARCHIVES each page to S3 (RULE 0.6/8: file-first, dual S3+Wayback) + creates a person_documents
// row (document_type='plantation_roll', linked to the Jefferson canonical) + OCRs with the vision-router
// (Qwen2.5-VL, cursive-strong). Structured extraction (rolls→persons+parentage edges; financial pages→DAA
// line items) is a SEPARATE gold-encoding step. FREE (vision-router). Idempotent on artifact_key.
//
// Usage: node scripts/ingest-jefferson-farm-book.mjs --dir /tmp/farmbook [--apply]

import 'dotenv/config';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';
import { ensureSnapshot } from './lib/wayback.mjs';
const require = createRequire(import.meta.url);
const S3 = require('../src/services/storage/S3Service');
const { transcribeImage, VISION_MODEL } = require('../src/services/vision/vision-router');

const A = process.argv.slice(2);
const val = (f, d) => { const i = A.indexOf(f); return i > -1 ? A[i + 1] : d; };
const APPLY = A.includes('--apply');
const DIR = val('--dir', '/tmp/farmbook');
const SRC_BASE = 'https://www.masshist.org/thomasjeffersonpapers/farm/';

async function jeffersonId(pool) {
  const r = (await pool.query(
    `SELECT id FROM canonical_persons WHERE canonical_name ILIKE '%thomas jefferson%' AND person_type='enslaver' ORDER BY (SELECT count(*) FROM person_documents d WHERE d.canonical_person_id=canonical_persons.id) DESC LIMIT 1`)).rows[0];
  return r?.id || null;
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 180000 });
  if (S3._regionVerifiedPromise) await S3._regionVerifiedPromise;
  const files = fs.readdirSync(DIR).filter(f => /^farm_\d+_lg\.jpg$/i.test(f)).sort((a, b) => (+a.match(/\d+/)[0]) - (+b.match(/\d+/)[0]));
  const tjId = await jeffersonId(pool);
  console.log(`=== Jefferson Farm Book ingest — ${files.length} pages, Jefferson canonical #${tjId || '(none)'} , router=${VISION_MODEL} ${APPLY ? 'APPLY' : 'DRY'} ===`);

  let archived = 0, ocrd = 0, chars = 0;
  for (const f of files) {
    const page = f.match(/farm_(\d+)/)[1];
    const buf = fs.readFileSync(`${DIR}/${f}`);
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    const s3Key = `sources/jefferson-farm-book/${f}`;
    const srcUrl = `${SRC_BASE}${f}`;
    const text = (await transcribeImage(buf, { mimeType: 'image/jpeg',
      prompt: 'Transcribe this 1770s-1790s handwritten plantation ledger page (Thomas Jefferson Farm Book) VERBATIM. Preserve every enslaved person NAME, birth year, parentage bracket (mother/family groupings), location, £-s-d amounts, and column headers exactly. Do not summarize.' }) || '').trim();
    console.log(`  farm_${page}: ${(buf.length / 1024 | 0)}KB → ${text.length} chars`);
    if (!APPLY) continue;
    await S3.upload(s3Key, buf, 'image/jpeg', { sha256: sha, source: 'masshist-jefferson-farm-book', page });
    const wb = await ensureSnapshot(srcUrl).catch(() => null);
    await pool.query(
      `INSERT INTO source_artifacts (artifact_key, dataset_label, source_name, source_url, s3_key, wayback_url, sha256, bytes, content_type, rehostable)
       VALUES ($1,'Jefferson Farm Book','Massachusetts Historical Society (Coolidge Collection)',$2,$3,$4,$5,$6,'image/jpeg',TRUE)
       ON CONFLICT (artifact_key) DO UPDATE SET s3_key=EXCLUDED.s3_key, wayback_url=EXCLUDED.wayback_url`,
      [`jefferson-farm-book:${page}`, srcUrl, s3Key, wb, sha, buf.length]).catch(e => console.log('   artifact err', e.message.slice(0, 50)));
    archived++;
    // person_documents row (linked to Jefferson) with the OCR text — primary-source estate ledger page.
    if (text.length >= 20) {
      await pool.query(
        `INSERT INTO person_documents (canonical_person_id, document_type, source_type, collection_name, source_url, s3_key, ocr_text, ocr_model, ocr_ran_at)
         VALUES ($1,'plantation_roll','jefferson_farm_book','Jefferson Farm Book (MHS Coolidge)',$2,$3,$4,$5,now())
         ON CONFLICT DO NOTHING`,
        [tjId, srcUrl, s3Key, text, VISION_MODEL]).catch(e => console.log('   doc err', e.message.slice(0, 60)));
      ocrd++; chars += text.length;
    }
  }
  console.log(`=== done: ${archived} archived to S3, ${ocrd} OCR'd (${chars} chars total) ===`);
  await pool.end();
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
