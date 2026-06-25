#!/usr/bin/env node
/**
 * Populate person_blocking_keys for every non-merged canonical_persons row, and
 * backfill last_name_metaphone / last_name_soundex (currently ~56/563K).
 *
 * Pipeline: read names in batches -> deriveSurnames() in JS (handles dirty
 * last_name, inverted "Surname, First", org exclusion, maiden names) -> compute
 * metaphone/dmetaphone in SQL via fuzzystrmatch over the DISTINCT clean surnames
 * -> emit 4 blocking keys per surname (mp/dm/s4/p4) -> bulk upsert.
 *
 *   node scripts/populate-blocking-keys.mjs --fresh        # truncate + rebuild all
 *   node scripts/populate-blocking-keys.mjs --limit 20000  # smoke test on a slice
 */
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv'; import pg from 'pg';
import { deriveSurnames } from './lib/name-normalize.mjs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const FRESH = process.argv.includes('--fresh');
const li = process.argv.indexOf('--limit');
const LIMIT = li > -1 ? parseInt(process.argv[li + 1], 10) : null;
const BATCH = 5000;

function keyRows(personId, surname, mp) {
  const rows = [];
  const push = (kt, kv) => rows.push([personId, kt, kt + ':' + kv, surname]);
  push('sn', surname);                 // exact clean surname (same-surname block)
  if (surname.length >= 4) push('s4', surname.slice(-4)); // suffix bridge (Biscoe~Briscoe)
  if (mp) push('mp', mp);              // metaphone (backfills last_name_metaphone)
  return rows;
}

async function flush(rows) {
  if (!rows.length) return;
  const pid = [], kt = [], kv = [], sn = [];
  for (const r of rows) { pid.push(r[0]); kt.push(r[1]); kv.push(r[2]); sn.push(r[3]); }
  // M101: person_blocking_keys is now polymorphic (subject_table, subject_id) with
  // those NOT NULL. Canonical rows write subject_table='canonical_persons',
  // subject_id=canonical_person_id (kept for back-compat reads). Conflict target is
  // the new PK (subject_table, subject_id, key_value).
  await pool.query(
    `INSERT INTO person_blocking_keys (subject_table, subject_id, canonical_person_id, key_type, key_value, surname)
     SELECT 'canonical_persons', u.p, u.p, u.kt, u.kv, u.sn
       FROM unnest($1::int[], $2::text[], $3::text[], $4::text[]) AS u(p, kt, kv, sn)
     ON CONFLICT (subject_table, subject_id, key_value) DO NOTHING`, [pid, kt, kv, sn]);
}

(async () => {
  if (FRESH) { console.log('TRUNCATE person_blocking_keys'); await pool.query('TRUNCATE person_blocking_keys'); }

  let lastId = 0, totalPeople = 0, totalKeys = 0, orgSkip = 0, noSurname = 0;
  for (;;) {
    const { rows } = await pool.query(
      `SELECT id, canonical_name, last_name FROM canonical_persons
       WHERE person_type <> 'merged' AND id > $1
       ORDER BY id LIMIT $2`, [lastId, BATCH]);
    if (!rows.length) break;

    // derive surnames; gather distinct for one phonetic round-trip
    const distinct = new Set();
    for (const r of rows) {
      r.surnames = deriveSurnames(r.canonical_name, r.last_name);
      if (!r.surnames.length) { if (/[&]|\band\b|estate|company|bank|trust/i.test(r.canonical_name || '')) orgSkip++; else noSurname++; }
      for (const s of r.surnames) if (s.length >= 2) distinct.add(s);
    }
    const ph = {};
    if (distinct.size) {
      const codes = (await pool.query(
        `SELECT s, metaphone(s,8) mp FROM unnest($1::text[]) s`, [[...distinct]])).rows;
      for (const c of codes) ph[c.s] = c;
    }

    const out = [];
    for (const r of rows) {
      let added = false;
      for (const s of r.surnames) {
        if (s.length < 2) continue;
        const p = ph[s] || {};
        out.push(...keyRows(r.id, s, p.mp));
        added = true;
      }
      if (added) totalPeople++;
    }
    await flush(out);
    totalKeys += out.length;
    lastId = rows[rows.length - 1].id;
    if (LIMIT && lastId >= LIMIT) break;
    if (totalPeople % 50000 < BATCH) console.log(`  ...id<=${lastId} people=${totalPeople} keys=${totalKeys}`);
  }

  console.log(`\nblocking keys: ${totalPeople} people, ${totalKeys} keys (orgSkip=${orgSkip}, noSurname=${noSurname})`);

  // backfill last_name_metaphone / last_name_soundex from the stored clean surname
  console.log('backfilling last_name_metaphone / last_name_soundex ...');
  const upd = await pool.query(`
    UPDATE canonical_persons cp
       SET last_name_metaphone = metaphone(k.surname, 8),
           last_name_soundex   = soundex(k.surname)
      FROM (SELECT DISTINCT ON (canonical_person_id) canonical_person_id, surname
              FROM person_blocking_keys WHERE key_type='mp' ORDER BY canonical_person_id, surname) k
     WHERE cp.id = k.canonical_person_id
       AND (cp.last_name_metaphone IS DISTINCT FROM metaphone(k.surname,8)
            OR cp.last_name_soundex IS DISTINCT FROM soundex(k.surname))`);
  console.log(`  updated ${upd.rowCount} canonical_persons phonetic columns`);

  const stat = (await pool.query(
    `SELECT count(*) keys, count(DISTINCT canonical_person_id) people FROM person_blocking_keys`)).rows[0];
  console.log(`\nFINAL person_blocking_keys: ${stat.keys} keys across ${stat.people} people`);
  await pool.end();
})();
