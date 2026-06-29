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

// NOTE: the FK-safe merge logic now lives in PersonService.merge (de-siloing step 4 fold-in) —
// this script is a thin CLI wrapper so there is ONE implementation.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const require = createRequire(import.meta.url);
const PersonService = require('../src/services/PersonService');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const survivorId = parseInt(args[args.indexOf('--survivor') + 1] || '', 10);
const victimId   = parseInt(args[args.indexOf('--victim') + 1] || '', 10);
if (!Number.isInteger(survivorId) || !Number.isInteger(victimId) || survivorId === victimId) {
  console.error('Usage: --survivor <id> --victim <id> [--apply]'); process.exit(2);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  const svc = new PersonService(pool);
  console.log(APPLY ? `=== MERGE (APPLY): survivor #${survivorId}, victim #${victimId} ===` : `=== MERGE (DRY RUN): survivor #${survivorId}, victim #${victimId} ===`);
  const r = await svc.merge(survivorId, victimId, { dryRun: !APPLY, mergedBy: 'manual', reason: 'manual merge — scripts/merge-canonical-persons.mjs' });
  if (!r.ok) { console.error('merge failed:', r.reason); await pool.end(); process.exit(2); }
  if (r.action === 'would_merge') console.log(`Dry run — would re-point ${r.fkRefs.length} FK columns:\n  ${r.fkRefs.join('\n  ')}\nRe-run with --apply.`);
  else console.log(`Done. Survivor #${survivorId} now owns everything from #${victimId} (${r.fkRefs} FK columns re-pointed).`);
  await pool.end();
}


main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
