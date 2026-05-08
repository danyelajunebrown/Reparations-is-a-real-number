#!/usr/bin/env node
/**
 * backfill-biscoe-dc-petition.js
 *
 * Targeted data backfill for Ann Maria Biscoe.
 *
 * Sources used:
 *   1. historical_reparations_petitions — DC Compensated Emancipation Act (1862)
 *      gives location: Georgetown, DC
 *   2. ancestor_climb_matches (FamilySearch) — birth_year, death_year, spouse_name
 *
 * Writes to canonical_persons only for NULL fields — never overwrites.
 *
 * Usage:
 *   node scripts/backfill-biscoe-dc-petition.js [--dry-run]
 */

'use strict';

const { Pool } = require('pg');
require('dotenv').config();

const DRY_RUN = process.argv.includes('--dry-run');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

function parseYear(raw) {
  if (!raw) return null;
  const m = String(raw).match(/\b(1[5-9]\d{2}|20[0-2]\d)\b/);
  return m ? parseInt(m[1], 10) : null;
}

function extractFromMatchData(md) {
  if (!md || typeof md !== 'object') return {};
  const r = {};

  const rawBirth =
    md.birth_year || md.birthYear
    || md.birth?.year || md.birth?.date
    || md.vitals?.birth?.date || md.person?.birth?.date
    || (md.display?.birthDate);
  r.birth_year = parseYear(rawBirth);

  const rawDeath =
    md.death_year || md.deathYear
    || md.death?.year || md.death?.date
    || md.vitals?.death?.date || md.person?.death?.date
    || (md.display?.deathDate);
  r.death_year = parseYear(rawDeath);

  const rawSpouse =
    md.spouse || md.spouse_name || md.spouseName
    || (md.spouses?.[0]?.display?.name || md.spouses?.[0]?.name)
    || md.family?.spouse?.display?.name;
  if (rawSpouse) r.spouse_name = String(rawSpouse).trim();

  return r;
}

async function main() {
  console.log(`[biscoe-backfill] ${DRY_RUN ? 'DRY RUN — ' : ''}Starting…\n`);

  // ── 1. Locate Ann Maria Biscoe in canonical_persons ──────────────────────
  const { rows: biscoeRows } = await pool.query(`
    SELECT id, full_name, birth_year, death_year,
           primary_county, primary_state, spouse_name
    FROM canonical_persons
    WHERE full_name ILIKE '%biscoe%'
       OR full_name ILIKE '%bisscoe%'
    ORDER BY full_name
  `);

  if (biscoeRows.length === 0) {
    console.error('[biscoe-backfill] ERROR: No canonical_persons record found matching "biscoe". Aborting.');
    await pool.end();
    process.exit(1);
  }

  console.log(`[biscoe-backfill] Found ${biscoeRows.length} Biscoe record(s):`);
  biscoeRows.forEach(r => console.log(`  id=${r.id}  name="${r.full_name}"  birth=${r.birth_year}  death=${r.death_year}  county=${r.primary_county}  state=${r.primary_state}  spouse=${r.spouse_name}`));
  console.log('');

  for (const biscoe of biscoeRows) {
    console.log(`\n[biscoe-backfill] Processing: ${biscoe.full_name} (id=${biscoe.id})`);

    const updates = {};

    // ── 2. DC Compensated Emancipation Petition → location ─────────────────
    if (!biscoe.primary_state || !biscoe.primary_county) {
      // First try: see if the petition record has a location field
      const { rows: petitions } = await pool.query(`
        SELECT *
        FROM historical_reparations_petitions
        WHERE petitioner_canonical_id = $1
           OR petitioner_name ILIKE '%biscoe%'
        LIMIT 3
      `, [biscoe.id]);

      if (petitions.length > 0) {
        console.log(`[biscoe-backfill] Found ${petitions.length} petition record(s) for Biscoe.`);
        petitions.forEach((p, i) => console.log(`  [${i}] petitioner="${p.petitioner_name}" jurisdiction="${p.jurisdiction}" date="${p.petition_date}"`));

        // Petition is in DC — Georgetown was the original city (now part of DC proper)
        if (!biscoe.primary_state) updates.primary_state = 'DC';
        if (!biscoe.primary_county) updates.primary_county = 'Georgetown';
      } else {
        // No petition record with that canonical_id yet — but we know from the source
        // that Ann Maria Biscoe filed in Georgetown, DC (DC Emancipation Act 1862).
        // We apply the known value directly.
        console.log('[biscoe-backfill] No petition found by canonical_id; applying known Georgetown DC location directly.');
        if (!biscoe.primary_state) updates.primary_state = 'DC';
        if (!biscoe.primary_county) updates.primary_county = 'Georgetown';
      }
    } else {
      console.log(`[biscoe-backfill] Location already populated (${biscoe.primary_county}, ${biscoe.primary_state}) — skipping.`);
    }

    // ── 3. FamilySearch climb data → birth_year, death_year, spouse_name ───
    const { rows: climbMatches } = await pool.query(`
      SELECT match_data, verification_status, match_score
      FROM ancestor_climb_matches
      WHERE canonical_person_id = $1
      ORDER BY
        CASE verification_status
          WHEN 'confirmed_slaveholder' THEN 1
          WHEN 'probable_match'        THEN 2
          ELSE 3
        END,
        match_score DESC NULLS LAST
      LIMIT 5
    `, [biscoe.id]);

    if (climbMatches.length > 0) {
      console.log(`[biscoe-backfill] Found ${climbMatches.length} climb match(es).`);
      for (const cm of climbMatches) {
        const extracted = extractFromMatchData(cm.match_data);
        console.log(`  status=${cm.verification_status}  score=${cm.match_score}  extracted: birth=${extracted.birth_year}  death=${extracted.death_year}  spouse="${extracted.spouse_name}"`);

        if (!biscoe.birth_year && !updates.birth_year && extracted.birth_year) {
          updates.birth_year = extracted.birth_year;
        }
        if (!biscoe.death_year && !updates.death_year && extracted.death_year) {
          updates.death_year = extracted.death_year;
        }
        if (!biscoe.spouse_name && !updates.spouse_name && extracted.spouse_name) {
          updates.spouse_name = extracted.spouse_name;
        }

        // Stop once all three fields are filled
        if (updates.birth_year && updates.death_year && updates.spouse_name) break;
      }
    } else {
      console.log('[biscoe-backfill] No climb matches found for this canonical_id.');
    }

    if (Object.keys(updates).length === 0) {
      console.log('[biscoe-backfill] Nothing to update — all fields already populated or no data found.');
      continue;
    }

    // ── 4. Apply updates ────────────────────────────────────────────────────
    const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 1}`);
    const values = [...Object.values(updates), biscoe.id];
    const sql = `UPDATE canonical_persons SET ${setClauses.join(', ')} WHERE id = $${values.length}`;

    console.log(`\n[biscoe-backfill] Proposed update for ${biscoe.full_name}:`);
    Object.entries(updates).forEach(([k, v]) => console.log(`  ${k}: NULL → "${v}"`));

    if (DRY_RUN) {
      console.log('[DRY RUN] SQL:', sql);
      console.log('[DRY RUN] values:', values);
    } else {
      try {
        await pool.query(sql, values);
        console.log(`[biscoe-backfill] ✓ Updated canonical_persons id=${biscoe.id}.`);
      } catch (err) {
        console.error(`[biscoe-backfill] ERROR updating id=${biscoe.id}: ${err.message}`);
      }
    }
  }

  console.log('\n[biscoe-backfill] Done.');
  await pool.end();
}

main().catch(err => {
  console.error('[fatal]', err);
  process.exit(1);
});
