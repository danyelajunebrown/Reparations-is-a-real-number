/**
 * insert-biscoe-enslaved-from-petition.js
 *
 * Inserts 26 enslaved persons from DC Compensated Emancipation Petition
 * cww.00429 (1862) into enslaved_individuals table.
 * enslaved_by_individual_id = '141015' (Ann Maria Biscoe, canonical_persons)
 *
 * Run: node scripts/insert-biscoe-enslaved-from-petition.js
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const PETITION_YEAR = 1862;
const OWNER_ID = '141015';

const enslaved = [
  { name: 'Ezekiel Biscoe',       age: 65, gender: 'Male',   color: 'Mulatto',     occ: 'white washer',        value: 500  },
  { name: 'Samuel Wilson',         age: 52, gender: null,     color: 'dark brown',  occ: 'Driver',              value: 800  },
  { name: 'John Bealle',           age: 32, gender: 'Male',   color: 'chestnut',    occ: 'Laborer',             value: 600  },
  { name: 'Nancy Grey',            age: 42, gender: 'Female', color: 'dark brown',  occ: 'cook',                value: 800  },
  { name: 'John Grey',             age: 17, gender: 'Male',   color: 'black',       occ: 'grocery store',       value: 800  },
  { name: 'James Grey',            age: 14, gender: null,     color: null,          occ: 'Laborer',             value: 600  },
  { name: 'Horace Grey',           age: 12, gender: null,     color: null,          occ: 'Laborer',             value: 400  },
  { name: 'Eliza Ann Washington',  age: 24, gender: 'Female', color: 'chestnut',    occ: 'cook',                value: 1000 },
  { name: 'Clara Washington',      age: 2,  gender: null,     color: 'light brown', occ: null,                  value: 100  },
  { name: 'Ellen Waring',          age: 23, gender: null,     color: 'black',       occ: 'house servant',       value: 1000 },
  { name: 'Rebecca Herbert',       age: 35, gender: null,     color: 'chestnut',    occ: 'cook washer',         value: 1000 },
  { name: 'Martha Herbert',        age: 16, gender: 'Female', color: 'light brown', occ: 'nurse house servant', value: 800  },
  { name: 'Henry Herbert',         age: 14, gender: 'Male',   color: null,          occ: null,                  value: 600  },
  { name: 'Levi Herbert',          age: 12, gender: null,     color: 'black',       occ: 'Laborer',             value: 400  },
  { name: 'Margaret Coleman',      age: 28, gender: 'Female', color: 'light brown', occ: 'cook',                value: 1000 },
  { name: 'Sallie Coleman',        age: 15, gender: null,     color: null,          occ: 'house servant',       value: 800  },
  { name: 'Alice Coleman',         age: 13, gender: null,     color: 'black',       occ: null,                  value: 500  },
  { name: 'Laura Coleman',         age: 8,  gender: null,     color: 'light brown', occ: null,                  value: 400  },
  { name: 'Juliet Coleman',        age: 6,  gender: null,     color: null,          occ: null,                  value: 300  },
  { name: 'Frederick Coleman',     age: 2,  gender: 'Male',   color: 'black',       occ: null,                  value: 150  },
  { name: 'William Coleman',       age: 1,  gender: null,     color: 'brown',       occ: null,                  value: 25   },
  { name: 'Maria Bealle',          age: 32, gender: 'Female', color: 'light brown', occ: 'cook',                value: 1000 },
  { name: 'Nicholas Bealle',       age: 9,  gender: 'Male',   color: 'chestnut',    occ: null,                  value: 400  },
  { name: 'George Bealle',         age: 3,  gender: 'Male',   color: 'light brown', occ: null,                  value: 200  },
  { name: 'Cecilia Bealle',        age: 23, gender: 'Female', color: 'chestnut',    occ: 'cook',                value: 1000 },
  { name: 'Ida Bealle',            age: 2,  gender: null,     color: 'mulatto',     occ: null,                  value: 100  },
];

async function main() {
  // 1. Check enslaved_individuals schema
  const schemaRes = await pool.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'enslaved_individuals'
    ORDER BY ordinal_position
  `);
  const cols = schemaRes.rows.map(r => r.column_name);
  console.log('enslaved_individuals columns:', cols.join(', '));

  const hasRacialDesignation = cols.includes('racial_designation');
  const hasOccupation        = cols.includes('occupation');
  const hasGender            = cols.includes('gender');
  const hasBirthYear         = cols.includes('birth_year');
  console.log({ hasRacialDesignation, hasOccupation, hasGender, hasBirthYear });

  // Build dynamic INSERT based on available columns
  let inserted = 0;
  let skipped  = 0;

  for (const p of enslaved) {
    const birth_year = (p.age > 0) ? (PETITION_YEAR - p.age) : null;

    const noteParts = [
      'DC Compensated Emancipation Petition cww.00429 (1862). Enslaved by Ann Maria Biscoe, Georgetown DC.',
      p.color  ? `Color: ${p.color}.`       : null,
      p.occ    ? `Occupation: ${p.occ}.`    : null,
      `Claimed value: $${p.value}.`,
      'Birth year estimated from stated age at time of petition.',
      'Source: https://civilwardc.org/texts/petitions/cww.00429.html'
    ].filter(Boolean).join(' ');

    // Generate deterministic-ish ID
    const safeName = p.name.replace(/[^A-Za-z]/g, '').substring(0, 8).toUpperCase();
    const enslaved_id = `ENS-BISCOE-${safeName}-${p.age}`;

    try {
      if (hasRacialDesignation && hasOccupation && hasGender && hasBirthYear) {
        await pool.query(`
          INSERT INTO enslaved_individuals
            (enslaved_id, full_name, gender, birth_year, racial_designation, occupation,
             enslaved_by_individual_id, notes, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
          ON CONFLICT (enslaved_id) DO NOTHING
        `, [enslaved_id, p.name, p.gender, birth_year, p.color, p.occ, OWNER_ID, noteParts]);

      } else if (!hasRacialDesignation && hasOccupation && hasGender && hasBirthYear) {
        // racial_designation missing — skip that column
        await pool.query(`
          INSERT INTO enslaved_individuals
            (enslaved_id, full_name, gender, birth_year, occupation,
             enslaved_by_individual_id, notes, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
          ON CONFLICT (enslaved_id) DO NOTHING
        `, [enslaved_id, p.name, p.gender, birth_year, p.occ, OWNER_ID, noteParts]);

      } else {
        // Minimal insert (always safe columns)
        await pool.query(`
          INSERT INTO enslaved_individuals
            (enslaved_id, full_name, enslaved_by_individual_id, notes, created_at)
          VALUES ($1, $2, $3, $4, NOW())
          ON CONFLICT (enslaved_id) DO NOTHING
        `, [enslaved_id, p.name, OWNER_ID, noteParts]);
      }
      inserted++;
      console.log(`  ✓ ${p.name} (born ~${birth_year})`);
    } catch (err) {
      skipped++;
      console.error(`  ✗ ${p.name}: ${err.message}`);
    }
  }

  console.log(`\nInserted: ${inserted}  Skipped/error: ${skipped}`);

  const check = await pool.query(
    `SELECT COUNT(*) ct FROM enslaved_individuals WHERE enslaved_by_individual_id = $1`,
    [OWNER_ID]
  );
  console.log(`Total enslaved linked to Biscoe (id=${OWNER_ID}):`, check.rows[0].ct);

  await pool.end();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
