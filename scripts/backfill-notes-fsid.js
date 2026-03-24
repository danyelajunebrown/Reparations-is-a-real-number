#!/usr/bin/env node
/**
 * Backfill person_external_ids from FamilySearch IDs stored in canonical_persons.notes
 *
 * Handles two formats:
 *   1. JSON: {"familysearch_id":"MTRV-Z72",...}
 *   2. Text: "FamilySearch ID: MTRV-Z72"
 *
 * Inserts into person_external_ids with:
 *   id_system='familysearch', confidence=0.950, verified=false,
 *   discovered_by='backfill_notes_fsid', discovered_at=now()
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const BATCH_SIZE = 500;

// FamilySearch IDs: uppercase letters (no vowels typically) + digits, with hyphens
// Format: 4-9 chars like XXXX-XXX or XXXX-XXXX
const FS_ID_PATTERN = /^[A-Z0-9]{2,5}-[A-Z0-9]{2,5}$/;

function extractFsId(notes) {
  if (!notes) return null;

  // Try JSON parse first
  try {
    const parsed = JSON.parse(notes);
    if (parsed.familysearch_id) {
      return parsed.familysearch_id.trim();
    }
  } catch (e) {
    // Not JSON, try text patterns
  }

  // Try text format: "FamilySearch ID: XXXX-XXX"
  const textMatch = notes.match(/FamilySearch\s+ID:\s*([A-Z0-9]+-[A-Z0-9]+)/i);
  if (textMatch) {
    return textMatch[1].trim().toUpperCase();
  }

  // Try: familysearch_id in non-JSON text
  const altMatch = notes.match(/familysearch_id["\s:]+([A-Z0-9]+-[A-Z0-9]+)/i);
  if (altMatch) {
    return altMatch[1].trim().toUpperCase();
  }

  return null;
}

async function main() {
  console.log('=== Backfill person_external_ids from canonical_persons.notes ===\n');

  // Find all candidates: have FS ID in notes, no existing person_external_ids row
  const candidates = await pool.query(`
    SELECT cp.id, cp.notes, cp.person_type
    FROM canonical_persons cp
    WHERE (cp.notes LIKE '%familysearch_id%' OR cp.notes ILIKE '%FamilySearch ID:%')
    AND NOT EXISTS (
      SELECT 1 FROM person_external_ids pei
      WHERE pei.canonical_person_id = cp.id AND pei.id_system = 'familysearch'
    )
    ORDER BY cp.id
  `);

  console.log(`Found ${candidates.rows.length} candidates with FS IDs in notes but no external_ids linkage\n`);

  let inserted = 0;
  let skippedInvalid = 0;
  let skippedNoParse = 0;
  let errors = 0;
  const invalidExamples = [];

  // Process in batches
  for (let i = 0; i < candidates.rows.length; i += BATCH_SIZE) {
    const batch = candidates.rows.slice(i, i + BATCH_SIZE);
    const values = [];
    const params = [];
    let paramIdx = 1;

    for (const row of batch) {
      const fsId = extractFsId(row.notes);

      if (!fsId) {
        skippedNoParse++;
        continue;
      }

      if (!FS_ID_PATTERN.test(fsId)) {
        skippedInvalid++;
        if (invalidExamples.length < 5) {
          invalidExamples.push({ id: row.id, fsId, notes: row.notes?.substring(0, 100) });
        }
        continue;
      }

      const url = `https://www.familysearch.org/tree/person/details/${fsId}`;
      values.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5})`);
      params.push(row.id, 'familysearch', fsId, url, 0.950, 'backfill_notes_fsid');
      paramIdx += 6;
    }

    if (values.length === 0) continue;

    try {
      const sql = `
        INSERT INTO person_external_ids (canonical_person_id, id_system, external_id, external_url, confidence, discovered_by)
        VALUES ${values.join(', ')}
        ON CONFLICT DO NOTHING
      `;
      const result = await pool.query(sql, params);
      inserted += result.rowCount;
      console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: inserted ${result.rowCount} rows (${i + batch.length}/${candidates.rows.length} processed)`);
    } catch (err) {
      errors++;
      console.error(`Batch error at offset ${i}:`, err.message);
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Total candidates:    ${candidates.rows.length}`);
  console.log(`Inserted:            ${inserted}`);
  console.log(`Skipped (no parse):  ${skippedNoParse}`);
  console.log(`Skipped (invalid):   ${skippedInvalid}`);
  console.log(`Errors:              ${errors}`);

  if (invalidExamples.length > 0) {
    console.log('\nInvalid FS ID examples:');
    invalidExamples.forEach(ex => console.log(`  id=${ex.id} fsId="${ex.fsId}" notes="${ex.notes}"`));
  }

  // Verify final state
  const remaining = await pool.query(`
    SELECT count(*) FROM canonical_persons cp
    WHERE (cp.notes LIKE '%familysearch_id%' OR cp.notes ILIKE '%FamilySearch ID:%')
    AND NOT EXISTS (
      SELECT 1 FROM person_external_ids pei
      WHERE pei.canonical_person_id = cp.id AND pei.id_system = 'familysearch'
    )
  `);
  console.log(`\nRemaining without linkage: ${remaining.rows[0].count}`);

  const total = await pool.query(`SELECT count(*) FROM person_external_ids WHERE id_system = 'familysearch'`);
  console.log(`Total person_external_ids (familysearch): ${total.rows[0].count}`);

  await pool.end();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
