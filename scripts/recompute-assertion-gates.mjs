#!/usr/bin/env node
/**
 * Recompute the external-assertion gate booleans on canonical_persons, ROLE-AWARE (#95 +
 * M102 + standard-canonical-person-and-document-gate.md).
 *
 * A proposition is assertable ONLY when a person_documents row has s3_key present (a real
 * archived file) of a substantiating type AND — for shared/probate types — the person's ROLE is
 * corroborated in the estate graph (owner vs enslaved subject). The predicate is the SAME one
 * PersonService.recomputeGate uses (imported), so single-person and bulk agree exactly.
 *
 * The prior version keyed only on document_type membership, which flipped BOTH flags for every
 * testator with a stored will (a will is in both proposition lists). This corrects that.
 *
 *   node scripts/recompute-assertion-gates.mjs            # dry-run: before/after + deltas
 *   node scripts/recompute-assertion-gates.mjs --apply    # write the booleans
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const require = createRequire(import.meta.url);
const PersonService = require('../src/services/PersonService');
const SO_SQL = PersonService.assertableSlaveownerSQL('cp.id');
const EN_SQL = PersonService.assertableEnslavedSQL('cp.id');
const UNION = [...new Set([...PersonService.DOC_PROP_SLAVEOWNER, ...PersonService.DOC_PROP_ENSLAVED])];
const APPLY = process.argv.includes('--apply');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Only canonicals with ≥1 qualifying stored doc OR a flag currently set can change; everyone
// else is FALSE→FALSE. Scoping to this candidate set makes the correlated predicate cheap.
const CAND = `
  cand AS (
    SELECT DISTINCT id FROM (
      SELECT canonical_person_id AS id FROM person_documents
        WHERE canonical_person_id IS NOT NULL AND s3_key IS NOT NULL AND document_type = ANY($1)
      UNION
      SELECT id FROM canonical_persons WHERE assertable_slaveowner OR assertable_enslaved
    ) s
  )`;

(async () => {
  try {
    const n = (v) => (+v).toLocaleString();
    const cur = (await pool.query(
      `SELECT count(*) FILTER (WHERE assertable_slaveowner) so,
              count(*) FILTER (WHERE assertable_enslaved) en,
              count(*) FILTER (WHERE assertable_slaveowner AND assertable_enslaved) both
       FROM canonical_persons`)).rows[0];

    // Projected new values + deltas over the candidate set.
    const proj = (await pool.query(
      `WITH ${CAND},
       ev AS (
         SELECT cp.id, cp.assertable_slaveowner AS so_old, cp.assertable_enslaved AS en_old,
                ${SO_SQL} AS so_new, ${EN_SQL} AS en_new
         FROM canonical_persons cp WHERE cp.id IN (SELECT id FROM cand))
       SELECT
         count(*) FILTER (WHERE so_new) so_new_total,
         count(*) FILTER (WHERE en_new) en_new_total,
         count(*) FILTER (WHERE so_new AND en_new) both_new,
         count(*) FILTER (WHERE so_old AND NOT so_new) so_lose,
         count(*) FILTER (WHERE NOT so_old AND so_new) so_gain,
         count(*) FILTER (WHERE en_old AND NOT en_new) en_lose,
         count(*) FILTER (WHERE NOT en_old AND en_new) en_gain
       FROM ev`, [UNION])).rows[0];

    console.log('=== role-aware assertion-gate recompute ' + (APPLY ? '(APPLY)' : '(DRY-RUN)') + ' ===');
    console.log('                         BEFORE      AFTER      Δ');
    console.log(`  assertable_slaveowner  ${n(cur.so).padStart(8)}  ${n(proj.so_new_total).padStart(8)}   +${proj.so_gain}/-${proj.so_lose}`);
    console.log(`  assertable_enslaved    ${n(cur.en).padStart(8)}  ${n(proj.en_new_total).padStart(8)}   +${proj.en_gain}/-${proj.en_lose}`);
    console.log(`  BOTH flags             ${n(cur.both).padStart(8)}  ${n(proj.both_new).padStart(8)}`);

    if (!APPLY) { console.log('\n(dry-run — nothing written. Re-run with --apply to write the booleans.)'); return; }

    const upd = await pool.query(
      `WITH ${CAND}
       UPDATE canonical_persons cp SET
         assertable_slaveowner = ${SO_SQL},
         assertable_enslaved   = ${EN_SQL},
         updated_at = now()
       WHERE cp.id IN (SELECT id FROM cand)
         AND (cp.assertable_slaveowner IS DISTINCT FROM ${SO_SQL}
           OR cp.assertable_enslaved   IS DISTINCT FROM ${EN_SQL})`, [UNION]);
    console.log(`\napplied: ${upd.rowCount} canonical_persons updated.`);

    const fin = (await pool.query(
      `SELECT count(*) FILTER (WHERE assertable_slaveowner) so, count(*) FILTER (WHERE assertable_enslaved) en,
              count(*) FILTER (WHERE assertable_slaveowner AND assertable_enslaved) both FROM canonical_persons`)).rows[0];
    console.log('final:', 'slaveowner', n(fin.so), '· enslaved', n(fin.en), '· both', n(fin.both));
    const ok = +fin.so === +proj.so_new_total && +fin.en === +proj.en_new_total;
    console.log('verification:', ok ? 'OK (matches projection)' : `MISMATCH (projected so=${proj.so_new_total} en=${proj.en_new_total})`);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
