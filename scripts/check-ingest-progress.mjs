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
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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
    // MIRROR THE SCRAPER'S OWN FILTERS. This counted every waypoint_id-NOT-NULL row, but
    // extract-census-ocr also excludes `district = state` and `county = state` ROLLUP rows and
    // '%collection%' waypoints. So the bar read "19 leaves left" for days while the scraper correctly
    // reported "Found 0 locations to process" — 15 of those 19 are rollups it will never process, by
    // design. A progress metric that does not use the worker's own definition of work invents a backlog,
    // which is the same error as counting the 977 container nodes as unfinished.
    // AND PIN THE COLLECTION. This row says 1860 but had no collection filter, so the moment 1850
    // (cc 1420440) began enumerating on 2026-09-04 its unscraped leaves landed in the 1860 denominator and
    // the bar fell from 98.7% to 83.9% overnight — a second corpus mistaken for a regression in the first.
    sql: `SELECT count(*) FILTER (WHERE scraped_at IS NOT NULL)::int n
            FROM familysearch_locations
           WHERE collection_id='3161105'
             AND waypoint_id IS NOT NULL AND waypoint_id NOT LIKE '%collection%'
             AND district <> state AND county <> state`,
    totalSql: `SELECT count(*)::int n FROM familysearch_locations
                WHERE collection_id='3161105'
                  AND waypoint_id IS NOT NULL AND waypoint_id NOT LIKE '%collection%'
                  AND district <> state AND county <> state`,
    note: 'processable leaves only — rollup rows (district=state) and container nodes are NOT work' },
  // COUNTY COVERAGE — the one metric here whose denominator we did not generate.
  // The leaves row above divides scraped-by-enumerated. Both halves come from familysearch_locations, so it
  // reported "5,496 / 5,497 ✅ COMPLETE" while 100 counties had never been enumerated at all: the FS waypoint
  // API caps at 100 children and truncated VA/GA/MO/KY alphabetically. A ratio cannot see a row that was
  // never inserted. This row divides counties-held by the operator-supplied lists in memory-bank/
  // reference-data/, which is the only number in this file that can fall when the corpus is short.
  { name: '1860 counties vs external list', total: null,
    compute: async (pool) => {
      const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'memory-bank', 'reference-data');
      const norm = (x) => (x || '').toLowerCase().replace(/\b(county|co\.?|city|parish)\b/g, '').replace(/[^a-z]/g, '');
      let listed = 0, held = 0; const short = [];
      for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.txt'))) {
        const state = f.replace(/\.txt$/, '').replace(/(^|-)([a-z])/g, (_, a, b) => a.replace('-', ' ') + b.toUpperCase());
        const names = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').map((x) => x.trim()).filter(Boolean);
        const have = new Set((await pool.query(
          `SELECT DISTINCT county FROM familysearch_locations WHERE state=$1 AND collection_id='3161105'`,
          [state])).rows.map((r) => norm(r.county)));
        const miss = names.filter((c) => !have.has(norm(c)));
        listed += names.length; held += names.length - miss.length;
        if (miss.length) short.push(`${state} -${miss.length}`);
      }
      return { done: held, total: listed,
        note: short.length ? `STILL MISSING: ${short.join(' · ')}` : 'every listed county enumerated' };
    } },
  { name: 'person_fact embeddings', total: null,
    sql: `SELECT count(*)::int n FROM embeddings WHERE content_kind='person_fact'`,
    totalSql: `SELECT count(*)::int n FROM person_facts` },
  { name: 'canonical_profile embeddings', total: null,
    sql: `SELECT count(*)::int n FROM embeddings WHERE content_kind='canonical_profile'`,
    totalSql: `SELECT count(*)::int n FROM canonical_persons WHERE person_type<>'merged'` },
  { name: 'harm_event embeddings', total: null,
    sql: `SELECT count(*)::int n FROM embeddings WHERE content_kind='harm_narrative'`,
    totalSql: `SELECT count(*)::int n FROM harm_events`,
    note: 'a harm is what a DAA is FOR — this had no embedding facet at all until 2026-08-22' },
  { name: 'new-source doc text stored', total: null,
    sql: `SELECT count(*)::int n FROM person_documents
           WHERE document_type IN ('runaway_advertisement','court_petition')
             AND ocr_text IS NOT NULL AND length(ocr_text) > 40`,
    totalSql: `SELECT count(*)::int n FROM person_documents
                WHERE document_type IN ('runaway_advertisement','court_petition')`,
    note: 'DLAS abstracts + marronnage ad text; a document with no text cannot be embedded' },
  { name: 'new-source docs embedded', total: null,
    sql: `SELECT count(*)::int n FROM embeddings e WHERE e.subject_table='person_documents'
            AND EXISTS (SELECT 1 FROM person_documents d WHERE d.id::text=e.subject_id
                          AND d.document_type IN ('runaway_advertisement','court_petition'))`,
    totalSql: `SELECT count(*)::int n FROM person_documents
                WHERE document_type IN ('runaway_advertisement','court_petition')
                  AND ocr_text IS NOT NULL AND length(ocr_text) > 40` },
  { name: 'marronnage scans (S3+wayback)', total: null,
    sql: `SELECT count(*)::int n FROM source_artifacts WHERE dataset_label='marronnage_scan'` },
  { name: 'FS image arks archived', total: null,
    sql: `SELECT count(*)::int n FROM person_documents WHERE source_url ~ 'ark:/61903/3:1:' AND s3_key IS NOT NULL`,
    totalSql: `SELECT count(*)::int n FROM person_documents WHERE source_url ~ 'ark:/61903/3:1:'` },
  { name: 'stalled? last 1860 leaf', total: null,
    sql: `SELECT (EXTRACT(EPOCH FROM (now() - max(scraped_at)))/60)::int n
            FROM familysearch_locations WHERE waypoint_id IS NOT NULL`,
    note: 'MINUTES since the last leaf completed — a pgrep-alive process that has not moved is HUNG, and a hung job holds the browser lock while looking healthy (11h Alabama stall, 2026-08-22)' },
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
    let done, total, note = s.note;
    if (s.compute) { const r = await s.compute(pool); done = r.done; total = r.total; note = r.note || note; }
    else {
      done = (await pool.query(s.sql)).rows[0].n;
      total = s.totalSql ? (await pool.query(s.totalSql)).rows[0].n : s.total;
    }
    out.push({ source: s.name, done, total, pct: total ? Math.round((done / total) * 1000) / 10 : null, note });
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
