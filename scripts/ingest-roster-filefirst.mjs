// ingest-roster-filefirst.mjs — the CORRECT order (per standard-file-first-document-archival):
// GET the file → ARCHIVE to S3 (+Wayback+source_artifacts) → EXTRACT → and ONLY THEN mint the canonical
// with the real s3_key + gate off the file. No file (≥1KB) ⇒ no canonical, no assertion.
//
// Spec (JSON array): {person:{name,first,last,sex,birth,death,state,county,notes,also_assert:[names]},
//   doc:{archivable_url,type,year,pre_emancipation}, enslaved:[{name,note}], family:[{name,relationship}]}
// also_assert = extra canonicals sharing this doc (e.g. James Monroe inherits Spence Monroe's inventory).
//
// Usage: node scripts/ingest-roster-filefirst.mjs --file specs.json [--apply]

import 'dotenv/config';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';
import { ensureSnapshot } from './lib/wayback.mjs';
const require = createRequire(import.meta.url);
const S3 = require('../src/services/storage/S3Service');

const A = process.argv.slice(2);
const fi = A.indexOf('--file'); const FILE = fi > -1 ? A[fi + 1] : null;
const APPLY = A.includes('--apply');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17 Safari/605.1.15';
const clean = (s) => (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
const slug = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);
const htmlToText = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
function parseName(f) { const p = clean(f).split(/[\s,]+/).filter(Boolean); return { first: p[0] || '', last: p.length > 1 ? p[p.length - 1] : '' }; }

async function fetchFile(url) {
  const go = async (u) => { const r = await fetch(u, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(45000) }); return { ok: r.ok, ct: (r.headers.get('content-type') || '').toLowerCase(), buf: Buffer.from(await r.arrayBuffer()) }; };
  let r; try { r = await go(url); } catch { r = { ok: false, ct: '', buf: Buffer.alloc(0) }; }
  if (!r.ok || r.buf.length < 1024) { try { const w = await go(`https://web.archive.org/web/2id_/${url}`); if (w.ok && w.buf.length >= 1024) r = w; } catch { /* keep */ } }
  return r;
}

async function upsertEnslaver(c, per, notes) {
  const { first, last } = parseName(per.name);
  let id = (await c.query(`SELECT id FROM canonical_persons WHERE canonical_name ILIKE $1::text AND (birth_year_estimate=$2::int OR $2::int IS NULL) AND created_by='roster_filefirst' LIMIT 1`, [clean(per.name), per.birth || null])).rows[0]?.id;
  if (!id) {
    id = (await c.query(
      `INSERT INTO canonical_persons (canonical_name, first_name, last_name, first_name_soundex, last_name_soundex, last_name_metaphone, sex, person_type, birth_year_estimate, death_year_estimate, primary_state, primary_county, confidence_score, verification_status, created_by, notes)
       VALUES ($1::text,$2::text,$3::text, soundex($2::text), soundex($3::text), metaphone($3::text,8), $4::text,'enslaver',$5::int,$6::int,$7::text,$8::text,0.95,'verified','roster_filefirst',$9::text) RETURNING id`,
      [clean(per.name), clean(per.first) || first, clean(per.last) || last, (per.sex || 'm')[0], per.birth || null, per.death || null, clean(per.state) || null, clean(per.county) || null, clean(notes).slice(0, 4000)])).rows[0].id;
    await c.query(`INSERT INTO person_blocking_keys (subject_table, subject_id, canonical_person_id, key_type, key_value) SELECT 'canonical_persons',$1::int,$1::int,k.key_type,k.key_value FROM derive_blocking_keys($2::text,$3::text,$4::int) k ON CONFLICT DO NOTHING`, [id, clean(per.name), (per.sex || 'm')[0], per.birth || null]);
  }
  return id;
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const specs = JSON.parse(require('node:fs').readFileSync(FILE, 'utf8'));
  const stats = { archived: 0, no_file: 0, canonicals: 0, assertable: 0, enslaved: 0, inh: 0 };
  for (const spec of specs) {
    const per = spec.person, d = spec.doc; if (!per?.name || !d?.archivable_url) { continue; }
    // 1. GET + ARCHIVE the file FIRST
    let s3Key = null, ocr = null, wb = null;
    const r = await fetchFile(d.archivable_url);
    if (r.ok && r.buf.length >= 1024) {
      const ext = /pdf/.test(r.ct) ? 'pdf' : /jpe?g/.test(r.ct) ? 'jpg' : /png/.test(r.ct) ? 'png' : /html/.test(r.ct) ? 'html' : /csv|tab|plain/.test(r.ct) ? 'txt' : 'bin';
      s3Key = `sources/roster/${slug(per.name)}/${slug(d.type || 'doc')}.${ext}`;
      if (/html|txt|csv|plain/.test(r.ct)) ocr = htmlToText(r.buf.toString('utf8')).slice(0, 8000);
      if (APPLY) {
        try { await S3.upload(s3Key, r.buf, r.ct || 'application/octet-stream', { sha256: crypto.createHash('sha256').update(r.buf).digest('hex'), source: d.archivable_url }); wb = await ensureSnapshot(d.archivable_url); }
        catch (e) { console.log(`  S3 FAIL ${per.name}: ${e.message.slice(0, 40)}`); s3Key = null; }
      }
      if (s3Key) { stats.archived++; console.log(`  ✓ FILE ${per.name} [${d.type}] ${ext.toUpperCase()} ${(r.buf.length / 1024).toFixed(0)}KB → S3${ocr ? ' +text' : ''}`); }
    }
    if (!s3Key) { stats.no_file++; console.log(`  ✗ NO FILE ${per.name} — ${r.buf.length}b from ${d.archivable_url.slice(0, 50)}; SKIP (no file, no canonical)`); continue; }
    if (!APPLY) continue;

    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const notes = clean(per.notes) + (spec.wealth ? ` WEALTH: ${clean(spec.wealth)}` : '');
      const owners = [per.name, ...((per.also_assert) || [])];
      const evid = d.evidences_holding !== undefined ? !!d.evidences_holding : !!d.pre_emancipation;
      const cids = [];
      for (let oi = 0; oi < owners.length; oi++) {
        const pp = oi === 0 ? per : { ...per, name: owners[oi], first: null, last: null, birth: null, death: null, notes: `Shares the ${d.type} evidencing enslaved holding (${owners[0]}).` };
        const eid = await upsertEnslaver(c, pp, oi === 0 ? notes : pp.notes);
        cids.push(eid);
        await c.query(`INSERT INTO person_documents (canonical_person_id, name_as_appears, document_type, source_url, source_type, evidence_strength, document_year, ocr_text, s3_key, wayback_url, evidences_enslaved_holding, created_by)
           VALUES ($1,$2::text,$3::text,$4::text,'secondary','direct_primary',$5::int,$6::text,$7::text,$8::text,$9::bool,'roster_filefirst') ON CONFLICT DO NOTHING`,
          [eid, clean(owners[0]), clean(d.type), d.archivable_url, d.year || null, ocr, s3Key, wb, evid]).catch(async () => {
            // person_documents may lack wayback_url column — retry without it
            await c.query(`INSERT INTO person_documents (canonical_person_id, name_as_appears, document_type, source_url, source_type, evidence_strength, document_year, ocr_text, s3_key, evidences_enslaved_holding, created_by) VALUES ($1,$2::text,$3::text,$4::text,'secondary','direct_primary',$5::int,$6::text,$7::text,$8::bool,'roster_filefirst') ON CONFLICT DO NOTHING`, [eid, clean(owners[0]), clean(d.type), d.archivable_url, d.year || null, ocr, s3Key, evid]);
          });
        stats.canonicals++;
      }
      // GATE = file + evidences_holding
      await c.query(`UPDATE canonical_persons SET assertable_slaveowner = EXISTS(SELECT 1 FROM person_documents x WHERE x.canonical_person_id=canonical_persons.id AND x.s3_key IS NOT NULL AND x.evidences_enslaved_holding) WHERE id = ANY($1::int[])`, [cids]);
      // enslaved roster → leads + owner-edges (to the primary holder)
      const primary = cids[0];
      for (const e of (spec.enslaved || [])) {
        const nm = clean(e.name); if (!nm) continue;
        const lid = (await c.query(`INSERT INTO unconfirmed_persons (full_name, person_type, locations, context_text, source_url, source_type, extraction_method, confidence_score, created_at) VALUES ($1::text,'enslaved', ARRAY[$2::text,$3::text], $4::text, $5::text,'secondary','roster_filefirst_enslaved',0.75, now()) RETURNING lead_id`,
          [nm, clean(per.county) || clean(per.state), clean(per.state) || 'United States', `Named as enslaved by ${clean(per.name)}. ${clean(e.note)}`.slice(0, 900), d.archivable_url])).rows[0].lead_id;
        await c.query(`INSERT INTO person_external_ids (subject_table, subject_id, id_system, external_id, confidence) VALUES ('unconfirmed_persons',$1::int,$2::text,$3::text,0.75) ON CONFLICT (id_system, external_id) DO NOTHING`, [lid, 'roster_ff_' + slug(per.name) + '_enslaved', slug(nm) + '_' + lid]);
        await c.query('SAVEPOINT eo');
        try { await c.query(`INSERT INTO enslaved_owner_relationships (enslaved_subject_table, enslaved_subject_id, enslaved_name, owner_canonical_id, owner_subject_table, owner_subject_id, owner_name, relationship_type, source_url, source_context, confidence_score, verification_status, created_by) VALUES ('unconfirmed_persons',$1::int,$2::text,$3::int,'canonical_persons',$3::int,$4::text,'enslaved_by',$5::text,$6::text,0.75,'unverified','roster_filefirst')`, [lid, nm, primary, clean(per.name), d.archivable_url, clean(e.note).slice(0, 400)]); await c.query('RELEASE SAVEPOINT eo'); } catch { await c.query('ROLLBACK TO SAVEPOINT eo'); }
        stats.enslaved++;
      }
      // inheritance edges (transmitting ancestor → primary)
      for (const f of (spec.family || [])) {
        const rel = clean(f.relationship).toLowerCase();
        if (!/father|grandfather|brother|mother/.test(rel) || !/will|estate|bequeath|inherit|transmit|willed|passed/.test(rel)) continue;
        await c.query('SAVEPOINT inh');
        try { const anc = await upsertEnslaver(c, { name: clean(f.name), sex: 'm' }, `Transmitted enslaved property to ${clean(per.name)} (${rel}).`); await c.query(`INSERT INTO inheritance_edges (testator_id, heir_id, relationship_to_testator, asset_type, asset_description, document_year, evidence_tier, confidence, notes, created_at) VALUES ($1::int,$2::int,$3::text,'enslaved_persons',$4::text,$5::int,2,0.8,$6::text, now())`, [anc, primary, rel.split('(')[0].trim() || 'ancestor', `Enslaved people transmitted from ${clean(f.name)} to ${clean(per.name)}`, per.birth || null, clean(f.relationship).slice(0, 400)]); await c.query('RELEASE SAVEPOINT inh'); stats.inh++; } catch { await c.query('ROLLBACK TO SAVEPOINT inh'); }
      }
      await c.query('COMMIT');
      const a = (await pool.query(`SELECT count(*) FILTER (WHERE assertable_slaveowner)::int n FROM canonical_persons WHERE id=ANY($1)`, [cids])).rows[0].n;
      stats.assertable += a;
      console.log(`    → ${cids.length} canonical(s), ${a} assertable (via file), ${(spec.enslaved || []).length} enslaved`);
    } catch (e) { await c.query('ROLLBACK'); console.error(`  ✗ ${per.name} txn: ${e.message.slice(0, 60)}`); }
    finally { c.release(); }
  }
  await pool.end();
  console.log('\n=== ' + JSON.stringify(stats) + ' ===');
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
