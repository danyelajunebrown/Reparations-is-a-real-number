#!/usr/bin/env node
/**
 * Quarantine enslaved unconfirmed_persons whose age/year are corrupt (OCR garbage:
 * age up to 222, observation years up to 1968), so they cannot poison the
 * wage_theft years-enslaved substrate. Flags `data_quality_flags.implausible_age_year`
 * = true; does NOT delete (the record may still be a real person with a recoverable
 * name). Idempotent — safe to re-run as more records load.
 *
 * Genuine corruption only: age outside [0,100] or observation year outside
 * [1700,1870]. The separate "enslaved until emancipation overcounts early-
 * observation deaths" issue is handled IN CODE (yearsEnslaved caps >90yr spans to
 * null) — that data isn't corrupt, only the survival assumption, so it is NOT
 * flagged here.
 *
 *   node scripts/quarantine-corrupt-ages.mjs            # dry-run (counts)
 *   node scripts/quarantine-corrupt-ages.mjs --apply
 */
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv'; import pg from 'pg';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const APPLY = process.argv.includes('--apply');

const WHERE = `person_type='enslaved' AND (
    ( (relationships->>'age')  ~ '^[0-9]+$' AND ((relationships->>'age')::int  > 100 OR (relationships->>'age')::int  < 0) )
 OR ( (relationships->>'year') ~ '^[0-9]+$' AND ((relationships->>'year')::int < 1700 OR (relationships->>'year')::int > 1870) )
)`;

(async () => {
  const q = (s) => pool.query(s).then((r) => r.rows);
  const counts = (await pool.query(`
    SELECT count(*) total,
      count(*) FILTER (WHERE (relationships->>'age')::int > 100) age_gt_100,
      count(*) FILTER (WHERE (relationships->>'year')::int > 1870) year_post_slavery,
      count(*) FILTER (WHERE (relationships->>'year')::int < 1700) year_pre_1700,
      count(*) FILTER (WHERE (data_quality_flags ? 'implausible_age_year')) already_flagged
    FROM unconfirmed_persons WHERE ${WHERE}`)).rows[0];
  console.log(`corrupt-age/year enslaved records: ${counts.total} `
    + `(age>100: ${counts.age_gt_100}, year>1870: ${counts.year_post_slavery}, year<1700: ${counts.year_pre_1700}; already flagged: ${counts.already_flagged})`);

  if (!APPLY) { console.log('dry-run; pass --apply to flag data_quality_flags.implausible_age_year'); await pool.end(); return; }
  const res = await pool.query(`
    UPDATE unconfirmed_persons
       SET data_quality_flags = COALESCE(data_quality_flags, '{}'::jsonb) || '{"implausible_age_year": true}'::jsonb,
           updated_at = NOW()
     WHERE ${WHERE} AND NOT (data_quality_flags ? 'implausible_age_year')`);
  console.log(`flagged ${res.rowCount} records (implausible_age_year=true). Excluded from harm computation; recoverable on re-OCR.`);
  await pool.end();
})();
