#!/usr/bin/env node
/**
 * Backfill / recompute the external-assertion gate booleans on canonical_persons from the
 * STORED documents in person_documents (M102 + standard-canonical-person-and-document-gate.md).
 *
 * A proposition is assertable ONLY when a person_documents row has s3_key present (a real
 * archived file, not a URL pointer) AND a document_type that substantiates it (DOC_PROP_*,
 * single source of truth in PersonService). This makes the gate columns TRUTHFUL across the
 * whole corpus. It is SAFE/REVERSIBLE and — until the public search/API is wired to FILTER on
 * these columns — operationally inert (no consumer reads them yet, so nothing visible changes).
 *
 *   node scripts/recompute-assertion-gates.mjs            # dry-run (measure only)
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
const SO = PersonService.DOC_PROP_SLAVEOWNER;
const EN = PersonService.DOC_PROP_ENSLAVED;
const APPLY = process.argv.includes('--apply');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    const tot = +(await pool.query('SELECT count(*) c FROM canonical_persons')).rows[0].c;
    // Distinct canonicals that SHOULD be assertable for each proposition (have ≥1 qualifying stored doc).
    const q = async (types) => +(await pool.query(
      `SELECT count(DISTINCT canonical_person_id) c FROM person_documents
       WHERE canonical_person_id IS NOT NULL AND s3_key IS NOT NULL AND document_type = ANY($1)`, [types])).rows[0].c;
    const soShould = await q(SO), enShould = await q(EN);
    const eitherShould = await q([...new Set([...SO, ...EN])]);
    console.log('=== assertion-gate backfill ' + (APPLY ? '(APPLY)' : '(DRY-RUN)') + ' ===');
    console.log('total canonical_persons:', tot.toLocaleString());
    console.log('should be assertable (≥1 qualifying STORED doc):', eitherShould.toLocaleString(), `(${(100 * eitherShould / tot).toFixed(1)}%)`);
    console.log('  · slaveowner:', soShould.toLocaleString(), '· enslaved:', enShould.toLocaleString());
    console.log('will stay gated:', (tot - eitherShould).toLocaleString(), `(${(100 * (tot - eitherShould) / tot).toFixed(1)}%)`);

    if (!APPLY) { console.log('\n(dry-run — nothing written. Re-run with --apply to write the booleans.)'); return; }

    // Set-based: flip to the correct value only where it differs (cheap; the migration left all FALSE).
    const so = await pool.query(
      `UPDATE canonical_persons SET assertable_slaveowner = TRUE, updated_at = now()
       WHERE assertable_slaveowner = FALSE AND id IN (
         SELECT DISTINCT canonical_person_id FROM person_documents
         WHERE canonical_person_id IS NOT NULL AND s3_key IS NOT NULL AND document_type = ANY($1))`, [SO]);
    const en = await pool.query(
      `UPDATE canonical_persons SET assertable_enslaved = TRUE, updated_at = now()
       WHERE assertable_enslaved = FALSE AND id IN (
         SELECT DISTINCT canonical_person_id FROM person_documents
         WHERE canonical_person_id IS NOT NULL AND s3_key IS NOT NULL AND document_type = ANY($1))`, [EN]);
    // Safety: downgrade any TRUE that no longer qualifies (idempotent re-runs / removed docs).
    const soDown = await pool.query(
      `UPDATE canonical_persons SET assertable_slaveowner = FALSE, updated_at = now()
       WHERE assertable_slaveowner = TRUE AND id NOT IN (
         SELECT DISTINCT canonical_person_id FROM person_documents
         WHERE canonical_person_id IS NOT NULL AND s3_key IS NOT NULL AND document_type = ANY($1))`, [SO]);
    const enDown = await pool.query(
      `UPDATE canonical_persons SET assertable_enslaved = FALSE, updated_at = now()
       WHERE assertable_enslaved = TRUE AND id NOT IN (
         SELECT DISTINCT canonical_person_id FROM person_documents
         WHERE canonical_person_id IS NOT NULL AND s3_key IS NOT NULL AND document_type = ANY($1))`, [EN]);
    console.log(`\napplied: slaveowner +${so.rowCount}/-${soDown.rowCount}, enslaved +${en.rowCount}/-${enDown.rowCount}`);

    const fin = (await pool.query(
      `SELECT count(*) FILTER (WHERE assertable_slaveowner) so, count(*) FILTER (WHERE assertable_enslaved) en,
              count(*) FILTER (WHERE assertable_slaveowner OR assertable_enslaved) either FROM canonical_persons`)).rows[0];
    console.log('final state: slaveowner-assertable', (+fin.so).toLocaleString(), '· enslaved-assertable', (+fin.en).toLocaleString(), '· either', (+fin.either).toLocaleString());
    console.log('verification:', (+fin.either === eitherShould) ? 'OK (matches projection)' : `MISMATCH (projected ${eitherShould}, got ${fin.either})`);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
