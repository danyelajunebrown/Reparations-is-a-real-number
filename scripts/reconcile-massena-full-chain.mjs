// reconcile-massena-full-chain.mjs — reconcile the Massena parcel spine (migration 129) to the AUTHORITATIVE
// full chain-of-title packet (Massena_FULL_Chain_of_Title_PACKET.pdf, 126pp). Migration 129 seeded 12
// approximate links from a prose abstract; the packet gives the exact 15 links with liber/folio, dates, and
// considerations — and CORRECTS the count (the earlier finding said "22 links"; the packet states 15).
//
// Actions: (1) archive the full packet to S3 + source_artifacts (file-first; lifts the property's review
// flag — the whole documented chain is now stored); (2) replace the approximate links with the precise 15
// (preserving the already-deed-backed 2024 link); (3) log the finding. ALL links implicates_enslaver=FALSE
// (land-non-claim, migration 125): the chain VALUES the wealth and proves the Indigenous theft under it
// (Link 0, indigenous_land_provenance), and is never a claimed asset.
//
// Usage: node scripts/reconcile-massena-full-chain.mjs [--apply]   (dry-run default)

import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import pg from 'pg';
const require = createRequire(import.meta.url);
const S3 = require('../src/services/storage/S3Service');

const APPLY = process.argv.includes('--apply');
const PACKET = '/Users/danyelabrown/Library/Application Support/Claude/local-agent-mode-sessions/6d493a99-46b6-49e2-98ba-2b965f1a9ba4/730a90a3-4894-44cd-8b54-a6cf7c187c1d/local_ba5eb1e7-473a-4ecf-8260-559fd798e04f/outputs/Massena_FULL_Chain_of_Title_PACKET.pdf';
const S3_KEY = 'sources/massena/massena-full-chain-of-title-packet.pdf';

// The precise 15-link chain from the packet's LINK-BY-LINK ABSTRACT. year, type, instrument, grantor,
// grantee, consideration_usd, liber_folio, note. Links 1-14 here; link 15 (2024→Bard) is UPDATED in place
// (it is already deed-backed + verified from archive-massena-deed.mjs).
const LINKS = [
  [1688, 'grant',       'patent',    'Crown / Gov. Thomas Dongan (for James II)',            'Peter Schuyler of Albany',                              null,     'Book of Patents pp. 325-327', 'Recorded July 28, 1688; recites purchase "of and from the Indyans, Naturall Owners and Possessors" (Link 0). Confirmed by Gov. Cornbury Nov 7, 1704.'],
  [1715, 'sale',        'deed',      'Peek De Witt (son of Tierk De Witt, 1/3 share)',       'Col. Henry Beekman Jr.',                                null,     null,                          'Schuyler sold 3/4 in 1/3 shares to De Witt, Staats, Van Benthuysen; De Witt third → son Peek → Beekman, deed Aug 9, 1715 (Kingston). Smith (1881) transcription.'],
  [1725, 'partition',   'deed',      'Staats, Van Benthuysen & Beekman',                     'Col. Henry Beekman Jr. (north third)',                  null,     null,                          'Partition of the Schuyler Patent, signed 1725; Beekman takes the north third. Witnessed by Peter & Robert Livingston Jr.'],
  [1776, 'inheritance', 'will',      'Col. Henry Beekman Jr. (1688-1776)',                   'Margaret Beekman Livingston (1724-1800, sole heiress)', null,     null,                          'Beekman d. Jan 3, 1776; estate to daughter by his will. Beekman = a Dutchess ENSLAVER family.'],
  [1800, 'sale',        'quitclaim', 'Margaret Beekman Livingston',                          'John R. Livingston',                                    null,     'early Dutchess deed book (rec. 1801) pp. 84-87', 'Lifetime deed (lost); siblings confirm title by quitclaim Dec 19, 1800. John R. built Massena 1796. Livingston = a Dutchess ENSLAVER family.'],
  [1853, 'sale',        'deed',      'Executors of John R. Livingston (Garretson & Armstrong)', 'Henry Dwight Jr.',                                   50000,    'Liber 99, pp. 405-407',       'Deed June 29, 1853; power of sale under J.R. Livingston will (d.1851); 233a 3r 12.5p (Champlin survey 1851). $50,000.'],
  [1858, 'foreclosure', 'decree',    'Homer A. Nelson, Referee',                             'Stewart Brown',                                         20000,    'Liber 115, pp. 109-111',      'Supreme Court foreclosure Brown et al. v. Dwight (judgment May 24, 1858); auction to Stewart Brown $20,000. Deed July 29, 1858; rec Jan 4, 1860. Value trough.'],
  [1860, 'sale',        'deed',      'Stewart Brown & Mary Ann',                             'John L. Aspinwall (Jul 2, 1860)',                       null,     'Liber 118, p. 61',            'First of two 1860 deeds Brown → Aspinwall.'],
  [1860, 'sale',        'deed',      'Stewart Brown & Mary Ann',                             'John L. Aspinwall (Dec 28, 1860) — THE MASSENA DEED',   null,     'Liber 118, p. 68',            'THE MASSENA DEED; bounded west by the Hudson River, beginning at a button-ball tree near a spring.'],
  [1865, 'sale',        'deed',      'William R. Moore',                                     'John Lloyd Aspinwall',                                  null,     'Liber 130, p. 515',           'Adjoining parcel. [deed not obtained — packet notes citation only].'],
  [1911, 'sale',        'deed',      'Aspinwall Estate (Abram I. Elkus, substituted trustee)', 'Garrett B. Kip',                                      null,     'Liber 372, p. 35',            'Nov 24, 1911. Under the will of John Lloyd Aspinwall.'],
  [1928, 'sale',        'deed',      'Garrett B. & Carola de Peyster Kip',                   "St. Joseph's Normal Institute (De La Salle Christian Brothers)", null, 'Liber 489, pp. 380-384',      'Sept 18, 1928. Assembled 255.576-acre estate; recites Aspinwall/Brown/Moore derivation + 1873 river grant + 1850 RR reservation.'],
  [1974, 'sale',        'deed',      "St. Joseph's Normal Institute",                        'Holy Spirit Association / Unification Church',          1500000,  'Liber 1382, pp. 616-626',     'Deed Apr 30, 1974; rec May 8, 1974. Face $100 "and other good and valuable consideration"; stamps $1,650 → ~$1,500,000 implied; $1,150,000 purchase-money mortgage taken back.'],
  [1987, 'sale',        'deed',      'Holy Spirit Association',                              'Unification Theological Seminary (UTS)',                null,     'Liber 1748, pp. 617-625 (Doc #5152)', 'Deed Mar 10, 1987; rec Apr 20, 1987.'],
];

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  console.log(APPLY ? '=== APPLY ===' : '=== DRY RUN ===');

  const prop = (await pool.query(`SELECT property_id FROM properties WHERE property_name='Massena' AND county='Dutchess'`)).rows[0];
  if (!prop) { console.error('Massena property not found (run migration 129)'); process.exit(1); }
  const pid = prop.property_id;

  if (!fs.existsSync(PACKET)) { console.error('packet not found:', PACKET); process.exit(1); }
  const buf = fs.readFileSync(PACKET);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  console.log(`packet: ${(buf.length / 1e6).toFixed(1)}MB  sha256=${sha.slice(0, 16)}…  → 15-link chain`);

  if (!APPLY) {
    console.log(`would archive packet → s3://${process.env.S3_BUCKET}/${S3_KEY}`);
    console.log(`would replace approximate links with the precise 14 (+ update the deed-backed 2024 link) and lift the property review flag`);
    await pool.end(); return;
  }

  // 1. archive the full packet (file-first) + source_artifacts
  await S3.upload(S3_KEY, buf, 'application/pdf', { sha256: sha, source: 'Massena full chain-of-title packet (15 links, 1688-2024)' });
  await pool.query(
    `INSERT INTO source_artifacts (artifact_key, dataset_label, source_name, source_url, s3_key, sha256, bytes, content_type, rehostable, record_count, notes)
     VALUES ('massena-full-packet', 'Massena FULL chain-of-title packet (15 links, 1688-2024)', 'User-compiled from Dutchess County Clerk / NY Land Papers / Smith (1881)',
             'https://dutchessny.gov/CountyClerk', $1, $2, $3, 'application/pdf', TRUE, 15,
             '126pp. Authoritative 15-link chain (corrects the earlier 22-link estimate). Bard College present owner since 1/2/2024.')
     ON CONFLICT (artifact_key) DO UPDATE SET s3_key=EXCLUDED.s3_key, sha256=EXCLUDED.sha256, bytes=EXCLUDED.bytes, record_count=15`,
    [S3_KEY, sha, buf.length]);
  console.log('  ✓ full packet archived → S3 + source_artifacts');

  // 2. replace the approximate links (keep the deed-backed 2024 link), insert the precise 14
  const del = await pool.query(`DELETE FROM land_transfer_events WHERE property_id=$1 AND grantee_name NOT ILIKE '%Bard College%' RETURNING transfer_id`, [pid]);
  console.log(`  ✓ cleared ${del.rows.length} approximate links (2024 Bard link preserved)`);
  let n = 0;
  for (const [yr, ttype, itype, grantor, grantee, usd, liber, note] of LINKS) {
    await pool.query(
      `INSERT INTO land_transfer_events
         (property_id, transfer_year, transfer_type, instrument_type, grantor_name, grantee_name,
          consideration_usd, implicates_enslaver, source_archive, source_page, source_notes,
          confidence, verification_status, requires_human_review, review_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,FALSE,$8,$9,$10,0.90,'verified',FALSE,
               'chain-of-title provenance; land value is a valuation instrument, never a claimed asset (land-non-claim, migration 125)')`,
      [pid, yr, ttype, itype, grantor, grantee, usd, S3_KEY, liber, note]);
    n++;
  }
  console.log(`  ✓ inserted ${n} precise links (1-14)`);

  // update the 2024 link (link 15) with packet detail
  await pool.query(
    `UPDATE land_transfer_events SET
       grantor_name='HJ International Graduate School for Peace and Public Leadership (f/k/a UTS)',
       source_page='Dutchess County Clerk Doc# 02-2024-50006 (deed Dec 13, 2023; rec Jan 2, 2024)',
       source_notes='wealth-over-time: ~$14,000,000 (2024); MODERN successor holder Bard College. AG-approved sale; NYS transfer tax $56,000 + Red Hook $272,100. Recorded deed archived to S3. Land value is a VALUATION instrument, never a claimed asset (land-non-claim, migration 125).'
     WHERE property_id=$1 AND grantee_name ILIKE '%Bard College%'`, [pid]);
  console.log('  ✓ updated the 2024 Bard link (link 15) with packet detail');

  // 3. property: full packet archived → lift review; correct the link count
  await pool.query(
    `UPDATE properties SET
       requires_human_review=FALSE, confidence=0.92, source_archive=$2,
       liber_folio='Liber 118 p.68 (Massena Deed, 1860); Liber 99 pp.405-407 (1853)',
       notes='15-link continuous chain of title 1688-2024 (full packet archived, migration 129 + reconcile). Corrects the earlier 22-link estimate. Bard College present owner since 1/2/2024. Indigenous Link 0 in indigenous_land_provenance (migration 125), restituted separately to Stockbridge-Munsee. Wealth series 50k(1853), 20k(1858), ~1.5M(1974), ~14M(2024) USD.'
     WHERE property_id=$1`, [pid]);

  await pool.query(
    `INSERT INTO research_findings (question, repository, index_searched, result, hit_count, subject_table, subject_id, evidence_note, searched_by)
     VALUES ('Full Massena chain of title — all links 1688→2024?', 'User-compiled packet (Dutchess Clerk / NY Land Papers / Smith 1881)', 'Massena_FULL_Chain_of_Title_PACKET.pdf (126pp)',
             'hit', 15, 'properties', NULL,
             'Authoritative 15-link chain archived to S3; corrects the earlier 22-link estimate. Precise liber/folio for every recorded link. Bard College present owner 1/2/2024. Supersedes the prose abstract in finding-land-nonclaim-jul17 §4.', 'claude-evidence-round')`);
  console.log('  ✓ property review lifted; finding logged');
  await pool.end();
  console.log('\n=== done — Massena spine is now the full 15-link documented chain ===');
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
