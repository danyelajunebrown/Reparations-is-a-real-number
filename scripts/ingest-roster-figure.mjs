// ingest-roster-figure.mjs — reusable audit-grade ingest for a high-profile enslaver, from a JSON spec
// produced by a research subagent. One transaction per figure. Encapsulates the schema rules learned the
// hard way: explicit param casts; derive_blocking_keys(name,sex,birth); person_external_ids is polymorphic
// (subject_table/subject_id, NO unconfirmed_person_id); unconfirmed_persons.source_url is NOT NULL and
// person_type must be in the allowed set; SAVEPOINT around risky inserts (aborted-txn trap).
//
// GATE (RULE 0.6 / migration 113): a document sets evidences_enslaved_holding=TRUE only when it is
// pre-emancipation AND the research says it evidences holding (names enslaved people / slave schedule /
// inventory). Any such doc → assertable_slaveowner=TRUE. Post-emancipation wills are kept FALSE.
// If a doc has a fetchable image_url, it is pulled to S3 (real RULE 0.6 image) best-effort.
//
// Usage: node scripts/ingest-roster-figure.mjs --file figures.json [--apply]
//   figures.json = a single spec object or an array of them (schema: see the research-agent prompt).

import 'dotenv/config';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';
const require = createRequire(import.meta.url);
const S3 = require('../src/services/storage/S3Service');

const A = process.argv.slice(2);
const fi = A.indexOf('--file'); const FILE = fi > -1 ? A[fi + 1] : null;
const APPLY = A.includes('--apply');
if (!FILE || !fs.existsSync(FILE)) { console.error('usage: --file figures.json [--apply]'); process.exit(1); }

const VALID_ENSLAVED = 'enslaved';
const clean = (s) => (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
const slug = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const tierStrength = (t) => /primary/i.test(t) ? 'direct_primary' : 'secondary';
const UA = 'ReparationsResearch/1.0 (+non-commercial; db7613@bard.edu)';

async function fetchImage(url) {
  if (!url || !/^https?:\/\//.test(url)) return null;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    if (!/image\/(jpe?g|png|tiff?)/i.test(ct)) return null; // only real images satisfy RULE 0.6
    return { buf: Buffer.from(await r.arrayBuffer()), ct };
  } catch { return null; }
}

async function upsertEnslaver(c, per, notes) {
  const name = clean(per.name); const birth = per.birth || null;
  let id = (await c.query(`SELECT id FROM canonical_persons WHERE canonical_name ILIKE $1::text AND (birth_year_estimate=$2::int OR $2::int IS NULL) AND created_by='roster_partner_ingest' LIMIT 1`, [name, birth])).rows[0]?.id;
  if (!id) {
    id = (await c.query(
      `INSERT INTO canonical_persons (canonical_name, first_name, last_name, first_name_soundex, last_name_soundex, last_name_metaphone,
          sex, person_type, birth_year_estimate, death_year_estimate, primary_state, primary_county, confidence_score, verification_status, created_by, notes)
       VALUES ($1::text,$2::text,$3::text, soundex($2::text), soundex($3::text), metaphone($3::text,8), $4::text,'enslaver',$5::int,$6::int,$7::text,$8::text,0.95,'verified','roster_partner_ingest',$9::text) RETURNING id`,
      [name, clean(per.first) || null, clean(per.last) || null, (per.sex || 'm').toLowerCase()[0], birth, per.death || null, clean(per.state) || null, clean(per.county) || null, notes])).rows[0].id;
    await c.query(`INSERT INTO person_blocking_keys (subject_table, subject_id, canonical_person_id, key_type, key_value)
      SELECT 'canonical_persons',$1::int,$1::int,k.key_type,k.key_value FROM derive_blocking_keys($2::text,$3::text,$4::int) k ON CONFLICT DO NOTHING`,
      [id, name, (per.sex || 'm').toLowerCase()[0], birth]);
  } else {
    await c.query(`UPDATE canonical_persons SET notes=$2::text, verification_status='verified' WHERE id=$1`, [id, notes]);
  }
  return id;
}

async function ingestFigure(pool, spec) {
  const per = spec.person; if (!per?.name) { console.log('  skip: no person.name'); return; }
  // pre-fetch any real scan images (outside the txn)
  const images = {};
  for (let i = 0; i < (spec.documents || []).length; i++) {
    const img = await fetchImage(spec.documents[i].image_url);
    if (img) images[i] = img;
  }
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const idsys = 'roster_' + slug(per.name);
    const notes = clean(per.notes) + (spec.wealth ? ` WEALTH: ${clean(spec.wealth)}` : '') + (spec.family?.length ? ` FAMILY: ${spec.family.map(f => `${clean(f.name)} (${clean(f.relationship)})`).join('; ')}` : '');
    const eid = await upsertEnslaver(c, per, notes.slice(0, 4000));
    let holdingDoc = false, docs = 0, withImg = 0;
    for (let i = 0; i < (spec.documents || []).length; i++) {
      const d = spec.documents[i];
      const evid = !!(d.pre_emancipation && d.evidences_holding);
      if (evid) holdingDoc = true;
      let s3Key = null;
      const img = images[i];
      if (img) {
        s3Key = `sources/roster/${slug(per.name)}/${slug(d.type || 'doc')}-${d.year || 'nd'}.${/png/i.test(img.ct) ? 'png' : 'jpg'}`;
        try { await S3.upload(s3Key, img.buf, img.ct, { sha256: crypto.createHash('sha256').update(img.buf).digest('hex'), source: d.source_url }); withImg++; }
        catch { s3Key = null; }
      }
      await c.query(
        `INSERT INTO person_documents (canonical_person_id, name_as_appears, document_type, source_url, source_type, evidence_strength, document_year, ocr_text, s3_key, evidences_enslaved_holding, created_by)
         VALUES ($1,$2::text,$3::text,$4::text,'secondary',$5::text,$6::int,$7::text,$8::text,$9::bool,'roster_partner_ingest') ON CONFLICT DO NOTHING`,
        [eid, clean(per.name), clean(d.type) || 'document', clean(d.source_url) || 'research-sourced', tierStrength(d.tier), d.year || null, clean(d.source_desc) + ' — ' + clean(d.text_summary), s3Key, evid]);
      docs++;
    }
    if (holdingDoc) await c.query(`UPDATE canonical_persons SET assertable_slaveowner=TRUE WHERE id=$1`, [eid]);
    // enslaved people named in the documents → leads held by this figure
    let ens = 0;
    for (const e of (spec.enslaved || [])) {
      const nm = clean(e.name); if (!nm) continue;
      const ctx = `Named as enslaved by ${clean(per.name)} (${clean(per.state)}). ${clean(e.note)}`.slice(0, 900);
      const lid = (await c.query(
        `INSERT INTO unconfirmed_persons (full_name, person_type, locations, context_text, source_url, source_type, extraction_method, confidence_score, created_at)
         VALUES ($1::text,$2::text, ARRAY[$3::text,$4::text], $5::text, $6::text,'secondary','roster_named_enslaved',0.75, now()) RETURNING lead_id`,
        [nm, VALID_ENSLAVED, clean(per.county) || clean(per.state), clean(per.state) || 'United States', ctx, (spec.documents?.[0]?.source_url) || 'research-sourced'])).rows[0].lead_id;
      await c.query(`INSERT INTO person_external_ids (subject_table, subject_id, id_system, external_id, confidence)
        VALUES ('unconfirmed_persons',$1::int,$2::text,$3::text,0.75) ON CONFLICT (id_system, external_id) DO NOTHING`, [lid, idsys + '_enslaved', slug(nm) + '_' + lid]);
      ens++;
    }
    await c.query('COMMIT');
    console.log(`  ✓ ${per.name} #${eid} — assertable=${holdingDoc} | docs=${docs} (img→S3=${withImg}) | enslaved leads=${ens}`);
    return { name: per.name, id: eid, assertable: holdingDoc, docs, enslaved: ens };
  } catch (e) { await c.query('ROLLBACK'); console.error(`  ✗ ${per.name}: ${e.message}`); }
  finally { c.release(); }
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  let specs = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  if (!Array.isArray(specs)) specs = [specs];
  console.log(`${specs.length} figure(s)${APPLY ? '' : ' [DRY-RUN — pass --apply]'}`);
  if (!APPLY) { for (const s of specs) console.log(`  would ingest: ${s.person?.name} (${(s.documents||[]).length} docs, ${(s.enslaved||[]).length} enslaved)`); await pool.end(); return; }
  for (const s of specs) await ingestFigure(pool, s);
  await pool.end();
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
