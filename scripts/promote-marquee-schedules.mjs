#!/usr/bin/env node
/**
 * Promote a marquee slave-schedule LEAD → served canonical enslaver — ONLY after I have visually
 * verified the schedule image shows the right person as owner with enslaved enumerated.
 * Run per lead: node scripts/promote-marquee-schedules.mjs <lead_id> [--dry]
 * (Refuses unless a census_slave_schedule person_documents row with s3_key exists on the lead.)
 *
 * census_slave_schedule is OWNER_NAMED → the stored image lifts assertable_slaveowner in one step,
 * no owner-edge needed (the schedule names the owner unambiguously). Never auto-runs; human-gated.
 */
import 'dotenv/config';
import pg from 'pg';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const PersonService = require('../src/services/PersonService');

const leadId = parseInt(process.argv[2], 10);
const DRY = process.argv.includes('--dry');
const NAME_OVERRIDE = (process.argv.find(a => a.startsWith('--name=')) || '').split('=').slice(1).join('=') || null;
if (!leadId) { console.error('usage: promote-marquee-schedules.mjs <lead_id> [--dry]'); process.exit(2); }
const BY = 'roster_partner_ingest';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const client = await pool.connect();
const ps = new PersonService(client);
const parseName = (f) => { const p = String(f).trim().split(/\s+/); return { first: p[0]||'', last: p.length>1?p[p.length-1]:'' }; };

async function main() {
  const L = (await client.query(`SELECT lead_id, full_name, person_type, birth_year, locations FROM unconfirmed_persons WHERE lead_id=$1`, [leadId])).rows[0];
  if (!L) { console.error('no lead', leadId); process.exit(2); }
  const doc = (await client.query(
    `SELECT id, s3_key, s3_url, source_url, title FROM person_documents
      WHERE unconfirmed_person_id=$1 AND document_type='census_slave_schedule' AND s3_key IS NOT NULL LIMIT 1`, [leadId])).rows[0];
  if (!doc) { console.error(`REFUSING: lead ${leadId} has no stored census_slave_schedule (pull not landed / login-walled).`); process.exit(3); }

  const state = (L.locations && L.locations[0]) ? String(L.locations[0]).split(',').slice(-1)[0].trim() : null;
  const county = (L.locations && L.locations[0]) ? String(L.locations[0]).split(',')[0].trim() : null;
  console.log(`Promote lead#${leadId} "${L.full_name}" [${county||''}, ${state||''}] — schedule doc #${doc.id} (${doc.s3_key})`);
  if (DRY) { console.log('[dry] would create canonical (enslaver) + repoint doc + recomputeGate → served'); client.release(); await pool.end(); return; }

  await client.query('BEGIN');
  let cid;
  try {
    const canonName = NAME_OVERRIDE || L.full_name;
  const { first, last } = parseName(canonName);
    const ins = await client.query(
      `INSERT INTO canonical_persons
         (canonical_name, first_name, last_name, first_name_soundex, last_name_soundex, last_name_metaphone,
          sex, person_type, primary_state, primary_county, confidence_score, verification_status, created_by, notes)
       VALUES ($1,$2::text,$3::text, soundex($2::text), soundex($3::text), metaphone($3::text,8),
               null,'enslaver',$4,$5,0.97,'verified',$6,$7) RETURNING id`,
      [canonName, first||null, last||null, state, county, BY,
       JSON.stringify({ source: 'us_1860_slave_schedule', provenance_url: doc.source_url, cite: doc.title,
         identity_note: `Named as slaveowner on the 1860 U.S. Census Slave Schedule, ${county||''}, ${state||''}. Image verified + stored in S3.` })]);
    cid = ins.rows[0].id;
    await ps._writeBlockingKeys('canonical_persons', cid, { name: L.full_name });
    // repoint the stored schedule doc from the lead to the new canonical
    await client.query(`UPDATE person_documents SET canonical_person_id=$1, unconfirmed_person_id=NULL WHERE id=$2`, [cid, doc.id]);
    await client.query(`UPDATE unconfirmed_persons SET status='promoted', reviewed_by=$2, review_notes=COALESCE(review_notes,'')||$3 WHERE lead_id=$1`,
      [leadId, BY, ` [promoted→canonical#${cid} via verified 1860 slave schedule]`]).catch(()=>{});
    await client.query(`DELETE FROM person_blocking_keys WHERE subject_table='unconfirmed_persons' AND subject_id=$1`, [leadId]).catch(()=>{});
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }

  const g = await ps.recomputeGate(cid);
  const served = await client.query(`SELECT 1 FROM canonical_persons WHERE id=$1 AND assertable_slaveowner`, [cid]);
  console.log(`→ canonical#${cid}  assertable_slaveowner=${g.assertable_slaveowner}  ${served.rows.length ? 'T3 SERVED' : 'GATED?!'}`);
  client.release(); await pool.end();
}
main().catch(async e => { console.error('ERROR:', e.message); try{await client.query('ROLLBACK')}catch{}; try{client.release()}catch{}; try{await pool.end()}catch{}; process.exit(1); });
