// promote-image-backed-leads.mjs — RULE 0.6 PROMOTION: turn image-backed, deduped LEADS into canonical
// persons so they surface on search + are assertable (the missing half of the pipeline — ingest +
// attach-doc were built; nothing promoted, so nothing surfaced).
//
// For each lead (by id_system) that HAS a person_document with an s3_key (serves an image → clears RULE
// 0.6's image bar), calls PersonService.promoteToCanonical (Biscoe-safe: links to an existing canonical
// on a corroborated match, refuses ambiguous → needs_review, else creates a canonical). Passes the scan
// as the evidence document so recomputeGate lifts the external-assertion gate. Moves the lead's scan doc
// onto the canonical (no dup). Resumable (skips status='promoted').
//
// Usage: node scripts/promote-image-backed-leads.mjs --id-system hdsc_suriname_slaveregister [--limit N] [--apply]

import 'dotenv/config';
import { createRequire } from 'node:module';
import pg from 'pg';
const require = createRequire(import.meta.url);
const PersonService = require('../src/services/PersonService');

const A = process.argv.slice(2);
const idi = A.indexOf('--id-system'); const IDSYS = idi > -1 ? A[idi + 1] : null;
const li = A.indexOf('--limit'); const LIMIT = li > -1 ? +A[li + 1] : Infinity;
const APPLY = A.includes('--apply');
if (!IDSYS) { console.error('usage: --id-system <sys> [--limit N] [--apply]'); process.exit(1); }

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const db = { query: (t, p) => pool.query(t, p) };
  const svc = new PersonService(db);
  // image-backed leads not yet promoted: a lead with a person_documents.s3_key
  const { rows } = await pool.query(
    `SELECT DISTINCT u.lead_id, u.full_name, u.birth_year, u.gender, u.person_type, e.external_id,
            d.s3_key, d.source_url, d.document_type, d.name_as_appears
       FROM unconfirmed_persons u
       JOIN person_external_ids e ON e.subject_table='unconfirmed_persons' AND e.subject_id=u.lead_id AND e.id_system=$1
       JOIN person_documents d ON d.unconfirmed_person_id=u.lead_id AND d.s3_key IS NOT NULL
      WHERE COALESCE(u.status,'') <> 'promoted' AND u.full_name IS NOT NULL
      ORDER BY u.lead_id LIMIT $2`, [IDSYS, Number.isFinite(LIMIT) ? LIMIT : 200000]);
  console.log(`image-backed ${IDSYS} leads to promote: ${rows.length}${APPLY ? '' : ' [DRY-RUN]'}`);

  const stats = { created: 0, linked: 0, needs_review: 0, rejected: 0, err: 0 };
  for (const r of rows) {
    const leadRef = { subject_table: 'unconfirmed_persons', subject_id: r.lead_id };
    const evidence = {
      personType: r.person_type, externalId: r.external_id, idSystem: IDSYS, sourceType: 'scholarly',
      createdBy: 'promote-image-backed', confidence: 0.9,
      document: { s3Key: r.s3_key, sourceUrl: r.source_url, documentType: r.document_type || 'slave_register',
        evidenceStrength: 'primary', nameAsAppears: r.name_as_appears || r.full_name },
    };
    try {
      const out = await svc.promoteToCanonical(leadRef, evidence, { dryRun: !APPLY });
      if (out.action === 'created') stats.created++;
      else if (out.action === 'linked') stats.linked++;
      else if (out.action === 'needs_review') stats.needs_review++;
      else stats.rejected++;
      // move the lead's original scan doc onto the canonical (no dup) + drop the redundant lead-doc
      if (APPLY && out.ref?.subject_id && (out.action === 'created' || out.action === 'linked')) {
        await pool.query(
          `UPDATE person_documents SET canonical_person_id=$1, unconfirmed_person_id=NULL
             WHERE unconfirmed_person_id=$2 AND s3_key=$3
             AND NOT EXISTS (SELECT 1 FROM person_documents x WHERE x.canonical_person_id=$1 AND x.s3_key=$3)`,
          [out.ref.subject_id, r.lead_id, r.s3_key]).catch(() => {});
        await pool.query(`DELETE FROM person_documents WHERE unconfirmed_person_id=$1 AND s3_key=$2`, [r.lead_id, r.s3_key]).catch(() => {});
      }
    } catch (e) { stats.err++; if (stats.err <= 5) console.log(`  err lead ${r.lead_id}: ${e.message}`); }
    const done = stats.created + stats.linked + stats.needs_review + stats.rejected;
    if (done % 100 === 0) process.stdout.write(`\r  ${done}/${rows.length} — created ${stats.created}, linked ${stats.linked}, review ${stats.needs_review}   `);
  }
  await pool.end();
  console.log('\n=== stats ===', JSON.stringify(stats));
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
