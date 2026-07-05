#!/usr/bin/env node
/**
 * FLAGSHIP INGEST #2 — Thomas Jefferson's Will (16 Mar 1826) + Codicil (17 Mar 1826).
 * Source images: Albert & Shirley Small Special Collections Library, University of Virginia
 *   (user-provided page scans will1..will5.jpg). Proved: Albemarle County Court, 7 Aug 1826.
 *
 * The CODICIL (page 5, will1.jpg) is the manumission instrument — it names five enslaved men and
 * directs their freedom. So the audit-grade graph mirrors the Washington flagship:
 *   Thomas Jefferson (enslaver) --owns--> {Burwell Colbert, John Hemings, Joe Fossett,
 *                                          Madison Hemings, Eston Hemings} (enslaved)
 *   5 will/codicil page images in S3, linked to Jefferson (collection) + the manumission page
 *   linked to each freed man → lifts Jefferson.assertable_slaveowner AND each man's
 *   assertable_enslaved from the SAME primary document. Then embed OCR for RAG retrieval.
 *
 * Birth/death years for the enslaved are from the scholarly record (Monticello "Getting Word")
 * and stored in the *_estimate columns with a provenance note — the DOCUMENT establishes the
 * manumission; the dates aid identity disambiguation. NO fabrication; every row carries provenance.
 * Idempotent + transactional.
 */
import 'dotenv/config';
import pg from 'pg';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const PersonService = require('../src/services/PersonService');
const S3StorageAdapter = require('../src/services/document/S3StorageAdapter');
const cfg = require('../config');
import { readFileSync } from 'fs';

const DIR = '/Users/danyelabrown/Downloads/';
const SRC = 'https://small.library.virginia.edu/collections/featured/the-thomas-jefferson-papers/bibliography-of-sources-on-jefferson-and-the-hemings-family/will-and-codicil-jefferson/';
const CITE = "Thomas Jefferson's Will (16 Mar 1826) & Codicil (17 Mar 1826), Albert & Shirley Small Special Collections Library, University of Virginia; proved Albemarle County Court, 7 Aug 1826.";
const BY = 'roster_partner_ingest';
const COLL = 'jefferson-will-codicil-1826-uva';

// ordered pages (page 5 = codicil p2 = manumission)
const PAGES = [
  { file: 'will3.jpg', page: 1, label: 'Will, page 1 (16 Mar 1826) — devises to Francis Eppes & Thomas Jefferson Randolph', ocr: 'Thomas Jefferson Will, page 1 (16 March 1826). "I Thomas Jefferson of Monticello in Albemarle, being of sound mind... make my last will and testament..." Devises the Poplar Forest lands to grandson Francis Eppes and the residue in trust for daughter Martha Randolph.' },
  { file: 'will4.jpg', page: 2, label: 'Will, page 2 — trust for Martha Randolph; TJ Randolph sole executor; revokes former wills; 16 Mar 1826', ocr: 'Thomas Jefferson Will, page 2. Estate held in trust for daughter Martha Randolph; "I appoint my grandson Thomas Jefferson Randolph my sole executor..."; "Lastly I revoke all former wills by me heretofore made... this 16th day of March one thousand eight hundred and twenty six. Th: Jefferson."' },
  { file: 'will5.jpg', page: 3, label: 'Will endorsement / probate — Albemarle County Court, 7 Aug 1826 (proved, Alex Garrett CC)', ocr: 'Endorsement: "My Will. Th: Jefferson." "At a Court held for Albemarle county the 7th of August 1826. This Instrument of writing purporting to be the last will and testament of Thomas Jefferson Dec\'d was produced into court and the handwriting of the testator proved by the oath of Valentine W. Southall and ordered to be recorded. Teste, Alex Garrett CC."' },
  { file: 'will2.jpg', page: 4, label: 'Codicil, page 1 (17 Mar 1826) — bequests to Martha Randolph, James Madison, University of Virginia', ocr: 'Thomas Jefferson Codicil, page 1 (17 March 1826). "I Thomas Jefferson of Monticello in Albemarle make and add the following Codicil to my will..." Gold-mounted walking staff to James Madison; his library to the University of Virginia.' },
  { file: 'will1.jpg', page: 5, label: 'Codicil, page 2 — MANUMISSION of Burwell, John Hemings, Joe Fossett, Madison & Eston Hemings; 17 Mar 1826',
    ocr: 'Thomas Jefferson Codicil, page 2 (17 March 1826) — manumission clauses: "I give to my good, affectionate, and faithful servant Burwell his freedom, and the sum of three hundred Dollars to buy necessaries to commence his trade of painter and glazier, or to use otherwise as he pleases. I give also to my good servants John Hemings and Joe Fosset their freedom at the end of one year after my death; and to each of them respectively all the tools of their respective shops or callings: and it is my will that a comfortable log-house be built for each of the three servants so emancipated, on some part of my lands convenient to them... of which houses I give the use of one, with a curtilage of an acre to each, during his life or personal occupation thereof. I give also to John Hemings the service of his two apprentices, Madison and Eston Hemings, until their respective ages of twenty one years, at which period respectively, I give them their freedom. and I humbly and earnestly request of the legislature of Virginia a confirmation of the bequest of freedom to these servants, with permission to remain in this state where their families and connections are... In testimony that this is a Codicil to my will of yesterday\'s date... this 17th day of March one thousand eight hundred and twenty six. Th: Jefferson."' },
];
const MANUMISSION_PAGE = 'will1.jpg'; // page 5 — the freed men attach here

const ENSLAVED = [
  { name: 'Burwell Colbert', b: 1783, d: null, appears: 'Burwell', end: 1826,
    clause: 'Jefferson codicil (17 Mar 1826): "I give to my good, affectionate, and faithful servant Burwell his freedom, and the sum of three hundred Dollars to buy necessaries to commence his trade of painter and glazier..." (Burwell Colbert, Monticello butler & painter.)',
    note: 'Freed immediately + $300 by TJ codicil; Monticello butler/painter; b.1783 per Monticello Getting Word (death after 1862, uncertain).' },
  { name: 'John Hemings', b: 1776, d: null, appears: 'John Hemings', end: 1827,
    clause: 'Jefferson codicil (17 Mar 1826): "I give also to my good servants John Hemings and Joe Fosset their freedom at the end of one year after my death; and to each of them respectively all the tools of their respective shops..." (John Hemings, master joiner.)',
    note: 'Freed one year after TJ death (i.e. 1827) + tools + log-house; master joiner; b.1776 per Monticello Getting Word.' },
  { name: 'Joe Fossett', b: 1780, d: 1858, appears: 'Joe Fosset', end: 1827,
    clause: 'Jefferson codicil (17 Mar 1826): "I give also to my good servants John Hemings and Joe Fosset their freedom at the end of one year after my death; and to each of them respectively all the tools of their respective shops..." (Joseph Fossett, blacksmith.)',
    note: 'Freed one year after TJ death (1827) + tools; blacksmith; b.1780, d.1858 (Cincinnati) per Monticello Getting Word.' },
  { name: 'Madison Hemings', b: 1805, d: 1877, appears: 'Madison Hemings', end: 1826,
    clause: 'Jefferson codicil (17 Mar 1826): "I give also to John Hemings the service of his two apprentices, Madison and Eston Hemings, until their respective ages of twenty one years, at which period respectively, I give them their freedom." (Madison Hemings, son of Sally Hemings.)',
    note: 'Apprenticed to John Hemings until age 21 then freed; son of Sally Hemings; b.1805, d.1877 per Monticello Getting Word.' },
  { name: 'Eston Hemings', b: 1808, d: 1856, appears: 'Eston Hemings', end: 1829,
    clause: 'Jefferson codicil (17 Mar 1826): "I give also to John Hemings the service of his two apprentices, Madison and Eston Hemings, until their respective ages of twenty one years, at which period respectively, I give them their freedom." (Eston Hemings, son of Sally Hemings.)',
    note: 'Apprenticed to John Hemings until age 21 (1829) then freed; son of Sally Hemings; b.1808, d.1856 per Monticello Getting Word.' },
];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const client = await pool.connect();
const ps = new PersonService(client);
const parseName = (full) => { const p = String(full).trim().split(/\s+/); return { first: p[0] || '', last: p.length > 1 ? p[p.length-1] : '' }; };

async function insertCanonical({ name, personType, birth, death, state, county, sex, conf, notes }) {
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
async function insertDoc(canonicalId, { nameAsAppears, s3Url, s3Key, ocr, page, pageCount }) {
  await client.query(
    `INSERT INTO person_documents
       (canonical_person_id, name_as_appears, document_type, source_url, source_type, s3_url, s3_key,
        evidence_strength, document_year, title, ocr_text, collection_key, collection_name,
        collection_page_number, collection_page_count, human_verified, verified_by, created_by)
     VALUES ($1,$2,'will',$3,'primary_source',$4,$5,'primary',1826,$6,$7,$8,$9,$10,$11,true,$12,$12)
     ON CONFLICT (COALESCE(canonical_person_id,'-1'::integer), COALESCE(unconfirmed_person_id,'-1'::integer), COALESCE(s3_url,''::text), name_as_appears) DO NOTHING`,
    [canonicalId, nameAsAppears, SRC, s3Url, s3Key, CITE, ocr, COLL, 'Jefferson Will & Codicil (1826), UVA', page, pageCount, BY]);
}

async function main() {
  const dup = await client.query(`SELECT id FROM canonical_persons WHERE created_by=$1 AND canonical_name='Thomas Jefferson' AND birth_year_estimate=1743`, [BY]);
  if (dup.rows.length) { console.error('ALREADY INGESTED (Thomas Jefferson). Abort.'); client.release(); await pool.end(); process.exit(0); }

  console.log('=== FLAGSHIP INGEST #2: Thomas Jefferson will+codicil (1826) ===');

  // 1) upload the 5 page images to S3
  const s3 = new S3StorageAdapter();
  const region = cfg.storage.s3.region;
  const keyByFile = {};
  for (const pg of PAGES) {
    const buffer = readFileSync(DIR + pg.file);
    const up = await s3.uploadFile({ buffer, mimetype: 'image/jpeg', originalname: pg.file }, { ownerName: 'Thomas Jefferson', documentType: 'will' });
    keyByFile[pg.file] = { key: up.s3Key, url: `https://${up.s3Bucket}.s3.${region}.amazonaws.com/${up.s3Key}`, bucket: up.s3Bucket };
    console.log(`[1] uploaded ${pg.file} (p${pg.page}) → ${up.s3Key}`);
  }
  const manuKey = keyByFile[MANUMISSION_PAGE];

  await client.query('BEGIN');
  let jtId, enslavedIds = [];
  try {
    // 2) Thomas Jefferson — enslaver
    jtId = await insertCanonical({ name: 'Thomas Jefferson', personType: 'enslaver', birth: 1743, death: 1826,
      state: 'Virginia', county: 'Albemarle', sex: 'm', conf: 0.99,
      notes: { source: 'uva_will_codicil_1826', provenance_url: SRC, cite: CITE,
        identity_note: '3rd U.S. President; Monticello; his 1826 codicil freed five enslaved men (Burwell Colbert, John Hemings, Joe Fossett, Madison & Eston Hemings).' } });
    console.log(`[2] canonical#${jtId} Thomas Jefferson (enslaver, 1743-1826, Virginia/Albemarle)`);

    // 3) five freed men — enslaved
    for (const e of ENSLAVED) {
      const id = await insertCanonical({ name: e.name, personType: 'enslaved', birth: e.b, death: e.d,
        state: 'Virginia', county: 'Albemarle', sex: 'm', conf: 0.95,
        notes: { source: 'uva_will_codicil_1826', provenance_url: SRC, cite: CITE, identity_note: e.note } });
      enslavedIds.push({ id, e });
      console.log(`[3] canonical#${id} ${e.name} (enslaved, ${e.b||'?'}-${e.d||'?'})`);
    }

    // 4) Jefferson gets all 5 pages as a collection
    for (const pg of PAGES) {
      const k = keyByFile[pg.file];
      await insertDoc(jtId, { nameAsAppears: 'Thomas Jefferson', s3Url: k.url, s3Key: k.key, ocr: pg.ocr, page: pg.page, pageCount: PAGES.length });
    }
    // each freed man gets the manumission page (page 5) with his verbatim clause
    for (const { id, e } of enslavedIds) {
      await insertDoc(id, { nameAsAppears: e.appears, s3Url: manuKey.url, s3Key: manuKey.key, ocr: e.clause, page: 5, pageCount: PAGES.length });
    }
    console.log(`[4] person_documents: 5 pages -> Jefferson + manumission page -> each of ${enslavedIds.length} freed men`);

    // 5) ownership edges
    for (const { id, e } of enslavedIds) {
      await client.query(
        `INSERT INTO enslaved_owner_relationships
           (enslaved_canonical_id, enslaved_subject_table, enslaved_subject_id, enslaved_name,
            owner_canonical_id, owner_subject_table, owner_subject_id, owner_name,
            relationship_type, end_year, relationship_source, source_url, source_context,
            confidence_score, verification_status, verified_by, created_by, created_at, updated_at)
         VALUES ($1,'canonical_persons',$1,$2,$3,'canonical_persons',$3,'Thomas Jefferson',
                 'enslaved_by',$4,'will',$5,$6,0.98,'verified',$7,$7,now(),now())`,
        [id, e.name, jtId, e.end, SRC, e.clause.slice(0, 400), BY]);
    }
    console.log(`[5] ${enslavedIds.length} ownership edges: Thomas Jefferson --owns--> each freed man`);
    await client.query('COMMIT');
  } catch (err) { await client.query('ROLLBACK'); throw err; }

  // 6) recompute gates
  const gJT = await ps.recomputeGate(jtId);
  console.log(`\n[6] recomputeGate:`);
  console.log(`    Thomas Jefferson #${jtId}: slaveowner=${gJT.assertable_slaveowner} enslaved=${gJT.assertable_enslaved}`);
  for (const { id, e } of enslavedIds) {
    const g = await ps.recomputeGate(id);
    console.log(`    ${e.name} #${id}: slaveowner=${g.assertable_slaveowner} enslaved=${g.assertable_enslaved}`);
  }

  // 7) verify served
  const exists = await s3.fileExists(manuKey.key);
  const servedJT = await client.query(`SELECT 1 FROM canonical_persons WHERE id=$1 AND assertable_slaveowner`, [jtId]);
  console.log(`\n[7] VERIFY: S3 manumission page fetches=${exists?'PASS':'FAIL'} | Jefferson served=${servedJT.rows.length?'T3 SERVED':'gated'}`);
  for (const { id, e } of enslavedIds) {
    const s = await client.query(`SELECT 1 FROM canonical_persons WHERE id=$1 AND assertable_enslaved`, [id]);
    console.log(`    ${e.name} #${id}: ${s.rows.length?'T3 SERVED (was enslaved)':'gated'}`);
  }

  // 8) embed OCR into the vector store (nomic-embed-text) for RAG retrieval
  const OLL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/embeddings';
  const crypto = require('crypto');
  const toEmbed = await client.query(`SELECT id, ocr_text FROM person_documents WHERE (canonical_person_id=$1 OR canonical_person_id = ANY($2)) AND ocr_text IS NOT NULL`, [jtId, enslavedIds.map(x=>x.id)]);
  let embedded = 0;
  for (const d of toEmbed.rows) {
    try {
      const r = await fetch(OLL, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ model:'nomic-embed-text', prompt: d.ocr_text.slice(0,6000) }) });
      const v = (await r.json()).embedding;
      if (!Array.isArray(v) || v.length !== 768) continue;
      await client.query(
        `INSERT INTO embeddings (subject_table,subject_id,content_kind,model,embedding,content_hash)
         VALUES ('person_documents',$1,'doc_ocr','nomic-embed-text',$2::vector,$3)
         ON CONFLICT (subject_table,subject_id,content_kind,model) DO NOTHING`,
        [String(d.id), '['+v.join(',')+']', crypto.createHash('sha256').update(d.ocr_text).digest('hex')]);
      embedded++;
    } catch (e) { /* embed backend optional */ }
  }
  console.log(`\n[8] embedded ${embedded}/${toEmbed.rows.length} Jefferson docs into the RAG vector store`);
  console.log(`\n    Thomas Jefferson = canonical#${jtId} · freed: ${enslavedIds.map(x=>'#'+x.id+' '+x.e.name).join(', ')}`);
  client.release(); await pool.end();
}
main().catch(async e => { console.error('ERROR:', e.message); try{await client.query('ROLLBACK')}catch{}; try{client.release()}catch{}; try{await pool.end()}catch{}; process.exit(1); });
