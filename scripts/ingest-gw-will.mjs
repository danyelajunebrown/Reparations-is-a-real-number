#!/usr/bin/env node
/**
 * FLAGSHIP INGEST — George Washington's Last Will & Testament (9 July 1799).
 * Source: Founders Online / National Archives,
 *   https://founders.archives.gov/documents/Washington/06-04-02-0404-0001
 *   (Papers of GW, Retirement Series vol. 4, ed. W.W. Abbot; orig. Fairfax County Will Book H-1).
 *
 * A will is OWNER_CONTENT: the gate does NOT lift on document_type alone — it needs a
 * corroborating owner→enslaved role edge. This will SUPPLIES one: it names "Mulatto man William
 * (calling himself William Lee)", GW's enslaved body-servant, and directs freedom for "all the
 * Slaves which I hold in my own right" (note 2: 124 owned outright of GW's list of 317). So the
 * honest, audit-grade graph is:
 *   GW (enslaver) --owns--> William Lee (enslaved)   [enslaved_owner_relationships]
 *   will PDF in S3, linked to BOTH persons (person_documents.s3_key)
 * → lifts GW.assertable_slaveowner AND William Lee.assertable_enslaved from the SAME primary doc.
 *
 * Idempotent guard: aborts if this ingest already created these canonicals. Transactional.
 */
import 'dotenv/config';
import pg from 'pg';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const PersonService = require('../src/services/PersonService');
const S3StorageAdapter = require('../src/services/document/S3StorageAdapter');
const cfg = require('../config');
import { readFileSync } from 'fs';

const PDF = '/Users/danyelabrown/Downloads/george-washington-will.pdf';
const SRC = 'https://founders.archives.gov/documents/Washington/06-04-02-0404-0001';
const CITE = 'George Washington’s Last Will and Testament, 9 July 1799 (Founders Online, National Archives; Papers of GW, Retirement Series vol. 4; orig. Fairfax County Will Book H-1, 1-23).';
const BY = 'roster_partner_ingest';

// verbatim operative clauses (primary source) — stored as ocr_text to aid retrieval/RAG grounding.
const MANUMISSION = `[George Washington's Will, 9 July 1799 — manumission clause] "Upon the decease of my wife, it is my Will & desire that all the Slaves which I hold in my own right, shall receive their freedom... And I do hereby expressly forbid the Sale, or transportation out of the said Commonwealth, of any Slave I may die possessed of, under any pretence whatsoever." (Editorial note 2: GW's own list enumerated 317 slaves at Mount Vernon — 124 held in his own right and to be freed at Martha's death, 153 dower slaves, 40 leased from Penelope Manley French.)`;
const WILLIAM_LEE = `[George Washington's Will, 9 July 1799 — William Lee clause] "And to my Mulatto man William (calling himself William Lee) I give immediate freedom; or if he should prefer it (on account of the accidents which have befallen him, and which have rendered him incapable of walking or of any active employment) to remain in the situation he now is, it shall be optional in him to do so: In either case however, I allow him an annuity of thirty dollars during his natural life... & this I give him as a testimony of my sense of his attachment to me, and for his faithful services during the Revolutionary War." (Editorial note 3: GW bought "Mulatto Will" in Oct. 1767 for £61.15 from Mary Smith Ball Lee; body servant through the Revolution; d. ~1810.)`;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const client = await pool.connect();
const ps = new PersonService(client);

function parseName(full){ const p=String(full).trim().split(/[\s,]+/).filter(Boolean); return {first:p[0]||'',last:p.length>1?p[p.length-1]:''}; }

async function insertCanonical({name, personType, birth, death, state, county, sex, conf, notes}) {
  const {first,last} = parseName(name);
  const r = await client.query(
    `INSERT INTO canonical_persons
       (canonical_name, first_name, last_name, first_name_soundex, last_name_soundex, last_name_metaphone,
        sex, person_type, birth_year_estimate, death_year_estimate, primary_state, primary_county,
        confidence_score, verification_status, created_by, notes)
     VALUES ($1,$2::text,$3::text, soundex($2::text), soundex($3::text), metaphone($3::text,8),
             $4,$5,$6,$7,$8,$9,$10,'verified',$11,$12)
     RETURNING id`,
    [name, first||null, last||null, sex||null, personType, birth, death, state, county, conf, BY, JSON.stringify(notes)]);
  const id = r.rows[0].id;
  await ps._writeBlockingKeys('canonical_persons', id, { name, sex, birthYear: birth });
  return id;
}

async function insertDoc(canonicalId, {docType, nameAsAppears, s3Url, s3Key, year, ocr}) {
  await client.query(
    `INSERT INTO person_documents
       (canonical_person_id, name_as_appears, document_type, source_url, source_type, s3_url, s3_key,
        evidence_strength, document_year, title, ocr_text, human_verified, verified_by, created_by)
     VALUES ($1,$2,$3,$4,'primary_source',$5,$6,'primary',$7,$8,$9,true,$10,$10)
     ON CONFLICT (COALESCE(canonical_person_id,'-1'::integer), COALESCE(unconfirmed_person_id,'-1'::integer), COALESCE(s3_url,''::text), name_as_appears) DO NOTHING`,
    [canonicalId, nameAsAppears, docType, SRC, s3Url, s3Key, year, CITE, ocr, BY]);
}

async function main() {
  // 0) idempotency guard
  const dup = await client.query(
    `SELECT id, canonical_name FROM canonical_persons
      WHERE created_by=$1 AND ((canonical_name='George Washington' AND birth_year_estimate=1732)
                            OR (canonical_name='William Lee' AND person_type='enslaved' AND primary_county='Fairfax'))`, [BY]);
  if (dup.rows.length) { console.error('ALREADY INGESTED:', JSON.stringify(dup.rows), '\nAbort (idempotency guard).'); client.release(); await pool.end(); process.exit(0); }

  console.log('=== FLAGSHIP INGEST: George Washington will (1799) ===');

  // 1) upload the real PDF to S3 (this is the archived file that anchors the gate)
  const buffer = readFileSync(PDF);
  const s3 = new S3StorageAdapter();
  const up = await s3.uploadFile({ buffer, mimetype: 'application/pdf', originalname: 'george-washington-will.pdf' },
                                 { ownerName: 'George Washington', documentType: 'will' });
  const s3Key = up.s3Key;
  const s3Url = `https://${up.s3Bucket}.s3.${cfg.storage.s3.region}.amazonaws.com/${s3Key}`;
  console.log(`[1] uploaded will PDF (${buffer.length} bytes) → s3://${up.s3Bucket}/${s3Key}`);

  await client.query('BEGIN');
  try {
    // 2) George Washington — enslaver, discrete identity
    const gwId = await insertCanonical({
      name: 'George Washington', personType: 'enslaver', birth: 1732, death: 1799,
      state: 'Virginia', county: 'Fairfax', sex: 'm', conf: 0.99,
      notes: { source: 'founders_online_will_1799', provenance_url: SRC, cite: CITE,
        identity_note: '1st U.S. President; Mount Vernon; held 124 enslaved in his own right (of 317 listed 1799); manumitted his own slaves by this will.' } });
    console.log(`[2] canonical#${gwId} George Washington (enslaver, 1732-1799, Virginia/Fairfax)`);

    // 3) William Lee — enslaved, named in the will
    const leeId = await insertCanonical({
      name: 'William Lee', personType: 'enslaved', birth: 1750, death: 1810,
      state: 'Virginia', county: 'Fairfax', sex: 'm', conf: 0.95,
      notes: { source: 'founders_online_will_1799', provenance_url: SRC, cite: CITE,
        identity_note: '"Mulatto man William (calling himself William Lee)"; GW’s enslaved body servant; purchased Oct 1767 for £61.15 from Mary Smith Ball Lee; freed w/ $30 annuity by GW will; birth ~1750 (est., "young man" at 1767 purchase), d. ~1810 per editorial note 3.' } });
    console.log(`[3] canonical#${leeId} William Lee (enslaved, ~1750-1810, Virginia/Fairfax)`);

    // 4) the will, linked to BOTH persons (same S3 object)
    await insertDoc(gwId,  { docType:'will', nameAsAppears:'George Washington', s3Url, s3Key, year:1799, ocr: MANUMISSION });
    await insertDoc(leeId, { docType:'will', nameAsAppears:'William (calling himself William Lee)', s3Url, s3Key, year:1799, ocr: WILLIAM_LEE });
    console.log('[4] person_documents rows written for both (document_type=will, s3_key set)');

    // 5) ownership edge (the corroborator that lifts an OWNER_CONTENT/ENSLAVED_CONTENT will)
    await client.query(
      `INSERT INTO enslaved_owner_relationships
         (enslaved_canonical_id, enslaved_subject_table, enslaved_subject_id, enslaved_name,
          owner_canonical_id, owner_subject_table, owner_subject_id, owner_name,
          relationship_type, start_year, end_year, relationship_source, source_url, source_context,
          confidence_score, verification_status, verified_by, created_by, created_at, updated_at)
       VALUES ($1,'canonical_persons',$1,$2, $3,'canonical_persons',$3,$4,
               'enslaved_by', 1767, 1799, 'will', $5, $6, 0.98, 'verified', $7, $7, now(), now())`,
      [leeId, 'William Lee', gwId, 'George Washington', SRC,
       'GW will (1799) names "Mulatto man William (calling himself William Lee)"; purchased 1767; freed by this will.', BY]);
    console.log('[5] enslaved_owner_relationships edge: George Washington --owns--> William Lee');

    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }

  // 6) recompute gates
  const gwRow = await client.query(`SELECT id FROM canonical_persons WHERE canonical_name='George Washington' AND birth_year_estimate=1732 AND created_by=$1`, [BY]);
  const leeRow = await client.query(`SELECT id FROM canonical_persons WHERE canonical_name='William Lee' AND person_type='enslaved' AND primary_county='Fairfax' AND created_by=$1`, [BY]);
  const gwId = gwRow.rows[0].id, leeId = leeRow.rows[0].id;
  const gGW = await ps.recomputeGate(gwId);
  const gLee = await ps.recomputeGate(leeId);
  console.log(`\n[6] recomputeGate:`);
  console.log(`    George Washington #${gwId}: assertable_slaveowner=${gGW.assertable_slaveowner} assertable_enslaved=${gGW.assertable_enslaved}`);
  console.log(`    William Lee       #${leeId}: assertable_slaveowner=${gLee.assertable_slaveowner} assertable_enslaved=${gLee.assertable_enslaved}`);

  // 7) VERIFY SERVED
  const exists = await s3.fileExists(s3Key);
  const servedGW = await client.query(`SELECT 1 FROM canonical_persons WHERE id=$1 AND assertable_slaveowner`, [gwId]);
  const servedLee = await client.query(`SELECT 1 FROM canonical_persons WHERE id=$1 AND assertable_enslaved`, [leeId]);
  console.log(`\n[7] VERIFY:`);
  console.log(`    S3 object fetches:                 ${exists?'PASS':'FAIL'}`);
  console.log(`    GW returned by gated public query: ${servedGW.rows.length?'PASS':'FAIL'}  → ${servedGW.rows.length?'T3 SERVED (was a slaveowner)':'gated'}`);
  console.log(`    Lee returned by gated public query:${servedLee.rows.length?'PASS':'FAIL'}  → ${servedLee.rows.length?'T3 SERVED (was enslaved)':'gated'}`);
  console.log(`\n    George Washington = canonical#${gwId} · William Lee = canonical#${leeId}`);

  client.release(); await pool.end();
}
main().catch(async e => { console.error('ERROR:', e.message); try{await client.query('ROLLBACK')}catch{}; try{client.release()}catch{}; try{await pool.end()}catch{}; process.exit(1); });
