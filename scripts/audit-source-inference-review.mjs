// audit-source-inference-review.mjs — the exhaustive review: for every SOURCE, what does it ASSERT, and
// is that assertion EVIDENCED, RETRIEVABLE, and DECIDED?
//
// WHY (operator, 2026-08-20): "all these levels of inference need to be consistent and actual decisions I
// make... we need an exhaustive review of the data now that we have billions of source types and it's only
// getting worse."
//
// THE PATTERN THIS EXISTS TO CATCH. Every serious defect found on 2026-08-19/20 was an IMPLICIT INFERENCE
// made by code that no human ever decided, operating at a scale of millions:
//     "a probate decedent is an enslaver"          -> 7,053 canonicals fabricated
//     "a tally mark on a slave schedule is a person" -> 1,455,019 rows fabricated
//     "found via a family tree means possibly alive"  -> 12,562 ancestors hidden from search
//     "no attached scan means not assertable"         -> 243,209 enslaved people unfindable
//     "y is not a vowel"                              -> every Mary silently deleted
// None was a decision. Each was a default that became policy. This audit makes the defaults visible.
//
// IT ASSERTS NOTHING AND CHANGES NOTHING. Read-only. It reports, per source, the four questions that
// actually matter, so a human can decide rather than discover:
//   1. VOLUME     — how many people/rows does this source claim?
//   2. EVIDENCED  — do they serve an archived document (s3_key), i.e. can we show the thing?
//   3. RETRIEVABLE— are they embedded, i.e. can anyone FIND them? (RULE 0.5)
//   4. VISIBLE    — do they pass the public assertion gate, i.e. can a descendant see them?
// A source that is high-volume, low-evidence, invisible and unembedded is not an asset. It is a liability
// that looks like an asset in a row count.
//
// Usage: node scripts/audit-source-inference-review.mjs [--json]

import 'dotenv/config';
import pg from 'pg';

const AS_JSON = process.argv.includes('--json');
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false },
    statement_timeout: 600000, query_timeout: 600000 });
  pool.on('error', (e) => console.error(`[pool] idle client error (continuing): ${e.message}`));

  // ── 1. LEADS by source: volume vs evidence vs retrievability ─────────────────────────────────────
  const leads = (await pool.query(`
    SELECT COALESCE(u.source_type,'(none)') AS source,
           COALESCE(u.extraction_method,'(none)') AS method,
           u.person_type,
           count(*)::int AS rows,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM person_documents d
              WHERE d.unconfirmed_person_id=u.lead_id AND d.s3_key IS NOT NULL))::int AS evidenced,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM embeddings e
              WHERE e.subject_table='unconfirmed_persons' AND e.subject_id=u.lead_id::text))::int AS embedded,
           count(*) FILTER (WHERE COALESCE(u.status,'')='placeholder_aggregate')::int AS quarantined
      FROM unconfirmed_persons u
     GROUP BY 1,2,3
     HAVING count(*) > 500
     ORDER BY rows DESC LIMIT 30`)).rows;

  // ── 2. CANONICALS: can a descendant actually see them? ───────────────────────────────────────────
  const canon = (await pool.query(`
    SELECT person_type,
           count(*)::int AS rows,
           count(*) FILTER (WHERE assertable_slaveowner OR assertable_enslaved)::int AS publicly_visible,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM person_documents d
              WHERE d.canonical_person_id=canonical_persons.id AND d.s3_key IS NOT NULL))::int AS evidenced,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM embeddings e
              WHERE e.subject_table='canonical_persons' AND e.subject_id=canonical_persons.id::text))::int AS embedded
      FROM canonical_persons GROUP BY 1 ORDER BY rows DESC`)).rows;

  // ── 3. THE VERBS: relationships, transactions, harms, findings ───────────────────────────────────
  const verbs = [];
  for (const [t, kind] of [['canonical_family_edges', 'kin_edge'], ['chattel_transfer_events', 'chattel_transfer'],
                           ['research_findings', 'research_finding'], ['harm_events', 'harm_narrative'],
                           ['enslaved_owner_relationships', null], ['slave_era_insurance_policies', null],
                           ['wealth_transfer_events', null], ['slavevoyages_voyages', null],
                           ['corporate_financial_instruments', null], ['inheritance_edges', null]]) {
    try {
      const n = (await pool.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n;
      const e = kind ? (await pool.query(`SELECT count(*)::int n FROM embeddings WHERE content_kind=$1`, [kind])).rows[0].n : 0;
      verbs.push({ table: t, rows: n, embedded: e, retrievable: kind ? `${pct(e, n)}%` : 'NOT EMBEDDABLE YET' });
    } catch { /* table absent */ }
  }

  if (AS_JSON) { console.log(JSON.stringify({ leads, canon, verbs }, null, 1)); await pool.end(); return; }

  console.log('\n════ 1. LEADS — what each source CLAIMS vs what it can SHOW ════');
  console.log('source/method/type'.padEnd(58) + 'rows'.padStart(10) + 'evidenced'.padStart(12) + 'embedded'.padStart(11) + 'quarantined'.padStart(13));
  for (const r of leads) {
    const label = `${r.source}/${r.method}/${r.person_type}`.slice(0, 56);
    console.log(label.padEnd(58) +
      String(r.rows).padStart(10) +
      `${pct(r.evidenced, r.rows)}%`.padStart(12) +
      `${pct(r.embedded, r.rows)}%`.padStart(11) +
      String(r.quarantined || '').padStart(13));
  }

  console.log('\n════ 2. CANONICALS — can a descendant SEE them? ════');
  console.log('person_type'.padEnd(24) + 'rows'.padStart(10) + 'public'.padStart(10) + 'evidenced'.padStart(12) + 'embedded'.padStart(11));
  for (const r of canon) {
    console.log(String(r.person_type).padEnd(24) + String(r.rows).padStart(10) +
      `${pct(r.publicly_visible, r.rows)}%`.padStart(10) +
      `${pct(r.evidenced, r.rows)}%`.padStart(12) +
      `${pct(r.embedded, r.rows)}%`.padStart(11));
  }

  console.log('\n════ 3. THE VERBS — relationships, transactions, harms ════');
  console.log('table'.padEnd(36) + 'rows'.padStart(10) + 'embedded'.padStart(11) + '   retrievable');
  for (const v of verbs) {
    console.log(String(v.table).padEnd(36) + String(v.rows).padStart(10) + String(v.embedded).padStart(11) + '   ' + v.retrievable);
  }

  console.log('\n════ READ IT THIS WAY ════');
  console.log('A source with HIGH rows and LOW evidenced is asserting more than it can show.');
  console.log('A source with LOW embedded is invisible to RAG — nobody can find those people.');
  console.log('A person_type with LOW public is hidden from the descendants it exists to serve.');
  console.log('A verb table with NOT EMBEDDABLE YET cannot answer a question, only store one.');
  await pool.end();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
