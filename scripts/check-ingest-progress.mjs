// check-ingest-progress.mjs — answer "is it done?" from the DATA, not from a log tail.
//
// WHY (operator, 2026-08-22: "how will you know when marronage is complete?"). I could not have said. Every
// long-running job on 2026-08-21 ended in one of three ways — finished cleanly, hit its batch cap and
// exited looking finished, or died silently — and all three leave a log whose last line looks the same. A
// progress number that comes from a counter inside a process that may no longer exist is not a progress
// number. So each source declares its DENOMINATOR and its DONE-PREDICATE here, and completion is a query.
//
// Usage: node scripts/check-ingest-progress.mjs [--json]
import 'dotenv/config';
import pg from 'pg';

const AS_JSON = process.argv.includes('--json');
const SOURCES = [
  { name: 'marronnage (named people)', total: 3705,
    sql: `SELECT count(DISTINCT split_part(external_id,':',3))::int n FROM person_external_ids
           WHERE id_system='marronnage_named'`,
    note: 'curated name index; a name with no surviving ad still counts as attempted' },
  { name: 'marronnage documents', total: null,
    sql: `SELECT count(*)::int n FROM person_documents WHERE document_type='runaway_advertisement'` },
  { name: 'marronnage harm_events', total: null,
    sql: `SELECT count(*)::int n FROM harm_events WHERE source_citation ILIKE '%marronnage%'` },
  { name: '1860 slave-schedule leaves', total: null,
    sql: `SELECT count(*) FILTER (WHERE scraped_at IS NOT NULL)::int n
            FROM familysearch_locations WHERE waypoint_id IS NOT NULL`,
    totalSql: `SELECT count(*)::int n FROM familysearch_locations WHERE waypoint_id IS NOT NULL`,
    note: 'leaves only — the 977 waypoint_id-NULL container rows are NOT work' },
  { name: 'person_fact embeddings', total: null,
    sql: `SELECT count(*)::int n FROM embeddings WHERE content_kind='person_fact'`,
    totalSql: `SELECT count(*)::int n FROM person_facts` },
  { name: 'canonical_profile embeddings', total: null,
    sql: `SELECT count(*)::int n FROM embeddings WHERE content_kind='canonical_profile'`,
    totalSql: `SELECT count(*)::int n FROM canonical_persons WHERE person_type<>'merged'` },
  { name: 'FS image arks archived', total: null,
    sql: `SELECT count(*)::int n FROM person_documents WHERE source_url ~ 'ark:/61903/3:1:' AND s3_key IS NOT NULL`,
    totalSql: `SELECT count(*)::int n FROM person_documents WHERE source_url ~ 'ark:/61903/3:1:'` },
  { name: 'DLAS petitions ingested', total: null,
    sql: `SELECT count(*) FILTER (WHERE status='ingested')::int n FROM source_ingest_queue WHERE source_kind='dlas_petition'`,
    totalSql: `SELECT count(*)::int n FROM source_ingest_queue WHERE source_kind='dlas_petition'`,
    note: 'requeued on the role facet fr=3; the old enslavedCount key selected petitions with NO named enslaved' },
  { name: 'DLAS petitions queued (role)', total: null,
    sql: `SELECT count(*)::int n FROM source_ingest_queue
           WHERE source_kind='dlas_petition' AND added_by='harvest-dlas-enslaved-role'` },
  { name: 'DLAS named enslaved (reported)', total: null,
    sql: `SELECT COALESCE(sum((result->>'named_enslaved_reported')::int),0)::int n FROM source_ingest_queue
           WHERE source_kind='dlas_petition' AND added_by='harvest-dlas-enslaved-role'`,
    note: 'source-asserted count from the result pages; NOT people we have ingested' },
];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false },
  statement_timeout: 300000, query_timeout: 300000 });
pool.on('error', (e) => console.error(`[pool] ${e.message}`));

const out = [];
for (const s of SOURCES) {
  try {
    const done = (await pool.query(s.sql)).rows[0].n;
    const total = s.totalSql ? (await pool.query(s.totalSql)).rows[0].n : s.total;
    out.push({ source: s.name, done, total, pct: total ? Math.round((done / total) * 1000) / 10 : null, note: s.note });
  } catch (e) { out.push({ source: s.name, error: e.message.slice(0, 70) }); }
}
if (AS_JSON) { console.log(JSON.stringify(out, null, 1)); }
else {
  console.log('\n════ INGEST PROGRESS — measured from the data, not from logs ════\n');
  for (const r of out) {
    if (r.error) { console.log(`  ${r.source.padEnd(32)} ERROR ${r.error}`); continue; }
    const bar = r.pct == null ? '' : '█'.repeat(Math.round(r.pct / 5)).padEnd(20, '·');
    const status = r.pct == null ? '' : r.pct >= 100 ? '  ✅ COMPLETE' : '';
    console.log(`  ${r.source.padEnd(32)} ${String(r.done).padStart(8)}${r.total ? ' / ' + String(r.total).padEnd(8) : '          '} ${bar} ${r.pct != null ? r.pct + '%' : ''}${status}`);
    if (r.note) console.log(`  ${''.padEnd(32)} ↳ ${r.note}`);
  }
}
await pool.end();
