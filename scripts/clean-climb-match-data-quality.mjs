// Clean up data-quality issues in ancestor_climb_matches.
//
// Issues found by the all-climbs audit:
//
//   (1) slaveholder_birth_year field contains values like 1488, 1942 for
//       enslavers — clearly wrong (pre-1600 is medieval, post-1870 is
//       post-emancipation). These slipped in from low-quality SlaveVoyages
//       records and from name_only_match inference against descendants.
//       Fix: null the field when birth_year is implausible (< 1600 or > 1870)
//       AND upgrade classification to temporal_impossible for any still-
//       unverified rows.
//
//   (2) LX39-1MY climb was configured with historical_cutoff=1450, which
//       pushed name-only matching into medieval ancestor chains and
//       produced 330 garbage temporal_impossible matches. Future climbs
//       should use 1700 as the practical cutoff. (Not a retroactive fix —
//       this comment documents the defect for the next climber config.)
//
// Usage:
//   node scripts/clean-climb-match-data-quality.mjs              # dry-run
//   node scripts/clean-climb-match-data-quality.mjs --apply      # execute

import 'dotenv/config';
import pg from 'pg';
const APPLY = process.argv.includes('--apply');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Audit counts
const badYrs = await pool.query(`
    SELECT COUNT(*)::int c FROM ancestor_climb_matches
    WHERE slaveholder_birth_year IS NOT NULL
      AND (slaveholder_birth_year < 1600 OR slaveholder_birth_year > 1870)
`);
console.log(`Matches with implausible slaveholder_birth_year (<1600 or >1870): ${badYrs.rows[0].c}`);

const unverImplausible = await pool.query(`
    SELECT COUNT(*)::int c FROM ancestor_climb_matches
    WHERE slaveholder_birth_year IS NOT NULL
      AND (slaveholder_birth_year < 1600 OR slaveholder_birth_year > 1870)
      AND classification IN ('unverified', NULL)
`);
console.log(`  of which still 'unverified' → will be re-classified: ${unverImplausible.rows[0].c}`);

if (!APPLY) {
    console.log('\nDRY-RUN — re-run with --apply to execute.');
    await pool.end();
    process.exit(0);
}

// 1. Upgrade unverified rows with implausible years to temporal_impossible
const upd1 = await pool.query(`
    UPDATE ancestor_climb_matches
    SET classification = 'temporal_impossible',
        classification_reason = COALESCE(classification_reason, '') ||
          ' | Auto-reclassified: implausible slaveholder_birth_year (' ||
          slaveholder_birth_year::text || ')'
    WHERE slaveholder_birth_year IS NOT NULL
      AND (slaveholder_birth_year < 1600 OR slaveholder_birth_year > 1870)
      AND (classification IS NULL OR classification = 'unverified')
`);
console.log(`\nReclassified to temporal_impossible: ${upd1.rowCount}`);

// 2. Null out the bad birth_year field so it can't be used in any downstream
//    evidence calculations. Preserve audit trail via notes.
const upd2 = await pool.query(`
    UPDATE ancestor_climb_matches
    SET notes = COALESCE(notes, '') ||
          CASE WHEN notes IS NULL OR notes='' THEN '' ELSE E'\\n' END ||
          'Cleaned 2026-04-20: nulled implausible slaveholder_birth_year=' ||
          slaveholder_birth_year::text,
        slaveholder_birth_year = NULL
    WHERE slaveholder_birth_year IS NOT NULL
      AND (slaveholder_birth_year < 1600 OR slaveholder_birth_year > 1870)
`);
console.log(`Nulled implausible slaveholder_birth_year on: ${upd2.rowCount} rows`);

// 3. Verify new distribution
const after = await pool.query(`SELECT classification, COUNT(*)::int c FROM ancestor_climb_matches GROUP BY classification ORDER BY c DESC`);
console.log(`\nPost-cleanup classification distribution:`);
for (const r of after.rows) console.log(`  ${r.classification}: ${r.c}`);

await pool.end();
