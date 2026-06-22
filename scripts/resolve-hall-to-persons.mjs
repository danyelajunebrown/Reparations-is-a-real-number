#!/usr/bin/env node
'use strict';

/**
 * resolve-hall-to-persons.mjs  (Front a, refined-A — GitHub #63)
 *
 * Resolves staged Hall records (hall_slave_records, 100,666) to canonical persons
 * and emits the rich genealogical facts into person_facts. Refined-A:
 *   - REUSE an existing canonical LA enslaved ONLY when the Hall name is GLOBALLY
 *     UNIQUE in Hall and matches exactly one canonical (safe — no common-name trap).
 *   - Otherwise CREATE a canonical person FROM the rich Hall record (it carries the
 *     sex/race/age/origin disambiguators the thin existing records lack).
 *   - person_external_ids(id_system='hall_louisiana', external_id=record_index)
 *     anchors provenance + lets Phase-B dedup reconcile residual overlap with the
 *     prior thin import using the now-rich facts.
 *
 * person_facts emitted set-based (per-type UNION ALL): sex, race_designation,
 * ethnicity_origin, birth(from age), occupation, residence, sale, emancipation,
 * death, escape, maritime arrival. All sourced to Hall.
 *
 * Idempotent (clears its own hall-sourced output first). Dry-run default.
 * USAGE: node scripts/resolve-hall-to-persons.mjs [--apply]
 */

import 'dotenv/config';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Pool } = require('pg');
const APPLY = process.argv.includes('--apply');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const REALNAME = `name IS NOT NULL AND name !~ '^[0-9]+$' AND length(trim(name)) > 1`;

async function main() {
    console.log(`═══ Resolve Hall → canonical persons + person_facts ═══  ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
    const c = await pool.connect();
    try {
        await c.query(`ALTER TABLE hall_slave_records ADD COLUMN IF NOT EXISTS canonical_person_id INTEGER`);

        // Reuse set: Hall name globally-unique in Hall AND matches exactly one canonical LA enslaved.
        const reuse = await c.query(`
            WITH uniq_hall AS (
                SELECT lower(name) nm FROM hall_slave_records WHERE ${REALNAME}
                GROUP BY lower(name) HAVING COUNT(*) = 1
            ),
            uniq_canon AS (
                SELECT lower(canonical_name) nm, MIN(id) id FROM canonical_persons
                WHERE person_type='enslaved' AND primary_state='Louisiana'
                GROUP BY lower(canonical_name) HAVING COUNT(*) = 1
            )
            SELECT COUNT(*) n FROM hall_slave_records h
            JOIN uniq_hall uh ON uh.nm = lower(h.name)
            JOIN uniq_canon uc ON uc.nm = lower(h.name)
            WHERE ${REALNAME}
        `);
        const total = (await c.query(`SELECT COUNT(*) n FROM hall_slave_records`)).rows[0].n;
        const reuseN = reuse.rows[0].n;
        console.log(`\n  records:            ${Number(total).toLocaleString()}`);
        console.log(`  REUSE existing:     ${Number(reuseN).toLocaleString()} (globally-unique name → 1 canonical)`);
        console.log(`  CREATE from Hall:   ${(total - reuseN).toLocaleString()} (rich record is the disambiguator; Phase-B dedups residuals)`);

        // Projected person_facts volume (set-based count of emittable facts).
        const factCounts = await c.query(`
            SELECT
              COUNT(*) FILTER (WHERE sex IS NOT NULL) sex,
              COUNT(*) FILTER (WHERE race IS NOT NULL) race,
              COUNT(*) FILTER (WHERE birthplace IS NOT NULL) origin,
              COUNT(*) FILTER (WHERE age > 0 AND year IS NOT NULL) birth,
              COUNT(*) FILTER (WHERE skills IS NOT NULL) occupation,
              COUNT(*) FILTER (WHERE location IS NOT NULL AND year IS NOT NULL) residence,
              COUNT(*) FILTER (WHERE sale_value > 0) sale,
              COUNT(*) FILTER (WHERE emancipated) emancipation,
              COUNT(*) FILTER (WHERE dead) death,
              COUNT(*) FILTER (WHERE runaway) escape,
              COUNT(*) FILTER (WHERE ship IS NOT NULL) arrival
            FROM hall_slave_records`);
        const fc = factCounts.rows[0];
        const totalFacts = Object.values(fc).reduce((a, v) => a + Number(v), 0);
        console.log(`\n  person_facts to emit: ${totalFacts.toLocaleString()}`);
        console.log('   ', JSON.stringify(fc));

        if (!APPLY) { console.log('\nDRY-RUN — re-run with --apply.'); await c.query('ROLLBACK').catch(()=>{}); return; }

        await c.query('BEGIN');
        // Idempotency: clear prior hall-sourced facts + extids + the resolved-id column.
        await c.query(`DELETE FROM person_facts WHERE source_external_system='hall_louisiana'`);
        await c.query(`DELETE FROM person_external_ids WHERE id_system='hall_louisiana'`);
        await c.query(`UPDATE hall_slave_records SET canonical_person_id = NULL`);

        // 1) REUSE: link unique-name matches.
        await c.query(`
            WITH uniq_hall AS (SELECT lower(name) nm FROM hall_slave_records WHERE ${REALNAME} GROUP BY lower(name) HAVING COUNT(*)=1),
                 uniq_canon AS (SELECT lower(canonical_name) nm, MIN(id) id FROM canonical_persons WHERE person_type='enslaved' AND primary_state='Louisiana' GROUP BY lower(canonical_name) HAVING COUNT(*)=1)
            UPDATE hall_slave_records h SET canonical_person_id = uc.id
            FROM uniq_hall uh JOIN uniq_canon uc ON uc.nm = uh.nm
            WHERE lower(h.name) = uh.nm AND ${REALNAME}`);

        // 2) CREATE canonical for the rest (stash record_index in enslaved_person_id as temp key).
        await c.query(`
            INSERT INTO canonical_persons (canonical_name, sex, birth_year_estimate, primary_state, primary_county, person_type, created_by, enslaved_person_id, uuid, created_at, updated_at)
            SELECT
              COALESCE(NULLIF(trim(name),''), 'Unnamed enslaved person (Hall #'||record_index||')'),
              CASE sex WHEN 'female' THEN 'F' WHEN 'male' THEN 'M' ELSE NULL END,
              CASE WHEN age > 0 AND year IS NOT NULL THEN round(year - age)::int ELSE NULL END,
              'Louisiana', location, 'enslaved', 'hall_ingest', 'hall:'||record_index, gen_random_uuid(), NOW(), NOW()
            FROM hall_slave_records WHERE canonical_person_id IS NULL`);
        await c.query(`
            UPDATE hall_slave_records h SET canonical_person_id = cp.id
            FROM canonical_persons cp WHERE cp.enslaved_person_id = 'hall:'||h.record_index AND h.canonical_person_id IS NULL`);

        // 3) external id anchor for created rows.
        await c.query(`
            INSERT INTO person_external_ids (canonical_person_id, id_system, external_id, confidence)
            SELECT canonical_person_id, 'hall_louisiana', record_index::text, 0.9
            FROM hall_slave_records WHERE canonical_person_id IS NOT NULL
            ON CONFLICT DO NOTHING`);

        // 4) person_facts, set-based per type (UNION ALL — robust).
        const PF = `INSERT INTO person_facts (person_id, fact_type, value_text, date_year, date_precision, place_state, place_locality, source_table, source_external_system, source_external_id, source_citation, confidence)`;
        const SRC = `'hall_slave_records','hall_louisiana',h.record_index::text,h.source_citation,0.75`;
        const base = `FROM hall_slave_records h WHERE h.canonical_person_id IS NOT NULL`;
        await c.query(`
            ${PF}
            SELECT h.canonical_person_id,'sex',h.sex,NULL::int,NULL,'Louisiana',h.location,${SRC} ${base} AND h.sex IS NOT NULL
            UNION ALL
            SELECT h.canonical_person_id,'race_designation',h.race,NULL,NULL,'Louisiana',h.location,${SRC} ${base} AND h.race IS NOT NULL
            UNION ALL
            SELECT h.canonical_person_id,'ethnicity_origin',COALESCE(h.african_nation_spelling,h.birthplace),NULL,NULL,'Louisiana',h.location,${SRC} ${base} AND COALESCE(h.african_nation_spelling,h.birthplace) IS NOT NULL
            UNION ALL
            SELECT h.canonical_person_id,'birth',NULL,round(h.year-h.age)::int,'circa','Louisiana',h.location,${SRC} ${base} AND h.age>0 AND h.year IS NOT NULL
            UNION ALL
            SELECT h.canonical_person_id,'occupation',h.skills,NULL,NULL,'Louisiana',h.location,${SRC} ${base} AND h.skills IS NOT NULL
            UNION ALL
            SELECT h.canonical_person_id,'residence',h.location,h.year,'year','Louisiana',h.location,${SRC} ${base} AND h.location IS NOT NULL AND h.year IS NOT NULL
            UNION ALL
            SELECT h.canonical_person_id,'sale',h.sale_value::text||' '||COALESCE(h.sale_currency,''),h.year,'year','Louisiana',h.location,${SRC} ${base} AND COALESCE(h.sale_value,0) > 0
            UNION ALL
            SELECT h.canonical_person_id,'manumission','emancipated',h.year,'year','Louisiana',h.location,${SRC} ${base} AND h.emancipated
            UNION ALL
            SELECT h.canonical_person_id,'death','listed as dead',h.year,'year','Louisiana',h.location,${SRC} ${base} AND h.dead
            UNION ALL
            SELECT h.canonical_person_id,'escape','runaway',h.year,'year','Louisiana',h.location,${SRC} ${base} AND h.runaway
            UNION ALL
            SELECT h.canonical_person_id,'migration','arrived on '||h.ship||COALESCE(' from '||h.embark_from,''),h.year,'year','Louisiana',h.location,${SRC} ${base} AND h.ship IS NOT NULL
        `);
        await c.query('COMMIT');

        const summary = await c.query(`
            SELECT (SELECT COUNT(*) FROM person_facts WHERE source_external_system='hall_louisiana') facts,
                   (SELECT COUNT(*) FROM canonical_persons WHERE created_by='hall_ingest') created,
                   (SELECT COUNT(DISTINCT canonical_person_id) FROM hall_slave_records WHERE canonical_person_id IS NOT NULL) persons_linked`);
        console.log(`\n✓ applied: ${Number(summary.rows[0].facts).toLocaleString()} person_facts, ${Number(summary.rows[0].created).toLocaleString()} canonical created, ${Number(summary.rows[0].persons_linked).toLocaleString()} persons linked`);
    } catch (e) { await c.query('ROLLBACK').catch(()=>{}); throw e; }
    finally { c.release(); await pool.end(); }
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
