// promote-curated-source.mjs — RULE 0.6 bulk promotion for a SOURCE that is already internally deduped
// (IISG Id_person, LBS person id, …). The missing half of the pipeline: turns image-backed LEADS into
// canonical persons so they SURFACE on search + are assertable. Fixes the two bugs the naive promote hit:
//   (1) create-per-source-record — do NOT block on same-name ambiguity (Biscoe ambiguity is for cross-
//       source MERGE, which runs later as review candidates; the source guarantees intra-source distinct).
//   (2) MIGRATE identity (move, not re-insert): ext-id + blocking keys + document lead→canonical, so the
//       source id isn't orphaned by an ON CONFLICT. Set-based, batched (fast). Cross-source dedup = later.
//
// Only promotes leads that SERVE AN IMAGE (a person_documents.s3_key) — RULE 0.6. recomputeGate is applied
// set-based for the doc'd proposition. Resumable (status='promoted'). Idempotent per batch (transaction).
//
// Usage: node scripts/promote-curated-source.mjs --id-system hdsc_suriname_slaveregister [--limit N] [--apply]

import 'dotenv/config';
import pg from 'pg';

const A = process.argv.slice(2);
const idi = A.indexOf('--id-system'); const IDSYS = idi > -1 ? A[idi + 1] : null;
const li = A.indexOf('--limit'); const LIMIT = li > -1 ? +A[li + 1] : Infinity;
const APPLY = A.includes('--apply');
const BATCH = 1000;
if (!IDSYS) { console.error('usage: --id-system <sys> [--limit N] [--apply]'); process.exit(1); }

const norm = (s) => (s == null ? '' : String(s)).toLowerCase().replace(/[^a-z0-9]/g, '');
function parseName(full) {
  const parts = String(full || '').trim().split(/[\s,]+/).filter(Boolean);
  if (!parts.length) return { first: '', last: '' };
  if (String(full).includes(',')) return { first: parts[1] || '', last: parts[0] };
  return { first: parts[0], last: parts.length > 1 ? parts[parts.length - 1] : '' };
}
const sex1 = (s) => { const c = (s == null ? '' : String(s)).trim().toLowerCase()[0]; return c === 'm' ? 'm' : c === 'f' ? 'f' : null; };

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const total = (await pool.query(
    `SELECT count(DISTINCT u.lead_id)::int n FROM unconfirmed_persons u
       JOIN person_external_ids e ON e.subject_table='unconfirmed_persons' AND e.subject_id=u.lead_id AND e.id_system=$1
       JOIN person_documents d ON d.unconfirmed_person_id=u.lead_id AND d.s3_key IS NOT NULL
      WHERE COALESCE(u.status,'')<>'promoted' AND u.full_name IS NOT NULL`, [IDSYS])).rows[0].n;
  console.log(`image-backed ${IDSYS} leads to promote: ${total}${APPLY ? '' : ' [DRY-RUN]'}`);
  if (!APPLY) { await pool.end(); return; }

  let promoted = 0, docs = 0, batches = 0;
  for (;;) {
    if (promoted >= LIMIT) break;
    const { rows } = await pool.query(
      `SELECT DISTINCT u.lead_id, u.full_name, u.birth_year, u.gender, u.person_type,
              u.locations[array_upper(u.locations,1)] AS primary_state
         FROM unconfirmed_persons u
         JOIN person_external_ids e ON e.subject_table='unconfirmed_persons' AND e.subject_id=u.lead_id AND e.id_system=$1
         JOIN person_documents d ON d.unconfirmed_person_id=u.lead_id AND d.s3_key IS NOT NULL
        WHERE COALESCE(u.status,'')<>'promoted' AND u.full_name IS NOT NULL
        ORDER BY u.lead_id LIMIT $2`, [IDSYS, BATCH]);
    if (!rows.length) break;
    const names = [], firsts = [], lasts = [], sexes = [], ptypes = [], births = [], states = [], leads = [];
    for (const r of rows) {
      const { first, last } = parseName(r.full_name);
      names.push(r.full_name); firsts.push(first || null); lasts.push(last || null);
      sexes.push(sex1(r.gender)); ptypes.push(r.person_type || 'enslaved'); births.push(r.birth_year || null);
      states.push(r.primary_state || null); leads.push(r.lead_id);
    }
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      // 1. create canonicals, carrying lead_id in created_by ('pc:<lead>')
      const ins = await c.query(
        `INSERT INTO canonical_persons
           (canonical_name, first_name, last_name, first_name_soundex, last_name_soundex, last_name_metaphone,
            sex, person_type, birth_year_estimate, primary_state, confidence_score, verification_status, created_by)
         SELECT b.name, b.first, b.last, soundex(COALESCE(b.first,'')), soundex(COALESCE(b.last,'')), metaphone(COALESCE(b.last,''),8),
                b.sex, b.ptype, b.birth, b.state, 0.85, 'promoted', 'pc:'||b.lead
           FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::int[],$7::text[],$8::bigint[])
                AS b(name,first,last,sex,ptype,birth,state,lead)
         RETURNING id, created_by`,
        [names, firsts, lasts, sexes, ptypes, births, states, leads]);
      const mLead = [], mCid = [];
      for (const r of ins.rows) { mLead.push(parseInt(r.created_by.slice(3), 10)); mCid.push(r.id); }
      // 2. migrate ext-ids (polymorphic + canonical_person_id)
      await c.query(
        `UPDATE person_external_ids e SET canonical_person_id=m.cid, subject_table='canonical_persons', subject_id=m.cid
           FROM unnest($1::bigint[],$2::int[]) AS m(lead,cid)
          WHERE e.subject_table='unconfirmed_persons' AND e.subject_id=m.lead`, [mLead, mCid]);
      // 3. migrate blocking keys
      await c.query(
        `UPDATE person_blocking_keys k SET subject_table='canonical_persons', subject_id=m.cid, canonical_person_id=m.cid
           FROM unnest($1::bigint[],$2::int[]) AS m(lead,cid)
          WHERE k.subject_table='unconfirmed_persons' AND k.subject_id=m.lead`, [mLead, mCid]);
      // 4. migrate documents (the scan) lead→canonical
      const dm = await c.query(
        `UPDATE person_documents d SET canonical_person_id=m.cid, unconfirmed_person_id=NULL
           FROM unnest($1::bigint[],$2::int[]) AS m(lead,cid) WHERE d.unconfirmed_person_id=m.lead RETURNING 1`, [mLead, mCid]);
      // 5. mark leads promoted
      await c.query(
        `UPDATE unconfirmed_persons u SET status='promoted', reviewed_at=now(), reviewed_by='promote-curated'
           FROM unnest($1::bigint[]) AS m(lead) WHERE u.lead_id=m.lead`, [mLead]);
      // 6. clean created_by + lift the gate for the documented proposition (enslaved w/ a stored register scan)
      await c.query(
        `UPDATE canonical_persons SET created_by='promote-curated',
            assertable_enslaved = (person_type='enslaved'),
            assertable_slaveowner = (person_type IN ('enslaver','slaveholder','owner'))
          WHERE id = ANY($1::int[])`, [mCid]);
      await c.query('COMMIT');
      promoted += mCid.length; docs += dm.rows.length; batches++;
    } catch (e) { await c.query('ROLLBACK'); console.error('\nbatch ROLLBACK:', e.message); break; }
    finally { c.release(); }
    process.stdout.write(`\r  promoted ${promoted}/${total}, docs migrated ${docs}   `);
  }
  await pool.end();
  console.log(`\n=== done: promoted ${promoted} canonicals, ${docs} docs migrated, ${batches} batches ===`);
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
