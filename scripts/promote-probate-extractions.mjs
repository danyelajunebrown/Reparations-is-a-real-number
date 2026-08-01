// promote-probate-extractions.mjs — DE-SILO the probate LLM-extraction output onto the person spine.
//
// The probate drip writes extracted estates to `probate_estate_extractions` (decedent_name, enslaved_count,
// enslaved_persons JSONB, roll/segment). Nothing linked those decedents to persons — 2,200+ extracted
// decedents were orphaned (the "NY linker" backlog, but keyed on the EXTRACTION table, not the old
// probate_scrape_progress the deprecated link-ny-probate-testators.mjs reads). This promotes each real
// extracted decedent → an enslaver LEAD (through PersonService.findOrCreateLead — the mint gate filters
// place-word/junk decedents), links that estate's imaged pages (segment.page_doc_ids) to the lead, sets the
// gate signals when enslaved were held, and mints the NAMED enslaved (from enslaved_persons) + owner edges.
//
// AUDIT: secondary tier + requires_human_review; enslaved_count is a documented COUNT (never fabricated
// rows) — only individually-NAMED enslaved become leads; owner→enslaved edges carry the count/value as
// extracted. County derived from the doc collection_key (new-york-probate-<county>-…), never guessed.
// Idempotent (externalId = probate-ext:<roll>:<decedent_key>). Sentinel/junk extractions skipped.
//
// Usage: node scripts/promote-probate-extractions.mjs [--prefix new-york] [--limit N] [--apply]

import 'dotenv/config';
import { createRequire } from 'node:module';
import pg from 'pg';
const require = createRequire(import.meta.url);
const PersonService = require('../src/services/PersonService');

const A = process.argv.slice(2);
const pi = A.indexOf('--prefix'); const PREFIX = pi > -1 ? A[pi + 1] : null;
const lm = A.indexOf('--limit'); const LIMIT = lm > -1 ? +A[lm + 1] : Infinity;
const APPLY = A.includes('--apply');
const ID_SYSTEM = 'probate_estate';

const NY_COUNTIES = new Set(['albany','allegany','bronx','broome','cattaraugus','cayuga','chautauqua','chemung','chenango','clinton','columbia','cortland','delaware','dutchess','erie','essex','franklin','fulton','genesee','greene','hamilton','herkimer','jefferson','kings','lewis','livingston','madison','monroe','montgomery','nassau','niagara','oneida','onondaga','ontario','orange','orleans','oswego','otsego','putnam','queens','rensselaer','richmond','rockland','saratoga','schenectady','schoharie','schuyler','seneca','steuben','suffolk','sullivan','tioga','tompkins','ulster','warren','washington','wayne','westchester','wyoming','yates']);
// county from a collection_key like 'new-york-probate-cayuga-Q7TH-BZS' or a GA 'georgia-probate-liberty-…'
function countyFromCollection(ck) {
  if (!ck) return null;
  const m = String(ck).toLowerCase().match(/(?:new-york|georgia)-probate-([a-z]+)-/);
  if (!m) return null;
  const c = m[1];
  return NY_COUNTIES.has(c) ? c.charAt(0).toUpperCase() + c.slice(1) : (c.charAt(0).toUpperCase() + c.slice(1));
}
function stateFromCollection(ck) { return /new-york/.test(ck || '') ? 'New York' : (/georgia/.test(ck || '') ? 'Georgia' : null); }
// enslaved names out of the enslaved_persons JSONB (array of {name}|string), defensively.
function enslavedNames(j) {
  if (!j) return [];
  let arr = j; if (typeof j === 'string') { try { arr = JSON.parse(j); } catch { return []; } }
  if (!Array.isArray(arr)) return [];
  return arr.map((e) => (typeof e === 'string' ? e : (e && (e.name || e.given_name || e.enslaved_name)) || '')).map((s) => String(s).trim()).filter(Boolean);
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 });
  const ps = new PersonService(pool);
  console.log(APPLY ? '=== APPLY ===' : '=== DRY RUN ===');

  // real extractions with a decedent, joined to their segment's page docs; skip sentinels + already-promoted
  const { rows } = await pool.query(
    `SELECT x.id, x.roll_group_id, x.decedent_name, x.enslaved_count, x.enslaved_persons,
            s.decedent_key, s.page_doc_ids,
            (SELECT d.collection_key FROM person_documents d WHERE d.id = ANY(s.page_doc_ids) LIMIT 1) AS collection_key
       FROM probate_estate_extractions x
       JOIN probate_estate_segments_v2 s ON s.id = x.segment_id
      WHERE x.provider IS DISTINCT FROM 'sentinel'
        AND COALESCE(x.decedent_name,'') <> ''
        AND NOT EXISTS (SELECT 1 FROM person_external_ids pe WHERE pe.id_system=$1 AND pe.external_id = 'probate-ext:'||x.roll_group_id||':'||s.decedent_key)
        ${PREFIX ? "AND s.roll_group_id IN (SELECT DISTINCT roll_group_id FROM probate_estate_segments_v2 s2 JOIN person_documents d2 ON d2.id=ANY(s2.page_doc_ids) WHERE d2.collection_key LIKE '%'||$2||'%')" : ''}
      ORDER BY x.id ${Number.isFinite(LIMIT) ? 'LIMIT ' + LIMIT : ''}`,
    PREFIX ? [ID_SYSTEM, PREFIX] : [ID_SYSTEM]);
  console.log(`extractions to promote: ${rows.length}${PREFIX ? ' (prefix ' + PREFIX + ')' : ''}`);

  const st = { enslavers: 0, linked: 0, docsLinked: 0, enslaved: 0, edges: 0, rejected: 0, skipped: 0 };
  for (const r of rows) {
    const county = countyFromCollection(r.collection_key);
    const state = stateFromCollection(r.collection_key);
    const held = +r.enslaved_count || 0;
    const er = await ps.findOrCreateLead({
      name: r.decedent_name, personType: held > 0 ? 'enslaver' : 'unknown',
      locations: [ [county && county + ' County', state].filter(Boolean).join(', ') ].filter(Boolean),
      sourceType: 'secondary', confidence: 0.6, idSystem: ID_SYSTEM,
      externalId: 'probate-ext:' + r.roll_group_id + ':' + r.decedent_key,
      sourceUrl: 'FamilySearch probate (' + (r.collection_key || r.roll_group_id) + ')',
      context: `Probate decedent (LLM-extracted estate, roll ${r.roll_group_id})${held > 0 ? '; estate names ' + held + ' enslaved' : ''}.`,
      dataQualityFlags: { source_tier: 'secondary', max_evidence_tier: 'secondary', extraction: 'probate_llm', roll: r.roll_group_id, enslaved_count_documented: held, requires_human_review: true },
    }, { dryRun: !APPLY });
    if (!er.ref) { st.rejected++; continue; }            // mint gate declined (place-word / junk decedent)
    if (er.action === 'linked' || er.action === 'linked_extid') st.linked++; else st.enslavers++;

    if (APPLY && er.ref) {
      const col = er.ref.subject_table === 'canonical_persons' ? 'canonical_person_id' : 'unconfirmed_person_id';
      // link this estate's imaged pages to the decedent (only unlinked docs)
      const upd = await pool.query(
        `UPDATE person_documents SET ${col} = COALESCE(${col}, $2)
          WHERE id = ANY($1::int[]) AND canonical_person_id IS NULL AND unconfirmed_person_id IS NULL
          RETURNING id`, [r.page_doc_ids, er.ref.subject_id]);   // county lives on the person (via lead locations), not the doc
      st.docsLinked += upd.rows.length;
      if (held > 0 && upd.rows.length) {
        await pool.query(`UPDATE person_documents SET evidences_enslaved_holding=TRUE, enslaved_count=GREATEST(COALESCE(enslaved_count,0),$2) WHERE id=ANY($1::int[])`, [r.page_doc_ids, held]).catch(() => {});
      }
      // named enslaved → leads + owner edges (documented COUNT never becomes rows; only names)
      for (const nm of enslavedNames(r.enslaved_persons)) {
        const nr = await ps.findOrCreateLead({
          name: nm, personType: 'enslaved', locations: [[county && county + ' County', state].filter(Boolean).join(', ')].filter(Boolean),
          sourceType: 'secondary', confidence: 0.55, idSystem: ID_SYSTEM,
          externalId: 'probate-ext:' + r.roll_group_id + ':' + r.decedent_key + '::' + nm,
          sourceUrl: 'FamilySearch probate (' + (r.collection_key || r.roll_group_id) + ')',
          context: `Named as enslaved by ${r.decedent_name} in an LLM-extracted probate estate (roll ${r.roll_group_id}).`,
          dataQualityFlags: { source_tier: 'secondary', enslaver_name: r.decedent_name, requires_human_review: true },
        }, {});
        if (!nr.ref) continue;
        st.enslaved++;
        await pool.query(
          `INSERT INTO enslaved_owner_relationships (enslaved_name, owner_name, relationship_type, relationship_source, source_url, source_context, confidence_score, verification_status, created_by, enslaved_subject_table, enslaved_subject_id, owner_subject_table, owner_subject_id)
           VALUES ($1,$2,'enslaved_by','probate_extraction',$3,$4,0.55,'unverified','probate-ext-promote',$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
          [nm, r.decedent_name, 'FamilySearch probate', `roll ${r.roll_group_id}`, nr.ref.subject_table, nr.ref.subject_id, er.ref.subject_table, er.ref.subject_id]).catch(() => {});
        st.edges++;
      }
    }
  }
  await pool.end();
  console.log(`\n=== ${JSON.stringify(st)} ===`);
  if (!APPLY) console.log('(dry run — pass --apply to write)');
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
