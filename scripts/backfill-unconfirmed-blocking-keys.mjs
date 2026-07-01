#!/usr/bin/env node
/**
 * De-silo the LEAD side of the identity spine: `unconfirmed_persons` has ~2.43M rows but only ~0.13%
 * carry person_blocking_keys, so virtually every lead is invisible to PersonService.resolve /
 * find_person_match → new inflows can't dedup against them and the /review dedup queue can't see them.
 * This is the lead analog of backfill-orphan-canonical-keys.mjs (which took canonicals to 97.9%).
 *
 * Writes the SAME keys PersonService._queryKeys produces (so resolve() actually matches across tables):
 *   sn:<surname>, s4:<surname[-4:]>, mp:<metaphone(surname)>   (when a surname is parseable)
 *   nmsx:<normname>:<sex>, nmsxb:<normname>:<sex>:<birth-decade> (always — this is what keys first-names)
 * Polymorphic insert (subject_table='unconfirmed_persons', subject_id=lead_id), NO canonical_person_id —
 * exactly matching PersonService._writeBlockingKeys. Every key capped at 64 (varchar(64)). Idempotent.
 * Metaphone computed once per batch over distinct surnames. Skips promoted/merged leads (their identity
 * moved to a canonical; PersonService deletes their keys on promotion) and name_artifact-flagged junk (⑤).
 *
 *   node scripts/backfill-unconfirmed-blocking-keys.mjs            # dry-run (full count + rate)
 *   node scripts/backfill-unconfirmed-blocking-keys.mjs --apply
 */
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv'; import pg from 'pg';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const APPLY = process.argv.includes('--apply');
const BATCH = 5000;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Same normalization/parse as PersonService._queryKeys (keys MUST be byte-identical to cross-match).
const norm = (s) => (s == null ? '' : String(s)).toLowerCase().replace(/[^a-z0-9]/g, '');
const sex1 = (s) => { const c = (s == null ? '' : String(s)).trim().toLowerCase()[0]; return c === 'm' ? 'm' : c === 'f' ? 'f' : 'u'; };
function parseName(full) {
  const parts = String(full || '').trim().split(/[\s,]+/).filter(Boolean);
  if (!parts.length) return { first: '', last: '' };
  if (String(full).includes(',')) return { first: parts[1] || '', last: parts[0] };
  return { first: parts[0], last: parts.length > 1 ? parts[parts.length - 1] : '' };
}
const cap = (k) => (k.length > 64 ? k.slice(0, 64) : k);

// Retry transient Neon network drops (ETIMEDOUT/ECONNRESET) so a long run survives a blip.
async function q(text, params, tries = 5) {
  for (let i = 0; ; i++) {
    try { return await pool.query(text, params); }
    catch (e) {
      if (i >= tries || !/ETIMEDOUT|ECONNRESET|socket|termination|timeout|Connection terminated/i.test(e.message)) throw e;
      console.warn(`  (transient: ${e.message} — retry ${i + 1}/${tries})`);
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
}

// Shared WHERE so the count and the batch loop select exactly the same population.
const FILTER = `full_name IS NOT NULL AND length(trim(full_name)) > 1
  AND (status IS NULL OR status NOT IN ('promoted','merged'))
  AND (data_quality_flags->>'name_artifact') IS DISTINCT FROM 'true'`;

(async () => {
  try {
    console.log(`=== backfill-unconfirmed-blocking-keys ${APPLY ? '(APPLY)' : '(DRY-RUN)'} ===`);
    // Full magnitude up front so a dry-run reports the real scale, not just a sample.
    const todo = (await q(
      `SELECT count(*) c FROM unconfirmed_persons up WHERE ${FILTER}
         AND NOT EXISTS (SELECT 1 FROM person_blocking_keys k WHERE k.subject_table='unconfirmed_persons' AND k.subject_id=up.lead_id)`)).rows[0].c;
    console.log(`unkeyed leads to process: ${(+todo).toLocaleString()}`);

    // START_ID skips an already-keyed prefix so a resume doesn't re-scan millions of NOT EXISTS rows.
    let lastId = parseInt(process.env.START_ID || '0', 10), people = 0, keys = 0, batches = 0;
    if (lastId) console.log(`resuming from lead_id > ${lastId.toLocaleString()}`);
    for (;;) {
      const { rows } = await q(`
        SELECT up.lead_id AS id, up.full_name AS name, up.gender AS sex, up.birth_year
        FROM unconfirmed_persons up
        WHERE ${FILTER} AND up.lead_id > $1
          AND NOT EXISTS (SELECT 1 FROM person_blocking_keys k WHERE k.subject_table='unconfirmed_persons' AND k.subject_id=up.lead_id)
        ORDER BY up.lead_id LIMIT $2`, [lastId, BATCH]);
      if (!rows.length) break;
      batches++;
      lastId = rows[rows.length - 1].id;

      // one metaphone round-trip per batch over distinct surnames
      const surnameOf = new Map(); const distinct = new Set();
      for (const r of rows) {
        const sur = norm(parseName(r.name).last);
        surnameOf.set(r.id, sur);
        if (sur.length >= 2) distinct.add(sur);
      }
      const mpOf = {};
      if (distinct.size) {
        for (const c of (await q(`SELECT s, metaphone(s,8) mp FROM unnest($1::text[]) s`, [[...distinct]])).rows) mpOf[c.s] = c.mp;
      }

      const sid = [], kt = [], kv = [];
      for (const r of rows) {
        const sur = surnameOf.get(r.id);
        const nm = norm(r.name);
        const sx = sex1(r.sex);
        const add = (t, v) => { sid.push(r.id); kt.push(t); kv.push(cap(t + ':' + v)); };
        let any = false;
        if (sur.length >= 2) { add('sn', sur); any = true; if (sur.length >= 4) add('s4', sur.slice(-4)); if (mpOf[sur]) add('mp', mpOf[sur]); }
        if (nm) { add('nmsx', nm + ':' + sx); any = true; if (r.birth_year) add('nmsxb', nm + ':' + sx + ':' + (Math.floor(r.birth_year / 10) * 10)); }
        if (any) people++;
      }
      keys += kv.length;
      if (APPLY && kv.length) {
        await q(`
          INSERT INTO person_blocking_keys (subject_table, subject_id, key_type, key_value)
          SELECT 'unconfirmed_persons', u.p, u.kt, u.kv FROM unnest($1::int[], $2::text[], $3::text[]) AS u(p, kt, kv)
          ON CONFLICT (subject_table, subject_id, key_value) DO NOTHING`, [sid, kt, kv]);
      }
      if (batches % 10 === 0) console.log(`  ...lead_id<=${lastId} people=${people.toLocaleString()} keys=${keys.toLocaleString()}`);
      if (!APPLY && batches >= 3) { console.log('  (dry-run: stopping after 3 batches — projecting from the rate above)'); break; }
    }
    console.log(`\n${APPLY ? 'WROTE' : 'sampled'}: ${people.toLocaleString()} leads keyed, ${keys.toLocaleString()} keys${APPLY ? '' : ' (in 3 batches)'}`);
    if (!APPLY) console.log(`re-run with --apply for the full ${(+todo).toLocaleString()} leads (~${(keys / Math.max(people,1)).toFixed(1)} keys/lead)`);
  } catch (e) { console.error('ERROR:', e.message); process.exitCode = 1; }
  finally { await pool.end(); }
})();
