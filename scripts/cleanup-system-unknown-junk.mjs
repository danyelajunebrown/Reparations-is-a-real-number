#!/usr/bin/env node
/**
 * Audit cleanup — delete the `system` / person_type `unknown` junk rows in
 * canonical_persons.
 *
 * These are not people. They are text fragments that an over-eager extractor
 * turned into canonical_persons rows: Wikipedia article fragments ("From
 * Wikipedia", "United States\nIn") from a Dec 2025 batch, and will-transcript
 * fragments ("to my beloved", "and recommend my", "them by will") from the
 * May 2026 probate scrape. All carry created_by='system', person_type='unknown',
 * confidence_score 0.50.
 *
 * FK-safe: every foreign key referencing canonical_persons is scanned. The two
 * known dependents are handled — junk `inheritance_edges` (heir/testator) are
 * deleted, and `person_documents` linked to a junk row are unlinked (the
 * document itself is real and is kept, canonical_person_id set NULL). If ANY
 * other table is found referencing a junk row, the script ABORTS rather than
 * guess — re-run after that reference is dealt with.
 *
 * DRY RUN by default.
 *   node scripts/cleanup-system-unknown-junk.mjs            # dry run
 *   node scripts/cleanup-system-unknown-junk.mjs --apply    # delete
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const APPLY = process.argv.includes('--apply');
const JUNK = `SELECT id FROM canonical_persons WHERE created_by = 'system' AND person_type = 'unknown'`;

// Known dependents and how to resolve them.
//   'delete'  — the dependent row is itself junk (a junk edge); remove it.
//   'null'    — the dependent row is real; just clear the link.
const KNOWN = {
  'inheritance_edges.heir_id': 'delete',
  'inheritance_edges.testator_id': 'delete',
  // A "relationship" with a text-fragment endpoint is itself junk — delete it.
  'person_relationships_verified.person_id': 'delete',
  'person_relationships_verified.related_person_id': 'delete',
  'person_documents.canonical_person_id': 'null',
};

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  console.log(APPLY ? '=== system/unknown cleanup (APPLY) ===' : '=== system/unknown cleanup (DRY RUN) ===');

  const count = Number((await pool.query(`SELECT COUNT(*) n FROM (${JUNK}) j`)).rows[0].n);
  console.log(`\nJunk rows (created_by='system', person_type='unknown'): ${count}`);

  const sample = (await pool.query(
    `SELECT canonical_name FROM canonical_persons
      WHERE created_by='system' AND person_type='unknown'
      ORDER BY random() LIMIT 12`
  )).rows.map((r) => JSON.stringify(r.canonical_name));
  console.log('Random sample of names:');
  for (const s of sample) console.log(`  ${s}`);

  // Scan every FK referencing canonical_persons.
  const fks = (await pool.query(`
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'canonical_persons'
  `)).rows;

  console.log(`\nScanning ${fks.length} foreign keys for references to junk rows...`);
  const exposed = [];
  let unexpected = false;
  for (const fk of fks) {
    const key = `${fk.table_name}.${fk.column_name}`;
    let n;
    try {
      n = Number((await pool.query(
        `SELECT COUNT(*) n FROM ${fk.table_name} t WHERE t.${fk.column_name} IN (${JUNK})`
      )).rows[0].n);
    } catch {
      continue; // type-incompatible column — cannot reference an integer id
    }
    if (n > 0) {
      const plan = KNOWN[key];
      console.log(`  ${key}: ${n} reference(s) — ${plan ? `will ${plan}` : 'UNEXPECTED'}`);
      exposed.push({ ...fk, key, n, plan });
      if (!plan) unexpected = true;
    }
  }
  if (exposed.length === 0) console.log('  no references found.');

  if (unexpected) {
    console.log('\nABORT: a table not in the known-dependents list references junk rows.');
    console.log('Resolve that reference, then re-run.');
    await pool.end();
    return;
  }

  if (!APPLY) {
    console.log('\nDry run — nothing deleted. Re-run with --apply to clean up.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const e of exposed) {
      if (e.plan === 'delete') {
        const r = await client.query(`DELETE FROM ${e.table_name} WHERE ${e.column_name} IN (${JUNK})`);
        console.log(`  deleted ${r.rowCount} junk row(s) from ${e.key}`);
      } else if (e.plan === 'null') {
        const r = await client.query(`UPDATE ${e.table_name} SET ${e.column_name} = NULL WHERE ${e.column_name} IN (${JUNK})`);
        console.log(`  unlinked ${r.rowCount} real row(s) in ${e.key}`);
      }
    }
    const del = await client.query(
      `DELETE FROM canonical_persons WHERE created_by='system' AND person_type='unknown'`
    );
    await client.query('COMMIT');
    console.log(`\nDone. Deleted ${del.rowCount} junk canonical_persons row(s).`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
