#!/usr/bin/env node
/**
 * Merge two canonical_persons rows: keep --survivor, fold --victim into it.
 *
 * Why we need this: identity_fingerprint (the dedup signal) is populated on
 * 118 of 562,959 rows (0.02%). The formula md5(last_name|birth_year|state)
 * gates on birth_year_estimate, which 90% of rows lack. So duplicates slip
 * through every import: "Hugh Hopewell IV" (climber) and "Hugh Hopewell"
 * (scraper) both for the same Saint-Mary's-County MD enslaver; "Isaac
 * Franklin" and "Franklin, Isaac" for the same TN slave trader. No fingerprint
 * was ever computed for either pair, so no collision was ever raised.
 *
 * This tool does the merge FK-safely: scan all 42 foreign keys referencing
 * canonical_persons; UPDATE victim→survivor on each, handling unique-key
 * collisions by dropping the would-be-duplicate child row first. The victim
 * canonical_persons row is then marked person_type='merged', kept (not
 * deleted), with notes pointing at the survivor. A row in person_merge_log
 * records the operation.
 *
 *   node scripts/merge-canonical-persons.mjs --survivor 193376 --victim 609495
 *   node scripts/merge-canonical-persons.mjs --survivor 193376 --victim 609495 --apply
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const survivorId = parseInt(args[args.indexOf('--survivor') + 1] || '', 10);
const victimId   = parseInt(args[args.indexOf('--victim') + 1] || '', 10);
if (!Number.isInteger(survivorId) || !Number.isInteger(victimId) || survivorId === victimId) {
  console.error('Usage: --survivor <id> --victim <id> [--apply]'); process.exit(2);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  console.log(APPLY ? `=== MERGE (APPLY): survivor #${survivorId}, victim #${victimId} ===` : `=== MERGE (DRY RUN): survivor #${survivorId}, victim #${victimId} ===`);

  // 0. Sanity — both rows exist
  const both = (await pool.query(
    `SELECT id, canonical_name, person_type, primary_county, primary_state,
            birth_year_estimate, death_year_estimate, created_by
       FROM canonical_persons WHERE id IN ($1,$2)`, [survivorId, victimId]
  )).rows;
  if (both.length !== 2) {
    console.error('One or both ids not found in canonical_persons');
    await pool.end(); process.exit(2);
  }
  console.table(both);

  // 1. Enumerate every FK referencing canonical_persons
  const fks = (await pool.query(`
    SELECT tc.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
     WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'canonical_persons'`)).rows;

  // 2. Per FK: count victim refs + survivor refs (for self-FK tables, also
  //    detect cases that would become self-loops after the merge).
  console.log(`\nScanning ${fks.length} FK columns...`);
  const work = [];
  for (const fk of fks) {
    let n;
    try {
      n = Number((await pool.query(
        `SELECT COUNT(*) c FROM ${fk.table_name} WHERE ${fk.column_name} = $1`,
        [victimId]
      )).rows[0].c);
    } catch { continue; }
    if (n > 0) { console.log(`  ${fk.table_name}.${fk.column_name}: ${n}`); work.push({ ...fk, n }); }
  }

  if (!APPLY) {
    console.log('\nDry run — nothing written. Re-run with --apply.');
    await pool.end(); return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 3. Enrich survivor with any non-null fields victim has and survivor lacks.
    await client.query(`
      UPDATE canonical_persons sv
         SET primary_county       = COALESCE(sv.primary_county, vc.primary_county),
             primary_state        = COALESCE(sv.primary_state, vc.primary_state),
             birth_year_estimate  = COALESCE(sv.birth_year_estimate, vc.birth_year_estimate),
             death_year_estimate  = COALESCE(sv.death_year_estimate, vc.death_year_estimate),
             sex                  = COALESCE(sv.sex, vc.sex),
             notes                = COALESCE(sv.notes,'') ||
                                    ' [merged from #' || vc.id || ' "' || vc.canonical_name || '" by merge-canonical-persons]',
             updated_at           = NOW()
        FROM canonical_persons vc
       WHERE sv.id = $1 AND vc.id = $2`,
      [survivorId, victimId]);

    // 4. Re-point FK references one column at a time.
    //    For tables where (..., col, ...) carries a unique constraint we may
    //    collide with rows the survivor already owns. Catch unique violations
    //    per-row and delete the colliding row in the dependent table.
    for (const w of work) {
      try {
        const r = await client.query(
          `UPDATE ${w.table_name} SET ${w.column_name} = $1 WHERE ${w.column_name} = $2`,
          [survivorId, victimId]);
        console.log(`  ${w.table_name}.${w.column_name}: ${r.rowCount} refs re-pointed`);
      } catch (uniqueErr) {
        if (!/unique constraint/i.test(uniqueErr.message)) throw uniqueErr;
        // Bulk update collided. Move row-by-row, deleting any that would dup.
        console.log(`  ${w.table_name}.${w.column_name}: unique-constraint collisions, walking row-by-row`);
        await client.query('SAVEPOINT before_row_move');
        const dups = await client.query(
          `SELECT ctid FROM ${w.table_name} WHERE ${w.column_name} = $2`, [survivorId, victimId]);
        let moved = 0, dropped = 0;
        for (const d of dups.rows) {
          await client.query('SAVEPOINT before_one_row');
          try {
            await client.query(
              `UPDATE ${w.table_name} SET ${w.column_name} = $1 WHERE ctid = $2`,
              [survivorId, d.ctid]);
            await client.query('RELEASE SAVEPOINT before_one_row');
            moved++;
          } catch (e2) {
            await client.query('ROLLBACK TO SAVEPOINT before_one_row');
            await client.query(`DELETE FROM ${w.table_name} WHERE ctid = $1`, [d.ctid]);
            dropped++;
          }
        }
        console.log(`    moved ${moved}, dropped-as-duplicate ${dropped}`);
        await client.query('RELEASE SAVEPOINT before_row_move');
      }
    }

    // 5. Mark victim as merged (do not delete — preserves history + the row
    //    is still reachable for anyone holding its id; person_type='merged'
    //    excludes it from public search).
    await client.query(
      `UPDATE canonical_persons
          SET person_type = 'merged',
              notes = COALESCE(notes,'') || ' [merged into #' || $1 || ' by merge-canonical-persons]',
              updated_at = NOW()
        WHERE id = $2`,
      [survivorId, victimId]);

    // 6. Log
    await client.query(
      `INSERT INTO person_merge_log (surviving_person_id, merged_person_id, merge_reason, merged_by, merged_at)
       VALUES ($1, $2, 'manual merge — scripts/merge-canonical-persons.mjs', 'manual', NOW())`,
      [survivorId, victimId]);

    await client.query('COMMIT');
    console.log(`\nDone. Survivor #${survivorId} now owns everything from #${victimId}.`);
  } catch (e) {
    await client.query('ROLLBACK'); throw e;
  } finally { client.release(); await pool.end(); }
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
