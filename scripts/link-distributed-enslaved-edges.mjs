#!/usr/bin/env node
/**
 * Build 3 of the #142 plan (the UNBLOCKED half — no FamilySearch live search needed).
 *
 * The 1.4M owner-referenced enslaved leads in unconfirmed_persons ARE the distributed-holding data
 * (a big planter's enslaved appear across many counties). `enslavedCountFor` reads them at query time
 * (includeIndexLeads), but the DAA can't afford a 1.4M scan per slaveholder. This PERSISTS them as
 * `enslaved_owner_relationships` edges (owner_canonical_id → enslaved lead) so the fast `named` source
 * picks them up — finishing the "owner-lead→canonical DEFERRED" seam that build-enslaved-owner-edges.mjs
 * left open. Owner match is normalized (Jr/Sr/honorifics stripped, same as enslaved-count.js) and
 * STATE-SCOPED so a same-name owner in another state can't inflate a holder.
 *
 * Bounded to the SERVED roster enslavers (safe small batch). The live-FS-search completeness layer
 * (searchFamilySearchRecords → new ARKs beyond the ~79.5% index) stays a documented follow-on — it needs
 * the Mini + a fresh FS session (see reference_familysearch_session_reauth).
 *
 *   node scripts/link-distributed-enslaved-edges.mjs [--id=<canonicalId>] [--dry]
 */
import 'dotenv/config';
import pg from 'pg';

const norm = (s) => (s || '').toLowerCase()
  .replace(/\b(jr|sr|ii|iii|iv|col|colonel|capt|captain|gen|dr|mr|mrs|miss|est|estate|of)\b/g, '')
  .replace(/[^a-z]/g, '').trim();

const ONLY = (process.argv.find((a) => a.startsWith('--id=')) || '').split('=')[1];
const DRY = process.argv.includes('--dry');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  const targets = ONLY
    ? (await pool.query('SELECT id, canonical_name, primary_state FROM canonical_persons WHERE id=$1', [parseInt(ONLY, 10)])).rows
    : (await pool.query(
        `SELECT id, canonical_name, primary_state FROM canonical_persons
          WHERE person_type='enslaver' AND assertable_slaveowner=true
            AND (created_by IN ('roster_partner_ingest','ward_full_run') OR id IN (
                 SELECT DISTINCT canonical_person_id FROM person_documents WHERE document_type='census_slave_schedule' AND canonical_person_id IS NOT NULL))
          ORDER BY canonical_name`)).rows;

  console.log(`${targets.length} served enslaver(s) to link\n`);
  let totalEdges = 0;
  for (const cp of targets) {
    const nameNorm = norm(cp.canonical_name);
    const last = cp.canonical_name.trim().split(/\s+/).pop();
    if (!last || last.length < 3) { console.log(`  skip ${cp.canonical_name} (no usable surname)`); continue; }
    // candidate owner-referenced enslaved leads by cheap ILIKE, then exact normalized owner + state-scope
    const leads = (await pool.query(
      `SELECT lead_id, full_name, relationships->>'owner' owner, relationships->>'state' st, relationships->>'county' cty, source_url
         FROM unconfirmed_persons
        WHERE person_type='enslaved' AND relationships->>'owner' ILIKE $1 LIMIT 8000`, ['%' + last + '%'])).rows
      .filter((r) => norm(r.owner) === nameNorm && (!cp.primary_state || !r.st || norm(r.st) === norm(cp.primary_state)));
    if (!leads.length) { console.log(`  ${cp.canonical_name.padEnd(24)} 0 matched leads`); continue; }
    const counties = [...new Set(leads.map((l) => `${l.cty || '?'},${l.st || '?'}`))];
    if (DRY) { console.log(`  [dry] ${cp.canonical_name.padEnd(24)} ${leads.length} leads across ${counties.length} counties: ${counties.slice(0,4).join(' | ')}`); totalEdges += leads.length; continue; }
    let n = 0;
    for (const l of leads) {
      const r = await pool.query(
        `INSERT INTO enslaved_owner_relationships
           (enslaved_person_id, enslaved_subject_table, enslaved_subject_id, enslaved_name,
            owner_person_id, owner_canonical_id, owner_subject_table, owner_subject_id, owner_name,
            relationship_type, start_year, relationship_source, source_url, confidence_score, verification_status, created_by)
         VALUES ($1,'unconfirmed_persons',$1,$2, $3,$3,'canonical_persons',$3,$4,
                 'enslaved_by',1860,'us_1860_slave_schedule_index',$5,0.85,'unverified','link_distributed_edges')
         ON CONFLICT (enslaved_person_id, owner_person_id, relationship_type) DO NOTHING RETURNING id`,
        [l.lead_id, l.full_name, cp.id, cp.canonical_name, l.source_url]);
      if (r.rows.length) n++;
    }
    totalEdges += n;
    console.log(`  ${cp.canonical_name.padEnd(24)} +${n} edges across ${counties.length} counties (${counties.slice(0,3).join(' | ')}${counties.length>3?' …':''})`);
  }
  console.log(`\n${DRY ? '[dry] would link' : 'linked'} ${totalEdges} distributed enslaved edges.`);
  await pool.end();
}
main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
