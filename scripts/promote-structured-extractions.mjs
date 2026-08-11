// promote-structured-extractions.mjs — turn the typed structured_extractions rows into persons + edges.
//
// The source-type extraction registry (run-source-extraction.mjs) fills structured_extractions with typed
// fields per source type. This de-silos them onto the person spine — the PAYOFF step — mirroring the audit
// discipline of promote-probate-extractions.mjs:
//   • Every named person → a LEAD via PersonService.findOrCreateLead (mint gate filters place-word/junk;
//     Biscoe dedup never auto-merges ambiguous names).
//   • enslaver→enslaved edges → enslaved_owner_relationships (the same generic subject_table/subject_id edge
//     the probate promoter uses; ON CONFLICT DO NOTHING).
//   • The imaged source page links to the PRIMARY subject (freedmens depositor / probate testator).
//   • Gate signals (evidences_enslaved_holding, enslaved_count) set when a holding is documented.
//
// AUDIT: nothing is summed. Confidence is conservative + requires_human_review + extraction:'source_type_llm'
// provenance (these are LLM extractions over OCR — real source, machine-read). NO canonical promotion here
// (RULE 0.6 gate + human review own that). Idempotent: externalId = structured:<type>:<doc_id>:<slot>, and the
// row is marked promoted=TRUE. Generic/census promote only enslaver/enslaved-typed persons (skip 'unknown'
// noise); they carry no relationship, so no edges — just gated, provenance-linked leads.
//
// Usage: node scripts/promote-structured-extractions.mjs [--type freedmens] [--limit N] [--apply]

import 'dotenv/config';
import { createRequire } from 'node:module';
import pg from 'pg';
const require = createRequire(import.meta.url);
const PersonService = require('../src/services/PersonService');

const A = process.argv.slice(2);
const ti = A.indexOf('--type'); const ONLY_TYPE = ti > -1 ? A[ti + 1] : null;
const lm = A.indexOf('--limit'); const LIMIT = lm > -1 ? +A[lm + 1] : 200;
const APPLY = A.includes('--apply');
const ID_SYSTEM = 'structured_extraction';

const clean = (s) => (s == null ? '' : String(s).trim());
const arr = (v) => (Array.isArray(v) ? v.map(clean).filter(Boolean) : (clean(v) ? [clean(v)] : []));

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 });
  // pg-pool emits 'error' on IDLE clients when the server drops a socket; Node terminates the process
  // on an unhandled 'error' event. One Neon blip therefore kills a long run, and the log reads as
  // STALLED rather than crashed -- the misdiagnosis that hid a dead fleet for five weeks.
  pool.on('error', (e) => console.error(`[pool] idle client error (continuing): ${e.message}`));
  const ps = new PersonService(pool);
  console.log(APPLY ? '=== APPLY ===' : '=== DRY RUN ===');

  const { rows } = await pool.query(
    `SELECT se.id, se.person_document_id, se.s3_key, se.source_type, se.fields,
            (SELECT d.collection_key FROM person_documents d WHERE d.id = se.person_document_id) AS collection_key
       FROM structured_extractions se
      WHERE se.promoted = FALSE AND se.n_persons > 0
        ${ONLY_TYPE ? 'AND se.source_type = $1' : ''}
      ORDER BY se.id ${Number.isFinite(LIMIT) ? 'LIMIT ' + LIMIT : ''}`,
    ONLY_TYPE ? [ONLY_TYPE] : []);
  console.log(`extractions to promote: ${rows.length}${ONLY_TYPE ? ' (type ' + ONLY_TYPE + ')' : ''}`);

  const st = { enslavers: 0, enslaved: 0, edges: 0, others: 0, docsLinked: 0, rejected: 0, rowsPromoted: 0 };

  // link the imaged page to the primary subject (once), mirroring the probate promoter's doc-link.
  async function linkDoc(docId, ref, held) {
    if (!APPLY || !docId || !ref) return;
    const col = ref.subject_table === 'canonical_persons' ? 'canonical_person_id' : 'unconfirmed_person_id';
    const upd = await pool.query(
      `UPDATE person_documents SET ${col} = COALESCE(${col}, $2)
         WHERE id = $1 AND canonical_person_id IS NULL AND unconfirmed_person_id IS NULL RETURNING id`,
      [docId, ref.subject_id]);
    st.docsLinked += upd.rows.length;
    if (held && upd.rows.length) await pool.query(
      `UPDATE person_documents SET evidences_enslaved_holding=TRUE WHERE id=$1`, [docId]).catch(() => {});
  }

  // enslaver→enslaved edge (same table/shape the probate promoter uses).
  async function ownerEdge(enslavedName, ownerName, enslavedRef, ownerRef, srcUrl, ctx, conf) {
    if (!APPLY || !enslavedRef || !ownerRef) return;
    await pool.query(
      `INSERT INTO enslaved_owner_relationships (enslaved_name, owner_name, relationship_type, relationship_source, source_url, source_context, confidence_score, verification_status, created_by, enslaved_subject_table, enslaved_subject_id, owner_subject_table, owner_subject_id)
       VALUES ($1,$2,'enslaved_by','structured_extraction',$3,$4,$5,'unverified','structured-ext-promote',$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [enslavedName, ownerName, srcUrl, ctx, conf, enslavedRef.subject_table, enslavedRef.subject_id, ownerRef.subject_table, ownerRef.subject_id]).catch(() => {});
    st.edges++;
  }

  const mkLead = (name, personType, conf, slot, docId, srcUrl, ctx, flags) => ps.findOrCreateLead({
    name, personType, locations: [], sourceType: 'secondary', confidence: conf, idSystem: ID_SYSTEM,
    externalId: `structured:${slot}:${docId}`, sourceUrl: srcUrl,
    context: ctx, dataQualityFlags: { extraction: 'source_type_llm', requires_human_review: true, ...flags },
  }, { dryRun: !APPLY });

  for (const r of rows) {
    const f = typeof r.fields === 'string' ? JSON.parse(r.fields) : r.fields;
    const src = `structured_extraction (${r.source_type}, doc ${r.person_document_id})`;
    let did = false;

    if (r.source_type === 'freedmens') {
      const dep = clean(f.depositor_name);
      const master = clean(f.last_master) || clean(f.last_mistress);
      let depRef = null, mRef = null;
      if (dep) { const d = await mkLead(dep, 'enslaved', 0.7, `freedmens:${r.person_document_id}:depositor`, r.person_document_id, r.s3_key,
        `Freedmen's Bank depositor (formerly enslaved), named their last master="${master || '?'}". LLM-extracted.`,
        { source_tier: 'primary', form: 'freedmens_depositor' });
        if (d.ref) { depRef = d.ref; st.enslaved++; await linkDoc(r.person_document_id, depRef, !!master); } else st.rejected++; }
      if (master) { const m = await mkLead(master, 'enslaver', 0.65, `freedmens:${r.person_document_id}:master`, r.person_document_id, r.s3_key,
        `Named as last master of Freedmen's Bank depositor "${dep || '?'}". LLM-extracted.`, { source_tier: 'primary', enslaved_name: dep });
        if (m.ref) { mRef = m.ref; st.enslavers++; } else st.rejected++; }
      if (depRef && mRef) await ownerEdge(dep, master, depRef, mRef, r.s3_key, `Freedmen's Bank registration, doc ${r.person_document_id}`, 0.65);
      did = true;

    } else if (r.source_type === 'probate' || r.source_type === 'will') {
      const testator = clean(f.testator);
      const enslaved = (Array.isArray(f.enslaved_persons) ? f.enslaved_persons : []).map((e) => clean(typeof e === 'string' ? e : e?.name)).filter(Boolean);
      let tRef = null;
      if (testator) { const t = await mkLead(testator, enslaved.length ? 'enslaver' : 'unknown', 0.6, `probate:${r.person_document_id}:testator`, r.person_document_id, r.s3_key,
        `Probate/will decedent${enslaved.length ? ', estate names ' + enslaved.length + ' enslaved' : ''} (${f.year || '?'}). LLM-extracted.`,
        { source_tier: 'secondary', max_evidence_tier: 'secondary', enslaved_count_documented: enslaved.length });
        if (t.ref) { tRef = t.ref; st.enslavers++; await linkDoc(r.person_document_id, tRef, enslaved.length > 0); } else st.rejected++; }
      for (const nm of enslaved) { const nr = await mkLead(nm, 'enslaved', 0.55, `probate:${r.person_document_id}:${nm}`, r.person_document_id, r.s3_key,
        `Named as enslaved by ${testator || 'a decedent'} in an LLM-extracted probate/will estate.`, { source_tier: 'secondary', enslaver_name: testator });
        if (nr.ref) { st.enslaved++; if (tRef) await ownerEdge(nm, testator, nr.ref, tRef, r.s3_key, `probate/will doc ${r.person_document_id}`, 0.55); } }
      did = true;

    } else { // generic + census_slave_schedule: gated leads for enslaver/enslaved only (skip 'unknown' noise), no edges
      for (const p of (Array.isArray(f.persons) ? f.persons : [])) {
        const nm = clean(p?.name); const pt = clean(p?.person_type);
        if (!nm || (pt !== 'enslaver' && pt !== 'enslaved')) { st.others++; continue; }
        const g = await mkLead(nm, pt, 0.55, `${r.source_type}:${r.person_document_id}:${nm}`, r.person_document_id, r.s3_key,
          `${p.role || pt} in an LLM-extracted ${f.doc_type || r.source_type} (${f.place || '?'}, ${f.year || '?'}).`,
          { source_tier: 'single_source', place: f.place || null });
        if (g.ref) { pt === 'enslaver' ? st.enslavers++ : st.enslaved++; } else st.rejected++;
      }
      did = true;
    }

    if (APPLY && did) { await pool.query(`UPDATE structured_extractions SET promoted=TRUE WHERE id=$1`, [r.id]); st.rowsPromoted++; }
  }

  await pool.end();
  console.log(`\n=== ${JSON.stringify(st)} ===`);
  if (!APPLY) console.log('(dry run — pass --apply to write)');
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
