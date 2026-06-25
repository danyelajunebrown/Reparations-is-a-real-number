#!/usr/bin/env node
/**
 * Populate person_blocking_keys for SlaveVoyages PAST LEADS
 * (slavevoyages_past_people) so they join canonicals in the SINGLE identity-resolution
 * layer (M101 polymorphic subject). See memory-bank/plan-lead-identity-resolution.md.
 *
 * PAST is first-name-only, so keys are CONTEXT keys, NEVER bare name (Biscoe rule):
 *   voy:<voyage_id>            same-voyage block
 *   own:<owner>               same-owner / manifest block (Oceans of Kinfolk)
 *   nmsx:<name>:<sex>         name + sex composite
 *   nmsxb:<name>:<sex>:<decade> name + sex + birth-decade (year - age)
 * Unnamed / placeholder rows are excluded (must never be name-merged).
 *
 * Subject convention for leads: subject_id = the source's stable INTEGER id — here
 * sv_id (SlaveVoyages enslaved_id; the staging PK is a UUID). Writes are polymorphic
 * (subject_table='slavevoyages_past_people'); canonical_person_id stays NULL.
 *
 * Does NOT create canonicals or merge anything — just makes leads discoverable/
 * blockable. Candidate generation + review is a SEPARATE step.
 *
 *   node scripts/populate-blocking-keys-slavevoyages-past.mjs [--dry] [--fresh] [--limit N]
 */
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv'; import pg from 'pg';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const DRY = process.argv.includes('--dry');
const FRESH = process.argv.includes('--fresh');
const li = process.argv.indexOf('--limit');
const LIMIT = li > -1 ? parseInt(process.argv[li + 1], 10) : null;
const BATCH = 5000;
const SUBJECT = 'slavevoyages_past_people';

const norm = (s) => (s == null ? '' : String(s)).toLowerCase().replace(/[^a-z0-9]/g, '');
const sex1 = (s) => { const c = (s == null ? '' : String(s)).trim().toLowerCase()[0]; return c === 'm' ? 'm' : c === 'f' ? 'f' : 'u'; };

function keyRows(subjectId, r) {
  const rows = [];
  const push = (kt, val) => { if (val != null && val !== '') rows.push([subjectId, kt, kt + ':' + val]); };
  const nm = norm(r.name) || norm(r.name_modern);
  const sx = sex1(r.sex);
  if (r.voyage_id) push('voy', String(r.voyage_id).replace(/[^a-z0-9]/gi, ''));
  if (r.owner_name) push('own', norm(r.owner_name).slice(0, 40));
  if (nm) push('nmsx', nm + ':' + sx);
  if (nm && r.year != null && r.age != null && +r.age > 0) {
    const by = Math.round(+r.year - +r.age);
    if (by > 1400 && by < 1900) push('nmsxb', nm + ':' + sx + ':' + (Math.floor(by / 10) * 10));
  }
  return rows;
}

async function flush(rows) {
  if (!rows.length) return 0;
  const sid = [], kt = [], kv = [];
  for (const r of rows) { sid.push(r[0]); kt.push(r[1]); kv.push(r[2]); }
  const res = await pool.query(
    `INSERT INTO person_blocking_keys (subject_table, subject_id, key_type, key_value)
     SELECT $1, u.sid, u.kt, u.kv
       FROM unnest($2::int[], $3::text[], $4::text[]) AS u(sid, kt, kv)
     ON CONFLICT (subject_table, subject_id, key_value) DO NOTHING`, [SUBJECT, sid, kt, kv]);
  return res.rowCount;
}

const REALNAME = `name IS NOT NULL AND name !~ '^[0-9]+$' AND length(trim(name)) > 1`;

(async () => {
  console.log(`PAST blocking keys ${DRY ? '(DRY)' : ''}…`);
  if (FRESH && !DRY) { const d = await pool.query(`DELETE FROM person_blocking_keys WHERE subject_table=$1`, [SUBJECT]); console.log(`cleared ${d.rowCount} existing PAST keys`); }

  let cursor = 0, people = 0, keys = 0, processed = 0;
  for (;;) {
    const { rows } = await pool.query(
      `SELECT sv_id::int AS sid, name, name_modern, sex, age, year, voyage_id, owner_name
         FROM slavevoyages_past_people
        WHERE sv_id ~ '^[0-9]+$' AND sv_id::int > $1 AND ${REALNAME}
        ORDER BY sv_id::int LIMIT $2`, [cursor, BATCH]);
    if (!rows.length) break;
    const out = [];
    for (const r of rows) { const kr = keyRows(r.sid, r); if (kr.length) { out.push(...kr); people++; } }
    if (!DRY) keys += await flush(out); else keys += out.length;
    processed += rows.length;
    cursor = rows[rows.length - 1].sid;
    if (processed % 50000 < BATCH) console.log(`  …sv_id<=${cursor} people=${people} keys=${keys}`);
    if (LIMIT && processed >= LIMIT) break;
  }
  console.log(`\nPAST: ${people} leads keyed, ${keys} keys ${DRY ? '(projected)' : 'written'}`);
  if (!DRY) {
    const s = (await pool.query(`SELECT count(*) keys, count(DISTINCT subject_id) leads FROM person_blocking_keys WHERE subject_table=$1`, [SUBJECT])).rows[0];
    console.log(`person_blocking_keys[${SUBJECT}]: ${s.keys} keys across ${s.leads} leads`);
  }
  await pool.end();
})();
