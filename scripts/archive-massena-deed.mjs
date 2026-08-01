// archive-massena-deed.mjs — file-first archival of the Massena chain-of-title's MODERN link: the recorded
// 2024 deed conveying the Massena parcel (Barrytown/Red Hook, Dutchess) to BARD COLLEGE. This is the
// primary source that lifts migration-129's requires_human_review on the 2024 link (the modern holder).
//
// The deed (user-supplied `~/Downloads/bard buys massena.pdf`) is a Dutchess County Clerk recording:
//   Doc# 02-2024-50006 · recorded 1/2/2024 · Grantee BARD COLLEGE · Tax District Red Hook · 11 pages ·
//   Red Hook transfer tax $272,100 (2% CPF rate) → back-solves to ~$13.6M, corroborating the ~$14M in M129.
//
// Also logs three research_findings (migration 128): the deed (hit), and the NESRI/census discovery that
// the NY Hyde Park Bards DID hold enslaved people — Samuel Bard (1800 census, 7) and William Bard (1810
// census, 4; the college founder's father) — which the 560-page Bard genealogy was SILENT on. Those census
// PAGES are the primary source still to be pulled (FS/Ancestry, Mini) — logged so the null isn't lost.
//
// Usage: node scripts/archive-massena-deed.mjs [--apply]   (dry-run default)

import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import pg from 'pg';
const require = createRequire(import.meta.url);
const S3 = require('../src/services/storage/S3Service');

const APPLY = process.argv.includes('--apply');
const DEED_PATH = path.join(os.homedir(), 'Downloads', 'bard buys massena.pdf');
const S3_KEY = 'sources/massena/bard-college-massena-deed-2024.pdf';

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  console.log(APPLY ? '=== APPLY ===' : '=== DRY RUN ===');

  if (!fs.existsSync(DEED_PATH)) { console.error('deed PDF not found:', DEED_PATH); process.exit(1); }
  const buf = fs.readFileSync(DEED_PATH);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  console.log(`deed: ${(buf.length / 1024).toFixed(0)}KB  sha256=${sha.slice(0, 16)}…`);
  if (buf.length < 1024) { console.error('deed < 1KB — soft-block, refusing'); process.exit(1); }

  // ── locate the migration-129 Massena 2024 → Bard College land_transfer_events row ──
  const lte = (await pool.query(
    `SELECT lte.transfer_id, lte.grantee_name, lte.transfer_year, lte.verification_status, lte.requires_human_review
       FROM land_transfer_events lte JOIN properties pr ON pr.property_id = lte.property_id
      WHERE pr.property_name = 'Massena' AND lte.transfer_year = 2024 AND lte.grantee_name ILIKE '%Bard College%'`)).rows[0];
  if (!lte) { console.error('Massena 2024→Bard land_transfer_events row not found (run migration 129 first)'); process.exit(1); }
  console.log(`M129 2024 link: transfer ${lte.transfer_id} (verify=${lte.verification_status}, review=${lte.requires_human_review})`);

  if (!APPLY) {
    console.log(`would upload → s3://${process.env.S3_BUCKET}/${S3_KEY}`);
    console.log('would: verify the 2024 transfer + record deed metadata + source_artifacts + 3 research_findings');
    await pool.end(); return;
  }

  // ── 1. archive the deed to S3 + source_artifacts (rule 8; a recorded deed has no live source URL) ──
  await S3.upload(S3_KEY, buf, 'application/pdf', { sha256: sha, source: 'Dutchess County Clerk Doc# 02-2024-50006' });
  await pool.query(
    `INSERT INTO source_artifacts (artifact_key, dataset_label, source_name, source_url, s3_key, sha256, bytes, content_type, rehostable, record_count, notes)
     VALUES ('massena-deed-2024', 'Massena chain-of-title — 2024 deed to Bard College', 'Dutchess County Clerk (recorded deed)',
             'https://dutchessny.gov/CountyClerk (Doc# 02-2024-50006)', $1, $2, $3, 'application/pdf', TRUE, 1,
             'Recorded 1/2/2024; Grantee BARD COLLEGE; Tax District Red Hook; 11 pp; Red Hook transfer tax $272,100 (2% CPF) → ~$13.6M, corroborates M129 ~$14M.')
     ON CONFLICT (artifact_key) DO UPDATE SET s3_key=EXCLUDED.s3_key, sha256=EXCLUDED.sha256, bytes=EXCLUDED.bytes`,
    [S3_KEY, sha, buf.length]);
  console.log(`  ✓ archived → S3 + source_artifacts`);

  // ── 2. lift review on the 2024 link — it is now backed by the recorded deed ──
  await pool.query(
    `UPDATE land_transfer_events SET
        verification_status='verified', requires_human_review=FALSE, confidence=0.98,
        transfer_date='2024-01-02', instrument_type='deed',
        source_archive=$2,
        source_page='Dutchess County Clerk Doc# 02-2024-50006',
        source_notes='wealth-over-time series: ~$14,000,000 (2024); MODERN successor holder. Recorded deed archived to S3; Red Hook transfer tax $272,100 (2% CPF) corroborates the value. Land value is a VALUATION instrument, never a claimed asset (land-non-claim, migration 125).'
      WHERE transfer_id=$1`, [lte.transfer_id, S3_KEY]);
  console.log(`  ✓ M129 2024→Bard link is now deed-backed + verified (review lifted)`);

  // ── 3. research_findings (migration 128): the deed + the two census discoveries ──
  const rf = async (q, repo, idx, result, hits, st, sid, note) => pool.query(
    `INSERT INTO research_findings (question, repository, index_searched, result, hit_count, subject_table, subject_id, evidence_note, searched_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'claude-evidence-round')`, [q, repo, idx, result, hits, st, sid, note]);

  await rf('Chain of title — who holds the Massena parcel (Barrytown/Red Hook, Dutchess) today?',
    'Dutchess County Clerk (recorded deed, user-supplied PDF)', 'grantee = Bard College; Doc# 02-2024-50006',
    'hit', 1, null, null,
    `Bard College is grantee, recorded 1/2/2024. Red Hook transfer tax $272,100 (2% CPF) corroborates ~$14M. Deed archived S3 (${S3_KEY}). = migration-129 Massena link 12 (2024). Modern institutional successor holding the parcel.`);

  await rf('Did the NY Hyde Park Bards (Samuel Bard) hold enslaved people? (modern-endpoint corroboration)',
    'NESRI / US Federal Census 1800 (Dutchess Co, NY)', 'NESRI enslaver record — Samuel Bard, Dutchess, Census1800',
    'hit', 7, 'unconfirmed_persons', 3579208,
    'Samuel Bard (Hyde Park physician, GRANDFATHER of Bard College founder John Bard) = Dutchess enslaver, 7 enslaved per 1800 census. Primary-source census PAGE still to be pulled (FS/Ancestry, Mini). The 560-page Bard genealogy (IA bardfamilyhistor02lcseil) is SILENT on NY-branch slaveholding — the CENSUS is the source, not the genealogy.');

  await rf('Did the NY Hyde Park Bards (William Bard) hold enslaved people? (modern-endpoint corroboration)',
    'NESRI / US Federal Census 1810 (Dutchess Co, NY)', 'NESRI enslaver record — William Bard, Dutchess, Census1810',
    'hit', 4, 'unconfirmed_persons', 3579211,
    'William Bard (1778-1858, FATHER of Bard College founder John Bard, son of Samuel Bard) = Dutchess enslaver, 4 enslaved per 1810 census. Two-generation census-documented slaveholding directly into the college founder. Census PAGE to be pulled (Mini).');

  console.log(`  ✓ 3 research_findings logged (deed hit + Samuel/William Bard census)`);
  await pool.end();
  console.log('\n=== done ===');
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
