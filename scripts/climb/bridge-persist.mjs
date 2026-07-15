// bridge-persist.mjs — persist a LEAD-AWARE, document-backed kinship edge discovered by the public-record
// bridge. Closes the loop the canonical-only writeKinshipEdge couldn't: it writes a GATED (verified=false)
// child_of edge via canonical_family_edges' M103 polymorphic columns (a_subject_table/a_subject_id …), so
// climb people stay LEADS (climb-gate standard) yet the edge persists, carrying the public record as its
// kinship document. The gate lifts later only when the doc is archived to S3 + human-reviewed.
//
// Proof case: Kathleen Elizabeth Piper (living grandparent, LTVZ-VSP) → father Jack Piper Sr, from a public
// FS record naming her Parents/Spouse/Children (disambiguated). Usage: node scripts/climb/bridge-persist.mjs [--apply]

import 'dotenv/config';
import pg from 'pg';
const APPLY = process.argv.includes('--apply');
const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
const slug = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

// The proven bridge result (Kathleen → Jack Piper Sr). child = grandparent, parent = great-grandparent.
const EDGE = {
  child: { name: 'Kathleen Elizabeth Piper', birth: 1942, place: 'Brookhaven, Mississippi', fsId: 'LTVZ-VSP' },
  parent: { name: 'Jack Piper Sr', birth: null, place: 'Mississippi', fsId: null }, // record-derived; no tree id
  source: {
    documentType: 'obituary_stated_kin', evidenceTier: 1, // a record that STATES the relationship (§3 tier 1)
    collection: 'United States, GenealogyBank Obituaries, Births, and Marriages, 1980-2015',
    sourceUrl: 'https://www.familysearch.org/search/record/results?q.givenName=Kathleen&q.surname=Piper',
    year: 1980, disambiguatedBy: 'spouse Jerry Ralph Smith + child Laura Smith Hill',
  },
};

async function findOrCreateLead(c, person, note) {
  const idsys = person.fsId ? 'familysearch' : 'bridge_record';
  const extId = person.fsId || 'bridge:' + slug(person.name);
  const ex = (await c.query(
    `SELECT subject_id FROM person_external_ids WHERE id_system=$1 AND external_id=$2 AND subject_table='unconfirmed_persons' LIMIT 1`,
    [idsys, extId])).rows[0];
  if (ex) return ex.subject_id;
  const lid = (await c.query(
    `INSERT INTO unconfirmed_persons (full_name, person_type, locations, context_text, source_url, source_type, extraction_method, confidence_score, created_at)
     VALUES ($1::text,'descendant', ARRAY[$2::text], $3::text, $4::text, 'secondary','public_record_bridge',0.8, now()) RETURNING lead_id`,
    [person.name, person.place || 'United States', note, EDGE.source.sourceUrl])).rows[0].lead_id;
  await c.query(`INSERT INTO person_external_ids (subject_table, subject_id, id_system, external_id, confidence)
     VALUES ('unconfirmed_persons',$1::int,$2::text,$3::text,0.8) ON CONFLICT (id_system, external_id) DO NOTHING`, [lid, idsys, extId]);
  return lid;
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  if (!APPLY) { console.log('[DRY-RUN] would persist:', EDGE.child.name, '→ child_of →', EDGE.parent.name, `(tier ${EDGE.source.evidenceTier}, gated)`); await pool.end(); return; }
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const childLead = await findOrCreateLead(c, EDGE.child, `Participant Piper's grandmother; living (FS ${EDGE.child.fsId}). Bridged via public record.`);
    const parentLead = await findOrCreateLead(c, EDGE.parent, `Participant Piper's great-grandfather; identified from ${EDGE.source.collection} as parent of ${EDGE.child.name}.`);
    // source document on the CHILD lead (lead-capable person_documents)
    const doc = (await c.query(
      `INSERT INTO person_documents (unconfirmed_person_id, name_as_appears, document_type, source_url, source_type, evidence_strength, document_year, evidences_enslaved_holding, created_by)
       VALUES ($1,$2,$3,$4,'secondary','secondary_database',$5,FALSE,'public_record_bridge') RETURNING id`,
      [childLead, `kinship:${EDGE.source.documentType}:${EDGE.child.name}`, EDGE.source.documentType, EDGE.source.sourceUrl, EDGE.source.year])).rows[0].id;
    // GATED, lead-aware child_of edge via the M103 polymorphic columns (person_a_id/b left NULL — leads)
    const edge = (await c.query(
      `INSERT INTO canonical_family_edges
         (relationship_type, a_subject_table, a_subject_id, b_subject_table, b_subject_id,
          source_document_id, source_url, evidence_tier, confidence, verified, notes, created_at, updated_at)
       VALUES ('child_of','unconfirmed_persons',$1,'unconfirmed_persons',$2,$3,$4,$5,0.9,FALSE,$6, now(), now())
       RETURNING id`,
      [childLead, parentLead, doc, EDGE.source.sourceUrl, EDGE.source.evidenceTier,
       `${EDGE.child.name} child_of ${EDGE.parent.name}. Living-person bridge via ${EDGE.source.collection}; disambiguated by ${EDGE.source.disambiguatedBy}. GATED pending S3 archival + review.`])).rows[0].id;
    await c.query('COMMIT');
    console.log(`✓ PERSISTED gated lead-aware kinship edge #${edge}`);
    console.log(`  ${EDGE.child.name} (lead ${childLead}) —child_of→ ${EDGE.parent.name} (lead ${parentLead})`);
    console.log(`  tier ${EDGE.source.evidenceTier} · doc #${doc} (${EDGE.source.documentType}) · verified=false (gated until S3+review)`);
    console.log(`  → great-grandparent seed for the climb: ${EDGE.parent.name}`);
  } catch (e) { await c.query('ROLLBACK'); console.error('ROLLBACK:', e.message); }
  finally { c.release(); await pool.end(); }
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
