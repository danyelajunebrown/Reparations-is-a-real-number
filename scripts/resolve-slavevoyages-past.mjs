#!/usr/bin/env node
'use strict';

/**
 * resolve-slavevoyages-past.mjs  (Phase 2 of the SlaveVoyages PAST ingest)
 *
 * Resolves staged PAST records (slavevoyages_past_people) to canonical persons and
 * emits genealogical facts into person_facts. Unlike Hall, these are NOT name-merged:
 * PAST records are mostly FIRST-NAMES (Bora, Pao) and are already distinct individuals
 * within SlaveVoyages, so first-name merging would catastrophically fuse thousands of
 * different people. We therefore CREATE one canonical person per record, anchored by
 * person_external_ids(id_system='slavevoyages_past', external_id=sv_id). Cross-source
 * dedup (e.g. a PAST person who is also in Hall) is a deliberate LATER pass, not this
 * one (Biscoe rule: no auto-merge on common names).
 *
 * The enslavers[] array (captors/owners) → chattel_transfer_events is a SEPARATE
 * dataset-aware step (African Origins enslavers are ship captains, not owners).
 *
 * Idempotent (clears its own slavevoyages_past-sourced output first). Dry-run default.
 * USAGE: node scripts/resolve-slavevoyages-past.mjs [--apply]
 */

import 'dotenv/config';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Pool } = require('pg');
const APPLY = process.argv.includes('--apply');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const CITE = `'SlaveVoyages People of the Atlantic Slave Trade (slavevoyages.org), CC BY-NC 3.0'`;
// dataset → US primary_state (African Origins liberated Africans have no US state).
const STATE = `CASE p.dataset WHEN 'oceans_of_kinfolk' THEN 'Louisiana' WHEN 'texas_bound' THEN 'Texas' ELSE NULL END`;

async function main() {
  console.log(`═══ Resolve SlaveVoyages PAST → canonical persons + person_facts ═══  ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  const c = await pool.connect();
  try {
    await c.query(`ALTER TABLE slavevoyages_past_people ADD COLUMN IF NOT EXISTS canonical_person_id INTEGER`);

    const total = (await c.query(`SELECT COUNT(*) n FROM slavevoyages_past_people`)).rows[0].n;
    const byDS = await c.query(`SELECT dataset, COUNT(*) n FROM slavevoyages_past_people GROUP BY dataset ORDER BY 2 DESC`);
    console.log(`\n  staged records: ${Number(total).toLocaleString()}`);
    byDS.rows.forEach(r => console.log(`    ${r.dataset}: ${Number(r.n).toLocaleString()}`));

    const fc = (await c.query(`
      SELECT COUNT(*) FILTER (WHERE sex IS NOT NULL) sex,
             COUNT(*) FILTER (WHERE racial_descriptor IS NOT NULL) race,
             COUNT(*) FILTER (WHERE language_group IS NOT NULL) origin,
             COUNT(*) FILTER (WHERE age > 0 AND year IS NOT NULL) birth,
             COUNT(*) FILTER (WHERE ship_name IS NOT NULL AND year IS NOT NULL) voyage,
             COUNT(*) FILTER (WHERE disembark_port IS NOT NULL) disembark,
             COUNT(*) FILTER (WHERE name_modern IS NOT NULL AND name_modern <> name) name_variant
      FROM slavevoyages_past_people`)).rows[0];
    const totalFacts = Object.values(fc).reduce((a, v) => a + Number(v), 0);
    console.log(`\n  person_facts to emit: ${totalFacts.toLocaleString()}`);
    console.log('   ', JSON.stringify(fc));
    console.log(`  canonical persons to CREATE: ${Number(total).toLocaleString()} (one per record; no name-merge)`);

    if (!APPLY) { console.log('\nDRY-RUN — re-run with --apply.'); return; }

    await c.query('BEGIN');
    // Idempotency: clear prior SV-PAST output.
    await c.query(`DELETE FROM person_facts WHERE source_external_system='slavevoyages_past'`);
    await c.query(`DELETE FROM person_external_ids WHERE id_system='slavevoyages_past'`);
    await c.query(`UPDATE slavevoyages_past_people SET canonical_person_id = NULL`);

    // 1) CREATE one canonical person per record (temp key in enslaved_person_id).
    await c.query(`
      INSERT INTO canonical_persons (canonical_name, sex, birth_year_estimate, primary_state, primary_county, person_type, created_by, enslaved_person_id, uuid, created_at, updated_at)
      SELECT
        COALESCE(NULLIF(trim(p.name),''), NULLIF(trim(p.name_modern),''), 'Unnamed enslaved person (SV '||p.dataset||' #'||p.sv_id||')'),
        CASE lower(p.sex) WHEN 'female' THEN 'F' WHEN 'male' THEN 'M' ELSE NULL END,
        CASE WHEN p.age > 0 AND p.year IS NOT NULL THEN round(p.year - p.age)::int ELSE NULL END,
        ${STATE}, p.disembark_port, 'enslaved', 'slavevoyages_past', 'svpast:'||p.dataset||':'||p.sv_id, gen_random_uuid(), NOW(), NOW()
      FROM slavevoyages_past_people p WHERE p.canonical_person_id IS NULL`);
    await c.query(`
      UPDATE slavevoyages_past_people p SET canonical_person_id = cp.id
      FROM canonical_persons cp WHERE cp.enslaved_person_id = 'svpast:'||p.dataset||':'||p.sv_id AND p.canonical_person_id IS NULL`);

    // 2) external id anchor.
    await c.query(`
      INSERT INTO person_external_ids (canonical_person_id, id_system, external_id, external_url, confidence)
      SELECT canonical_person_id, 'slavevoyages_past', dataset||':'||sv_id,
             'https://www.slavevoyages.org/past/database', 0.9
      FROM slavevoyages_past_people WHERE canonical_person_id IS NOT NULL
      ON CONFLICT DO NOTHING`);

    // 3) person_facts, set-based per type.
    const PF = `INSERT INTO person_facts (person_id, fact_type, value_text, date_year, date_precision, place_state, place_locality, source_table, source_external_system, source_external_id, source_citation, confidence)`;
    const SRC = `'slavevoyages_past_people','slavevoyages_past',(p.dataset||':'||p.sv_id),${CITE},0.8`;
    const base = `FROM slavevoyages_past_people p WHERE p.canonical_person_id IS NOT NULL`;
    await c.query(`
      ${PF}
      SELECT p.canonical_person_id,'sex',p.sex,NULL::int,NULL,${STATE},p.disembark_port,${SRC} ${base} AND p.sex IS NOT NULL
      UNION ALL
      SELECT p.canonical_person_id,'race_designation',p.racial_descriptor,NULL,NULL,${STATE},p.disembark_port,${SRC} ${base} AND p.racial_descriptor IS NOT NULL
      UNION ALL
      SELECT p.canonical_person_id,'ethnicity_origin',p.language_group,NULL,NULL,${STATE},p.disembark_port,${SRC} ${base} AND p.language_group IS NOT NULL
      UNION ALL
      SELECT p.canonical_person_id,'birth',NULL,round(p.year-p.age)::int,'circa',${STATE},p.disembark_port,${SRC} ${base} AND p.age>0 AND p.year IS NOT NULL
      UNION ALL
      SELECT p.canonical_person_id,'name_variant',p.name_modern,NULL,NULL,${STATE},p.disembark_port,${SRC} ${base} AND p.name_modern IS NOT NULL AND p.name_modern <> p.name
      UNION ALL
      SELECT p.canonical_person_id,'migration','transported on '||p.ship_name||COALESCE(' to '||p.disembark_port,''),p.year,'year',${STATE},p.disembark_port,${SRC} ${base} AND p.ship_name IS NOT NULL AND p.year IS NOT NULL
      UNION ALL
      SELECT p.canonical_person_id,'residence',p.disembark_port,p.year,'year',${STATE},p.disembark_port,${SRC} ${base} AND p.disembark_port IS NOT NULL AND p.year IS NOT NULL
    `);
    await c.query('COMMIT');

    const s = (await c.query(`
      SELECT (SELECT COUNT(*) FROM person_facts WHERE source_external_system='slavevoyages_past') facts,
             (SELECT COUNT(*) FROM canonical_persons WHERE created_by='slavevoyages_past') created,
             (SELECT COUNT(DISTINCT canonical_person_id) FROM slavevoyages_past_people WHERE canonical_person_id IS NOT NULL) linked`)).rows[0];
    console.log(`\n✓ applied: ${Number(s.facts).toLocaleString()} person_facts, ${Number(s.created).toLocaleString()} canonical created, ${Number(s.linked).toLocaleString()} persons linked`);
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  finally { c.release(); await pool.end(); }
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
