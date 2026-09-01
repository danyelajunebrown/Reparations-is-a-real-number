// reclassify-unevidenced-probate-enslavers.mjs — undo a classification made by a DEFAULT VALUE.
//
// WHAT HAPPENED
//   `new-york-probate-scraper` typed every probate decedent it minted as `person_type='enslaver'`. Their
//   notes say so in as many words: "Auto-created by new-york-probate-scraper. Type: enslaver."
//   Result: 7,332 canonicals classified as slaveholders on the basis of having DIED WITH AN ESTATE in
//   Albany, Cayuga or Allegany County, New York — a state that began gradual abolition in 1799 and
//   completed it in 1827. Names in the set include "Peter Creighton Filed April" and
//   "Hezehiah Gridley Deceased", which are parse fragments, not people.
//
// WHY IT MATTERS MORE THAN A WRONG LABEL
//   `person_type='enslaver'` is the class the reparations ledger keys on, the class the descent engine
//   anchors from, and the class a DAA names. Audit rule 5 says no fabricated data; this is fabrication by
//   default value, at a scale (7,332 of 420,566 enslaver canonicals) that quietly moves a headline number.
//   Provenance is not evidence: being found in a probate roll makes someone a DECEDENT, not a slaveholder.
//
// WHAT THIS DOES
//   Reclassifies to 'unknown' ONLY those with no evidence of holding anyone. Evidence = a chattel transfer,
//   or a linked document with evidences_enslaved_holding, or a document enslaved_count > 0. Measured before
//   writing: 43 of the 7,332 have such evidence and are LEFT ALONE.
//   The prior classification is preserved in `notes`, so this is reversible — the Biscoe instinct applies to
//   classifications as well as to merges: decline to assert, never destroy.
//
// Usage: node scripts/reclassify-unevidenced-probate-enslavers.mjs [--apply]

import 'dotenv/config';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const STAMP = 'RECLASSIFIED 2026-08-11: was person_type=enslaver, auto-assigned by new-york-probate-scraper '
            + 'with no evidence of holding (no chattel transfer, no document evidencing holding, no enslaved_count). '
            + 'Set to unknown pending evidence. Provenance is not evidence: a probate decedent is a decedent.';

// EVIDENCE OF HOLDING, at THREE levels. The third was missing from the first draft and would have stripped
// 'enslaver' from real Albany slaveholders: 98 Albany NY estates carry enslaved_count > 0 at the ESTATE
// level, but only ~41 canonicals carry it at the person-document level. If a decedent's holding is recorded
// on their estate and not copied onto their person row, an evidence test that only looks at person rows
// reads them as unevidenced. Albany NY probate names 247 enslaved people -- the second-highest yield in the
// corpus -- so this is not a hypothetical.
const EVIDENCE = `(
     EXISTS (SELECT 1 FROM chattel_transfer_events t WHERE t.to_enslaver_id = cp.id OR t.from_enslaver_id = cp.id)
  OR EXISTS (SELECT 1 FROM person_documents d WHERE d.canonical_person_id = cp.id
               AND (d.evidences_enslaved_holding OR COALESCE(d.enslaved_count,0) > 0))
  OR EXISTS (SELECT 1 FROM probate_estate_extractions pe
              WHERE COALESCE(pe.enslaved_count,0) > 0
                AND (
                     lower(btrim(pe.decedent_name)) = lower(btrim(cp.canonical_name))
                     -- LOOSE match, deliberately biased toward KEEPING the label. Canonical names from this
                     -- scraper are often parse fragments ("Peter Creighton Filed April"), so an exact match
                     -- against a clean estate decedent ("Peter Creighton") fails and would declassify a real
                     -- holder. A false KEEP leaves a label a human can still check; a false STRIP silently
                     -- removes an evidenced slaveholder from the class the ledger reads. Asymmetric costs,
                     -- asymmetric test.
                  OR lower(btrim(cp.canonical_name)) LIKE lower(btrim(pe.decedent_name)) || '%'
                  OR lower(btrim(pe.decedent_name)) LIKE lower(btrim(cp.canonical_name)) || '%'
                ))
)`;

const TARGET = `cp.person_type = 'enslaver'
  AND (cp.notes ILIKE '%new-york-probate-scraper%' OR cp.notes ILIKE '%new_york_probate%')
  AND NOT ${EVIDENCE}`;

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  pool.on('error', (e) => console.error(`[pool] idle client error (continuing): ${e.message}`));
  console.log(APPLY ? '=== APPLY ===' : '=== DRY RUN ===');

  const counts = (await pool.query(`
    SELECT
      (SELECT count(*)::int FROM canonical_persons cp WHERE cp.person_type='enslaver'
         AND (cp.notes ILIKE '%new-york-probate-scraper%' OR cp.notes ILIKE '%new_york_probate%')) AS auto_typed,
      (SELECT count(*)::int FROM canonical_persons cp WHERE ${TARGET}) AS to_reclassify,
      (SELECT count(*)::int FROM canonical_persons WHERE person_type='enslaver') AS enslavers_now`)).rows[0];

  console.log(`auto-typed by the NY probate scraper : ${counts.auto_typed}`);
  console.log(`  of those, WITH evidence (kept)     : ${counts.auto_typed - counts.to_reclassify}`);
  console.log(`  of those, NO evidence (reclassify) : ${counts.to_reclassify}`);
  console.log(`enslaver canonicals before           : ${counts.enslavers_now}`);
  console.log(`enslaver canonicals after            : ${counts.enslavers_now - counts.to_reclassify}`);

  const sample = (await pool.query(
    `SELECT canonical_name, primary_county, death_year_estimate FROM canonical_persons cp WHERE ${TARGET} LIMIT 5`)).rows;
  console.log('\nsample to be reclassified:');
  sample.forEach((s) => console.log(`  · ${s.canonical_name} (${s.primary_county || '?'}, d.${s.death_year_estimate || '?'})`));

  if (!APPLY) { console.log('\n(dry run — pass --apply)'); await pool.end(); return; }

  const r = await pool.query(
    `UPDATE canonical_persons cp
        SET person_type = 'unknown',
            notes = COALESCE(cp.notes,'') || ' | ' || $1
      WHERE ${TARGET}
      RETURNING cp.id`, [STAMP]);
  console.log(`\n✓ reclassified ${r.rows.length} canonicals: enslaver -> unknown (prior type recorded in notes, reversible)`);

  const after = (await pool.query(`SELECT count(*)::int n FROM canonical_persons WHERE person_type='enslaver'`)).rows[0].n;
  console.log(`enslaver canonicals now: ${after}`);
  await pool.end();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
