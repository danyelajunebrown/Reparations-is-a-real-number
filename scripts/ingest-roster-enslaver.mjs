#!/usr/bin/env node
/**
 * ingest-roster-enslaver.mjs — PARTNER INGEST for the Wikipedia "List of slave owners" audit.
 *
 * Takes ONE historically-notable enslaver who the breadth audit proved ABSENT, plus ONE real
 * archival document, and walks the full chain to SERVED under
 * memory-bank/standard-canonical-person-and-document-gate.md:
 *
 *   dedup preflight  → (create distinct canonical | link existing) → upload the real file to S3
 *   → person_documents row with s3_key + proposition-specific document_type
 *   → PersonService.recomputeGate → VERIFY (S3 object fetches + gated public query returns them).
 *
 * The gate lifts ONLY when a stored file (s3_key) of a substantiating type is attached, and only
 * for the proposition that type substantiates. OWNER_NAMED types (slave schedule, plantation
 * record, bill of sale, compensated-emancipation petition, manifest, insurance/gov disclosure)
 * lift "was a slaveowner" in one step. A will/estate type (OWNER_CONTENT) needs a corroborating
 * role edge (enslaved_owner_relationships / probate enslaved_count) — the script warns if so.
 *
 * NO fabrication. Every row carries provenance (source_url, title, created_by). Identity is made
 * DISCRETE (birth+death+state+county) so the new canonical never merges into the namesake swamp
 * (Biscoe: name-only is never auto-merged; creating a NEW distinct human is the safe direction,
 * and this is human-authorized).
 *
 * USAGE (one person, one doc):
 *   node scripts/ingest-roster-enslaver.mjs \
 *     --name "George Washington" --birth 1732 --death 1799 --state Virginia --county Fairfax \
 *     --person-type enslaver \
 *     --doc <URL-or-local-path> --doc-type census_slave_schedule \
 *     --source-url "https://...primary-source-landing-page" \
 *     --title "1799 Mount Vernon slave census (Washington named as owner)" --doc-year 1799
 *   Add --link <canonicalId> to attach the doc to an EXISTING correct canonical instead of creating.
 *   Add --dry-run to see the dedup decision + planned actions with NO writes and NO upload.
 *   Add --fs-id XXXX-XXX to also record a FamilySearch external id.
 */
import 'dotenv/config';
import pg from 'pg';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const PersonService = require('../src/services/PersonService');
const S3StorageAdapter = require('../src/services/document/S3StorageAdapter');
import { readFileSync } from 'fs';
import { basename, extname } from 'path';

// ---- arg parsing ----
const A = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) { const k = a.slice(2); const v = (process.argv[i+1] && !process.argv[i+1].startsWith('--')) ? process.argv[++i] : true; A[k] = v; }
}
const need = (k) => { if (!A[k]) { console.error(`MISSING --${k}`); process.exit(2); } return A[k]; };
const DRY = !!A['dry-run'];
const createdBy = A['created-by'] || 'roster_partner_ingest';

// document_type → which proposition, and whether the TYPE alone lifts the gate (NAMED) or needs a
// role edge (CONTENT). Mirror of PersonService OWNER_/ENSLAVED_ lists (kept in sync deliberately).
const OWNER_NAMED = new Set(['census_slave_schedule','slave_schedule','compensated_emancipation_petition','compensation_petition','emancipation_petition','plantation_record','insurance_register','government_disclosure','corporate_disclosure','bill_of_sale','slave_manifest']);
const OWNER_CONTENT = new Set(['will','will_testament','estate_inventory','estate_account','guardian_account','tax_record','court_record','correspondence','census']);

const MIME = { pdf:'application/pdf', jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif', tif:'image/tiff', tiff:'image/tiff', webp:'image/webp' };

async function loadDoc(src) {
  if (/^https?:\/\//i.test(src)) {
    const r = await fetch(src, { headers: { 'User-Agent': 'reparations-audit/1.0 (archival document ingest)' }, redirect: 'follow' });
    if (!r.ok) throw new Error(`fetch ${src} → HTTP ${r.status}`);
    const buffer = Buffer.from(await r.arrayBuffer());
    const ct = r.headers.get('content-type') || '';
    const mimetype = A['doc-mime'] || ct.split(';')[0].trim() || MIME[extname(new URL(src).pathname).slice(1).toLowerCase()] || 'application/octet-stream';
    return { buffer, mimetype, originalname: basename(new URL(src).pathname) || 'document' };
  }
  const buffer = readFileSync(src);
  const ext = extname(src).slice(1).toLowerCase();
  return { buffer, mimetype: A['doc-mime'] || MIME[ext] || 'application/octet-stream', originalname: basename(src) };
}

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ps = new PersonService(db);

function parseName(full){ const p=String(full).trim().split(/[\s,]+/).filter(Boolean); if(String(full).includes(','))return{first:p[1]||'',last:p[0]}; return{first:p[0]||'',last:p.length>1?p[p.length-1]:''}; }

async function main() {
  const name = need('name');
  const birth = A['birth'] ? parseInt(A['birth'],10) : null;
  const death = A['death'] ? parseInt(A['death'],10) : null;
  const state = A['state'] || null;
  const county = A['county'] || null;
  const sex = A['sex'] || null;
  const personType = A['person-type'] || 'enslaver';
  const docType = A['doc-type'] || null;

  console.log(`\n=== INGEST: ${name} (${birth||'?'}–${death||'?'}) [${state||'?'}${county?'/'+county:''}] type=${personType} ===`);

  // 1) DEDUP PREFLIGHT
  const res = await ps.resolve({ name, birthYear: birth, location: state, sex, personType });
  console.log(`\n[1] dedup preflight — resolve() match=${res.match?('canonical#'+res.match.subject_id):'none'} ambiguous=${!!res.ambiguous} candidates=${res.candidates.length}`);
  for (const c of res.candidates.slice(0,8)) console.log(`     cand ${c.subject_table}#${c.subject_id} "${c.name}" b=${c.birth_year||''} st=${c.state||''} conf=${c.confidence.toFixed(2)} [${c.signals.join(',')}]`);

  let canonicalId, action;
  if (A['link']) {
    canonicalId = parseInt(A['link'],10); action = 'linked (explicit --link)';
    const chk = await db.query('SELECT id, canonical_name, birth_year_estimate, death_year_estimate FROM canonical_persons WHERE id=$1', [canonicalId]);
    if (!chk.rows.length) { console.error(`--link ${canonicalId} does not exist`); process.exit(2); }
    console.log(`\n[2] LINK to existing canonical#${canonicalId} "${chk.rows[0].canonical_name}"`);
  } else if (res.match && res.match.subject_table === 'canonical_persons' && !res.ambiguous) {
    console.error(`\n[2] STOP: resolve() found an UNAMBIGUOUS existing canonical#${res.match.subject_id} ("${res.match.name}"). This person may already be stored — inspect it, then re-run with --link ${res.match.subject_id} to attach the document (never create a duplicate).`);
    process.exit(3);
  } else {
    action = 'create distinct (human-authorized; namesakes are collisions, not this person)';
    console.log(`\n[2] CREATE new distinct canonical (${res.ambiguous?'namesake collisions present — NOT merging into them':'no signature match'})`);
  }

  if (DRY) {
    console.log(`\n[DRY-RUN] would ${A['link']?'link to #'+canonicalId:'create canonical'} · would upload doc "${A['doc']||'(none given)'}" type=${docType||'(none)'} · would recomputeGate.`);
    console.log(`[DRY-RUN] gate expectation: docType=${docType} → ${docType&&OWNER_NAMED.has(docType)?'OWNER_NAMED ⇒ lifts assertable_slaveowner in ONE step':docType&&OWNER_CONTENT.has(docType)?'OWNER_CONTENT ⇒ needs a role edge (enslaved_owner_relationships / probate enslaved_count>0) to lift':'(no/unknown doc-type ⇒ gate stays FALSE)'}`);
    await db.end(); return;
  }

  // 3) UPLOAD DOC TO S3 (real file — required to lift the gate)
  if (!A['doc']) { console.error('No --doc supplied; nothing to store. (Use --dry-run to preview without a document.)'); process.exit(2); }
  if (!docType) { console.error('MISSING --doc-type (required so the gate knows which proposition the file substantiates).'); process.exit(2); }
  const file = await loadDoc(A['doc']);
  const s3 = new S3StorageAdapter();
  const up = await s3.uploadFile(file, { ownerName: name, documentType: docType });
  const s3Key = up.s3Key;
  const s3Url = `https://${up.s3Bucket}.s3.${(require('../config').storage.s3.region)}.amazonaws.com/${s3Key}`;
  console.log(`\n[3] uploaded ${file.buffer.length} bytes (${file.mimetype}) → s3://${up.s3Bucket}/${s3Key}`);

  // 4) CREATE or REUSE canonical
  if (!A['link']) {
    const { first, last } = parseName(name);
    const notes = JSON.stringify({ source: 'wikipedia_list_of_slave_owners_audit', ingested: createdBy, provenance_url: A['source-url'] || A['doc'], identity_note: `discrete human: b${birth||'?'} d${death||'?'} ${state||''} ${county||''}`.trim() });
    const ins = await db.query(
      `INSERT INTO canonical_persons
         (canonical_name, first_name, last_name, first_name_soundex, last_name_soundex, last_name_metaphone,
          sex, person_type, birth_year_estimate, death_year_estimate, primary_state, primary_county,
          confidence_score, verification_status, created_by, notes)
       VALUES ($1,$2::text,$3::text, soundex($2::text), soundex($3::text), metaphone($3::text,8),
               $4,$5,$6,$7,$8,$9,$10,'verified',$11,$12)
       RETURNING id`,
      [name, first||null, last||null, sex?sex[0].toLowerCase():null, personType, birth, death, state, county,
       A['confidence']?parseFloat(A['confidence']):0.95, createdBy, notes]);
    canonicalId = ins.rows[0].id;
    await ps._writeBlockingKeys('canonical_persons', canonicalId, { name, sex, birthYear: birth });
    console.log(`\n[4] created canonical#${canonicalId} + blocking keys`);
  } else {
    // enrich identity on the linked canonical if it's thin (never overwrite non-null with null)
    await db.query(`UPDATE canonical_persons SET
        birth_year_estimate=COALESCE(birth_year_estimate,$2), death_year_estimate=COALESCE(death_year_estimate,$3),
        primary_state=COALESCE(primary_state,$4), primary_county=COALESCE(primary_county,$5), updated_at=now()
       WHERE id=$1`, [canonicalId, birth, death, state, county]);
    console.log(`\n[4] linked; enriched thin identity fields where NULL`);
  }

  // 5) person_documents row WITH s3_key (this is what lifts the gate)
  await db.query(
    `INSERT INTO person_documents
       (canonical_person_id, name_as_appears, document_type, source_url, source_type, s3_url, s3_key,
        evidence_strength, document_year, title, human_verified, verified_by, created_by)
     VALUES ($1,$2,$3,$4,'primary_source',$5,$6,'primary',$7,$8,true,$9,$9)
     ON CONFLICT (COALESCE(canonical_person_id,'-1'::integer), COALESCE(unconfirmed_person_id,'-1'::integer), COALESCE(s3_url,''::text), name_as_appears) DO NOTHING`,
    [canonicalId, A['name-as-appears']||name, docType, A['source-url']||A['doc'], s3Url, s3Key, A['doc-year']?parseInt(A['doc-year'],10):null, A['title']||null, createdBy]);
  console.log(`[5] person_documents row written (document_type=${docType}, s3_key set)`);

  // optional external id
  if (A['fs-id']) { await ps.link({ subject_table:'canonical_persons', subject_id: canonicalId }, A['fs-id'], A['idsystem']||'familysearch', { url: A['source-url']||null }); console.log(`    + external id ${A['idsystem']||'familysearch'}:${A['fs-id']}`); }

  // 6) RECOMPUTE GATE
  const gate = await ps.recomputeGate(canonicalId);
  console.log(`\n[6] recomputeGate → assertable_slaveowner=${gate.assertable_slaveowner} assertable_enslaved=${gate.assertable_enslaved}`);
  if (!gate.assertable_slaveowner && OWNER_CONTENT.has(docType)) {
    console.log(`    NOTE: "${docType}" is OWNER_CONTENT — the gate needs a corroborating role edge`);
    console.log(`    (enslaved_owner_relationships owner=this canonical, OR a linked probate doc with enslaved_count>0).`);
    console.log(`    The document is stored & connected; add the role edge to lift the public assertion.`);
  }

  // 7) VERIFY SERVED
  const exists = await s3.fileExists(s3Key);
  const served = await db.query(
    `SELECT id, canonical_name, assertable_slaveowner, assertable_enslaved
       FROM canonical_persons
      WHERE id=$1 AND (assertable_slaveowner OR assertable_enslaved)`, [canonicalId]);
  console.log(`\n[7] VERIFY:`);
  console.log(`     S3 object fetches:      ${exists ? 'PASS' : 'FAIL'}`);
  console.log(`     gated public query:     ${served.rows.length ? 'PASS (returned to non-admin search)' : 'GATED (not yet publicly assertable)'}`);
  console.log(`     verdict: ${exists && served.rows.length ? 'T3 SERVED' : exists ? 'T2 STORED (connected, gated)' : 'INCOMPLETE'}  → canonical#${canonicalId}`);
  await db.end();
}

main().catch(async e => { console.error('ERROR:', e.message); try{await db.end()}catch{}; process.exit(1); });
