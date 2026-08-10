// archive-amelia-freedmens-images.mjs — FILE-FIRST archival of the Amelia C.H. Freedmen's Bureau letter
// images the operator pulled from the FamilySearch viewer, closing the RULE 0.6 gap left by
// scripts/ingest-amelia-freedmens-letters.mjs.
//
// WHAT WAS WRONG
//   The ingest hand-read these pages and wrote 10 `harm_events` — real, dated, named harms — but every one
//   of them carries `source_document_id = NULL` and only a `source_citation` STRING. A citation a reader
//   cannot open is an assertion, not evidence; CLAUDE.md audit rule 2 ("every external claim has
//   provenance") and RULE 0.6 ("every canonical serves an image") both want the scan itself, in S3, under
//   our control, because a FamilySearch ARK is behind a login and can be reorganized out from under us.
//
// WHAT THIS DOES
//   For each ~/Downloads/S3HY-6X37-*.jpg: sha256 → S3 → `source_artifacts` (dual-archive rule 8, with a
//   Wayback attempt on the ARK) → `person_documents` row carrying the ARK as `source_url`.
//   It does NOT invent page numbers and it does NOT link harm_events. The filenames are FamilySearch image
//   ARK suffixes, which carry no page ordering, and the register page a harm was read from is only legible
//   IN the scan. That linkage is a second, hand-read pass (`--link-page <ark> <page>`), kept deliberately
//   separate so that no source_document_id is ever assigned by inference.
//
// Usage:
//   node scripts/archive-amelia-freedmens-images.mjs                     # dry run
//   node scripts/archive-amelia-freedmens-images.mjs --apply
//   node scripts/archive-amelia-freedmens-images.mjs --link-page 314 123 --apply

import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import pg from 'pg';
import { ensureSnapshot } from './lib/wayback.mjs';

const require = createRequire(import.meta.url);
const S3 = require('../src/services/storage/S3Service');

const A = process.argv.slice(2);
const APPLY = A.includes('--apply');
const lp = A.indexOf('--link-page');
const LINK = lp > -1 ? { ark: A[lp + 1], page: +A[lp + 2] } : null;

const SRC_DIR = path.join(os.homedir(), 'Downloads');
const FILM = 'S3HY-6X37';
const S3_PREFIX = 'sources/freedmens-bureau/va/amelia/letters-received';
// The volume the operator was reading: Amelia C.H. field office, 5th Div / 2nd Sub-Dist VA, 1867-68.
// Same volume cited by the 10 harm_events (FamilySearch film 1596147).
const COLLECTION = "Freedmen's Bureau, Amelia C.H. field office (5th Div, 2nd Sub-Dist VA), Letters Received 1867-68";
const ARK = (suffix) => `https://www.familysearch.org/ark:/61903/3:1:${FILM}-${suffix}`;

async function linkPage(pool) {
  // Hand-read linkage only: the operator (or the model, reading the scan) states "ARK X is page N", and we
  // attach every harm_event whose citation names page N to that document. Nothing here guesses.
  const doc = (await pool.query(
    `SELECT id FROM person_documents WHERE source_url = $1`, [ARK(LINK.ark)])).rows[0];
  if (!doc) { console.error(`no person_documents row for ARK ${LINK.ark} — run the archive pass first`); process.exit(1); }
  const targets = (await pool.query(
    `SELECT id, victim_name, source_citation FROM harm_events
      WHERE source_document_id IS NULL AND source_citation ILIKE $1`, [`%p.${LINK.page}%`])).rows;
  console.log(`ARK ${LINK.ark} → doc #${doc.id} · page ${LINK.page} · ${targets.length} unlinked harm_event(s) cite that page`);
  for (const t of targets) console.log(`   harm #${t.id} ${t.victim_name}`);
  if (!APPLY) { console.log('(dry run — pass --apply to write)'); return; }
  const upd = await pool.query(
    `UPDATE person_documents SET page_reference = $2, collection_page_number = $2::int WHERE id = $1 RETURNING id`,
    [doc.id, String(LINK.page)]);
  const linked = await pool.query(
    `UPDATE harm_events SET source_document_id = $1
      WHERE source_document_id IS NULL AND source_citation ILIKE $2 RETURNING id`,
    [doc.id, `%p.${LINK.page}%`]);
  console.log(`✓ doc ${upd.rows.length} paged · ${linked.rows.length} harm_events now image-backed`);
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  console.log(APPLY ? '=== APPLY ===' : '=== DRY RUN ===');

  if (LINK) { await linkPage(pool); await pool.end(); return; }

  const files = fs.readdirSync(SRC_DIR)
    .filter((f) => f.startsWith(FILM + '-') && f.toLowerCase().endsWith('.jpg'))
    .sort();
  if (!files.length) { console.error(`no ${FILM}-*.jpg in ${SRC_DIR}`); process.exit(1); }
  console.log(`${files.length} scans · film ${FILM} · → s3://${process.env.S3_BUCKET}/${S3_PREFIX}/\n`);

  let uploaded = 0, existed = 0, docs = 0, waybacked = 0, bytes = 0;

  for (const f of files) {
    const suffix = f.replace(FILM + '-', '').replace(/\.jpg$/i, '');
    const buf = fs.readFileSync(path.join(SRC_DIR, f));
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    // Soft-block on truncated downloads: a 200-byte "image" is an error page, and archiving one as
    // evidence is worse than archiving nothing.
    if (buf.length < 20_000) { console.log(`  ! ${f} only ${buf.length}B — skipping (likely a failed download)`); continue; }
    const s3Key = `${S3_PREFIX}/${FILM}-${suffix}.jpg`;
    bytes += buf.length;

    if (!APPLY) {
      console.log(`  would archive ${f} (${(buf.length / 1024).toFixed(0)}KB, sha ${sha.slice(0, 12)}…) → ${s3Key}`);
      continue;
    }

    await S3.upload(s3Key, buf, 'image/jpeg', { sha256: sha, source: 'FamilySearch ' + ARK(suffix) });
    uploaded++;

    const wb = await ensureSnapshot(ARK(suffix)).catch(() => null);
    if (wb) waybacked++;

    await pool.query(
      `INSERT INTO source_artifacts
         (artifact_key, dataset_label, source_name, source_url, s3_key, wayback_url, sha256, bytes, content_type, rehostable, record_count, notes)
       VALUES ($1, $2, 'FamilySearch (NARA RG 105, Freedmen''s Bureau VA field office records)', $3, $4, $5, $6, $7, 'image/jpeg', TRUE, 1, $8)
       ON CONFLICT (artifact_key) DO UPDATE SET s3_key = EXCLUDED.s3_key, sha256 = EXCLUDED.sha256, wayback_url = COALESCE(EXCLUDED.wayback_url, source_artifacts.wayback_url)`,
      [`amelia-freedmens:${FILM}-${suffix}`, COLLECTION, ARK(suffix), s3Key, wb, sha, buf.length,
        'Operator-pulled scan backing the hand-read harm_events from ingest-amelia-freedmens-letters.mjs. Page number set by a separate hand-read pass (--link-page).']);

    // No canonical_person_id: these leads are unpromoted by design (RULE 0.6 — the freedpeople named here
    // enter as leads, and only a lead that serves its own image is promoted). The document exists first.
    const d = await pool.query(
      `INSERT INTO person_documents
         (name_as_appears, source_url, s3_key, source_type, collection_name, collection_key, film_number,
          document_type, evidence_strength, evidences_enslaved_holding, filename, file_size, mime_type, created_by)
       VALUES ($1, $2, $3, 'freedmens_bureau', $4, 'amelia_freedmens_letters', $5,
               'freedmens_letter', 'primary', FALSE, $6, $7, 'image/jpeg', 'archive-amelia-freedmens-images')
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [`Amelia C.H. Freedmen's Bureau letters (${FILM}-${suffix})`, ARK(suffix), s3Key, COLLECTION, FILM, f, buf.length]);
    if (d.rows.length) docs++; else existed++;

    process.stdout.write(`\r  ${uploaded}/${files.length} archived, ${docs} docs, ${waybacked} wayback   `);
  }

  console.log(`\n\n=== ${APPLY ? 'ARCHIVED' : 'DRY RUN'}: ${uploaded} uploaded · ${docs} person_documents · ${existed} already present · ${waybacked} wayback snapshots · ${(bytes / 1048576).toFixed(1)}MB ===`);
  if (APPLY) {
    const still = (await pool.query(`SELECT count(*)::int n FROM harm_events WHERE source_document_id IS NULL`)).rows[0].n;
    console.log(`harm_events still without an image: ${still} — link them with --link-page <ark-suffix> <page> --apply`);
  }
  await pool.end();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
