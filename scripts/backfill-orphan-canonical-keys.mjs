#!/usr/bin/env node
/**
 * De-silo the canonical_persons that have a name but ZERO person_blocking_keys (174,732 found by the
 * Phase-1 retrieval-health harness) — overwhelmingly first-name-only enslaved people (Hall /
 * Louisiana / SlaveVoyages imports) for whom the surname-only populator emitted nothing, so they're
 * invisible to PersonService.resolve / find_person_match → future inflows duplicate them.
 *
 * Writes the SAME keys PersonService._queryKeys produces (so resolve() actually finds them):
 *   sn:<surname>, s4:<surname[-4:]>, mp:<metaphone(surname)>   (when a surname is parseable)
 *   nmsx:<normname>:<sex>, nmsxb:<normname>:<sex>:<birth-decade> (always — this is what keys first-names)
 * Every key capped at 64 (person_blocking_keys.key_value is varchar(64)). Idempotent (ON CONFLICT).
 * Batched; metaphone computed once per batch over distinct surnames.
 *
 *   node scripts/backfill-orphan-canonical-keys.mjs            # dry-run (measure)
 *   node scripts/backfill-orphan-canonical-keys.mjs --apply
 */
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv'; import pg from 'pg';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const APPLY = process.argv.includes('--apply');
const BATCH = 5000;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const norm = (s) => (s == null ? '' : String(s)).toLowerCase().replace(/[^a-z0-9]/g, '');
const sex1 = (s) => { const c = (s == null ? '' : String(s)).trim().toLowerCase()[0]; return c === 'm' ? 'm' : c === 'f' ? 'f' : 'u'; };
function parseName(full) {
  const parts = String(full || '').trim().split(/[\s,]+/).filter(Boolean);
  if (!parts.length) return { first: '', last: '' };
  if (String(full).includes(',')) return { first: parts[1] || '', last: parts[0] };
  return { first: parts[0], last: parts.length > 1 ? parts[parts.length - 1] : '' };
}
const cap = (k) => (k.length > 64 ? k.slice(0, 64) : k);

(async () => {
  try {
    console.log(`=== backfill-orphan-canonical-keys ${APPLY ? '(APPLY)' : '(DRY-RUN)'} ===`);
    let lastId = 0, people = 0, keys = 0, batches = 0;
    for (;;) {
      const { rows } = await pool.query(`
        SELECT cp.id, cp.canonical_name, cp.last_name, cp.sex, cp.birth_year_estimate
        FROM canonical_persons cp
        WHERE cp.canonical_name IS NOT NULL AND length(trim(cp.canonical_name)) > 1 AND cp.person_type <> 'merged'
          AND cp.id > $1
          AND NOT EXISTS (SELECT 1 FROM person_blocking_keys k WHERE k.subject_table='canonical_persons' AND k.subject_id=cp.id)
        ORDER BY cp.id LIMIT $2`, [lastId, BATCH]);
      if (!rows.length) break;
      batches++;
      lastId = rows[rows.length - 1].id;

      // gather distinct surnames for one metaphone round-trip
      const surnameOf = new Map();
      const distinct = new Set();
      for (const r of rows) {
        const last = r.last_name && r.last_name.trim() ? r.last_name : parseName(r.canonical_name).last;
        const sur = norm(last);
        surnameOf.set(r.id, sur);
        if (sur.length >= 2) distinct.add(sur);
      }
      const mpOf = {};
      if (distinct.size) {
        for (const c of (await pool.query(`SELECT s, metaphone(s,8) mp FROM unnest($1::text[]) s`, [[...distinct]])).rows) mpOf[c.s] = c.mp;
      }

      const sid = [], kt = [], kv = [];
      for (const r of rows) {
        const sur = surnameOf.get(r.id);
        const nm = norm(r.canonical_name);
        const sx = sex1(r.sex);
        const add = (t, v) => { sid.push(r.id); kt.push(t); kv.push(cap(t + ':' + v)); };
        let any = false;
        if (sur.length >= 2) { add('sn', sur); any = true; if (sur.length >= 4) add('s4', sur.slice(-4)); if (mpOf[sur]) add('mp', mpOf[sur]); }
        if (nm) { add('nmsx', nm + ':' + sx); any = true; if (r.birth_year_estimate) add('nmsxb', nm + ':' + sx + ':' + (Math.floor(r.birth_year_estimate / 10) * 10)); }
        if (any) people++;
      }
      keys += kv.length;
      if (APPLY && kv.length) {
        await pool.query(`
          INSERT INTO person_blocking_keys (subject_table, subject_id, canonical_person_id, key_type, key_value)
          SELECT 'canonical_persons', u.p, u.p, u.kt, u.kv FROM unnest($1::int[], $2::text[], $3::text[]) AS u(p, kt, kv)
          ON CONFLICT (subject_table, subject_id, key_value) DO NOTHING`, [sid, kt, kv]);
      }
      if (batches % 5 === 0) console.log(`  ...id<=${lastId} people=${people.toLocaleString()} keys=${keys.toLocaleString()}`);
      if (!APPLY && batches >= 3) { console.log('  (dry-run: stopping after 3 batches — projecting)'); break; }
    }
    console.log(`\n${APPLY ? 'WROTE' : 'would write (per-batch rate)'}: ${people.toLocaleString()} people keyed, ${keys.toLocaleString()} keys`);
    if (!APPLY) console.log('(dry-run sampled first batches — re-run with --apply for the full ~174K)');
  } catch (e) { console.error('ERROR:', e.message); process.exitCode = 1; }
  finally { await pool.end(); }
})();
