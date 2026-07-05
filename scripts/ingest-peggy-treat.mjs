#!/usr/bin/env node
/**
 * Peggy / Malachi Treat / Hamilton-as-trader — from a VERIFIED cash-book page.
 * Source: Alexander Hamilton Cash Book Vol. I (1782-1791), Library of Congress, FOLIO 20,
 *   "Malachi Treat" account (1784): "To a negro wench Peggy sold him — £90." (Serfilippi 2020, fn.16-17.)
 * Visually read + confirmed before ingest.
 *
 * One document, three roles — attributed precisely:
 *   PEGGY   — named enslaved woman (served as enslaved; owner = Treat).
 *   MALACHI TREAT — BUYER/owner (served as slaveowner via the bill of sale — OWNER_NAMED, one-step).
 *   ALEXANDER HAMILTON — SELLER/trader (the doc is his ledger; records his trader role, not ownership).
 * The bill of sale is BOTH OWNER_NAMED (serves Treat) and ENSLAVED_CONTENT (serves Peggy with the edge).
 */
import 'dotenv/config';
import pg from 'pg';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const PersonService = require('../src/services/PersonService');
const S3StorageAdapter = require('../src/services/document/S3StorageAdapter');
const cfg = require('../config');
import { readFileSync } from 'fs';
import crypto from 'crypto';

const IMG = process.argv[2];
const HAMILTON = 828192;
const PEGGY_LEAD = 2806738;
const BY = 'roster_partner_ingest';
const IIIF = 'https://tile.loc.gov/image-services/iiif/service:mss:mss24612:mss24612-029:00416/full/pct:100/0/default.jpg';
const CITE = "Alexander Hamilton Cash Book Vol. I (1782-1791), Library of Congress, folio 20, 'Malachi Treat' account. Identified via Jessie Serfilippi, Schuyler Mansion State Historic Site, 2020, fn.16-17.";
const OCR = `[Alexander Hamilton Cash Book Vol. I (1782-1791), Library of Congress, folio 20 — "Malachi Treat" account, 1784] "To a negro wench Peggy sold him — £90." Credit (1785): "By his account for care and medicines of the wench 10; By this sum received of [Mr] Lowe 70." Alexander Hamilton SOLD an enslaved woman named PEGGY to Dr. MALACHI TREAT for £90 (1784); Hamilton had bought her at Treat's direction and held her (£10 for her medicine) until Treat could pay — establishing Hamilton as a slave TRADER. Buyer/owner: Malachi Treat.`;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const client = await pool.connect();
const ps = new PersonService(client);
const parseName = (f) => { const p = String(f).trim().split(/\s+/); return { first: p[0]||'', last: p.length>1?p[p.length-1]:'' }; };

async function mkCanonical({ name, personType, birth, death, state, county, sex, conf, notes }) {
  const { first, last } = parseName(name);
  const r = await client.query(
    `INSERT INTO canonical_persons
       (canonical_name, first_name, last_name, first_name_soundex, last_name_soundex, last_name_metaphone,
        sex, person_type, birth_year_estimate, death_year_estimate, primary_state, primary_county,
        confidence_score, verification_status, created_by, notes)
     VALUES ($1,$2::text,$3::text, soundex($2::text), soundex($3::text), metaphone($3::text,8),
             $4,$5,$6,$7,$8,$9,$10,'verified',$11,$12) RETURNING id`,
    [name, first||null, last||null, sex||null, personType, birth, death, state, county, conf, BY, JSON.stringify(notes)]);
  const id = r.rows[0].id;
  await ps._writeBlockingKeys('canonical_persons', id, { name, sex, birthYear: birth });
  return id;
}
async function attachDoc(cid, nameAsAppears, docType, s3Url, s3Key) {
  const d = await client.query(
    `INSERT INTO person_documents
       (canonical_person_id, name_as_appears, document_type, source_url, source_type, s3_url, s3_key,
        evidence_strength, document_year, title, ocr_text, human_verified, verified_by, created_by)
     VALUES ($1,$2,$3,$4,'primary_source',$5,$6,'primary',1784,$7,$8,true,$9,$9)
     ON CONFLICT (COALESCE(canonical_person_id,'-1'::integer), COALESCE(unconfirmed_person_id,'-1'::integer), COALESCE(s3_url,''::text), name_as_appears) DO NOTHING
     RETURNING id`,
    [cid, nameAsAppears, docType, IIIF, s3Url, s3Key, CITE, OCR, BY]);
  return d.rows[0]?.id;
}

async function main() {
  const dup = await client.query(`SELECT id FROM canonical_persons WHERE created_by=$1 AND canonical_name='Malachi Treat'`, [BY]);
  if (dup.rows.length) { console.error('ALREADY INGESTED (Malachi Treat). Abort.'); client.release(); await pool.end(); process.exit(0); }

  // 1) upload the verified page to S3
  const buffer = readFileSync(IMG);
  const s3 = new S3StorageAdapter();
  const up = await s3.uploadFile({ buffer, mimetype: 'image/jpeg', originalname: 'hamilton-cashbook-vol1-folio20-peggy.jpg' }, { ownerName: 'Malachi Treat', documentType: 'bill_of_sale' });
  const s3Url = `https://${up.s3Bucket}.s3.${cfg.storage.s3.region}.amazonaws.com/${up.s3Key}`;
  console.log(`[1] uploaded folio 20 → ${up.s3Key}`);

  await client.query('BEGIN');
  let peggyId, treatId;
  try {
    // 2) Peggy — enslaved, promoted from lead #2806738 to a discrete canonical
    peggyId = await mkCanonical({ name: 'Peggy', personType: 'enslaved', birth: null, death: null,
      state: 'New York', county: null, sex: 'f', conf: 0.95,
      notes: { source: 'hamilton_cashbook_vol1_folio20', cite: CITE,
        identity_note: 'Enslaved woman ("a negro wench Peggy") whom Alexander Hamilton bought at Dr. Malachi Treat\'s direction and SOLD to Treat for £90 (1784). Owner: Malachi Treat; sold by A. Hamilton (trader).' } });
    await client.query(`UPDATE unconfirmed_persons SET status='promoted', reviewed_by=$2, review_notes=COALESCE(review_notes,'')||$3 WHERE lead_id=$1`,
      [PEGGY_LEAD, BY, ` [promoted→canonical#${peggyId} via cashbook folio 20]`]).catch(()=>{});
    await client.query(`DELETE FROM person_blocking_keys WHERE subject_table='unconfirmed_persons' AND subject_id=$1`, [PEGGY_LEAD]).catch(()=>{});
    console.log(`[2] canonical#${peggyId} Peggy (enslaved) — promoted from lead #${PEGGY_LEAD}`);

    // 3) Malachi Treat — enslaver (buyer)
    treatId = await mkCanonical({ name: 'Malachi Treat', personType: 'enslaver', birth: null, death: null,
      state: 'New York', county: null, sex: 'm', conf: 0.95,
      notes: { source: 'hamilton_cashbook_vol1_folio20', cite: CITE,
        identity_note: 'Physician (Physician & Surgeon General, Revolutionary War); BOUGHT the enslaved woman Peggy from Alexander Hamilton for £90 (1784).' } });
    console.log(`[3] canonical#${treatId} Malachi Treat (enslaver, buyer)`);

    // 4) attach the bill-of-sale page to all three (Peggy=enslaved, Treat=owner, Hamilton=seller/trader)
    await attachDoc(peggyId, 'Peggy', 'bill_of_sale', s3Url, up.s3Key);
    await attachDoc(treatId, 'Malachi Treat', 'bill_of_sale', s3Url, up.s3Key);
    await attachDoc(HAMILTON, 'Alexander Hamilton (seller)', 'bill_of_sale', s3Url, up.s3Key);
    console.log('[4] bill_of_sale attached → Peggy (enslaved) + Treat (owner) + Hamilton (seller/trader)');

    // 5) ownership edge: owner = Treat, enslaved = Peggy (NOT Hamilton — he sold her)
    await client.query(
      `INSERT INTO enslaved_owner_relationships
         (enslaved_canonical_id, enslaved_subject_table, enslaved_subject_id, enslaved_name,
          owner_canonical_id, owner_subject_table, owner_subject_id, owner_name,
          relationship_type, start_year, relationship_source, source_url, source_context,
          confidence_score, verification_status, verified_by, created_by, created_at, updated_at)
       VALUES ($1,'canonical_persons',$1,'Peggy',$2,'canonical_persons',$2,'Malachi Treat',
               'enslaved_by',1784,'bill_of_sale',$3,$4,0.98,'verified',$5,$5,now(),now())`,
      [peggyId, treatId, IIIF, 'Hamilton sold "a negro wench Peggy" to Dr. Malachi Treat for £90 (1784); Treat = buyer/owner, Hamilton = seller/trader.', BY]);
    console.log('[5] edge: Malachi Treat --owns--> Peggy (Hamilton = seller, recorded on the doc)');
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }

  // 6) gates
  const gP = await ps.recomputeGate(peggyId);
  const gT = await ps.recomputeGate(treatId);
  const gH = await ps.recomputeGate(HAMILTON);
  console.log(`\n[6] gates:`);
  console.log(`    Peggy #${peggyId}: assertable_enslaved=${gP.assertable_enslaved}`);
  console.log(`    Malachi Treat #${treatId}: assertable_slaveowner=${gT.assertable_slaveowner}`);
  console.log(`    Alexander Hamilton #${HAMILTON}: assertable_slaveowner=${gH.assertable_slaveowner} (unchanged; trader role added)`);

  // 7) embed for RAG
  try {
    const OLL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/embeddings';
    const doc = await client.query(`SELECT id FROM person_documents WHERE canonical_person_id=$1 AND document_type='bill_of_sale' LIMIT 1`, [peggyId]);
    const resp = await fetch(OLL, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ model:'nomic-embed-text', prompt: OCR.slice(0,6000) }) });
    const v = (await resp.json()).embedding;
    if (Array.isArray(v) && v.length===768 && doc.rows[0]) {
      await client.query(`INSERT INTO embeddings (subject_table,subject_id,content_kind,model,embedding,content_hash)
        VALUES ('person_documents',$1,'doc_ocr','nomic-embed-text',$2::vector,$3) ON CONFLICT DO NOTHING`,
        [String(doc.rows[0].id), '['+v.join(',')+']', crypto.createHash('sha256').update(OCR).digest('hex')]);
      console.log('[7] embedded for RAG');
    }
  } catch (e) { console.log('[7] embed skipped:', e.message); }

  console.log(`\n    Peggy=#${peggyId} (enslaved, served) · Malachi Treat=#${treatId} (enslaver, served) · Hamilton trader role documented`);
  client.release(); await pool.end();
}
main().catch(async e => { console.error('ERROR:', e.message); try{await client.query('ROLLBACK')}catch{}; try{client.release()}catch{}; try{await pool.end()}catch{}; process.exit(1); });
