// quarantine-tally-mark-placeholders.mjs — take 1.46M fabricated "people" out of the person population,
// without destroying the real aggregate fact underneath them.
//
// WHAT HAPPENED
//   The 1860/1850 slave schedules COUNT enslaved people — age, sex, colour — and (with rare exceptions)
//   do NOT name them. Something in the schedule ingest minted ONE PERSON ROW PER TALLY MARK:
//       "Unknown (Female, age 4)"   "Unknown (Male, age 16)"   "Unknown (Male, age 58)"
//   Measured 2026-08-19: **1,455,026** such rows in `unconfirmed_persons` with person_type='enslaved'.
//
//   CLAUDE.md audit rule 5 is explicit: "No fabricated data. No 'Unnamed enslaved person(s)' placeholder
//   rows. Real or absent." These are the forbidden thing, at scale, in the class the project exists for.
//
// WHY THEY NEVER PROMOTED — AND WHY THAT WAS LUCK, NOT DESIGN
//   promote-image-backed-leads.mjs requires BOTH an external id and an image. Of the image-backed enslaved
//   leads, ZERO carry an external id, so the join was empty and nothing promoted. The gate held for an
//   unrelated reason. Had someone "fixed" the promoter by relaxing that join — which is exactly what the
//   symptom invites — 103,363 invented people would have entered `canonical_persons` looking like progress:
//   a headline count of enslaved individuals identified, every one of them fictional.
//
// QUARANTINE, NOT DELETE
//   The row is fabricated; the OBSERVATION is not. An enumerator recorded a 4-year-old girl held by a named
//   person in a named county, and that is real evidence of a real child. Deleting it destroys that. So the
//   rows are marked status='placeholder_aggregate' and flagged, which removes them from every person path
//   (search, promotion, counts, RAG) while preserving the record. The right home for the fact is a COUNT on
//   the holder — the same treatment probate gives `enslaved_count`: the number is documented, the people are
//   not invented. That migration is follow-on work; this script stops the bleeding.
//
// Usage: node scripts/quarantine-tally-mark-placeholders.mjs [--apply]

import 'dotenv/config';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');

// Deliberately NARROW. Matches the generated shape "Unknown (Female, age 4)" / "Unnamed (Male, age 16)"
// and nothing else. A bare "Unknown" with no parenthetical is NOT matched: it may be a real record whose
// name was illegible, which is a different thing from a fabricated tally row, and a false quarantine hides
// a real person. Third false-reject lesson of this project — when unsure, leave it visible.
const PLACEHOLDER_RE = `full_name ~* '^(unknown|unnamed)\\s*\\((male|female|m|f)[^)]*\\)$'`;

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false },
    statement_timeout: 600000, query_timeout: 600000 });
  pool.on('error', (e) => console.error(`[pool] idle client error (continuing): ${e.message}`));
  console.log(APPLY ? '=== APPLY ===' : '=== DRY RUN ===');

  const scope = `person_type = 'enslaved' AND ${PLACEHOLDER_RE} AND COALESCE(status,'') <> 'placeholder_aggregate'`;

  const counts = (await pool.query(`
    SELECT (SELECT count(*)::int FROM unconfirmed_persons WHERE ${scope}) AS to_quarantine,
           (SELECT count(*)::int FROM unconfirmed_persons WHERE person_type='enslaved') AS all_enslaved,
           (SELECT count(*)::int FROM unconfirmed_persons WHERE person_type='enslaved' AND NOT (${PLACEHOLDER_RE})) AS real_named,
           (SELECT count(*)::int FROM unconfirmed_persons WHERE ${scope} AND confirmed_individual_id IS NOT NULL) AS already_promoted`)).rows[0];

  console.log(`enslaved leads total          : ${counts.all_enslaved}`);
  console.log(`  fabricated tally rows       : ${counts.to_quarantine}`);
  console.log(`  REAL named people (kept)    : ${counts.real_named}`);
  console.log(`  quarantine targets already promoted (would need reversal): ${counts.already_promoted}`);

  const sample = (await pool.query(
    `SELECT full_name FROM unconfirmed_persons WHERE ${scope} LIMIT 4`)).rows.map((r) => r.full_name);
  console.log(`  sample: ${sample.join(' · ')}`);

  if (!APPLY) { console.log('\n(dry run — pass --apply)'); await pool.end(); return; }

  // Batched: a 1.46M-row UPDATE in one statement invites the exact idle-connection death this project has
  // already lost a multi-hour sweep to.
  let done = 0;
  for (;;) {
    const r = await pool.query(`
      UPDATE unconfirmed_persons SET
        status = 'placeholder_aggregate',
        data_quality_flags = COALESCE(data_quality_flags, '{}'::jsonb) || jsonb_build_object(
          'placeholder_aggregate', true,
          'quarantined_at', '2026-08-19',
          'reason', 'Fabricated one-row-per-tally-mark from a slave schedule, which COUNTS enslaved people by age/sex/colour and does not name them. Violates audit rule 5 (no placeholder person rows). The observation is real; the PERSON row is not. Preserve as a count on the holder, never as a person.',
          'not_a_person', true)
       WHERE lead_id IN (SELECT lead_id FROM unconfirmed_persons WHERE ${scope} LIMIT 25000)
       RETURNING lead_id`);
    if (!r.rows.length) break;
    done += r.rows.length;
    process.stdout.write(`\r  quarantined ${done}…   `);
  }
  console.log(`\n✓ quarantined ${done} fabricated rows (status='placeholder_aggregate')`);

  const after = (await pool.query(
    `SELECT count(*)::int n FROM unconfirmed_persons WHERE person_type='enslaved' AND COALESCE(status,'') <> 'placeholder_aggregate'`)).rows[0].n;
  console.log(`enslaved leads that are actual named people: ${after}`);
  await pool.end();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
