// backfill-promoted-lead-pointers.mjs — recover the 72,862 leads marked 'promoted' that point at nothing.
//
// PersonService.promoteToCanonical set status='promoted' and recorded the canonical id ONLY as prose
// inside review_notes — "[promoted→canonical#123]" — never in confirmed_individual_id. So the link existed
// but was unqueryable: 72,862 leads claiming promotion with a NULL pointer, and canonicals unreachable
// from their own lead. That is the defect this project keeps rediscovering — a status written without the
// thing that makes it verifiable.
//
// THE GOOD NEWS: the id is sitting in the note, so this is recoverable rather than lost. We parse it back.
// We do NOT guess: a lead whose note carries no canonical id, or whose canonical no longer exists, is left
// alone and counted, because inventing a pointer is worse than a null one.
//
// Usage: node scripts/backfill-promoted-lead-pointers.mjs [--apply]
import 'dotenv/config';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false },
  statement_timeout: 900000, query_timeout: 900000 });
pool.on('error', (e) => console.error(`[pool] ${e.message}`));

const before = (await pool.query(
  `SELECT count(*)::int n FROM unconfirmed_persons WHERE status='promoted' AND confirmed_individual_id IS NULL`)).rows[0].n;
const recoverable = (await pool.query(
  `SELECT count(*)::int n FROM unconfirmed_persons
    WHERE status='promoted' AND confirmed_individual_id IS NULL
      AND review_notes ~ 'canonical#[0-9]+'`)).rows[0].n;
console.log(`  orphaned promoted leads: ${before}`);
console.log(`  with a recoverable id in review_notes: ${recoverable}  (${before - recoverable} have none — left alone)`);

if (!APPLY) { console.log('\n(dry run — pass --apply)'); await pool.end(); }
else {
  // Only where the canonical actually EXISTS — a pointer to a deleted row is not a repair.
  const r = await pool.query(`
    UPDATE unconfirmed_persons u
       SET confirmed_individual_id = m.cid
      FROM (SELECT lead_id, (regexp_match(review_notes, 'canonical#([0-9]+)'))[1] AS cid
              FROM unconfirmed_persons
             WHERE status='promoted' AND confirmed_individual_id IS NULL
               AND review_notes ~ 'canonical#[0-9]+') m
     WHERE u.lead_id = m.lead_id
       AND EXISTS (SELECT 1 FROM canonical_persons c WHERE c.id = m.cid::integer)
    RETURNING u.lead_id`);
  const after = (await pool.query(
    `SELECT count(*)::int n FROM unconfirmed_persons WHERE status='promoted' AND confirmed_individual_id IS NULL`)).rows[0].n;
  console.log(`  repaired ${r.rows.length} pointers · orphans remaining: ${after}`);
  await pool.end();
}
