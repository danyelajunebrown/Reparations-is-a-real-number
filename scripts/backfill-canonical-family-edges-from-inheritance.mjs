#!/usr/bin/env node
/**
 * Bridge inheritance_edges -> canonical_family_edges.
 *
 * The person profile (contribute.js -> /api/contribute/person/:id) reads
 * family members from canonical_family_edges. The Liberty probate re-parse
 * wrote 3,779 inheritance_edges with kinship terms ("to my son John") but
 * none of them flow into canonical_family_edges — so no testator's profile
 * shows their wife, children, or siblings. That is why every profile looks
 * relativeless today.
 *
 * This script translates each inheritance_edges row whose
 * relationship_to_testator maps cleanly into a canonical_family_edges row,
 * using the conventional direction the API assumes (person_a = the named
 * "side" of the relationship — e.g. for 'parent_of', person_a is the parent).
 *
 * Mappings (others are skipped):
 *   wife / husband / widow                               -> (testator, heir, spouse)
 *   son / daughter / sons / daughters / children / child -> (testator, heir, parent_of)
 *   brother / sister / brothers / sisters                -> (testator, heir, sibling_of)
 *   mother / father / parents                            -> (heir, testator, parent_of)
 *
 * Idempotent — NOT EXISTS guard on (person_a, person_b, relationship_type).
 * DRY RUN by default.
 *
 *   node scripts/backfill-canonical-family-edges-from-inheritance.mjs
 *   node scripts/backfill-canonical-family-edges-from-inheritance.mjs --apply
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const APPLY = process.argv.includes('--apply');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Each maps relationship_to_testator -> { a, b, type }, where a/b indicate
// which side of the inheritance edge fills person_a / person_b.
//   'T' = testator_id, 'H' = heir_id
const MAP = {
  wife: { a: 'T', b: 'H', type: 'spouse' },
  husband: { a: 'T', b: 'H', type: 'spouse' },
  widow: { a: 'T', b: 'H', type: 'spouse' },
  son: { a: 'T', b: 'H', type: 'parent_of' },
  daughter: { a: 'T', b: 'H', type: 'parent_of' },
  sons: { a: 'T', b: 'H', type: 'parent_of' },
  daughters: { a: 'T', b: 'H', type: 'parent_of' },
  children: { a: 'T', b: 'H', type: 'parent_of' },
  child: { a: 'T', b: 'H', type: 'parent_of' },
  brother: { a: 'T', b: 'H', type: 'sibling_of' },
  sister: { a: 'T', b: 'H', type: 'sibling_of' },
  brothers: { a: 'T', b: 'H', type: 'sibling_of' },
  sisters: { a: 'T', b: 'H', type: 'sibling_of' },
  mother: { a: 'H', b: 'T', type: 'parent_of' }, // heir is the parent
  father: { a: 'H', b: 'T', type: 'parent_of' },
  parents: { a: 'H', b: 'T', type: 'parent_of' },
};

async function main() {
  console.log(APPLY ? '=== inheritance_edges -> canonical_family_edges (APPLY) ===' : '=== inheritance_edges -> canonical_family_edges (DRY RUN) ===');

  // What's in inheritance_edges, by relation?
  const dist = (await pool.query(`
    SELECT relationship_to_testator, COUNT(*)
      FROM inheritance_edges
     WHERE testator_id IS NOT NULL AND heir_id IS NOT NULL
       AND testator_id <> heir_id
     GROUP BY 1 ORDER BY 2 DESC
  `)).rows;

  let mappable = 0, skipped = 0;
  console.log('\nKinship distribution (kinship-mapped rows -> will write):');
  for (const r of dist) {
    const mapped = MAP[(r.relationship_to_testator || '').toLowerCase()];
    if (mapped) { mappable += +r.count; console.log(`  ${String(r.count).padStart(5)}  ${r.relationship_to_testator}  -> ${mapped.type}`); }
    else        { skipped  += +r.count; }
  }
  console.log(`  ${String(skipped).padStart(5)}  (skipped — no clean mapping, e.g. nephew, grand-, friend, executor)`);

  console.log(`\nTotal inheritance_edges mappable: ${mappable}`);

  if (!APPLY) {
    console.log('\nDry run — nothing written. Re-run with --apply.');
    await pool.end(); return;
  }

  let inserted = 0;
  for (const [rel, m] of Object.entries(MAP)) {
    const aCol = m.a === 'T' ? 'testator_id' : 'heir_id';
    const bCol = m.b === 'T' ? 'testator_id' : 'heir_id';
    const r = await pool.query(
      `INSERT INTO canonical_family_edges
         (person_a_id, person_b_id, relationship_type, evidence_tier, confidence, verified, notes)
       SELECT DISTINCT ie.${aCol}, ie.${bCol}, $2::text, 2, 0.75, false,
              'bridged from inheritance_edges (' || $1::text || ')'
         FROM inheritance_edges ie
        WHERE lower(ie.relationship_to_testator) = $1::text
          AND ie.testator_id IS NOT NULL AND ie.heir_id IS NOT NULL
          AND ie.testator_id <> ie.heir_id
          AND NOT EXISTS (
            SELECT 1 FROM canonical_family_edges cfe
             WHERE cfe.person_a_id = ie.${aCol}
               AND cfe.person_b_id = ie.${bCol}
               AND cfe.relationship_type = $2::text)
       ON CONFLICT (person_a_id, person_b_id, relationship_type) DO NOTHING
       RETURNING id`,
      [rel, m.type]
    );
    if (r.rowCount > 0) console.log(`  inserted ${r.rowCount}  (${rel} -> ${m.type})`);
    inserted += r.rowCount;
  }
  console.log(`\nApplied. ${inserted} canonical_family_edges row(s) inserted.`);
  await pool.end();
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
