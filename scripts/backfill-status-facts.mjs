#!/usr/bin/env node
/**
 * backfill-status-facts.mjs — #96 P2: seed the STATUS layer in person_facts from gate evidence.
 *
 * Status is modeled as time-bounded, evidenced role FACTS in person_facts (not the lossy person_type
 * enum). This backfills the first status fact_types from documents we already hold, VALIDATION COHORT
 * first (per plan-96 decision 4):
 *   - Cohort A (DC certificate_of_freedom holders) → one `free_status` fact per person.
 *     Conservative: a certificate of freedom evidences FREE status, NOT prior enslavement (real or
 *     absent) — enslavement/manumission facts come only from documents that actually say so.
 *   - Cohort B (NY probate testators that are assertable_slaveowner) → one dated `slaveholding` fact.
 *
 * Every fact is grounded in a real person_documents row (source_url + citation + confidence).
 * Idempotent via a NOT EXISTS guard on (person_id, fact_type, source_external_system) — the M096
 * provenance unique can't dedup rows with a NULL date_year (CoF docs carry none), so we guard in SQL.
 * Facts are INTERNAL evidence; they are never externally asserted (the gate governs assertions).
 *
 *   node scripts/backfill-status-facts.mjs                 # dry-run (counts only)
 *   node scripts/backfill-status-facts.mjs --apply
 *   node scripts/backfill-status-facts.mjs --cohort a|b|all --apply
 */
import 'dotenv/config';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const cohortArg = (() => { const i = process.argv.indexOf('--cohort'); return i > -1 ? process.argv[i + 1] : 'all'; })();
const SYS = 'status_backfill_p2';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Each cohort: `cols` (INSERT target columns) + `select` (rows to insert, with the NOT EXISTS guard).
// dry-run counts `SELECT count(*) FROM (<select>)`; apply runs `INSERT INTO person_facts (<cols>) <select> RETURNING`.
const COHORTS = {
  a: {
    label: 'A: DC certificate_of_freedom → free_status',
    cols: `person_id, fact_type, date_precision, value_text, source_table, source_external_system,
           source_external_id, source_url, source_citation, confidence, verification_status`,
    select: `
      WITH src AS (
        SELECT cp.id AS person_id, MIN(d.id) AS doc_id
        FROM canonical_persons cp
        JOIN person_documents d ON d.canonical_person_id = cp.id
        WHERE d.document_type = 'certificate_of_freedom' AND d.s3_key IS NOT NULL
        GROUP BY cp.id)
      SELECT s.person_id, 'free_status', 'unknown', 'certificate of freedom', 'person_documents', '${SYS}',
             'free_status:' || s.person_id, d.source_url,
             'Certificate of freedom (person_documents #' || d.id || ')', 0.85, 'unverified'
      FROM src s JOIN person_documents d ON d.id = s.doc_id
      WHERE NOT EXISTS (SELECT 1 FROM person_facts pf
                         WHERE pf.person_id = s.person_id AND pf.fact_type = 'free_status'
                           AND pf.source_external_system = '${SYS}')`,
  },
  b: {
    label: 'B: NY probate testators (assertable_slaveowner) → slaveholding',
    cols: `person_id, fact_type, date_year, date_precision, place_state, value_text, source_table,
           source_external_system, source_external_id, source_url, source_citation, confidence, verification_status`,
    select: `
      WITH src AS (
        SELECT cp.id AS person_id, MIN(d.document_year) AS yr, MIN(d.id) AS doc_id
        FROM canonical_persons cp
        JOIN person_documents d ON d.canonical_person_id = cp.id
        WHERE d.collection_key LIKE 'new-york-probate-%' AND cp.assertable_slaveowner AND d.s3_key IS NOT NULL
        GROUP BY cp.id)
      SELECT s.person_id, 'slaveholding', s.yr, CASE WHEN s.yr IS NULL THEN 'unknown' ELSE 'year' END, 'NY',
             'enslaved persons documented in estate', 'person_documents', '${SYS}',
             'slaveholding:' || s.person_id, d.source_url,
             'NY probate estate (person_documents #' || d.id || ')', 0.85, 'unverified'
      FROM src s JOIN person_documents d ON d.id = s.doc_id
      WHERE NOT EXISTS (SELECT 1 FROM person_facts pf
                         WHERE pf.person_id = s.person_id AND pf.fact_type = 'slaveholding'
                           AND pf.source_external_system = '${SYS}')`,
  },
};

(async () => {
  const keys = cohortArg === 'all' ? ['a', 'b'] : [cohortArg];
  console.log(`=== status-fact backfill ${APPLY ? '(APPLY)' : '(DRY-RUN)'}  cohort=${cohortArg} ===`);
  for (const k of keys) {
    const c = COHORTS[k];
    if (!c) { console.log(`  unknown cohort '${k}'`); continue; }
    if (!APPLY) {
      const dry = await pool.query(`SELECT count(*) n FROM (${c.select}) t`);
      console.log(`  ${c.label}: would insert ${dry.rows[0].n} fact(s)`);
    } else {
      const r = await pool.query(`INSERT INTO person_facts (${c.cols}) ${c.select} RETURNING person_id`);
      console.log(`  ${c.label}: inserted ${r.rowCount} fact(s)`);
    }
  }
  const s = await pool.query(`SELECT fact_type, count(*) n FROM person_facts WHERE source_external_system='${SYS}' GROUP BY 1 ORDER BY 1`);
  console.log('\n  status facts from this backfill:', s.rows.map(r => `${r.fact_type}=${r.n}`).join('  ') || '(none)');
  await pool.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
