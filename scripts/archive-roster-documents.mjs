// archive-roster-documents.mjs — REMEDIATION: bring the roster documents up to standard. We do NOT ship
// raw external links; we dual-archive (rule 8: S3 + Wayback) and SERVE the presigned S3 copy, with the
// text OCR-extracted for RAG (RULE 0.5). This pass, per roster person_document:
//   1. clean source_url to a bare, resolvable URL (strip appended prose);
//   2. fetch the real document (skip login-walled hosts — those need an authenticated Mini/FS pull);
//   3. upload the fetched bytes to S3 (self-host → served via presigned URL);
//   4. Wayback-snapshot the source URL; record both in source_artifacts (rule 8);
//   5. extract text → ocr_text (HTML→text now; PDF/image OCR flagged as a follow-on);
//   6. set s3_key so the frontend serves OUR copy, not the external page.
// Login-walled hosts (fold3, familysearch, ancestry) are Wayback'd + flagged review_reason, not stored as
// misleading login HTML. Idempotent (skips docs already s3-archived by this pass).
//
// Usage: node scripts/archive-roster-documents.mjs [--only <person_id>] [--apply]

import 'dotenv/config';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';
import { ensureSnapshot } from './lib/wayback.mjs';
const require = createRequire(import.meta.url);
const S3 = require('../src/services/storage/S3Service');

const A = process.argv.slice(2);
const APPLY = A.includes('--apply');
const oi = A.indexOf('--only'); const ONLY = oi > -1 ? +A[oi + 1] : null;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17 Safari/605.1.15';
const WALLED = /fold3\.com|familysearch\.org|ancestry\.com|newspapers\.com/i;
const slug = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);

function bareUrl(s) { const m = (s || '').match(/https?:\/\/[^\s()]+/); return m ? m[0].replace(/[.,;]+$/, '') : null; }
function htmlToText(h) { return h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ').trim(); }

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const { rows } = await pool.query(
    `SELECT d.id, d.canonical_person_id, c.canonical_name, d.document_type, d.source_url, d.s3_key
       FROM person_documents d JOIN canonical_persons c ON c.id=d.canonical_person_id
      WHERE c.created_by='roster_partner_ingest' AND d.created_by='roster_partner_ingest'
        ${ONLY ? 'AND d.canonical_person_id=$1' : ''} ORDER BY c.canonical_name`, ONLY ? [ONLY] : []);
  const stats = { total: rows.length, url_fixed: 0, archived: 0, walled: 0, no_url: 0, err: 0 };
  for (const d of rows) {
    const url = bareUrl(d.source_url);
    if (!url) { stats.no_url++; console.log(`  NO-URL  ${d.canonical_name} [${d.document_type}] — "${(d.source_url || '').slice(0, 50)}"`); continue; }
    if (url !== d.source_url) { stats.url_fixed++; if (APPLY) await pool.query(`UPDATE person_documents SET source_url=$2 WHERE id=$1`, [d.id, url]); }
    if (d.s3_key && /roster/.test(d.s3_key)) continue; // already archived by this pass
    if (WALLED.test(url)) {
      stats.walled++;
      if (APPLY) { const wb = await ensureSnapshot(url); await pool.query(`UPDATE person_documents SET review_reason=$2 WHERE id=$1`, [d.id, `login-walled source (${new URL(url).host}); scan needs authenticated Mini/FS pull. Wayback:${wb ? 'yes' : 'no'}`]).catch(() => {}); }
      console.log(`  WALLED  ${d.canonical_name} [${d.document_type}] ${new URL(url).host} → Wayback + flagged`);
      continue;
    }
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
      if (!r.ok) { stats.err++; console.log(`  HTTP ${r.status}  ${d.canonical_name} ${url.slice(0, 50)}`); continue; }
      const ct = (r.headers.get('content-type') || '').toLowerCase();
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 1024) { stats.err++; console.log(`  EMPTY(${buf.length}b)  ${d.canonical_name} ${url.slice(0, 45)} — soft-block, needs Mini`); continue; }
      const ext = /pdf/.test(ct) ? 'pdf' : /jpe?g/.test(ct) ? 'jpg' : /png/.test(ct) ? 'png' : /html/.test(ct) ? 'html' : 'bin';
      const s3Key = `sources/roster/${slug(d.canonical_name)}/${slug(d.document_type)}-${d.id}.${ext}`;
      let ocr = null;
      if (ext === 'html') ocr = htmlToText(buf.toString('utf8')).slice(0, 8000);
      if (APPLY) {
        await S3.upload(s3Key, buf, ct || 'application/octet-stream', { sha256: crypto.createHash('sha256').update(buf).digest('hex'), source: url });
        const wb = await ensureSnapshot(url);
        await pool.query(
          `UPDATE person_documents SET s3_key=$2, ocr_text=COALESCE($3, ocr_text) WHERE id=$1`, [d.id, s3Key, ocr]);
        await pool.query(
          `INSERT INTO source_artifacts (artifact_key, dataset_label, source_name, source_url, s3_key, wayback_url, sha256, bytes, content_type, rehostable)
           VALUES ($1,$2,'roster document',$3,$4,$5,$6,$7,$8,TRUE) ON CONFLICT (artifact_key) DO UPDATE SET s3_key=EXCLUDED.s3_key, wayback_url=EXCLUDED.wayback_url`,
          [`roster-doc-${d.id}`, `${d.canonical_name} ${d.document_type}`, url, s3Key, wb, crypto.createHash('sha256').update(buf).digest('hex'), buf.length, ct]).catch(() => {});
      }
      stats.archived++;
      console.log(`  ✓ ARCHIVED ${d.canonical_name} [${d.document_type}] ${ext.toUpperCase()} ${(buf.length / 1024).toFixed(0)}KB → S3${ocr ? ' +text' : ''}`);
    } catch (e) { stats.err++; console.log(`  ERR ${d.canonical_name}: ${e.message.slice(0, 40)}`); }
  }
  await pool.end();
  console.log('\n=== ' + JSON.stringify(stats) + ' ===');
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
