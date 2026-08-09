// ingest-jefferson-farm-book.mjs — fetch the COMPLETE Jefferson Farm Book (174 pp) from the Massachusetts
// Historical Society: authoritative TRANSCRIPTION (Baron, Garden & Farm Books of Jefferson, 1987 — NOT OCR)
// + full-res image. Archive image to S3 (RULE 0.6/8), store the transcription as the doc text (tier 0.95+,
// Jefferson's OWN estate ledger), link to the Jefferson canonical.
//
// The Farm Book is (a) the CHATTEL-side gold for Phase B2 — multi-year rolls of the SAME enslaved community
// with parentage brackets + the Wayles/mother inheritance provenance; and (b) a primary-source estate ledger
// that upgrades Jefferson's DAA to detailed accounting (labor valuation £18-8/yr, per-person provisioning,
// rations, land roll, losses/deaths). Structured extraction (rolls→persons+parentage; financials→DAA lines)
// is a SEPARATE step over this clean text.
//
// Considerate of MHS (a nonprofit): polite gap between requests, resumable (skips pages already archived).
// Usage: node scripts/ingest-jefferson-farm-book.mjs [--from 1 --to 174] [--apply]

import 'dotenv/config';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';
import { ensureSnapshot } from './lib/wayback.mjs';
const require = createRequire(import.meta.url);
const S3 = require('../src/services/storage/S3Service');

const A = process.argv.slice(2);
const val = (f, d) => { const i = A.indexOf(f); return i > -1 ? +A[i + 1] : d; };
const APPLY = A.includes('--apply');
const FROM = val('--from', 1), TO = val('--to', 174);
const GAP = 1500;
const UA = { 'User-Agent': 'Mozilla/5.0 (reparations-research; contact db7613@bard.edu)' };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const IMG = (n) => `https://www.masshist.org/thomasjeffersonpapers/farm/image/lg/farm_${n}_lg.jpg`;
const DOC = (n) => `https://www.masshist.org/thomasjeffersonpapers/doc?id=farm_${n}`;

// Pull the transcription body out of the MHS doc page (between "large image mode" and "Cite web page as").
async function transcription(n) {
  const html = await (await fetch(DOC(n), { headers: UA, signal: AbortSignal.timeout(30000) })).text();
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#\d+;/g, ' ').replace(/[ \t]+/g, ' ');
  const end = text.indexOf('Cite web page as');
  const start = text.lastIndexOf('large image mode', end > -1 ? end : text.length);
  if (start < 0 || end < 0 || end <= start) return '';
  return text.slice(start + 'large image mode'.length, end).replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 180000 });
  if (S3._regionVerifiedPromise) await S3._regionVerifiedPromise;
  const tjId = (await pool.query(`SELECT id FROM canonical_persons WHERE canonical_name ILIKE '%thomas jefferson%' AND person_type='enslaver' ORDER BY (SELECT count(*) FROM person_documents d WHERE d.canonical_person_id=canonical_persons.id) DESC LIMIT 1`)).rows[0]?.id || null;
  console.log(`=== Jefferson Farm Book (MHS transcriptions) pp.${FROM}-${TO} → Jefferson #${tjId} ${APPLY ? 'APPLY' : 'DRY'} ===`);

  let done = 0, archived = 0, textPages = 0, chars = 0, blank = 0;
  for (let n = FROM; n <= TO; n++) {
    if (APPLY) {
      const seen = await pool.query(`SELECT 1 FROM source_artifacts WHERE artifact_key=$1`, [`jefferson-farm-book:${n}`]);
      if (seen.rows.length) { done++; continue; }
    }
    let text = '', buf = null;
    try { text = await transcription(n); } catch (e) { console.log(`  p${n}: transcription err ${e.message.slice(0, 40)}`); }
    try { const r = await fetch(IMG(n), { headers: UA, signal: AbortSignal.timeout(30000) }); if (r.ok) buf = Buffer.from(await r.arrayBuffer()); } catch {}
    if (!text && (!buf || buf.length < 2000)) { blank++; console.log(`  p${n}: (blank/unavailable)`); await sleep(GAP); continue; }
    console.log(`  p${n}: transcription ${text.length} chars, image ${buf ? (buf.length / 1024 | 0) + 'KB' : 'none'}`);

    if (APPLY) {
      let s3Key = null;
      if (buf && buf.length > 2000) {
        s3Key = `sources/jefferson-farm-book/farm_${n}_lg.jpg`;
        const sha = crypto.createHash('sha256').update(buf).digest('hex');
        await S3.upload(s3Key, buf, 'image/jpeg', { sha256: sha, source: 'masshist-jefferson-farm-book', page: String(n) });
        const wb = await ensureSnapshot(DOC(n)).catch(() => null);
        await pool.query(
          `INSERT INTO source_artifacts (artifact_key, dataset_label, source_name, source_url, s3_key, wayback_url, sha256, bytes, content_type, rehostable)
           VALUES ($1,'Jefferson Farm Book','Massachusetts Historical Society (Coolidge Collection)',$2,$3,$4,$5,$6,'image/jpeg',TRUE)
           ON CONFLICT (artifact_key) DO UPDATE SET s3_key=EXCLUDED.s3_key`,
          [`jefferson-farm-book:${n}`, DOC(n), s3Key, wb, sha, buf.length]).catch(e => console.log('   artifact err', e.message.slice(0, 50)));
        archived++;
      }
      if (text.length >= 20) {
        await pool.query(
          `INSERT INTO person_documents (canonical_person_id, document_type, source_type, collection_name, source_url, s3_key, ocr_text, ocr_model, ocr_ran_at, name_as_appears, evidence_strength)
           VALUES ($1,'plantation_roll','jefferson_farm_book','Jefferson Farm Book p.${n} (MHS/Baron transcription)',$2,$3,$4,'mhs-transcription',now(),$5,'primary')
           ON CONFLICT DO NOTHING`,
          [tjId, DOC(n), s3Key, text, `Thomas Jefferson (Farm Book p.${n})`]).catch(e => console.log('   doc err', e.message.slice(0, 70)));
        textPages++; chars += text.length;
      }
    } else { if (text) { textPages++; chars += text.length; } if (buf && buf.length > 2000) archived++; }
    done++;
    await sleep(GAP);
  }
  console.log(`=== done: ${done} pages, ${archived} images archived, ${textPages} transcriptions (${chars} chars), ${blank} blank ===`);
  await pool.end();
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
