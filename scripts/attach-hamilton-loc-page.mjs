#!/usr/bin/env node
/**
 * Attach a VERIFIED Library-of-Congress cash-book page image to a person as a PRIMARY document.
 * Only run AFTER visually confirming the page contains the cited entry (no blind ingest).
 * Usage: node scripts/attach-hamilton-loc-page.mjs <imgPath> <canonicalId> <document_type> <docYear> <iiifUrl> "<ocr_text>"
 * Uploads to S3, writes person_documents (evidence_strength=primary, s3_key set), embeds for RAG,
 * recomputes the gate, and prints the resulting gate. Does NOT force the gate — reports honestly.
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

const [imgPath, canonicalIdStr, docType, docYearStr, iiifUrl, ocr] = process.argv.slice(2);
const canonicalId = parseInt(canonicalIdStr, 10);
const docYear = docYearStr ? parseInt(docYearStr, 10) : null;
const BY = 'roster_partner_ingest';
const CITE = "Alexander Hamilton Papers: Financial Papers, 1782-1804; Cash books (Library of Congress). Identified via Jessie Serfilippi, Schuyler Mansion State Historic Site, 2020.";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const client = await pool.connect();
const ps = new PersonService(client);

async function main() {
  const who = await client.query('SELECT canonical_name FROM canonical_persons WHERE id=$1', [canonicalId]);
  if (!who.rows.length) { console.error('no canonical#'+canonicalId); process.exit(2); }
  const name = who.rows[0].canonical_name;

  const buffer = readFileSync(imgPath);
  const s3 = new S3StorageAdapter();
  const up = await s3.uploadFile({ buffer, mimetype: 'image/jpeg', originalname: imgPath.split('/').pop() },
                                 { ownerName: name, documentType: docType });
  const s3Url = `https://${up.s3Bucket}.s3.${cfg.storage.s3.region}.amazonaws.com/${up.s3Key}`;
  console.log(`uploaded ${buffer.length}b → ${up.s3Key}`);

  const d = await client.query(
    `INSERT INTO person_documents
       (canonical_person_id, name_as_appears, document_type, source_url, source_type, s3_url, s3_key,
        evidence_strength, document_year, title, ocr_text, human_verified, verified_by, created_by)
     VALUES ($1,$2,$3,$4,'primary_source',$5,$6,'primary',$7,$8,$9,true,$10,$10)
     ON CONFLICT (COALESCE(canonical_person_id,'-1'::integer), COALESCE(unconfirmed_person_id,'-1'::integer), COALESCE(s3_url,''::text), name_as_appears) DO NOTHING
     RETURNING id`,
    [canonicalId, name, docType, iiifUrl, s3Url, up.s3Key, docYear, CITE, ocr, BY]);
  const docId = d.rows[0]?.id;
  console.log(`person_documents#${docId} (${docType}, primary, s3_key set)`);

  // embed for RAG
  try {
    const OLL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/embeddings';
    const resp = await fetch(OLL, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ model:'nomic-embed-text', prompt: ocr.slice(0,6000) }) });
    const v = (await resp.json()).embedding;
    if (Array.isArray(v) && v.length === 768 && docId) {
      await client.query(`INSERT INTO embeddings (subject_table,subject_id,content_kind,model,embedding,content_hash)
        VALUES ('person_documents',$1,'doc_ocr','nomic-embed-text',$2::vector,$3)
        ON CONFLICT (subject_table,subject_id,content_kind,model) DO NOTHING`,
        [String(docId), '['+v.join(',')+']', crypto.createHash('sha256').update(ocr).digest('hex')]);
      console.log('embedded for RAG');
    }
  } catch (e) { console.log('embed skipped:', e.message); }

  const g = await ps.recomputeGate(canonicalId);
  console.log(`recomputeGate → assertable_slaveowner=${g.assertable_slaveowner} assertable_enslaved=${g.assertable_enslaved}`);
  console.log(g.assertable_slaveowner ? 'STATE: SERVED' : 'STATE: still GATED (document_type is OWNER_CONTENT — needs a count/named-edge corroborator; see next step)');
  client.release(); await pool.end();
}
main().catch(async e => { console.error('ERROR:', e.message); try{client.release()}catch{}; try{await pool.end()}catch{}; process.exit(1); });
