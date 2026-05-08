#!/usr/bin/env node
/**
 * backfill-climb-data-to-canonical.js
 *
 * Reads confirmed ancestor climb matches and backfills canonical_persons with:
 *   - birth_year_estimate  (from slaveholder_birth_year)
 *   - primary_state / primary_county  (parsed from slaveholder_location)
 *
 * Only fills fields that are currently NULL — never overwrites existing data.
 *
 * Actual ancestor_climb_matches schema (verified):
 *   slaveholder_id       integer  → FK to canonical_persons.id
 *   slaveholder_name     text
 *   slaveholder_birth_year integer
 *   slaveholder_location text
 *   verification_status  varchar
 *
 * canonical_persons schema (verified):
 *   id, canonical_name, first_name, last_name,
 *   birth_year_estimate, death_year_estimate,
 *   primary_state, primary_county, primary_plantation,
 *   sex, person_type, verification_status
 *
 * Usage:
 *   node scripts/backfill-climb-data-to-canonical.js [--dry-run]
 *
 * Dry-run prints what would change without writing anything.
 */

'use strict';

const { Pool } = require('pg');
require('dotenv').config();

const DRY_RUN = process.argv.includes('--dry-run');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

/**
 * Parse "City, County, State, USA" or "State" into { primary_state, primary_county }.
 * Returns nulls if string is empty or unparseable.
 */
function parseLocation(raw) {
  if (!raw || typeof raw !== 'string') return { primary_state: null, primary_county: null };
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  // Filter out "USA" / "United States"
  const filtered = parts.filter(p => !/^(USA|United States|America)$/i.test(p));
  if (filtered.length === 0) return { primary_state: null, primary_county: null };
  if (filtered.length === 1) return { primary_state: filtered[0], primary_county: null };
  // Last part = state, second-to-last = county
  return {
    primary_state: filtered[filtered.length - 1],
    primary_county: filtered[filtered.length - 2],
  };
}

async function main() {
  console.log(`[backfill-climb-data] ${DRY_RUN ? 'DRY RUN — ' : ''}Starting…`);

  // Pull confirmed climb matches that are linked to a canonical_person and have data to offer
  const { rows: matches } = await pool.query(`
    SELECT
      acm.id                         AS match_id,
      acm.slaveholder_id             AS canonical_person_id,
      acm.slaveholder_name,
      acm.slaveholder_birth_year,
      acm.slaveholder_location,
      cp.canonical_name,
      cp.birth_year_estimate         AS db_birth_year,
      cp.primary_county              AS db_county,
      cp.primary_state               AS db_state
    FROM ancestor_climb_matches acm
    JOIN canonical_persons cp ON cp.id = acm.slaveholder_id
    WHERE acm.slaveholder_id IS NOT NULL
      AND acm.verification_status IN ('confirmed_slaveholder', 'auto_verified', 'verified')
      AND (
        (acm.slaveholder_birth_year IS NOT NULL AND cp.birth_year_estimate IS NULL)
        OR
        (acm.slaveholder_location IS NOT NULL AND cp.primary_state IS NULL)
      )
    ORDER BY cp.canonical_name
  `);

  console.log(`[backfill-climb-data] Found ${matches.length} records with at least one NULL field to fill.`);

  let updated = 0;
  let skipped = 0;

  for (const row of matches) {
    const sets = [];
    const values = [];
    let idx = 1;

    // birth_year_estimate
    if (row.db_birth_year == null && row.slaveholder_birth_year != null) {
      sets.push(`birth_year_estimate = $${idx++}`);
      values.push(row.slaveholder_birth_year);
    }

    // primary_state / primary_county
    if (row.db_state == null && row.slaveholder_location) {
      const { primary_state, primary_county } = parseLocation(row.slaveholder_location);
      if (primary_state) {
        sets.push(`primary_state = $${idx++}`);
        values.push(primary_state);
      }
      if (primary_county && row.db_county == null) {
        sets.push(`primary_county = $${idx++}`);
        values.push(primary_county);
      }
    }

    if (sets.length === 0) {
      skipped++;
      continue;
    }

    values.push(row.canonical_person_id);
    const sql = `UPDATE canonical_persons SET ${sets.join(', ')} WHERE id = $${idx}`;

    if (DRY_RUN) {
      console.log(`[DRY RUN] ${row.canonical_name} (id=${row.canonical_person_id}): ${sets.join(', ')}`);
      console.log(`          values: ${JSON.stringify(values.slice(0, -1))}`);
    } else {
      try {
        await pool.query(sql, values);
        console.log(`[updated] ${row.canonical_name} (id=${row.canonical_person_id}): ${sets.join(', ')}`);
        updated++;
      } catch (err) {
        console.error(`[error] ${row.canonical_name} (id=${row.canonical_person_id}): ${err.message}`);
      }
    }
  }

  console.log(`\n[backfill-climb-data] Done. updated=${DRY_RUN ? 'N/A (dry run)' : updated}, skipped=${skipped}`);
  await pool.end();
}

main().catch(err => {
  console.error('[fatal]', err);
  process.exit(1);
});
