#!/usr/bin/env node
/**
 * derive-dual-status-summary.mjs — #96 P3: derive the person_type SUMMARY from the status FACT layer.
 *
 * person_type is a lossy headline; the truth is the set of time-bounded status facts (P2). When a
 * canonical carries BOTH owner-side status evidence (a `slaveholding` fact) AND enslaved/free-side
 * status evidence (a `free_status` / `enslavement` / `manumission` fact), the honest summary is
 * `free_poc_slaveholder` (a free person of color who held people — William Ellison). This upgrades
 * ONLY that dual-status case; it never touches single-status people (Biscoe-safe, additive, logged).
 *
 * Vector-safe (plan-96 decision 3): the summary is a display label only. The person still owes as an
 * owner (debit ledger, via person_role_group='owner') AND is owed as formerly-enslaved (credit line
 * items) — two separate directed obligations, never netted. This does not change any amount.
 *
 *   node scripts/derive-dual-status-summary.mjs            # dry-run (lists candidates)
 *   node scripts/derive-dual-status-summary.mjs --apply
 */
import 'dotenv/config';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const CANDIDATES = `
  SELECT cp.id, cp.canonical_name, cp.person_type AS old_type
  FROM canonical_persons cp
  WHERE cp.person_type <> 'free_poc_slaveholder'
    AND EXISTS (SELECT 1 FROM person_facts f
                 WHERE f.person_id = cp.id AND f.fact_type = 'slaveholding')
    AND EXISTS (SELECT 1 FROM person_facts f
                 WHERE f.person_id = cp.id AND f.fact_type IN ('free_status','enslavement','manumission'))`;

(async () => {
  const cands = (await pool.query(CANDIDATES)).rows;
  console.log(`=== dual-status summary derivation ${APPLY ? '(APPLY)' : '(DRY-RUN)'} ===`);
  console.log(`  candidates (owner-status fact + enslaved/free-status fact, not already dual): ${cands.length}`);
  for (const c of cands.slice(0, 25)) console.log(`    #${c.id} "${c.canonical_name}"  ${c.old_type} → free_poc_slaveholder`);
  if (cands.length > 25) console.log(`    … and ${cands.length - 25} more`);

  if (!APPLY) { console.log('\n(dry-run — nothing written. Re-run with --apply.)'); await pool.end(); return; }
  if (!cands.length) { console.log('  nothing to do.'); await pool.end(); return; }

  const r = await pool.query(
    `UPDATE canonical_persons SET person_type='free_poc_slaveholder', updated_at=now()
     WHERE id IN (${CANDIDATES.replace('SELECT cp.id, cp.canonical_name, cp.person_type AS old_type', 'SELECT cp.id')})
     RETURNING id`);
  console.log(`\n  upgraded ${r.rowCount} canonical(s) to free_poc_slaveholder.`);
  await pool.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
